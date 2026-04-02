from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api import spin
from app.database import Base
from app.models import Transaction, User


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
    coins: int,
    login_streak: int,
    last_spin_at: datetime | None,
) -> User:
    user = User(
        telegram_id=telegram_id,
        username=f"user_{telegram_id}",
        first_name="Spin",
        current_level=1,
        coins=coins,
        energy=5,
        login_streak=login_streak,
        last_spin_at=last_spin_at,
        last_spin_date=last_spin_at.date() if last_spin_at is not None else None,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_get_spin_status_returns_blocked_lost_streak_window(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixed_now = datetime(2026, 4, 2, 12, 0, 0)
    last_spin_at = fixed_now - spin.SPIN_STREAK_WINDOW - timedelta(hours=1)
    user = await create_user(
        db_session,
        telegram_id=501,
        coins=1000,
        login_streak=10,
        last_spin_at=last_spin_at,
    )

    monkeypatch.setattr(spin, "_spin_now", lambda: fixed_now)

    status = await spin.get_spin_status(user=user, db=db_session)

    expected_lost_at = last_spin_at + spin.SPIN_STREAK_WINDOW

    assert status.available is False
    assert status.streak == 0
    assert status.streak_lost_count == 10
    assert status.streak_lost_at == expected_lost_at.replace(tzinfo=timezone.utc).isoformat()


@pytest.mark.asyncio
async def test_restore_streak_deducts_coins_and_preserves_next_roll(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixed_now = datetime(2026, 4, 2, 12, 0, 0)
    last_spin_at = fixed_now - spin.SPIN_STREAK_WINDOW - timedelta(hours=2)
    user = await create_user(
        db_session,
        telegram_id=502,
        coins=1000,
        login_streak=10,
        last_spin_at=last_spin_at,
    )

    monkeypatch.setattr(spin, "_spin_now", lambda: fixed_now)
    monkeypatch.setattr(spin, "_spin_today", lambda: fixed_now.date())
    monkeypatch.setattr(spin, "_roll_prize", lambda streak: ("coins", 25))

    restored = await spin.restore_streak(user=user, db=db_session)

    await db_session.refresh(user)
    restore_tx = (
        await db_session.execute(
            select(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.item_id == "streak_restore",
            )
        )
    ).scalar_one()

    assert restored.success is True
    assert restored.streak == 10
    assert restored.coins == 500
    assert user.coins == 500
    assert user.last_spin_at == fixed_now - spin.SPIN_COOLDOWN
    assert user.last_spin_date == fixed_now.date() - timedelta(days=1)
    assert user.spin_ready_notified_for_spin_at == fixed_now - spin.SPIN_COOLDOWN
    assert restore_tx.type == "purchase"
    assert restore_tx.currency == "coins"
    assert restore_tx.amount == Decimal("-500")

    rolled = await spin.roll_spin(user=user, db=db_session)

    await db_session.refresh(user)

    assert rolled.streak == 11
    assert user.login_streak == 11
    assert user.pending_spin_prize_type == "coins"
    assert user.pending_spin_prize_amount == 25


@pytest.mark.asyncio
async def test_restore_streak_rejects_when_not_enough_coins(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixed_now = datetime(2026, 4, 2, 12, 0, 0)
    user = await create_user(
        db_session,
        telegram_id=503,
        coins=499,
        login_streak=10,
        last_spin_at=fixed_now - spin.SPIN_STREAK_WINDOW - timedelta(hours=3),
    )

    monkeypatch.setattr(spin, "_spin_now", lambda: fixed_now)
    monkeypatch.setattr(spin, "_spin_today", lambda: fixed_now.date())

    with pytest.raises(HTTPException) as exc_info:
        await spin.restore_streak(user=user, db=db_session)

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "NOT_ENOUGH_COINS"


@pytest.mark.asyncio
async def test_roll_spin_rejects_while_streak_is_frozen(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixed_now = datetime(2026, 4, 2, 12, 0, 0)
    user = await create_user(
        db_session,
        telegram_id=504,
        coins=1000,
        login_streak=10,
        last_spin_at=fixed_now - spin.SPIN_STREAK_WINDOW - timedelta(hours=1),
    )

    monkeypatch.setattr(spin, "_spin_now", lambda: fixed_now)
    monkeypatch.setattr(spin, "_spin_today", lambda: fixed_now.date())

    with pytest.raises(HTTPException) as exc_info:
        await spin.roll_spin(user=user, db=db_session)

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "STREAK_RESTORE_REQUIRED"


@pytest.mark.asyncio
async def test_dev_set_frozen_streak_persists_in_status(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixed_now = datetime(2026, 4, 2, 12, 0, 0)
    user = await create_user(
        db_session,
        telegram_id=505,
        coins=1000,
        login_streak=0,
        last_spin_at=None,
    )

    monkeypatch.setattr(spin, "_spin_now", lambda: fixed_now)
    monkeypatch.setattr(spin.settings, "ENVIRONMENT", "development")

    await spin.dev_set_frozen_spin_streak(
        spin.SpinDevSetStreakRequest(streak=10),
        user=user,
        db=db_session,
    )

    await db_session.refresh(user)
    status = await spin.get_spin_status(user=user, db=db_session)

    assert user.login_streak == 10
    assert status.streak == 0
    assert status.streak_lost_count == 10
    assert status.streak_lost_at is not None
