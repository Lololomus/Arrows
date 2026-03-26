"""
Fragment Drops - gift delivery logic.

Core business logic for sending Telegram gifts to users.
Handles the claim flow, Stars balance, DEV mode bypass.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_redis
from ..models import BotStarsLedger, FragmentClaim, FragmentDrop, User
from .telegram_gifts_api import (
    GiftApiBadRequest,
    GiftApiForbidden,
    GiftApiRetryAfter,
    send_gift,
)

logger = logging.getLogger(__name__)

REDIS_STARS_BALANCE_KEY = "bot_stars:balance"
REDIS_DROPS_PAUSED_KEY = "fragment_drops:paused_insufficient_stars"


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_user_progress(user: User, condition_type: str) -> int:
    if condition_type == "arcade_levels":
        return max(0, user.current_level - 1)
    if condition_type == "friends_confirmed":
        return max(0, user.referrals_count)
    return 0


async def get_cached_stars_balance() -> int | None:
    try:
        redis = await get_redis()
        val = await redis.get(REDIS_STARS_BALANCE_KEY)
        return int(val) if val is not None else None
    except Exception:
        logger.warning("fragment_gifts: failed to read Stars balance from Redis")
        return None


async def set_cached_stars_balance(balance: int) -> None:
    try:
        redis = await get_redis()
        await redis.set(REDIS_STARS_BALANCE_KEY, str(balance), ex=120)
    except Exception:
        logger.warning("fragment_gifts: failed to write Stars balance to Redis")


async def is_drops_paused() -> bool:
    try:
        redis = await get_redis()
        return bool(await redis.get(REDIS_DROPS_PAUSED_KEY))
    except Exception:
        return False


async def set_drops_paused(paused: bool) -> None:
    try:
        redis = await get_redis()
        if paused:
            await redis.set(REDIS_DROPS_PAUSED_KEY, "1", ex=3600)
        else:
            await redis.delete(REDIS_DROPS_PAUSED_KEY)
    except Exception:
        logger.warning("fragment_gifts: failed to set drops paused flag")


async def reserve_claim(
    user: User,
    drop: FragmentDrop,
    db: AsyncSession,
) -> FragmentClaim:
    available = drop.total_stock - drop.reserved_stock - drop.delivered_stock
    if available <= 0:
        raise HTTPException(status_code=409, detail={
            "code": "OUT_OF_STOCK",
            "message": "Подарки закончились",
        })

    if settings.ENVIRONMENT != "development":
        if await is_drops_paused():
            raise HTTPException(status_code=409, detail={
                "code": "INSUFFICIENT_BOT_STARS",
                "message": "Подарки временно недоступны",
            })
        cached_balance = await get_cached_stars_balance()
        if cached_balance is not None and cached_balance < drop.gift_star_cost:
            raise HTTPException(status_code=409, detail={
                "code": "INSUFFICIENT_BOT_STARS",
                "message": "Подарки временно недоступны",
            })

    claim = FragmentClaim(
        drop_id=drop.id,
        user_id=user.id,
        status="pending",
        telegram_gift_id=drop.telegram_gift_id,
        stars_cost=drop.gift_star_cost,
        attempts=0,
    )
    db.add(claim)

    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail={
            "code": "ALREADY_CLAIMED",
            "message": "Ты уже забрал этот подарок",
        })

    drop.reserved_stock += 1
    return claim


async def send_gift_to_user(
    claim: FragmentClaim,
    drop: FragmentDrop,
    user: User,
    db: AsyncSession,
) -> str:
    now = utcnow_naive()

    if settings.ENVIRONMENT == "development":
        logger.info("[DEV] Gift send skipped, auto-delivered (claim=%d, user=%d)", claim.id, user.id)
        claim.status = "delivered"
        claim.delivered_at = now
        claim.attempts = 1
        claim.last_attempt_at = now
        drop.reserved_stock -= 1
        drop.delivered_stock += 1
        db.add(BotStarsLedger(
            event_type="gift_sent",
            amount=-claim.stars_cost,
            fragment_claim_id=claim.id,
            note=f"[DEV] user={user.id} drop={drop.slug}",
        ))
        return "delivered"

    claim.status = "sending"
    claim.attempts = int(claim.attempts or 0) + 1
    claim.last_attempt_at = now
    await db.commit()

    try:
        await send_gift(
            bot_token=settings.TELEGRAM_BOT_TOKEN,
            user_id=user.telegram_id,
            gift_id=drop.telegram_gift_id,
        )
    except GiftApiForbidden:
        logger.warning("fragment_gifts: user %d blocked bot (claim=%d)", user.id, claim.id)
        claim.status = "failed"
        claim.failed_at = now
        claim.failure_reason = "user_blocked_bot"
        drop.reserved_stock -= 1
        await db.commit()
        raise HTTPException(status_code=409, detail={
            "code": "USER_BLOCKED_BOT",
            "message": "Разблокируй бота, чтобы получить подарок",
        })
    except GiftApiBadRequest as exc:
        error_text = exc.description
        logger.warning("fragment_gifts: bad request for claim %d: %s", claim.id, error_text)

        if "not enough" in error_text.lower() or "balance" in error_text.lower():
            claim.status = "failed"
            claim.failed_at = now
            claim.failure_reason = "insufficient_bot_stars"
            drop.reserved_stock -= 1
            await set_drops_paused(True)
            await db.commit()
            logger.critical("fragment_gifts: INSUFFICIENT STARS - pausing all drops")
            raise HTTPException(status_code=409, detail={
                "code": "INSUFFICIENT_BOT_STARS",
                "message": "Подарки временно недоступны",
            })

        claim.status = "failed"
        claim.failed_at = now
        claim.failure_reason = f"telegram_error: {error_text[:200]}"
        drop.reserved_stock -= 1
        await db.commit()
        raise HTTPException(status_code=409, detail={
            "code": "GIFT_SEND_FAILED",
            "message": "Не удалось отправить подарок. Убедись, что ты начал диалог с ботом.",
        })
    except GiftApiRetryAfter as exc:
        logger.warning("fragment_gifts: rate limited, retry after %ds (claim=%d)", exc.retry_after, claim.id)
        claim.status = "pending"
        claim.failure_reason = f"rate_limited: {exc.retry_after}s"
        await db.commit()
        return "sending"
    except Exception as exc:
        logger.exception("fragment_gifts: unexpected error sending gift (claim=%d)", claim.id)
        claim.status = "pending"
        claim.failure_reason = f"retriable: {str(exc)[:200]}"
        await db.commit()
        return "sending"

    logger.info("fragment_gifts: gift delivered (claim=%d, user=%d, drop=%s)", claim.id, user.id, drop.slug)
    claim.status = "delivered"
    claim.delivered_at = utcnow_naive()
    drop.reserved_stock -= 1
    drop.delivered_stock += 1

    db.add(BotStarsLedger(
        event_type="gift_sent",
        amount=-claim.stars_cost,
        fragment_claim_id=claim.id,
        note=f"user={user.id} drop={drop.slug}",
    ))

    await db.commit()
    return "delivered"
