"""Server-authoritative task logic."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from aiogram import Bot
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import ChannelSubscription, TaskClaim, Transaction, User
from ..schemas import (
    ChannelMetaDto,
    TaskClaimResponse,
    TaskDto,
    TaskTierDto,
    TasksResponse,
)
from .tasks_catalog import TASKS_CATALOG

TASK_STATUSES = {"member", "administrator", "creator"}


def get_official_channel_config() -> dict[str, Any] | None:
    username = settings.OFFICIAL_CHANNEL_USERNAME.strip().lstrip("@")
    channel_id = settings.OFFICIAL_CHANNEL_ID.strip()
    if not username or not channel_id:
        return None

    reward = settings.OFFICIAL_CHANNEL_REWARD
    title = TASKS_CATALOG[0]["tiers"][0]["title"]
    return {
        "channel_id": channel_id,
        "name": settings.OFFICIAL_CHANNEL_NAME,
        "username": username,
        "url": f"https://t.me/{username}",
        "reward_coins": reward,
        "claim_id": "official_channel_subscribe",
        "title": title,
    }


def _build_channel_meta() -> ChannelMetaDto | None:
    channel = get_official_channel_config()
    if not channel:
        return None

    return ChannelMetaDto(
        channel_id=channel["channel_id"],
        name=channel["name"],
        username=channel["username"],
        url=channel["url"],
    )


def _get_progress(task_id: str, user: User) -> int:
    if task_id == "arcade_levels":
        return max(0, user.current_level - 1)
    if task_id == "friends_confirmed":
        return max(0, user.referrals_count)
    if task_id == "official_channel":
        return 0
    raise ValueError(f"Unknown task id: {task_id}")


def _resolve_tier(task_id: str, tier: dict[str, Any]) -> dict[str, Any]:
    if task_id != "official_channel":
        return tier

    channel = get_official_channel_config()
    if not channel:
        return tier

    return {
        **tier,
        "reward_coins": channel["reward_coins"],
        "title": channel["title"],
    }


def _build_task_dto(task: dict[str, Any], claimed_ids: set[str], user: User) -> TaskDto:
    progress = _get_progress(task["id"], user)
    tiers = [
        TaskTierDto(
            claim_id=resolved_tier["claim_id"],
            target=resolved_tier["target"],
            reward_coins=resolved_tier["reward_coins"],
            title=resolved_tier["title"],
            claimed=resolved_tier["claim_id"] in claimed_ids,
        )
        for tier in task["tiers"]
        for resolved_tier in [_resolve_tier(task["id"], tier)]
    ]

    next_tier_index = next((idx for idx, tier in enumerate(tiers) if not tier.claimed), None)

    if next_tier_index is None:
        status = "completed"
    elif task["id"] == "official_channel":
        status = "action_required"
    else:
        next_tier = tiers[next_tier_index]
        status = "claimable" if progress >= next_tier.target else "in_progress"

    return TaskDto(
        id=task["id"],
        kind=task["kind"],
        base_title=task["base_title"],
        base_description=task["base_description"],
        progress=progress,
        status=status,
        next_tier_index=next_tier_index,
        tiers=tiers,
        channel=_build_channel_meta() if task["id"] == "official_channel" else None,
    )


async def build_tasks_for_user(user: User, db: AsyncSession) -> TasksResponse:
    result = await db.execute(select(TaskClaim.claim_id).where(TaskClaim.user_id == user.id))
    claimed_ids = set(result.scalars().all())
    tasks = [_build_task_dto(task, claimed_ids, user) for task in TASKS_CATALOG]
    return TasksResponse(tasks=tasks)


def _get_tier_by_claim_id(claim_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    for task in TASKS_CATALOG:
        for tier in task["tiers"]:
            if tier["claim_id"] == claim_id:
                return task, tier
    raise HTTPException(status_code=404, detail={"code": "TASK_NOT_FOUND", "message": "Task not found"})


async def verify_official_channel_subscription(user: User) -> dict[str, Any]:
    channel = get_official_channel_config()
    if not channel:
        raise HTTPException(
            status_code=503,
            detail={"code": "CHANNEL_CONFIG_MISSING", "message": "Official channel is not configured"},
        )
    if not settings.TELEGRAM_BOT_TOKEN:
        raise HTTPException(
            status_code=503,
            detail={"code": "BOT_TOKEN_MISSING", "message": "Telegram bot token is not configured"},
        )

    bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
    try:
        member = await bot.get_chat_member(channel["channel_id"], user.telegram_id)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "CHANNEL_CHECK_FAILED", "message": f"Subscription check failed: {exc}"},
        ) from exc
    finally:
        await bot.session.close()

    if member.status not in TASK_STATUSES:
        raise HTTPException(
            status_code=409,
            detail={"code": "CHANNEL_NOT_SUBSCRIBED", "message": "Подпишитесь на канал и вернитесь сюда"},
        )

    return channel


async def _ensure_channel_subscription(user: User, db: AsyncSession, channel: dict[str, Any]) -> None:
    result = await db.execute(
        select(ChannelSubscription).where(
            ChannelSubscription.user_id == user.id,
            ChannelSubscription.channel_id == channel["channel_id"],
        )
    )
    subscription = result.scalar_one_or_none()
    if subscription:
        subscription.reward_claimed = True
        subscription.channel_username = channel["username"]
        return

    db.add(
        ChannelSubscription(
            user_id=user.id,
            channel_id=channel["channel_id"],
            channel_username=channel["username"],
            reward_claimed=True,
        )
    )


async def claim_task(user: User, claim_id: str, db: AsyncSession) -> TaskClaimResponse:
    task, tier = _get_tier_by_claim_id(claim_id)
    tier = _resolve_tier(task["id"], tier)

    existing = await db.execute(
        select(TaskClaim).where(TaskClaim.user_id == user.id, TaskClaim.claim_id == claim_id)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail={"code": "TASK_ALREADY_CLAIMED", "message": "Task reward already claimed"},
        )

    progress = _get_progress(task["id"], user)
    if task["id"] == "official_channel":
        channel = await verify_official_channel_subscription(user)
        await _ensure_channel_subscription(user, db, channel)
    elif progress < tier["target"]:
        raise HTTPException(
            status_code=409,
            detail={"code": "TASK_NOT_READY", "message": "Task requirements are not met yet"},
        )

    user.coins += tier["reward_coins"]

    db.add(
        TaskClaim(
            user_id=user.id,
            claim_id=claim_id,
            task_group=task["id"],
            reward_coins=tier["reward_coins"],
        )
    )
    db.add(
        Transaction(
            user_id=user.id,
            type="task",
            currency="coins",
            amount=Decimal(tier["reward_coins"]),
            item_type="task",
            item_id=claim_id,
            status="completed",
        )
    )

    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail={"code": "TASK_ALREADY_CLAIMED", "message": "Task reward already claimed"},
        ) from exc

    tasks = await build_tasks_for_user(user, db)
    updated_task = next(item for item in tasks.tasks if item.id == task["id"])

    return TaskClaimResponse(
        success=True,
        claim_id=claim_id,
        coins=user.coins,
        reward_coins=tier["reward_coins"],
        task_id=task["id"],
        task_status=updated_task.status,
        next_tier_index=updated_task.next_tier_index,
    )
