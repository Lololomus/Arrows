from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api import auth, shop
from app.database import Base
from app.models import CaseOpening, StarsWithdrawal, Transaction, User
from app.schemas import PurchaseRequest, WithdrawStarsRequest
from app.services import case_logic, ton_processor


@pytest.fixture
async def db_session_factory(tmp_path):
    db_path = tmp_path / "test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    yield session_factory

    await engine.dispose()


@pytest.fixture
async def db_session(db_session_factory) -> AsyncSession:
    async with db_session_factory() as session:
        yield session


async def create_user(
    session: AsyncSession,
    *,
    telegram_id: int,
    coins: int = 1000,
    stars_balance: int = 0,
    case_pity_counter: int = 0,
) -> User:
    user = User(
        telegram_id=telegram_id,
        username=f"user_{telegram_id}",
        first_name="Test",
        current_level=1,
        coins=coins,
        energy=5,
        stars_balance=stars_balance,
        case_pity_counter=case_pity_counter,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def extract_discount_tiers(item) -> list[tuple[int, int]]:
    return [(tier.min_quantity, tier.percent) for tier in item.discount_tiers]


@pytest.mark.asyncio
async def test_catalog_exposes_updated_boost_prices_and_discount_tiers(db_session: AsyncSession) -> None:
    user = await create_user(db_session, telegram_id=1201)

    catalog = await shop.get_catalog(user=user, db=db_session)
    boosts = {item.id: item for item in catalog.boosts}

    assert boosts["hints_1"].price_coins == 100
    assert boosts["revive_1"].price_coins == 500
    assert extract_discount_tiers(boosts["hints_1"]) == [(3, 5), (5, 10)]
    assert extract_discount_tiers(boosts["revive_1"]) == [(3, 5), (5, 10)]


@pytest.mark.asyncio
async def test_purchase_item_uses_discounted_total_for_three_hints(db_session: AsyncSession) -> None:
    user = await create_user(db_session, telegram_id=1202, coins=285)
    initial_hints = user.hint_balance

    response = await shop.purchase_item(
        request=PurchaseRequest(item_type="boosts", item_id="hints_1", quantity=3),
        user=user,
        db=db_session,
    )

    tx = (await db_session.execute(select(Transaction).where(Transaction.user_id == user.id))).scalar_one()
    await db_session.refresh(user)

    assert response.success is True
    assert response.coins == 0
    assert response.hint_balance == initial_hints + 3
    assert user.coins == 0
    assert user.hint_balance == initial_hints + 3
    assert tx.amount == Decimal("-285")


@pytest.mark.asyncio
async def test_purchase_item_applies_ten_percent_discount_for_five_revives(db_session: AsyncSession) -> None:
    user = await create_user(db_session, telegram_id=1203, coins=2250)
    initial_revives = user.revive_balance

    response = await shop.purchase_item(
        request=PurchaseRequest(item_type="boosts", item_id="revive_1", quantity=5),
        user=user,
        db=db_session,
    )

    tx = (await db_session.execute(select(Transaction).where(Transaction.user_id == user.id))).scalar_one()
    await db_session.refresh(user)

    assert response.success is True
    assert response.coins == 0
    assert response.revive_balance == initial_revives + 5
    assert user.coins == 0
    assert user.revive_balance == initial_revives + 5
    assert tx.amount == Decimal("-2250")


@pytest.mark.asyncio
async def test_create_stars_case_purchase_links_transaction_and_opening(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=1301)

    monkeypatch.setattr(case_logic, "determine_rarity", lambda pity_counter: "epic_stars")

    result = await case_logic.create_stars_case_purchase(
        user=user,
        total_amount=case_logic.CASE_PRICE_STARS,
        charge_id="charge-stars-1",
        db=db_session,
    )
    await db_session.commit()
    await db_session.refresh(user)

    tx = (
        await db_session.execute(
            select(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.item_type == "cases",
                Transaction.item_id == "standard",
            )
        )
    ).scalar_one()
    opening = (
        await db_session.execute(
            select(CaseOpening).where(CaseOpening.transaction_id == tx.id)
        )
    ).scalar_one()

    assert float(tx.amount) == case_logic.CASE_PRICE_STARS
    assert tx.currency == "stars"
    assert tx.status == "completed"
    assert tx.ton_tx_hash == "charge-stars-1"
    assert opening.user_id == user.id
    assert opening.transaction_id == tx.id
    assert opening.payment_currency == "stars"
    assert result["rarity"] == "epic_stars"
    assert result["stars_balance"] == 250
    assert user.stars_balance == 250
    assert user.case_pity_counter == 0


@pytest.mark.asyncio
async def test_confirm_case_ton_is_idempotent_and_uses_transaction_link(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=1302, case_pity_counter=7)
    tx = Transaction(
        user_id=user.id,
        type="purchase",
        currency="ton",
        amount=case_logic.CASE_PRICE_TON,
        item_type="cases",
        item_id="standard",
        status="pending",
    )
    db_session.add(tx)
    await db_session.commit()
    await db_session.refresh(tx)

    verify_calls = 0

    async def fake_verify_ton_transaction(**kwargs):
        nonlocal verify_calls
        verify_calls += 1
        return {"tx_hash": "ton-hash-1", "amount": int(case_logic.CASE_PRICE_TON * 1_000_000_000)}

    monkeypatch.setattr(shop, "verify_ton_transaction", fake_verify_ton_transaction)
    monkeypatch.setattr(shop, "determine_rarity", lambda pity_counter: "rare")

    first_response = await shop.confirm_case_ton(tx.id, user=user, db=db_session)
    await db_session.refresh(user)
    await db_session.refresh(tx)

    assert verify_calls == 1
    assert first_response["status"] == "completed"
    assert first_response["verified"] is True
    assert first_response["case_result"]["rarity"] == "rare"
    assert tx.status == "completed"
    assert tx.ton_tx_hash == "ton-hash-1"
    assert user.hint_balance == 10
    assert user.revive_balance == 3
    assert user.coins == 1150
    assert user.case_pity_counter == 8

    linked_opening = (
        await db_session.execute(
            select(CaseOpening).where(CaseOpening.transaction_id == tx.id)
        )
    ).scalar_one()
    assert linked_opening.rarity == "rare"
    assert linked_opening.payment_currency == "ton"

    # Simulate a later case opening with a different rarity to ensure the
    # idempotent response stays tied to the original transaction.
    await case_logic.grant_case_rewards(user, "epic_stars", "ton", db_session)
    await db_session.commit()
    await db_session.refresh(user)

    second_response = await shop.confirm_case_ton(tx.id, user=user, db=db_session)

    assert verify_calls == 1
    assert second_response["status"] == "completed"
    assert second_response["case_result"]["rarity"] == "rare"
    assert second_response["case_result"]["rewards"] == first_response["case_result"]["rewards"]


@pytest.mark.asyncio
async def test_poll_case_result_falls_back_to_recent_db_result_without_redis(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=1303)
    await case_logic.grant_case_rewards(user, "epic_stars", "stars", db_session)
    await db_session.commit()
    await db_session.refresh(user)

    async def fake_get_redis():
        return None

    monkeypatch.setattr(shop, "get_redis", fake_get_redis)

    response = await shop.poll_case_result(user=user, db=db_session)

    assert response["status"] == "ready"
    assert response["case_result"]["rarity"] == "epic_stars"
    assert response["case_result"]["stars_balance"] == 250


@pytest.mark.asyncio
async def test_withdraw_stars_creates_pending_request_and_notifies_admin(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=1401, stars_balance=120)
    notified: list[tuple[int, int]] = []

    async def fake_notify(withdrawal: StarsWithdrawal, current_user: User) -> None:
        notified.append((withdrawal.amount, current_user.id))

    monkeypatch.setattr(shop, "_notify_admin_withdrawal", fake_notify)

    response = await shop.withdraw_stars(
        body=WithdrawStarsRequest(amount=50),
        user=user,
        db=db_session,
    )
    await db_session.refresh(user)

    withdrawals = (
        await db_session.execute(
            select(StarsWithdrawal).where(StarsWithdrawal.user_id == user.id)
        )
    ).scalars().all()

    assert response.amount == 50
    assert response.status == "pending"
    assert user.stars_balance == 70
    assert len(withdrawals) == 1
    assert withdrawals[0].amount == 50
    assert withdrawals[0].status == "pending"
    assert notified == [(50, user.id)]


@pytest.mark.asyncio
async def test_withdraw_stars_rolls_back_when_admin_notification_fails(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=1402, stars_balance=120)

    async def fake_notify(withdrawal: StarsWithdrawal, current_user: User) -> None:
        raise RuntimeError("telegram down")

    monkeypatch.setattr(shop, "_notify_admin_withdrawal", fake_notify)

    with pytest.raises(HTTPException) as exc_info:
        await shop.withdraw_stars(
            body=WithdrawStarsRequest(amount=50),
            user=user,
            db=db_session,
        )

    await db_session.refresh(user)
    withdrawals = (
        await db_session.execute(
            select(StarsWithdrawal).where(StarsWithdrawal.user_id == user.id)
        )
    ).scalars().all()

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "WITHDRAWALS_UNAVAILABLE"
    assert user.stars_balance == 120
    assert withdrawals == []


@pytest.mark.asyncio
async def test_ton_processor_grants_case_rewards_for_pending_case_transactions(
    db_session_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with db_session_factory() as session:
        user = await create_user(session, telegram_id=1304, case_pity_counter=2)
        tx = Transaction(
            user_id=user.id,
            type="purchase",
            currency="ton",
            amount=case_logic.CASE_PRICE_TON,
            item_type="cases",
            item_id="standard",
            status="pending",
        )
        session.add(tx)
        await session.commit()
        await session.refresh(tx)
        user_id = user.id
        tx_id = tx.id

    monkeypatch.setattr(ton_processor, "AsyncSessionLocal", db_session_factory)
    monkeypatch.setattr(ton_processor, "determine_rarity", lambda pity_counter: "common")

    await ton_processor._grant_and_complete(tx_id, user_id, "standard", "processor-hash-1")

    async with db_session_factory() as session:
        db_user = await session.get(User, user_id)
        db_tx = await session.get(Transaction, tx_id)
        db_opening = (
            await session.execute(
                select(CaseOpening).where(CaseOpening.transaction_id == tx_id)
            )
        ).scalar_one()

    assert db_tx is not None
    assert db_tx.status == "completed"
    assert db_tx.ton_tx_hash == "processor-hash-1"
    assert db_opening.payment_currency == "ton"
    assert db_opening.rarity == "common"
    assert db_user is not None
    assert db_user.hint_balance == 6
    assert db_user.revive_balance == 1
    assert db_user.coins == 1050
    assert db_user.case_pity_counter == 3


def test_serialize_user_includes_case_fields() -> None:
    user = User(
        telegram_id=1305,
        username="user_1305",
        first_name="Test",
        stars_balance=42,
        case_pity_counter=9,
    )

    payload = auth.serialize_user(user)

    assert payload["stars_balance"] == 42
    assert payload["case_pity_counter"] == 9
