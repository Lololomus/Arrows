"""
Rewarded ads helpers for server-authoritative AdsGram flow.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import AdRewardClaim, AdRewardIntent, Transaction, User
from ..schemas import (
    RewardIntentCreateResponse,
    RewardIntentStatusResponse,
)

PLACEMENT_DAILY_COINS = "reward_daily_coins"
PLACEMENT_HINT = "reward_hint"
PLACEMENT_REVIVE = "reward_revive"
PLACEMENT_SPIN_RETRY = "reward_spin_retry"
PLACEMENT_TASK = "reward_task"
REWARDED_PLACEMENTS = {
    PLACEMENT_DAILY_COINS,
    PLACEMENT_HINT,
    PLACEMENT_REVIVE,
    PLACEMENT_SPIN_RETRY,
    PLACEMENT_TASK,
}

INTENT_STATUS_PENDING = "pending"
INTENT_STATUS_GRANTED = "granted"
INTENT_STATUS_REJECTED = "rejected"
INTENT_STATUS_EXPIRED = "expired"

FAILURE_DAILY_LIMIT_REACHED = "DAILY_LIMIT_REACHED"
FAILURE_HINT_BALANCE_NOT_ZERO = "HINT_BALANCE_NOT_ZERO"
FAILURE_REVIVE_ALREADY_USED = "REVIVE_ALREADY_USED"
FAILURE_REVIVE_LIMIT_REACHED = "REVIVE_LIMIT_REACHED"
FAILURE_ADS_LOCKED = "ADS_LOCKED_BEFORE_LEVEL_21"
FAILURE_INTENT_EXPIRED = "INTENT_EXPIRED"
FAILURE_INTENT_ALREADY_PENDING = "REWARD_INTENT_ALREADY_PENDING"
FAILURE_INTENT_SUPERSEDED = "INTENT_SUPERSEDED"
FAILURE_INVALID_SIGNATURE = "INVALID_SIGNATURE"
FAILURE_AD_NOT_COMPLETED = "AD_NOT_COMPLETED"
FAILURE_SPIN_RETRY_NOT_AVAILABLE = "SPIN_RETRY_NOT_AVAILABLE"
FAILURE_SPIN_RETRY_ALREADY_GRANTED = "SPIN_RETRY_ALREADY_GRANTED"

TASK_COINS_REWARD = 50

MSK = timezone(timedelta(hours=3))
REVIVE_LIMIT_PER_LEVEL = 3
DAILY_COINS_WINDOW = timedelta(hours=24)
SPIN_COOLDOWN = timedelta(hours=24)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def today_msk() -> date:
    return datetime.now(MSK).date()


def next_reset_datetime() -> datetime:
    """Next midnight MSK as naive UTC datetime (for consistent DB storage)."""
    tomorrow = today_msk() + timedelta(days=1)
    msk_midnight = datetime(tomorrow.year, tomorrow.month, tomorrow.day, tzinfo=MSK)
    return msk_midnight.astimezone(timezone.utc).replace(tzinfo=None)


def next_reset_iso() -> str:
    tomorrow = today_msk() + timedelta(days=1)
    msk_midnight = datetime(tomorrow.year, tomorrow.month, tomorrow.day, tzinfo=MSK)
    return msk_midnight.isoformat()


def ensure_eligible(user: User) -> None:
    if user.current_level < settings.AD_FIRST_ELIGIBLE_LEVEL:
        raise HTTPException(status_code=409, detail={"error": FAILURE_ADS_LOCKED})


def ensure_eligible_for_placement(user: User, placement: str) -> None:
    if placement in {PLACEMENT_SPIN_RETRY, PLACEMENT_TASK}:
        return
    ensure_eligible(user)


def is_expired(intent: AdRewardIntent) -> bool:
    return intent.status == INTENT_STATUS_PENDING and intent.expires_at <= utcnow()


def mark_expired(intent: AdRewardIntent) -> None:
    intent.status = INTENT_STATUS_EXPIRED
    intent.failure_code = FAILURE_INTENT_EXPIRED


async def count_daily_coins_used(db: AsyncSession, user_id: int) -> int:
    status = await get_daily_coins_status(db, user_id)
    return status["used"]


def _fallback_last_spin_at(user: User) -> datetime | None:
    if user.last_spin_at is not None:
        return user.last_spin_at
    if user.last_spin_date is not None:
        return datetime(
            user.last_spin_date.year,
            user.last_spin_date.month,
            user.last_spin_date.day,
        )
    return None


def _is_spin_retry_used_for_current_spin(user: User, last_spin_at: datetime) -> bool:
    if user.spin_retry_used_at is not None and user.spin_retry_used_at >= last_spin_at:
        return True
    # Backward-compat fallback for older rows that only had Date fields.
    if user.spin_retry_used_date is not None and user.last_spin_date is not None:
        return user.spin_retry_used_date >= user.last_spin_date
    return False


async def get_daily_coins_status(db: AsyncSession, user_id: int) -> dict[str, int | datetime | None]:
    now = utcnow()
    lookback_from = now - timedelta(hours=48)

    result = await db.execute(
        select(AdRewardClaim.created_at)
        .where(
            AdRewardClaim.user_id == user_id,
            AdRewardClaim.placement == PLACEMENT_DAILY_COINS,
            AdRewardClaim.created_at >= lookback_from,
        )
        .order_by(AdRewardClaim.created_at.asc(), AdRewardClaim.id.asc())
    )

    claim_times = [created_at for created_at in result.scalars().all() if created_at is not None]

    window_start: datetime | None = None
    used_in_window = 0
    for claim_time in claim_times:
        if window_start is None or claim_time >= window_start + DAILY_COINS_WINDOW:
            window_start = claim_time
            used_in_window = 1
        else:
            used_in_window += 1

    resets_at: datetime | None = None
    if window_start is not None:
        candidate = window_start + DAILY_COINS_WINDOW
        if now < candidate:
            resets_at = candidate
        else:
            window_start = None
            used_in_window = 0

    return {
        "used": min(used_in_window, settings.AD_DAILY_COINS_LIMIT),
        "limit": settings.AD_DAILY_COINS_LIMIT,
        "window_start": window_start,
        "resets_at": resets_at,
    }


async def count_revives_used_for_level(db: AsyncSession, user_id: int, level: int) -> int:
    result = await db.execute(
        select(func.count(AdRewardClaim.id)).where(
            AdRewardClaim.user_id == user_id,
            AdRewardClaim.placement == PLACEMENT_REVIVE,
            AdRewardClaim.level_number == level,
        )
    )
    return int(result.scalar_one())


async def count_spin_retry_used_today(db: AsyncSession, user_id: int) -> int:
    result = await db.execute(
        select(func.count(AdRewardClaim.id)).where(
            AdRewardClaim.user_id == user_id,
            AdRewardClaim.placement == PLACEMENT_SPIN_RETRY,
            AdRewardClaim.claim_day_msk == today_msk(),
        )
    )
    return int(result.scalar_one())


async def count_task_revive_used_today(db: AsyncSession, user_id: int) -> int:
    result = await db.execute(
        select(func.count(AdRewardClaim.id)).where(
            AdRewardClaim.user_id == user_id,
            AdRewardClaim.placement == PLACEMENT_TASK,
            AdRewardClaim.claim_day_msk == today_msk(),
        )
    )
    return int(result.scalar_one())


def serialize_intent(
    intent: AdRewardIntent,
    *,
    revives_used: int | None = None,
    revives_limit: int | None = None,
) -> RewardIntentStatusResponse:
    resets_at = intent.resets_at.replace(tzinfo=timezone.utc).isoformat() if intent.resets_at else None
    expires_at = intent.expires_at.replace(tzinfo=timezone.utc).isoformat() if intent.expires_at else None
    created_at = intent.created_at.replace(tzinfo=timezone.utc).isoformat() if intent.created_at else None
    return RewardIntentStatusResponse(
        intent_id=intent.intent_id,
        placement=intent.placement,
        status=intent.status,
        failure_code=intent.failure_code,
        expires_at=expires_at,
        created_at=created_at,
        level=intent.level_number,
        session_id=intent.session_id,
        coins=intent.coins,
        hint_balance=intent.hint_balance,
        revive_granted=bool(intent.revive_granted),
        revives_used=revives_used,
        revives_limit=revives_limit,
        used_today=intent.used_today,
        limit_today=intent.limit_today,
        resets_at=resets_at,
    )


def serialize_create_intent(intent: AdRewardIntent) -> RewardIntentCreateResponse:
    return RewardIntentCreateResponse(
        intent_id=intent.intent_id,
        placement=intent.placement,
        status=intent.status,
        expires_at=intent.expires_at.replace(tzinfo=timezone.utc).isoformat(),
    )


async def expire_stale_pending_intents(
    db: AsyncSession,
    user_id: int,
    placement: str,
    *,
    auto_commit: bool = True,
) -> None:
    result = await db.execute(
        select(AdRewardIntent).where(
            AdRewardIntent.user_id == user_id,
            AdRewardIntent.placement == placement,
            AdRewardIntent.status == INTENT_STATUS_PENDING,
            AdRewardIntent.expires_at <= utcnow(),
        )
    )
    stale = list(result.scalars())
    if not stale:
        return
    for intent in stale:
        mark_expired(intent)
    if auto_commit:
        await db.commit()


async def get_active_pending_intent(
    db: AsyncSession,
    user_id: int,
    placement: str,
) -> AdRewardIntent | None:
    result = await db.execute(
        select(AdRewardIntent)
        .where(
            AdRewardIntent.user_id == user_id,
            AdRewardIntent.placement == placement,
            AdRewardIntent.status == INTENT_STATUS_PENDING,
            AdRewardIntent.expires_at > utcnow(),
        )
        .order_by(AdRewardIntent.created_at.asc(), AdRewardIntent.id.asc())
    )
    return result.scalars().first()


async def list_active_pending_intents(
    db: AsyncSession,
    user_id: int,
) -> list[AdRewardIntent]:
    result = await db.execute(
        select(AdRewardIntent)
        .where(
            AdRewardIntent.user_id == user_id,
            AdRewardIntent.status == INTENT_STATUS_PENDING,
            AdRewardIntent.expires_at > utcnow(),
        )
        .order_by(AdRewardIntent.created_at.asc(), AdRewardIntent.id.asc())
    )
    return list(result.scalars())


async def get_intent_by_public_id(
    db: AsyncSession,
    user_id: int,
    intent_id: str,
) -> AdRewardIntent | None:
    result = await db.execute(
        select(AdRewardIntent).where(
            AdRewardIntent.user_id == user_id,
            AdRewardIntent.intent_id == intent_id,
        )
    )
    return result.scalars().first()


async def create_reward_intent(
    db: AsyncSession,
    user: User,
    placement: str,
    *,
    level: int | None = None,
    session_id: str | None = None,
) -> AdRewardIntent:
    locked_user_result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    locked_user = locked_user_result.scalar_one()

    ensure_eligible_for_placement(locked_user, placement)
    await expire_stale_pending_intents(db, locked_user.id, placement, auto_commit=False)
    if placement == PLACEMENT_DAILY_COINS:
        daily_status = await get_daily_coins_status(db, locked_user.id)
        if int(daily_status["used"]) >= settings.AD_DAILY_COINS_LIMIT:
            raise HTTPException(status_code=409, detail={"error": FAILURE_DAILY_LIMIT_REACHED})
    elif placement == PLACEMENT_HINT:
        if locked_user.hint_balance != 0:
            raise HTTPException(status_code=409, detail={"error": FAILURE_HINT_BALANCE_NOT_ZERO})
    elif placement == PLACEMENT_REVIVE:
        if not session_id or level is None:
            raise HTTPException(status_code=422, detail={"error": "SESSION_AND_LEVEL_REQUIRED"})
        existing = await db.execute(
            select(AdRewardClaim.id).where(
                AdRewardClaim.user_id == locked_user.id,
                AdRewardClaim.placement == PLACEMENT_REVIVE,
                AdRewardClaim.session_id == session_id,
            )
        )
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(status_code=409, detail={"error": FAILURE_REVIVE_ALREADY_USED})
        used_for_level = await count_revives_used_for_level(db, locked_user.id, level)
        if used_for_level >= REVIVE_LIMIT_PER_LEVEL:
            raise HTTPException(status_code=409, detail={"error": FAILURE_REVIVE_LIMIT_REACHED})
    elif placement == PLACEMENT_SPIN_RETRY:
        if locked_user.pending_spin_prize_type is None:
            raise HTTPException(status_code=409, detail={"error": FAILURE_SPIN_RETRY_NOT_AVAILABLE})
        last_spin_at = _fallback_last_spin_at(locked_user)
        if last_spin_at is None:
            raise HTTPException(status_code=409, detail={"error": FAILURE_SPIN_RETRY_NOT_AVAILABLE})
        if _is_spin_retry_used_for_current_spin(locked_user, last_spin_at):
            raise HTTPException(status_code=409, detail={"error": FAILURE_SPIN_RETRY_ALREADY_GRANTED})
    elif placement == PLACEMENT_TASK:
        used = await count_task_revive_used_today(db, locked_user.id)
        if used >= 1:
            raise HTTPException(status_code=409, detail={"error": FAILURE_DAILY_LIMIT_REACHED})
    else:
        raise HTTPException(status_code=400, detail={"error": "UNKNOWN_PLACEMENT"})

    active_intent = await get_active_pending_intent(db, locked_user.id, placement)
    if active_intent is not None:
        return active_intent

    intent = AdRewardIntent(
        intent_id=uuid4().hex,
        user_id=locked_user.id,
        placement=placement,
        status=INTENT_STATUS_PENDING,
        session_id=session_id,
        level_number=level,
        expires_at=utcnow() + timedelta(seconds=settings.AD_REWARD_INTENT_TTL_SECONDS),
    )
    db.add(intent)
    await db.commit()
    await db.refresh(intent)
    return intent


async def reject_intent(
    db: AsyncSession,
    intent: AdRewardIntent,
    failure_code: str,
) -> AdRewardIntent:
    intent.status = INTENT_STATUS_REJECTED
    intent.failure_code = failure_code
    intent.fulfilled_at = utcnow()
    await db.commit()
    await db.refresh(intent)
    return intent


async def cancel_pending_intent(
    db: AsyncSession,
    user_id: int,
    intent_id: str,
    failure_code: str = FAILURE_AD_NOT_COMPLETED,
) -> AdRewardIntent | None:
    intent = await get_intent_by_public_id(db, user_id, intent_id)
    if intent is None:
        return None
    if intent.status != INTENT_STATUS_PENDING:
        return intent
    return await reject_intent(db, intent, failure_code)


async def _grant_daily_coins(
    db: AsyncSession,
    user: User,
    intent: AdRewardIntent,
    *,
    ad_reference: str | None,
) -> AdRewardIntent:
    daily_status = await get_daily_coins_status(db, user.id)
    used_today = int(daily_status["used"])
    if used_today >= settings.AD_DAILY_COINS_LIMIT:
        raise HTTPException(status_code=409, detail={"error": FAILURE_DAILY_LIMIT_REACHED})

    reward = settings.AD_DAILY_COINS_REWARD
    user.coins += reward
    now = utcnow()
    window_start = daily_status["window_start"] if isinstance(daily_status["window_start"], datetime) else None
    if window_start is None:
        window_start = now
    resets_at = window_start + DAILY_COINS_WINDOW

    claim = AdRewardClaim(
        user_id=user.id,
        placement=PLACEMENT_DAILY_COINS,
        ad_reference=ad_reference,
        reward_amount=reward,
        claim_day_msk=today_msk(),
        created_at=now,
    )
    tx = Transaction(
        user_id=user.id,
        type="ad_reward",
        currency="coins",
        amount=reward,
        item_type="ad",
        item_id="daily_coins",
        status="completed",
    )
    db.add(claim)
    db.add(tx)

    intent.status = INTENT_STATUS_GRANTED
    intent.failure_code = None
    intent.fulfilled_at = utcnow()
    intent.coins = user.coins
    intent.used_today = used_today + 1
    intent.limit_today = settings.AD_DAILY_COINS_LIMIT
    intent.resets_at = resets_at
    intent.claim_day_msk = today_msk()

    await db.commit()
    await db.refresh(intent)
    return intent


async def _grant_hint(
    db: AsyncSession,
    user: User,
    intent: AdRewardIntent,
    *,
    ad_reference: str | None,
) -> AdRewardIntent:
    result = await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(hint_balance=User.hint_balance + settings.AD_HINT_REWARD)
        .returning(User.hint_balance)
    )
    row = result.first()

    new_balance = int(row[0])
    claim = AdRewardClaim(
        user_id=user.id,
        placement=PLACEMENT_HINT,
        ad_reference=ad_reference,
        reward_amount=settings.AD_HINT_REWARD,
    )
    db.add(claim)

    intent.status = INTENT_STATUS_GRANTED
    intent.failure_code = None
    intent.fulfilled_at = utcnow()
    intent.hint_balance = new_balance
    user.hint_balance = new_balance

    await db.commit()
    await db.refresh(intent)
    return intent


async def _grant_revive(
    db: AsyncSession,
    user: User,
    intent: AdRewardIntent,
    *,
    ad_reference: str | None,
) -> AdRewardIntent:
    if intent.level_number is None:
        return await reject_intent(db, intent, "SESSION_AND_LEVEL_REQUIRED")

    claim = AdRewardClaim(
        user_id=user.id,
        placement=PLACEMENT_REVIVE,
        ad_reference=ad_reference,
        session_id=intent.session_id,
        level_number=intent.level_number,
        reward_amount=1,
    )
    db.add(claim)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return await reject_intent(db, intent, FAILURE_REVIVE_ALREADY_USED)

    intent.status = INTENT_STATUS_GRANTED
    intent.failure_code = None
    intent.fulfilled_at = utcnow()
    intent.revive_granted = True

    await db.commit()
    await db.refresh(intent)
    return intent


async def _grant_task_revive(
    db: AsyncSession,
    user: User,
    intent: AdRewardIntent,
    *,
    ad_reference: str | None,
) -> AdRewardIntent:
    now = utcnow()
    used = await count_task_revive_used_today(db, user.id)
    if used >= 1:
        return await reject_intent(db, intent, FAILURE_DAILY_LIMIT_REACHED)

    result = await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(
            revive_balance=User.revive_balance + 1,
            coins=User.coins + TASK_COINS_REWARD,
        )
        .returning(User.revive_balance, User.coins)
    )
    row = result.first()
    new_revive_balance = int(row[0]) if row else (user.revive_balance + 1)
    new_coins = int(row[1]) if row else (user.coins + TASK_COINS_REWARD)
    user.revive_balance = new_revive_balance
    user.coins = new_coins

    claim = AdRewardClaim(
        user_id=user.id,
        placement=PLACEMENT_TASK,
        ad_reference=ad_reference,
        reward_amount=1,
        claim_day_msk=today_msk(),
        created_at=now,
    )
    db.add(claim)

    resets_at = next_reset_datetime()
    intent.status = INTENT_STATUS_GRANTED
    intent.failure_code = None
    intent.fulfilled_at = now
    intent.revive_granted = True
    intent.coins = new_coins
    intent.used_today = 1
    intent.limit_today = 1
    intent.resets_at = resets_at
    intent.claim_day_msk = today_msk()

    await db.commit()
    await db.refresh(intent)
    return intent


async def _grant_spin_retry(
    db: AsyncSession,
    user: User,
    intent: AdRewardIntent,
    *,
    ad_reference: str | None,
) -> AdRewardIntent:
    now = utcnow()
    last_spin_at = _fallback_last_spin_at(user)
    claim = AdRewardClaim(
        user_id=user.id,
        placement=PLACEMENT_SPIN_RETRY,
        ad_reference=ad_reference,
        reward_amount=1,
        claim_day_msk=today_msk(),
        created_at=now,
    )
    db.add(claim)

    intent.status = INTENT_STATUS_GRANTED
    intent.failure_code = None
    intent.fulfilled_at = utcnow()
    intent.used_today = 1
    intent.limit_today = 1
    intent.resets_at = (last_spin_at + SPIN_COOLDOWN) if last_spin_at is not None else None
    intent.claim_day_msk = today_msk()

    await db.commit()
    await db.refresh(intent)
    return intent


async def grant_intent(
    db: AsyncSession,
    user: User,
    intent: AdRewardIntent,
    *,
    ad_reference: str | None = None,
) -> AdRewardIntent:
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())

    if is_expired(intent):
        mark_expired(intent)
        await db.commit()
        await db.refresh(intent)
        return intent

    if intent.status == INTENT_STATUS_GRANTED:
        return intent
    if intent.status in {INTENT_STATUS_REJECTED, INTENT_STATUS_EXPIRED}:
        return intent

    if intent.placement == PLACEMENT_DAILY_COINS:
        return await _grant_daily_coins(db, user, intent, ad_reference=ad_reference)
    if intent.placement == PLACEMENT_HINT:
        return await _grant_hint(db, user, intent, ad_reference=ad_reference)
    if intent.placement == PLACEMENT_REVIVE:
        return await _grant_revive(db, user, intent, ad_reference=ad_reference)
    if intent.placement == PLACEMENT_SPIN_RETRY:
        return await _grant_spin_retry(db, user, intent, ad_reference=ad_reference)
    if intent.placement == PLACEMENT_TASK:
        return await _grant_task_revive(db, user, intent, ad_reference=ad_reference)
    return await reject_intent(db, intent, "UNKNOWN_PLACEMENT")


async def find_pending_intent_for_callback(
    db: AsyncSession,
    user_id: int,
    placement: str,
) -> AdRewardIntent | None:
    await expire_stale_pending_intents(db, user_id, placement)
    result = await db.execute(
        select(AdRewardIntent)
        .where(
            AdRewardIntent.user_id == user_id,
            AdRewardIntent.placement == placement,
            AdRewardIntent.status == INTENT_STATUS_PENDING,
            AdRewardIntent.expires_at > utcnow(),
        )
        .order_by(AdRewardIntent.created_at.asc(), AdRewardIntent.id.asc())
    )
    return result.scalars().first()


async def get_revive_limit_status(
    db: AsyncSession,
    user_id: int,
    level: int,
) -> dict[str, int]:
    used = await count_revives_used_for_level(db, user_id, level)
    remaining = max(0, REVIVE_LIMIT_PER_LEVEL - used)
    return {
        "used": used,
        "limit": REVIVE_LIMIT_PER_LEVEL,
        "remaining": remaining,
    }


def extract_callback_value(
    query_params: dict[str, Any],
    body: dict[str, Any],
    *keys: str,
) -> Any:
    for key in keys:
        if key in query_params and query_params[key] not in (None, ""):
            return query_params[key]
        if key in body and body[key] not in (None, ""):
            return body[key]
    return None
