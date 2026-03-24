"""
Arrow Puzzle - Shop API

Магазин: скины, темы, бусты, покупки.
"""

import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)

from ..config import settings
from ..database import get_db
from ..models import User, Inventory, Transaction
from ..schemas import (
    ShopItem, ShopCatalog, PurchaseRequest, PurchaseResponse,
    TonPaymentInfo, TransactionStatusResponse
)
from ..services.ton_verify import verify_ton_transaction
from .auth import get_current_user


router = APIRouter(prefix="/shop", tags=["shop"])


# ============================================
# CATALOG DATA
# ============================================

# Скины стрелок
ARROW_SKINS = [
    {"id": "default", "name": "Стандартный", "price_coins": 0, "preview": "➡️"},
    {"id": "rainbow", "name": "Радужный", "price_coins": 500, "preview": "🌈"},
    {"id": "neon", "name": "Неоновый", "price_coins": 800, "preview": "✨"},
    {"id": "fire", "name": "Огненный", "price_stars": 50, "preview": "🔥"},
    {"id": "ice", "name": "Ледяной", "price_stars": 50, "preview": "❄️"},
    {"id": "gold", "name": "Золотой", "price_stars": 100, "preview": "👑"},
    {"id": "diamond", "name": "Алмазный", "price_ton": 1.0, "preview": "💎"},
    {"id": "cyber", "name": "Киберпанк", "price_ton": 2.0, "preview": "🤖"},
]

BETA_VISIBLE_BOOST_IDS = {"hints_1", "revive_1"}

# Темы оформления
THEMES = [
    {"id": "light", "name": "Светлая", "price_coins": 0, "preview": "☀️"},
    {"id": "dark", "name": "Тёмная", "price_coins": 200, "preview": "🌙"},
    {"id": "sakura", "name": "Сакура", "price_stars": 30, "preview": "🌸"},
    {"id": "ocean", "name": "Океан", "price_stars": 30, "preview": "🌊"},
    {"id": "forest", "name": "Лес", "price_stars": 30, "preview": "🌲"},
    {"id": "space", "name": "Космос", "price_ton": 0.5, "preview": "🚀"},
    {"id": "crystal", "name": "Кристалл", "price_ton": 1.5, "preview": "💠"},
]

# Бусты
BOOSTS = [
    {"id": "hints_1", "name": "+1 подсказка", "price_coins": 25, "preview": "💡"},
    {"id": "revive_1", "name": "+1 возрождение", "price_coins": 50, "preview": "❤️"},
    {"id": "life_1", "name": "+1 жизнь", "price_coins": 100, "preview": "❤️"},
    {"id": "energy_5", "name": "+5 энергии", "price_stars": 20, "preview": "⚡"},
    {"id": "energy_full", "name": "Полная энергия", "price_stars": 40, "preview": "⚡"},
    {"id": "vip_week", "name": "VIP неделя", "price_stars": 200, "preview": "👑"},
    {"id": "vip_month", "name": "VIP месяц", "price_stars": 500, "preview": "👑"},
    {"id": "vip_forever", "name": "VIP навсегда", "price_ton": 50.0, "preview": "💎"},
    {"id": "extra_life", "name": "+1 жизнь", "price_ton": 1.0, "preview": "💖", "max_purchases": 2},
]


def ton_payments_enabled() -> bool:
    """Whether TON purchases should be exposed to clients."""
    return (
        settings.TON_PAYMENTS_ENABLED
        and bool(settings.TON_WALLET_ADDRESS)
        and bool(settings.TON_API_KEY)
    )


def get_item_by_id(item_type: str, item_id: str) -> Optional[dict]:
    """Найти товар по типу и ID."""
    catalog = {
        "arrow_skins": ARROW_SKINS,
        "themes": THEMES,
        "boosts": BOOSTS,
    }
    items = catalog.get(item_type, [])
    for item in items:
        if item["id"] == item_id:
            return item
    return None


# ============================================
# ENDPOINTS
# ============================================

@router.get("/catalog", response_model=ShopCatalog)
async def get_catalog(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Получить каталог магазина с отметками о покупках."""
    # Получаем инвентарь пользователя
    result = await db.execute(
        select(Inventory).where(Inventory.user_id == user.id)
    )
    inventory = result.scalars().all()
    owned_items = {(inv.item_type, inv.item_id) for inv in inventory}
    
    # Добавляем базовые предметы
    owned_items.add(("arrow_skins", "default"))
    owned_items.add(("themes", "light"))
    
    def make_shop_item(item: dict, item_type: str) -> ShopItem:
        return ShopItem(
            id=item["id"],
            name=item["name"],
            price_coins=item.get("price_coins"),
            price_stars=item.get("price_stars"),
            price_ton=item.get("price_ton"),
            preview=item.get("preview"),
            owned=(item_type, item["id"]) in owned_items
        )
    
    # Build upgrades section (permanent upgrades for TON)
    upgrade_items = []
    if ton_payments_enabled():
        for b in BOOSTS:
            if b.get("max_purchases") is not None:
                max_p = b["max_purchases"]
                purchased = user.extra_lives if b["id"] == "extra_life" else 0
                upgrade_items.append(ShopItem(
                    id=b["id"],
                    name=b["name"],
                    price_ton=b.get("price_ton"),
                    preview=b.get("preview"),
                    owned=purchased >= max_p,
                    max_purchases=max_p,
                    purchased_count=purchased,
                ))

    return ShopCatalog(
        arrow_skins=[
            make_shop_item(s, "arrow_skins")
            for s in ARROW_SKINS
            if ton_payments_enabled() and s.get("price_ton") is not None
        ],
        themes=[
            make_shop_item(t, "themes")
            for t in THEMES
            if ton_payments_enabled() and t.get("price_ton") is not None
        ],
        boosts=[
            make_shop_item(b, "boosts")
            for b in BOOSTS
            if b["id"] in BETA_VISIBLE_BOOST_IDS
        ],
        upgrades=upgrade_items,
    )


@router.post("/purchase", response_model=PurchaseResponse)
async def purchase_item(
    request: PurchaseRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Купить товар за монеты."""
    # Находим товар
    item = get_item_by_id(request.item_type, request.item_id)
    if not item:
        return PurchaseResponse(success=False, error="Item not found")

    if request.item_type != "boosts" or request.item_id not in BETA_VISIBLE_BOOST_IDS:
        return PurchaseResponse(success=False, error="Item unavailable in beta shop")
    
    # Проверяем что это покупка за монеты
    price = item.get("price_coins")
    if price is None:
        return PurchaseResponse(success=False, error="Item not available for coins")
    
    if price == 0:
        return PurchaseResponse(success=False, error="Item is free")
    
    # Проверяем баланс
    quantity = request.quantity if request.item_type == "boosts" else 1
    total_price = price * quantity

    if user.coins < total_price:
        return PurchaseResponse(success=False, error="Not enough coins")
    
    # Проверяем что ещё не куплен (для не-бустов)
    if request.item_type != "boosts":
        result = await db.execute(
            select(Inventory).where(
                Inventory.user_id == user.id,
                Inventory.item_type == request.item_type,
                Inventory.item_id == request.item_id
            )
        )
        if result.scalar_one_or_none():
            return PurchaseResponse(success=False, error="Already owned")
    
    # Списываем монеты
    user.coins -= total_price
    
    # Добавляем в инвентарь или применяем буст
    if request.item_type == "boosts":
        # Применяем буст сразу
        await apply_boost(user, request.item_id, db, quantity=quantity)
    else:
        inv = Inventory(
            user_id=user.id,
            item_type=request.item_type,
            item_id=request.item_id
        )
        db.add(inv)
    
    # Записываем транзакцию
    tx = Transaction(
        user_id=user.id,
        type="purchase",
        currency="coins",
        amount=-total_price,
        item_type=request.item_type,
        item_id=request.item_id
    )
    db.add(tx)
    
    await db.commit()
    
    return PurchaseResponse(
        success=True,
        coins=user.coins,
        hint_balance=user.hint_balance,
        revive_balance=user.revive_balance,
    )


@router.post("/purchase/stars", response_model=PurchaseResponse)
async def purchase_with_stars(
    request: PurchaseRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Покупка за Telegram Stars.
    В реальности требует интеграцию с Telegram Payments.
    """
    item = get_item_by_id(request.item_type, request.item_id)
    if not item:
        return PurchaseResponse(success=False, error="Item not found")
    
    price = item.get("price_stars")
    if price is None:
        return PurchaseResponse(success=False, error="Item not available for Stars")
    
    # TODO: Реальная интеграция с Telegram Stars
    # Здесь должен быть вызов Telegram Bot API для создания invoice
    
    return PurchaseResponse(
        success=False, 
        error="Stars payment requires Telegram integration"
    )


@router.post("/purchase/ton", response_model=TonPaymentInfo)
async def purchase_with_ton(
    request: PurchaseRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Получить данные для оплаты TON.
    """
    if not ton_payments_enabled():
        raise HTTPException(status_code=403, detail="TON payments are currently disabled")

    item = get_item_by_id(request.item_type, request.item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    price = item.get("price_ton")
    if price is None:
        raise HTTPException(status_code=400, detail="Item not available for TON")

    # Permanent upgrade: check max purchases
    if request.item_type == "boosts" and request.item_id == "extra_life":
        if user.extra_lives >= 2:
            raise HTTPException(status_code=409, detail="Maximum extra lives already purchased")
        # Reuse existing pending transaction
        pending = await db.execute(
            select(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.item_type == "boosts",
                Transaction.item_id == "extra_life",
                Transaction.status == "pending",
            )
        )
        existing_tx = pending.scalar_one_or_none()
        if existing_tx:
            comment = f"arrow_{user.id}_{existing_tx.id}"
            return TonPaymentInfo(
                transaction_id=existing_tx.id,
                address=settings.TON_WALLET_ADDRESS,
                amount=price,
                amount_nano=str(int(price * 1_000_000_000)),
                comment=comment,
            )

    # Non-consumable: check if already owned
    if request.item_type != "boosts":
        existing = await db.execute(
            select(Inventory).where(
                Inventory.user_id == user.id,
                Inventory.item_type == request.item_type,
                Inventory.item_id == request.item_id,
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Item already owned")

        # Also check for existing pending tx to avoid duplicates
        pending = await db.execute(
            select(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.item_type == request.item_type,
                Transaction.item_id == request.item_id,
                Transaction.status == "pending",
            )
        )
        existing_tx = pending.scalar_one_or_none()
        if existing_tx:
            comment = f"arrow_{user.id}_{existing_tx.id}"
            return TonPaymentInfo(
                transaction_id=existing_tx.id,
                address=settings.TON_WALLET_ADDRESS,
                amount=price,
                amount_nano=str(int(price * 1_000_000_000)),
                comment=comment
            )

    # Создаём pending транзакцию
    tx = Transaction(
        user_id=user.id,
        type="purchase",
        currency="ton",
        amount=price,
        item_type=request.item_type,
        item_id=request.item_id,
        status="pending"
    )
    db.add(tx)
    await db.commit()
    await db.refresh(tx)
    
    # Формируем comment для идентификации платежа
    comment = f"arrow_{user.id}_{tx.id}"
    
    return TonPaymentInfo(
        transaction_id=tx.id,
        address=settings.TON_WALLET_ADDRESS,
        amount=price,
        amount_nano=str(int(price * 1_000_000_000)),
        comment=comment
    )


@router.get("/transaction/{tx_id}/status", response_model=TransactionStatusResponse)
async def get_transaction_status(
    tx_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Получить статус транзакции."""
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == tx_id,
            Transaction.user_id == user.id,
        )
    )
    tx = result.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    return TransactionStatusResponse(
        transaction_id=tx.id,
        status=tx.status,
    )


@router.post("/transaction/{tx_id}/confirm")
async def confirm_ton_transaction(
    tx_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Фронтенд вызывает после sendTransaction.
    Сканирует блокчейн на наличие транзакции с нужным comment+amount.
    Использует SELECT FOR UPDATE для защиты от параллельных запросов.
    """
    # Lock the row to prevent concurrent grant
    result = await db.execute(
        select(Transaction)
        .where(
            Transaction.id == tx_id,
            Transaction.user_id == user.id,
        )
        .with_for_update()
    )
    tx = result.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Already completed — idempotent response
    if tx.status == "completed":
        return {"transaction_id": tx.id, "status": "completed", "verified": True}

    if tx.status != "pending":
        raise HTTPException(status_code=409, detail=f"Transaction status is '{tx.status}'")

    comment = f"arrow_{user.id}_{tx.id}"
    amount_nano = int(float(tx.amount) * 1_000_000_000)

    # On-chain verification: scan recent txs by comment + amount
    match = await verify_ton_transaction(
        expected_address=settings.TON_WALLET_ADDRESS,
        expected_amount_nano=amount_nano,
        expected_comment=comment,
    )

    if not match:
        # Not yet on-chain — frontend should retry later
        return {"transaction_id": tx.id, "status": "pending", "verified": False}

    # Verified — grant item
    # Lock user row to prevent concurrent extra_lives grants
    user_result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    user = user_result.scalar_one()

    item = get_item_by_id(tx.item_type, tx.item_id)
    if item:
        if tx.item_type == "boosts":
            await apply_boost(user, tx.item_id, db)
        else:
            try:
                async with db.begin_nested():
                    db.add(Inventory(
                        user_id=user.id,
                        item_type=tx.item_type,
                        item_id=tx.item_id,
                    ))
                    await db.flush()
            except IntegrityError:
                # Already owns this item (UniqueConstraint) — OK
                pass

    tx.status = "completed"
    tx.ton_tx_hash = match["tx_hash"]
    await db.commit()

    resp = {"transaction_id": tx.id, "status": "completed", "verified": True}
    if tx.item_id == "extra_life":
        resp["extra_lives"] = user.extra_lives
    return resp


@router.post("/equip/{item_type}/{item_id}")
async def equip_item(
    item_type: str,
    item_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Экипировать скин или тему."""
    if item_type not in ["arrow_skins", "themes"]:
        raise HTTPException(status_code=400, detail="Invalid item type")
    
    # Проверяем владение (базовые бесплатны)
    is_default = (item_type == "arrow_skins" and item_id == "default") or \
                 (item_type == "themes" and item_id == "light")
    
    if not is_default:
        result = await db.execute(
            select(Inventory).where(
                Inventory.user_id == user.id,
                Inventory.item_type == item_type,
                Inventory.item_id == item_id
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Item not owned")
    
    # Применяем
    if item_type == "arrow_skins":
        user.active_arrow_skin = item_id
    else:
        user.active_theme = item_id
    
    await db.commit()
    
    return {"success": True}


# ============================================
# HELPERS
# ============================================

async def apply_boost(user: User, boost_id: str, db: AsyncSession, quantity: int = 1):
    """Применить буст к пользователю."""
    if boost_id == "hints_1":
        user.hint_balance += quantity
    elif boost_id == "revive_1":
        user.revive_balance += quantity
    elif boost_id == "life_1":
        pass  # lives client-side only
    elif boost_id == "extra_life":
        if user.extra_lives < 2:
            user.extra_lives += 1
        else:
            logger.warning("User %s: extra_lives already at max, TON accepted", user.id)
    elif boost_id == "energy_5":
        user.energy = min(user.energy + 5, settings.MAX_ENERGY + 5)
    elif boost_id == "energy_full":
        user.energy = settings.MAX_ENERGY
    elif boost_id.startswith("vip"):
        user.is_premium = True
        # TODO: Установить дату окончания VIP
