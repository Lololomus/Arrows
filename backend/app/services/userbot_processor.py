from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import or_, select

from ..config import settings
from ..database import AsyncSessionLocal
from ..models import UserbotGiftOrder
from .userbot_gift_sender import (
    UserbotActivationRequired,
    UserbotPermanentError,
    UserbotProcessingUnknown,
    UserbotRetryLater,
    add_ledger_event,
    get_circuit_breaker_until,
    is_circuit_breaker_open,
    is_low_balance_paused,
    process_userbot_order,
    refresh_gift_catalog_cache,
    refresh_observed_stars_balance,
    utcnow_naive,
)

logger = logging.getLogger(__name__)


# TODO: Когда USERBOT_API_ID и USERBOT_API_HASH будут добавлены в .env,
#       установи USERBOT_ENABLED=True — этот цикл возьмёт на себя обработку
#       заказов автоматически вместо ручных уведомлений в manual_gift_notifier.py.
#       Поток UserbotGiftOrder остаётся неизменным: pending → processing → completed/failed.
async def userbot_processor_loop() -> None:
    logger.info(
        "userbot_processor: started (interval=%ds)",
        settings.USERBOT_PROCESSOR_INTERVAL,
    )
    while True:
        try:
            await _run_cycle()
        except Exception:
            logger.exception("userbot_processor: unexpected error in cycle")
        await asyncio.sleep(settings.USERBOT_PROCESSOR_INTERVAL)


async def _run_cycle() -> None:
    await _resolve_stuck_processing_orders()
    await _refresh_observed_stars_balance()
    await _refresh_catalog_cache()

    if await is_circuit_breaker_open():
        breaker_until = await get_circuit_breaker_until()
        logger.warning(
            "userbot_processor: circuit breaker active until %s",
            breaker_until.isoformat() if breaker_until else "unknown",
        )
        return

    await _process_pending_orders()


def _should_defer_for_low_balance(order: UserbotGiftOrder) -> bool:
    if order.operation_type == "send_gift":
        return True
    if order.operation_type != "transfer_gift":
        return False
    return int(order.star_cost_estimate or 0) > 0


async def _resolve_stuck_processing_orders() -> None:
    cutoff = utcnow_naive() - timedelta(seconds=settings.USERBOT_PROCESSING_TIMEOUT)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(UserbotGiftOrder)
            .where(
                UserbotGiftOrder.status == "processing",
                UserbotGiftOrder.processing_started_at != None,  # noqa: E711
                UserbotGiftOrder.processing_started_at < cutoff,
            )
            .with_for_update(skip_locked=True)
            .limit(10)
        )
        orders = list(result.scalars().all())
        if not orders:
            return

        logger.warning("userbot_processor: %d stuck processing order(s)", len(orders))
        now = utcnow_naive()
        for order in orders:
            order.status = "failed"
            order.failure_reason = "outcome_unknown_manual_review"
            order.failed_at = now
            order.processing_started_at = None
        await db.commit()


async def _refresh_observed_stars_balance() -> None:
    try:
        await refresh_observed_stars_balance()
    except Exception:
        logger.exception("userbot_processor: failed to refresh observed Stars balance")


async def _refresh_catalog_cache() -> None:
    try:
        await refresh_gift_catalog_cache()
    except Exception:
        logger.exception("userbot_processor: failed to refresh gift catalog")


async def _process_pending_orders() -> None:
    now = utcnow_naive()
    low_balance_paused = await is_low_balance_paused()
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(UserbotGiftOrder)
            .where(
                UserbotGiftOrder.status == "pending",
                UserbotGiftOrder.attempts < UserbotGiftOrder.max_attempts,
                or_(
                    UserbotGiftOrder.retry_after == None,  # noqa: E711
                    UserbotGiftOrder.retry_after <= now,
                ),
            )
            .order_by(UserbotGiftOrder.priority.desc(), UserbotGiftOrder.created_at.asc())
            .with_for_update(skip_locked=True)
            .limit(10)
        )
        orders = list(result.scalars().all())
        if not orders:
            return

        logger.info("userbot_processor: %d order(s) ready", len(orders))
        for order in orders:
            if low_balance_paused and _should_defer_for_low_balance(order):
                order.retry_after = now + timedelta(seconds=300)
                order.failure_reason = "low_observed_balance"
                continue
            try:
                await _attempt_order(db, order)
            except Exception:
                logger.exception("userbot_processor: failed to process order %d", order.id)
        await db.commit()


async def _attempt_order(db, order: UserbotGiftOrder) -> None:
    now = utcnow_naive()
    order.status = "processing"
    order.attempts = int(order.attempts or 0) + 1
    order.processing_started_at = now
    order.retry_after = None
    order.failed_at = None
    await db.commit()

    try:
        result = await process_userbot_order(order, db)
    except UserbotRetryLater as exc:
        await _reschedule_order(db, order, retry_after=exc.retry_after, failure_reason=exc.reason)
        return
    except UserbotActivationRequired as exc:
        await _set_activation_required(db, order, failure_reason=str(exc))
        return
    except UserbotPermanentError as exc:
        await _fail_order(db, order, failure_reason=str(exc))
        return
    except UserbotProcessingUnknown:
        await _fail_order(db, order, failure_reason="outcome_unknown_manual_review")
        return
    except Exception:
        delay = min(30 * (2 ** int(order.attempts or 0)), 600)
        await _reschedule_order(db, order, retry_after=delay, failure_reason="unexpected_retryable_error")
        return

    order.status = "completed"
    order.processing_started_at = None
    order.completed_at = utcnow_naive()
    order.failure_reason = None
    order.telegram_result_json = result.telegram_result_json
    if result.star_cost_estimate is not None:
        order.star_cost_estimate = result.star_cost_estimate
    if result.ledger_event_type and result.ledger_amount:
        await add_ledger_event(
            db,
            event_type=result.ledger_event_type,
            amount=result.ledger_amount,
            gift_order_id=order.id,
            note=f"order={order.id}",
        )
    await db.commit()


async def _reschedule_order(
    db,
    order: UserbotGiftOrder,
    *,
    retry_after: int,
    failure_reason: str,
) -> None:
    if int(order.attempts or 0) >= int(order.max_attempts or settings.USERBOT_MAX_ORDER_ATTEMPTS):
        await _fail_order(db, order, failure_reason="max_retries_exhausted")
        return

    order.status = "pending"
    order.processing_started_at = None
    order.retry_after = utcnow_naive() + timedelta(seconds=max(1, retry_after))
    order.failure_reason = failure_reason[:256]
    await db.commit()


async def _fail_order(db, order: UserbotGiftOrder, *, failure_reason: str) -> None:
    order.status = "failed"
    order.processing_started_at = None
    order.retry_after = None
    order.failed_at = utcnow_naive()
    order.failure_reason = failure_reason[:256]
    await db.commit()


async def _set_activation_required(db, order: UserbotGiftOrder, *, failure_reason: str) -> None:
    order.status = "activation_required"
    order.processing_started_at = None
    order.retry_after = None
    order.failed_at = None
    order.failure_reason = failure_reason[:256]
    await db.commit()
