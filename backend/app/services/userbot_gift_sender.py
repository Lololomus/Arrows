from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from telethon import functions, types
from telethon.errors import FloodWaitError, RPCError
from telethon.tl.tlobject import TLObject

from ..config import settings
from ..database import get_redis
from ..models import User, UserbotGiftOrder, UserbotStarsLedger
from .userbot_client import userbot_client
from .userbot_peers import extract_access_hash, mark_userbot_activation_required, persist_userbot_peer

logger = logging.getLogger(__name__)

REDIS_USERBOT_GIFT_CATALOG_KEY = "userbot:gift_catalog"
REDIS_USERBOT_OBSERVED_BALANCE_KEY = "userbot:observed_stars_balance"
REDIS_USERBOT_OBSERVED_BALANCE_UPDATED_KEY = "userbot:observed_stars_balance_updated_at"
REDIS_USERBOT_LOW_BALANCE_KEY = "userbot:paused_low_balance"
REDIS_USERBOT_CIRCUIT_BREAKER_KEY = "userbot:circuit_breaker"
REDIS_USERBOT_FLOOD_WAIT_ZSET_KEY = "userbot:flood_wait_events"
REDIS_USERBOT_RATE_LIMIT_ZSET_KEY = "userbot:rate_limit"

_CATALOG_TTL_SECONDS = 300
_OBSERVED_BALANCE_TTL_SECONDS = 300
_LOW_BALANCE_TTL_SECONDS = 300
_CIRCUIT_BREAKER_TTL_SECONDS = 30 * 60
_CIRCUIT_BREAKER_WINDOW_SECONDS = 10 * 60
_CIRCUIT_BREAKER_THRESHOLD = 3
_RATE_WINDOW_SECONDS = 60
_LOW_BALANCE_RETRY_SECONDS = 300

_ledger_write_lock = asyncio.Lock()


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_jsonable(value: Any) -> dict[str, Any]:
    if isinstance(value, TLObject):
        return value.to_dict()
    if isinstance(value, dict):
        return value
    return {"value": str(value)}


def _text_with_entities_to_str(value: Any) -> str:
    text = getattr(value, "text", None)
    if text:
        return str(text)
    if isinstance(value, TLObject):
        data = value.to_dict()
        if isinstance(data, dict) and "text" in data:
            return str(data["text"])
    return str(value)


class UserbotOrderError(Exception):
    pass


class UserbotRetryLater(UserbotOrderError):
    def __init__(self, retry_after: int, reason: str) -> None:
        super().__init__(reason)
        self.retry_after = max(1, int(retry_after))
        self.reason = reason


class UserbotPermanentError(UserbotOrderError):
    pass


class UserbotProcessingUnknown(UserbotOrderError):
    pass


class UserbotActivationRequired(UserbotOrderError):
    pass


@dataclass(slots=True)
class ProcessedOrderResult:
    telegram_result_json: dict[str, Any]
    star_cost_estimate: int | None = None
    ledger_event_type: str | None = None
    ledger_amount: int = 0


async def _get_redis_value(key: str) -> str | None:
    try:
        redis = await get_redis()
        return await redis.get(key)
    except Exception:
        logger.warning("userbot_gift_sender: failed to read Redis key %s", key)
        return None


async def _set_redis_value(key: str, value: str, *, ttl: int | None = None) -> None:
    try:
        redis = await get_redis()
        if ttl is not None:
            await redis.set(key, value, ex=ttl)
        else:
            await redis.set(key, value)
    except Exception:
        logger.warning("userbot_gift_sender: failed to write Redis key %s", key)


async def get_cached_observed_stars_balance() -> int | None:
    value = await _get_redis_value(REDIS_USERBOT_OBSERVED_BALANCE_KEY)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


async def get_cached_observed_stars_balance_updated_at() -> str | None:
    return await _get_redis_value(REDIS_USERBOT_OBSERVED_BALANCE_UPDATED_KEY)


async def set_cached_observed_stars_balance(balance: int) -> None:
    now_iso = utcnow_naive().isoformat()
    await _set_redis_value(
        REDIS_USERBOT_OBSERVED_BALANCE_KEY,
        str(balance),
        ttl=_OBSERVED_BALANCE_TTL_SECONDS,
    )
    await _set_redis_value(
        REDIS_USERBOT_OBSERVED_BALANCE_UPDATED_KEY,
        now_iso,
        ttl=_OBSERVED_BALANCE_TTL_SECONDS,
    )


async def is_low_balance_paused() -> bool:
    return bool(await _get_redis_value(REDIS_USERBOT_LOW_BALANCE_KEY))


async def set_low_balance_paused(paused: bool) -> None:
    try:
        redis = await get_redis()
        if paused:
            await redis.set(REDIS_USERBOT_LOW_BALANCE_KEY, "1", ex=_LOW_BALANCE_TTL_SECONDS)
        else:
            await redis.delete(REDIS_USERBOT_LOW_BALANCE_KEY)
    except Exception:
        logger.warning("userbot_gift_sender: failed to update low balance pause state")


async def is_circuit_breaker_open() -> bool:
    return bool(await _get_redis_value(REDIS_USERBOT_CIRCUIT_BREAKER_KEY))


async def get_circuit_breaker_until() -> datetime | None:
    try:
        redis = await get_redis()
        ttl = await redis.ttl(REDIS_USERBOT_CIRCUIT_BREAKER_KEY)
    except Exception:
        logger.warning("userbot_gift_sender: failed to read circuit breaker TTL")
        return None
    if ttl is None or ttl <= 0:
        return None
    return utcnow_naive() + timedelta(seconds=int(ttl))


async def record_flood_wait(wait_seconds: int) -> bool:
    try:
        redis = await get_redis()
        now_ts = time.time()
        member = f"{now_ts}:{time.monotonic_ns()}"
        min_score = now_ts - _CIRCUIT_BREAKER_WINDOW_SECONDS
        await redis.zadd(REDIS_USERBOT_FLOOD_WAIT_ZSET_KEY, {member: now_ts})
        await redis.zremrangebyscore(REDIS_USERBOT_FLOOD_WAIT_ZSET_KEY, 0, min_score)
        await redis.expire(REDIS_USERBOT_FLOOD_WAIT_ZSET_KEY, _CIRCUIT_BREAKER_WINDOW_SECONDS)
        count = int(await redis.zcard(REDIS_USERBOT_FLOOD_WAIT_ZSET_KEY))
        if count >= _CIRCUIT_BREAKER_THRESHOLD:
            await redis.set(REDIS_USERBOT_CIRCUIT_BREAKER_KEY, "1", ex=_CIRCUIT_BREAKER_TTL_SECONDS)
            return True
    except Exception:
        logger.warning("userbot_gift_sender: failed to record flood wait")
    return False


async def acquire_rate_limit_slot() -> int | None:
    try:
        redis = await get_redis()
        now_ts = time.time()
        min_score = now_ts - _RATE_WINDOW_SECONDS
        await redis.zremrangebyscore(REDIS_USERBOT_RATE_LIMIT_ZSET_KEY, 0, min_score)
        count = int(await redis.zcard(REDIS_USERBOT_RATE_LIMIT_ZSET_KEY))
        if count >= settings.USERBOT_MAX_GIFTS_PER_MINUTE:
            earliest = await redis.zrange(
                REDIS_USERBOT_RATE_LIMIT_ZSET_KEY,
                0,
                0,
                withscores=True,
            )
            if earliest:
                earliest_score = float(earliest[0][1])
                return max(1, math.ceil((earliest_score + _RATE_WINDOW_SECONDS) - now_ts))
            return _RATE_WINDOW_SECONDS

        member = f"{now_ts}:{time.monotonic_ns()}"
        await redis.zadd(REDIS_USERBOT_RATE_LIMIT_ZSET_KEY, {member: now_ts})
        await redis.expire(REDIS_USERBOT_RATE_LIMIT_ZSET_KEY, _RATE_WINDOW_SECONDS)
        return None
    except Exception:
        logger.warning("userbot_gift_sender: failed to enforce local rate limit")
        return None


async def get_cached_gift_catalog() -> list[dict[str, Any]]:
    raw = await _get_redis_value(REDIS_USERBOT_GIFT_CATALOG_KEY)
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return []
    gifts = payload.get("gifts")
    return gifts if isinstance(gifts, list) else []


async def get_cached_gift_catalog_count() -> int:
    return len(await get_cached_gift_catalog())


async def refresh_gift_catalog_cache() -> list[dict[str, Any]]:
    client = await userbot_client.connect()
    result = await client(functions.payments.GetStarGiftsRequest(hash=0))
    gifts = getattr(result, "gifts", None)
    if not gifts:
        return await get_cached_gift_catalog()

    serialized = [gift.to_dict() if isinstance(gift, TLObject) else gift for gift in gifts]
    payload = {
        "updated_at": utcnow_naive().isoformat(),
        "gifts": serialized,
    }
    await _set_redis_value(
        REDIS_USERBOT_GIFT_CATALOG_KEY,
        json.dumps(payload, default=str),
        ttl=_CATALOG_TTL_SECONDS,
    )
    return serialized


async def refresh_observed_stars_balance() -> int:
    client = await userbot_client.connect()
    me = await client.get_input_entity("me")
    status = await client(functions.payments.GetStarsStatusRequest(peer=me))
    balance = int(getattr(status.balance, "amount", 0))
    await set_cached_observed_stars_balance(balance)
    await set_low_balance_paused(balance < settings.USERBOT_STARS_LOW_THRESHOLD)
    return balance


async def get_catalog_entry(gift_id: int) -> dict[str, Any] | None:
    gifts = await get_cached_gift_catalog()
    for gift in gifts:
        if int(gift.get("id", 0)) == int(gift_id):
            return gift
    refreshed = await refresh_gift_catalog_cache()
    for gift in refreshed:
        if int(gift.get("id", 0)) == int(gift_id):
            return gift
    return None


async def get_ledger_balance(db: AsyncSession) -> int:
    result = await db.execute(select(func.coalesce(func.sum(UserbotStarsLedger.amount), 0)))
    return int(result.scalar_one())


async def add_ledger_event(
    db: AsyncSession,
    *,
    event_type: str,
    amount: int,
    gift_order_id: int | None,
    note: str | None = None,
) -> UserbotStarsLedger:
    async with _ledger_write_lock:
        balance_before = await get_ledger_balance(db)
        entry = UserbotStarsLedger(
            event_type=event_type,
            amount=amount,
            balance_after=balance_before + amount,
            gift_order_id=gift_order_id,
            note=note,
        )
        db.add(entry)
        await db.flush()
        return entry


async def get_order_ledger_total(db: AsyncSession, gift_order_id: int) -> int:
    result = await db.execute(
        select(func.coalesce(func.sum(UserbotStarsLedger.amount), 0)).where(
            UserbotStarsLedger.gift_order_id == gift_order_id
        )
    )
    return int(result.scalar_one())


async def _get_user_or_raise(db: AsyncSession, user_id: int) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise ValueError(f"user {user_id} not found")
    if not user.telegram_id:
        raise ValueError(f"user {user_id} has no telegram_id")
    return user


async def _resolve_recipient_peer(
    client: Any,
    db: AsyncSession,
    *,
    user_id: int,
    recipient_telegram_id: int,
) -> Any:
    user = await db.get(User, user_id)
    if user is None:
        raise UserbotPermanentError("user_not_found")

    if user.userbot_access_hash:
        return types.InputPeerUser(
            user_id=int(user.telegram_id),
            access_hash=int(user.userbot_access_hash),
        )

    if user.username:
        try:
            entity = await client.get_entity(user.username)
            access_hash = extract_access_hash(entity)
            if access_hash is not None:
                await persist_userbot_peer(
                    db,
                    telegram_id=int(user.telegram_id),
                    access_hash=access_hash,
                    username=getattr(entity, "username", None) or user.username,
                )
                return types.InputPeerUser(
                    user_id=int(user.telegram_id),
                    access_hash=access_hash,
                )
        except Exception:
            logger.info(
                "userbot_gift_sender: failed to resolve peer by username for user=%s username=%s",
                user.id,
                user.username,
            )

    try:
        peer = await client.get_input_entity(recipient_telegram_id)
        access_hash = extract_access_hash(peer)
        if access_hash is not None:
            await persist_userbot_peer(
                db,
                telegram_id=int(user.telegram_id),
                access_hash=access_hash,
                username=user.username,
            )
        return peer
    except ValueError:
        await mark_userbot_activation_required(db, user=user)
        raise UserbotActivationRequired("recipient_activation_required")


async def queue_userbot_send_gift(
    db: AsyncSession,
    user_id: int,
    telegram_gift_id: int,
    source_kind: str,
    source_ref: str,
    *,
    priority: int = 0,
) -> UserbotGiftOrder:
    user = await _get_user_or_raise(db, user_id)
    order = UserbotGiftOrder(
        user_id=user.id,
        recipient_telegram_id=user.telegram_id,
        operation_type="send_gift",
        status="pending",
        telegram_gift_id=int(telegram_gift_id),
        source_kind=source_kind,
        source_ref=source_ref,
        priority=priority,
        max_attempts=settings.USERBOT_MAX_ORDER_ATTEMPTS,
    )
    db.add(order)
    await db.flush()
    return order


async def queue_userbot_transfer_gift(
    db: AsyncSession,
    user_id: int,
    owned_gift_slug: str,
    source_kind: str,
    source_ref: str,
    *,
    priority: int = 0,
) -> UserbotGiftOrder:
    user = await _get_user_or_raise(db, user_id)
    order = UserbotGiftOrder(
        user_id=user.id,
        recipient_telegram_id=user.telegram_id,
        operation_type="transfer_gift",
        status="pending",
        owned_gift_slug=owned_gift_slug,
        source_kind=source_kind,
        source_ref=source_ref,
        priority=priority,
        max_attempts=settings.USERBOT_MAX_ORDER_ATTEMPTS,
    )
    db.add(order)
    await db.flush()
    return order


async def _ensure_paid_operation_allowed(db: AsyncSession, amount: int) -> None:
    ledger_balance = await get_ledger_balance(db)
    if ledger_balance < amount:
        raise UserbotRetryLater(_LOW_BALANCE_RETRY_SECONDS, "ledger_balance_insufficient")

    observed_balance = await get_cached_observed_stars_balance()
    if observed_balance is not None:
        if observed_balance < settings.USERBOT_STARS_LOW_THRESHOLD or observed_balance < amount:
            await set_low_balance_paused(True)
            raise UserbotRetryLater(_LOW_BALANCE_RETRY_SECONDS, "low_observed_balance")
        await set_low_balance_paused(False)


async def _call_telethon(coro: Any) -> Any:
    try:
        return await coro
    except FloodWaitError as exc:
        breaker_open = await record_flood_wait(exc.seconds)
        if breaker_open:
            logger.warning("userbot_gift_sender: circuit breaker opened after flood wait")
        raise UserbotRetryLater(exc.seconds, f"flood_wait:{exc.seconds}") from exc
    except RPCError as exc:
        message = str(exc)
        upper = message.upper()
        if "BALANCE" in upper or "STARS" in upper:
            await set_low_balance_paused(True)
            raise UserbotRetryLater(_LOW_BALANCE_RETRY_SECONDS, "insufficient_userbot_stars") from exc
        if "PEER_ID_INVALID" in upper or "USER_ID_INVALID" in upper:
            raise UserbotPermanentError("recipient_peer_invalid") from exc
        if "USER_IS_BLOCKED" in upper or "USER_PRIVACY_RESTRICTED" in upper:
            raise UserbotPermanentError("recipient_privacy_restricted") from exc
        raise UserbotProcessingUnknown(f"rpc_error:{message[:200]}") from exc
    except Exception as exc:
        raise UserbotProcessingUnknown(f"unexpected_error:{str(exc)[:200]}") from exc


async def _submit_stars_payment(client: Any, invoice: Any) -> dict[str, Any]:
    retry_after = await acquire_rate_limit_slot()
    if retry_after is not None:
        raise UserbotRetryLater(retry_after, f"local_rate_limit:{retry_after}")

    payment_form = await _call_telethon(
        client(functions.payments.GetPaymentFormRequest(invoice=invoice))
    )
    result = await _call_telethon(
        client(
            functions.payments.SendStarsFormRequest(
                form_id=payment_form.form_id,
                invoice=invoice,
            )
        )
    )
    return _to_jsonable(result)


async def _load_saved_gift(client: Any, slug: str) -> Any:
    result = await _call_telethon(
        client(
            functions.payments.GetSavedStarGiftRequest(
                stargift=[types.InputSavedStarGiftSlug(slug=slug)]
            )
        )
    )
    gifts = getattr(result, "gifts", None) or []
    if not gifts:
        raise UserbotPermanentError("owned_gift_not_found")
    return gifts[0]


async def _process_send_gift(
    client: Any,
    order: UserbotGiftOrder,
    db: AsyncSession,
) -> ProcessedOrderResult:
    if order.telegram_gift_id is None:
        raise UserbotPermanentError("telegram_gift_id_missing")

    catalog_entry = await get_catalog_entry(int(order.telegram_gift_id))
    if catalog_entry is None:
        raise UserbotPermanentError("gift_not_found_in_catalog")

    star_cost = int(catalog_entry.get("stars", 0) or 0)
    order.star_cost_estimate = star_cost
    await _ensure_paid_operation_allowed(db, star_cost)

    check_result = await _call_telethon(
        client(functions.payments.CheckCanSendGiftRequest(gift_id=int(order.telegram_gift_id)))
    )
    if hasattr(check_result, "reason"):
        reason = _text_with_entities_to_str(check_result.reason)
        raise UserbotPermanentError(f"gift_not_sendable:{reason[:180]}")

    recipient_peer = await _resolve_recipient_peer(
        client,
        db,
        user_id=order.user_id,
        recipient_telegram_id=order.recipient_telegram_id,
    )
    invoice = types.InputInvoiceStarGift(
        peer=recipient_peer,
        gift_id=int(order.telegram_gift_id),
        include_upgrade=False,
    )
    result = await _submit_stars_payment(client, invoice)
    return ProcessedOrderResult(
        telegram_result_json=result,
        star_cost_estimate=star_cost,
        ledger_event_type="gift_purchase",
        ledger_amount=-star_cost,
    )


async def _process_transfer_gift(
    client: Any,
    order: UserbotGiftOrder,
    db: AsyncSession,
) -> ProcessedOrderResult:
    if not order.owned_gift_slug:
        raise UserbotPermanentError("owned_gift_slug_missing")

    saved_gift = await _load_saved_gift(client, order.owned_gift_slug)
    transfer_cost = int(getattr(saved_gift, "transfer_stars", 0) or 0)
    order.star_cost_estimate = transfer_cost

    input_saved = types.InputSavedStarGiftSlug(slug=order.owned_gift_slug)
    recipient_peer = await _resolve_recipient_peer(
        client,
        db,
        user_id=order.user_id,
        recipient_telegram_id=order.recipient_telegram_id,
    )

    if transfer_cost > 0:
        await _ensure_paid_operation_allowed(db, transfer_cost)
        invoice = types.InputInvoiceStarGiftTransfer(
            stargift=input_saved,
            to_id=recipient_peer,
        )
        result = await _submit_stars_payment(client, invoice)
        return ProcessedOrderResult(
            telegram_result_json=result,
            star_cost_estimate=transfer_cost,
            ledger_event_type="transfer_fee",
            ledger_amount=-transfer_cost,
        )

    retry_after = await acquire_rate_limit_slot()
    if retry_after is not None:
        raise UserbotRetryLater(retry_after, f"local_rate_limit:{retry_after}")

    result = await _call_telethon(
        client(
            functions.payments.TransferStarGiftRequest(
                stargift=input_saved,
                to_id=recipient_peer,
            )
        )
    )
    return ProcessedOrderResult(
        telegram_result_json=_to_jsonable(result),
        star_cost_estimate=0,
    )


async def process_userbot_order(
    order: UserbotGiftOrder,
    db: AsyncSession,
) -> ProcessedOrderResult:
    client = await userbot_client.connect()
    if not await client.is_user_authorized():
        raise UserbotPermanentError("userbot_not_authorized")

    if order.operation_type == "send_gift":
        return await _process_send_gift(client, order, db)
    if order.operation_type == "transfer_gift":
        return await _process_transfer_gift(client, order, db)
    raise UserbotPermanentError("unsupported_operation")
