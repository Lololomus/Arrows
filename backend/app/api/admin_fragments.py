"""Admin API for Fragment Drops management."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models import BotStarsLedger, FragmentClaim, FragmentDrop
from ..schemas import (
    AddStockRequest,
    FragmentDropCreateRequest,
    FragmentDropUpdateRequest,
    ResolveClaimRequest,
)
from ..services.fragment_gifts import get_cached_stars_balance, set_cached_stars_balance, set_drops_paused

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/fragments", tags=["admin-fragments"])


def _require_admin_key(x_api_key: str = Header("")) -> None:
    if not settings.ADMIN_API_KEY or x_api_key != settings.ADMIN_API_KEY:
        raise HTTPException(status_code=403, detail="Unauthorized")


async def _get_ledger_balance(db: AsyncSession) -> int:
    """Get Stars balance from DB ledger (authoritative, not Redis cache)."""
    result = await db.execute(
        select(func.coalesce(func.sum(BotStarsLedger.amount), 0))
    )
    return int(result.scalar_one())


async def _get_committed_budget(db: AsyncSession, *, exclude_drop_id: int | None = None) -> int:
    """Get total committed Stars budget across all active drops."""
    query = select(
        func.coalesce(
            func.sum(
                (FragmentDrop.total_stock - FragmentDrop.delivered_stock) * FragmentDrop.gift_star_cost
            ),
            0,
        )
    ).where(FragmentDrop.is_active == True)  # noqa: E712
    if exclude_drop_id is not None:
        query = query.where(FragmentDrop.id != exclude_drop_id)
    result = await db.execute(query)
    return int(result.scalar_one())


async def _check_budget(
    db: AsyncSession,
    additional_stars: int,
    *,
    exclude_drop_id: int | None = None,
    context: str = "",
) -> None:
    """Raise 409 if additional_stars would exceed ledger balance minus committed budget."""
    ledger_balance = await _get_ledger_balance(db)
    committed = await _get_committed_budget(db, exclude_drop_id=exclude_drop_id)
    available = ledger_balance - committed

    if additional_stars > available:
        raise HTTPException(status_code=409, detail={
            "code": "INSUFFICIENT_BUDGET",
            "message": (
                f"{context + ': ' if context else ''}"
                f"Need {additional_stars}⭐ but only {available}⭐ available "
                f"(ledger={ledger_balance}⭐, committed={committed}⭐)."
            ),
        })


# ============================================
# DROPS CRUD
# ============================================

@router.post("/drops", status_code=201)
async def create_drop(
    body: FragmentDropCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin_key),
):
    drop = FragmentDrop(
        slug=body.slug,
        title=body.title,
        description=body.description,
        emoji=body.emoji,
        telegram_gift_id=body.telegram_gift_id,
        gift_star_cost=body.gift_star_cost,
        condition_type=body.condition_type,
        condition_target=body.condition_target,
        total_stock=body.total_stock,
    )
    db.add(drop)

    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Slug already exists")

    # Budget check from DB ledger (not Redis)
    new_budget = drop.total_stock * drop.gift_star_cost
    await _check_budget(db, new_budget, exclude_drop_id=drop.id, context="Create drop")

    await db.commit()
    await db.refresh(drop)

    return {
        "success": True,
        "drop": _drop_to_dict(drop),
        "stars_budget": new_budget,
    }


@router.get("/drops")
async def list_drops(
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin_key),
):
    result = await db.execute(
        select(FragmentDrop).order_by(FragmentDrop.id.desc())
    )
    drops = list(result.scalars().all())
    return {"drops": [_drop_to_dict(d) for d in drops]}


@router.patch("/drops/{drop_id}")
async def update_drop(
    drop_id: int,
    body: FragmentDropUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin_key),
):
    drop_result = await db.execute(
        select(FragmentDrop).where(FragmentDrop.id == drop_id).with_for_update()
    )
    drop = drop_result.scalar_one_or_none()
    if not drop:
        raise HTTPException(status_code=404, detail="Drop not found")

    updates = body.model_dump(exclude_none=True)

    if "total_stock" in updates:
        min_stock = drop.reserved_stock + drop.delivered_stock
        if updates["total_stock"] < min_stock:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot reduce total_stock below {min_stock} (reserved + delivered)",
            )

    # Apply updates first (in memory, not committed), then budget-check
    old_total_stock = drop.total_stock
    old_is_active = drop.is_active
    old_gift_star_cost = drop.gift_star_cost

    for key, value in updates.items():
        setattr(drop, key, value)

    # Budget check if: stock increased, price increased, or drop being activated
    becoming_active = not old_is_active and drop.is_active
    budget_changed = (
        drop.total_stock > old_total_stock
        or drop.gift_star_cost > old_gift_star_cost
        or becoming_active
    )

    if budget_changed and drop.is_active:
        new_drop_budget = (drop.total_stock - drop.delivered_stock) * drop.gift_star_cost
        await _check_budget(db, new_drop_budget, exclude_drop_id=drop.id, context="Update drop")

    await db.commit()
    await db.refresh(drop)
    return {"success": True, "drop": _drop_to_dict(drop)}


@router.post("/drops/{drop_id}/add-stock")
async def add_stock(
    drop_id: int,
    body: AddStockRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin_key),
):
    drop_result = await db.execute(
        select(FragmentDrop).where(FragmentDrop.id == drop_id).with_for_update()
    )
    drop = drop_result.scalar_one_or_none()
    if not drop:
        raise HTTPException(status_code=404, detail="Drop not found")

    # Budget check from DB ledger
    additional_budget = body.additional_stock * drop.gift_star_cost
    await _check_budget(db, additional_budget, context="Add stock")

    drop.total_stock += body.additional_stock
    await db.commit()
    await db.refresh(drop)
    return {"success": True, "drop": _drop_to_dict(drop)}


# ============================================
# CLAIMS
# ============================================

@router.get("/drops/{drop_id}/claims")
async def list_claims(
    drop_id: int,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin_key),
):
    result = await db.execute(
        select(FragmentClaim)
        .where(FragmentClaim.drop_id == drop_id)
        .order_by(FragmentClaim.created_at.desc())
    )
    claims = list(result.scalars().all())
    return {"claims": [_claim_to_dict(c) for c in claims]}


@router.post("/claims/{claim_id}/resolve")
async def resolve_claim(
    claim_id: int,
    body: ResolveClaimRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin_key),
):
    claim_result = await db.execute(
        select(FragmentClaim).where(FragmentClaim.id == claim_id).with_for_update()
    )
    claim = claim_result.scalar_one_or_none()
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    drop_result = await db.execute(
        select(FragmentDrop).where(FragmentDrop.id == claim.drop_id).with_for_update()
    )
    drop = drop_result.scalar_one_or_none()

    now = datetime.now(timezone.utc)

    if body.action == "mark_delivered":
        if claim.status == "delivered":
            raise HTTPException(status_code=409, detail="Claim already delivered")

        was_reserving = claim.status in ("pending", "sending")
        was_failed = claim.status == "failed"

        claim.status = "delivered"
        claim.delivered_at = now
        claim.failure_reason = None
        if drop:
            if was_reserving:
                drop.reserved_stock = max(0, drop.reserved_stock - 1)
            drop.delivered_stock += 1

        # Only write ledger if not already accounted (failed claims had no ledger entry)
        db.add(BotStarsLedger(
            event_type="gift_sent",
            amount=-claim.stars_cost,
            fragment_claim_id=claim.id,
            note=f"admin_resolve: mark_delivered (was={'failed' if was_failed else 'pending/sending'})",
        ))

    elif body.action == "mark_failed":
        if claim.status == "delivered":
            raise HTTPException(
                status_code=409,
                detail="Cannot mark a delivered claim as failed — gift already sent",
            )
        was_reserving = claim.status in ("pending", "sending")
        claim.status = "failed"
        claim.failed_at = now
        claim.failure_reason = "admin_resolved"
        if drop and was_reserving:
            drop.reserved_stock = max(0, drop.reserved_stock - 1)

    elif body.action == "retry":
        if claim.status not in ("failed",):
            raise HTTPException(status_code=409, detail="Can only retry failed claims")
        if claim.failure_reason == "outcome_unknown_manual_review":
            raise HTTPException(
                status_code=409,
                detail="Cannot auto-retry outcome_unknown claims — use mark_delivered or mark_failed first",
            )
        if drop:
            available = drop.total_stock - drop.reserved_stock - drop.delivered_stock
            if available <= 0:
                raise HTTPException(
                    status_code=409,
                    detail="Cannot retry — drop is out of stock",
                )
        claim.status = "pending"
        claim.failed_at = None
        claim.failure_reason = None
        claim.attempts = 0
        if drop:
            drop.reserved_stock += 1

    await db.commit()

    logger.info("admin_fragments: claim %d resolved as %s", claim_id, body.action)
    return {"success": True, "claim": _claim_to_dict(claim)}


# ============================================
# STARS
# ============================================

@router.get("/stars-status")
async def stars_status(
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin_key),
):
    # Ledger total
    result = await db.execute(
        select(func.coalesce(func.sum(BotStarsLedger.amount), 0))
    )
    ledger_balance = int(result.scalar_one())

    # Committed budget across active campaigns
    result = await db.execute(
        select(
            func.coalesce(
                func.sum(
                    (FragmentDrop.total_stock - FragmentDrop.delivered_stock) * FragmentDrop.gift_star_cost
                ),
                0,
            )
        ).where(FragmentDrop.is_active == True)  # noqa: E712
    )
    committed = int(result.scalar_one())

    cached_balance = await get_cached_stars_balance()

    return {
        "ledger_balance": ledger_balance,
        "committed_budget": committed,
        "available": ledger_balance - committed,
        "cached_balance": cached_balance,
    }


@router.post("/stars/topup")
async def manual_topup(
    amount: int,
    note: str = "manual",
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin_key),
):
    """Record a manual Stars top-up (admin sent Stars to bot)."""
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    db.add(BotStarsLedger(
        event_type="manual_topup",
        amount=amount,
        note=note,
    ))
    await db.commit()

    # Recompute and update cached balance so reserve_claim sees it immediately
    result = await db.execute(
        select(func.coalesce(func.sum(BotStarsLedger.amount), 0))
    )
    new_balance = int(result.scalar_one())
    await set_cached_stars_balance(new_balance)

    # Clear pause flag — admin topped up, drops should resume
    await set_drops_paused(False)

    return {"success": True, "amount": amount, "new_balance": new_balance}


# ============================================
# HELPERS
# ============================================

def _drop_to_dict(drop: FragmentDrop) -> dict:
    available = drop.total_stock - drop.reserved_stock - drop.delivered_stock
    return {
        "id": drop.id,
        "slug": drop.slug,
        "title": drop.title,
        "description": drop.description,
        "emoji": drop.emoji,
        "telegram_gift_id": drop.telegram_gift_id,
        "gift_star_cost": drop.gift_star_cost,
        "condition_type": drop.condition_type,
        "condition_target": drop.condition_target,
        "total_stock": drop.total_stock,
        "reserved_stock": drop.reserved_stock,
        "delivered_stock": drop.delivered_stock,
        "available_stock": max(0, available),
        "is_active": drop.is_active,
        "priority": drop.priority,
        "created_at": drop.created_at.isoformat() if drop.created_at else None,
    }


def _claim_to_dict(claim: FragmentClaim) -> dict:
    return {
        "id": claim.id,
        "drop_id": claim.drop_id,
        "user_id": claim.user_id,
        "status": claim.status,
        "telegram_gift_id": claim.telegram_gift_id,
        "stars_cost": claim.stars_cost,
        "failure_reason": claim.failure_reason,
        "attempts": claim.attempts,
        "created_at": claim.created_at.isoformat() if claim.created_at else None,
        "delivered_at": claim.delivered_at.isoformat() if claim.delivered_at else None,
        "failed_at": claim.failed_at.isoformat() if claim.failed_at else None,
    }
