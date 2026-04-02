"""
Arrow Puzzle - Daily Spin API

Daily wheel with one roll per 24 hours (personal cooldown) and one ad-based retry per roll.
Prize is granted only after explicit /collect.
"""

import random
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models import AdRewardClaim, Transaction, User
from ..services.ad_rewards import PLACEMENT_SPIN_RETRY, today_msk, utcnow
from .error_utils import api_error
from .auth import get_current_user


router = APIRouter(prefix="/spin", tags=["spin"])

SPIN_COOLDOWN = timedelta(hours=24)
SPIN_STREAK_WINDOW = timedelta(hours=48)
STREAK_RESTORE_WINDOW = timedelta(hours=48)
STREAK_RESTORE_COST_COINS = 500
STREAK_RESTORE_MIN_STREAK = 7


def _spin_today() -> date:
    return today_msk()


def _spin_now() -> datetime:
    return utcnow()


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


def _is_retry_used_for_current_spin(user: User, last_spin_at: datetime) -> bool:
    if user.spin_retry_used_at is not None and user.spin_retry_used_at >= last_spin_at:
        return True
    # Backward-compat fallback for rows created before spin_retry_used_at existed.
    if user.spin_retry_used_date is not None and user.last_spin_date is not None:
        return user.spin_retry_used_date >= user.last_spin_date
    return False


def _to_iso_utc(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat()


def _get_streak_restore_info(user: User, now: datetime) -> tuple[datetime | None, int]:
    last_spin_at = _fallback_last_spin_at(user)
    lost_count = int(user.login_streak or 0)
    if last_spin_at is None or lost_count <= 0:
        return None, 0

    lost_at = last_spin_at + SPIN_STREAK_WINDOW
    restore_expires_at = lost_at + STREAK_RESTORE_WINDOW
    if now < lost_at or now >= restore_expires_at:
        return None, 0

    return lost_at, lost_count


def _is_streak_restore_blocking(user: User, now: datetime) -> bool:
    _lost_at, lost_count = _get_streak_restore_info(user, now)
    return lost_count >= STREAK_RESTORE_MIN_STREAK


async def _auto_collect_pending(locked_user: User, db: AsyncSession) -> None:
    """Зачислить pending приз спина (строка уже залочена)."""
    if locked_user.pending_spin_prize_type is None:
        return
    prize_type = locked_user.pending_spin_prize_type
    prize_amount = locked_user.pending_spin_prize_amount or 0
    if prize_type == "coins":
        locked_user.coins = (locked_user.coins or 0) + prize_amount
    elif prize_type == "hints":
        locked_user.hint_balance = (locked_user.hint_balance or 0) + prize_amount
    elif prize_type == "revive":
        locked_user.revive_balance = (locked_user.revive_balance or 0) + prize_amount
    tx = Transaction(
        user_id=locked_user.id,
        type="reward",
        currency=prize_type if prize_type == "coins" else "item",
        amount=prize_amount,
        item_type="spin",
        item_id=f"daily_spin_{prize_type}",
        status="completed",
    )
    db.add(tx)
    locked_user.pending_spin_prize_type = None
    locked_user.pending_spin_prize_amount = None


# ============================================
# PRIZES
# ============================================

# Tiers by streak: [0-5 days, 6-13 days, 14+ days]
PRIZE_TABLE = [
    # (prize_type, prize_amount, [tier0_weight, tier1_weight, tier2_weight])
    ("coins", 10, [350, 150, 50]),
    ("coins", 25, [250, 200, 100]),
    ("coins", 50, [150, 200, 150]),
    ("hints", 1, [100, 150, 150]),
    ("revive", 1, [80, 150, 200]),
    ("coins", 100, [50, 100, 150]),
    ("hints", 3, [15, 40, 120]),
    ("coins", 250, [5, 10, 80]),
]


def _get_tier(streak: int) -> int:
    if streak >= 14:
        return 2
    if streak >= 6:
        return 1
    return 0


def _days_to_next_tier(streak: int) -> int:
    if streak >= 14:
        return 0
    if streak >= 6:
        return 14 - streak
    return 6 - streak


def _roll_prize(streak: int) -> tuple[str, int]:
    tier = _get_tier(streak)
    weights = [row[2][tier] for row in PRIZE_TABLE]
    row = random.choices(PRIZE_TABLE, weights=weights, k=1)[0]
    return row[0], row[1]


# ============================================
# SCHEMAS
# ============================================

class SpinPendingPrize(BaseModel):
    prize_type: str
    prize_amount: int


class SpinStatusResponse(BaseModel):
    available: bool
    next_available_at: Optional[str]
    streak: int
    tier: int
    next_tier_in_days: int
    retry_available: bool
    pending_prize: Optional[SpinPendingPrize]
    streak_lost_at: Optional[str] = None
    streak_lost_count: int = 0


class SpinRollResponse(BaseModel):
    prize_type: str
    prize_amount: int
    streak: int
    tier: int
    retry_available: bool


class SpinCollectResponse(BaseModel):
    prize_type: str
    prize_amount: int


class SpinRestoreResponse(BaseModel):
    success: bool
    streak: int
    coins: int


class SpinDevSetStreakRequest(BaseModel):
    streak: int


def _ensure_dev() -> None:
    if settings.ENVIRONMENT != "development":
        raise HTTPException(status_code=403, detail="Dev endpoints are disabled")


# ============================================
# ENDPOINTS
# ============================================

@router.get("/status", response_model=SpinStatusResponse)
async def get_spin_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    now = _spin_now()
    last_spin_at = _fallback_last_spin_at(user)
    next_available_at = (last_spin_at + SPIN_COOLDOWN) if last_spin_at is not None else None

    # Автозачисление просроченного pending приза (кулдаун истёк, а приз не забрали)
    if (
        user.pending_spin_prize_type is not None
        and next_available_at is not None
        and now >= next_available_at
    ):
        lock_result = await db.execute(
            select(User).where(User.id == user.id).with_for_update()
        )
        locked_user = lock_result.scalar_one_or_none()
        if locked_user is not None and locked_user.pending_spin_prize_type is not None:
            locked_last = _fallback_last_spin_at(locked_user)
            locked_next = (locked_last + SPIN_COOLDOWN) if locked_last is not None else None
            if locked_next is not None and now >= locked_next:
                await _auto_collect_pending(locked_user, db)
                await db.commit()
                user = locked_user

    # Пересчитываем после возможного автозачисления
    last_spin_at = _fallback_last_spin_at(user)
    next_available_at = (last_spin_at + SPIN_COOLDOWN) if last_spin_at is not None else None

    if last_spin_at is not None and now - last_spin_at < SPIN_STREAK_WINDOW:
        effective_streak = user.login_streak or 0
    else:
        effective_streak = 0

    available = (
        user.pending_spin_prize_type is None
        and (next_available_at is None or now >= next_available_at)
        and not _is_streak_restore_blocking(user, now)
    )

    retry_available = (
        last_spin_at is not None
        and user.pending_spin_prize_type is not None
        and not _is_retry_used_for_current_spin(user, last_spin_at)
    )

    pending_prize = None
    if user.pending_spin_prize_type:
        pending_prize = SpinPendingPrize(
            prize_type=user.pending_spin_prize_type,
            prize_amount=user.pending_spin_prize_amount or 0,
        )

    streak_lost_at, streak_lost_count = _get_streak_restore_info(user, now)
    streak = effective_streak
    return SpinStatusResponse(
        available=available,
        next_available_at=_to_iso_utc(next_available_at),
        streak=streak,
        tier=_get_tier(streak),
        next_tier_in_days=_days_to_next_tier(streak),
        retry_available=retry_available,
        pending_prize=pending_prize,
        streak_lost_at=_to_iso_utc(streak_lost_at),
        streak_lost_count=streak_lost_count,
    )


@router.post("/roll", response_model=SpinRollResponse)
async def roll_spin(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    locked_user = result.scalar_one_or_none()
    if locked_user is None:
        raise api_error(404, "USER_NOT_FOUND", "User not found")

    now = _spin_now()
    today = _spin_today()
    last_spin_at = _fallback_last_spin_at(locked_user)

    if locked_user.pending_spin_prize_type is not None:
        # Если кулдаун уже истёк — автозачисляем (пользователь не забрал вовремя)
        pending_expired = (
            last_spin_at is not None and now >= last_spin_at + SPIN_COOLDOWN
        )
        if pending_expired:
            await _auto_collect_pending(locked_user, db)
            await db.commit()
            last_spin_at = _fallback_last_spin_at(locked_user)
        else:
            raise api_error(409, "SPIN_PENDING_PRIZE", "Collect the pending prize first")

    if last_spin_at is not None and now < last_spin_at + SPIN_COOLDOWN:
        raise api_error(409, "SPIN_ON_COOLDOWN", "Spin is on cooldown")

    if _is_streak_restore_blocking(locked_user, now):
        raise api_error(409, "STREAK_RESTORE_REQUIRED", "Restore the frozen streak before spinning")

    if last_spin_at is not None and now - last_spin_at < SPIN_STREAK_WINDOW:
        new_streak = (locked_user.login_streak or 0) + 1
    else:
        new_streak = 1

    prize_type, prize_amount = _roll_prize(new_streak)

    locked_user.pending_spin_prize_type = prize_type
    locked_user.pending_spin_prize_amount = prize_amount
    locked_user.last_spin_at = now
    locked_user.last_spin_date = today
    locked_user.login_streak = new_streak

    await db.commit()

    retry_available = not _is_retry_used_for_current_spin(locked_user, now)

    return SpinRollResponse(
        prize_type=prize_type,
        prize_amount=prize_amount,
        streak=new_streak,
        tier=_get_tier(new_streak),
        retry_available=retry_available,
    )


@router.post("/retry", response_model=SpinRollResponse)
async def retry_spin(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    locked_user = result.scalar_one_or_none()
    if locked_user is None:
        raise api_error(404, "USER_NOT_FOUND", "User not found")

    last_spin_at = _fallback_last_spin_at(locked_user)
    if last_spin_at is None:
        raise api_error(409, "SPIN_NOT_ROLLED", "No spin has been rolled yet")

    if locked_user.pending_spin_prize_type is None:
        raise api_error(404, "SPIN_NO_PENDING_PRIZE", "No pending prize to retry")

    if _is_retry_used_for_current_spin(locked_user, last_spin_at):
        raise api_error(409, "SPIN_RETRY_ALREADY_USED", "Spin retry has already been used")

    ad_claim = await db.execute(
        select(AdRewardClaim.id).where(
            AdRewardClaim.user_id == locked_user.id,
            AdRewardClaim.placement == PLACEMENT_SPIN_RETRY,
            AdRewardClaim.created_at >= last_spin_at,
        )
    )
    if ad_claim.scalar_one_or_none() is None:
        raise HTTPException(status_code=409, detail={"error": "SPIN_RETRY_AD_REQUIRED"})

    prize_type, prize_amount = _roll_prize(locked_user.login_streak or 1)

    locked_user.pending_spin_prize_type = prize_type
    locked_user.pending_spin_prize_amount = prize_amount
    locked_user.spin_retry_used_at = _spin_now()
    locked_user.spin_retry_used_date = _spin_today()

    await db.commit()

    return SpinRollResponse(
        prize_type=prize_type,
        prize_amount=prize_amount,
        streak=locked_user.login_streak or 1,
        tier=_get_tier(locked_user.login_streak or 1),
        retry_available=False,
    )


@router.post("/collect", response_model=SpinCollectResponse)
async def collect_spin(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    locked_user = result.scalar_one_or_none()
    if locked_user is None:
        raise api_error(404, "USER_NOT_FOUND", "User not found")

    if locked_user.pending_spin_prize_type is None:
        raise api_error(404, "SPIN_NO_PENDING_PRIZE", "No pending prize to collect")

    prize_type = locked_user.pending_spin_prize_type
    prize_amount = locked_user.pending_spin_prize_amount or 0

    if prize_type == "coins":
        locked_user.coins = (locked_user.coins or 0) + prize_amount
    elif prize_type == "hints":
        locked_user.hint_balance = (locked_user.hint_balance or 0) + prize_amount
    elif prize_type == "revive":
        locked_user.revive_balance = (locked_user.revive_balance or 0) + prize_amount

    tx = Transaction(
        user_id=locked_user.id,
        type="reward",
        currency=prize_type if prize_type == "coins" else "item",
        amount=prize_amount,
        item_type="spin",
        item_id=f"daily_spin_{prize_type}",
        status="completed",
    )
    db.add(tx)

    locked_user.pending_spin_prize_type = None
    locked_user.pending_spin_prize_amount = None

    await db.commit()

    return SpinCollectResponse(
        prize_type=prize_type,
        prize_amount=prize_amount,
    )


@router.post("/restore-streak", response_model=SpinRestoreResponse)
async def restore_streak(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    locked_user = result.scalar_one_or_none()
    if locked_user is None:
        raise api_error(404, "USER_NOT_FOUND", "User not found")

    now = _spin_now()
    today = _spin_today()
    last_spin_at = _fallback_last_spin_at(locked_user)

    if (
        locked_user.pending_spin_prize_type is not None
        and last_spin_at is not None
        and now >= last_spin_at + SPIN_COOLDOWN
    ):
        await _auto_collect_pending(locked_user, db)

    streak_lost_at, streak_lost_count = _get_streak_restore_info(locked_user, now)
    if streak_lost_at is None:
        raise api_error(409, "STREAK_RESTORE_NOT_AVAILABLE", "Streak restore is not available")

    if streak_lost_count < STREAK_RESTORE_MIN_STREAK:
        raise api_error(
            409,
            "STREAK_RESTORE_NOT_ELIGIBLE",
            "Only streaks of 7 days or more can be restored",
        )

    if (locked_user.coins or 0) < STREAK_RESTORE_COST_COINS:
        raise api_error(409, "NOT_ENOUGH_COINS", "Not enough coins")

    restored_anchor = now - SPIN_COOLDOWN
    locked_user.coins = (locked_user.coins or 0) - STREAK_RESTORE_COST_COINS
    locked_user.last_spin_at = restored_anchor
    locked_user.last_spin_date = today - timedelta(days=1)
    locked_user.spin_ready_notified_for_spin_at = restored_anchor
    locked_user.streak_warning_notified_for_spin_at = None
    locked_user.streak_reset_notified_for_spin_at = None

    tx = Transaction(
        user_id=locked_user.id,
        type="purchase",
        currency="coins",
        amount=-STREAK_RESTORE_COST_COINS,
        item_type="spin",
        item_id="streak_restore",
        status="completed",
    )
    db.add(tx)

    await db.commit()

    return SpinRestoreResponse(
        success=True,
        streak=streak_lost_count,
        coins=locked_user.coins or 0,
    )


@router.post("/dev/reset")
async def dev_reset_spin(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_dev()
    result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    locked_user = result.scalar_one_or_none()
    if locked_user is None:
        raise api_error(404, "USER_NOT_FOUND", "User not found")

    locked_user.pending_spin_prize_type = None
    locked_user.pending_spin_prize_amount = None
    locked_user.last_spin_date = None
    locked_user.last_spin_at = None
    locked_user.spin_retry_used_date = None
    locked_user.spin_retry_used_at = None
    locked_user.spin_ready_notified_for_spin_at = None
    locked_user.streak_warning_notified_for_spin_at = None
    locked_user.streak_reset_notified_for_spin_at = None
    locked_user.login_streak = 0

    await db.commit()
    return {"success": True}


@router.post("/dev/set-streak")
async def dev_set_spin_streak(
    payload: SpinDevSetStreakRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_dev()
    target = max(0, int(payload.streak))
    now = _spin_now()

    result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    locked_user = result.scalar_one_or_none()
    if locked_user is None:
        raise api_error(404, "USER_NOT_FOUND", "User not found")

    locked_user.pending_spin_prize_type = None
    locked_user.pending_spin_prize_amount = None
    locked_user.spin_retry_used_date = None
    locked_user.spin_retry_used_at = None
    locked_user.spin_ready_notified_for_spin_at = None
    locked_user.streak_warning_notified_for_spin_at = None
    locked_user.streak_reset_notified_for_spin_at = None
    locked_user.login_streak = target

    if target > 0:
        last_spin_at = now - SPIN_COOLDOWN
        locked_user.last_spin_at = last_spin_at
        locked_user.last_spin_date = today_msk() - timedelta(days=1)
    else:
        locked_user.last_spin_at = None
        locked_user.last_spin_date = None

    await db.commit()
    return {"success": True, "streak": target}


@router.post("/dev/set-frozen-streak")
async def dev_set_frozen_spin_streak(
    payload: SpinDevSetStreakRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_dev()
    target = max(STREAK_RESTORE_MIN_STREAK, int(payload.streak))
    now = _spin_now()
    frozen_anchor = now - SPIN_STREAK_WINDOW - timedelta(hours=1)

    result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    locked_user = result.scalar_one_or_none()
    if locked_user is None:
        raise api_error(404, "USER_NOT_FOUND", "User not found")

    locked_user.pending_spin_prize_type = None
    locked_user.pending_spin_prize_amount = None
    locked_user.spin_retry_used_date = None
    locked_user.spin_retry_used_at = None
    locked_user.login_streak = target
    locked_user.last_spin_at = frozen_anchor
    locked_user.last_spin_date = frozen_anchor.date()
    locked_user.spin_ready_notified_for_spin_at = frozen_anchor
    locked_user.streak_warning_notified_for_spin_at = frozen_anchor
    locked_user.streak_reset_notified_for_spin_at = frozen_anchor

    await db.commit()
    return {"success": True, "streak": target}
