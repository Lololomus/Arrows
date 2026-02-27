"""
Referral helpers shared across API and bot entrypoints.
"""

from ..config import settings
from ..database import get_redis


def extract_referral_code(raw_value: str | None) -> str | None:
    """Extracts normalized referral code from a raw `ref_CODE` value."""
    if not raw_value:
        return None

    value = raw_value.strip()
    if not value.lower().startswith("ref_"):
        return None

    code = value[4:].strip().upper()
    return code or None


def extract_referral_code_from_start_text(text: str | None) -> str | None:
    """Extracts referral code from `/start ref_CODE` bot command text."""
    if not text:
        return None

    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        return None

    return extract_referral_code(parts[1])


async def store_pending_referral_code(
    telegram_id: int,
    referral_code: str,
    *,
    source: str,
) -> bool:
    """Stores pending referral code in Redis for auth-time fallback."""
    code = referral_code.strip().upper()
    if not code:
        return False

    redis = await get_redis()
    await redis.set(
        f"ref_pending:{telegram_id}",
        code,
        ex=settings.REFERRAL_GRACE_PERIOD_HOURS * 3600,
    )
    print(f"📌 [Referral:{source}] Stored pending code for telegram_id={telegram_id}")
    return True
