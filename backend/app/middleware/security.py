"""
Arrow Puzzle - Security Middleware

Rate limiting, request validation, security headers.
"""

from fastapi import Request, HTTPException, status
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from typing import Callable
import time
import hashlib
import hmac

from ..config import settings


# ============================================
# RATE LIMITER
# ============================================

limiter = Limiter(key_func=get_remote_address)


def get_rate_limit_key(request: Request) -> str:
    """
    Ключ для rate limiting.
    Использует IP + user_id (если авторизован).
    """
    ip = get_remote_address(request)
    
    # Пытаемся получить user из state (если авторизован)
    user_id = getattr(request.state, "user_id", None)
    
    if user_id:
        return f"{ip}:{user_id}"
    return ip


# ============================================
# TELEGRAM VALIDATION
# ============================================

def validate_telegram_init_data(init_data: str) -> dict | None:
    """
    Валидация Telegram initData.
    
    Официальная документация:
    https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    
    Returns:
        dict с данными юзера или None если невалидно
    """
    try:
        from urllib.parse import parse_qs, unquote
        import json
        
        # Парсим данные
        parsed = parse_qs(init_data)
        
        # Получаем hash
        received_hash = parsed.get("hash", [None])[0]
        if not received_hash:
            print("❌ [Security] No hash in initData")
            return None
        
        # Проверяем auth_date (не старше 24 часов)
        auth_date = int(parsed.get("auth_date", [0])[0])
        if time.time() - auth_date > 86400:
            print(f"❌ [Security] initData too old: {time.time() - auth_date}s")
            return None
        
        # Собираем data_check_string (все кроме hash, отсортировано)
        data_check_arr = []
        for key in sorted(parsed.keys()):
            if key != "hash":
                value = parsed[key][0]
                data_check_arr.append(f"{key}={value}")
        
        data_check_string = "\n".join(data_check_arr)
        
        # Создаём secret_key
        secret_key = hmac.new(
            b"WebAppData",
            settings.TELEGRAM_BOT_TOKEN.encode(),
            hashlib.sha256
        ).digest()
        
        # Вычисляем hash
        calculated_hash = hmac.new(
            secret_key,
            data_check_string.encode(),
            hashlib.sha256
        ).hexdigest()
        
        # Сравниваем (constant-time comparison!)
        if not hmac.compare_digest(calculated_hash, received_hash):
            print(f"❌ [Security] Hash mismatch")
            print(f"   Expected: {calculated_hash}")
            print(f"   Received: {received_hash}")
            return None
        
        # Парсим user
        user_json = parsed.get("user", [None])[0]
        if not user_json:
            print("❌ [Security] No user in initData")
            return None
        
        user_data = json.loads(unquote(user_json))
        
        print(f"✅ [Security] Telegram auth OK: {user_data.get('id')}")
        return user_data
        
    except Exception as e:
        print(f"❌ [Security] Telegram validation error: {e}")
        return None


# ============================================
# WEBHOOK SIGNATURE VALIDATION
# ============================================

def validate_telegram_payment_signature(data: str, signature: str) -> bool:
    """Валидация подписи Telegram Payment webhook."""
    try:
        calculated = hmac.new(
            settings.TELEGRAM_BOT_TOKEN.encode(),
            data.encode(),
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(calculated, signature)
    except Exception as e:
        print(f"❌ [Security] Payment signature error: {e}")
        return False


def validate_ton_payment_signature(data: str, signature: str) -> bool:
    """Валидация подписи TON Payment."""
    try:
        # TON использует другой механизм - нужно уточнить у провайдера
        # Placeholder
        return True
    except Exception as e:
        print(f"❌ [Security] TON signature error: {e}")
        return False


def validate_adsgram_signature(user_id: int, reward_type: str, signature: str) -> bool:
    """Валидация подписи Adsgram reward."""
    try:
        data = f"{user_id}:{reward_type}"
        calculated = hmac.new(
            settings.ADSGRAM_SECRET.encode(),
            data.encode(),
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(calculated, signature)
    except Exception as e:
        print(f"❌ [Security] Adsgram signature error: {e}")
        return False


# ============================================
# REQUEST VALIDATORS
# ============================================

async def validate_json_size(request: Request, max_size: int = 1024 * 100):
    """
    Проверка размера JSON (защита от DoS).
    Max 100KB по умолчанию.
    """
    content_length = request.headers.get("content-length")
    
    if content_length and int(content_length) > max_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Request too large"
        )


async def validate_api_key(request: Request):
    """
    Валидация API ключа (для admin endpoints).
    """
    api_key = request.headers.get("X-API-Key")
    
    # В production используйте env переменную
    valid_key = settings.ADMIN_API_KEY if hasattr(settings, 'ADMIN_API_KEY') else None
    
    if not valid_key or api_key != valid_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key"
        )


# ============================================
# SECURITY HEADERS MIDDLEWARE
# ============================================

async def add_security_headers(request: Request, call_next: Callable):
    """Добавляет security headers ко всем ответам."""
    response = await call_next(request)
    
    # Security headers
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    
    # CSP (для production настройте под ваш домен)
    if not settings.DEBUG:
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' https://telegram.org; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https:; "
            "connect-src 'self' https://api.telegram.org"
        )
    
    return response


# ============================================
# IP WHITELIST (для admin endpoints)
# ============================================

ADMIN_IP_WHITELIST = set([
    "127.0.0.1",
    # Добавьте ваши IP
])


async def check_admin_ip(request: Request):
    """Проверка IP для admin endpoints."""
    client_ip = get_remote_address(request)
    
    if client_ip not in ADMIN_IP_WHITELIST and not settings.DEBUG:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )