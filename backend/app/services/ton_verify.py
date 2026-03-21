"""
On-chain TON transaction verification via TON Center API.

Scans recent inbound transactions on the receiving wallet and matches
by comment + amount.  This approach works regardless of how the
transaction was submitted (TonConnect BOC, external wallet, etc.).
"""

import httpx

from ..config import settings


TON_CENTER_BASE = "https://toncenter.com/api/v2"


async def verify_ton_transaction(
    expected_address: str,
    expected_amount_nano: int,
    expected_comment: str,
) -> dict | None:
    """
    Search recent inbound transactions on *expected_address* for one
    whose comment and amount match.

    Args:
        expected_address: The receiving wallet address (our merchant wallet).
        expected_amount_nano: Minimum expected amount in nanoTON.
        expected_comment: Exact comment/memo that must be present.

    Returns:
        A dict ``{"tx_hash": "<hash>", "amount": <int>}`` on success,
        or ``None`` if no matching transaction was found.
    """
    if not settings.TON_API_KEY:
        print("⚠️ [TonVerify] TON_API_KEY not configured, skipping on-chain verification")
        return None

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{TON_CENTER_BASE}/getTransactions",
                params={
                    "address": expected_address,
                    "limit": 30,
                    "api_key": settings.TON_API_KEY,
                },
            )

            if resp.status_code != 200:
                print(f"⚠️ [TonVerify] TON API error: {resp.status_code}")
                return None

            data = resp.json()
            if not data.get("ok"):
                print(f"⚠️ [TonVerify] TON API returned error: {data}")
                return None

            transactions = data.get("result", [])

            for tx in transactions:
                in_msg = tx.get("in_msg", {})
                msg_value = int(in_msg.get("value", "0"))
                msg_comment = _extract_comment(in_msg)

                # Match by comment first (unique per transaction)
                if msg_comment != expected_comment:
                    continue

                # Check amount (allow 1% tolerance for network fees)
                if msg_value < expected_amount_nano * 0.99:
                    print(
                        f"⚠️ [TonVerify] Comment matched but amount too low: "
                        f"got {msg_value}, expected >= {expected_amount_nano}"
                    )
                    return None

                tx_hash = tx.get("transaction_id", {}).get("hash", "")
                print(
                    f"✅ [TonVerify] Transaction verified: "
                    f"comment={expected_comment}, hash={tx_hash}"
                )
                return {"tx_hash": tx_hash, "amount": msg_value}

            print(
                f"⚠️ [TonVerify] No matching transaction found "
                f"for comment='{expected_comment}'"
            )
            return None

    except Exception as e:
        print(f"⚠️ [TonVerify] Verification error: {e}")
        return None


def _extract_comment(in_msg: dict) -> str:
    """Extract text comment from in_msg."""
    # TON Center returns comment in msg_data.text or message
    msg_data = in_msg.get("msg_data", {})
    if isinstance(msg_data, dict):
        body = msg_data.get("text", "")
        if body:
            return body

    # Fallback: message field
    return in_msg.get("message", "")
