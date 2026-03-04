"""
Arrow Puzzle - Bot Notifications

Сервис отправки Telegram-уведомлений из API (без циклического импорта).
Создаёт собственный Bot-инстанс только для отправки сообщений.
"""

import logging

from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

from ..config import settings

logger = logging.getLogger(__name__)

_bot: Bot | None = None


def _get_bot() -> Bot:
    global _bot
    if _bot is None:
        _bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
    return _bot


def _spin_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[
            InlineKeyboardButton(
                text="🎰 Крутить рулетку",
                web_app=WebAppInfo(url=settings.WEBAPP_URL),
            )
        ]]
    )


def _tier_name(tier: int) -> str:
    return {0: "Тир 1", 1: "Тир 2", 2: "Тир 3"}.get(tier, "Тир 1")


async def notify_spin_streak_reset(telegram_id: int, old_streak: int) -> None:
    """Уведомление: стрик сгорел после пропуска дня."""
    text = (
        f"😔 <b>Стрик сгорел</b>\n\n"
        f"Ты пропустил день и стрик сбросился (был: <b>{old_streak} дней</b>).\n\n"
        f"Возвращайся каждый день, чтобы получать лучшие призы!"
    )
    try:
        await _get_bot().send_message(
            chat_id=telegram_id,
            text=text,
            parse_mode="HTML",
            reply_markup=_spin_keyboard(),
        )
    except (TelegramForbiddenError, TelegramBadRequest):
        pass  # Бот заблокирован или чат не найден
    except Exception as e:
        logger.warning("Failed to send streak reset notification to %s: %s", telegram_id, e)


async def notify_streak_warning(telegram_id: int, streak: int, tier: int) -> None:
    """Уведомление: стрик сгорит через 6 часов (рассылка в 18:00 MSK)."""
    tier_name = _tier_name(tier)
    text = (
        f"⚠️ <b>Стрик {streak} дней сгорит через 6 часов!</b>\n\n"
        f"Ты ещё не крутил рулетку сегодня.\n"
        f"До полуночи осталось ~6 часов — не теряй <b>{tier_name}</b>!\n\n"
        f"Потеряешь стрик — призы станут хуже 💎"
    )
    try:
        await _get_bot().send_message(
            chat_id=telegram_id,
            text=text,
            parse_mode="HTML",
            reply_markup=_spin_keyboard(),
        )
    except (TelegramForbiddenError, TelegramBadRequest):
        pass
    except Exception as e:
        logger.warning("Failed to send streak warning to %s: %s", telegram_id, e)
