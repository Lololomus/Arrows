"""Tasks API."""

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models import ChannelSubscription, TaskClaim, User
from ..schemas import TaskClaimRequest, TaskClaimResponse, TasksResponse
from ..services.tasks import (
    build_tasks_for_user,
    claim_task,
    clear_task_debug_state,
    get_task_debug_state,
    set_task_debug_state,
)
from .auth import get_current_user


router = APIRouter(prefix="/tasks", tags=["tasks"])


class TaskDebugStateRequest(BaseModel):
    arcade_levels: int | None = None
    daily_levels: int | None = None
    friends_confirmed: int | None = None
    official_channel: bool | None = None
    partner_channel: bool | None = None


def _ensure_dev() -> None:
    if settings.ENVIRONMENT != "development":
        raise HTTPException(status_code=403, detail="Dev endpoints are disabled")


@router.get("", response_model=TasksResponse)
async def get_tasks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    debug_state = await get_task_debug_state(user.id)
    return await build_tasks_for_user(user, db, debug_state=debug_state)


@router.post("/claim", response_model=TaskClaimResponse)
async def claim_task_reward(
    request: TaskClaimRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    locked_user_result = await db.execute(select(User).where(User.id == user.id).with_for_update())
    locked_user = locked_user_result.scalar_one_or_none()
    if not locked_user:
        raise HTTPException(status_code=401, detail="User not found")

    debug_state = await get_task_debug_state(locked_user.id)
    response = await claim_task(locked_user, request.claim_id, db, debug_state=debug_state)
    await db.commit()
    return response


@router.get("/dev/state")
async def get_task_dev_state(
    user: User = Depends(get_current_user),
):
    _ensure_dev()
    state = await get_task_debug_state(user.id)
    return {"success": True, "state": state}


@router.post("/dev/state")
async def update_task_dev_state(
    payload: TaskDebugStateRequest,
    user: User = Depends(get_current_user),
):
    _ensure_dev()
    updates = payload.model_dump(exclude_none=True)
    state = await set_task_debug_state(user.id, updates)
    return {"success": True, "state": state}


@router.post("/dev/reset")
async def reset_task_dev_state(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_dev()

    await clear_task_debug_state(user.id)
    await db.execute(delete(TaskClaim).where(TaskClaim.user_id == user.id))
    await db.execute(delete(ChannelSubscription).where(ChannelSubscription.user_id == user.id))
    await db.commit()
    return {"success": True}
