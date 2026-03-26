from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import aiohttp

from ..config import settings


@dataclass
class GiftApiBadRequest(Exception):
    description: str


@dataclass
class GiftApiForbidden(Exception):
    description: str


@dataclass
class GiftApiRetryAfter(Exception):
    retry_after: int
    description: str = "Too Many Requests"


@dataclass
class GiftApiUnknownOutcome(Exception):
    description: str


async def _call_bot_api(method: str, token: str, payload: dict[str, Any] | None = None) -> Any:
    url = f"https://api.telegram.org/bot{token}/{method}"
    timeout = aiohttp.ClientTimeout(total=settings.FRAGMENT_GIFT_SEND_TIMEOUT)

    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload or {}) as response:
                data = await response.json(content_type=None)
    except asyncio.TimeoutError as exc:
        raise GiftApiUnknownOutcome(description=f"{method} timed out") from exc
    except aiohttp.ClientError as exc:
        raise GiftApiUnknownOutcome(description=f"{method} request failed: {exc}") from exc

    if data.get("ok"):
        return data.get("result")

    description = str(data.get("description", "Telegram API request failed"))
    error_code = int(data.get("error_code", 0) or 0)
    retry_after = int(data.get("parameters", {}).get("retry_after", 0) or 0)

    if error_code == 429 or retry_after > 0:
        raise GiftApiRetryAfter(retry_after=retry_after or 1, description=description)
    if error_code == 403:
        raise GiftApiForbidden(description=description)
    if error_code == 400:
        raise GiftApiBadRequest(description=description)
    if error_code >= 500:
        raise GiftApiUnknownOutcome(description=description)
    raise RuntimeError(f"{method} failed: {description}")


async def send_gift(*, bot_token: str, user_id: int, gift_id: str) -> None:
    await _call_bot_api(
        "sendGift",
        bot_token,
        {
            "user_id": user_id,
            "gift_id": gift_id,
        },
    )


async def get_available_gifts(*, bot_token: str) -> list[dict[str, Any]]:
    result = await _call_bot_api("getAvailableGifts", bot_token)
    gifts = result.get("gifts") if isinstance(result, dict) else None
    return gifts if isinstance(gifts, list) else []
