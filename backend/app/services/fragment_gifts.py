"""
Fragment Drops — gift delivery logic.

Core business logic for sending Telegram gifts to users.
Handles the claim flow, Stars balance, DEV mode bypass.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from aiogram import Bot
from aiogram.exceptions import (
    TelegramBadRequest,
    TelegramForbiddenError,
    TelegramRetryAfter,
)
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_redis
from ..models import BotStarsLedger, FragmentClaim, FragmentDrop, User

logger = logging.getLogger(__name__)

REDIS_STARS_BALANCE_KEY = "bot_stars:balance"
REDIS_DROPS_PAUSED_KEY = "fragment_drops:paused_insufficient_stars"


# ============================================
# PROGRESS
# ============================================

def get_user_progress(user: User, condition_type: str) -> int:
    """Вычислить прогресс пользователя для заданного типа условия."""
    if condition_type == "arcade_levels":
        return max(0, user.current_level - 1)
    if condition_type == "friends_confirmed":
        return max(0, user.referrals_count)
    return 0


# ============================================
# STARS BALANCE (Redis cache)
# ============================================

async def get_cached_stars_balance() -> int | None:
    """Получить кэшированный баланс Stars бота из Redis."""
    try:
        redis = await get_redis()
        val = await redis.get(REDIS_STARS_BALANCE_KEY)
        return int(val) if val is not None else None
    except Exception:
        logger.warning("fragment_gifts: failed to read Stars balance from Redis")
        return None


async def set_cached_stars_balance(balance: int) -> None:
    """Обновить кэш баланса Stars в Redis."""
    try:
        redis = await get_redis()
        await redis.set(REDIS_STARS_BALANCE_KEY, str(balance), ex=120)
    except Exception:
        logger.warning("fragment_gifts: failed to write Stars balance to Redis")


async def is_drops_paused() -> bool:
    """Проверить, приостановлены ли дропы из-за нехватки Stars."""
    try:
        redis = await get_redis()
        return bool(await redis.get(REDIS_DROPS_PAUSED_KEY))
    except Exception:
        return False


async def set_drops_paused(paused: bool) -> None:
    """Установить/снять паузу дропов."""
    try:
        redis = await get_redis()
        if paused:
            await redis.set(REDIS_DROPS_PAUSED_KEY, "1", ex=3600)
        else:
            await redis.delete(REDIS_DROPS_PAUSED_KEY)
    except Exception:
        logger.warning("fragment_gifts: failed to set drops paused flag")


# ============================================
# CLAIM FLOW
# ============================================

async def reserve_claim(
    user: User,
    drop: FragmentDrop,
    db: AsyncSession,
) -> FragmentClaim:
    """
    Фаза 1: резервируем сток и создаём claim.
    Вызывается внутри DB транзакции с locked user и locked drop.
    """
    available = drop.total_stock - drop.reserved_stock - drop.delivered_stock
    if available <= 0:
        raise HTTPException(status_code=409, detail={
            "code": "OUT_OF_STOCK",
            "message": "Подарки закончились",
        })

    # Soft check Stars balance (covers both single-gift and overall budget)
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
        telegram_gift_id=drop.telegram_gift_id,
        stars_cost=drop.gift_star_cost,
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
    """
    Фаза 2: отправляем подарок через Telegram API.
    Вызывается ПОСЛЕ коммита фазы 1.
    Возвращает итоговый статус клейма.
    """
    now = datetime.now(timezone.utc)

    # DEV mode: skip real send
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

    # PROD: real send
    claim.status = "sending"
    claim.attempts += 1
    claim.last_attempt_at = now
    await db.commit()

    bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
    try:
        await bot.send_gift(
            user_id=user.telegram_id,
            gift_id=drop.telegram_gift_id,
        )
    except TelegramForbiddenError:
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
    except TelegramBadRequest as exc:
        error_text = str(exc)
        logger.warning("fragment_gifts: bad request for claim %d: %s", claim.id, error_text)

        if "not enough" in error_text.lower() or "balance" in error_text.lower():
            # Insufficient Stars — pause all campaigns
            claim.status = "failed"
            claim.failed_at = now
            claim.failure_reason = "insufficient_bot_stars"
            drop.reserved_stock -= 1
            await set_drops_paused(True)
            await db.commit()
            logger.critical("fragment_gifts: INSUFFICIENT STARS — pausing all drops")
            raise HTTPException(status_code=409, detail={
                "code": "INSUFFICIENT_BOT_STARS",
                "message": "Подарки временно недоступны",
            })

        # Other bad request (user not started bot, gift not found, etc.)
        claim.status = "failed"
        claim.failed_at = now
        claim.failure_reason = f"telegram_error: {error_text[:200]}"
        drop.reserved_stock -= 1
        await db.commit()
        raise HTTPException(status_code=409, detail={
            "code": "GIFT_SEND_FAILED",
            "message": "Не удалось отправить подарок. Убедись, что ты начал диалог с ботом.",
        })
    except TelegramRetryAfter as exc:
        logger.warning("fragment_gifts: rate limited, retry after %ds (claim=%d)", exc.retry_after, claim.id)
        claim.status = "pending"
        claim.failure_reason = f"rate_limited: {exc.retry_after}s"
        await db.commit()
        return "sending"
    except Exception as exc:
        # Retriable: timeout, network, 5xx
        logger.exception("fragment_gifts: unexpected error sending gift (claim=%d)", claim.id)
        claim.status = "pending"
        claim.failure_reason = f"retriable: {str(exc)[:200]}"
        await db.commit()
        return "sending"
    finally:
        await bot.session.close()

    # Success!
    logger.info("fragment_gifts: gift delivered (claim=%d, user=%d, drop=%s)", claim.id, user.id, drop.slug)
    claim.status = "delivered"
    claim.delivered_at = datetime.now(timezone.utc)
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
