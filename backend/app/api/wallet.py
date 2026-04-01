"""
Arrow Puzzle - Wallet API (TON Connect)

Подключение / отключение TON-кошелька.
"""

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pytoniq_core import Address
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..config import settings
from ..database import get_db, get_redis
from ..models import User
from ..schemas import (
    WalletConnectRequest,
    WalletConnectResponse,
    WalletStatusResponse,
    WalletDisconnectResponse,
)
from ..services.ton_proof import verify_ton_proof
from .error_utils import api_error
from .auth import get_current_user


def _normalize_address(address: str) -> str:
    """Normalize any TON address form to raw format (e.g. '0:abcdef...')."""
    return Address(address).to_str(is_user_friendly=False).lower()


router = APIRouter(prefix="/wallet", tags=["wallet"])


# ============================================
# PROOF PAYLOAD (challenge)
# ============================================

@router.get("/proof-payload")
async def get_proof_payload(user: User = Depends(get_current_user)):
    """
    Генерирует challenge payload для TON Connect proof.
    Сохраняет в Redis с TTL.
    """
    payload = secrets.token_hex(32)

    redis = await get_redis()
    key = f"ton_proof:{user.id}"
    await redis.set(key, payload, ex=settings.TON_CONNECT_PAYLOAD_TTL)

    return {"payload": payload}


# ============================================
# CONNECT
# ============================================

@router.post("/connect", response_model=WalletConnectResponse)
async def connect_wallet(
    request: WalletConnectRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Верифицирует TON Connect proof и привязывает кошелёк к пользователю.
    """
    # 1. Получить challenge из Redis
    redis = await get_redis()
    key = f"ton_proof:{user.id}"
    expected_payload = await redis.get(key)

    if not expected_payload:
        raise api_error(400, "PROOF_PAYLOAD_EXPIRED", "Proof payload expired or not found")

    if isinstance(expected_payload, bytes):
        expected_payload = expected_payload.decode("utf-8")

    # 2. Parse allowed domains
    allowed_domains = [
        d.strip()
        for d in settings.TON_CONNECT_ALLOWED_DOMAINS.split(",")
        if d.strip()
    ]

    # 3. Verify proof
    is_valid = verify_ton_proof(
        address=request.address,
        proof=request.proof,
        expected_payload=expected_payload,
        allowed_domains=allowed_domains,
    )

    if not is_valid:
        return WalletConnectResponse(success=False, error="INVALID_PROOF")

    # 4. Delete used challenge (single-use)
    await redis.delete(key)

    # 5. Normalize address to canonical raw format to prevent
    #    the same wallet being linked via different string representations
    #    (bounceable, non-bounceable, testnet, raw hex, etc.)
    try:
        canonical_address = _normalize_address(request.address)
    except Exception:
        return WalletConnectResponse(success=False, error="INVALID_ADDRESS_FORMAT")

    # 6. Check if wallet already bound to another user
    result = await db.execute(
        select(User).where(
            User.wallet_address == canonical_address,
            User.id != user.id,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        return WalletConnectResponse(
            success=False,
            error="WALLET_ALREADY_CONNECTED",
        )

    # 7. Bind wallet
    user.wallet_address = canonical_address
    user.wallet_connected_at = datetime.utcnow()
    await db.commit()

    return WalletConnectResponse(
        success=True,
        wallet_address=canonical_address,
    )


# ============================================
# STATUS
# ============================================

@router.get("/status", response_model=WalletStatusResponse)
async def wallet_status(user: User = Depends(get_current_user)):
    """Возвращает текущий статус кошелька."""
    return WalletStatusResponse(
        connected=user.wallet_address is not None,
        wallet_address=user.wallet_address,
    )


# ============================================
# DISCONNECT
# ============================================

@router.post("/disconnect", response_model=WalletDisconnectResponse)
async def disconnect_wallet(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отвязывает кошелёк от аккаунта."""
    user.wallet_address = None
    user.wallet_connected_at = None
    await db.commit()

    return WalletDisconnectResponse(success=True)
