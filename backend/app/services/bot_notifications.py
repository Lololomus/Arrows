"""
Arrow Puzzle - Bot Notifications

Telegram notification sender service used by background jobs.
"""

import logging
from typing import Literal

from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

from ..config import settings

logger = logging.getLogger(__name__)

_bot: Bot | None = None
NotificationDelivery = Literal["sent", "blocked", "failed"]


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
    return {0: "Tier 1", 1: "Tier 2", 2: "Tier 3"}.get(tier, "Tier 1")


async def notify_spin_ready(telegram_id: int) -> NotificationDelivery:
    """Notification: spin is available again (24h cooldown completed)."""
    text = (
        "🎰 <b>Рулетка снова доступна!</b>\n\n"
        "Прошло 24 часа — самое время крутить.\n"
        "Не прерывай серию 🔥"
    )
    try:
        await _get_bot().send_message(
            chat_id=telegram_id,
            text=text,
            parse_mode="HTML",
            reply_markup=_spin_keyboard(),
        )
        return "sent"
    except (TelegramForbiddenError, TelegramBadRequest):
        return "blocked"
    except Exception as e:
        logger.warning("Failed to send spin-ready notification to %s: %s", telegram_id, e)
        return "failed"


async def notify_spin_streak_reset(telegram_id: int, old_streak: int) -> NotificationDelivery:
    """Notification: streak has been reset after missing the window."""
    text = (
        f"💔 <b>Серия прервана</b>\n\n"
        f"Пропустил день — серия сброшена (была: <b>{old_streak} дн.</b>).\n\n"
        "Возвращайся каждый день — чем длиннее серия, тем круче призы."
    )
    try:
        await _get_bot().send_message(
            chat_id=telegram_id,
            text=text,
            parse_mode="HTML",
            reply_markup=_spin_keyboard(),
        )
        return "sent"
    except (TelegramForbiddenError, TelegramBadRequest):
        return "blocked"
    except Exception as e:
        logger.warning("Failed to send streak reset notification to %s: %s", telegram_id, e)
        return "failed"


async def notify_streak_warning(telegram_id: int, streak: int, tier: int) -> NotificationDelivery:
    """Notification: streak will reset in ~6 hours."""
    tier_name = _tier_name(tier)
    text = (
        f"⏰ <b>Серия {streak} дн. сгорит через ~6 часов</b>\n\n"
        f"Не теряй <b>{tier_name}</b> — зайди и крути пока не поздно."
    )
    try:
        await _get_bot().send_message(
            chat_id=telegram_id,
            text=text,
            parse_mode="HTML",
            reply_markup=_spin_keyboard(),
        )
        return "sent"
    except (TelegramForbiddenError, TelegramBadRequest):
        return "blocked"
    except Exception as e:
        logger.warning("Failed to send streak warning to %s: %s", telegram_id, e)
        return "failed"
