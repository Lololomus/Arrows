"""
Manual NFT gift admin notification service.

Отправляет уведомление всем админам (ADMIN_TELEGRAM_ID) когда создаётся
UserbotGiftOrder и USERBOT_ENABLED=False — админ вручную отправляет подарок
получателю через свой Telegram-аккаунт и подтверждает/отменяет через кнопки.

TODO: УДАЛИТЬ ЭТОТ ФАЙЛ когда будут получены USERBOT_API_ID и USERBOT_API_HASH,
      установить USERBOT_ENABLED=True в .env — userbot_processor_loop будет
      обрабатывать заказы автоматически без участия администраторов.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from aiogram import Bot
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import UserbotGiftOrder, User
from .admin_stars_topup import get_admin_telegram_ids

logger = logging.getLogger(__name__)

GIFT_CONFIRM_PREFIX = "gift_confirm"
GIFT_FAIL_PREFIX = "gift_fail"


def _build_keyboard(order_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="✅ Отправил", callback_data=f"{GIFT_CONFIRM_PREFIX}:{order_id}"),
        InlineKeyboardButton(text="❌ Отменить", callback_data=f"{GIFT_FAIL_PREFIX}:{order_id}"),
    ]])


def _build_message(order: UserbotGiftOrder, user: User) -> str:
    op = order.operation_type
    recipient = f"@{user.username}" if user.username else f"#{user.first_name or '—'}"
    tg_id = order.recipient_telegram_id

    if op == "send_gift":
        gift_detail = f"telegram_gift_id = <code>{order.telegram_gift_id}</code>"
    else:
        gift_detail = f"owned_gift_slug = <code>{order.owned_gift_slug}</code>"

    stars = f"{order.star_cost_estimate} ⭐" if order.star_cost_estimate else "неизвестно"

    return (
        f"🎁 <b>Новый NFT-подарок (заказ #{order.id})</b>\n\n"
        f"Операция: <code>{op}</code>\n"
        f"Получатель: {recipient} (TG ID: <code>{tg_id}</code>)\n"
        f"Подарок: {gift_detail}\n"
        f"Стоимость: {stars}\n"
        f"Источник: <code>{order.source_kind}</code> → <code>{order.source_ref}</code>\n\n"
        f"Отправь подарок вручную и подтверди:"
    )


async def notify_admins_of_order(bot: Bot, db: AsyncSession, order_id: int) -> None:
    """Отправить уведомление всем админам о новом pending-заказе.

    Устанавливает admin_notified_at после успешной отправки хотя бы одному админу.
    """
    order = await db.get(UserbotGiftOrder, order_id)
    if not order:
        logger.warning("notify_admins_of_order: order %d not found", order_id)
        return

    user_result = await db.execute(select(User).where(User.id == order.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        logger.warning("notify_admins_of_order: user for order %d not found", order_id)
        return

    admin_ids = get_admin_telegram_ids()
    if not admin_ids:
        logger.warning("notify_admins_of_order: no admin IDs configured (ADMIN_TELEGRAM_ID is empty)")
        return

    text = _build_message(order, user)
    keyboard = _build_keyboard(order_id)

    sent_count = 0
    for admin_id in admin_ids:
        try:
            await bot.send_message(
                chat_id=admin_id,
                text=text,
                parse_mode="HTML",
                reply_markup=keyboard,
            )
            sent_count += 1
        except Exception as exc:
            logger.error("notify_admins_of_order: failed to notify admin %d: %s", admin_id, exc)

    if sent_count > 0:
        order.admin_notified_at = datetime.now(timezone.utc)
        await db.commit()
        logger.info("notify_admins_of_order: notified %d admin(s) about order #%d", sent_count, order_id)
    else:
        logger.error("notify_admins_of_order: failed to notify ANY admin about order #%d", order_id)
