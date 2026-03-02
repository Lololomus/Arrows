"""Tasks API."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User
from ..schemas import TaskClaimRequest, TaskClaimResponse, TasksResponse
from ..services.tasks import build_tasks_for_user, claim_task
from .auth import get_current_user


router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=TasksResponse)
async def get_tasks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await build_tasks_for_user(user, db)


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

    response = await claim_task(locked_user, request.claim_id, db)
    await db.commit()
    return response
