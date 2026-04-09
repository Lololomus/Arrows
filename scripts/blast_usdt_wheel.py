#!/usr/bin/env python3
"""
One-time blast: USDT sector added to spin wheel.

Sends a personal bot message to every non-banned user.
Safe to re-run: skips users where usdt_blast_sent = true.

Deploy & run:
    docker cp scripts/blast_usdt_wheel.py arrow_backend:/tmp/
    docker exec -e PYTHONPATH=/app -w /app arrow_backend python /tmp/blast_usdt_wheel.py
"""
import asyncio
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("blast_usdt_wheel")

BATCH_SIZE = 100
SEND_DELAY = 0.04  # ~25 msgs/sec — under Telegram's 30/sec limit


async def run() -> None:
    from sqlalchemy import select, update
    from app.database import AsyncSessionLocal
    from app.models import User
    from app.services.bot_notifications import notify_usdt_wheel_launch

    sent = 0
    blocked = 0
    failed = 0

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User.id).where(User.usdt_blast_sent == False, User.is_banned == False)  # noqa: E712
        )
        pending_ids = [row[0] for row in result.fetchall()]

    total = len(pending_ids)
    logger.info("Users to notify: %d", total)

    if total == 0:
        logger.info("Nothing to send. All users already notified.")
        return

    for i in range(0, total, BATCH_SIZE):
        batch_ids = pending_ids[i:i + BATCH_SIZE]

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(User.id, User.telegram_id, User.locale).where(User.id.in_(batch_ids))
            )
            users = result.fetchall()

        for user_id, telegram_id, locale in users:
            delivery = await notify_usdt_wheel_launch(telegram_id, locale)

            if delivery in ("sent", "blocked"):
                async with AsyncSessionLocal() as db:
                    await db.execute(
                        update(User).where(User.id == user_id).values(usdt_blast_sent=True)
                    )
                    await db.commit()

            if delivery == "sent":
                sent += 1
            elif delivery == "blocked":
                blocked += 1
            else:
                failed += 1

            await asyncio.sleep(SEND_DELAY)

        logger.info(
            "Progress: %d/%d — sent=%d blocked=%d failed=%d",
            min(i + BATCH_SIZE, total), total, sent, blocked, failed,
        )

    logger.info("Done. Total=%d sent=%d blocked=%d failed=%d", total, sent, blocked, failed)


if __name__ == "__main__":
    asyncio.run(run())
