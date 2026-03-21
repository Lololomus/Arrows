"""
TON Connect proof verification.

Verifies wallet ownership via the TON Connect proof protocol.
Spec: https://docs.ton.org/develop/dapps/ton-connect/sign
"""

import hashlib
import struct
import time
from typing import Optional

from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError

from pytoniq_core import Address

from ..config import settings


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
            - state_init (str, optional) — base64 BOC of the wallet StateInit
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

        # 2. Timestamp freshness check
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
        workchain = addr.wc
        addr_hash = addr.hash_part  # 32 bytes

        # 6. Build the message to verify
        # "ton-proof-item-v2/" prefix
        wc_bytes = struct.pack(">i", workchain)  # 4 bytes, big-endian int32
        ts_bytes = struct.pack("<q", timestamp)  # 8 bytes, little-endian int64
        dl_bytes = struct.pack("<I", domain_length)  # 4 bytes, little-endian uint32
        domain_bytes = domain_value.encode("utf-8")
        payload_bytes = payload.encode("utf-8")

        message = b"ton-proof-item-v2/"
        message += wc_bytes
        message += addr_hash
        message += dl_bytes
        message += domain_bytes
        message += ts_bytes
        message += payload_bytes

        message_hash = hashlib.sha256(message).digest()

        # 7. Prepend "ton-connect" prefix and hash again
        full_message = b"\xff\xff" + b"ton-connect" + message_hash
        final_hash = hashlib.sha256(full_message).digest()

        # 8. Verify Ed25519 signature
        import base64
        signature = base64.b64decode(signature_b64)

        # Get public key from state_init if provided
        public_key = _extract_public_key(proof, addr)
        if public_key is None:
            return False

        verify_key = VerifyKey(public_key)
        verify_key.verify(final_hash, signature)

        return True

    except (BadSignatureError, Exception) as e:
        print(f"⚠️ [TonProof] Verification failed: {e}")
        return False


def _extract_public_key(proof: dict, addr: Address) -> Optional[bytes]:
    """
    Extract the public key from the wallet state_init.

    For standard wallet contracts (v3r2, v4r2, v5), the public key
    is stored in the data cell of the state_init.
    """
    import base64
    from pytoniq_core import Cell

    state_init_b64 = proof.get("state_init")
    if not state_init_b64:
        return None

    try:
        state_init_boc = base64.b64decode(state_init_b64)
        state_init_cell = Cell.one_from_boc(state_init_boc)

        # Verify that the state_init corresponds to the claimed address
        state_init_hash = state_init_cell.hash
        if state_init_hash != addr.hash_part:
            print("⚠️ [TonProof] state_init hash does not match address")
            return None

        # Parse StateInit: code (ref 0), data (ref 1)
        state_init_slice = state_init_cell.begin_parse()

        # StateInit TLB: split_depth:Maybe ^Cell special:Maybe TickTock code:Maybe ^Cell data:Maybe ^Cell library:Maybe ^Cell
        # Skip split_depth
        if state_init_slice.load_bit():
            state_init_slice.load_ref()
        # Skip special
        if state_init_slice.load_bit():
            state_init_slice.load_ref()
        # Code
        if state_init_slice.load_bit():
            state_init_slice.load_ref()
        # Data
        if not state_init_slice.load_bit():
            return None

        data_cell = state_init_slice.load_ref()
        data_slice = data_cell.begin_parse()

        # For wallet v3/v4: first 32 bits = seqno (or subwallet_id), next 256 bits = public key
        # For wallet v5: first 33 bits = is_signature_allowed(1) + seqno(32), then subwallet(32), then public key(256)
        # Common approach: try to find 256-bit public key

        # Most wallets: skip first 32 bits (seqno/subwallet), read 256 bits as pubkey
        # wallet v4r2: skip 64 bits (seqno + subwallet_id)
        # We try both patterns

        bits_remaining = data_slice.remaining_bits

        if bits_remaining >= 32 + 256:
            # Try wallet v3r2 pattern: 32-bit seqno + 256-bit pubkey
            data_slice_copy = data_cell.begin_parse()
            data_slice_copy.load_uint(32)  # seqno or subwallet_id

            if data_slice_copy.remaining_bits >= 256:
                pubkey_candidate = data_slice_copy.load_bytes(32)

                # Verify: reconstruct address from state_init to validate
                # If the pubkey works for signature verification, it's correct
                # We'll return it and let the caller verify the signature
                return pubkey_candidate

        if bits_remaining >= 64 + 256:
            # Try wallet v4r2 pattern: 32-bit seqno + 32-bit subwallet_id + 256-bit pubkey
            data_slice_v4 = data_cell.begin_parse()
            data_slice_v4.load_uint(64)  # seqno + subwallet_id

            if data_slice_v4.remaining_bits >= 256:
                return data_slice_v4.load_bytes(32)

        if bits_remaining >= 33 + 32 + 256:
            # Try wallet v5 pattern: 1-bit flag + 32-bit seqno + 32-bit subwallet + 256-bit pubkey
            data_slice_v5 = data_cell.begin_parse()
            data_slice_v5.load_uint(33)  # is_signature_allowed + seqno
            data_slice_v5.load_uint(32)  # subwallet_id

            if data_slice_v5.remaining_bits >= 256:
                return data_slice_v5.load_bytes(32)

        return None

    except Exception as e:
        print(f"⚠️ [TonProof] Failed to extract public key: {e}")
        return None
