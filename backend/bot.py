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

from aiogram import Bot, Dispatcher, F, types
from aiogram.filters import Command
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, LabeledPrice, WebAppInfo
from sqlalchemy import select

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from app.config import settings
from app.database import AsyncSessionLocal, close_redis, get_redis
from app.models import Transaction, User, StarsWithdrawal
from app.services.ad_rewards import utcnow
from app.services.admin_stars_topup import (
    ADMIN_TOPUP_PACKS,
    build_admin_topup_payload,
    get_admin_telegram_id,
    is_admin_telegram_id,
    normalize_topup_amount,
    parse_admin_topup_payload,
    record_admin_stars_topup,
    validate_admin_topup_checkout,
)
from app.services.case_logic import (
    CASE_RESULT_REDIS_TTL_SECONDS,
    create_stars_case_purchase,
    serialize_case_result,
)
from app.services.bot_notifications import notify_spin_ready, notify_spin_streak_reset, notify_streak_warning
from app.services.i18n import bot_text, normalize_locale
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
    locale = normalize_locale(getattr(user, "language_code", None))
    return user.first_name or bot_text("player_name_fallback", locale)


def build_welcome_text(user: types.User) -> str:
    locale = normalize_locale(getattr(user, "language_code", None))
    player_name = html.escape(get_player_name(user))
    return bot_text("start_text", locale, player_name=player_name)


def build_start_keyboard(webapp_url: str, locale: str | None) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=bot_text("start_button", locale),
                    web_app=WebAppInfo(url=webapp_url),
                )
            ],
            [
                InlineKeyboardButton(
                    text=bot_text("info_button", locale),
                    callback_data="info",
                )
            ],
        ]
    )


def build_info_keyboard(locale: str | None) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=bot_text("back_button", locale),
                    callback_data="back_to_start",
                )
            ],
        ]
    )


def build_admin_topup_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=f"{amount} Stars",
                    callback_data=f"admin_topup_select:{amount}",
                )
            ]
            for amount in ADMIN_TOPUP_PACKS
        ]
    )


async def send_admin_topup_invoice(chat_id: int, amount: int) -> None:
    await bot.send_invoice(
        chat_id=chat_id,
        title="Gift fund top-up",
        description=f"Top up the bot Stars balance by {amount} Stars.",
        payload=build_admin_topup_payload(amount),
        currency="XTR",
        prices=[LabeledPrice(label="Gift fund", amount=amount)],
    )


def parse_topup_amount_from_command(text: str | None) -> int | None:
    if not text:
        return None

    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        return None

    return normalize_topup_amount(parts[1])


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
    locale = normalize_locale(getattr(message.from_user, "language_code", None))

    await message.answer(
        build_welcome_text(message.from_user),
        reply_markup=build_start_keyboard(webapp_url, locale),
        parse_mode="HTML",
    )


@dp.callback_query(lambda c: c.data == "info")
async def process_info(callback: types.CallbackQuery):
    """Handle info button."""
    locale = normalize_locale(getattr(callback.from_user, "language_code", None))
    await callback.message.edit_text(
        bot_text("info_text", locale),
        reply_markup=build_info_keyboard(locale),
        parse_mode="HTML",
    )
    await callback.answer()


@dp.callback_query(lambda c: c.data == "back_to_start")
async def process_back(callback: types.CallbackQuery):
    """Return to start card."""
    locale = normalize_locale(getattr(callback.from_user, "language_code", None))
    await callback.message.edit_text(
        build_welcome_text(callback.from_user),
        reply_markup=build_start_keyboard(settings.WEBAPP_URL, locale),
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


@dp.message(Command("topup_stars"))
async def cmd_topup_stars(message: types.Message):
    """Admin-only command to top up the bot Stars balance."""
    if get_admin_telegram_id() is None:
        await message.answer("ADMIN_TELEGRAM_ID is not configured.")
        return

    if not is_admin_telegram_id(message.from_user.id if message.from_user else None):
        await message.answer("Access denied.")
        return

    amount = parse_topup_amount_from_command(message.text)
    if amount is None:
        supported = ", ".join(str(value) for value in ADMIN_TOPUP_PACKS)
        await message.answer(
            f"Choose a Stars top-up amount ({supported}) or use /topup_stars <amount>.",
            reply_markup=build_admin_topup_keyboard(),
        )
        return

    await send_admin_topup_invoice(message.chat.id, amount)


@dp.callback_query(lambda c: c.data and c.data.startswith("admin_topup_select:"))
async def process_admin_topup(callback: types.CallbackQuery):
    """Send an admin-only Stars invoice from an inline button."""
    if get_admin_telegram_id() is None:
        await callback.answer("ADMIN_TELEGRAM_ID is not configured.", show_alert=True)
        return

    if not is_admin_telegram_id(callback.from_user.id):
        await callback.answer("Access denied.", show_alert=True)
        return

    amount = normalize_topup_amount(callback.data.split(":", 1)[1] if callback.data else None)
    if amount is None:
        await callback.answer("Unsupported amount.", show_alert=True)
        return

    chat_id = callback.message.chat.id if callback.message else callback.from_user.id
    await send_admin_topup_invoice(chat_id, amount)
    await callback.answer()


@dp.callback_query(lambda c: c.data and c.data.startswith("withdrawal_confirm:"))
async def process_withdrawal_confirm(callback: types.CallbackQuery):
    """Подтвердить вывод Stars — Stars уже отправлены вручную."""
    if not is_admin_telegram_id(callback.from_user.id):
        await callback.answer("Access denied.", show_alert=True)
        return

    try:
        withdrawal_id = int(callback.data.split(":", 1)[1])
    except (ValueError, IndexError):
        await callback.answer("Invalid data.", show_alert=True)
        return

    async with AsyncSessionLocal() as db:
        withdrawal = (
            await db.execute(
                select(StarsWithdrawal)
                .where(StarsWithdrawal.id == withdrawal_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if withdrawal is None:
            await callback.answer("Заявка не найдена.", show_alert=True)
            return
        if withdrawal.status != "pending":
            await callback.answer(f"Статус уже: {withdrawal.status}", show_alert=True)
            return
        withdrawal.status = "completed"
        withdrawal.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.commit()

    if callback.message:
        await callback.message.edit_reply_markup(reply_markup=None)
        await callback.message.reply(f"✅ Вывод #{withdrawal_id} подтверждён — {withdrawal.amount} Stars отправлены.")
    await callback.answer("Подтверждено")


@dp.callback_query(lambda c: c.data and c.data.startswith("withdrawal_reject:"))
async def process_withdrawal_reject(callback: types.CallbackQuery):
    """Отклонить вывод Stars — Stars возвращаются пользователю."""
    if not is_admin_telegram_id(callback.from_user.id):
        await callback.answer("Access denied.", show_alert=True)
        return

    try:
        withdrawal_id = int(callback.data.split(":", 1)[1])
    except (ValueError, IndexError):
        await callback.answer("Invalid data.", show_alert=True)
        return

    async with AsyncSessionLocal() as db:
        withdrawal = (
            await db.execute(
                select(StarsWithdrawal)
                .where(StarsWithdrawal.id == withdrawal_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if withdrawal is None:
            await callback.answer("Заявка не найдена.", show_alert=True)
            return
        if withdrawal.status != "pending":
            await callback.answer(f"Статус уже: {withdrawal.status}", show_alert=True)
            return
        withdrawal.status = "rejected"
        withdrawal.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        user = await db.get(User, withdrawal.user_id)
        if user:
            user.stars_balance += withdrawal.amount
        await db.commit()

    if callback.message:
        await callback.message.edit_reply_markup(reply_markup=None)
        await callback.message.reply(
            f"❌ Вывод #{withdrawal_id} отклонён — {withdrawal.amount} Stars возвращены пользователю."
        )
    await callback.answer("Отклонено")


@dp.pre_checkout_query()
async def process_pre_checkout_query(pre_checkout_query: types.PreCheckoutQuery):
    """Allow checkout only for the configured admin on admin top-up invoices."""
    ok, error_message = validate_admin_topup_checkout(
        pre_checkout_query.from_user.id,
        pre_checkout_query.invoice_payload,
    )
    await bot.answer_pre_checkout_query(
        pre_checkout_query.id,
        ok=ok,
        error_message=error_message,
    )


@dp.message(F.successful_payment)
async def process_successful_payment(message: types.Message):
    """Handle successful Telegram Stars payments."""
    payment = message.successful_payment
    if payment is None:
        return

    amount = parse_admin_topup_payload(payment.invoice_payload)
    if amount is not None:
        if not is_admin_telegram_id(message.from_user.id if message.from_user else None):
            logger.warning(
                "Ignoring admin Stars top-up payment from non-admin user_id=%s",
                message.from_user.id if message.from_user else None,
            )
            return

        async with AsyncSessionLocal() as db:
            processed, new_balance = await record_admin_stars_topup(
                db,
                telegram_user_id=message.from_user.id,
                username=message.from_user.username,
                first_name=message.from_user.first_name,
                amount=amount,
                charge_id=payment.telegram_payment_charge_id or payment.provider_payment_charge_id or "",
            )

        if processed:
            await message.answer(
                f"Bot Stars balance topped up by {amount}. Current ledger balance: {new_balance}."
            )
        else:
            await message.answer(
                f"This payment was already processed. Current ledger balance: {new_balance}."
            )
        return

    if payment.invoice_payload != "case:standard":
        return

    telegram_user = message.from_user
    if telegram_user is None:
        logger.warning("Ignoring case payment without from_user payload")
        return

    charge_id = payment.telegram_payment_charge_id or payment.provider_payment_charge_id or ""

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User)
            .where(User.telegram_id == telegram_user.id)
            .with_for_update()
        )
        user = result.scalar_one_or_none()
        if user is None:
            logger.warning("Ignoring case payment for missing user telegram_id=%s", telegram_user.id)
            return

        if charge_id:
            existing = await db.execute(
                select(Transaction.id).where(
                    Transaction.currency == "stars",
                    Transaction.ton_tx_hash == charge_id,
                    Transaction.status == "completed",
                )
            )
            if existing.scalar_one_or_none() is not None:
                return

        case_result = await create_stars_case_purchase(
            user=user,
            total_amount=payment.total_amount,
            charge_id=charge_id,
            db=db,
        )
        await db.commit()

    try:
        redis = await get_redis()
        if redis is not None:
            await redis.setex(
                f"case_result:{user.id}",
                CASE_RESULT_REDIS_TTL_SECONDS,
                serialize_case_result(case_result),
            )
    except Exception:
        logger.exception("Failed to cache case result for user_id=%s", user.id)



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
                    delivery = await notify_spin_ready(user.telegram_id, user.locale)
                    if delivery in ("sent", "blocked"):
                        _mark_notification_sent(user, "ready", anchor)
                        if delivery == "sent":
                            sent_ready += 1

                streak = int(user.login_streak or 0)
                if streak < 2:
                    continue

                if now >= warn_at and now < reset_at and not _already_notified(user, "warning", anchor):
                    delivery = await notify_streak_warning(user.telegram_id, streak, _get_tier(streak), user.locale)
                    if delivery in ("sent", "blocked"):
                        _mark_notification_sent(user, "warning", anchor)
                        if delivery == "sent":
                            sent_warning += 1

                if now >= reset_at and not _already_notified(user, "reset", anchor):
                    delivery = await notify_spin_streak_reset(user.telegram_id, streak, user.locale)
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
