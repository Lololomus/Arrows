"""
Arrow Puzzle - Telegram Bot

Обработчик команд бота и точка входа в Mini App.
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
from app.services.bot_notifications import notify_spin_streak_reset, notify_streak_warning
from app.services.referrals import extract_referral_code, store_pending_referral_code

MSK = timezone(timedelta(hours=3))


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)


bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
dp = Dispatcher()


def get_player_name(user: types.User) -> str:
    if user.username:
        return user.username
    return user.first_name or "игрок"


def build_welcome_text(user: types.User) -> str:
    player_name = html.escape(get_player_name(user))
    return (
        f"Привет, <b>{player_name}</b>! 👋\n\n"
        "ArrowReward – это увлекательная логическая головоломка, "
        "которая награждает своих игроков. 🏆\n\n"
        "Как играть: 🕹️\n"
        "• Нажми на стрелку и она полетит;\n"
        "• Избегай столкновений;\n"
        "• Проходи уровни и соревнуйся с друзьями!\n\n"
        "Получай монеты за игру. 💰\n"
        "Поднимайся в топ и забирай призы. 🥇\n\n"
        "Нажми кнопку ниже, чтобы начать! 👇"
    )


def build_start_keyboard(webapp_url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Запустить ArrowReward",
                    web_app=WebAppInfo(url=webapp_url),
                )
            ],
            [
                InlineKeyboardButton(
                    text="ℹ️ Инфо",
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
                    text="Назад",
                    callback_data="back_to_start",
                )
            ],
        ]
    )


@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    """
    Обработчик /start команды.
    Открывает Web App игры.
    """
    args = message.text.split()
    start_param = None

    if len(args) > 1 and args[1].startswith("ref_"):
        start_param = args[1]
        logger.info(f"User {message.from_user.id} has referral: {start_param}")
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
                        logger.error(f"Referral save FAILED after 3 attempts for {message.from_user.id}: {exc}")
                    else:
                        logger.warning(f"Referral save attempt {attempt + 1} failed for {message.from_user.id}: {exc}")
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
    """Обработчик кнопки 'Инфо'."""
    await callback.message.edit_text(
        "Обратная связь и поддержка:\n\n@ArrowRewardSupport",
        reply_markup=build_info_keyboard(),
        parse_mode="HTML",
    )
    await callback.answer()


@dp.callback_query(lambda c: c.data == "back_to_start")
async def process_back(callback: types.CallbackQuery):
    """Возврат к стартовому сообщению."""
    await callback.message.edit_text(
        build_welcome_text(callback.from_user),
        reply_markup=build_start_keyboard(settings.WEBAPP_URL),
        parse_mode="HTML",
    )
    await callback.answer()


@dp.message(Command("stats"))
async def cmd_stats(message: types.Message):
    """Статистика бота."""
    stats_text = (
        f"<b>Статистика {settings.APP_NAME}</b>\n\n"
        "Игроков: ???\n"
        "Сыграно уровней: ???\n"
        "Получено звезд: ???\n\n"
        "Присоединяйся! /start"
    )

    await message.answer(stats_text, parse_mode="HTML")


async def _send_streak_notifications() -> None:
    """Рассылка двух типов уведомлений в 18:00 MSK:
    - warn: стрик цел (last_spin == вчера), но сегодня ещё не крутили
    - expired: стрик уже сгорел (last_spin == позавчера, пропустили вчера)
    """
    from app.api.spin import _get_tier  # local import to avoid top-level cycle

    today = datetime.now(MSK).date()
    yesterday = today - timedelta(days=1)
    two_days_ago = today - timedelta(days=2)

    try:
        async with AsyncSessionLocal() as db:
            warn_result = await db.execute(
                select(User.telegram_id, User.login_streak)
                .where(User.login_streak >= 2)
                .where(User.last_spin_date == yesterday)
                .where(User.is_banned == False)
            )
            warn_users = warn_result.fetchall()

            expired_result = await db.execute(
                select(User.telegram_id, User.login_streak)
                .where(User.login_streak >= 2)
                .where(User.last_spin_date == two_days_ago)
                .where(User.is_banned == False)
            )
            expired_users = expired_result.fetchall()
    except Exception as e:
        logger.error("streak notifications: DB query failed: %s", e)
        return

    logger.info("streak notifications: %d warnings, %d expired", len(warn_users), len(expired_users))

    for telegram_id, streak in warn_users:
        await notify_streak_warning(telegram_id, streak, _get_tier(streak))

    for telegram_id, streak in expired_users:
        await notify_spin_streak_reset(telegram_id, streak)


async def streak_warning_scheduler() -> None:
    """Фоновый loop: ждёт 18:00 MSK и рассылает предупреждения (за 6ч до сброса)."""
    while True:
        now = datetime.now(MSK)
        next_18 = now.replace(hour=18, minute=0, second=0, microsecond=0)
        if now >= next_18:
            next_18 += timedelta(days=1)
        wait_seconds = (next_18 - now).total_seconds()
        logger.info("streak warning scheduler: next run in %.0f seconds", wait_seconds)
        await asyncio.sleep(wait_seconds)
        try:
            await _send_streak_notifications()
        except Exception as e:
            logger.error("streak warning scheduler error: %s", e)


async def main():
    """Запуск бота."""
    logger.info(f"Starting {settings.APP_NAME} Bot...")
    logger.info(f"Web App URL: {settings.WEBAPP_URL}")

    await bot.delete_webhook(drop_pending_updates=True)

    asyncio.create_task(streak_warning_scheduler())

    logger.info("Bot is running!")
    try:
        await dp.start_polling(bot)
    finally:
        await close_redis()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Bot stopped")
