from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models import AdRewardClaim, User
from app.services.ad_rewards import (
    FAILURE_DAILY_LIMIT_REACHED,
    PLACEMENT_TASK,
    TASK_REVIVE_COOLDOWN,
    create_reward_intent,
    grant_intent,
)


@pytest.fixture
async def db_session(tmp_path) -> AsyncSession:
    db_path = tmp_path / "test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as session:
        yield session

    await engine.dispose()


async def create_user(session: AsyncSession, *, telegram_id: int, coins: int = 0) -> User:
    user = User(
        telegram_id=telegram_id,
        username=f"user_{telegram_id}",
        first_name="Test",
        locale="en",
        current_level=1,
        coins=coins,
        energy=5,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_task_revive_grant_uses_eight_hour_cooldown_without_coins(db_session: AsyncSession) -> None:
    user = await create_user(db_session, telegram_id=701, coins=120)

    intent = await create_reward_intent(db_session, user, PLACEMENT_TASK)
    granted = await grant_intent(db_session, user, intent)
    await db_session.refresh(user)

    assert user.coins == 120
    assert user.revive_balance == 1
    assert granted.revive_granted is True
    assert granted.used_today == 1
    assert granted.limit_today == 1
    assert granted.fulfilled_at is not None
    assert granted.resets_at == granted.fulfilled_at + TASK_REVIVE_COOLDOWN


@pytest.mark.asyncio
async def test_task_revive_unlocks_after_eight_hours(db_session: AsyncSession) -> None:
    user = await create_user(db_session, telegram_id=702)

    intent = await create_reward_intent(db_session, user, PLACEMENT_TASK)
    await grant_intent(db_session, user, intent)

    with pytest.raises(HTTPException) as exc_info:
        await create_reward_intent(db_session, user, PLACEMENT_TASK)

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == {"error": FAILURE_DAILY_LIMIT_REACHED}

    claim = (
        await db_session.execute(
            select(AdRewardClaim).where(
                AdRewardClaim.user_id == user.id,
                AdRewardClaim.placement == PLACEMENT_TASK,
            )
        )
    ).scalar_one()
    claim.created_at = claim.created_at - TASK_REVIVE_COOLDOWN - timedelta(minutes=1)
    await db_session.commit()

    next_intent = await create_reward_intent(db_session, user, PLACEMENT_TASK)

    assert next_intent.placement == PLACEMENT_TASK
    assert next_intent.status == "pending"
