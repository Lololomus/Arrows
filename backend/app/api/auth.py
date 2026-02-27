"""
Arrow Puzzle - Authentication API

Авторизация через Telegram Mini App (БЕЗ МОКОВ!).
"""

import time
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
import jwt

from ..config import settings
from ..database import get_db, get_redis
from ..models import User, UserStats, Referral
from ..schemas import TelegramAuthRequest, AuthResponse, UserResponse
from ..middleware.security import validate_telegram_init_data, limiter


router = APIRouter(prefix="/auth", tags=["auth"])


# ============================================
# JWT HELPERS
# ============================================

def create_jwt_token(user_id: int) -> str:
    """
    Создаёт JWT токен.
    ВАЖНО: Короткий expiration (1 hour) для безопасности!
    """
    payload = {
        "sub": str(user_id),
        "iat": int(time.time()),
        "exp": int(time.time()) + settings.JWT_EXPIRE_HOURS * 3600,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


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
    
    Когда пользователь кликает ссылку t.me/bot?start=ref_CODE, но НЕ открывает
    Mini App сразу, бот-вебхук сохраняет код в Redis. При последующей авторизации
    в Mini App (даже без start_param) этот код подхватывается и применяется.
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
        
        # Grace period
        account_age = datetime.utcnow() - user.created_at
        if account_age > timedelta(hours=settings.REFERRAL_GRACE_PERIOD_HOURS):
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
    else:
        # Обновляем данные если изменились
        updated = False
        if user.username != username:
            user.username = username
            updated = True
        if user.first_name != first_name:
            user.first_name = first_name
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
    
    # EC-16: Проверяем Redis на сохранённый реферальный код
    # (если пользователь кликнул ссылку бота, но Mini App открыл позже без start_param)
    await apply_redis_referral(user, db)
    
    # Создаём JWT токен
    token = create_jwt_token(user.id)
    
    return AuthResponse(
        token=token,
        user={
            "id": user.id,
            "telegram_id": user.telegram_id,
            "username": user.username,
            "first_name": user.first_name,
            "photo_url": user.photo_url,
            "current_level": user.current_level,
            "total_stars": user.total_stars,
            "coins": user.coins,
            "energy": user.energy,
            "is_premium": user.is_premium,
            "active_arrow_skin": user.active_arrow_skin,
            "active_theme": user.active_theme,
            "referrals_count": user.referrals_count,
            "referrals_pending": user.referrals_pending,
        }
    )


@router.get("/me", response_model=UserResponse)
# @limiter.limit(f"{settings.RATE_LIMIT_AUTH}/minute")
async def get_me(user: User = Depends(get_current_user)):
    """Получить данные текущего пользователя."""
    return user


@router.post("/refresh", response_model=AuthResponse)
# @limiter.limit(f"{settings.RATE_LIMIT_AUTH}/minute")
async def refresh_token(user: User = Depends(get_current_user)):
    """
    Обновить JWT токен.
    """
    token = create_jwt_token(user.id)
    
    return AuthResponse(
        token=token,
        user={
            "id": user.id,
            "telegram_id": user.telegram_id,
            "username": user.username,
            "first_name": user.first_name,
            "photo_url": user.photo_url,
            "current_level": user.current_level,
            "total_stars": user.total_stars,
            "coins": user.coins,
            "energy": user.energy,
            "is_premium": user.is_premium,
            "active_arrow_skin": user.active_arrow_skin,
            "active_theme": user.active_theme,
            "referrals_count": user.referrals_count,
            "referrals_pending": user.referrals_pending,
        }
    )
