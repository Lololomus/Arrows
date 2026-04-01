from __future__ import annotations

import json
import math
import time
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from telethon import functions
from telethon.errors import FloodWaitError

from app.api import admin_userbot
from app.database import Base
from app.models import User, UserbotGiftOrder, UserbotStarsLedger
from app.schemas import UserbotOrderResolveRequest, UserbotStarsTopupRequest
from app.services import userbot_gift_sender, userbot_peers, userbot_processor

_DEFAULT_USERNAME = object()


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.expirations: dict[str, float] = {}
        self.zsets: dict[str, dict[str, float]] = {}

    def _is_alive(self, key: str) -> bool:
        expires_at = self.expirations.get(key)
        if expires_at is not None and expires_at <= time.time():
            self.values.pop(key, None)
            self.zsets.pop(key, None)
            self.expirations.pop(key, None)
            return False
        return True

    async def get(self, key: str) -> str | None:
        self._is_alive(key)
        return self.values.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.values[key] = str(value)
        if ex is not None:
            self.expirations[key] = time.time() + ex
        else:
            self.expirations.pop(key, None)

    async def delete(self, key: str) -> None:
        self.values.pop(key, None)
        self.zsets.pop(key, None)
        self.expirations.pop(key, None)

    async def ttl(self, key: str) -> int:
        if not self._is_alive(key):
            return -2
        expires_at = self.expirations.get(key)
        if expires_at is None:
            return -1
        return max(0, math.ceil(expires_at - time.time()))

    async def expire(self, key: str, seconds: int) -> None:
        if key in self.values or key in self.zsets:
            self.expirations[key] = time.time() + seconds

    async def zadd(self, key: str, mapping: dict[str, float]) -> None:
        self._is_alive(key)
        zset = self.zsets.setdefault(key, {})
        zset.update(mapping)

    async def zremrangebyscore(self, key: str, min_score: float, max_score: float) -> None:
        self._is_alive(key)
        zset = self.zsets.setdefault(key, {})
        members = [member for member, score in zset.items() if min_score <= score <= max_score]
        for member in members:
            del zset[member]

    async def zcard(self, key: str) -> int:
        self._is_alive(key)
        return len(self.zsets.get(key, {}))

    async def zrange(
        self,
        key: str,
        start: int,
        stop: int,
        *,
        withscores: bool = False,
    ):
        self._is_alive(key)
        items = sorted(self.zsets.get(key, {}).items(), key=lambda item: (item[1], item[0]))
        if stop == -1:
            sliced = items[start:]
        else:
            sliced = items[start:stop + 1]
        if withscores:
            return sliced
        return [member for member, _ in sliced]


class FakeTelethonClient:
    def __init__(
        self,
        *,
        saved_transfer_cost: int = 0,
        observed_balance: int = 250,
        fail_on_request: str | None = None,
        flood_wait_seconds: int = 0,
        fail_get_input_entity: bool = False,
        fail_get_entity: bool = False,
        entity_access_hash: int = 987654321,
    ) -> None:
        self.saved_transfer_cost = saved_transfer_cost
        self.observed_balance = observed_balance
        self.fail_on_request = fail_on_request
        self.flood_wait_seconds = flood_wait_seconds
        self.fail_get_input_entity = fail_get_input_entity
        self.fail_get_entity = fail_get_entity
        self.entity_access_hash = entity_access_hash
        self.calls: list[str] = []

    async def is_user_authorized(self) -> bool:
        return True

    async def get_input_entity(self, entity):
        if self.fail_get_input_entity and isinstance(entity, int):
            raise ValueError("unknown entity")
        return SimpleNamespace(user_id=entity, access_hash=self.entity_access_hash)

    async def get_entity(self, entity):
        if self.fail_get_entity:
            raise ValueError("cannot resolve entity")
        username = str(entity).lstrip("@")
        return SimpleNamespace(id=1, access_hash=self.entity_access_hash, username=username)

    async def __call__(self, request):
        request_name = type(request).__name__
        self.calls.append(request_name)

        if self.fail_on_request == request_name:
            raise FloodWaitError(request=request, capture=self.flood_wait_seconds)

        if isinstance(request, functions.payments.CheckCanSendGiftRequest):
            return SimpleNamespace()
        if isinstance(request, functions.payments.GetPaymentFormRequest):
            return SimpleNamespace(form_id=777)
        if isinstance(request, functions.payments.SendStarsFormRequest):
            return {"ok": True, "request": request_name}
        if isinstance(request, functions.payments.GetSavedStarGiftRequest):
            return SimpleNamespace(gifts=[SimpleNamespace(transfer_stars=self.saved_transfer_cost)])
        if isinstance(request, functions.payments.TransferStarGiftRequest):
            return {"ok": True, "request": request_name}
        if isinstance(request, functions.payments.GetStarsStatusRequest):
            return SimpleNamespace(balance=SimpleNamespace(amount=self.observed_balance))
        if isinstance(request, functions.payments.GetStarGiftsRequest):
            return SimpleNamespace(gifts=[])
        raise AssertionError(f"Unexpected request: {request_name}")


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


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> FakeRedis:
    redis = FakeRedis()

    async def fake_get_redis():
        return redis

    monkeypatch.setattr(userbot_gift_sender, "get_redis", fake_get_redis)
    return redis


async def create_user(
    session: AsyncSession,
    telegram_id: int,
    *,
    username: object = _DEFAULT_USERNAME,
    userbot_access_hash: int | None = None,
    userbot_peer_status: str = "unknown",
) -> User:
    actual_username = f"user_{telegram_id}" if username is _DEFAULT_USERNAME else username
    user = User(
        telegram_id=telegram_id,
        username=actual_username,
        first_name="Test",
        current_level=10,
        coins=0,
        energy=5,
        userbot_access_hash=userbot_access_hash,
        userbot_peer_status=userbot_peer_status,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def create_order(
    session: AsyncSession,
    *,
    user_id: int,
    recipient_telegram_id: int,
    operation_type: str = "send_gift",
    status: str = "pending",
    telegram_gift_id: int | None = 101,
    owned_gift_slug: str | None = None,
    star_cost_estimate: int | None = None,
    attempts: int = 0,
    max_attempts: int = 5,
) -> UserbotGiftOrder:
    order = UserbotGiftOrder(
        user_id=user_id,
        recipient_telegram_id=recipient_telegram_id,
        operation_type=operation_type,
        status=status,
        telegram_gift_id=telegram_gift_id,
        owned_gift_slug=owned_gift_slug,
        star_cost_estimate=star_cost_estimate,
        source_kind="tests",
        source_ref="case",
        attempts=attempts,
        max_attempts=max_attempts,
    )
    session.add(order)
    await session.commit()
    await session.refresh(order)
    return order


def prime_catalog(fake_redis: FakeRedis, gift_id: int, stars: int) -> None:
    payload = {
        "updated_at": "2026-03-30T00:00:00",
        "gifts": [{"id": gift_id, "stars": stars}],
    }
    fake_redis.values[userbot_gift_sender.REDIS_USERBOT_GIFT_CATALOG_KEY] = json.dumps(payload)


@pytest.mark.asyncio
async def test_queue_userbot_send_gift_creates_pending_order(
    db_session: AsyncSession,
) -> None:
    user = await create_user(db_session, telegram_id=4100)

    order = await userbot_gift_sender.queue_userbot_send_gift(
        db_session,
        user_id=user.id,
        telegram_gift_id=999,
        source_kind="leaderboard",
        source_ref="weekly_top_10",
        priority=3,
    )
    await db_session.commit()
    await db_session.refresh(order)

    assert order.status == "pending"
    assert order.operation_type == "send_gift"
    assert order.recipient_telegram_id == user.telegram_id
    assert order.telegram_gift_id == 999
    assert order.priority == 3


@pytest.mark.asyncio
async def test_attempt_order_completes_send_gift_and_writes_ledger(
    db_session: AsyncSession,
    fake_redis: FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=4101)
    await userbot_gift_sender.add_ledger_event(
        db_session,
        event_type="manual_topup",
        amount=500,
        gift_order_id=None,
        note="seed",
    )
    await db_session.commit()
    prime_catalog(fake_redis, gift_id=111, stars=25)
    await fake_redis.set(userbot_gift_sender.REDIS_USERBOT_OBSERVED_BALANCE_KEY, "500")

    fake_client = FakeTelethonClient()

    async def fake_connect():
        return fake_client

    monkeypatch.setattr(userbot_gift_sender.userbot_client, "connect", fake_connect)
    order = await create_order(
        db_session,
        user_id=user.id,
        recipient_telegram_id=user.telegram_id,
        telegram_gift_id=111,
    )

    await userbot_processor._attempt_order(db_session, order)
    await db_session.refresh(order)
    ledger_entries = (await db_session.execute(select(UserbotStarsLedger))).scalars().all()

    assert order.status == "completed"
    assert order.star_cost_estimate == 25
    assert order.telegram_result_json == {"ok": True, "request": "SendStarsFormRequest"}
    assert len(ledger_entries) == 2
    assert ledger_entries[-1].event_type == "gift_purchase"
    assert ledger_entries[-1].amount == -25
    assert "CheckCanSendGiftRequest" in fake_client.calls
    assert "SendStarsFormRequest" in fake_client.calls


@pytest.mark.asyncio
async def test_process_transfer_gift_supports_free_and_paid_paths(
    db_session: AsyncSession,
    fake_redis: FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=4102)
    await userbot_gift_sender.add_ledger_event(
        db_session,
        event_type="manual_topup",
        amount=1000,
        gift_order_id=None,
        note="seed",
    )
    await db_session.commit()
    await fake_redis.set(userbot_gift_sender.REDIS_USERBOT_OBSERVED_BALANCE_KEY, "1000")

    free_client = FakeTelethonClient(saved_transfer_cost=0)
    paid_client = FakeTelethonClient(saved_transfer_cost=15)

    async def connect_free():
        return free_client

    async def connect_paid():
        return paid_client

    free_order = await create_order(
        db_session,
        user_id=user.id,
        recipient_telegram_id=user.telegram_id,
        operation_type="transfer_gift",
        telegram_gift_id=None,
        owned_gift_slug="gift-free",
    )
    monkeypatch.setattr(userbot_gift_sender.userbot_client, "connect", connect_free)
    free_result = await userbot_gift_sender.process_userbot_order(free_order, db_session)

    paid_order = await create_order(
        db_session,
        user_id=user.id,
        recipient_telegram_id=user.telegram_id,
        operation_type="transfer_gift",
        telegram_gift_id=None,
        owned_gift_slug="gift-paid",
    )
    monkeypatch.setattr(userbot_gift_sender.userbot_client, "connect", connect_paid)
    paid_result = await userbot_gift_sender.process_userbot_order(paid_order, db_session)

    assert free_result.star_cost_estimate == 0
    assert free_result.ledger_event_type is None
    assert "TransferStarGiftRequest" in free_client.calls
    assert "SendStarsFormRequest" not in free_client.calls

    assert paid_result.star_cost_estimate == 15
    assert paid_result.ledger_event_type == "transfer_fee"
    assert paid_result.ledger_amount == -15
    assert "SendStarsFormRequest" in paid_client.calls
    assert "TransferStarGiftRequest" not in paid_client.calls


@pytest.mark.asyncio
async def test_flood_wait_sets_retry_and_opens_circuit_breaker(
    db_session: AsyncSession,
    fake_redis: FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=4103)
    await userbot_gift_sender.add_ledger_event(
        db_session,
        event_type="manual_topup",
        amount=1000,
        gift_order_id=None,
        note="seed",
    )
    await db_session.commit()
    prime_catalog(fake_redis, gift_id=222, stars=10)
    await fake_redis.set(userbot_gift_sender.REDIS_USERBOT_OBSERVED_BALANCE_KEY, "1000")

    fake_client = FakeTelethonClient(
        fail_on_request="GetPaymentFormRequest",
        flood_wait_seconds=45,
    )

    async def fake_connect():
        return fake_client

    monkeypatch.setattr(userbot_gift_sender.userbot_client, "connect", fake_connect)

    for offset in range(3):
        order = await create_order(
            db_session,
            user_id=user.id,
            recipient_telegram_id=user.telegram_id,
            telegram_gift_id=222,
            attempts=0,
            max_attempts=5,
        )
        await userbot_processor._attempt_order(db_session, order)
        await db_session.refresh(order)
        assert order.status == "pending"
        assert order.retry_after is not None
        assert "flood_wait" in (order.failure_reason or "")

    assert await userbot_gift_sender.is_circuit_breaker_open() is True
    assert await userbot_gift_sender.get_circuit_breaker_until() is not None


@pytest.mark.asyncio
async def test_resolve_stuck_processing_order_marks_manual_review(
    session_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with session_factory() as session:
        user = await create_user(session, telegram_id=4104)
        order = await create_order(
            session,
            user_id=user.id,
            recipient_telegram_id=user.telegram_id,
            status="processing",
            attempts=1,
        )
        order.processing_started_at = userbot_gift_sender.utcnow_naive() - timedelta(seconds=600)
        await session.commit()

    monkeypatch.setattr(userbot_processor, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(userbot_processor.settings, "USERBOT_PROCESSING_TIMEOUT", 300)

    await userbot_processor._resolve_stuck_processing_orders()

    async with session_factory() as session:
        reloaded = await session.get(UserbotGiftOrder, order.id)
        assert reloaded is not None
        assert reloaded.status == "failed"
        assert reloaded.failure_reason == "outcome_unknown_manual_review"


@pytest.mark.asyncio
async def test_low_observed_balance_blocks_paid_send_before_payment(
    db_session: AsyncSession,
    fake_redis: FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=4105)
    await userbot_gift_sender.add_ledger_event(
        db_session,
        event_type="manual_topup",
        amount=1000,
        gift_order_id=None,
        note="seed",
    )
    await db_session.commit()
    prime_catalog(fake_redis, gift_id=333, stars=20)
    await fake_redis.set(userbot_gift_sender.REDIS_USERBOT_OBSERVED_BALANCE_KEY, "10")

    fake_client = FakeTelethonClient()

    async def fake_connect():
        return fake_client

    monkeypatch.setattr(userbot_gift_sender.userbot_client, "connect", fake_connect)

    order = await create_order(
        db_session,
        user_id=user.id,
        recipient_telegram_id=user.telegram_id,
        telegram_gift_id=333,
    )

    with pytest.raises(userbot_gift_sender.UserbotRetryLater) as exc_info:
        await userbot_gift_sender.process_userbot_order(order, db_session)

    assert exc_info.value.reason == "low_observed_balance"
    assert await userbot_gift_sender.is_low_balance_paused() is True
    assert fake_client.calls == []


@pytest.mark.asyncio
async def test_admin_status_topup_list_and_resolve(
    db_session: AsyncSession,
    fake_redis: FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=4106)
    monkeypatch.setattr(admin_userbot.settings, "USERBOT_ENABLED", True)
    await admin_userbot.topup_stars(
        body=UserbotStarsTopupRequest(amount=200, note="admin"),
        db=db_session,
    )

    order = await create_order(
        db_session,
        user_id=user.id,
        recipient_telegram_id=user.telegram_id,
        telegram_gift_id=444,
        star_cost_estimate=30,
        status="failed",
        attempts=2,
    )
    await fake_redis.set(userbot_gift_sender.REDIS_USERBOT_OBSERVED_BALANCE_KEY, "180")
    await fake_redis.set(userbot_gift_sender.REDIS_USERBOT_OBSERVED_BALANCE_UPDATED_KEY, "2026-03-30T12:00:00")
    payload = {
        "updated_at": "2026-03-30T12:00:00",
        "gifts": [{"id": 444, "stars": 30}],
    }
    await fake_redis.set(userbot_gift_sender.REDIS_USERBOT_GIFT_CATALOG_KEY, json.dumps(payload))
    await fake_redis.set(userbot_gift_sender.REDIS_USERBOT_LOW_BALANCE_KEY, "1")
    await fake_redis.set(userbot_gift_sender.REDIS_USERBOT_CIRCUIT_BREAKER_KEY, "1", ex=60)

    async def fake_is_connected() -> bool:
        return True

    async def fake_is_authorized() -> bool:
        return True

    monkeypatch.setattr(admin_userbot.userbot_client, "is_connected", fake_is_connected)
    monkeypatch.setattr(admin_userbot.userbot_client, "is_authorized", fake_is_authorized)

    status = await admin_userbot.get_userbot_status(db=db_session)
    orders_response = await admin_userbot.list_orders(db=db_session)
    resolved = await admin_userbot.resolve_order(
        order_id=order.id,
        body=UserbotOrderResolveRequest(action="mark_completed", note="manual check"),
        db=db_session,
    )

    ledger_entries = (await db_session.execute(select(UserbotStarsLedger))).scalars().all()

    assert status.enabled is True
    assert status.connected is True
    assert status.authorized is True
    assert status.ledger_balance == 200
    assert status.observed_balance == 180
    assert status.low_balance_paused is True
    assert status.circuit_breaker_active is True
    assert len(orders_response.orders) == 1
    assert resolved.status == "completed"
    assert resolved.star_cost_estimate == 30
    assert len(ledger_entries) == 2
    assert ledger_entries[-1].event_type == "reconcile_adjustment"
    assert ledger_entries[-1].amount == -30


@pytest.mark.asyncio
async def test_process_order_does_not_spend_rate_limit_slot_on_catalog_failure(
    db_session: AsyncSession,
    fake_redis: FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=4107)
    await userbot_gift_sender.add_ledger_event(
        db_session,
        event_type="manual_topup",
        amount=1000,
        gift_order_id=None,
        note="seed",
    )
    await db_session.commit()

    fake_client = FakeTelethonClient()

    async def fake_connect():
        return fake_client

    monkeypatch.setattr(userbot_gift_sender.userbot_client, "connect", fake_connect)

    order = await create_order(
        db_session,
        user_id=user.id,
        recipient_telegram_id=user.telegram_id,
        telegram_gift_id=999999,
    )

    with pytest.raises(userbot_gift_sender.UserbotPermanentError) as exc_info:
        await userbot_gift_sender.process_userbot_order(order, db_session)

    rate_count = await fake_redis.zcard(userbot_gift_sender.REDIS_USERBOT_RATE_LIMIT_ZSET_KEY)
    assert str(exc_info.value) == "gift_not_found_in_catalog"
    assert rate_count == 0


@pytest.mark.asyncio
async def test_pending_paid_orders_are_deferred_without_processing_when_low_balance_paused(
    session_factory,
    fake_redis: FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with session_factory() as session:
        user = await create_user(session, telegram_id=4108)
        order = await create_order(
            session,
            user_id=user.id,
            recipient_telegram_id=user.telegram_id,
            operation_type="send_gift",
            telegram_gift_id=111,
        )

    monkeypatch.setattr(userbot_processor, "AsyncSessionLocal", session_factory)
    await fake_redis.set(userbot_gift_sender.REDIS_USERBOT_LOW_BALANCE_KEY, "1")

    async def fake_refresh_balance() -> int:
        return 10

    async def fake_refresh_catalog() -> list[dict]:
        return []

    async def fake_circuit() -> bool:
        return False

    monkeypatch.setattr(userbot_processor, "_refresh_observed_stars_balance", fake_refresh_balance)
    monkeypatch.setattr(userbot_processor, "_refresh_catalog_cache", fake_refresh_catalog)
    monkeypatch.setattr(userbot_processor, "is_circuit_breaker_open", fake_circuit)

    await userbot_processor._process_pending_orders()

    async with session_factory() as session:
        reloaded = await session.get(UserbotGiftOrder, order.id)
        assert reloaded is not None
        assert reloaded.status == "pending"
        assert reloaded.processing_started_at is None
        assert reloaded.retry_after is not None
        assert reloaded.failure_reason == "low_observed_balance"


@pytest.mark.asyncio
async def test_admin_mutations_are_blocked_when_userbot_disabled(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(admin_userbot.settings, "USERBOT_ENABLED", False)
    with pytest.raises(HTTPException) as exc_info:
        await admin_userbot.topup_stars(
            body=UserbotStarsTopupRequest(amount=50, note="disabled"),
            db=db_session,
        )
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_attempt_order_marks_activation_required_when_peer_is_unknown(
    db_session: AsyncSession,
    fake_redis: FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=4109, username=None)
    await userbot_gift_sender.add_ledger_event(
        db_session,
        event_type="manual_topup",
        amount=300,
        gift_order_id=None,
        note="seed",
    )
    await db_session.commit()
    prime_catalog(fake_redis, gift_id=555, stars=20)
    await fake_redis.set(userbot_gift_sender.REDIS_USERBOT_OBSERVED_BALANCE_KEY, "300")

    fake_client = FakeTelethonClient(
        fail_get_input_entity=True,
        fail_get_entity=True,
    )

    async def fake_connect():
        return fake_client

    monkeypatch.setattr(userbot_gift_sender.userbot_client, "connect", fake_connect)

    order = await create_order(
        db_session,
        user_id=user.id,
        recipient_telegram_id=user.telegram_id,
        telegram_gift_id=555,
    )

    await userbot_processor._attempt_order(db_session, order)
    await db_session.refresh(order)
    await db_session.refresh(user)

    assert order.status == "activation_required"
    assert order.failure_reason == "recipient_activation_required"
    assert user.userbot_peer_status == "activation_required"


@pytest.mark.asyncio
async def test_username_resolution_caches_access_hash_for_future_sends(
    db_session: AsyncSession,
    fake_redis: FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=4110, username="gift_user")
    await userbot_gift_sender.add_ledger_event(
        db_session,
        event_type="manual_topup",
        amount=400,
        gift_order_id=None,
        note="seed",
    )
    await db_session.commit()
    prime_catalog(fake_redis, gift_id=556, stars=15)
    await fake_redis.set(userbot_gift_sender.REDIS_USERBOT_OBSERVED_BALANCE_KEY, "400")

    fake_client = FakeTelethonClient(
        fail_get_input_entity=True,
        fail_get_entity=False,
        entity_access_hash=123456789,
    )

    async def fake_connect():
        return fake_client

    monkeypatch.setattr(userbot_gift_sender.userbot_client, "connect", fake_connect)

    order = await create_order(
        db_session,
        user_id=user.id,
        recipient_telegram_id=user.telegram_id,
        telegram_gift_id=556,
    )

    await userbot_processor._attempt_order(db_session, order)
    await db_session.refresh(order)
    await db_session.refresh(user)

    assert order.status == "completed"
    assert user.userbot_access_hash == 123456789
    assert user.userbot_peer_status == "resolved"


@pytest.mark.asyncio
async def test_persist_userbot_peer_requeues_activation_required_orders(
    db_session: AsyncSession,
) -> None:
    user = await create_user(
        db_session,
        telegram_id=4111,
        username=None,
        userbot_peer_status="activation_required",
    )
    order = await create_order(
        db_session,
        user_id=user.id,
        recipient_telegram_id=user.telegram_id,
        status="activation_required",
        telegram_gift_id=557,
    )
    order.failure_reason = "recipient_activation_required"
    await db_session.commit()

    persisted = await userbot_peers.persist_userbot_peer(
        db_session,
        telegram_id=user.telegram_id,
        access_hash=222333444,
        username="activated_user",
    )
    await db_session.commit()
    await db_session.refresh(user)
    await db_session.refresh(order)

    assert persisted is not None
    assert user.userbot_access_hash == 222333444
    assert user.userbot_peer_status == "resolved"
    assert user.username == "activated_user"
    assert order.status == "pending"
    assert order.failure_reason is None
