"""
Broadcast: Daily task available announcement.

Run when the daily AdsGram task resets (e.g. each morning at 09:00 MSK):
    cd backend && python scripts/broadcast_daily_task.py

Sends the daily-task message to every non-banned user who has a telegram_id.
Respects Telegram rate limits (30 msg/s) with a small sleep between batches.
"""

import asyncio
import logging
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import User
from app.services.bot_notifications import notify_daily_task_available

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

BATCH_SIZE = 25       # messages per batch
BATCH_SLEEP = 1.0     # seconds between batches (~25 msg/s, safely under 30)


async def broadcast() -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User.telegram_id, User.locale)
            .where(User.telegram_id.is_not(None))
            .where(User.is_banned == False)
        )
        rows = result.all()

    total = len(rows)
    logger.info("Broadcasting daily-task notification to %d users", total)

    sent = blocked = failed = 0

    for i, (telegram_id, locale) in enumerate(rows, start=1):
        delivery = await notify_daily_task_available(telegram_id, locale)
        if delivery == "sent":
            sent += 1
        elif delivery == "blocked":
            blocked += 1
        else:
            failed += 1

        if i % BATCH_SIZE == 0:
            logger.info("Progress: %d/%d — sent=%d blocked=%d failed=%d", i, total, sent, blocked, failed)
            await asyncio.sleep(BATCH_SLEEP)

    logger.info(
        "Broadcast complete. total=%d sent=%d blocked=%d failed=%d",
        total, sent, blocked, failed,
    )


if __name__ == "__main__":
    asyncio.run(broadcast())
