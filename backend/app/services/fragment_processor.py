"""
Background processor for fragment drop claims.

Runs every 60 seconds:
  1. Recovers stuck pending claims
  2. Resolves stuck sending claims
  3. Updates Stars balance cache in Redis
  4. Syncs gift catalog every ~5 min
"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

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
    utcnow_naive,
)
from .telegram_gifts_api import get_available_gifts

logger = logging.getLogger(__name__)

_LOOP_INTERVAL = 60
_PENDING_STALE_SECONDS = 30
_SENDING_STALE_SECONDS = settings.FRAGMENT_SENDING_TIMEOUT
_MAX_ATTEMPTS = settings.FRAGMENT_MAX_CLAIM_ATTEMPTS
_CATALOG_SYNC_CYCLES = 5

_cycle_counter = 0


async def fragment_processor_loop() -> None:
    logger.info("fragment_processor: started (interval=%ds)", _LOOP_INTERVAL)
    while True:
        try:
            await _run_cycle()
        except Exception:
            logger.exception("fragment_processor: unexpected error in cycle")
        await asyncio.sleep(_LOOP_INTERVAL)


async def _run_cycle() -> None:
    global _cycle_counter
    _cycle_counter += 1

    await _recover_pending_claims()
    await _resolve_stuck_sending_claims()
    await _update_stars_balance()

    if _cycle_counter % _CATALOG_SYNC_CYCLES == 0:
        await _sync_gift_catalog()


async def _recover_pending_claims() -> None:
    now = utcnow_naive()
    min_cutoff = now - timedelta(seconds=_PENDING_STALE_SECONDS)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(FragmentClaim)
            .where(
                FragmentClaim.status == "pending",
                FragmentClaim.attempts < _MAX_ATTEMPTS,
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

        ready: list[FragmentClaim] = []
        for claim in claims:
            attempts = int(claim.attempts or 0)
            backoff = min(_PENDING_STALE_SECONDS * (2 ** attempts), 600)
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
    drop_result = await db.execute(
        select(FragmentDrop).where(FragmentDrop.id == claim.drop_id).with_for_update()
    )
    drop = drop_result.scalar_one_or_none()
    if not drop or not drop.is_active:
        claim.status = "failed"
        claim.failed_at = utcnow_naive()
        claim.failure_reason = "campaign_deactivated"
        if drop:
            drop.reserved_stock = max(0, drop.reserved_stock - 1)
        await db.commit()
        return

    user_result = await db.execute(select(User).where(User.id == claim.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        claim.status = "failed"
        claim.failed_at = utcnow_naive()
        claim.failure_reason = "user_not_found"
        drop.reserved_stock = max(0, drop.reserved_stock - 1)
        await db.commit()
        return

    try:
        await send_gift_to_user(claim, drop, user, db)
    except Exception:
        logger.warning("fragment_processor: delivery failed for claim %d", claim.id)

    if claim.status == "pending" and int(claim.attempts or 0) >= _MAX_ATTEMPTS:
        claim.status = "failed"
        claim.failed_at = utcnow_naive()
        claim.failure_reason = "max_retries_exhausted"
        drop.reserved_stock = max(0, drop.reserved_stock - 1)
        await db.commit()
        logger.warning("fragment_processor: claim %d exhausted retries", claim.id)


async def _resolve_stuck_sending_claims() -> None:
    now = utcnow_naive()
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
                "fragment_processor: claim %d (user=%d, drop=%d) stuck in sending - marked failed for manual review",
                claim.id, claim.user_id, claim.drop_id,
            )

        await db.commit()


async def _update_stars_balance() -> None:
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import func

            result = await db.execute(
                select(func.coalesce(func.sum(BotStarsLedger.amount), 0))
            )
            total = int(result.scalar_one())
            await set_cached_stars_balance(total)

            if total < settings.FRAGMENT_STARS_LOW_THRESHOLD:
                logger.warning(
                    "fragment_processor: Stars balance is low (%d < %d threshold)",
                    total, settings.FRAGMENT_STARS_LOW_THRESHOLD,
                )
            else:
                if await is_drops_paused():
                    await set_drops_paused(False)
                    logger.info(
                        "fragment_processor: Stars balance recovered (%d), drops unpaused",
                        total,
                    )
    except Exception:
        logger.exception("fragment_processor: failed to update Stars balance")


async def _sync_gift_catalog() -> None:
    if settings.ENVIRONMENT == "development":
        return

    try:
        gifts = await get_available_gifts(bot_token=settings.TELEGRAM_BOT_TOKEN)
        available_ids = {str(g["id"]) for g in gifts if g.get("id") is not None}
        price_map: dict[str, int] = {}
        for gift in gifts:
            gift_id = gift.get("id")
            star_count = gift.get("star_count")
            if gift_id is not None and star_count is not None:
                price_map[str(gift_id)] = int(star_count)

        if not available_ids:
            logger.warning("fragment_processor: gift catalog is empty or API failed")
            return

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(FragmentDrop).where(FragmentDrop.is_active == True)  # noqa: E712
            )
            drops = list(result.scalars().all())

            for drop in drops:
                if drop.telegram_gift_id not in available_ids:
                    logger.critical(
                        "fragment_processor: gift %s (drop=%s) not found in Telegram catalog - deactivating",
                        drop.telegram_gift_id, drop.slug,
                    )
                    drop.is_active = False
                elif drop.telegram_gift_id in price_map:
                    actual_cost = price_map[drop.telegram_gift_id]
                    if actual_cost != drop.gift_star_cost:
                        logger.critical(
                            "fragment_processor: PRICE MISMATCH for drop=%s - configured %d Stars, Telegram says %d Stars. Deactivating drop to prevent ledger drift!",
                            drop.slug, drop.gift_star_cost, actual_cost,
                        )
                        drop.is_active = False

            await db.commit()

    except Exception:
        logger.exception("fragment_processor: failed to sync gift catalog")
