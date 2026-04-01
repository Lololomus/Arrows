from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import AsyncSessionLocal
from ..models import User, UserbotGiftOrder

logger = logging.getLogger(__name__)


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def extract_access_hash(entity: Any) -> int | None:
    access_hash = getattr(entity, "access_hash", None)
    if access_hash is None:
        return None
    try:
        return int(access_hash)
    except (TypeError, ValueError):
        return None


async def persist_userbot_peer(
    db: AsyncSession,
    *,
    telegram_id: int,
    access_hash: int,
    username: str | None = None,
) -> User | None:
    result = await db.execute(
        select(User).where(User.telegram_id == telegram_id).with_for_update()
    )
    user = result.scalar_one_or_none()
    if user is None:
        return None

    user.userbot_access_hash = int(access_hash)
    user.userbot_peer_status = "resolved"
    user.userbot_peer_verified_at = utcnow_naive()
    if username:
        user.username = username.lstrip("@")

    orders_result = await db.execute(
        select(UserbotGiftOrder)
        .where(
            UserbotGiftOrder.user_id == user.id,
            UserbotGiftOrder.status == "activation_required",
        )
        .with_for_update()
    )
    orders = list(orders_result.scalars().all())
    for order in orders:
        order.status = "pending"
        order.retry_after = None
        order.failure_reason = None
        order.processing_started_at = None
        order.failed_at = None

    return user


async def persist_userbot_peer_by_telegram_id(
    *,
    telegram_id: int,
    access_hash: int,
    username: str | None = None,
) -> bool:
    async with AsyncSessionLocal() as db:
        try:
            user = await persist_userbot_peer(
                db,
                telegram_id=telegram_id,
                access_hash=access_hash,
                username=username,
            )
            if user is None:
                await db.rollback()
                return False
            await db.commit()
            return True
        except Exception:
            await db.rollback()
            logger.exception("userbot_peers: failed to persist peer for telegram_id=%s", telegram_id)
            return False


async def mark_userbot_activation_required(
    db: AsyncSession,
    *,
    user: User,
) -> None:
    user.userbot_peer_status = "activation_required"
