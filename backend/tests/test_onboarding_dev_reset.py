from datetime import datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api import onboarding
from app.models import User
from app.database import Base


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


async def create_user(
    session: AsyncSession,
    *,
    telegram_id: int,
    onboarding_shown: bool = False,
    welcome_offer_opened_at: datetime | None = None,
    welcome_offer_purchased: bool = False,
) -> User:
    user = User(
        telegram_id=telegram_id,
        username=f"user_{telegram_id}",
        first_name="Test",
        locale="en",
        locale_manually_set=False,
        current_level=1,
        coins=0,
        energy=5,
        onboarding_shown=onboarding_shown,
        welcome_offer_opened_at=welcome_offer_opened_at,
        welcome_offer_purchased=welcome_offer_purchased,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_dev_reset_new_user_clears_fresh_user_flags(db_session: AsyncSession) -> None:
    opened_at = datetime.utcnow()
    user = await create_user(
        db_session,
        telegram_id=201,
        onboarding_shown=True,
        welcome_offer_opened_at=opened_at,
        welcome_offer_purchased=True,
    )

    response = await onboarding.dev_reset_onboarding_state(
        onboarding.OnboardingDevResetRequest(mode="new_user"),
        user=user,
        db=db_session,
    )

    await db_session.refresh(user)

    assert user.onboarding_shown is False
    assert user.welcome_offer_opened_at is None
    assert user.welcome_offer_purchased is False
    assert response.onboarding_shown is False
    assert response.welcome_offer_opened_at is None
    assert response.welcome_offer_purchased is False


@pytest.mark.asyncio
async def test_dev_reset_existing_user_preserves_welcome_offer_state(db_session: AsyncSession) -> None:
    opened_at = datetime.utcnow()
    user = await create_user(
        db_session,
        telegram_id=202,
        onboarding_shown=True,
        welcome_offer_opened_at=opened_at,
        welcome_offer_purchased=True,
    )

    response = await onboarding.dev_reset_onboarding_state(
        onboarding.OnboardingDevResetRequest(mode="existing_user"),
        user=user,
        db=db_session,
    )

    await db_session.refresh(user)

    assert user.onboarding_shown is False
    assert user.welcome_offer_opened_at == opened_at
    assert user.welcome_offer_purchased is True
    assert response.onboarding_shown is False
    assert response.welcome_offer_opened_at is not None
    assert response.welcome_offer_purchased is True
