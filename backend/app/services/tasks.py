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
from ..models import ChannelSubscription, LevelAttempt, Referral, TaskClaim, Transaction, User
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
CHANNEL_TASK_IDS = frozenset({"official_channel", "partner_channel"})
CHANNEL_TASK_SETTINGS = {
    "official_channel": {
        "channel_id_attr": "OFFICIAL_CHANNEL_ID",
        "channel_username_attr": "OFFICIAL_CHANNEL_USERNAME",
        "channel_url_attr": "OFFICIAL_CHANNEL_URL",
        "channel_name_attr": "OFFICIAL_CHANNEL_NAME",
        "channel_reward_attr": "OFFICIAL_CHANNEL_REWARD",
        "claim_id": "official_channel_subscribe",
        "missing_message": "Official channel is not configured",
    },
    "partner_channel": {
        "channel_id_attr": "PARTNER_CHANNEL_ID",
        "channel_username_attr": "PARTNER_CHANNEL_USERNAME",
        "channel_url_attr": "PARTNER_CHANNEL_URL",
        "channel_name_attr": "PARTNER_CHANNEL_NAME",
        "channel_reward_attr": "PARTNER_CHANNEL_REWARD",
        "claim_id": "partner_channel_subscribe",
        "missing_message": "Partner channel is not configured",
    },
}
TASK_DEBUG_KEYS = frozenset({"arcade_levels", "daily_levels", "friends_confirmed", *CHANNEL_TASK_IDS})
TASK_DEBUG_STATE: dict[int, dict[str, Any]] = {}


def _coerce_debug_state(raw: dict[str, Any] | None) -> dict[str, Any]:
    state = raw or {}
    coerced: dict[str, Any] = {}
    if "arcade_levels" in state:
        coerced["arcade_levels"] = max(0, int(state["arcade_levels"]))
    if "daily_levels" in state:
        coerced["daily_levels"] = max(0, int(state["daily_levels"]))
    if "friends_confirmed" in state:
        coerced["friends_confirmed"] = max(0, int(state["friends_confirmed"]))
    for task_id in CHANNEL_TASK_IDS:
        if task_id in state:
            coerced[task_id] = bool(state[task_id])
    return coerced


async def get_task_debug_state(user_id: int) -> dict[str, Any]:
    if settings.ENVIRONMENT != "development":
        return {}
    return _coerce_debug_state(TASK_DEBUG_STATE.get(user_id))


async def set_task_debug_state(user_id: int, updates: dict[str, Any]) -> dict[str, Any]:
    if settings.ENVIRONMENT != "development":
        raise HTTPException(status_code=403, detail="Dev endpoints are disabled")

    current = await get_task_debug_state(user_id)
    next_state = {**current}
    for key, value in updates.items():
        if key not in TASK_DEBUG_KEYS:
            continue
        next_state[key] = value

    normalized = _coerce_debug_state(next_state)
    TASK_DEBUG_STATE[user_id] = normalized
    return normalized


async def clear_task_debug_state(user_id: int) -> None:
    if settings.ENVIRONMENT != "development":
        return
    TASK_DEBUG_STATE.pop(user_id, None)


def _get_catalog_task(task_id: str) -> dict[str, Any] | None:
    return next((task for task in TASKS_CATALOG if task["id"] == task_id), None)


def get_channel_task_config(task_id: str) -> dict[str, Any] | None:
    config = CHANNEL_TASK_SETTINGS.get(task_id)
    if not config:
        return None

    channel_id = str(getattr(settings, config["channel_id_attr"], "")).strip()
    if not channel_id:
        return None

    username_raw = str(getattr(settings, config["channel_username_attr"], "")).strip()
    username = username_raw.lstrip("@") or None
    url = str(getattr(settings, config["channel_url_attr"], "")).strip() or None
    if not url and username:
        url = f"https://t.me/{username}"

    task = _get_catalog_task(task_id)
    title = task["tiers"][0]["title"] if task and task.get("tiers") else ""

    return {
        "task_id": task_id,
        "channel_id": channel_id,
        "name": str(getattr(settings, config["channel_name_attr"])),
        "username": username,
        "url": url,
        "reward_coins": int(getattr(settings, config["channel_reward_attr"])),
        "claim_id": config["claim_id"],
        "title": title,
        "missing_message": config["missing_message"],
    }


def get_official_channel_config() -> dict[str, Any] | None:
    return get_channel_task_config("official_channel")


def get_configured_channel_task_configs() -> list[dict[str, Any]]:
    configs: list[dict[str, Any]] = []
    for task in TASKS_CATALOG:
        if task["id"] not in CHANNEL_TASK_IDS:
            continue
        channel = get_channel_task_config(task["id"])
        if channel:
            configs.append(channel)
    return configs


def get_channel_task_config_by_channel_id(channel_id: str) -> dict[str, Any] | None:
    needle = channel_id.strip()
    return next((channel for channel in get_configured_channel_task_configs() if channel["channel_id"] == needle), None)


def _build_channel_meta(task_id: str) -> ChannelMetaDto | None:
    channel = get_channel_task_config(task_id)
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


def _season_start_dt() -> datetime:
    try:
        return datetime.fromisoformat(settings.SEASON_START_DATE).replace(tzinfo=None)
    except ValueError:
        return datetime(2020, 1, 1)


async def _count_season_referrals(db: AsyncSession, user_id: int) -> int:
    season_start = _season_start_dt()
    result = await db.execute(
        select(func.count(Referral.id)).where(
            Referral.inviter_id == user_id,
            Referral.status == "confirmed",
            Referral.confirmed_at >= season_start,
        )
    )
    return int(result.scalar_one())


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


def _get_progress(
    task_id: str,
    user: User,
    *,
    daily_levels_completed: int | None = None,
    season_referrals_count: int | None = None,
    debug_state: dict[str, Any] | None = None,
) -> int:
    overrides = debug_state or {}
    if task_id in overrides:
        override = overrides[task_id]
        if task_id in CHANNEL_TASK_IDS:
            return 1 if bool(override) else 0
        return max(0, int(override))

    if task_id == "arcade_levels":
        return max(0, user.current_level - 1)
    if task_id == "friends_confirmed":
        return max(0, season_referrals_count if season_referrals_count is not None else user.referrals_count)
    if task_id in CHANNEL_TASK_IDS:
        return 0
    if task_id == "daily_levels":
        return max(0, daily_levels_completed or 0)
    raise ValueError(f"Unknown task id: {task_id}")


def _resolve_tier(task_id: str, tier: dict[str, Any]) -> dict[str, Any]:
    if task_id in CHANNEL_TASK_IDS:
        channel = get_channel_task_config(task_id)
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
    season_referrals_count: int | None = None,
    debug_state: dict[str, Any] | None = None,
) -> TaskDto:
    progress = _get_progress(
        task["id"],
        user,
        daily_levels_completed=daily_levels_completed,
        season_referrals_count=season_referrals_count,
        debug_state=debug_state,
    )
    tiers = [
        TaskTierDto(
            claim_id=resolved_tier["claim_id"],
            target=resolved_tier["target"],
            reward_coins=resolved_tier["reward_coins"],
            reward_hints=resolved_tier.get("reward_hints", 0),
            reward_revives=resolved_tier.get("reward_revives", 0),
            title=resolved_tier["title"],
            claimed=resolved_tier["claim_id"] in claimed_ids,
        )
        for tier in task["tiers"]
        for resolved_tier in [_resolve_tier(task["id"], tier)]
    ]

    next_tier_index = next((idx for idx, tier in enumerate(tiers) if not tier.claimed), None)

    if next_tier_index is None:
        status = "completed"
    elif task["id"] in CHANNEL_TASK_IDS:
        next_tier = tiers[next_tier_index]
        status = "claimable" if progress >= next_tier.target else "action_required"
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
        channel=_build_channel_meta(task["id"]) if task["id"] in CHANNEL_TASK_IDS else None,
    )


async def build_tasks_for_user(
    user: User,
    db: AsyncSession,
    *,
    debug_state: dict[str, Any] | None = None,
) -> TasksResponse:
    result = await db.execute(select(TaskClaim.claim_id).where(TaskClaim.user_id == user.id))
    claimed_ids = set(result.scalars().all())
    daily_levels_completed = None
    if any(_is_daily_task(task["id"]) for task in TASKS_CATALOG):
        daily_levels_completed = await _count_daily_levels_completed(db, user.id, today_msk())
    season_referrals_count = None
    if any(task["id"] == "friends_confirmed" for task in TASKS_CATALOG):
        season_referrals_count = await _count_season_referrals(db, user.id)
    tasks = [
        _build_task_dto(
            task,
            claimed_ids,
            user,
            daily_levels_completed=daily_levels_completed,
            season_referrals_count=season_referrals_count,
            debug_state=debug_state,
        )
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


async def verify_channel_subscription(user: User, task_id: str) -> dict[str, Any]:
    channel = get_channel_task_config(task_id)
    if not channel:
        raise HTTPException(
            status_code=503,
            detail={"code": "CHANNEL_CONFIG_MISSING", "message": CHANNEL_TASK_SETTINGS[task_id]["missing_message"]},
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


async def claim_task(
    user: User,
    claim_id: str,
    db: AsyncSession,
    *,
    debug_state: dict[str, Any] | None = None,
) -> TaskClaimResponse:
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
        if debug_state and task["id"] in debug_state:
            progress = _get_progress(task["id"], user, daily_levels_completed=progress, debug_state=debug_state)
    else:
        season_referrals_count = None
        if task["id"] == "friends_confirmed":
            season_referrals_count = await _count_season_referrals(db, user.id)
        progress = _get_progress(task["id"], user, season_referrals_count=season_referrals_count, debug_state=debug_state)

    if task["id"] in CHANNEL_TASK_IDS:
        if progress >= tier["target"]:
            channel = get_channel_task_config(task["id"])
            if channel:
                await _ensure_channel_subscription(user, db, channel)
        else:
            channel = await verify_channel_subscription(user, task["id"])
            await _ensure_channel_subscription(user, db, channel)
    elif progress < tier["target"]:
        raise HTTPException(
            status_code=409,
            detail={"code": "TASK_NOT_READY", "message": "Task requirements are not met yet"},
        )

    reward_coins = int(tier.get("reward_coins", 0))
    reward_hints = int(tier.get("reward_hints", 0))
    reward_revives = int(tier.get("reward_revives", 0))

    user.coins += reward_coins
    user.hint_balance += reward_hints
    user.revive_balance += reward_revives

    db.add(
        TaskClaim(
            user_id=user.id,
            claim_id=claim_id,
            task_group=task["id"],
            reward_coins=reward_coins,
        )
    )
    db.add(
        Transaction(
            user_id=user.id,
            type="task",
            currency="coins",
            amount=Decimal(reward_coins),
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

    tasks = await build_tasks_for_user(user, db, debug_state=debug_state)
    updated_task = next(item for item in tasks.tasks if item.id == task["id"])

    return TaskClaimResponse(
        success=True,
        claim_id=claim_id,
        coins=user.coins,
        reward_coins=reward_coins,
        reward_hints=reward_hints,
        reward_revives=reward_revives,
        hint_balance=user.hint_balance,
        revive_balance=user.revive_balance,
        task_id=task["id"],
        task_status=updated_task.status,
        next_tier_index=updated_task.next_tier_index,
    )
