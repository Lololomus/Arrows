"""
Arrow Puzzle - Authentication API

Авторизация через Telegram Mini App (БЕЗ МОКОВ!).
"""

import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
import jwt

from ..config import settings
from ..database import get_db, get_redis
from ..models import User, UserStats, Referral
from ..schemas import (
    TelegramAuthRequest,
    AuthResponse,
    UserResponse,
    UserLocaleUpdateRequest,
)
from ..middleware.security import validate_telegram_init_data, limiter
from ..services.i18n import normalize_locale


router = APIRouter(prefix="/auth", tags=["auth"])


# ============================================
# JWT HELPERS
# ============================================

def create_jwt_token(user_id: int, issued_at: Optional[int] = None) -> str:
    """
    Создаёт JWT токен.
    ВАЖНО: Короткий expiration (1 hour) для безопасности!
    """
    issued_at = issued_at or int(time.time())
    payload = {
        "sub": str(user_id),
        "iat": issued_at,
        "exp": get_jwt_expiration_timestamp(issued_at),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def get_jwt_expiration_timestamp(issued_at: int) -> int:
    return issued_at + settings.JWT_EXPIRE_HOURS * 3600


def serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "telegram_id": user.telegram_id,
        "username": user.username,
        "first_name": user.first_name,
        "locale": normalize_locale(getattr(user, "locale", None)),
        "locale_manually_set": bool(getattr(user, "locale_manually_set", False)),
        "photo_url": user.photo_url,
        "current_level": user.current_level,
        "total_stars": user.total_stars,
        "coins": user.coins,
        "hint_balance": user.hint_balance,
        "revive_balance": user.revive_balance,
        "extra_lives": user.extra_lives,
        "energy": user.energy,
        "is_premium": user.is_premium,
        "active_arrow_skin": user.active_arrow_skin,
        "active_theme": user.active_theme,
        "referrals_count": user.referrals_count,
        "referrals_pending": user.referrals_pending,
        "wallet_address": user.wallet_address,
        "stars_balance": user.stars_balance,
        "case_pity_counter": user.case_pity_counter,
    }


def build_auth_response(user: User) -> AuthResponse:
    issued_at = int(time.time())
    expires_at_ts = get_jwt_expiration_timestamp(issued_at)
    token = create_jwt_token(user.id, issued_at=issued_at)
    expires_at_iso = datetime.fromtimestamp(expires_at_ts, tz=timezone.utc).isoformat()

    return AuthResponse(
        token=token,
        expires_at=expires_at_iso,
        user=serialize_user(user),
    )


def verify_jwt_token(token: str) -> Optional[int]:
    """Проверяет JWT токен и возвращает user_id."""
    try:
        payload = jwt.decode(
            token, 
            settings.JWT_SECRET, 
            algorithms=[settings.JWT_ALGORITHM]
        )
        return int(payload["sub"])
    except jwt.ExpiredSignatureError:
        print("⚠️  [Auth] Token expired")
        return None
    except jwt.InvalidTokenError as e:
        print(f"⚠️  [Auth] Invalid token: {e}")
        return None


# ============================================
# DEPENDENCY: GET CURRENT USER
# ============================================

async def get_current_user(
    authorization: Optional[str] = Header(None),
    x_dev_user_id: Optional[str] = Header(None, alias="X-Dev-User-Id"),
    db: AsyncSession = Depends(get_db)
) -> User:
    """
    Dependency для получения текущего пользователя.
    
    Логика работы:
    1. Если включен DEV_AUTH и передан заголовок X-Dev-User-Id -> Входим как разработчик (без токена).
    2. Иначе -> Требуем стандартный Bearer токен.
    """

    # --- 1. DEV MODE: Controlled bypass ---
    if x_dev_user_id is not None:
        if settings.is_production:
            raise HTTPException(
                status_code=403,
                detail="Development authentication is disabled in production"
            )
        if not settings.DEV_AUTH_ENABLED:
            raise HTTPException(
                status_code=403,
                detail="Development authentication is disabled"
            )

        try:
            telegram_id = int(x_dev_user_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid X-Dev-User-Id header")

        if telegram_id not in settings.dev_auth_allowlist_ids:
            raise HTTPException(status_code=403, detail="Dev user id is not allowlisted")

        result = await db.execute(select(User).where(User.telegram_id == telegram_id))
        user = result.scalar_one_or_none()

        if not user:
            if not settings.dev_auth_auto_create_enabled:
                raise HTTPException(status_code=401, detail="Dev user not found")
            print(f"🛠 [Auth] Dev user {telegram_id} not found, creating...")
            user = User(
                telegram_id=telegram_id,
                username="dev_user",
                first_name="Developer",
                locale="en",
                locale_manually_set=False,
                current_level=1,
                coins=settings.DEV_AUTH_DEFAULT_COINS,
                energy=min(settings.DEV_AUTH_DEFAULT_ENERGY, settings.MAX_ENERGY),
                is_premium=False,
            )
            db.add(user)
            stats = UserStats(user=user)
            db.add(stats)
            await db.commit()
            await db.refresh(user)
            print(f"✅ [Auth] Dev user {telegram_id} created and logged in")

        return user

    # --- 2. PROD MODE: Стандартная проверка токена ---
    if not authorization:
         raise HTTPException(status_code=401, detail="Missing authorization header")

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    
    token = authorization[7:]
    
    user_id = verify_jwt_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    
    # Проверка бана
    if getattr(user, 'is_banned', False):
        raise HTTPException(
            status_code=403, 
            detail=f"Account banned: {getattr(user, 'ban_reason', 'Unknown')}"
        )
    
    return user


# ============================================
# REFERRAL: Redis Fallback (EC-16)
# ============================================

async def apply_redis_referral(user: User, db: AsyncSession):
    """
    Проверяет Redis на сохранённый реферальный код (EC-16).

    Вызывается ТОЛЬКО для новых пользователей (при первой регистрации).
    Когда пользователь кликает ссылку t.me/bot?start=ref_CODE, но НЕ открывает
    Mini App сразу, бот сохраняет код в Redis. При создании аккаунта код подхватывается.
    """
    if user.referred_by_id is not None:
        return  # уже есть реферер

    try:
        redis = await get_redis()
        key = f"ref_pending:{user.telegram_id}"
        code = await redis.get(key)

        if not code:
            return

        print(f"📥 [Auth] Found pending referral for telegram_id={user.telegram_id}")

        if isinstance(code, bytes):
            code = code.decode("utf-8")

        # Lock user row to prevent race condition with POST /referral/apply
        locked = await db.execute(
            select(User).where(User.id == user.id).with_for_update()
        )
        user = locked.scalar_one()
        if user.referred_by_id is not None:
            await redis.delete(key)
            return

        # Ищем инвайтера
        result = await db.execute(
            select(User).where(User.referral_code == code.upper())
        )
        referrer = result.scalar_one_or_none()

        if not referrer or referrer.id == user.id:
            await redis.delete(key)
            return

        # Создаём реферал
        try:
            referral = Referral(
                inviter_id=referrer.id,
                invitee_id=user.id,
                status="pending",
                invitee_bonus_paid=True,
            )
            db.add(referral)

            user.referred_by_id = referrer.id
            user.coins += settings.REFERRAL_REWARD_INVITEE  # +100 СРАЗУ
            referrer.referrals_pending += 1

            await db.commit()
            print(f"✅ [Auth] Redis referral applied: {user.id} → inviter {referrer.id}")
        except IntegrityError:
            await db.rollback()
            print(f"ℹ️ [Auth] Redis referral already applied for user={user.id}")

        await redis.delete(key)

    except Exception as e:
        # Redis недоступен — не критично
        print(f"⚠️ [Auth] Redis referral check failed: {e}")


# ============================================
# ENDPOINTS
# ============================================

@router.post("/telegram", response_model=AuthResponse)
# @limiter.limit(f"{settings.RATE_LIMIT_AUTH}/minute")
async def auth_telegram(
    request: TelegramAuthRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Авторизация через Telegram Mini App.
    Использует реальную верификацию initData.
    """
    # Верификация Telegram данных
    telegram_user = validate_telegram_init_data(request.init_data)
    
    if not telegram_user:
        raise HTTPException(
            status_code=401, 
            detail="Invalid Telegram authentication data"
        )
    
    telegram_id = telegram_user["id"]
    username = telegram_user.get("username")
    first_name = telegram_user.get("first_name")
    locale = normalize_locale(telegram_user.get("language_code"))
    photo_url = telegram_user.get("photo_url")
    is_premium = telegram_user.get("is_premium", False)
    
    print(f"✅ [Auth] Telegram user {telegram_id} authenticated")
    
    # Ищем или создаём пользователя
    result = await db.execute(
        select(User).where(User.telegram_id == telegram_id)
    )
    user = result.scalar_one_or_none()
    
    if not user:
        # Создаём нового пользователя
        user = User(
            telegram_id=telegram_id,
            username=username,
            first_name=first_name,
            locale=locale,
            locale_manually_set=False,
            photo_url=photo_url,
            coins=settings.INITIAL_COINS,
            energy=settings.MAX_ENERGY,
            is_premium=is_premium,
        )
        db.add(user)
        
        # Создаём статистику
        stats = UserStats(user=user)
        db.add(stats)
        
        await db.commit()
        await db.refresh(user)

        print(f"🆕 [Auth] New user created: {user.id}")

        # EC-16: Redis fallback — только для новых пользователей
        await apply_redis_referral(user, db)
        await db.refresh(user)
    else:
        # Обновляем данные если изменились
        updated = False
        if user.username != username:
            user.username = username
            updated = True
        if user.first_name != first_name:
            user.first_name = first_name
            updated = True
        if not bool(getattr(user, "locale_manually_set", False)) and normalize_locale(getattr(user, "locale", None)) != locale:
            user.locale = locale
            updated = True
        if user.photo_url != photo_url:
            user.photo_url = photo_url
            updated = True
        if user.is_premium != is_premium:
            user.is_premium = is_premium
            updated = True
        
        if updated:
            await db.commit()
            print(f"🔄 [Auth] User {user.id} data updated")
    
    # Создаём JWT токен
    return build_auth_response(user)


@router.get("/me", response_model=UserResponse)
# @limiter.limit(f"{settings.RATE_LIMIT_AUTH}/minute")
async def get_me(user: User = Depends(get_current_user)):
    """Получить данные текущего пользователя."""
    return UserResponse.model_validate(serialize_user(user))


@router.put("/locale", response_model=UserResponse)
async def update_locale(
    body: UserLocaleUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    locale = normalize_locale(body.locale)
    updated = False

    if normalize_locale(getattr(user, "locale", None)) != locale:
        user.locale = locale
        updated = True
    if not bool(getattr(user, "locale_manually_set", False)):
        user.locale_manually_set = True
        updated = True

    if updated:
        await db.commit()
        await db.refresh(user)

    return UserResponse.model_validate(serialize_user(user))


@router.post("/refresh", response_model=AuthResponse)
# @limiter.limit(f"{settings.RATE_LIMIT_AUTH}/minute")
async def refresh_token(user: User = Depends(get_current_user)):
    """
    Обновить JWT токен.
    """
    return build_auth_response(user)
