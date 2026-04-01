from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError
from telethon.sessions import SQLiteSession


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


async def _main() -> None:
    api_id = int(_require_env("USERBOT_API_ID"))
    api_hash = _require_env("USERBOT_API_HASH")
    phone = _require_env("USERBOT_PHONE")
    session_path = os.getenv("USERBOT_SESSION_PATH", "/app/sessions/userbot.session")

    session_file = Path(session_path)
    session_file.parent.mkdir(parents=True, exist_ok=True)

    client = TelegramClient(SQLiteSession(str(session_file)), api_id, api_hash)
    await client.connect()

    try:
        if await client.is_user_authorized():
            print(f"Userbot session is already authorized: {session_file}")
            return

        sent = await client.send_code_request(phone)
        code = input("Enter the Telegram login code: ").strip()
        try:
            await client.sign_in(phone=phone, code=code, phone_code_hash=sent.phone_code_hash)
        except SessionPasswordNeededError:
            password = input("Enter the 2FA password: ").strip()
            await client.sign_in(password=password)

        if not await client.is_user_authorized():
            raise RuntimeError("Authorization did not complete successfully")

        print(f"Userbot session created: {session_file}")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(_main())
