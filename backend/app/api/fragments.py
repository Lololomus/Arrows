"""Fragment Drops API — user-facing endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models import FragmentClaim, FragmentDrop, User
from ..schemas import (
    FragmentClaimResponse,
    FragmentClaimStatusResponse,
    FragmentDropClaimDto,
    FragmentDropDto,
    FragmentDropsResponse,
)
from ..services.i18n import get_localized_text
from ..services.fragment_gifts import (
    get_cached_stars_balance,
    get_user_progress,
    is_drops_paused,
    reserve_claim,
    send_gift_to_user,
)
from .error_utils import api_error
from .auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fragments", tags=["fragments"])


# ============================================
# GET /fragments/drops
# ============================================

def _drop_status(
    drop: FragmentDrop,
    progress: int,
    claim: FragmentClaim | None,
) -> str:
    """Вычислить статус дропа для пользователя."""
    if claim:
        if claim.status == "delivered":
            return "delivered"
        if claim.status == "failed":
            return "failed"
        return "claiming"  # pending or sending

    available = drop.total_stock - drop.reserved_stock - drop.delivered_stock
    if available <= 0:
        return "out_of_stock"

    if progress >= drop.condition_target:
        return "claimable"
    return "in_progress"


STATUS_SORT_ORDER = {
    "claimable": 0,
    "claiming": 1,
    "in_progress": 2,
    "delivered": 3,
    "failed": 4,
    "out_of_stock": 5,
}


@router.get("/drops", response_model=FragmentDropsResponse)
async def get_drops(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.FRAGMENT_DROPS_ENABLED:
        return FragmentDropsResponse(drops=[])

    user_claim_drop_ids = select(FragmentClaim.drop_id).where(FragmentClaim.user_id == user.id)
    sold_out_expr = (
        FragmentDrop.total_stock - FragmentDrop.reserved_stock - FragmentDrop.delivered_stock <= 0
    )

    # Keep active drops visible to everyone.
    # Also keep completed history visible when:
    # - the current user already has a claim for the drop; or
    # - the drop is fully exhausted and should stay in the "completed" section.
    drops_result = await db.execute(
        select(FragmentDrop)
        .where(  # noqa: E712
            or_(
                FragmentDrop.is_active == True,
                FragmentDrop.id.in_(user_claim_drop_ids),
                sold_out_expr,
            )
        )
        .order_by(FragmentDrop.priority.desc(), FragmentDrop.id)
    )
    drops = list(drops_result.scalars().all())

    if not drops:
        return FragmentDropsResponse(drops=[])

    # Fetch user's claims for these drops
    drop_ids = [d.id for d in drops]
    claims_result = await db.execute(
        select(FragmentClaim)
        .where(FragmentClaim.user_id == user.id, FragmentClaim.drop_id.in_(drop_ids))
    )
    claims_by_drop: dict[int, FragmentClaim] = {
        c.drop_id: c for c in claims_result.scalars().all()
    }

    # Build response
    dto_list: list[FragmentDropDto] = []
    for drop in drops:
        progress = get_user_progress(user, drop.condition_type)
        claim = claims_by_drop.get(drop.id)
        status = _drop_status(drop, progress, claim)
        available = drop.total_stock - drop.reserved_stock - drop.delivered_stock

        claim_dto = None
        if claim:
            claim_dto = FragmentDropClaimDto(
                status=claim.status,
                created_at=claim.created_at.isoformat() if claim.created_at else "",
                delivered_at=claim.delivered_at.isoformat() if claim.delivered_at else None,
                failure_reason=claim.failure_reason,
            )

        dto_list.append(FragmentDropDto(
            id=drop.id,
            slug=drop.slug,
            title=get_localized_text(
                drop.title_translations,
                user.locale,
                fallback_text=drop.title,
            ) or drop.slug,
            description=get_localized_text(
                drop.description_translations,
                user.locale,
                fallback_text=drop.description,
            ),
            emoji=drop.emoji,
            condition_type=drop.condition_type,
            condition_target=drop.condition_target,
            remaining_stock=max(0, available),
            total_stock=drop.total_stock,
            gift_star_cost=drop.gift_star_cost,
            progress=progress,
            status=status,
            claim=claim_dto,
        ))

    # Sort: claimable first, then in_progress, etc.
    dto_list.sort(key=lambda d: (STATUS_SORT_ORDER.get(d.status, 99), -d.progress))

    return FragmentDropsResponse(drops=dto_list)


# ============================================
# POST /fragments/drops/{drop_id}/claim
# ============================================

@router.post("/drops/{drop_id}/claim", response_model=FragmentClaimResponse)
async def claim_drop(
    drop_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.FRAGMENT_DROPS_ENABLED:
        raise api_error(403, "FRAGMENTS_DISABLED", "Fragment drops are temporarily unavailable")

    # Lock user row
    locked_user_result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    locked_user = locked_user_result.scalar_one_or_none()
    if not locked_user:
        raise api_error(401, "USER_NOT_FOUND", "User not found")

    # Lock drop row
    drop_result = await db.execute(
        select(FragmentDrop)
        .where(FragmentDrop.id == drop_id, FragmentDrop.is_active == True)  # noqa: E712
        .with_for_update()
    )
    drop = drop_result.scalar_one_or_none()
    if not drop:
        raise api_error(404, "DROP_NOT_FOUND", "Drop not found")

    # Check condition
    progress = get_user_progress(locked_user, drop.condition_type)
    if progress < drop.condition_target:
        raise api_error(409, "CONDITION_NOT_MET", "Claim condition is not met yet")

    # Check for existing claim (retry scenario)
    existing_result = await db.execute(
        select(FragmentClaim)
        .where(FragmentClaim.drop_id == drop_id, FragmentClaim.user_id == locked_user.id)
        .with_for_update()
    )
    existing_claim = existing_result.scalar_one_or_none()

    if existing_claim:
        if existing_claim.status == "delivered":
            raise api_error(409, "ALREADY_CLAIMED", "This drop has already been claimed")
        if existing_claim.status in ("pending", "sending"):
            # Delivery already in progress
            return FragmentClaimResponse(
                success=True,
                claim_status="sending",
                message="Gift delivery is already in progress",
                code="CLAIM_IN_PROGRESS",
            )
        # status == "failed" → reset for retry, re-reserve stock
        # SAFETY: outcome_unknown claims may have been delivered — only admin can resolve
        if existing_claim.failure_reason == "outcome_unknown_manual_review":
            raise api_error(409, "MANUAL_REVIEW_REQUIRED", "Claim requires manual review")
        if existing_claim.attempts >= settings.FRAGMENT_MAX_CLAIM_ATTEMPTS:
            raise api_error(409, "MAX_RETRIES_EXHAUSTED", "Maximum delivery attempts exceeded")
        available = drop.total_stock - drop.reserved_stock - drop.delivered_stock
        if available <= 0:
            raise api_error(409, "OUT_OF_STOCK", "This drop is out of stock")
        # Same pause/balance checks as reserve_claim
        if settings.ENVIRONMENT != "development":
            if await is_drops_paused():
                raise api_error(409, "INSUFFICIENT_BOT_STARS", "Gift delivery is temporarily unavailable")
            cached_balance = await get_cached_stars_balance()
            if cached_balance is not None and cached_balance < drop.gift_star_cost:
                raise api_error(409, "INSUFFICIENT_BOT_STARS", "Gift delivery is temporarily unavailable")
        existing_claim.status = "pending"
        existing_claim.failure_reason = None
        existing_claim.failed_at = None
        existing_claim.last_attempt_at = None
        # Keep attempts count — don't reset to avoid infinite retries
        drop.reserved_stock += 1
        claim = existing_claim
        await db.commit()
    else:
        # Phase 1: reserve stock + create claim
        claim = await reserve_claim(locked_user, drop, db)
        await db.commit()

    # Phase 2: send gift (outside main transaction)
    claim_status = await send_gift_to_user(claim, drop, locked_user, db)

    if claim_status == "delivered":
        return FragmentClaimResponse(
            success=True,
            claim_status="delivered",
            message="Gift delivered",
            code="CLAIM_DELIVERED",
        )

    # Retriable — delivery in progress
    return FragmentClaimResponse(
        success=True,
        claim_status="sending",
        message="Gift delivery is in progress",
        code="CLAIM_SENDING",
    )


# ============================================
# GET /fragments/drops/{drop_id}/claim/status
# ============================================

@router.get("/drops/{drop_id}/claim/status", response_model=FragmentClaimStatusResponse)
async def get_claim_status(
    drop_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    claim_result = await db.execute(
        select(FragmentClaim)
        .where(FragmentClaim.drop_id == drop_id, FragmentClaim.user_id == user.id)
    )
    claim = claim_result.scalar_one_or_none()
    if not claim:
        raise api_error(404, "CLAIM_NOT_FOUND", "Claim not found")

    return FragmentClaimStatusResponse(
        claim_status=claim.status,
        failure_reason=claim.failure_reason,
        attempts=claim.attempts,
        created_at=claim.created_at.isoformat() if claim.created_at else "",
        delivered_at=claim.delivered_at.isoformat() if claim.delivered_at else None,
    )
