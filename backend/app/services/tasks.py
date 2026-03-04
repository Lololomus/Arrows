"""Server-authoritative task logic."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from aiogram import Bot
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import ChannelSubscription, LevelAttempt, TaskClaim, Transaction, User
from ..schemas import (
    ChannelMetaDto,
    TaskClaimResponse,
    TaskDto,
    TaskTierDto,
    TasksResponse,
)
from .ad_rewards import MSK, today_msk
from .tasks_catalog import TASKS_CATALOG

TASK_STATUSES = {"member", "administrator", "creator"}
DAILY_TASK_PREFIX = "daily_"
DAILY_CLAIM_SEPARATOR = ":"


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


def _is_daily_task(task_id: str) -> bool:
    return task_id.startswith(DAILY_TASK_PREFIX)


def _daily_claim_id(base_claim_id: str, day: date) -> str:
    return f"{base_claim_id}{DAILY_CLAIM_SEPARATOR}{day.isoformat()}"


def _parse_daily_claim_id(claim_id: str) -> tuple[str, date] | None:
    if DAILY_CLAIM_SEPARATOR not in claim_id:
        return None
    base, day_str = claim_id.rsplit(DAILY_CLAIM_SEPARATOR, 1)
    try:
        claim_day = date.fromisoformat(day_str)
    except ValueError:
        return None
    return base, claim_day


def _msk_day_bounds(day: date) -> tuple[datetime, datetime]:
    start_msk = datetime(day.year, day.month, day.day, tzinfo=MSK)
    start_utc = start_msk.astimezone(timezone.utc).replace(tzinfo=None)
    end_utc = (start_msk + timedelta(days=1)).astimezone(timezone.utc).replace(tzinfo=None)
    return start_utc, end_utc


async def _count_daily_levels_completed(db: AsyncSession, user_id: int, day: date) -> int:
    start_utc, end_utc = _msk_day_bounds(day)
    result = await db.execute(
        select(func.count(LevelAttempt.id)).where(
            LevelAttempt.user_id == user_id,
            LevelAttempt.result == "win",
            LevelAttempt.created_at >= start_utc,
            LevelAttempt.created_at < end_utc,
        )
    )
    return int(result.scalar_one())


def _get_progress(task_id: str, user: User, *, daily_levels_completed: int | None = None) -> int:
    if task_id == "arcade_levels":
        return max(0, user.current_level - 1)
    if task_id == "friends_confirmed":
        return max(0, user.referrals_count)
    if task_id == "official_channel":
        return 0
    if task_id == "daily_levels":
        return max(0, daily_levels_completed or 0)
    raise ValueError(f"Unknown task id: {task_id}")


def _resolve_tier(task_id: str, tier: dict[str, Any]) -> dict[str, Any]:
    if task_id == "official_channel":
        channel = get_official_channel_config()
        if not channel:
            return tier
        return {
            **tier,
            "reward_coins": channel["reward_coins"],
            "title": channel["title"],
        }
    if _is_daily_task(task_id):
        return {
            **tier,
            "claim_id": _daily_claim_id(tier["claim_id"], today_msk()),
        }
    return tier


def _build_task_dto(
    task: dict[str, Any],
    claimed_ids: set[str],
    user: User,
    *,
    daily_levels_completed: int | None,
) -> TaskDto:
    progress = _get_progress(task["id"], user, daily_levels_completed=daily_levels_completed)
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
    daily_levels_completed = None
    if any(_is_daily_task(task["id"]) for task in TASKS_CATALOG):
        daily_levels_completed = await _count_daily_levels_completed(db, user.id, today_msk())
    tasks = [
        _build_task_dto(task, claimed_ids, user, daily_levels_completed=daily_levels_completed)
        for task in TASKS_CATALOG
    ]
    return TasksResponse(tasks=tasks)


def _get_tier_by_claim_id(claim_id: str) -> tuple[dict[str, Any], dict[str, Any], date | None]:
    for task in TASKS_CATALOG:
        for tier in task["tiers"]:
            if tier["claim_id"] == claim_id:
                return task, tier, None
    parsed = _parse_daily_claim_id(claim_id)
    if parsed:
        base_claim_id, claim_day = parsed
        for task in TASKS_CATALOG:
            if not _is_daily_task(task["id"]):
                continue
            for tier in task["tiers"]:
                if tier["claim_id"] == base_claim_id:
                    return task, tier, claim_day
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
    task, tier, claim_day = _get_tier_by_claim_id(claim_id)
    tier = _resolve_tier(task["id"], tier)

    existing = await db.execute(
        select(TaskClaim).where(TaskClaim.user_id == user.id, TaskClaim.claim_id == claim_id)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail={"code": "TASK_ALREADY_CLAIMED", "message": "Task reward already claimed"},
        )

    if _is_daily_task(task["id"]):
        if claim_day is None:
            raise HTTPException(
                status_code=404,
                detail={"code": "TASK_NOT_FOUND", "message": "Task not found"},
            )
        if claim_day != today_msk():
            raise HTTPException(
                status_code=409,
                detail={"code": "TASK_EXPIRED", "message": "Daily task has already reset"},
            )
        progress = await _count_daily_levels_completed(db, user.id, claim_day)
    else:
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
