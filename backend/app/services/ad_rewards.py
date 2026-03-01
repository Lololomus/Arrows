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
REWARDED_PLACEMENTS = {
    PLACEMENT_DAILY_COINS,
    PLACEMENT_HINT,
    PLACEMENT_REVIVE,
}

INTENT_STATUS_PENDING = "pending"
INTENT_STATUS_GRANTED = "granted"
INTENT_STATUS_REJECTED = "rejected"
INTENT_STATUS_EXPIRED = "expired"

FAILURE_DAILY_LIMIT_REACHED = "DAILY_LIMIT_REACHED"
FAILURE_HINT_BALANCE_NOT_ZERO = "HINT_BALANCE_NOT_ZERO"
FAILURE_REVIVE_ALREADY_USED = "REVIVE_ALREADY_USED"
FAILURE_ADS_LOCKED = "ADS_LOCKED_BEFORE_LEVEL_21"
FAILURE_INTENT_EXPIRED = "INTENT_EXPIRED"
FAILURE_INTENT_ALREADY_PENDING = "REWARD_INTENT_ALREADY_PENDING"
FAILURE_INVALID_SIGNATURE = "INVALID_SIGNATURE"

MSK = timezone(timedelta(hours=3))


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def today_msk() -> date:
    return datetime.now(MSK).date()


def next_reset_datetime() -> datetime:
    tomorrow = today_msk() + timedelta(days=1)
    return datetime(tomorrow.year, tomorrow.month, tomorrow.day, tzinfo=MSK).replace(tzinfo=None)


def next_reset_iso() -> str:
    return next_reset_datetime().replace(tzinfo=MSK).isoformat()


def ensure_eligible(user: User) -> None:
    if user.current_level < settings.AD_FIRST_ELIGIBLE_LEVEL:
        raise HTTPException(status_code=409, detail={"error": FAILURE_ADS_LOCKED})


def is_expired(intent: AdRewardIntent) -> bool:
    return intent.status == INTENT_STATUS_PENDING and intent.expires_at <= utcnow()


def mark_expired(intent: AdRewardIntent) -> None:
    intent.status = INTENT_STATUS_EXPIRED
    intent.failure_code = FAILURE_INTENT_EXPIRED


async def count_daily_coins_used(db: AsyncSession, user_id: int) -> int:
    result = await db.execute(
        select(func.count(AdRewardClaim.id)).where(
            AdRewardClaim.user_id == user_id,
            AdRewardClaim.placement == PLACEMENT_DAILY_COINS,
            AdRewardClaim.claim_day_msk == today_msk(),
        )
    )
    return int(result.scalar_one())


def serialize_intent(intent: AdRewardIntent) -> RewardIntentStatusResponse:
    resets_at = intent.resets_at.replace(tzinfo=MSK).isoformat() if intent.resets_at else None
    return RewardIntentStatusResponse(
        intent_id=intent.intent_id,
        placement=intent.placement,
        status=intent.status,
        failure_code=intent.failure_code,
        coins=intent.coins,
        hint_balance=intent.hint_balance,
        revive_granted=bool(intent.revive_granted),
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
    ensure_eligible(user)
    await expire_stale_pending_intents(db, user.id, placement)

    active_intent = await get_active_pending_intent(db, user.id, placement)
    if active_intent is not None:
        if placement != PLACEMENT_REVIVE or active_intent.session_id == session_id:
            return active_intent
        raise HTTPException(status_code=409, detail={"error": FAILURE_INTENT_ALREADY_PENDING})

    if placement == PLACEMENT_DAILY_COINS:
        used_today = await count_daily_coins_used(db, user.id)
        if used_today >= settings.AD_DAILY_COINS_LIMIT:
            raise HTTPException(status_code=409, detail={"error": FAILURE_DAILY_LIMIT_REACHED})
    elif placement == PLACEMENT_HINT:
        if user.hint_balance != 0:
            raise HTTPException(status_code=409, detail={"error": FAILURE_HINT_BALANCE_NOT_ZERO})
    elif placement == PLACEMENT_REVIVE:
        if not session_id or level is None:
            raise HTTPException(status_code=422, detail={"error": "SESSION_AND_LEVEL_REQUIRED"})
        existing = await db.execute(
            select(AdRewardClaim.id).where(
                AdRewardClaim.user_id == user.id,
                AdRewardClaim.placement == PLACEMENT_REVIVE,
                AdRewardClaim.session_id == session_id,
            )
        )
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(status_code=409, detail={"error": FAILURE_REVIVE_ALREADY_USED})
    else:
        raise HTTPException(status_code=400, detail={"error": "UNKNOWN_PLACEMENT"})

    intent = AdRewardIntent(
        intent_id=uuid4().hex,
        user_id=user.id,
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


async def _grant_daily_coins(
    db: AsyncSession,
    user: User,
    intent: AdRewardIntent,
    *,
    ad_reference: str | None,
) -> AdRewardIntent:
    used_today = await count_daily_coins_used(db, user.id)
    if used_today >= settings.AD_DAILY_COINS_LIMIT:
        return await reject_intent(db, intent, FAILURE_DAILY_LIMIT_REACHED)

    reward = settings.AD_DAILY_COINS_REWARD
    user.coins += reward

    claim = AdRewardClaim(
        user_id=user.id,
        placement=PLACEMENT_DAILY_COINS,
        ad_reference=ad_reference,
        reward_amount=reward,
        claim_day_msk=today_msk(),
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
    intent.resets_at = next_reset_datetime()
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
        .where(User.id == user.id, User.hint_balance == 0)
        .values(hint_balance=User.hint_balance + 1)
        .returning(User.hint_balance)
    )
    row = result.first()
    if row is None:
        await db.rollback()
        return await reject_intent(db, intent, FAILURE_HINT_BALANCE_NOT_ZERO)

    new_balance = int(row[0])
    claim = AdRewardClaim(
        user_id=user.id,
        placement=PLACEMENT_HINT,
        ad_reference=ad_reference,
        reward_amount=1,
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


async def grant_intent(
    db: AsyncSession,
    user: User,
    intent: AdRewardIntent,
    *,
    ad_reference: str | None = None,
) -> AdRewardIntent:
    ensure_eligible(user)

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
