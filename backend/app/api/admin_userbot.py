from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models import UserbotGiftOrder
from ..schemas import (
    UserbotGiftOperation,
    UserbotGiftOrderStatus,
    UserbotOrderDto,
    UserbotOrderResolveRequest,
    UserbotOrdersResponse,
    UserbotStarsTopupRequest,
    UserbotStatusResponse,
)
from ..services.userbot_client import userbot_client
from ..services.userbot_gift_sender import (
    add_ledger_event,
    get_cached_gift_catalog_count,
    get_cached_observed_stars_balance,
    get_cached_observed_stars_balance_updated_at,
    get_circuit_breaker_until,
    get_ledger_balance,
    get_order_ledger_total,
    is_circuit_breaker_open,
    is_low_balance_paused,
    utcnow_naive,
)

router = APIRouter(prefix="/admin/userbot", tags=["admin-userbot"])


def _require_admin_key(x_api_key: str = Header("")) -> None:
    if not settings.ADMIN_API_KEY or x_api_key != settings.ADMIN_API_KEY:
        raise HTTPException(status_code=403, detail="Unauthorized")


def _require_userbot_enabled() -> None:
    if not settings.USERBOT_ENABLED:
        raise HTTPException(status_code=409, detail="Userbot is disabled")


def _order_to_dto(order: UserbotGiftOrder) -> UserbotOrderDto:
    return UserbotOrderDto(
        id=order.id,
        user_id=order.user_id,
        recipient_telegram_id=order.recipient_telegram_id,
        operation_type=order.operation_type,
        status=order.status,
        telegram_gift_id=order.telegram_gift_id,
        owned_gift_slug=order.owned_gift_slug,
        star_cost_estimate=order.star_cost_estimate,
        priority=int(order.priority or 0),
        attempts=int(order.attempts or 0),
        max_attempts=int(order.max_attempts or 0),
        retry_after=order.retry_after.isoformat() if order.retry_after else None,
        failure_reason=order.failure_reason,
        source_kind=order.source_kind,
        source_ref=order.source_ref,
        telegram_result_json=order.telegram_result_json,
        created_at=order.created_at.isoformat() if order.created_at else None,
        processing_started_at=order.processing_started_at.isoformat() if order.processing_started_at else None,
        completed_at=order.completed_at.isoformat() if order.completed_at else None,
        failed_at=order.failed_at.isoformat() if order.failed_at else None,
    )


@router.get("/status", response_model=UserbotStatusResponse)
async def get_userbot_status(
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin_key),
):
    ledger_balance = await get_ledger_balance(db)
    observed_balance = await get_cached_observed_stars_balance()
    observed_balance_updated_at = await get_cached_observed_stars_balance_updated_at()
    low_balance_paused = await is_low_balance_paused()
    circuit_breaker_active = await is_circuit_breaker_open()
    circuit_breaker_until = await get_circuit_breaker_until()
    catalog_count = await get_cached_gift_catalog_count()

    pending_orders = int(
        (
            await db.execute(
                select(func.count(UserbotGiftOrder.id)).where(UserbotGiftOrder.status == "pending")
            )
        ).scalar_one()
    )
    processing_orders = int(
        (
            await db.execute(
                select(func.count(UserbotGiftOrder.id)).where(UserbotGiftOrder.status == "processing")
            )
        ).scalar_one()
    )
    failed_orders = int(
        (
            await db.execute(
                select(func.count(UserbotGiftOrder.id)).where(UserbotGiftOrder.status == "failed")
            )
        ).scalar_one()
    )
    activation_required_orders = int(
        (
            await db.execute(
                select(func.count(UserbotGiftOrder.id)).where(
                    UserbotGiftOrder.status == "activation_required"
                )
            )
        ).scalar_one()
    )

    connected = False
    authorized = False
    if settings.USERBOT_ENABLED:
        connected = await userbot_client.is_connected()
        authorized = await userbot_client.is_authorized()
        connected = connected or authorized

    return UserbotStatusResponse(
        enabled=settings.USERBOT_ENABLED,
        connected=connected,
        authorized=authorized,
        session_path=settings.USERBOT_SESSION_PATH,
        ledger_balance=ledger_balance,
        observed_balance=observed_balance,
        observed_balance_updated_at=observed_balance_updated_at,
        low_balance_paused=low_balance_paused,
        circuit_breaker_active=circuit_breaker_active,
        circuit_breaker_until=circuit_breaker_until.isoformat() if circuit_breaker_until else None,
        catalog_count=catalog_count,
        pending_orders=pending_orders,
        processing_orders=processing_orders,
        failed_orders=failed_orders,
        activation_required_orders=activation_required_orders,
    )


@router.get("/orders", response_model=UserbotOrdersResponse)
async def list_orders(
    status: UserbotGiftOrderStatus | None = None,
    operation_type: UserbotGiftOperation | None = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin_key),
):
    query = select(UserbotGiftOrder).order_by(UserbotGiftOrder.created_at.desc()).limit(limit)
    if status is not None:
        query = query.where(UserbotGiftOrder.status == status)
    if operation_type is not None:
        query = query.where(UserbotGiftOrder.operation_type == operation_type)
    result = await db.execute(query)
    orders = list(result.scalars().all())
    return UserbotOrdersResponse(orders=[_order_to_dto(order) for order in orders])


@router.post("/orders/{order_id}/resolve", response_model=UserbotOrderDto)
async def resolve_order(
    order_id: int,
    body: UserbotOrderResolveRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin_key),
):
    _require_userbot_enabled()
    result = await db.execute(
        select(UserbotGiftOrder).where(UserbotGiftOrder.id == order_id).with_for_update()
    )
    order = result.scalar_one_or_none()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")

    if body.action == "retry":
        if order.status == "completed":
            raise HTTPException(status_code=409, detail="Cannot retry a completed order")
        order.status = "pending"
        order.retry_after = None
        order.failed_at = None
        order.failure_reason = None
        order.processing_started_at = None
        order.completed_at = None
        order.attempts = 0
        await db.commit()
        await db.refresh(order)
        return _order_to_dto(order)

    if body.action == "mark_failed":
        if order.status == "completed":
            raise HTTPException(status_code=409, detail="Completed order cannot be marked failed")
        order.status = "failed"
        order.retry_after = None
        order.processing_started_at = None
        order.failed_at = utcnow_naive()
        order.failure_reason = body.note or "admin_resolved"
        await db.commit()
        await db.refresh(order)
        return _order_to_dto(order)

    if order.status == "completed":
        raise HTTPException(status_code=409, detail="Order already completed")

    order.status = "completed"
    order.retry_after = None
    order.processing_started_at = None
    order.failed_at = None
    order.failure_reason = None
    order.completed_at = utcnow_naive()
    if body.telegram_result_json is not None:
        order.telegram_result_json = body.telegram_result_json

    existing_total = await get_order_ledger_total(db, order.id)
    if existing_total == 0 and int(order.star_cost_estimate or 0) > 0:
        await add_ledger_event(
            db,
            event_type="reconcile_adjustment",
            amount=-int(order.star_cost_estimate or 0),
            gift_order_id=order.id,
            note=body.note or "admin_mark_completed",
        )

    await db.commit()
    await db.refresh(order)
    return _order_to_dto(order)


@router.post("/stars/topup")
async def topup_stars(
    body: UserbotStarsTopupRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin_key),
):
    _require_userbot_enabled()
    await add_ledger_event(
        db,
        event_type="manual_topup",
        amount=body.amount,
        gift_order_id=None,
        note=body.note,
    )
    await db.commit()
    new_balance = await get_ledger_balance(db)
    return {"success": True, "amount": body.amount, "new_balance": new_balance}
