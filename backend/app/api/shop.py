"""
Arrow Puzzle - Shop API

Магазин: скины, темы, бусты, покупки.
"""

import json
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import aiohttp
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)

from ..config import settings
from ..database import get_db, get_redis
from ..models import User, Inventory, Transaction, StarsWithdrawal
from ..schemas import (
    ShopItem, ShopCatalog, PurchaseRequest, PurchaseResponse,
    TonPaymentInfo, TransactionStatusResponse,
    CaseInfo, CaseOpenResult, CaseStarsBalance,
    WithdrawStarsRequest, WithdrawalResponse, WithdrawalListResponse,
)
from ..services.ton_verify import verify_ton_transaction
from ..services.case_logic import (
    CASE_PRICE_STARS,
    CASE_PRICE_TON,
    PITY_THRESHOLD,
    determine_rarity,
    determine_ad_case_rarity,
    get_case_result_for_transaction,
    get_recent_case_result,
    grant_case_rewards,
    grant_ad_case_rewards,
)
from ..services.ad_rewards import (
    INTENT_STATUS_GRANTED,
    PLACEMENT_AD_CASE,
    get_intent_by_public_id,
    grant_intent,
)
from .error_utils import api_error
from .auth import get_current_user


router = APIRouter(prefix="/shop", tags=["shop"])


class OpenAdCaseRequest(BaseModel):
    intent_id: str


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
TON_VISIBLE_UPGRADE_IDS = {"extra_life"}
BULK_DISCOUNT_TIERS = (
    {"min_quantity": 3, "percent": 5},
    {"min_quantity": 5, "percent": 10},
)

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
    {
        "id": "hints_1",
        "name": "+1 подсказка",
        "price_coins": 100,
        "discount_tiers": BULK_DISCOUNT_TIERS,
        "preview": "💡",
    },
    {
        "id": "revive_1",
        "name": "+1 возрождение",
        "price_coins": 500,
        "discount_tiers": BULK_DISCOUNT_TIERS,
        "preview": "❤️",
    },
    {"id": "life_1", "name": "+1 жизнь", "price_coins": 100, "preview": "❤️"},
    {"id": "energy_5", "name": "+5 энергии", "price_stars": 20, "preview": "⚡"},
    {"id": "energy_full", "name": "Полная энергия", "price_stars": 40, "preview": "⚡"},
    {"id": "vip_week", "name": "VIP неделя", "price_stars": 200, "preview": "👑"},
    {"id": "vip_month", "name": "VIP месяц", "price_stars": 500, "preview": "👑"},
    {"id": "vip_forever", "name": "VIP навсегда", "price_ton": 50.0, "preview": "💎"},
    {"id": "extra_life", "name": "+1 жизнь", "price_ton": 1.0, "preview": "💖", "max_purchases": 2},
]


WELCOME_BUNDLE = {
    "hints": 20,
    "revives": 10,
    "price_full": 50,
    "price_discounted": 15,
    "discount_hours": 24,
}

EXTRA_BUNDLES = [
    {
        "id": "standard",
        "hints": 50,
        "revives": 25,
        "price_stars": 150,
        "extra_lives": 0,
    },
    {
        "id": "advanced",
        "hints": 150,
        "revives": 100,
        "price_stars": 500,
        "extra_lives": 0,
    },
    {
        "id": "ultra",
        "hints": 300,
        "revives": 150,
        "price_stars": 1000,
        "extra_lives": 2,
    },
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


def get_discount_percent(item: dict, quantity: int) -> int:
    tiers = item.get("discount_tiers") or []
    discount_percent = 0

    for tier in tiers:
        min_quantity = int(tier.get("min_quantity", 0))
        percent = int(tier.get("percent", 0))
        if quantity >= min_quantity and percent > discount_percent:
            discount_percent = percent

    return discount_percent


def calculate_coin_total_price(item: dict, quantity: int) -> int:
    unit_price = item.get("price_coins")
    if unit_price is None:
        raise ValueError("Item does not have a coin price")

    subtotal = int(unit_price) * quantity
    discount_percent = get_discount_percent(item, quantity)
    if discount_percent <= 0:
        return subtotal

    # Keep prices integer-only and match the frontend rounding behavior.
    return subtotal * (100 - discount_percent) // 100


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
            discount_tiers=list(item.get("discount_tiers") or []),
            preview=item.get("preview"),
            owned=(item_type, item["id"]) in owned_items
        )
    
    # Build upgrades section (currently only extra_life is exposed for TON)
    upgrade_items = []
    if ton_payments_enabled():
        for b in BOOSTS:
            if b["id"] in TON_VISIBLE_UPGRADE_IDS and b.get("max_purchases") is not None:
                max_p = b["max_purchases"]
                purchased = user.ton_extra_lives if b["id"] == "extra_life" else 0
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
        # Premium skins/themes are temporarily hidden from catalog.
        arrow_skins=[],
        themes=[],
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
        return PurchaseResponse(success=False, error="ITEM_NOT_FOUND")

    if request.item_type != "boosts" or request.item_id not in BETA_VISIBLE_BOOST_IDS:
        return PurchaseResponse(success=False, error="ITEM_UNAVAILABLE")
    
    # Проверяем что это покупка за монеты
    price = item.get("price_coins")
    if price is None:
        return PurchaseResponse(success=False, error="ITEM_NOT_AVAILABLE_FOR_COINS")
    
    if price == 0:
        return PurchaseResponse(success=False, error="ITEM_IS_FREE")
    
    # Проверяем баланс
    quantity = request.quantity if request.item_type == "boosts" else 1
    total_price = calculate_coin_total_price(item, quantity)

    if user.coins < total_price:
        return PurchaseResponse(success=False, error="NOT_ENOUGH_COINS")
    
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
            return PurchaseResponse(success=False, error="ALREADY_OWNED")
    
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
        return PurchaseResponse(success=False, error="ITEM_NOT_FOUND")
    
    price = item.get("price_stars")
    if price is None:
        return PurchaseResponse(success=False, error="ITEM_NOT_AVAILABLE_FOR_STARS")
    
    # TODO: Реальная интеграция с Telegram Stars
    # Здесь должен быть вызов Telegram Bot API для создания invoice
    
    return PurchaseResponse(
        success=False, 
        error="STARS_INTEGRATION_REQUIRED"
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
        raise api_error(403, "TON_PAYMENTS_DISABLED", "TON payments are currently disabled")

    item = get_item_by_id(request.item_type, request.item_id)
    if not item:
        raise api_error(404, "ITEM_NOT_FOUND", "Item not found")

    price = item.get("price_ton")
    if price is None:
        raise api_error(400, "ITEM_NOT_AVAILABLE_FOR_TON", "Item not available for TON")

    if request.item_type != "boosts" or request.item_id not in TON_VISIBLE_UPGRADE_IDS:
        raise api_error(403, "TON_ITEM_NOT_ALLOWED", "Only extra_life is available for TON purchases")

    if user.ton_extra_lives >= 2:
        raise api_error(409, "EXTRA_LIVES_LIMIT_REACHED", "Maximum extra lives already purchased via TON")

    # Reuse existing pending transaction (take most recent to avoid MultipleResultsFound)
    pending = await db.execute(
        select(Transaction)
        .where(
            Transaction.user_id == user.id,
            Transaction.item_type == "boosts",
            Transaction.item_id == "extra_life",
            Transaction.status == "pending",
        )
        .order_by(Transaction.created_at.desc())
        .limit(1)
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
        raise api_error(404, "TRANSACTION_NOT_FOUND", "Transaction not found")

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
        raise api_error(404, "TRANSACTION_NOT_FOUND", "Transaction not found")

    # Already completed — idempotent response
    if tx.status == "completed":
        return {"transaction_id": tx.id, "status": "completed", "verified": True}

    if tx.status != "pending":
        raise api_error(409, "TRANSACTION_NOT_PENDING", "Transaction is not pending", params={"status": tx.status})

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


# ============================================
# CASE ENDPOINTS
# ============================================

@router.get("/cases/info", response_model=CaseInfo)
async def get_case_info(
    user: User = Depends(get_current_user),
):
    """Информация о кейсе и текущий счётчик пити."""
    return CaseInfo(
        id="standard",
        name="Стандартный Кейс",
        price_stars=CASE_PRICE_STARS,
        price_ton=CASE_PRICE_TON,
        pity_counter=user.case_pity_counter,
        pity_threshold=PITY_THRESHOLD,
    )


@router.post("/cases/invoice/stars")
async def create_case_stars_invoice(
    user: User = Depends(get_current_user),
):
    """Создать ссылку на Telegram Stars invoice для покупки кейса."""
    import httpx

    bot_token = settings.BOT_TOKEN or settings.TELEGRAM_BOT_TOKEN
    if not bot_token:
        raise api_error(503, "BOT_NOT_CONFIGURED", "Bot token is not configured")

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{bot_token}/createInvoiceLink",
            json={
                "title": "Стандартный Кейс",
                "description": "Открой кейс и получи случайную награду",
                "payload": "case:standard",
                "currency": "XTR",
                "prices": [{"label": "Стандартный Кейс", "amount": CASE_PRICE_STARS}],
            },
        )

    data = resp.json()
    if not data.get("ok"):
        raise api_error(502, "INVOICE_CREATION_FAILED", str(data.get("description", "Unknown error")))

    return {"invoice_url": data["result"]}


@router.post("/cases/open/dev")
async def open_case_dev(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """DEV ONLY — открыть кейс без оплаты. Не работает в продакшне."""
    if settings.ENVIRONMENT != "development":
        raise api_error(403, "DEV_ONLY", "This endpoint is only available in development")

    user_result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    user = user_result.scalar_one()

    rarity = determine_rarity(user.case_pity_counter)
    case_result = await grant_case_rewards(user, rarity, "dev", db)
    await db.commit()

    return {"status": "completed", "case_result": case_result}


@router.post("/cases/open/dev-ad")
async def open_ad_case_dev(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """DEV ONLY — открыть рекламный кейс без просмотра рекламы."""
    if settings.ENVIRONMENT != "development":
        raise api_error(403, "DEV_ONLY", "This endpoint is only available in development")

    user_result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    user = user_result.scalar_one()

    rarity = determine_ad_case_rarity()
    case_result = await grant_ad_case_rewards(user, rarity, db)
    await db.commit()

    return {"status": "completed", "case_result": case_result}


@router.post("/cases/open/ad")
async def open_ad_case(
    request: OpenAdCaseRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Open the ad case immediately after the client-side rewarded ad completes.
    This mirrors the optimistic reward-ad flows: the intent is used for
    idempotency, while the UI does not wait on /cases/result polling.
    """
    intent = await get_intent_by_public_id(db, user.id, request.intent_id)
    if intent is None:
        raise api_error(404, "AD_CASE_INTENT_NOT_FOUND", "Ad case intent not found")
    if intent.placement != PLACEMENT_AD_CASE:
        raise api_error(400, "INVALID_AD_CASE_INTENT", "Intent is not for ad case")

    intent = await grant_intent(db, user, intent)
    if intent.status != INTENT_STATUS_GRANTED:
        raise api_error(
            409,
            intent.failure_code or "AD_CASE_INTENT_NOT_GRANTED",
            "Ad case intent could not be granted",
        )

    case_result = await get_recent_case_result(
        user=user,
        payment_currency="ad",
        db=db,
    )
    if case_result is None:
        raise api_error(404, "AD_CASE_RESULT_NOT_FOUND", "Ad case result not found")

    return {"status": "completed", "case_result": case_result}


@router.post("/cases/open/ton", response_model=TonPaymentInfo)
async def open_case_ton(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Инициировать TON-платёж для открытия кейса."""
    if not ton_payments_enabled():
        raise api_error(403, "TON_PAYMENTS_DISABLED", "TON payments are currently disabled")

    # Reuse existing pending case transaction
    pending = await db.execute(
        select(Transaction)
        .where(
            Transaction.user_id == user.id,
            Transaction.item_type == "cases",
            Transaction.item_id == "standard",
            Transaction.status == "pending",
        )
        .order_by(Transaction.created_at.desc())
        .limit(1)
    )
    existing_tx = pending.scalar_one_or_none()
    if existing_tx:
        comment = f"arrow_{user.id}_{existing_tx.id}"
        return TonPaymentInfo(
            transaction_id=existing_tx.id,
            address=settings.TON_WALLET_ADDRESS,
            amount=CASE_PRICE_TON,
            amount_nano=str(int(CASE_PRICE_TON * 1_000_000_000)),
            comment=comment,
        )

    tx = Transaction(
        user_id=user.id,
        type="purchase",
        currency="ton",
        amount=CASE_PRICE_TON,
        item_type="cases",
        item_id="standard",
        status="pending",
    )
    db.add(tx)
    await db.commit()
    await db.refresh(tx)

    comment = f"arrow_{user.id}_{tx.id}"
    return TonPaymentInfo(
        transaction_id=tx.id,
        address=settings.TON_WALLET_ADDRESS,
        amount=CASE_PRICE_TON,
        amount_nano=str(int(CASE_PRICE_TON * 1_000_000_000)),
        comment=comment,
    )


@router.post("/cases/ton/{tx_id}/confirm")
async def confirm_case_ton(
    tx_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Проверить TON-транзакцию и открыть кейс при успехе."""
    # Read without lock first — avoid holding row lock during external HTTP call
    result = await db.execute(
        select(Transaction)
        .where(Transaction.id == tx_id, Transaction.user_id == user.id)
    )
    tx = result.scalar_one_or_none()
    if not tx:
        raise api_error(404, "TRANSACTION_NOT_FOUND", "Transaction not found")

    # Idempotent: already completed
    if tx.status == "completed":
        case_result = await get_case_result_for_transaction(tx.id, user=user, db=db)
        return {"transaction_id": tx.id, "status": "completed", "verified": True, "case_result": case_result}

    if tx.status != "pending":
        raise api_error(409, "TRANSACTION_NOT_PENDING", "Transaction is not pending")

    comment = f"arrow_{user.id}_{tx.id}"
    amount_nano = int(float(tx.amount) * 1_000_000_000)

    match = await verify_ton_transaction(
        expected_address=settings.TON_WALLET_ADDRESS,
        expected_amount_nano=amount_nano,
        expected_comment=comment,
    )

    if not match:
        return {"transaction_id": tx.id, "status": "pending", "verified": False}

    # Re-acquire TX with lock after external call and re-check status
    result = await db.execute(
        select(Transaction)
        .where(Transaction.id == tx_id, Transaction.user_id == user.id)
        .with_for_update()
    )
    tx = result.scalar_one_or_none()
    if not tx or tx.status == "completed":
        case_result = await get_case_result_for_transaction(tx_id, user=user, db=db)
        return {"transaction_id": tx_id, "status": "completed", "verified": True, "case_result": case_result}
    if tx.status != "pending":
        raise api_error(409, "TRANSACTION_NOT_PENDING", "Transaction is not pending")

    # Lock user row and grant rewards
    user_result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    user = user_result.scalar_one()

    rarity = determine_rarity(user.case_pity_counter)
    case_result = await grant_case_rewards(user, rarity, "ton", db, transaction_id=tx.id)

    tx.status = "completed"
    tx.ton_tx_hash = match["tx_hash"]
    await db.commit()

    return {
        "transaction_id": tx.id,
        "status": "completed",
        "verified": True,
        "case_result": case_result,
    }


@router.get("/cases/result")
async def poll_case_result(
    payment_currency: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Poll the latest case opening result.
    Redis is the primary handoff; DB fallback is scoped by payment_currency.
    """
    lookup_currency = payment_currency or "stars"
    if lookup_currency not in {"stars", "ad"}:
        raise api_error(400, "INVALID_CASE_PAYMENT_CURRENCY", "Unsupported case payment currency")

    redis = await get_redis()
    if redis is not None:
        raw = await redis.get(f"case_result:{user.id}")
        if raw:
            result = json.loads(raw)
            if result.get("payment_currency", lookup_currency) == lookup_currency:
                await redis.delete(f"case_result:{user.id}")
                # Remember the opening_id so DB fallback won't re-serve it
                opening_id = result.get("opening_id")
                if opening_id is not None:
                    await redis.setex(
                        f"case_consumed:{user.id}", 900, str(opening_id),
                    )
                return {"status": "ready", "case_result": result}

    fallback_result = await get_recent_case_result(
        user=user, payment_currency=lookup_currency, db=db,
    )
    if fallback_result is None:
        return {"status": "pending"}

    # Guard against returning a previously consumed result
    if redis is not None:
        consumed_raw = await redis.get(f"case_consumed:{user.id}")
        if consumed_raw and str(fallback_result.get("opening_id")) == consumed_raw.decode():
            return {"status": "pending"}

    return {"status": "ready", "case_result": fallback_result}


@router.get("/stars/balance", response_model=CaseStarsBalance)
async def get_stars_balance(
    user: User = Depends(get_current_user),
):
    """Баланс накопленных Stars пользователя."""
    return CaseStarsBalance(stars_balance=user.stars_balance)


@router.post("/stars/withdraw", response_model=WithdrawalResponse)
async def withdraw_stars(
    body: WithdrawStarsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Создать заявку на вывод Stars."""
    if body.amount < settings.STARS_WITHDRAWAL_MIN:
        raise api_error(
            422, "WITHDRAWAL_TOO_SMALL",
            f"Минимальная сумма вывода — {settings.STARS_WITHDRAWAL_MIN} Stars",
        )
    locked_user = (
        await db.execute(
            select(User)
            .where(User.id == user.id)
            .with_for_update()
        )
    ).scalar_one()
    if locked_user.stars_balance < body.amount:
        raise api_error(409, "INSUFFICIENT_STARS", "Недостаточно Stars для вывода")

    locked_user.stars_balance -= body.amount

    withdrawal = StarsWithdrawal(
        user_id=locked_user.id,
        telegram_id=locked_user.telegram_id,
        username=locked_user.username,
        amount=body.amount,
        status="pending",
    )
    db.add(withdrawal)
    await db.flush()


    # Уведомление администратору через бота (не блокирует ответ)
    try:
        await _notify_admin_withdrawal(withdrawal, locked_user)
    except Exception as exc:
        logger.exception("Failed to notify admin about withdrawal %s", withdrawal.id)
        await db.rollback()
        raise api_error(
            503,
            "WITHDRAWALS_UNAVAILABLE",
            "Вывод Stars временно недоступен. Попробуйте позже.",
        ) from exc

    await db.commit()
    await db.refresh(withdrawal)

    return WithdrawalResponse(
        id=withdrawal.id,
        amount=withdrawal.amount,
        status=withdrawal.status,
        created_at=withdrawal.created_at,
    )


async def _notify_admin_withdrawal(withdrawal: StarsWithdrawal, user: User) -> None:
    """Отправить уведомление о заявке на вывод администратору через бота."""
    chat_id = settings.ADMIN_ALERT_CHAT_ID
    if not chat_id:
        raise RuntimeError("ADMIN_ALERT_CHAT_ID is not configured")
    if not settings.TELEGRAM_BOT_TOKEN:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")

    username_part = f"@{user.username}" if user.username else f"tg_id: {user.telegram_id}"
    text = (
        f"⭐ <b>Заявка на вывод Stars</b> #{withdrawal.id}\n"
        f"Пользователь: {username_part}\n"
        f"Сумма: <b>{withdrawal.amount} Stars</b>\n\n"
        f"Переведи с Support-аккаунта и подтверди:"
    )
    keyboard = {
        "inline_keyboard": [[
            {"text": "✅ Отправлено", "callback_data": f"withdrawal_confirm:{withdrawal.id}"},
            {"text": "❌ Отклонить", "callback_data": f"withdrawal_reject:{withdrawal.id}"},
        ]]
    }

    url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "reply_markup": keyboard,
    }
    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload) as response:
            response.raise_for_status()
            data = await response.json()
    if not data.get("ok"):
        raise RuntimeError(f"Telegram sendMessage failed: {data!r}")


@router.get("/stars/withdrawals", response_model=WithdrawalListResponse)
async def get_withdrawals(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """История заявок на вывод Stars пользователя."""
    result = await db.execute(
        select(StarsWithdrawal)
        .where(StarsWithdrawal.user_id == user.id)
        .order_by(StarsWithdrawal.created_at.desc())
        .limit(20)
    )
    withdrawals = result.scalars().all()
    return WithdrawalListResponse(
        withdrawals=[
            WithdrawalResponse(
                id=w.id,
                amount=w.amount,
                status=w.status,
                created_at=w.created_at,
            )
            for w in withdrawals
        ]
    )


def _discount_until(created_at: datetime | None) -> datetime | None:
    """Return the naive UTC deadline for the welcome offer discount, or None."""
    if not created_at:
        return None
    ts = created_at.replace(tzinfo=None) if created_at.tzinfo else created_at
    return ts + timedelta(hours=WELCOME_BUNDLE["discount_hours"])


@router.get("/welcome-offer")
async def get_welcome_offer(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return welcome offer state. Stamps welcome_offer_opened_at on first call (analytics)."""
    if user.welcome_offer_purchased:
        return {
            "eligible": False,
            "discounted": False,
            "price_stars": WELCOME_BUNDLE["price_full"],
            "expires_at": None,
            "hints": WELCOME_BUNDLE["hints"],
            "revives": WELCOME_BUNDLE["revives"],
        }

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # Stamp first shop visit for analytics (not used for discount logic)
    if not user.welcome_offer_opened_at:
        result = await db.execute(select(User).where(User.id == user.id).with_for_update())
        locked = result.scalar_one()
        if not locked.welcome_offer_opened_at:
            locked.welcome_offer_opened_at = now
            await db.commit()

    # Discount = 24h from account creation → new users only
    # In development: always discounted so the offer can be tested without a fresh account
    if settings.ENVIRONMENT == "development":
        discounted = True
        deadline = now + timedelta(hours=WELCOME_BUNDLE["discount_hours"])
    else:
        deadline = _discount_until(user.created_at)
        discounted = deadline is not None and now < deadline

    return {
        "eligible": True,
        "discounted": discounted,
        "price_stars": WELCOME_BUNDLE["price_discounted"] if discounted else WELCOME_BUNDLE["price_full"],
        "expires_at": deadline.isoformat() + "Z" if discounted and deadline else None,
        "hints": WELCOME_BUNDLE["hints"],
        "revives": WELCOME_BUNDLE["revives"],
    }


@router.post("/welcome-offer/purchase")
async def purchase_welcome_offer(
    user: User = Depends(get_current_user),
):
    """Create a Telegram Stars invoice for the welcome bundle."""
    if user.welcome_offer_purchased:
        raise api_error(409, "ALREADY_PURCHASED", "Welcome offer already purchased")

    # Dedup: return the same pending invoice if one was recently created (30 min TTL).
    # Prevents users from generating multiple valid invoice links before paying.
    redis_client = await get_redis()
    pending_key = f"welcome_offer_pending_v2:{user.id}"

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if settings.ENVIRONMENT == "development":
        discounted = True
    else:
        deadline = _discount_until(user.created_at)
        discounted = deadline is not None and now < deadline

    price_stars = WELCOME_BUNDLE["price_discounted"] if discounted else WELCOME_BUNDLE["price_full"]

    if redis_client:
        cached = await redis_client.get(pending_key)
        if cached:
            cached_data = json.loads(cached)
            if cached_data["price_stars"] == price_stars:
                return {"invoice_url": cached_data["invoice_url"], "price_stars": cached_data["price_stars"]}
            # Cached invoice has wrong price (discount expired) — drop it and issue a new one
            await redis_client.delete(pending_key)

    bot_token = settings.BOT_TOKEN or settings.TELEGRAM_BOT_TOKEN
    if not bot_token:
        raise api_error(503, "BOT_NOT_CONFIGURED", "Bot token is not configured")

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{bot_token}/createInvoiceLink",
            json={
                "title": "Welcome Bundle",
                "description": f"+{WELCOME_BUNDLE['revives']} revives + {WELCOME_BUNDLE['hints']} hints",
                "payload": f"welcome_bundle:{user.id}:{user.telegram_id}:{price_stars}",
                "currency": "XTR",
                "prices": [{"label": "Welcome Bundle", "amount": price_stars}],
            },
        )

    data = resp.json()
    if not data.get("ok"):
        raise api_error(502, "INVOICE_CREATION_FAILED", str(data.get("description", "Unknown error")))

    invoice_url = data["result"]
    if redis_client:
        await redis_client.setex(pending_key, 1800, json.dumps({"invoice_url": invoice_url, "price_stars": price_stars}))

    return {"invoice_url": invoice_url, "price_stars": price_stars}


def _ensure_dev() -> None:
    if settings.ENVIRONMENT != "development":
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Dev endpoints are disabled")


@router.post("/dev/reset-welcome-offer")
async def dev_reset_welcome_offer(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """DEV only. Reset welcome offer and force discount for 30 min."""
    _ensure_dev()
    result = await db.execute(select(User).where(User.id == user.id).with_for_update())
    locked = result.scalar_one()
    locked.welcome_offer_opened_at = None
    locked.welcome_offer_purchased = False
    await db.commit()
    redis_client = await get_redis()
    if redis_client:
        await redis_client.delete(f"welcome_offer_pending:{user.id}")
        await redis_client.delete(f"welcome_offer_pending_v2:{user.id}")
    return {"success": True}


@router.post("/bundles/{bundle_id}/purchase")
async def purchase_bundle(
    bundle_id: str,
    user: User = Depends(get_current_user),
):
    """Create a Telegram Stars invoice for a standard or advanced bundle."""
    bundle = next((b for b in EXTRA_BUNDLES if b["id"] == bundle_id), None)
    if not bundle:
        raise api_error(404, "BUNDLE_NOT_FOUND", f"Bundle '{bundle_id}' not found")

    bot_token = settings.BOT_TOKEN or settings.TELEGRAM_BOT_TOKEN
    if not bot_token:
        raise api_error(503, "BOT_NOT_CONFIGURED", "Bot token is not configured")

    price_stars = bundle["price_stars"]
    title = bundle_id.title() + " Bundle"
    description = f"+{bundle['revives']} revives + {bundle['hints']} hints"
    if bundle.get("extra_lives"):
        description += f" + {bundle['extra_lives']} extra lives"

    redis_client = await get_redis()
    pending_key = f"bundle_pending_v1:{user.id}:{bundle_id}"
    if redis_client:
        cached = await redis_client.get(pending_key)
        if cached:
            try:
                cached_data = json.loads(cached)
                if cached_data.get("price_stars") == price_stars:
                    return {"invoice_url": cached_data["invoice_url"], "price_stars": cached_data["price_stars"]}
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                pass
            await redis_client.delete(pending_key)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{bot_token}/createInvoiceLink",
                json={
                    "title": title,
                    "description": description,
                    "payload": f"bundle:{bundle_id}:{user.id}:{user.telegram_id}:{price_stars}",
                    "currency": "XTR",
                    "prices": [{"label": title, "amount": price_stars}],
                },
            )
        data = resp.json()
    except (httpx.HTTPError, ValueError):
        logger.exception("purchase_bundle: failed to create invoice for user=%s bundle=%s", user.id, bundle_id)
        raise api_error(502, "INVOICE_CREATION_FAILED", "Could not create invoice")

    if not data.get("ok"):
        logger.error(
            "purchase_bundle: Telegram createInvoiceLink failed user=%s bundle=%s error_code=%s description=%s",
            user.id,
            bundle_id,
            data.get("error_code"),
            data.get("description"),
        )
        raise api_error(502, "INVOICE_CREATION_FAILED", str(data.get("description", "Unknown error")))

    invoice_url = data.get("result")
    if not invoice_url:
        logger.error("purchase_bundle: Telegram response missing invoice result: %r", data)
        raise api_error(502, "INVOICE_CREATION_FAILED", "Could not create invoice")

    if redis_client:
        await redis_client.setex(pending_key, 1800, json.dumps({"invoice_url": invoice_url, "price_stars": price_stars}))

    return {"invoice_url": invoice_url, "price_stars": price_stars}


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
        if user.ton_extra_lives < 2:
            user.extra_lives += 1
            user.ton_extra_lives += 1
        else:
            logger.warning("User %s: ton_extra_lives already at max, TON accepted", user.id)
    elif boost_id == "energy_5":
        user.energy = min(user.energy + 5, settings.MAX_ENERGY + 5)
    elif boost_id == "energy_full":
        user.energy = settings.MAX_ENERGY
    elif boost_id.startswith("vip"):
        user.is_premium = True
        # TODO: Установить дату окончания VIP
