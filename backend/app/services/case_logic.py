"""
Case opening logic: rarity rolls, pity, rewards, and result recovery helpers.
"""

from __future__ import annotations

import json
import random
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import CaseOpening, Transaction, User

CASE_PRICE_STARS = 50
CASE_PRICE_TON = 0.5
PITY_THRESHOLD = 50
CASE_RESULT_REDIS_TTL_SECONDS = 15 * 60
CASE_RESULT_RECOVERY_WINDOW_SECONDS = 15 * 60

# Rewards per rarity
REWARDS: dict[str, dict[str, int]] = {
    "common": {"hints": 1, "revives": 1, "coins": 50, "stars": 0},
    "rare": {"hints": 5, "revives": 3, "coins": 150, "stars": 25},
    "epic": {"hints": 10, "revives": 5, "coins": 450, "stars": 0},
    "epic_stars": {"hints": 10, "revives": 5, "coins": 450, "stars": 250},
}


def determine_rarity(pity_counter: int) -> str:
    """
    Determine the rarity for a case opening.

    Drop rates:
      epic_stars : 0.5%
      epic       : 4.5%  (total epic cumulative = 5%)
      rare       : 35%   (cumulative = 40%)
      common     : 60%

    Pity: if pity_counter >= PITY_THRESHOLD - 1 (i.e. 49+) force 'epic' (no stars).
    """
    if pity_counter >= PITY_THRESHOLD - 1:
        return "epic"

    roll = random.random()
    if roll < 0.005:
        return "epic_stars"
    if roll < 0.050:
        return "epic"
    if roll < 0.400:
        return "rare"
    return "common"


def build_case_result(
    *,
    rarity: str,
    hints: int,
    revives: int,
    coins: int,
    stars: int,
    user: User,
) -> dict[str, Any]:
    rewards_list = [
        {"type": "hints", "amount": hints},
        {"type": "revives", "amount": revives},
        {"type": "coins", "amount": coins},
    ]
    if stars > 0:
        rewards_list.append({"type": "stars", "amount": stars})

    return {
        "rarity": rarity,
        "rewards": rewards_list,
        "hint_balance": user.hint_balance,
        "revive_balance": user.revive_balance,
        "coins": user.coins,
        "stars_balance": user.stars_balance,
        "case_pity_counter": user.case_pity_counter,
    }


def build_case_result_from_opening(opening: CaseOpening, user: User) -> dict[str, Any]:
    result = build_case_result(
        rarity=opening.rarity,
        hints=opening.hints_given,
        revives=opening.revives_given,
        coins=opening.coins_given,
        stars=opening.stars_given,
        user=user,
    )
    result["opening_id"] = opening.id
    return result


async def grant_case_rewards(
    user: User,
    rarity: str,
    currency: str,
    db: AsyncSession,
    transaction_id: int | None = None,
) -> dict[str, Any]:
    """
    Apply case rewards to user, update pity counter, and log the opening.

    Caller must hold SELECT FOR UPDATE on the user row.
    """
    reward = REWARDS[rarity]

    user.hint_balance += reward["hints"]
    user.revive_balance += reward["revives"]
    user.coins += reward["coins"]
    user.stars_balance += reward["stars"]

    if rarity in ("epic", "epic_stars"):
        user.case_pity_counter = 0
    else:
        user.case_pity_counter += 1

    opening = CaseOpening(
        user_id=user.id,
        transaction_id=transaction_id,
        rarity=rarity,
        hints_given=reward["hints"],
        revives_given=reward["revives"],
        coins_given=reward["coins"],
        stars_given=reward["stars"],
        payment_currency=currency,
    )
    db.add(opening)
    await db.flush()

    result = build_case_result(
        rarity=rarity,
        hints=reward["hints"],
        revives=reward["revives"],
        coins=reward["coins"],
        stars=reward["stars"],
        user=user,
    )
    result["opening_id"] = opening.id
    return result


async def create_stars_case_purchase(
    *,
    user: User,
    total_amount: int,
    charge_id: str,
    db: AsyncSession,
) -> dict[str, Any]:
    tx = Transaction(
        user_id=user.id,
        type="purchase",
        currency="stars",
        amount=total_amount,
        item_type="cases",
        item_id="standard",
        status="completed",
        ton_tx_hash=charge_id,
    )
    db.add(tx)
    await db.flush()

    rarity = determine_rarity(user.case_pity_counter)
    return await grant_case_rewards(user, rarity, "stars", db, transaction_id=tx.id)


async def get_case_result_for_transaction(
    tx_id: int,
    *,
    user: User,
    db: AsyncSession,
) -> dict[str, Any] | None:
    result = await db.execute(
        select(CaseOpening)
        .where(CaseOpening.transaction_id == tx_id, CaseOpening.user_id == user.id)
        .order_by(CaseOpening.id.desc())
        .limit(1)
    )
    opening = result.scalar_one_or_none()
    if opening is None:
        return None
    return build_case_result_from_opening(opening, user)


async def get_recent_case_result(
    *,
    user: User,
    payment_currency: str,
    db: AsyncSession,
    max_age_seconds: int = CASE_RESULT_RECOVERY_WINDOW_SECONDS,
) -> dict[str, Any] | None:
    threshold = datetime.utcnow() - timedelta(seconds=max_age_seconds)
    result = await db.execute(
        select(CaseOpening)
        .where(
            CaseOpening.user_id == user.id,
            CaseOpening.payment_currency == payment_currency,
            CaseOpening.created_at >= threshold,
        )
        .order_by(CaseOpening.created_at.desc(), CaseOpening.id.desc())
        .limit(1)
    )
    opening = result.scalar_one_or_none()
    if opening is None:
        return None
    return build_case_result_from_opening(opening, user)


def serialize_case_result(result: dict[str, Any]) -> str:
    return json.dumps(result)
