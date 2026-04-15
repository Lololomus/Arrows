from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models import AdRewardClaim, User
from app.services.ad_rewards import (
    FAILURE_DAILY_LIMIT_REACHED,
    PLACEMENT_AD_CASE,
    PLACEMENT_TASK,
    TASK_REVIVE_COOLDOWN,
    create_reward_intent,
    grant_intent,
)
from app.services import case_logic


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


@pytest.mark.asyncio
async def test_ad_case_has_no_daily_limit(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    user = await create_user(db_session, telegram_id=703)
    monkeypatch.setattr("app.services.ad_rewards.determine_ad_case_rarity", lambda: "common")

    for _ in range(6):
        intent = await create_reward_intent(db_session, user, PLACEMENT_AD_CASE)
        granted = await grant_intent(db_session, user, intent)

        assert granted.status == "granted"
        assert granted.used_today is None
        assert granted.limit_today is None
        assert granted.resets_at is None

    claims = (
        await db_session.execute(
            select(AdRewardClaim).where(
                AdRewardClaim.user_id == user.id,
                AdRewardClaim.placement == PLACEMENT_AD_CASE,
            )
        )
    ).scalars().all()

    assert len(claims) == 6


@pytest.mark.asyncio
async def test_ad_case_star_reward_rolls_one_three_or_five(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=704)

    def fake_choice(options):
        if options == case_logic.AD_CASE_STAR_REWARD_AMOUNTS:
            return 5
        return {"hints": 0, "revives": 0, "coins": 0, "stars": 1}

    monkeypatch.setattr(case_logic.random, "choice", fake_choice)

    result = await case_logic.grant_ad_case_rewards(user, "epic", db_session)
    await db_session.commit()
    await db_session.refresh(user)

    assert len(result["rewards"]) == 1
    assert {"type": "stars", "amount": 5} in result["rewards"]
    assert user.stars_balance == 5
