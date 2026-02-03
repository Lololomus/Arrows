"""
Arrow Puzzle - Authentication API

Авторизация через Telegram Mini App (БЕЗ МОКОВ!).
"""

import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import jwt

from ..config import settings
from ..database import get_db
from ..models import User, UserStats
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
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db)
) -> User:
    """
    Dependency для получения текущего пользователя.
    БЕЗ МОКОВ!
    """
    # Проверяем формат
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    
    token = authorization[7:]
    
    # Проверяем токен
    user_id = verify_jwt_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    # Получаем пользователя
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    
    # Проверяем бан
    if getattr(user, 'is_banned', False):
        raise HTTPException(
            status_code=403, 
            detail=f"Account banned: {getattr(user, 'ban_reason', 'Unknown')}"
        )
    
    return user


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
    
    БЕЗ МОКОВ! Использует реальную верификацию initData.
    """
    # ============================================
    # ВАЖНО: Верификация Telegram данных
    # ============================================
    
    telegram_user = validate_telegram_init_data(request.init_data)
    
    if not telegram_user:
        raise HTTPException(
            status_code=401, 
            detail="Invalid Telegram authentication data"
        )
    
    telegram_id = telegram_user["id"]
    username = telegram_user.get("username")
    first_name = telegram_user.get("first_name")
    is_premium = telegram_user.get("is_premium", False)
    
    print(f"✅ [Auth] Telegram user {telegram_id} authenticated")
    
    # ============================================
    # Ищем или создаём пользователя
    # ============================================
    
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
        
        if user.is_premium != is_premium:
            user.is_premium = is_premium
            updated = True
        
        if updated:
            await db.commit()
            print(f"🔄 [Auth] User {user.id} data updated")
    
    # ============================================
    # Создаём JWT токен
    # ============================================
    
    token = create_jwt_token(user.id)
    
    return AuthResponse(
        token=token,
        user={
            "id": user.id,
            "telegram_id": user.telegram_id,
            "username": user.username,
            "first_name": user.first_name,
            "current_level": user.current_level,
            "total_stars": user.total_stars,
            "coins": user.coins,
            "energy": user.energy,
            "is_premium": user.is_premium,
            "active_arrow_skin": user.active_arrow_skin,
            "active_theme": user.active_theme,
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
    Полезно когда токен скоро истекает.
    """
    token = create_jwt_token(user.id)
    
    return AuthResponse(
        token=token,
        user={
            "id": user.id,
            "telegram_id": user.telegram_id,
            "username": user.username,
            "first_name": user.first_name,
            "current_level": user.current_level,
            "total_stars": user.total_stars,
            "coins": user.coins,
            "energy": user.energy,
            "is_premium": user.is_premium,
            "active_arrow_skin": user.active_arrow_skin,
            "active_theme": user.active_theme,
        }
    )


# ============================================
# DEV MODE (только для локальной разработки!)
# ============================================

if settings.DEBUG and settings.ENVIRONMENT == "development":
    @router.post("/dev/mock")
    async def dev_mock_auth(db: AsyncSession = Depends(get_db)):
        """
        ⚠️ ТОЛЬКО ДЛЯ РАЗРАБОТКИ!
        Создаёт/получает мок-пользователя.
        """
        result = await db.execute(
            select(User).where(User.telegram_id == 999999)
        )
        user = result.scalar_one_or_none()
        
        if not user:
            user = User(
                telegram_id=999999,
                username="dev_user",
                first_name="Developer",
                current_level=1,
                coins=10000,
                energy=settings.MAX_ENERGY
            )
            db.add(user)
            
            stats = UserStats(user=user)
            db.add(stats)
            
            await db.commit()
            await db.refresh(user)
        
        token = create_jwt_token(user.id)
        
        return AuthResponse(
            token=token,
            user={
                "id": user.id,
                "telegram_id": user.telegram_id,
                "username": user.username,
                "first_name": user.first_name,
                "current_level": user.current_level,
                "total_stars": user.total_stars,
                "coins": user.coins,
                "energy": user.energy,
                "is_premium": user.is_premium,
                "active_arrow_skin": user.active_arrow_skin,
                "active_theme": user.active_theme,
            }
        )