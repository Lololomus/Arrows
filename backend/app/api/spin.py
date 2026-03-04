"""
Arrow Puzzle - Daily Spin API

Ежедневная рулетка: один спин в день + одна повторная попытка.
Приз начисляется только при явном вызове /collect.
"""

import random
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models import AdRewardClaim, Transaction, User
from ..services.ad_rewards import PLACEMENT_SPIN_RETRY, today_msk
from .auth import get_current_user


router = APIRouter(prefix="/spin", tags=["spin"])

def _spin_today() -> date:
    return today_msk()


# ============================================
# КОНФИГУРАЦИЯ ПРИЗОВ
# ============================================

# Тиры по стрику: [1-2 дня, 3-6 дней, 7+ дней]
# Tiers by streak: [0-5 days, 6-13 days, 14+ days]
PRIZE_TABLE = [
    # (prize_type, prize_amount, [вес_тир0, вес_тир1, вес_тир2])
    ("coins",  10,  [350, 150,  50]),
    ("coins",  25,  [250, 200, 100]),
    ("coins",  50,  [150, 200, 150]),
    ("hints",   1,  [100, 150, 150]),
    ("revive",  1,  [ 80, 150, 200]),
    ("coins", 100,  [ 50, 100, 150]),
    ("hints",   3,  [ 15,  40, 120]),
    ("coins", 250,  [  5,  10,  80]),
]

def _get_tier(streak: int) -> int:
    """Вернуть индекс тира (0, 1, 2) по стрику."""
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
    """Серверный RNG: вернуть (prize_type, prize_amount)."""
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
    streak: int
    tier: int
    next_tier_in_days: int
    retry_available: bool
    pending_prize: Optional[SpinPendingPrize]


class SpinRollResponse(BaseModel):
    prize_type: str
    prize_amount: int
    streak: int
    tier: int
    retry_available: bool


class SpinCollectResponse(BaseModel):
    prize_type: str
    prize_amount: int


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
):
    today = _spin_today()
    yesterday = today - timedelta(days=1)
    if user.last_spin_date in (today, yesterday):
        effective_streak = user.login_streak or 0
    else:
        effective_streak = 0
    available = user.last_spin_date != today and user.pending_spin_prize_type is None
    streak = effective_streak
    retry_available = (
        user.last_spin_date == today
        and user.spin_retry_used_date != today
        and user.pending_spin_prize_type is not None
    )
    pending_prize = None
    if user.pending_spin_prize_type:
        pending_prize = SpinPendingPrize(
            prize_type=user.pending_spin_prize_type,
            prize_amount=user.pending_spin_prize_amount or 0,
        )
    return SpinStatusResponse(
        available=available,
        streak=streak,
        tier=_get_tier(streak),
        next_tier_in_days=_days_to_next_tier(streak),
        retry_available=retry_available,
        pending_prize=pending_prize,
    )


@router.post("/roll", response_model=SpinRollResponse)
async def roll_spin(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    today = _spin_today()
    yesterday = today - timedelta(days=1)

    if user.last_spin_date == today:
        raise HTTPException(status_code=409, detail="Spin already used today")

    if user.pending_spin_prize_type is not None:
        raise HTTPException(status_code=409, detail="Collect pending prize first")

    # Обновить стрик
    if user.last_spin_date == yesterday:
        new_streak = (user.login_streak or 0) + 1
    else:
        new_streak = 1

    prize_type, prize_amount = _roll_prize(new_streak)

    # Сохранить приз как pending (не начислять!)
    user.pending_spin_prize_type = prize_type
    user.pending_spin_prize_amount = prize_amount
    user.last_spin_date = today
    user.login_streak = new_streak

    await db.commit()

    retry_available = user.spin_retry_used_date != today  # retry ещё не использован

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
    today = _spin_today()

    if user.last_spin_date != today:
        raise HTTPException(status_code=409, detail="No spin rolled today")

    if user.spin_retry_used_date == today:
        raise HTTPException(status_code=409, detail="Retry already used today")

    if user.pending_spin_prize_type is None:
        raise HTTPException(status_code=404, detail="No pending prize to retry")

    ad_claim = await db.execute(
        select(AdRewardClaim.id).where(
            AdRewardClaim.user_id == user.id,
            AdRewardClaim.placement == PLACEMENT_SPIN_RETRY,
            AdRewardClaim.claim_day_msk == today_msk(),
        )
    )
    if ad_claim.scalar_one_or_none() is None:
        raise HTTPException(status_code=409, detail={"error": "SPIN_RETRY_AD_REQUIRED"})

    prize_type, prize_amount = _roll_prize(user.login_streak or 1)

    user.pending_spin_prize_type = prize_type
    user.pending_spin_prize_amount = prize_amount
    user.spin_retry_used_date = today

    await db.commit()

    return SpinRollResponse(
        prize_type=prize_type,
        prize_amount=prize_amount,
        streak=user.login_streak or 1,
        tier=_get_tier(user.login_streak or 1),
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
        raise HTTPException(status_code=404, detail="User not found")

    if locked_user.pending_spin_prize_type is None:
        raise HTTPException(status_code=404, detail="No pending prize to collect")

    prize_type = locked_user.pending_spin_prize_type
    prize_amount = locked_user.pending_spin_prize_amount or 0

    # Начислить приз
    if prize_type == "coins":
        locked_user.coins = (locked_user.coins or 0) + prize_amount
    elif prize_type == "hints":
        locked_user.hint_balance = (locked_user.hint_balance or 0) + prize_amount
    elif prize_type == "revive":
        locked_user.revive_balance = (locked_user.revive_balance or 0) + prize_amount

    # Записать транзакцию
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

    # Очистить pending
    locked_user.pending_spin_prize_type = None
    locked_user.pending_spin_prize_amount = None

    await db.commit()

    return SpinCollectResponse(
        prize_type=prize_type,
        prize_amount=prize_amount,
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
        raise HTTPException(status_code=404, detail="User not found")

    locked_user.pending_spin_prize_type = None
    locked_user.pending_spin_prize_amount = None
    locked_user.last_spin_date = None
    locked_user.spin_retry_used_date = None
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
    today = _spin_today()
    yesterday = today - timedelta(days=1)

    result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    locked_user = result.scalar_one_or_none()
    if locked_user is None:
        raise HTTPException(status_code=404, detail="User not found")

    locked_user.pending_spin_prize_type = None
    locked_user.pending_spin_prize_amount = None
    locked_user.spin_retry_used_date = None
    locked_user.login_streak = target
    locked_user.last_spin_date = yesterday

    await db.commit()
    return {"success": True, "streak": target}
