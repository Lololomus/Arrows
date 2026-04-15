"""
Arrow Puzzle - Webhooks API

Telegram Payments, TON, AdsGram and Telegram bot updates.
"""

import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.shop import apply_boost, get_item_by_id
from ..config import settings
from ..database import get_db, get_redis
from ..middleware.security import validate_adsgram_signature
from ..models import Inventory, Transaction, User
from ..services.admin_stars_topup import validate_admin_topup_checkout
from ..services.case_logic import (
    CASE_RESULT_REDIS_TTL_SECONDS,
    create_stars_case_purchase,
    determine_rarity,
    grant_case_rewards,
    serialize_case_result,
)
from ..services.ad_rewards import (
    FAILURE_INVALID_SIGNATURE,
    PLACEMENT_DAILY_COINS,
    PLACEMENT_HINT,
    PLACEMENT_REVIVE,
    PLACEMENT_SPIN_RETRY,
    PLACEMENT_TASK,
    PLACEMENT_AD_CASE,
    extract_callback_value,
    find_pending_intent_for_callback,
    grant_intent,
    serialize_intent,
)
from ..services.referrals import extract_referral_code_from_start_text, store_pending_referral_code


router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)


@router.post("/telegram/payment")
async def handle_telegram_payment(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Webhook for Telegram Stars payments."""
    body = await request.json()

    if "pre_checkout_query" in body:
        bot_token = settings.BOT_TOKEN or settings.TELEGRAM_BOT_TOKEN
        if bot_token:
            query = body["pre_checkout_query"]
            invoice_payload = query.get("invoice_payload", "")

            ok = True
            error_message = None

            if invoice_payload.startswith("bundle:"):
                try:
                    from ..api.shop import EXTRA_BUNDLES
                    parts = invoice_payload.split(":")
                    if len(parts) != 5:
                        raise ValueError("Invalid bundle payload")
                    bundle_id = parts[1]
                    bundle_user_id = int(parts[2])
                    expected_tg_id = int(parts[3])
                    expected_price = int(parts[4])

                    bundle = next((b for b in EXTRA_BUNDLES if b["id"] == bundle_id), None)
                    payer_tg_id = query.get("from", {}).get("id")
                    total_amount = query.get("total_amount")

                    if bundle is None:
                        ok = False
                        error_message = "Bundle not found"
                    elif payer_tg_id != expected_tg_id:
                        ok = False
                        error_message = "Not your bundle"
                    elif total_amount != expected_price:
                        ok = False
                        error_message = "Price mismatch"
                    elif expected_price != bundle["price_stars"]:
                        ok = False
                        error_message = "Price has changed"
                    else:
                        result = await db.execute(
                            select(User.id).where(
                                User.id == bundle_user_id,
                                User.telegram_id == expected_tg_id,
                            )
                        )
                        if result.scalar_one_or_none() is None:
                            ok = False
                            error_message = "User not found"
                except (IndexError, ValueError):
                    ok = False
                    error_message = "Invalid payment payload"
                    logger.warning("telegram/payment: invalid bundle pre_checkout payload %r", invoice_payload)
                except Exception:
                    ok = False
                    error_message = "Payment validation failed"
                    logger.exception("telegram/payment: failed to validate bundle pre_checkout")
            elif invoice_payload.startswith("welcome_bundle:"):
                try:
                    from ..api.shop import WELCOME_BUNDLE, _discount_until
                    parts = invoice_payload.split(":")
                    if len(parts) != 4:
                        raise ValueError("Invalid welcome bundle payload")
                    bundle_user_id = int(parts[1])
                    expected_tg_id = int(parts[2])
                    expected_price = int(parts[3])

                    payer_tg_id = query.get("from", {}).get("id")
                    total_amount = query.get("total_amount")

                    if payer_tg_id != expected_tg_id:
                        ok = False
                        error_message = "Not your offer"
                    elif total_amount != expected_price:
                        ok = False
                        error_message = "Price has changed"
                    elif expected_price not in (WELCOME_BUNDLE["price_full"], WELCOME_BUNDLE["price_discounted"]):
                        ok = False
                        error_message = "Price has changed"
                    else:
                        result = await db.execute(
                            select(User.welcome_offer_purchased, User.created_at)
                            .where(User.id == bundle_user_id, User.telegram_id == expected_tg_id)
                        )
                        row = result.one_or_none()
                        if row is None:
                            ok = False
                            error_message = "User not found"
                        else:
                            already_purchased, created_at = row
                            if already_purchased:
                                ok = False
                                error_message = "Already purchased"
                            elif (
                                expected_price == WELCOME_BUNDLE["price_discounted"]
                                and settings.ENVIRONMENT != "development"
                            ):
                                now = datetime.now(timezone.utc).replace(tzinfo=None)
                                deadline = _discount_until(created_at)
                                if deadline is None or now >= deadline:
                                    ok = False
                                    error_message = "Discount expired"
                except (IndexError, ValueError):
                    ok = False
                    error_message = "Invalid payment payload"
                    logger.warning("telegram/payment: invalid welcome_bundle pre_checkout payload %r", invoice_payload)
                except Exception:
                    ok = False
                    error_message = "Payment validation failed"
                    logger.exception("telegram/payment: failed to validate welcome_bundle pre_checkout")
            else:
                ok, error_message = validate_admin_topup_checkout(
                    query.get("from", {}).get("id"),
                    invoice_payload,
                )

            answer_payload: dict = {"pre_checkout_query_id": query["id"], "ok": ok}
            if error_message:
                answer_payload["error_message"] = error_message
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    await client.post(
                        f"https://api.telegram.org/bot{bot_token}/answerPreCheckoutQuery",
                        json=answer_payload,
                    )
            except Exception:
                logger.exception("telegram/payment: failed to answer pre_checkout_query")
        return {"ok": True}

    if "message" in body and "successful_payment" in body["message"]:
        payment = body["message"]["successful_payment"]
        user_id = body["message"]["from"]["id"]
        charge_id = payment.get("telegram_payment_charge_id") or payment.get("provider_payment_charge_id", "")
        payload_str = payment["invoice_payload"]

        if payload_str.startswith("bundle:"):
            from ..api.shop import EXTRA_BUNDLES
            try:
                parts = payload_str.split(":")
                if len(parts) != 5:
                    raise ValueError("Invalid bundle payload")
                bundle_id = parts[1]
                bundle_user_id = int(parts[2])
                expected_tg_id = int(parts[3])
                expected_price = int(parts[4])
                total_amount = int(payment.get("total_amount", 0))
            except (IndexError, ValueError):
                logger.warning("telegram/payment: invalid bundle successful_payment payload %r", payload_str)
                return {"ok": False, "error": "Invalid bundle payment payload"}

            bundle = next((b for b in EXTRA_BUNDLES if b["id"] == bundle_id), None)
            if not bundle:
                return {"ok": False, "error": "Bundle not found"}
            if user_id != expected_tg_id:
                return {"ok": False, "error": "Not your bundle"}
            if total_amount != expected_price or expected_price != bundle["price_stars"]:
                return {"ok": False, "error": "Price mismatch"}

            result = await db.execute(
                select(User)
                .where(User.id == bundle_user_id, User.telegram_id == expected_tg_id)
                .with_for_update()
            )
            bundle_user = result.scalar_one_or_none()
            if bundle_user:
                # Idempotency: skip if this charge_id was already processed
                if charge_id:
                    existing = await db.execute(
                        select(Transaction).where(
                            Transaction.currency == "stars",
                            Transaction.ton_tx_hash == charge_id,
                            Transaction.status == "completed",
                        )
                    )
                    if existing.scalar_one_or_none():
                        return {"ok": True}

                bundle_user.hint_balance += bundle["hints"]
                bundle_user.revive_balance += bundle["revives"]
                if bundle.get("extra_lives"):
                    bundle_user.extra_lives += bundle["extra_lives"]
                db.add(Transaction(
                    user_id=bundle_user.id,
                    type="purchase",
                    currency="stars",
                    amount=total_amount,
                    item_type=f"bundle_{bundle_id}",
                    item_id=bundle_id,
                    status="completed",
                    ton_tx_hash=charge_id,
                ))
                await db.commit()
                redis_client = await get_redis()
                if redis_client:
                    await redis_client.delete(f"bundle_pending_v1:{bundle_user.id}:{bundle_id}")
            return {"ok": True}

        if payload_str.startswith("welcome_bundle:"):
            from ..api.shop import WELCOME_BUNDLE
            try:
                parts = payload_str.split(":")
                if len(parts) != 4:
                    raise ValueError("Invalid welcome bundle payload")
                bundle_user_id = int(parts[1])
                expected_tg_id = int(parts[2])
                expected_price = int(parts[3])
                total_amount = int(payment.get("total_amount", 0))
            except (IndexError, ValueError):
                logger.warning("telegram/payment: invalid welcome_bundle successful_payment payload %r", payload_str)
                return {"ok": False, "error": "Invalid welcome bundle payment payload"}

            if user_id != expected_tg_id:
                return {"ok": False, "error": "Not your offer"}
            if total_amount != expected_price or expected_price not in (WELCOME_BUNDLE["price_full"], WELCOME_BUNDLE["price_discounted"]):
                return {"ok": False, "error": "Price mismatch"}

            result = await db.execute(
                select(User)
                .where(User.id == bundle_user_id, User.telegram_id == expected_tg_id)
                .with_for_update()
            )
            bundle_user = result.scalar_one_or_none()
            if bundle_user and not bundle_user.welcome_offer_purchased:
                if charge_id:
                    existing = await db.execute(
                        select(Transaction).where(
                            Transaction.currency == "stars",
                            Transaction.ton_tx_hash == charge_id,
                            Transaction.status == "completed",
                        )
                    )
                    if existing.scalar_one_or_none():
                        return {"ok": True}

                bundle_user.hint_balance += WELCOME_BUNDLE["hints"]
                bundle_user.revive_balance += WELCOME_BUNDLE["revives"]
                bundle_user.welcome_offer_purchased = True
                db.add(Transaction(
                    user_id=bundle_user.id,
                    type="purchase",
                    currency="stars",
                    amount=total_amount,
                    item_type="welcome_bundle",
                    item_id="bundle",
                    status="completed",
                    ton_tx_hash=charge_id,
                ))
                await db.commit()
                redis_client = await get_redis()
                if redis_client:
                    await redis_client.delete(f"welcome_offer_pending:{bundle_user_id}")
                    await redis_client.delete(f"welcome_offer_pending_v2:{bundle_user_id}")
            return {"ok": True}

        item_type, item_id = payload_str.split(":")

        result = await db.execute(
            select(User)
            .where(User.telegram_id == user_id)
            .with_for_update()
        )
        user = result.scalar_one_or_none()
        if not user:
            return {"ok": False, "error": "User not found"}

        # Idempotency: after locking the user row, skip if this charge_id
        # was already processed by a previous webhook retry.
        if charge_id:
            existing = await db.execute(
                select(Transaction).where(
                    Transaction.currency == "stars",
                    Transaction.ton_tx_hash == charge_id,
                    Transaction.status == "completed",
                )
            )
            if existing.scalar_one_or_none():
                return {"ok": True}

        if item_type == "case" and item_id == "standard":
            # Case opening via Stars
            case_result = await create_stars_case_purchase(
                user=user,
                total_amount=payment["total_amount"],
                charge_id=charge_id,
                db=db,
            )
            await db.commit()

            # Store result in Redis so the frontend poll can pick it up
            try:
                redis = await get_redis()
                if redis is not None:
                    await redis.setex(
                        f"case_result:{user.id}",
                        CASE_RESULT_REDIS_TTL_SECONDS,
                        serialize_case_result(case_result),
                    )
            except Exception:
                pass  # Non-critical: user can retry polling

        else:
            item = get_item_by_id(item_type, item_id)
            if item:
                if item_type == "boosts":
                    await apply_boost(user, item_id, db)
                else:
                    try:
                        async with db.begin_nested():
                            db.add(Inventory(user_id=user.id, item_type=item_type, item_id=item_id))
                            await db.flush()
                    except IntegrityError:
                        pass

                db.add(
                    Transaction(
                        user_id=user.id,
                        type="purchase",
                        currency="stars",
                        amount=payment["total_amount"],
                        item_type=item_type,
                        item_id=item_id,
                        status="completed",
                        ton_tx_hash=charge_id,
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
    """
    Webhook for TON payments (external service / block scanner).

    Protected by API key header. The primary confirmation path is
    POST /shop/transaction/{tx_id}/confirm called by the authenticated
    frontend after sendTransaction. This webhook is a secondary
    fallback for block-scanner integrations.
    """
    # Require API key for external callers
    api_key = request.headers.get("x-api-key", "")
    if not settings.ADMIN_API_KEY or api_key != settings.ADMIN_API_KEY:
        return {"ok": False, "error": "Unauthorized"}

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

    # Lock the row to prevent concurrent grant
    result = await db.execute(
        select(Transaction)
        .where(
            Transaction.id == pending_tx_id,
            Transaction.user_id == user_id,
        )
        .with_for_update()
    )
    tx = result.scalar_one_or_none()
    if not tx:
        return {"ok": False, "error": "Transaction not found"}

    # Already completed — idempotent
    if tx.status == "completed":
        return {"ok": True}

    if tx.status != "pending":
        return {"ok": False, "error": f"Transaction status is '{tx.status}'"}

    if amount < tx.amount:
        return {"ok": False, "error": "Insufficient amount"}

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return {"ok": False, "error": "User not found"}

    if tx.item_type == "cases" and tx.item_id == "standard":
        user_result = await db.execute(
            select(User).where(User.id == user_id).with_for_update()
        )
        user = user_result.scalar_one_or_none()
        if not user:
            return {"ok": False, "error": "User not found"}

        rarity = determine_rarity(user.case_pity_counter)
        await grant_case_rewards(user, rarity, "ton", db, transaction_id=tx.id)
    else:
        item = get_item_by_id(tx.item_type, tx.item_id)
        if not item:
            return {"ok": False, "error": "Item not found"}

        if tx.item_type == "boosts":
            await apply_boost(user, tx.item_id, db)
        else:
            try:
                async with db.begin_nested():
                    db.add(Inventory(user_id=user.id, item_type=tx.item_type, item_id=tx.item_id))
                    await db.flush()
            except IntegrityError:
                pass

    tx.status = "completed"
    tx.ton_tx_hash = tx_hash
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
        print(f"[Adsgram Callback] placement={placement} note=missing_userid ad_reference={ad_reference}")
        return {"ok": True, "note": "missing_userid"}

    try:
        parsed_user_id = int(user_telegram_id)
    except (TypeError, ValueError):
        print(f"[Adsgram Callback] placement={placement} note=invalid_userid raw_userid={user_telegram_id}")
        return {"ok": True, "note": "invalid_userid"}

    if signature and settings.ADSGRAM_SECRET:
        is_valid = validate_adsgram_signature(parsed_user_id, placement, signature)
        if not is_valid:
            print(
                f"[Adsgram Callback] placement={placement} note=invalid_signature "
                f"userid={parsed_user_id} ad_reference={ad_reference}"
            )
            if settings.ADSGRAM_WEBHOOK_REQUIRE_SIGNATURE:
                return {"ok": True, "note": FAILURE_INVALID_SIGNATURE}

    result = await db.execute(select(User).where(User.telegram_id == parsed_user_id))
    user = result.scalar_one_or_none()
    if user is None:
        print(
            f"[Adsgram Callback] placement={placement} note=user_not_found "
            f"userid={parsed_user_id} ad_reference={ad_reference}"
        )
        return {"ok": True, "note": "user_not_found"}

    intent = await find_pending_intent_for_callback(db, user.id, placement)
    if intent is None:
        print(
            f"[Adsgram Callback] placement={placement} note=no_pending_intent "
            f"userid={parsed_user_id} resolved_user={user.id} ad_reference={ad_reference}"
        )
        return {"ok": True, "note": "no_pending_intent"}

    granted_intent = await grant_intent(db, user, intent, ad_reference=str(ad_reference) if ad_reference else None)
    print(
        f"[Adsgram Callback] placement={placement} note=processed userid={parsed_user_id} "
        f"resolved_user={user.id} pending_intent_found=true intent_id={granted_intent.intent_id} "
        f"ad_reference={ad_reference}"
    )

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


@router.api_route("/adsgram/reward/spin-retry", methods=["GET", "POST"])
async def handle_adsgram_reward_spin_retry(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    return await _handle_adsgram_reward_callback(request, PLACEMENT_SPIN_RETRY, db)


@router.api_route("/adsgram/reward/task", methods=["GET", "POST"])
async def handle_adsgram_reward_task(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    return await _handle_adsgram_reward_callback(request, PLACEMENT_TASK, db)


@router.api_route("/adsgram/reward/ad-case", methods=["GET", "POST"])
async def handle_adsgram_reward_ad_case(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    return await _handle_adsgram_reward_callback(request, PLACEMENT_AD_CASE, db)


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
