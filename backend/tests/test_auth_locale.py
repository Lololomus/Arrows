import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api import auth
from app.database import Base
from app.models import User
from app.schemas import TelegramAuthRequest, UserLocaleUpdateRequest


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
    locale: str = "en",
    locale_manually_set: bool = False,
) -> User:
    user = User(
        telegram_id=telegram_id,
        username=f"user_{telegram_id}",
        first_name="Test",
        locale=locale,
        locale_manually_set=locale_manually_set,
        current_level=1,
        coins=0,
        energy=5,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_auth_telegram_uses_telegram_locale_before_manual_override(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=101, locale="en", locale_manually_set=False)

    monkeypatch.setattr(
        auth,
        "validate_telegram_init_data",
        lambda _init_data: {
            "id": user.telegram_id,
            "username": "updated_name",
            "first_name": "Updated",
            "language_code": "ru",
            "photo_url": None,
            "is_premium": False,
        },
    )

    response = await auth.auth_telegram(TelegramAuthRequest(init_data="test"), db=db_session)

    await db_session.refresh(user)

    assert user.locale == "ru"
    assert user.locale_manually_set is False
    assert response.user["locale"] == "ru"
    assert response.user["locale_manually_set"] is False


@pytest.mark.asyncio
async def test_auth_telegram_preserves_manual_locale_override(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_user(db_session, telegram_id=102, locale="ru", locale_manually_set=True)

    monkeypatch.setattr(
        auth,
        "validate_telegram_init_data",
        lambda _init_data: {
            "id": user.telegram_id,
            "username": user.username,
            "first_name": user.first_name,
            "language_code": "en",
            "photo_url": None,
            "is_premium": False,
        },
    )

    response = await auth.auth_telegram(TelegramAuthRequest(init_data="test"), db=db_session)

    await db_session.refresh(user)

    assert user.locale == "ru"
    assert user.locale_manually_set is True
    assert response.user["locale"] == "ru"
    assert response.user["locale_manually_set"] is True


@pytest.mark.asyncio
async def test_update_locale_persists_manual_flag(db_session: AsyncSession) -> None:
    user = await create_user(db_session, telegram_id=103, locale="en", locale_manually_set=False)

    response = await auth.update_locale(
        UserLocaleUpdateRequest(locale="ru"),
        user=user,
        db=db_session,
    )

    await db_session.refresh(user)

    assert user.locale == "ru"
    assert user.locale_manually_set is True
    assert response.locale == "ru"
    assert response.locale_manually_set is True
