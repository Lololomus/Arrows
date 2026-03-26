"""
Background processor for fragment drop claims.

Runs every 60 seconds:
  1. Recovers stuck 'pending' claims (>30s) — attempts gift delivery
  2. Resolves stuck 'sending' claims (>5min) — marks failed + admin alert
  3. Updates Stars balance cache in Redis
  4. Syncs gift catalog every ~5 min
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from aiogram import Bot
from sqlalchemy import or_, select

from ..config import settings
from ..database import AsyncSessionLocal
from ..models import BotStarsLedger, FragmentClaim, FragmentDrop, User

from .fragment_gifts import (
    get_cached_stars_balance,
    is_drops_paused,
    send_gift_to_user,
    set_cached_stars_balance,
    set_drops_paused,
)

logger = logging.getLogger(__name__)

_LOOP_INTERVAL = 60
_PENDING_STALE_SECONDS = 30
_SENDING_STALE_SECONDS = settings.FRAGMENT_SENDING_TIMEOUT
_MAX_ATTEMPTS = settings.FRAGMENT_MAX_CLAIM_ATTEMPTS
_CATALOG_SYNC_CYCLES = 5  # every ~5 min

_cycle_counter = 0


# ============================================
# PUBLIC ENTRY POINT
# ============================================

async def fragment_processor_loop() -> None:
    """Infinite loop: designed for asyncio.create_task."""
    logger.info("fragment_processor: started (interval=%ds)", _LOOP_INTERVAL)
    while True:
        try:
            await _run_cycle()
        except Exception:
            logger.exception("fragment_processor: unexpected error in cycle")
        await asyncio.sleep(_LOOP_INTERVAL)


# ============================================
# CYCLE
# ============================================

async def _run_cycle() -> None:
    global _cycle_counter
    _cycle_counter += 1

    await _recover_pending_claims()
    await _resolve_stuck_sending_claims()
    await _update_stars_balance()

    if _cycle_counter % _CATALOG_SYNC_CYCLES == 0:
        await _sync_gift_catalog()


# ============================================
# 1. RECOVER PENDING CLAIMS
# ============================================

async def _recover_pending_claims() -> None:
    """Find pending claims ready for retry and attempt delivery."""
    now = datetime.now(timezone.utc)
    # Minimum cutoff: claims must be at least 30s old (base backoff)
    min_cutoff = now - timedelta(seconds=_PENDING_STALE_SECONDS)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(FragmentClaim)
            .where(
                FragmentClaim.status == "pending",
                FragmentClaim.attempts < _MAX_ATTEMPTS,
                # Pre-filter: reference time must be before min cutoff
                or_(
                    FragmentClaim.last_attempt_at == None,  # noqa: E711
                    FragmentClaim.last_attempt_at < min_cutoff,
                ),
            )
            .order_by(FragmentClaim.last_attempt_at.asc().nulls_first())
            .with_for_update(skip_locked=True)
            .limit(20)
        )
        claims = list(result.scalars().all())

        # Fine-grained filter by exponential backoff: 30s, 60s, 120s, 240s, 480s
        ready = []
        for claim in claims:
            backoff = min(_PENDING_STALE_SECONDS * (2 ** claim.attempts), 600)
            reference = claim.last_attempt_at or claim.created_at
            if reference and (now - reference).total_seconds() >= backoff:
                ready.append(claim)
            if len(ready) >= 10:
                break

        if not ready:
            return

        logger.info("fragment_processor: %d pending claim(s) ready for retry", len(ready))

        for claim in ready:
            try:
                await _attempt_delivery(db, claim)
            except Exception:
                logger.exception("fragment_processor: failed to recover claim %d", claim.id)


async def _attempt_delivery(db, claim: FragmentClaim) -> None:
    """Attempt gift delivery for a single pending claim."""
    # Load drop and user with locks
    drop_result = await db.execute(
        select(FragmentDrop).where(FragmentDrop.id == claim.drop_id).with_for_update()
    )
    drop = drop_result.scalar_one_or_none()
    if not drop or not drop.is_active:
        claim.status = "failed"
        claim.failed_at = datetime.now(timezone.utc)
        claim.failure_reason = "campaign_deactivated"
        if drop:
            drop.reserved_stock = max(0, drop.reserved_stock - 1)
        await db.commit()
        return

    user_result = await db.execute(
        select(User).where(User.id == claim.user_id)
    )
    user = user_result.scalar_one_or_none()
    if not user:
        claim.status = "failed"
        claim.failed_at = datetime.now(timezone.utc)
        claim.failure_reason = "user_not_found"
        drop.reserved_stock = max(0, drop.reserved_stock - 1)
        await db.commit()
        return

    try:
        await send_gift_to_user(claim, drop, user, db)
    except Exception:
        # send_gift_to_user handles its own state transitions
        logger.warning("fragment_processor: delivery failed for claim %d", claim.id)

    # If max attempts exceeded and still not delivered, mark failed
    if claim.status == "pending" and claim.attempts >= _MAX_ATTEMPTS:
        claim.status = "failed"
        claim.failed_at = datetime.now(timezone.utc)
        claim.failure_reason = "max_retries_exhausted"
        drop.reserved_stock = max(0, drop.reserved_stock - 1)
        await db.commit()
        logger.warning("fragment_processor: claim %d exhausted retries", claim.id)


# ============================================
# 2. RESOLVE STUCK SENDING CLAIMS
# ============================================

async def _resolve_stuck_sending_claims() -> None:
    """
    Claims stuck in 'sending' for >5 min: outcome is unknown.
    Mark as failed and release stock. Admin can manually resolve.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=_SENDING_STALE_SECONDS)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(FragmentClaim)
            .where(
                FragmentClaim.status == "sending",
                FragmentClaim.last_attempt_at < cutoff,
            )
            .with_for_update(skip_locked=True)
            .limit(10)
        )
        stuck = list(result.scalars().all())

        if not stuck:
            return

        logger.warning("fragment_processor: %d stuck sending claim(s)", len(stuck))

        for claim in stuck:
            drop_result = await db.execute(
                select(FragmentDrop).where(FragmentDrop.id == claim.drop_id).with_for_update()
            )
            drop = drop_result.scalar_one_or_none()

            claim.status = "failed"
            claim.failed_at = now
            claim.failure_reason = "outcome_unknown_manual_review"
            if drop:
                drop.reserved_stock = max(0, drop.reserved_stock - 1)

            logger.critical(
                "fragment_processor: claim %d (user=%d, drop=%d) stuck in sending — "
                "marked failed for manual review",
                claim.id, claim.user_id, claim.drop_id,
            )

        await db.commit()


# ============================================
# 3. STARS BALANCE
# ============================================

async def _update_stars_balance() -> None:
    """Update cached Stars balance. Uses ledger sum as source of truth."""
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import func
            result = await db.execute(
                select(func.coalesce(func.sum(BotStarsLedger.amount), 0))
            )
            total = int(result.scalar_one())
            await set_cached_stars_balance(total)

            # Check if balance is critically low
            if total < settings.FRAGMENT_STARS_LOW_THRESHOLD:
                logger.warning(
                    "fragment_processor: Stars balance is low (%d < %d threshold)",
                    total, settings.FRAGMENT_STARS_LOW_THRESHOLD,
                )
            else:
                # Balance recovered — clear pause if it was set
                if await is_drops_paused():
                    await set_drops_paused(False)
                    logger.info(
                        "fragment_processor: Stars balance recovered (%d), drops unpaused",
                        total,
                    )
    except Exception:
        logger.exception("fragment_processor: failed to update Stars balance")


# ============================================
# 4. GIFT CATALOG SYNC
# ============================================

async def _sync_gift_catalog() -> None:
    """Check if configured gift IDs are still available in Telegram catalog."""
    if settings.ENVIRONMENT == "development":
        return

    try:
        bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
        try:
            gifts = await bot.get_available_gifts()
            available_ids = {g.id for g in gifts.gifts} if gifts and gifts.gifts else set()
            # Build price map: gift_id → star_count
            price_map: dict[str, int] = {}
            if gifts and gifts.gifts:
                for g in gifts.gifts:
                    if hasattr(g, "star_count") and g.star_count is not None:
                        price_map[g.id] = g.star_count
        finally:
            await bot.session.close()

        if not available_ids:
            logger.warning("fragment_processor: gift catalog is empty or API failed")
            return

        # Check active drops
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(FragmentDrop).where(FragmentDrop.is_active == True)  # noqa: E712
            )
            drops = list(result.scalars().all())

            for drop in drops:
                if drop.telegram_gift_id not in available_ids:
                    logger.critical(
                        "fragment_processor: gift %s (drop=%s) not found in Telegram catalog — deactivating",
                        drop.telegram_gift_id, drop.slug,
                    )
                    drop.is_active = False
                elif drop.telegram_gift_id in price_map:
                    actual_cost = price_map[drop.telegram_gift_id]
                    if actual_cost != drop.gift_star_cost:
                        logger.critical(
                            "fragment_processor: PRICE MISMATCH for drop=%s — "
                            "configured %d Stars, Telegram says %d Stars. "
                            "Deactivating drop to prevent ledger drift!",
                            drop.slug, drop.gift_star_cost, actual_cost,
                        )
                        drop.is_active = False

            await db.commit()

    except Exception:
        logger.exception("fragment_processor: failed to sync gift catalog")
