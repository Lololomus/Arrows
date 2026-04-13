"""
Background processor for pending TON transactions.

Runs every 60 seconds and confirms any pending TON transactions that the
client may have missed — e.g. when the user closed the app during polling.

Design:
  - Fetches last 100 on-chain transactions from TON Center ONCE per cycle
  - Matches them against all pending DB transactions in-memory (no N+1)
  - Uses SELECT FOR UPDATE on both Transaction and User rows (same as the
    confirm_ton_transaction endpoint) to prevent double-grants
  - Idempotent: skips rows whose status is no longer "pending"
"""

import asyncio
import logging
from datetime import datetime, timedelta

import httpx
from sqlalchemy import select

from ..config import settings
from ..database import AsyncSessionLocal
from ..models import User, Transaction
from .case_logic import determine_rarity, grant_case_rewards

logger = logging.getLogger(__name__)

TON_CENTER_BASE = "https://toncenter.com/api/v2"
_PENDING_MAX_AGE_HOURS = 24
_CHAIN_FETCH_LIMIT = 100  # TON Center v2 max
_LOOP_INTERVAL_SECONDS = 60


# ============================================
# PUBLIC ENTRY POINTS
# ============================================

async def ton_processor_loop() -> None:
    """Infinite loop: run processor every 60 s. Designed for asyncio.create_task."""
    logger.info("ton_processor: started (interval=%ds)", _LOOP_INTERVAL_SECONDS)
    while True:
        try:
            await process_pending_ton_transactions()
        except Exception:
            logger.exception("ton_processor: unexpected error in run")
        await asyncio.sleep(_LOOP_INTERVAL_SECONDS)


async def process_pending_ton_transactions() -> None:
    """
    One-shot run: fetch pending TON txs from DB and confirm any that have
    already appeared on-chain. Also expires stale pending txs.
    """
    if not settings.TON_PAYMENTS_ENABLED or not settings.TON_API_KEY:
        return

    cutoff = datetime.utcnow() - timedelta(hours=_PENDING_MAX_AGE_HOURS)

    # Expire pending txs older than cutoff before trying to confirm fresh ones
    await _expire_stale_pending_txs(cutoff)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Transaction).where(
                Transaction.currency == "ton",
                Transaction.status == "pending",
                Transaction.created_at >= cutoff,
            )
        )
        pending_txs = result.scalars().all()

    if not pending_txs:
        return

    logger.info("ton_processor: %d pending TON transaction(s) to check", len(pending_txs))

    # Fetch blockchain txs ONCE, match all pending in-memory
    chain_by_comment = await _fetch_chain_index()
    if not chain_by_comment:
        logger.warning("ton_processor: no blockchain data, will retry next cycle")
        return

    for tx in pending_txs:
        expected_comment = f"arrow_{tx.user_id}_{tx.id}"
        expected_amount_nano = int(float(tx.amount) * 1_000_000_000)

        match = chain_by_comment.get(expected_comment)
        if not match:
            continue

        if match["amount"] < expected_amount_nano * 0.99:
            logger.warning(
                "ton_processor: tx %d comment matched but amount %d < expected %d — skipping",
                tx.id, match["amount"], expected_amount_nano,
            )
            continue

        logger.info(
            "ton_processor: match found for tx %d (user %d, item %s)",
            tx.id, tx.user_id, tx.item_id,
        )
        await _grant_and_complete(tx.id, tx.user_id, tx.item_id, match["tx_hash"])


# ============================================
# INTERNALS
# ============================================

async def _fetch_chain_index() -> dict[str, dict]:
    """
    Fetch recent inbound txs from TON Center and return a dict keyed by
    comment text: {comment: {tx_hash, amount}}.
    """
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{TON_CENTER_BASE}/getTransactions",
                params={
                    "address": settings.TON_WALLET_ADDRESS,
                    "limit": _CHAIN_FETCH_LIMIT,
                    "api_key": settings.TON_API_KEY,
                },
            )

        if resp.status_code != 200:
            logger.warning("ton_processor: TON Center returned HTTP %s", resp.status_code)
            return {}

        data = resp.json()
        if not data.get("ok"):
            logger.warning("ton_processor: TON Center API error: %s", data)
            return {}

        index: dict[str, dict] = {}
        for chain_tx in data.get("result", []):
            in_msg = chain_tx.get("in_msg", {})
            comment = _extract_comment(in_msg)
            if comment:
                index[comment] = {
                    "tx_hash": chain_tx.get("transaction_id", {}).get("hash", ""),
                    "amount": int(in_msg.get("value", "0")),
                }
        return index

    except Exception:
        logger.exception("ton_processor: failed to fetch TON transactions")
        return {}


def _extract_comment(in_msg: dict) -> str:
    """Same decoding logic as ton_verify._extract_comment (kept in sync)."""
    import base64

    message = in_msg.get("message", "")
    if message:
        return message

    msg_data = in_msg.get("msg_data", {})
    if isinstance(msg_data, dict):
        body = msg_data.get("text", "")
        if body:
            try:
                return base64.b64decode(body).decode("utf-8")
            except Exception:
                return body

    return ""


async def _expire_stale_pending_txs(cutoff: datetime) -> None:
    """Mark pending TON txs older than cutoff as failed so they don't accumulate."""
    async with AsyncSessionLocal() as db:
        async with db.begin():
            result = await db.execute(
                select(Transaction).where(
                    Transaction.currency == "ton",
                    Transaction.status == "pending",
                    Transaction.created_at < cutoff,
                )
            )
            stale = result.scalars().all()
            for tx in stale:
                tx.status = "failed"
                logger.info(
                    "ton_processor: expired stale pending tx %d (user %d, age >%dh)",
                    tx.id, tx.user_id, _PENDING_MAX_AGE_HOURS,
                )


async def _grant_and_complete(tx_id: int, user_id: int, item_id: str, tx_hash: str) -> None:
    """Open a fresh session, lock both rows, grant item, mark tx completed."""
    async with AsyncSessionLocal() as db:
        async with db.begin():
            # Lock transaction row — prevent duplicate grant from concurrent confirm endpoint
            tx_result = await db.execute(
                select(Transaction)
                .where(Transaction.id == tx_id)
                .with_for_update()
            )
            tx = tx_result.scalar_one_or_none()
            if tx is None or tx.status != "pending":
                return  # Already completed by another path — idempotent

            # Lock user row
            user_result = await db.execute(
                select(User)
                .where(User.id == user_id)
                .with_for_update()
            )
            user = user_result.scalar_one_or_none()
            if user is None:
                logger.error("ton_processor: user %d not found for tx %d", user_id, tx_id)
                return

            # Apply item / reward
            if tx.item_type == "cases" and tx.item_id == "standard":
                rarity = determine_rarity(user.case_pity_counter)
                await grant_case_rewards(user, rarity, "ton", db, transaction_id=tx.id)
            elif item_id == "extra_life":
                if user.ton_extra_lives < 2:
                    user.extra_lives += 1
                    user.ton_extra_lives += 1
                else:
                    logger.warning(
                        "ton_processor: user %d ton_extra_lives already at max (tx %d accepted)",
                        user_id, tx_id,
                    )

            tx.status = "completed"
            tx.ton_tx_hash = tx_hash

    logger.info("ton_processor: tx %d completed for user %d item=%s", tx_id, user_id, item_id)
