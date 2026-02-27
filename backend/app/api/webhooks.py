"""
Arrow Puzzle - Webhooks API

Обработка вебхуков: Telegram Payments, TON, Adsgram.
"""

import hashlib
import hmac
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..config import settings
from ..database import get_db, get_redis
from ..models import User, Inventory, Transaction
from ..schemas import TelegramPaymentWebhook, TonPaymentWebhook, AdsgramRewardWebhook
from ..api.shop import get_item_by_id, apply_boost


router = APIRouter(prefix="/webhooks", tags=["webhooks"])


# ============================================
# TELEGRAM PAYMENTS
# ============================================

@router.post("/telegram/payment")
async def handle_telegram_payment(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Вебхук для Telegram Stars платежей.
    Вызывается Telegram Bot API после успешной оплаты.
    """
    body = await request.json()
    
    # Проверяем pre_checkout_query или successful_payment
    if "pre_checkout_query" in body:
        # Подтверждаем возможность оплаты
        query = body["pre_checkout_query"]
        # TODO: Проверить инвентарь, доступность товара
        # await bot.answer_pre_checkout_query(query["id"], ok=True)
        return {"ok": True}
    
    if "message" in body and "successful_payment" in body["message"]:
        payment = body["message"]["successful_payment"]
        user_id = body["message"]["from"]["id"]
        
        # Парсим payload
        payload = payment["invoice_payload"]  # format: "item_type:item_id"
        item_type, item_id = payload.split(":")
        
        # Находим пользователя
        result = await db.execute(
            select(User).where(User.telegram_id == user_id)
        )
        user = result.scalar_one_or_none()
        
        if not user:
            return {"ok": False, "error": "User not found"}
        
        # Выдаём товар
        item = get_item_by_id(item_type, item_id)
        if item:
            if item_type == "boosts":
                await apply_boost(user, item_id, db)
            else:
                inv = Inventory(
                    user_id=user.id,
                    item_type=item_type,
                    item_id=item_id
                )
                db.add(inv)
            
            # Записываем транзакцию
            tx = Transaction(
                user_id=user.id,
                type="purchase",
                currency="stars",
                amount=payment["total_amount"],
                item_type=item_type,
                item_id=item_id,
                status="completed",
                external_id=payment.get("telegram_payment_charge_id")
            )
            db.add(tx)
            
            await db.commit()
        
        return {"ok": True}
    
    return {"ok": True}


# ============================================
# TON PAYMENTS
# ============================================

@router.post("/ton/payment")
async def handle_ton_payment(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Вебхук для TON платежей.
    Должен быть настроен через TON API или сервис типа TonConsole.
    """
    body = await request.json()
    
    # Формат зависит от TON provider
    # Пример структуры:
    tx_hash = body.get("tx_hash") or body.get("hash")
    comment = body.get("comment") or body.get("memo", "")
    amount = float(body.get("amount", 0))
    
    if not comment.startswith("arrow_"):
        return {"ok": False, "error": "Invalid comment format"}
    
    # Парсим comment: arrow_{user_id}_{tx_id}
    try:
        parts = comment.split("_")
        user_id = int(parts[1])
        pending_tx_id = int(parts[2])
    except (IndexError, ValueError):
        return {"ok": False, "error": "Invalid comment format"}
    
    # Находим pending транзакцию
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == pending_tx_id,
            Transaction.user_id == user_id,
            Transaction.status == "pending"
        )
    )
    tx = result.scalar_one_or_none()
    
    if not tx:
        return {"ok": False, "error": "Transaction not found"}
    
    # Проверяем сумму
    if amount < tx.amount:
        return {"ok": False, "error": "Insufficient amount"}
    
    # Получаем пользователя
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        return {"ok": False, "error": "User not found"}
    
    # Выдаём товар
    item = get_item_by_id(tx.item_type, tx.item_id)
    if item:
        if tx.item_type == "boosts":
            await apply_boost(user, tx.item_id, db)
        else:
            inv = Inventory(
                user_id=user.id,
                item_type=tx.item_type,
                item_id=tx.item_id
            )
            db.add(inv)
    
    # Обновляем транзакцию
    tx.status = "completed"
    tx.external_id = tx_hash
    
    await db.commit()
    
    return {"ok": True}


# ============================================
# ADSGRAM REWARDS
# ============================================

def verify_adsgram_signature(
    user_id: int,
    reward_type: str,
    signature: str
) -> bool:
    """Проверка подписи Adsgram."""
    # Формат зависит от Adsgram API
    data = f"{user_id}:{reward_type}"
    expected = hmac.new(
        settings.ADSGRAM_SECRET.encode(),
        data.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)


@router.post("/adsgram/reward")
async def handle_adsgram_reward(
    request: Request,
    x_adsgram_signature: str = Header(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Вебхук для наград за рекламу Adsgram.
    """
    body = await request.json()
    
    user_telegram_id = body.get("user_id")
    reward_type = body.get("reward_type")  # 'energy', 'coins', 'double_reward'
    
    if not user_telegram_id or not reward_type:
        return {"ok": False, "error": "Missing parameters"}
    
    # Проверяем подпись (опционально)
    # if x_adsgram_signature:
    #     if not verify_adsgram_signature(user_telegram_id, reward_type, x_adsgram_signature):
    #         return {"ok": False, "error": "Invalid signature"}
    
    # Находим пользователя
    result = await db.execute(
        select(User).where(User.telegram_id == user_telegram_id)
    )
    user = result.scalar_one_or_none()
    
    if not user:
        return {"ok": False, "error": "User not found"}
    
    # Выдаём награду
    reward_amount = 0
    
    if reward_type == "energy":
        user.energy = min(user.energy + 1, settings.MAX_ENERGY)
        reward_amount = 1
        
    elif reward_type == "coins":
        bonus = settings.AD_REWARD_COINS
        user.coins += bonus
        reward_amount = bonus
        
    elif reward_type == "double_reward":
        # Удвоение награды за уровень (клиент передаёт базовую награду)
        base_reward = body.get("base_reward", 0)
        user.coins += base_reward
        reward_amount = base_reward
        
    elif reward_type == "life":
        # Дополнительная жизнь (обрабатывается на клиенте)
        reward_amount = 1
    
    # Записываем транзакцию
    tx = Transaction(
        user_id=user.id,
        type="ad_reward",
        currency="coins" if reward_type == "coins" else reward_type,
        amount=reward_amount,
        status="completed",
        external_id=body.get("ad_id")
    )
    db.add(tx)
    
    await db.commit()
    
    return {
        "ok": True,
        "reward_type": reward_type,
        "reward_amount": reward_amount,
        "new_balance": {
            "coins": user.coins,
            "energy": user.energy
        }
    }


# ============================================
# TELEGRAM BOT UPDATES
# ============================================

@router.post("/telegram/bot")
async def handle_bot_update(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Вебхук для обновлений Telegram бота.
    
    При /start ref_{CODE}:
      - Создаёт пользователя если новый
      - НЕ привязывает реферал напрямую (это делает /referral/apply из Mini App)
      - Сохраняет ref_code в Redis как fallback (EC-16: если Mini App откроется без start_param)
    """
    body = await request.json()
    
    if "message" not in body:
        return {"ok": True}
    
    message = body["message"]
    
    if not message.get("text", "").startswith("/start"):
        return {"ok": True}
    
    text = message["text"]
    user_data = message["from"]
    telegram_id = user_data["id"]
    
    # Ищем или создаём пользователя
    result = await db.execute(
        select(User).where(User.telegram_id == telegram_id)
    )
    user = result.scalar_one_or_none()
    
    if not user:
        user = User(
            telegram_id=telegram_id,
            username=user_data.get("username"),
            first_name=user_data.get("first_name"),
            coins=settings.INITIAL_COINS,
            energy=settings.MAX_ENERGY,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    
    # Сохраняем реферальный код в Redis (fallback для EC-16)
    if " ref_" in text:
        ref_code = text.split("ref_")[1].strip()
        if ref_code:
            try:
                redis = await get_redis()
                await redis.set(
                    f"ref_pending:{telegram_id}",
                    ref_code.upper(),
                    ex=settings.REFERRAL_GRACE_PERIOD_HOURS * 3600,  # TTL = grace period
                )
                print(f"📌 [Webhook] Saved ref_code {ref_code} for telegram_id {telegram_id} in Redis")
            except Exception as e:
                # Redis недоступен — не критично, Mini App start_param сработает
                print(f"⚠️ [Webhook] Redis save failed: {e}")
    
    return {"ok": True}