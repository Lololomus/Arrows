"""
Arrow Puzzle - Webhooks API

Telegram Payments, TON, AdsGram and Telegram bot updates.
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.shop import apply_boost, get_item_by_id
from ..config import settings
from ..database import get_db
from ..middleware.security import validate_adsgram_signature
from ..models import Inventory, Transaction, User
from ..services.ad_rewards import (
    FAILURE_INVALID_SIGNATURE,
    PLACEMENT_DAILY_COINS,
    PLACEMENT_HINT,
    PLACEMENT_REVIVE,
    extract_callback_value,
    find_pending_intent_for_callback,
    grant_intent,
    serialize_intent,
)
from ..services.referrals import extract_referral_code_from_start_text, store_pending_referral_code


router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/telegram/payment")
async def handle_telegram_payment(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Webhook for Telegram Stars payments."""
    body = await request.json()

    if "pre_checkout_query" in body:
        return {"ok": True}

    if "message" in body and "successful_payment" in body["message"]:
        payment = body["message"]["successful_payment"]
        user_id = body["message"]["from"]["id"]
        item_type, item_id = payment["invoice_payload"].split(":")

        result = await db.execute(select(User).where(User.telegram_id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            return {"ok": False, "error": "User not found"}

        item = get_item_by_id(item_type, item_id)
        if item:
            if item_type == "boosts":
                await apply_boost(user, item_id, db)
            else:
                db.add(Inventory(user_id=user.id, item_type=item_type, item_id=item_id))

            db.add(
                Transaction(
                    user_id=user.id,
                    type="purchase",
                    currency="stars",
                    amount=payment["total_amount"],
                    item_type=item_type,
                    item_id=item_id,
                    status="completed",
                    external_id=payment.get("telegram_payment_charge_id"),
                )
            )
            await db.commit()

        return {"ok": True}

    return {"ok": True}


@router.post("/ton/payment")
async def handle_ton_payment(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Webhook for TON payments."""
    body = await request.json()
    tx_hash = body.get("tx_hash") or body.get("hash")
    comment = body.get("comment") or body.get("memo", "")
    amount = float(body.get("amount", 0))

    if not comment.startswith("arrow_"):
        return {"ok": False, "error": "Invalid comment format"}

    try:
        _, user_id_raw, pending_tx_id_raw = comment.split("_")
        user_id = int(user_id_raw)
        pending_tx_id = int(pending_tx_id_raw)
    except (ValueError, IndexError):
        return {"ok": False, "error": "Invalid comment format"}

    result = await db.execute(
        select(Transaction).where(
            Transaction.id == pending_tx_id,
            Transaction.user_id == user_id,
            Transaction.status == "pending",
        )
    )
    tx = result.scalar_one_or_none()
    if not tx:
        return {"ok": False, "error": "Transaction not found"}
    if amount < tx.amount:
        return {"ok": False, "error": "Insufficient amount"}

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return {"ok": False, "error": "User not found"}

    item = get_item_by_id(tx.item_type, tx.item_id)
    if item:
        if tx.item_type == "boosts":
            await apply_boost(user, tx.item_id, db)
        else:
            db.add(Inventory(user_id=user.id, item_type=tx.item_type, item_id=tx.item_id))

    tx.status = "completed"
    tx.external_id = tx_hash
    await db.commit()
    return {"ok": True}


async def _safe_json(request: Request) -> dict:
    try:
        payload = await request.json()
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _extract_adsgram_signature(request: Request) -> str | None:
    for header_name in ("x-adsgram-signature", "x_adsgram_signature", "x-signature"):
        value = request.headers.get(header_name)
        if value:
            return value
    return None


async def _handle_adsgram_reward_callback(
    request: Request,
    placement: str,
    db: AsyncSession,
):
    body = await _safe_json(request)
    query = dict(request.query_params)
    user_telegram_id = extract_callback_value(query, body, "userid", "user_id", "userId")
    ad_reference = extract_callback_value(query, body, "ad_id", "adId", "reference")
    signature = _extract_adsgram_signature(request)

    print(
        f"[Adsgram Callback] placement={placement} method={request.method} "
        f"query={query} body={body} headers={dict(request.headers)}"
    )

    if not user_telegram_id:
        return {"ok": True, "note": "missing_userid"}

    try:
        parsed_user_id = int(user_telegram_id)
    except (TypeError, ValueError):
        return {"ok": True, "note": "invalid_userid"}

    if signature and settings.ADSGRAM_SECRET:
        is_valid = validate_adsgram_signature(parsed_user_id, placement, signature)
        if not is_valid:
            print(f"[Adsgram Callback] invalid signature for user={parsed_user_id} placement={placement}")
            if settings.ADSGRAM_WEBHOOK_REQUIRE_SIGNATURE:
                return {"ok": True, "note": FAILURE_INVALID_SIGNATURE}

    result = await db.execute(select(User).where(User.telegram_id == parsed_user_id))
    user = result.scalar_one_or_none()
    if user is None:
        return {"ok": True, "note": "user_not_found"}

    intent = await find_pending_intent_for_callback(db, user.id, placement)
    if intent is None:
        return {"ok": True, "note": "no_pending_intent"}

    granted_intent = await grant_intent(db, user, intent, ad_reference=str(ad_reference) if ad_reference else None)
    return {"ok": True, "note": "processed", "intent": serialize_intent(granted_intent).model_dump()}


@router.api_route("/adsgram/reward/daily-coins", methods=["GET", "POST"])
async def handle_adsgram_reward_daily_coins(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    return await _handle_adsgram_reward_callback(request, PLACEMENT_DAILY_COINS, db)


@router.api_route("/adsgram/reward/hint", methods=["GET", "POST"])
async def handle_adsgram_reward_hint(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    return await _handle_adsgram_reward_callback(request, PLACEMENT_HINT, db)


@router.api_route("/adsgram/reward/revive", methods=["GET", "POST"])
async def handle_adsgram_reward_revive(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    return await _handle_adsgram_reward_callback(request, PLACEMENT_REVIVE, db)


@router.api_route("/adsgram/reward", methods=["GET", "POST"])
async def handle_adsgram_reward_legacy(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    body = await _safe_json(request)
    print(f"[Adsgram Callback][legacy] query={dict(request.query_params)} body={body}")
    return {"ok": True, "note": "deprecated_use_placement_route"}


@router.post("/telegram/bot")
async def handle_bot_update(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Telegram bot webhook.

    For /start ref_{CODE}:
    - creates user if new
    - does not apply referral directly
    - stores pending referral code in Redis as fallback
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

    result = await db.execute(select(User).where(User.telegram_id == telegram_id))
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

    ref_code = extract_referral_code_from_start_text(text)
    if ref_code:
        try:
            await store_pending_referral_code(
                telegram_id,
                ref_code,
                source="webhook-bot",
            )
        except Exception as exc:
            print(f"[Webhook] Redis save failed: {exc}")

    return {"ok": True}
