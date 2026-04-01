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
from .i18n import bot_text, normalize_locale

logger = logging.getLogger(__name__)

_bot: Bot | None = None
NotificationDelivery = Literal["sent", "blocked", "failed"]


def _get_bot() -> Bot:
    global _bot
    if _bot is None:
        _bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
    return _bot


def _spin_keyboard(locale: str | None) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[
            InlineKeyboardButton(
                text=bot_text("spin_button", locale),
                web_app=WebAppInfo(url=settings.WEBAPP_URL),
            )
        ]]
    )


def _tier_name(tier: int) -> str:
    return {0: "Tier 1", 1: "Tier 2", 2: "Tier 3"}.get(tier, "Tier 1")


async def notify_spin_ready(telegram_id: int, locale: str | None = None) -> NotificationDelivery:
    """Notification: spin is available again (24h cooldown completed)."""
    locale = normalize_locale(locale)
    text = bot_text("spin_ready", locale)
    try:
        await _get_bot().send_message(
            chat_id=telegram_id,
            text=text,
            parse_mode="HTML",
            reply_markup=_spin_keyboard(locale),
        )
        return "sent"
    except (TelegramForbiddenError, TelegramBadRequest):
        return "blocked"
    except Exception as e:
        logger.warning("Failed to send spin-ready notification to %s: %s", telegram_id, e)
        return "failed"


async def notify_spin_streak_reset(telegram_id: int, old_streak: int, locale: str | None = None) -> NotificationDelivery:
    """Notification: streak has been reset after missing the window."""
    locale = normalize_locale(locale)
    text = bot_text("spin_streak_reset", locale, old_streak=old_streak)
    try:
        await _get_bot().send_message(
            chat_id=telegram_id,
            text=text,
            parse_mode="HTML",
            reply_markup=_spin_keyboard(locale),
        )
        return "sent"
    except (TelegramForbiddenError, TelegramBadRequest):
        return "blocked"
    except Exception as e:
        logger.warning("Failed to send streak reset notification to %s: %s", telegram_id, e)
        return "failed"


async def notify_streak_warning(telegram_id: int, streak: int, tier: int, locale: str | None = None) -> NotificationDelivery:
    """Notification: streak will reset in ~6 hours."""
    locale = normalize_locale(locale)
    tier_name = _tier_name(tier)
    text = bot_text("spin_streak_warning", locale, streak=streak, tier_name=tier_name)
    try:
        await _get_bot().send_message(
            chat_id=telegram_id,
            text=text,
            parse_mode="HTML",
            reply_markup=_spin_keyboard(locale),
        )
        return "sent"
    except (TelegramForbiddenError, TelegramBadRequest):
        return "blocked"
    except Exception as e:
        logger.warning("Failed to send streak warning to %s: %s", telegram_id, e)
        return "failed"
