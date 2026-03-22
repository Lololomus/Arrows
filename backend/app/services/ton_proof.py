"""
TON Connect proof verification.

Verifies wallet ownership via the TON Connect proof protocol.
Spec: https://docs.ton.org/develop/dapps/ton-connect/sign

Wallet data cell layouts (skip_bits before 256-bit public key):
  v1/v2: seqno(32)                                              → skip 32
  v3:    seqno(32) + subwallet_id(32)                            → skip 64
  v4:    seqno(32) + subwallet_id(32)                            → skip 64
  v5:    is_signature_allowed(1) + seqno(32) + subwallet_id(32)  → skip 65

Confirmed from pytoniq_core source:
  WalletV3Data.deserialize: load_uint(32) + load_uint(32) + load_bytes(32)
  WalletV4Data.deserialize: load_uint(32) + load_uint(32) + load_bytes(32) + load_maybe_ref()
"""

import base64
import hashlib
import logging
import struct
import time
from typing import Optional

from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError

from pytoniq_core import Address, Cell

from ..config import settings

logger = logging.getLogger(__name__)

# Offsets to try, ordered by frequency (v3/v4 are ~95% of wallets)
_PUBKEY_SKIP_BITS = (64, 65, 32)


def verify_ton_proof(
    address: str,
    proof: dict,
    expected_payload: str,
    allowed_domains: list[str],
) -> bool:
    """
    Verify a TON Connect proof of wallet ownership.

    Args:
        address: TON wallet address (raw or user-friendly).
        proof: The ton_proof dict from TonConnect SDK containing:
            - timestamp (int)
            - domain: { lengthBytes (int), value (str) }
            - payload (str)
            - signature (str, base64)
            - state_init (str) — base64 BOC of the wallet StateInit
        expected_payload: Server-issued challenge string.
        allowed_domains: List of allowed domain values.

    Returns:
        True if the proof is valid.
    """
    try:
        # 1. Extract proof fields
        timestamp = proof.get("timestamp")
        domain = proof.get("domain", {})
        domain_value = domain.get("value", "")
        domain_length = domain.get("lengthBytes", len(domain_value))
        payload = proof.get("payload", "")
        signature_b64 = proof.get("signature", "")

        if not all([timestamp, domain_value, payload, signature_b64]):
            return False

        # 2. Timestamp freshness
        now = int(time.time())
        if abs(now - timestamp) > settings.TON_CONNECT_PROOF_TTL:
            return False

        # 3. Domain check
        if domain_value not in allowed_domains:
            return False

        # 4. Payload check
        if payload != expected_payload:
            return False

        # 5. Parse address
        addr = Address(address)

        # 6. Build the message (TON Connect proof spec v2)
        message = (
            b"ton-proof-item-v2/"
            + struct.pack(">i", addr.wc)                    # workchain, 4B BE
            + addr.hash_part                                 # address hash, 32B
            + struct.pack("<I", domain_length)               # domain len, 4B LE
            + domain_value.encode("utf-8")                   # domain
            + struct.pack("<q", timestamp)                   # timestamp, 8B LE
            + payload.encode("utf-8")                        # payload
        )

        # 7. Double hash: sha256(0xffff || "ton-connect" || sha256(message))
        final_hash = hashlib.sha256(
            b"\xff\xff" + b"ton-connect" + hashlib.sha256(message).digest()
        ).digest()

        # 8. Decode signature
        signature = base64.b64decode(signature_b64)

        # 9. Extract public key candidates and verify signature
        data_cell = _parse_data_cell(proof, addr)
        if data_cell is None:
            return False

        for skip_bits in _PUBKEY_SKIP_BITS:
            public_key = _try_extract_pubkey(data_cell, skip_bits)
            if public_key is None:
                continue
            try:
                VerifyKey(public_key).verify(final_hash, signature)
                return True
            except BadSignatureError:
                continue

        return False

    except Exception as e:
        logger.warning("TonProof verification failed: %s", e)
        return False


def _parse_data_cell(proof: dict, addr: Address) -> Optional[Cell]:
    """
    Decode state_init BOC, validate address hash, extract the data cell.
    """
    state_init_b64 = proof.get("state_init")
    if not state_init_b64:
        return None

    try:
        state_init_cell = Cell.one_from_boc(base64.b64decode(state_init_b64))

        # state_init hash must match the claimed address
        if state_init_cell.hash != addr.hash_part:
            return None

        # StateInit TLB:
        #   split_depth:Maybe ^Cell  special:Maybe TickTock
        #   code:Maybe ^Cell  data:Maybe ^Cell  library:Maybe ^Cell
        si = state_init_cell.begin_parse()

        if si.load_bit():  # split_depth
            si.load_ref()
        if si.load_bit():  # special
            si.load_ref()
        if si.load_bit():  # code
            si.load_ref()
        if not si.load_bit():  # data — must be present
            return None

        return si.load_ref()

    except Exception as e:
        logger.warning("TonProof failed to parse state_init: %s", e)
        return None


def _try_extract_pubkey(data_cell: Cell, skip_bits: int) -> Optional[bytes]:
    """Extract a 256-bit public key after skipping `skip_bits` bits."""
    ds = data_cell.begin_parse()
    if ds.remaining_bits < skip_bits + 256:
        return None
    ds.load_uint(skip_bits)
    return ds.load_bytes(32)
