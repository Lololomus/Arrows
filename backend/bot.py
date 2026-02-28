"""
Arrow Puzzle - Telegram Bot

Обработчик команд бота и точка входа в Mini App.
"""

import asyncio
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


def build_start_keyboard(webapp_url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=f"Играть в {settings.APP_NAME}",
                    web_app=WebAppInfo(url=webapp_url),
                )
            ],
            [
                InlineKeyboardButton(
                    text="Как играть",
                    callback_data="help",
                )
            ],
        ]
    )


def build_help_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Играть",
                    web_app=WebAppInfo(url=settings.WEBAPP_URL),
                )
            ],
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

    welcome_text = (
        f"Привет, {message.from_user.first_name}!\n\n"
        f"<b>{settings.APP_NAME}</b> — увлекательная логическая головоломка!\n\n"
        f"<b>Как играть:</b>\n"
        f"• Убирай стрелки в правильном порядке\n"
        f"• Избегай столкновений\n"
        f"• Используй спецстрелки мудро\n"
        f"• Соревнуйся с друзьями!\n\n"
        f"Зарабатывай монеты и открывай новые скины\n"
        f"Поднимайся в топ лидерборда\n\n"
        f"Нажми кнопку ниже, чтобы начать!"
    )

    if start_param:
        welcome_text += "\n\nУ тебя есть реферальный бонус!"

    await message.answer(
        welcome_text,
        reply_markup=build_start_keyboard(webapp_url),
        parse_mode="HTML",
    )


@dp.callback_query(lambda c: c.data == "help")
async def process_help(callback: types.CallbackQuery):
    """Обработчик кнопки 'Как играть'."""
    help_text = (
        f"<b>Как играть в {settings.APP_NAME}</b>\n\n"
        "<b>Цель:</b>\n"
        "Убрать все стрелки с поля\n\n"
        "<b>Правила:</b>\n"
        "• Стрелка улетает в направлении, куда смотрит\n"
        "• Нельзя убирать стрелку, если на её пути есть другая\n"
        "• У тебя есть 3 жизни\n"
        "• За каждую ошибку теряешь 1 жизнь\n\n"
        "<b>Спецстрелки:</b>\n"
        "• Ледяная — сначала разморозить, потом убрать\n"
        "• Жизнь+ — дарит дополнительную жизнь\n"
        "• Жизнь- — отнимает 2 жизни при ошибке\n"
        "• Бомба — взрывает соседние стрелки\n"
        "• Молния — убирает случайную стрелку\n\n"
        "<b>Звезды:</b>\n"
        "3 — без ошибок\n"
        "2 — 1 ошибка\n"
        "1 — 2+ ошибки\n\n"
        "<b>Подсказки:</b>\n"
        "Используй кнопку подсказки, чтобы увидеть безопасную стрелку\n\n"
        "Удачи!"
    )

    await callback.message.edit_text(
        help_text,
        reply_markup=build_help_keyboard(),
        parse_mode="HTML",
    )
    await callback.answer()


@dp.callback_query(lambda c: c.data == "back_to_start")
async def process_back(callback: types.CallbackQuery):
    """Возврат к стартовому сообщению."""
    welcome_text = (
        f"Привет, {callback.from_user.first_name}!\n\n"
        f"<b>{settings.APP_NAME}</b> — увлекательная логическая головоломка!\n\n"
        f"Нажми кнопку ниже, чтобы начать!"
    )

    await callback.message.edit_text(
        welcome_text,
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
