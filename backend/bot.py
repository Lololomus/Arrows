"""
Arrow Puzzle - Telegram Bot

Обработчик команд бота и точка входа в Mini App.
"""

import asyncio
import html
import logging
import os
import sys

from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from app.config import settings
from app.database import close_redis
from app.services.referrals import extract_referral_code, store_pending_referral_code


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
                    text=f"Запустить {settings.APP_NAME}",
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
            try:
                await store_pending_referral_code(
                    message.from_user.id,
                    referral_code,
                    source="polling-bot",
                )
            except Exception as exc:
                logger.warning(f"Referral fallback save failed for {message.from_user.id}: {exc}")

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


async def main():
    """Запуск бота."""
    logger.info(f"Starting {settings.APP_NAME} Bot...")
    logger.info(f"Web App URL: {settings.WEBAPP_URL}")

    await bot.delete_webhook(drop_pending_updates=True)

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
