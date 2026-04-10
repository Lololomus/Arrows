from __future__ import annotations

import logging
from typing import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import BotStarsLedger, Transaction, User
from .fragment_gifts import set_cached_stars_balance

logger = logging.getLogger(__name__)

ADMIN_TOPUP_PAYLOAD_PREFIX = "admin_topup_stars"
ADMIN_TOPUP_PACKS: tuple[int, ...] = (100, 500, 1000)


def get_admin_telegram_ids() -> set[int]:
    """Parse ADMIN_TELEGRAM_ID — supports single ID or comma-separated list."""
    raw = settings.ADMIN_TELEGRAM_ID.strip()
    if not raw:
        return set()
    ids: set[int] = set()
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            ids.add(int(part))
        except ValueError:
            logger.error("ADMIN_TELEGRAM_ID: invalid value %r (expected integer)", part)
    return ids


def get_admin_telegram_id() -> int | None:
    """Return first admin ID (kept for backward compatibility)."""
    ids = get_admin_telegram_ids()
    return next(iter(ids), None)


def is_admin_telegram_id(user_id: int | None) -> bool:
    if user_id is None:
        return False
    return int(user_id) in get_admin_telegram_ids()


def normalize_topup_amount(
    raw_amount: str | None,
    *,
    allowed_amounts: Sequence[int] = ADMIN_TOPUP_PACKS,
) -> int | None:
    if raw_amount is None:
        return None

    token = raw_amount.strip()
    if not token:
        return None

    try:
        amount = int(token)
    except ValueError:
        return None

    return amount if amount in allowed_amounts else None


def build_admin_topup_payload(amount: int) -> str:
    if amount not in ADMIN_TOPUP_PACKS:
        raise ValueError(f"Unsupported topup amount: {amount}")
    return f"{ADMIN_TOPUP_PAYLOAD_PREFIX}:{amount}"


def parse_admin_topup_payload(payload: str | None) -> int | None:
    prefix = f"{ADMIN_TOPUP_PAYLOAD_PREFIX}:"
    if not payload or not payload.startswith(prefix):
        return None
    return normalize_topup_amount(payload[len(prefix):])


def validate_admin_topup_checkout(user_id: int | None, payload: str | None) -> tuple[bool, str | None]:
    amount = parse_admin_topup_payload(payload)
    if amount is None:
        return True, None

    if get_admin_telegram_id() is None:
        return False, "Admin top-up is not configured."

    if not is_admin_telegram_id(user_id):
        return False, "This invoice is available only to the admin account."

    return True, None


async def _get_or_create_user(
    db: AsyncSession,
    *,
    telegram_user_id: int,
    username: str | None,
    first_name: str | None,
) -> User:
    result = await db.execute(
        select(User)
        .where(User.telegram_id == telegram_user_id)
        .with_for_update()
    )
    user = result.scalar_one_or_none()
    if user is not None:
        return user

    user = User(
        telegram_id=telegram_user_id,
        username=username,
        first_name=first_name,
        coins=settings.INITIAL_COINS,
        energy=settings.MAX_ENERGY,
    )
    db.add(user)
    await db.flush()
    return user


async def _get_ledger_balance(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.coalesce(func.sum(BotStarsLedger.amount), 0))
    )
    return int(result.scalar_one())


async def record_admin_stars_topup(
    db: AsyncSession,
    *,
    telegram_user_id: int,
    username: str | None,
    first_name: str | None,
    amount: int,
    charge_id: str,
) -> tuple[bool, int]:
    existing = None
    if charge_id:
        existing = await db.execute(
            select(Transaction).where(
                Transaction.currency == "stars",
                Transaction.ton_tx_hash == charge_id,
                Transaction.status == "completed",
            )
        )
    if existing is not None and existing.scalar_one_or_none():
        return False, await _get_ledger_balance(db)

    user = await _get_or_create_user(
        db,
        telegram_user_id=telegram_user_id,
        username=username,
        first_name=first_name,
    )

    current_balance = await _get_ledger_balance(db)
    new_balance = current_balance + amount

    db.add(
        Transaction(
            user_id=user.id,
            type="purchase",
            currency="stars",
            amount=amount,
            item_type="gift_fund",
            item_id=str(amount),
            status="completed",
            ton_tx_hash=charge_id or None,
        )
    )
    db.add(
        BotStarsLedger(
            event_type="stars_received",
            amount=amount,
            balance_after=new_balance,
            note=f"admin_topup:{telegram_user_id}:{charge_id or 'no_charge_id'}",
        )
    )

    await db.commit()
    await set_cached_stars_balance(new_balance)
    return True, new_balance
