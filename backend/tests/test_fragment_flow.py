from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api import admin_fragments, fragments
from app.database import Base
from app.models import BotStarsLedger, FragmentClaim, FragmentDrop, User
from app.schemas import (
    FragmentDropCreateRequest,
    FragmentDropUpdateRequest,
    ResolveClaimRequest,
)
from app.services import fragment_gifts, fragment_processor


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


async def create_user(
    session: AsyncSession,
    *,
    telegram_id: int,
    current_level: int = 1,
    referrals_count: int = 0,
) -> User:
    user = User(
        telegram_id=telegram_id,
        username=f"user_{telegram_id}",
        first_name="Test",
        current_level=current_level,
        referrals_count=referrals_count,
        coins=0,
        energy=5,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def create_drop(
    session: AsyncSession,
    *,
    slug: str,
    telegram_gift_id: str,
    gift_star_cost: int,
    total_stock: int,
    is_active: bool = True,
    condition_type: str = "arcade_levels",
    condition_target: int = 1,
    reserved_stock: int = 0,
    delivered_stock: int = 0,
) -> FragmentDrop:
    drop = FragmentDrop(
        slug=slug,
        title=slug,
        description="Test drop",
        emoji="🎁",
        telegram_gift_id=telegram_gift_id,
        gift_star_cost=gift_star_cost,
        condition_type=condition_type,
        condition_target=condition_target,
        total_stock=total_stock,
        is_active=is_active,
        reserved_stock=reserved_stock,
        delivered_stock=delivered_stock,
    )
    session.add(drop)
    await session.commit()
    await session.refresh(drop)
    return drop


async def create_claim(
    session: AsyncSession,
    *,
    drop_id: int,
    user_id: int,
    telegram_gift_id: str,
    stars_cost: int,
    status: str = "failed",
    failure_reason: str | None = None,
    attempts: int = 1,
) -> FragmentClaim:
    claim = FragmentClaim(
        drop_id=drop_id,
        user_id=user_id,
        status=status,
        telegram_gift_id=telegram_gift_id,
        stars_cost=stars_cost,
        failure_reason=failure_reason,
        attempts=attempts,
    )
    session.add(claim)
    await session.commit()
    await session.refresh(claim)
    return claim


async def add_ledger_entry(
    session: AsyncSession,
    *,
    amount: int,
    event_type: str = "manual_topup",
) -> BotStarsLedger:
    entry = BotStarsLedger(event_type=event_type, amount=amount)
    session.add(entry)
    await session.commit()
    await session.refresh(entry)
    return entry


def build_bot_factory(*, gifts: list[SimpleNamespace]):
    class FakeSession:
        async def close(self) -> None:
            return None

    class FakeBot:
        def __init__(self, token: str) -> None:
            self.token = token
            self.session = FakeSession()

        async def get_available_gifts(self) -> SimpleNamespace:
            return SimpleNamespace(gifts=gifts)

    return FakeBot


@pytest.mark.asyncio
async def test_send_gift_to_user_handles_missing_attempts_default_on_first_send(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=2100, current_level=6)
    drop = await create_drop(
        db_session,
        slug="first_send_attempts",
        telegram_gift_id="gift-first-send",
        gift_star_cost=25,
        total_stock=1,
        condition_target=5,
    )
    claim = FragmentClaim(
        drop_id=drop.id,
        user_id=user.id,
        telegram_gift_id=drop.telegram_gift_id,
        stars_cost=drop.gift_star_cost,
        status="pending",
        attempts=None,
    )
    db_session.add(claim)
    drop.reserved_stock = 1
    await db_session.commit()
    await db_session.refresh(claim)
    await db_session.refresh(drop)

    async def fake_send_gift(*, bot_token: str, user_id: int, gift_id: str) -> None:
        return None

    monkeypatch.setattr(fragment_gifts.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(fragment_gifts.settings, "TELEGRAM_BOT_TOKEN", "test-token")
    monkeypatch.setattr(fragment_gifts, "send_gift", fake_send_gift)

    status = await fragment_gifts.send_gift_to_user(claim, drop, user, db_session)

    await db_session.refresh(claim)
    await db_session.refresh(drop)
    ledger_entries = (await db_session.execute(select(BotStarsLedger))).scalars().all()

    assert status == "delivered"
    assert claim.status == "delivered"
    assert claim.attempts == 1
    assert drop.reserved_stock == 0
    assert drop.delivered_stock == 1
    assert len(ledger_entries) == 1
    assert ledger_entries[0].event_type == "gift_sent"


@pytest.mark.asyncio
async def test_send_gift_to_user_does_not_auto_retry_unknown_delivery_outcome(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=2101, current_level=6)
    drop = await create_drop(
        db_session,
        slug="unknown_outcome",
        telegram_gift_id="gift-unknown",
        gift_star_cost=25,
        total_stock=1,
        condition_target=5,
    )
    claim = FragmentClaim(
        drop_id=drop.id,
        user_id=user.id,
        telegram_gift_id=drop.telegram_gift_id,
        stars_cost=drop.gift_star_cost,
        status="pending",
        attempts=0,
    )
    db_session.add(claim)
    drop.reserved_stock = 1
    await db_session.commit()
    await db_session.refresh(claim)
    await db_session.refresh(drop)

    async def fake_send_gift(*, bot_token: str, user_id: int, gift_id: str) -> None:
        raise fragment_gifts.GiftApiUnknownOutcome("sendGift timed out")

    monkeypatch.setattr(fragment_gifts.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(fragment_gifts.settings, "TELEGRAM_BOT_TOKEN", "test-token")
    monkeypatch.setattr(fragment_gifts, "send_gift", fake_send_gift)

    status = await fragment_gifts.send_gift_to_user(claim, drop, user, db_session)

    await db_session.refresh(claim)
    await db_session.refresh(drop)
    ledger_entries = (await db_session.execute(select(BotStarsLedger))).scalars().all()

    assert status == "sending"
    assert claim.status == "sending"
    assert claim.attempts == 1
    assert "outcome_unknown:" in (claim.failure_reason or "")
    assert drop.reserved_stock == 1
    assert drop.delivered_stock == 0
    assert ledger_entries == []


@pytest.mark.asyncio
async def test_create_drop_uses_db_ledger_for_budget_checks(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await add_ledger_entry(db_session, amount=100)

    async def fake_cached_balance() -> int:
        return 10_000

    monkeypatch.setattr(admin_fragments, "get_cached_stars_balance", fake_cached_balance)

    with pytest.raises(HTTPException) as exc_info:
        await admin_fragments.create_drop(
            body=FragmentDropCreateRequest(
                slug="budget_create",
                title="Budget create",
                telegram_gift_id="gift-create",
                gift_star_cost=11,
                condition_type="arcade_levels",
                condition_target=5,
                total_stock=10,
            ),
            db=db_session,
        )

    await db_session.rollback()

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "INSUFFICIENT_BUDGET"

    drops = (await db_session.execute(select(FragmentDrop))).scalars().all()
    assert drops == []


@pytest.mark.asyncio
async def test_update_drop_blocks_activation_when_budget_exceeds_ledger(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await add_ledger_entry(db_session, amount=100)
    drop = await create_drop(
        db_session,
        slug="needs_activation",
        telegram_gift_id="gift-activation",
        gift_star_cost=30,
        total_stock=4,
        is_active=False,
        condition_target=4,
    )
    drop_id = drop.id

    async def fake_cached_balance() -> int:
        return 1_000_000

    monkeypatch.setattr(admin_fragments, "get_cached_stars_balance", fake_cached_balance)

    with pytest.raises(HTTPException) as exc_info:
        await admin_fragments.update_drop(
            drop_id=drop_id,
            body=FragmentDropUpdateRequest(is_active=True),
            db=db_session,
        )

    await db_session.rollback()
    reloaded = await db_session.get(FragmentDrop, drop_id)

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "INSUFFICIENT_BUDGET"
    assert reloaded is not None
    assert reloaded.is_active is False


@pytest.mark.asyncio
async def test_update_drop_blocks_price_increase_when_budget_exceeds_ledger(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await add_ledger_entry(db_session, amount=50)
    drop = await create_drop(
        db_session,
        slug="price_raise",
        telegram_gift_id="gift-price",
        gift_star_cost=10,
        total_stock=5,
        is_active=True,
        condition_target=3,
    )
    drop_id = drop.id

    async def fake_cached_balance() -> int:
        return 1_000_000

    monkeypatch.setattr(admin_fragments, "get_cached_stars_balance", fake_cached_balance)

    with pytest.raises(HTTPException) as exc_info:
        await admin_fragments.update_drop(
            drop_id=drop_id,
            body=FragmentDropUpdateRequest(gift_star_cost=11),
            db=db_session,
        )

    await db_session.rollback()
    reloaded = await db_session.get(FragmentDrop, drop_id)

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "INSUFFICIENT_BUDGET"
    assert reloaded is not None
    assert reloaded.gift_star_cost == 10


@pytest.mark.asyncio
async def test_claim_drop_blocks_retry_for_outcome_unknown_manual_review(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=2001, current_level=6)
    drop = await create_drop(
        db_session,
        slug="manual_review_user",
        telegram_gift_id="gift-manual-user",
        gift_star_cost=10,
        total_stock=1,
        condition_target=5,
    )
    await create_claim(
        db_session,
        drop_id=drop.id,
        user_id=user.id,
        telegram_gift_id=drop.telegram_gift_id,
        stars_cost=drop.gift_star_cost,
        failure_reason="outcome_unknown_manual_review",
    )

    monkeypatch.setattr(fragments.settings, "FRAGMENT_DROPS_ENABLED", True)

    with pytest.raises(HTTPException) as exc_info:
        await fragments.claim_drop(drop_id=drop.id, user=user, db=db_session)

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "MANUAL_REVIEW_REQUIRED"


@pytest.mark.asyncio
async def test_admin_retry_blocks_outcome_unknown_manual_review_claim(
    db_session: AsyncSession,
) -> None:
    user = await create_user(db_session, telegram_id=2002, current_level=6)
    drop = await create_drop(
        db_session,
        slug="manual_review_admin",
        telegram_gift_id="gift-manual-admin",
        gift_star_cost=10,
        total_stock=1,
        condition_target=5,
    )
    claim = await create_claim(
        db_session,
        drop_id=drop.id,
        user_id=user.id,
        telegram_gift_id=drop.telegram_gift_id,
        stars_cost=drop.gift_star_cost,
        failure_reason="outcome_unknown_manual_review",
    )
    claim_id = claim.id

    with pytest.raises(HTTPException) as exc_info:
        await admin_fragments.resolve_claim(
            claim_id=claim_id,
            body=ResolveClaimRequest(action="retry"),
            db=db_session,
        )

    await db_session.rollback()
    reloaded = await db_session.get(FragmentClaim, claim_id)

    assert exc_info.value.status_code == 409
    assert "outcome_unknown" in exc_info.value.detail
    assert reloaded is not None
    assert reloaded.status == "failed"
    assert reloaded.failure_reason == "outcome_unknown_manual_review"


@pytest.mark.asyncio
async def test_sync_gift_catalog_deactivates_drop_when_gift_missing(
    session_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with session_factory() as session:
        await create_drop(
            session,
            slug="missing_gift",
            telegram_gift_id="gift-missing",
            gift_star_cost=10,
            total_stock=2,
            is_active=True,
        )

    monkeypatch.setattr(fragment_processor, "AsyncSessionLocal", session_factory)
    async def fake_get_available_gifts(*, bot_token: str):
        return [{"id": "gift-other", "star_count": 10}]

    monkeypatch.setattr(fragment_processor, "get_available_gifts", fake_get_available_gifts)
    monkeypatch.setattr(fragment_processor.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(fragment_processor.settings, "TELEGRAM_BOT_TOKEN", "test-token")

    await fragment_processor._sync_gift_catalog()

    async with session_factory() as session:
        drop = (
            await session.execute(select(FragmentDrop).where(FragmentDrop.slug == "missing_gift"))
        ).scalar_one()
        assert drop.is_active is False


@pytest.mark.asyncio
async def test_sync_gift_catalog_deactivates_drop_on_price_mismatch(
    session_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with session_factory() as session:
        await create_drop(
            session,
            slug="price_mismatch",
            telegram_gift_id="gift-price-mismatch",
            gift_star_cost=10,
            total_stock=2,
            is_active=True,
        )

    monkeypatch.setattr(fragment_processor, "AsyncSessionLocal", session_factory)
    async def fake_get_available_gifts(*, bot_token: str):
        return [{"id": "gift-price-mismatch", "star_count": 12}]

    monkeypatch.setattr(fragment_processor, "get_available_gifts", fake_get_available_gifts)
    monkeypatch.setattr(fragment_processor.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(fragment_processor.settings, "TELEGRAM_BOT_TOKEN", "test-token")

    await fragment_processor._sync_gift_catalog()

    async with session_factory() as session:
        drop = (
            await session.execute(select(FragmentDrop).where(FragmentDrop.slug == "price_mismatch"))
        ).scalar_one()
        assert drop.is_active is False
