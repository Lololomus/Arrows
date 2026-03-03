"""
Arrow Puzzle - Shop API

Магазин: скины, темы, бусты, покупки.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..config import settings
from ..database import get_db
from ..models import User, Inventory, Transaction
from ..schemas import (
    ShopItem, ShopCatalog, PurchaseRequest, PurchaseResponse,
    TonPaymentInfo
)
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

BETA_VISIBLE_BOOST_IDS = {"hints_3", "hints_10", "revive_1", "revive_3"}

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
    {"id": "hints_3", "name": "+3 подсказки", "price_coins": 50, "preview": "💡"},
    {"id": "hints_10", "name": "+10 подсказок", "price_coins": 150, "preview": "💡"},
    {"id": "revive_1", "name": "+1 воскрешение", "price_coins": 100, "preview": "💚"},
    {"id": "revive_3", "name": "+3 воскрешения", "price_coins": 250, "preview": "💚"},
    {"id": "life_1", "name": "+1 жизнь", "price_coins": 100, "preview": "❤️"},
    {"id": "energy_5", "name": "+5 энергии", "price_stars": 20, "preview": "⚡"},
    {"id": "energy_full", "name": "Полная энергия", "price_stars": 40, "preview": "⚡"},
    {"id": "vip_week", "name": "VIP неделя", "price_stars": 200, "preview": "👑"},
    {"id": "vip_month", "name": "VIP месяц", "price_stars": 500, "preview": "👑"},
    {"id": "vip_forever", "name": "VIP навсегда", "price_ton": 50.0, "preview": "💎"},
]


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
    
    return ShopCatalog(
        arrow_skins=[],
        themes=[],
        boosts=[
            make_shop_item(b, "boosts")
            for b in BOOSTS
            if b["id"] in BETA_VISIBLE_BOOST_IDS
        ]
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
    if user.coins < price:
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
    user.coins -= price
    
    # Добавляем в инвентарь или применяем буст
    if request.item_type == "boosts":
        # Применяем буст сразу
        await apply_boost(user, request.item_id, db)
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
        amount=-price,
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
    item = get_item_by_id(request.item_type, request.item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    price = item.get("price_ton")
    if price is None:
        raise HTTPException(status_code=400, detail="Item not available for TON")
    
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
        comment=comment
    )


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

async def apply_boost(user: User, boost_id: str, db: AsyncSession):
    """Применить буст к пользователю."""
    if boost_id == "hints_3":
        user.hint_balance += 3
    elif boost_id == "hints_10":
        user.hint_balance += 10
    elif boost_id == "revive_1":
        user.revive_balance += 1
    elif boost_id == "revive_3":
        user.revive_balance += 3
    elif boost_id == "life_1":
        pass  # lives client-side only
    elif boost_id == "energy_5":
        user.energy = min(user.energy + 5, settings.MAX_ENERGY + 5)
    elif boost_id == "energy_full":
        user.energy = settings.MAX_ENERGY
    elif boost_id.startswith("vip"):
        user.is_premium = True
        # TODO: Установить дату окончания VIP
