from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from telethon import TelegramClient, events, functions, types
from telethon.sessions import SQLiteSession

from ..config import settings
from .userbot_peers import extract_access_hash, persist_userbot_peer_by_telegram_id

logger = logging.getLogger(__name__)

_REQUIRED_GIFT_TL_TYPES = {
    "types.InputInvoiceStarGift": lambda: getattr(types, "InputInvoiceStarGift", None),
    "types.InputInvoiceStarGiftTransfer": lambda: getattr(types, "InputInvoiceStarGiftTransfer", None),
    "types.InputSavedStarGiftSlug": lambda: getattr(types, "InputSavedStarGiftSlug", None),
    "functions.payments.CheckCanSendGiftRequest": lambda: getattr(functions.payments, "CheckCanSendGiftRequest", None),
    "functions.payments.SendStarsFormRequest": lambda: getattr(functions.payments, "SendStarsFormRequest", None),
}


def ensure_userbot_tl_support() -> None:
    missing = [name for name, resolver in _REQUIRED_GIFT_TL_TYPES.items() if resolver() is None]
    if missing:
        joined = ", ".join(missing)
        raise RuntimeError(
            "Installed Telethon TL layer is too old for Telegram Gifts userbot support. "
            f"Missing: {joined}. Upgrade to Telethon 1.42.0+."
        )


class UserbotClientManager:
    def __init__(self) -> None:
        self._client: TelegramClient | None = None
        self._lock = asyncio.Lock()
        self._handlers_registered = False

    def _build_client(self) -> TelegramClient:
        ensure_userbot_tl_support()
        session_path = Path(settings.USERBOT_SESSION_PATH)
        session_path.parent.mkdir(parents=True, exist_ok=True)
        session = SQLiteSession(str(session_path))
        return TelegramClient(session, settings.USERBOT_API_ID, settings.USERBOT_API_HASH)

    def _register_handlers(self, client: TelegramClient) -> None:
        if self._handlers_registered:
            return

        @client.on(events.NewMessage(incoming=True))
        async def _capture_known_peer(event) -> None:
            sender = await event.get_sender()
            if sender is None:
                return
            access_hash = extract_access_hash(sender)
            sender_id = getattr(sender, "id", None)
            if access_hash is None or sender_id is None:
                return
            username = getattr(sender, "username", None)
            await persist_userbot_peer_by_telegram_id(
                telegram_id=int(sender_id),
                access_hash=access_hash,
                username=username,
            )

        self._handlers_registered = True

    async def connect(self) -> TelegramClient:
        async with self._lock:
            if self._client is None:
                self._client = self._build_client()
                self._register_handlers(self._client)
            if not self._client.is_connected():
                await self._client.connect()
            return self._client

    async def disconnect(self) -> None:
        async with self._lock:
            if self._client is not None and self._client.is_connected():
                await self._client.disconnect()

    async def is_authorized(self) -> bool:
        try:
            client = await self.connect()
            return bool(await client.is_user_authorized())
        except Exception:
            logger.exception("userbot_client: failed to check authorization state")
            return False

    async def is_connected(self) -> bool:
        async with self._lock:
            return self._client is not None and self._client.is_connected()


userbot_client = UserbotClientManager()
