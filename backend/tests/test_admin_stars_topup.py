import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models import BotStarsLedger, Transaction, User
from app.services import admin_stars_topup


@pytest.fixture
async def session_factory(tmp_path):
    db_path = tmp_path / "test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    yield factory

    await engine.dispose()


@pytest.fixture
async def db_session(session_factory) -> AsyncSession:
    async with session_factory() as session:
        yield session


def test_validate_admin_topup_checkout_rejects_non_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(admin_stars_topup.settings, "ADMIN_TELEGRAM_ID", "42")

    ok, error = admin_stars_topup.validate_admin_topup_checkout(
        99,
        admin_stars_topup.build_admin_topup_payload(100),
    )

    assert ok is False
    assert error == "This invoice is available only to the admin account."


def test_validate_admin_topup_checkout_accepts_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(admin_stars_topup.settings, "ADMIN_TELEGRAM_ID", "42")

    ok, error = admin_stars_topup.validate_admin_topup_checkout(
        42,
        admin_stars_topup.build_admin_topup_payload(500),
    )

    assert ok is True
    assert error is None


@pytest.mark.asyncio
async def test_record_admin_topup_creates_user_transaction_ledger_and_cache(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cached_balances: list[int] = []

    async def fake_set_cached_stars_balance(balance: int) -> None:
        cached_balances.append(balance)

    monkeypatch.setattr(admin_stars_topup, "set_cached_stars_balance", fake_set_cached_stars_balance)

    processed, new_balance = await admin_stars_topup.record_admin_stars_topup(
        db_session,
        telegram_user_id=777,
        username="admin",
        first_name="Admin",
        amount=500,
        charge_id="charge-500",
    )

    user = (
        await db_session.execute(select(User).where(User.telegram_id == 777))
    ).scalar_one()
    transaction = (await db_session.execute(select(Transaction))).scalar_one()
    ledger_entry = (await db_session.execute(select(BotStarsLedger))).scalar_one()

    assert processed is True
    assert new_balance == 500
    assert user.username == "admin"
    assert transaction.currency == "stars"
    assert transaction.item_type == "gift_fund"
    assert transaction.item_id == "500"
    assert transaction.ton_tx_hash == "charge-500"
    assert ledger_entry.event_type == "stars_received"
    assert ledger_entry.amount == 500
    assert ledger_entry.balance_after == 500
    assert cached_balances == [500]


@pytest.mark.asyncio
async def test_record_admin_topup_is_idempotent_by_charge_id(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cached_balances: list[int] = []

    async def fake_set_cached_stars_balance(balance: int) -> None:
        cached_balances.append(balance)

    monkeypatch.setattr(admin_stars_topup, "set_cached_stars_balance", fake_set_cached_stars_balance)

    first_processed, first_balance = await admin_stars_topup.record_admin_stars_topup(
        db_session,
        telegram_user_id=777,
        username="admin",
        first_name="Admin",
        amount=100,
        charge_id="duplicate-charge",
    )
    second_processed, second_balance = await admin_stars_topup.record_admin_stars_topup(
        db_session,
        telegram_user_id=777,
        username="admin",
        first_name="Admin",
        amount=100,
        charge_id="duplicate-charge",
    )

    users = (await db_session.execute(select(User))).scalars().all()
    transactions = (await db_session.execute(select(Transaction))).scalars().all()
    ledger_entries = (await db_session.execute(select(BotStarsLedger))).scalars().all()

    assert first_processed is True
    assert first_balance == 100
    assert second_processed is False
    assert second_balance == 100
    assert len(users) == 1
    assert len(transactions) == 1
    assert len(ledger_entries) == 1
    assert cached_balances == [100]
