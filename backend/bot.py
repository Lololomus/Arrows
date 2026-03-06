"""
Arrow Puzzle - Telegram Bot

Bot handlers + background personal spin notifications.
"""

import asyncio
import html
import logging
import os
import sys
from datetime import datetime, timedelta, timezone

from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from sqlalchemy import select

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from app.config import settings
from app.database import AsyncSessionLocal, close_redis
from app.models import User
from app.services.ad_rewards import utcnow
from app.services.bot_notifications import notify_spin_ready, notify_spin_streak_reset, notify_streak_warning
from app.services.referrals import extract_referral_code, store_pending_referral_code

SPIN_READY_DELAY = timedelta(hours=24)
STREAK_WARNING_DELAY = timedelta(hours=42)
STREAK_RESET_DELAY = timedelta(hours=48)
NOTIFICATIONS_SWEEP_INTERVAL_SECONDS = 60


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
dp = Dispatcher()


def get_player_name(user: types.User) -> str:
    if user.username:
        return user.username
    return user.first_name or "player"


def build_welcome_text(user: types.User) -> str:
    player_name = html.escape(get_player_name(user))
    return (
        f"Hi, <b>{player_name}</b>!\n\n"
        "ArrowReward is a puzzle game with rewards.\n"
        "Pass levels, earn coins, and climb leaderboard.\n\n"
        "Tap the button below to start."
    )


def build_start_keyboard(webapp_url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Launch ArrowReward",
                    web_app=WebAppInfo(url=webapp_url),
                )
            ],
            [
                InlineKeyboardButton(
                    text="Info",
                    callback_data="info",
                )
            ],
        ]
    )


def build_info_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Back",
                    callback_data="back_to_start",
                )
            ],
        ]
    )


@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    """Handle /start command and open Mini App."""
    args = message.text.split()
    start_param = None

    if len(args) > 1 and args[1].startswith("ref_"):
        start_param = args[1]
        logger.info("User %s has referral: %s", message.from_user.id, start_param)
        referral_code = extract_referral_code(start_param)
        if referral_code:
            for attempt in range(3):
                try:
                    await store_pending_referral_code(
                        message.from_user.id,
                        referral_code,
                        source="polling-bot",
                    )
                    break
                except Exception as exc:
                    if attempt == 2:
                        logger.error("Referral save FAILED after 3 attempts for %s: %s", message.from_user.id, exc)
                    else:
                        logger.warning(
                            "Referral save attempt %s failed for %s: %s",
                            attempt + 1,
                            message.from_user.id,
                            exc,
                        )
                        await asyncio.sleep(0.5 * (attempt + 1))

    webapp_url = settings.WEBAPP_URL
    if start_param:
        webapp_url += f"?startapp={start_param}"

    await message.answer(
        build_welcome_text(message.from_user),
        reply_markup=build_start_keyboard(webapp_url),
        parse_mode="HTML",
    )


@dp.callback_query(lambda c: c.data == "info")
async def process_info(callback: types.CallbackQuery):
    """Handle info button."""
    await callback.message.edit_text(
        "Support: @ArrowRewardSupport",
        reply_markup=build_info_keyboard(),
        parse_mode="HTML",
    )
    await callback.answer()


@dp.callback_query(lambda c: c.data == "back_to_start")
async def process_back(callback: types.CallbackQuery):
    """Return to start card."""
    await callback.message.edit_text(
        build_welcome_text(callback.from_user),
        reply_markup=build_start_keyboard(settings.WEBAPP_URL),
        parse_mode="HTML",
    )
    await callback.answer()


@dp.message(Command("stats"))
async def cmd_stats(message: types.Message):
    """Basic bot stats placeholder."""
    stats_text = (
        f"<b>{settings.APP_NAME} stats</b>\n\n"
        "Players: ???\n"
        "Levels played: ???\n"
        "Stars earned: ???\n\n"
        "Join now: /start"
    )

    await message.answer(stats_text, parse_mode="HTML")


def _fallback_last_spin_at(user: User) -> datetime | None:
    if user.last_spin_at is not None:
        return user.last_spin_at
    if user.last_spin_date is not None:
        return datetime(
            user.last_spin_date.year,
            user.last_spin_date.month,
            user.last_spin_date.day,
        )
    return None


def _to_naive_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _already_notified(user: User, event: str, anchor_spin_at: datetime) -> bool:
    if event == "ready":
        return user.spin_ready_notified_for_spin_at == anchor_spin_at
    if event == "warning":
        return user.streak_warning_notified_for_spin_at == anchor_spin_at
    if event == "reset":
        return user.streak_reset_notified_for_spin_at == anchor_spin_at
    return False


def _mark_notification_sent(user: User, event: str, anchor_spin_at: datetime) -> None:
    if event == "ready":
        user.spin_ready_notified_for_spin_at = anchor_spin_at
    elif event == "warning":
        user.streak_warning_notified_for_spin_at = anchor_spin_at
    elif event == "reset":
        user.streak_reset_notified_for_spin_at = anchor_spin_at


async def _send_personal_spin_notifications() -> None:
    """Send due personal notifications for spin lifecycle."""
    from app.api.spin import _get_tier  # local import to avoid top-level cycle

    now = utcnow()
    sent_ready = 0
    sent_warning = 0
    sent_reset = 0

    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(User)
                .where(User.telegram_id.is_not(None))
                .where(User.is_banned == False)
                .where(User.login_streak >= 1)
            )
            users = result.scalars().all()

            for user in users:
                if user.telegram_id is None:
                    continue

                anchor = _fallback_last_spin_at(user)
                if anchor is None:
                    continue
                anchor = _to_naive_utc(anchor)

                ready_at = anchor + SPIN_READY_DELAY
                warn_at = anchor + STREAK_WARNING_DELAY
                reset_at = anchor + STREAK_RESET_DELAY

                if (
                    now >= ready_at
                    and user.pending_spin_prize_type is None
                    and not _already_notified(user, "ready", anchor)
                ):
                    delivery = await notify_spin_ready(user.telegram_id)
                    if delivery in ("sent", "blocked"):
                        _mark_notification_sent(user, "ready", anchor)
                        if delivery == "sent":
                            sent_ready += 1

                streak = int(user.login_streak or 0)
                if streak < 2:
                    continue

                if now >= warn_at and now < reset_at and not _already_notified(user, "warning", anchor):
                    delivery = await notify_streak_warning(user.telegram_id, streak, _get_tier(streak))
                    if delivery in ("sent", "blocked"):
                        _mark_notification_sent(user, "warning", anchor)
                        if delivery == "sent":
                            sent_warning += 1

                if now >= reset_at and not _already_notified(user, "reset", anchor):
                    delivery = await notify_spin_streak_reset(user.telegram_id, streak)
                    if delivery in ("sent", "blocked"):
                        _mark_notification_sent(user, "reset", anchor)
                        if delivery == "sent":
                            sent_reset += 1

            await db.commit()
    except Exception as e:
        logger.error("personal notifications: sweep failed: %s", e)
        return

    logger.info(
        "personal notifications: sent ready=%d warning=%d reset=%d",
        sent_ready,
        sent_warning,
        sent_reset,
    )


async def personal_notifications_scheduler() -> None:
    """Background loop: checks due notifications every minute."""
    while True:
        started = datetime.now(timezone.utc)
        try:
            await _send_personal_spin_notifications()
        except Exception as e:
            logger.error("personal notifications scheduler error: %s", e)
        elapsed = (datetime.now(timezone.utc) - started).total_seconds()
        await asyncio.sleep(max(5, NOTIFICATIONS_SWEEP_INTERVAL_SECONDS - elapsed))


async def main():
    """Start bot polling + background notification scheduler."""
    logger.info("Starting %s bot", settings.APP_NAME)
    logger.info("Web app URL: %s", settings.WEBAPP_URL)

    await bot.delete_webhook(drop_pending_updates=True)

    asyncio.create_task(personal_notifications_scheduler())

    logger.info("Bot is running")
    try:
        await dp.start_polling(bot)
    finally:
        await close_redis()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Bot stopped")
