"""
Arrow Puzzle - Onboarding API

Marks onboarding as completed for a user (idempotent).
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models import User
from ..schemas import UserResponse
from .auth import get_current_user, serialize_user

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


class OnboardingDevResetRequest(BaseModel):
    mode: Literal["new_user", "existing_user"]


def _ensure_dev() -> None:
    if settings.ENVIRONMENT != "development":
        raise HTTPException(status_code=403, detail="Dev endpoints are disabled")


@router.post("/complete")
async def complete_onboarding(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark onboarding slides as shown. Idempotent."""
    if not getattr(user, "onboarding_shown", False):
        result = await db.execute(
            select(User).where(User.id == user.id).with_for_update()
        )
        locked = result.scalar_one_or_none()
        if locked and not locked.onboarding_shown:
            locked.onboarding_shown = True
            await db.commit()
    return {"success": True}


@router.post("/dev/reset", response_model=UserResponse)
async def dev_reset_onboarding_state(
    payload: OnboardingDevResetRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_dev()

    result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    locked = result.scalar_one_or_none()
    if locked is None:
        raise HTTPException(status_code=404, detail="User not found")

    locked.onboarding_shown = False

    if payload.mode == "new_user":
        locked.welcome_offer_opened_at = None
        locked.welcome_offer_purchased = False

    await db.commit()
    await db.refresh(locked)

    if payload.mode == "new_user":
        from ..database import get_redis

        redis_client = await get_redis()
        if redis_client is not None:
            await redis_client.delete(f"welcome_offer_pending:{locked.id}")

    return UserResponse.model_validate(serialize_user(locked))
