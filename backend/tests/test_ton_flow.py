from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api import shop, wallet
from app.database import Base
from app.models import Inventory, Transaction, User
from app.schemas import PurchaseRequest, WalletConnectRequest


class FakeRedis:
    def __init__(self) -> None:
        self._storage: dict[str, str] = {}

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self._storage[key] = value

    async def get(self, key: str) -> str | None:
        return self._storage.get(key)

    async def delete(self, key: str) -> None:
        self._storage.pop(key, None)


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
    wallet_address: str | None = None,
) -> User:
    user = User(
        telegram_id=telegram_id,
        username=f"user_{telegram_id}",
        first_name="Test",
        current_level=1,
        coins=1000,
        energy=5,
        wallet_address=wallet_address,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_wallet_connect_binds_wallet_and_consumes_payload(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    user = await create_user(db_session, telegram_id=1001)
    fake_redis = FakeRedis()

    async def fake_get_redis() -> FakeRedis:
        return fake_redis

    monkeypatch.setattr(wallet, "get_redis", fake_get_redis)
    monkeypatch.setattr(wallet, "verify_ton_proof", lambda **_: True)

    payload_response = await wallet.get_proof_payload(user=user)

    assert payload_response["payload"]
    assert await fake_redis.get(f"ton_proof:{user.id}") == payload_response["payload"]

    result = await wallet.connect_wallet(
        request=WalletConnectRequest(address="EQ_TEST_WALLET", proof={"timestamp": 1}),
        user=user,
        db=db_session,
    )

    await db_session.refresh(user)

    assert result.success is True
    assert user.wallet_address == "EQ_TEST_WALLET"
    assert await fake_redis.get(f"ton_proof:{user.id}") is None


@pytest.mark.asyncio
async def test_wallet_connect_rejects_wallet_bound_to_another_user(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    await create_user(db_session, telegram_id=1002, wallet_address="EQ_DUPLICATE")
    user = await create_user(db_session, telegram_id=1003)
    fake_redis = FakeRedis()

    async def fake_get_redis() -> FakeRedis:
        return fake_redis

    monkeypatch.setattr(wallet, "get_redis", fake_get_redis)
    monkeypatch.setattr(wallet, "verify_ton_proof", lambda **_: True)

    await fake_redis.set(f"ton_proof:{user.id}", "payload")

    result = await wallet.connect_wallet(
        request=WalletConnectRequest(address="EQ_DUPLICATE", proof={"timestamp": 1}),
        user=user,
        db=db_session,
    )

    await db_session.refresh(user)

    assert result.success is False
    assert result.error == "Wallet already connected to another account"
    assert user.wallet_address is None


@pytest.mark.asyncio
async def test_purchase_with_ton_reuses_existing_pending_transaction(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    user = await create_user(db_session, telegram_id=1004)
    monkeypatch.setattr(shop.settings, "TON_PAYMENTS_ENABLED", True)
    monkeypatch.setattr(shop.settings, "TON_API_KEY", "test-ton-key")
    monkeypatch.setattr(shop.settings, "TON_WALLET_ADDRESS", "EQ_MERCHANT")

    request = PurchaseRequest(item_type="themes", item_id="space")

    first = await shop.purchase_with_ton(request=request, user=user, db=db_session)
    second = await shop.purchase_with_ton(request=request, user=user, db=db_session)

    transactions = (
        await db_session.execute(
            select(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.item_type == "themes",
                Transaction.item_id == "space",
            )
        )
    ).scalars().all()

    assert first.transaction_id == second.transaction_id
    assert first.comment == second.comment
    assert len(transactions) == 1
    assert transactions[0].status == "pending"


@pytest.mark.asyncio
async def test_confirm_ton_transaction_grants_inventory_and_is_idempotent(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=1005)
    monkeypatch.setattr(shop.settings, "TON_PAYMENTS_ENABLED", True)
    monkeypatch.setattr(shop.settings, "TON_API_KEY", "test-ton-key")
    monkeypatch.setattr(shop.settings, "TON_WALLET_ADDRESS", "EQ_MERCHANT")

    payment = await shop.purchase_with_ton(
        request=PurchaseRequest(item_type="themes", item_id="space"),
        user=user,
        db=db_session,
    )

    async def no_match(**_: object) -> None:
        return None

    monkeypatch.setattr(shop, "verify_ton_transaction", no_match)

    pending_result = await shop.confirm_ton_transaction(
        tx_id=payment.transaction_id,
        user=user,
        db=db_session,
    )

    assert pending_result == {
        "transaction_id": payment.transaction_id,
        "status": "pending",
        "verified": False,
    }

    async def matched(**_: object) -> dict[str, object]:
        return {"tx_hash": "tx-hash-123", "amount": int(Decimal("0.5") * 1_000_000_000)}

    monkeypatch.setattr(shop, "verify_ton_transaction", matched)

    completed_result = await shop.confirm_ton_transaction(
        tx_id=payment.transaction_id,
        user=user,
        db=db_session,
    )
    repeated_result = await shop.confirm_ton_transaction(
        tx_id=payment.transaction_id,
        user=user,
        db=db_session,
    )

    tx = await db_session.get(Transaction, payment.transaction_id)
    inventory_items = (
        await db_session.execute(
            select(Inventory).where(
                Inventory.user_id == user.id,
                Inventory.item_type == "themes",
                Inventory.item_id == "space",
            )
        )
    ).scalars().all()

    assert completed_result == {
        "transaction_id": payment.transaction_id,
        "status": "completed",
        "verified": True,
    }
    assert repeated_result == completed_result
    assert tx is not None
    assert tx.status == "completed"
    assert tx.ton_tx_hash == "tx-hash-123"
    assert len(inventory_items) == 1


@pytest.mark.asyncio
async def test_confirm_ton_transaction_applies_boost_once(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    user = await create_user(db_session, telegram_id=1006)
    monkeypatch.setattr(shop.settings, "TON_PAYMENTS_ENABLED", True)
    monkeypatch.setattr(shop.settings, "TON_API_KEY", "test-ton-key")
    monkeypatch.setattr(shop.settings, "TON_WALLET_ADDRESS", "EQ_MERCHANT")

    payment = await shop.purchase_with_ton(
        request=PurchaseRequest(item_type="boosts", item_id="vip_forever"),
        user=user,
        db=db_session,
    )

    async def matched(**_: object) -> dict[str, object]:
        return {"tx_hash": "vip-hash-1", "amount": int(Decimal("50") * 1_000_000_000)}

    monkeypatch.setattr(shop, "verify_ton_transaction", matched)

    first = await shop.confirm_ton_transaction(
        tx_id=payment.transaction_id,
        user=user,
        db=db_session,
    )
    second = await shop.confirm_ton_transaction(
        tx_id=payment.transaction_id,
        user=user,
        db=db_session,
    )

    await db_session.refresh(user)

    assert first["status"] == "completed"
    assert second == first
    assert user.is_premium is True


@pytest.mark.asyncio
async def test_purchase_with_ton_rejects_already_owned_non_consumable(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    user = await create_user(db_session, telegram_id=1007)
    monkeypatch.setattr(shop.settings, "TON_PAYMENTS_ENABLED", True)
    monkeypatch.setattr(shop.settings, "TON_API_KEY", "test-ton-key")
    monkeypatch.setattr(shop.settings, "TON_WALLET_ADDRESS", "EQ_MERCHANT")

    db_session.add(Inventory(user_id=user.id, item_type="themes", item_id="space"))
    await db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await shop.purchase_with_ton(
            request=PurchaseRequest(item_type="themes", item_id="space"),
            user=user,
            db=db_session,
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Item already owned"


@pytest.mark.asyncio
async def test_purchase_with_ton_is_disabled_by_default(db_session: AsyncSession) -> None:
    user = await create_user(db_session, telegram_id=1008)

    with pytest.raises(HTTPException) as exc_info:
        await shop.purchase_with_ton(
            request=PurchaseRequest(item_type="themes", item_id="space"),
            user=user,
            db=db_session,
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "TON payments are currently disabled"


@pytest.mark.asyncio
async def test_catalog_hides_ton_items_when_payments_disabled(db_session: AsyncSession) -> None:
    user = await create_user(db_session, telegram_id=1009)

    catalog = await shop.get_catalog(user=user, db=db_session)

    assert catalog.arrow_skins == []
    assert catalog.themes == []
