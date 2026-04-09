#!/usr/bin/env python3
"""
Broadcast: USDT sector added to spin wheel.

Sends two messages to the official Telegram channel (RU then EN).
Run once after deploying the USDT wheel feature:

    cd backend && python ../scripts/broadcast_usdt_wheel.py
"""
import asyncio
import os
import sys
import logging

script_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.join(script_dir, "..", "backend")
sys.path.insert(0, backend_dir)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("broadcast_usdt_wheel")


async def run() -> None:
    from app.config import settings
    from app.services.bot_notifications import broadcast_usdt_wheel_launch

    channel_id = settings.OFFICIAL_CHANNEL_ID or settings.OFFICIAL_CHANNEL_USERNAME
    if not channel_id:
        logger.error("OFFICIAL_CHANNEL_ID / OFFICIAL_CHANNEL_USERNAME is not set in .env")
        sys.exit(1)

    logger.info("Sending broadcast to channel: %s", channel_id)
    await broadcast_usdt_wheel_launch(channel_id)
    logger.info("Done.")


if __name__ == "__main__":
    asyncio.run(run())
