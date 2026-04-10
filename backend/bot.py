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
from app.services.admin_stats import (
    fetch_ads_stats,
    fetch_cases_spins_stats,
    fetch_device_stats,
    fetch_economy_stats,
    fetch_game_stats,
    fetch_referral_stats,
    fetch_seasons_stats,
    fetch_user_profile,
    fetch_users_stats,
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


_proxy_url = getattr(settings, "TELEGRAM_PROXY", "").strip() or None
if _proxy_url:
    from aiogram.client.session.aiohttp import AiohttpSession
    bot = Bot(token=settings.TELEGRAM_BOT_TOKEN, session=AiohttpSession(proxy=_proxy_url))
else:
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



# ============================================
# ADMIN STATS PANEL
# ============================================

PERIOD_LABELS = {"1d": "Сегодня", "7d": "7 дней", "30d": "30 дней", "all": "Всё время"}
SECTION_LABELS = {
    "u": "👥 Пользователи",
    "g": "🎮 Игра",
    "e": "💰 Экономика",
    "r": "🔗 Рефералы",
    "c": "🎰 Кейсы & Спины",
    "a": "📳 Реклама",
    "s": "⭐ Сезоны",
}
SECTION_FETCHERS_MAP = {}   # populated after function definitions
SECTION_FORMATTERS_MAP = {}


def _fmt(n) -> str:
    """Format integer with narrow-space thousands separator."""
    if n is None:
        return "—"
    return f"{int(n):,}".replace(",", "\u202f")


def _fmt_pct(n: float) -> str:
    return f"{n:.1f}%"


def _fmt_time(seconds: int) -> str:
    """Convert seconds → human-readable Russian duration."""
    seconds = int(seconds or 0)
    if seconds <= 0:
        return "0с"
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{h}ч {m}м"
    if m > 0:
        return f"{m}м {s}с"
    return f"{s}с"


def _fmt_ago(dt) -> str:
    """Format datetime as 'N time ago' in Russian."""
    if dt is None:
        return "—"
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    diff_sec = int((now - dt).total_seconds())
    if diff_sec < 60:
        return "только что"
    if diff_sec < 3600:
        return f"{diff_sec // 60}м назад"
    if diff_sec < 86400:
        return f"{diff_sec // 3600}ч назад"
    days = diff_sec // 86400
    if days < 30:
        return f"{days}дн назад"
    return dt.strftime("%d.%m.%Y")


def _fmt_date(dt) -> str:
    if dt is None:
        return "—"
    if hasattr(dt, "strftime"):
        return dt.strftime("%d.%m.%Y")
    return str(dt)


def _pct(part: int, total: int) -> str:
    if total == 0:
        return "0%"
    return f"{part / total * 100:.1f}%"


def _uname(username, first_name) -> str:
    if username:
        return f"@{username}"
    return first_name or "—"


# ---- Keyboard builders ----

def build_admin_main_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="👥 Пользователи", callback_data="adm:u:7d"),
                InlineKeyboardButton(text="🎮 Игра", callback_data="adm:g:7d"),
            ],
            [
                InlineKeyboardButton(text="💰 Экономика", callback_data="adm:e:7d"),
                InlineKeyboardButton(text="🔗 Рефералы", callback_data="adm:r:7d"),
            ],
            [
                InlineKeyboardButton(text="🎰 Кейсы & Спины", callback_data="adm:c:7d"),
                InlineKeyboardButton(text="📳 Реклама", callback_data="adm:a:7d"),
            ],
            [
                InlineKeyboardButton(text="⭐ Сезоны", callback_data="adm:s:all"),
            ],
            [
                InlineKeyboardButton(text="🔄 Обновить", callback_data="adm:menu"),
            ],
        ]
    )


def build_section_keyboard(section: str, current_period: str) -> InlineKeyboardMarkup:
    def _btn(p: str) -> InlineKeyboardButton:
        label = PERIOD_LABELS[p]
        if p == current_period:
            label = f"• {label}"
        return InlineKeyboardButton(text=label, callback_data=f"adm:{section}:{p}")

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [_btn("1d"), _btn("7d"), _btn("30d"), _btn("all")],
            [InlineKeyboardButton(text="← Главное меню", callback_data="adm:menu")],
        ]
    )


def build_seasons_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🔄 Обновить", callback_data="adm:s:all")],
            [InlineKeyboardButton(text="← Главное меню", callback_data="adm:menu")],
        ]
    )


# ---- Text formatters ----

def _section_header(title: str, period: str) -> str:
    p_label = PERIOD_LABELS.get(period, period)
    return f"📊 <b>ADMIN — {title}</b> [{p_label}]\n{'━' * 28}\n\n"


def _format_main_menu_text(data: dict) -> str:
    return (
        f"📊 <b>ADMIN PANEL — Arrows</b>\n{'━' * 28}\n\n"
        f"👥 Всего пользователей: <b>{_fmt(data['total'])}</b>\n"
        f"🟢 Активных (7 дней): <b>{_fmt(data['active'])}</b>\n"
        f"🆕 Новых (7 дней): <b>{_fmt(data['new'])}</b>\n\n"
        f"Выберите раздел:"
    )


def _format_device_block(device: dict) -> str:
    """
    Format device/platform statistics block.
    One user can appear in multiple platform groups (cross-device).
    Counts = unique users who ever used that platform.
    """
    from app.services.admin_stats import PLATFORM_LABELS, MOBILE_PLATFORMS

    known = device["users_with_platform"]
    mobile = device["mobile_ever"]
    desktop = device["desktop_ever"]
    cross = device["cross_device"]
    unknown = device["unknown"]
    ever = device["ever_by_platform"]
    r7 = device["recent_7d"]
    r30 = device["recent_30d"]

    mobile_7d = sum(v for k, v in r7.items() if k in MOBILE_PLATFORMS)
    desktop_7d = sum(v for k, v in r7.items() if k not in MOBILE_PLATFORMS)
    mobile_30d = sum(v for k, v in r30.items() if k in MOBILE_PLATFORMS)
    desktop_30d = sum(v for k, v in r30.items() if k not in MOBILE_PLATFORMS)

    t = "\n📱 <b>Устройства</b> <i>(уник. юзеров; один юзер может быть в обеих группах)</i>\n"
    t += f"📱 Мобильные (ever): <b>{_fmt(mobile)}</b>\n"
    t += f"🖥 Десктоп (ever): <b>{_fmt(desktop)}</b>\n"
    if cross > 0:
        t += f"🔀 Кросс-девайс (оба): <b>{_fmt(cross)}</b>\n"
    if unknown > 0:
        t += f"❓ Без платформы: <b>{_fmt(unknown)}</b>\n"

    if known > 0:
        t += f"\n  Активных за 7 дней:\n"
        t += f"  📱 {_fmt(mobile_7d)} | 🖥 {_fmt(desktop_7d)}\n"
        t += f"  Активных за 30 дней:\n"
        t += f"  📱 {_fmt(mobile_30d)} | 🖥 {_fmt(desktop_30d)}\n"

    if ever:
        t += "\n  По платформам (ever):\n"
        for pname, count in sorted(ever.items(), key=lambda x: -x[1]):
            label = PLATFORM_LABELS.get(pname, pname)
            icon = "📱" if pname in MOBILE_PLATFORMS else "🖥"
            t += f"  {icon} {label}: {_fmt(count)}\n"
    return t


def _format_users(data: dict, period: str, device: dict | None = None) -> str:
    total = data["total"]
    t = _section_header("Пользователи", period)
    t += (
        f"👥 Всего зарегистрировано: <b>{_fmt(total)}</b>\n"
        f"🆕 Новых за период: <b>{_fmt(data['new'])}</b>\n"
        f"🟢 Активных за период: <b>{_fmt(data['active'])}</b>\n"
        f"\n📋 <b>Профили</b>\n"
        f"⭐ Premium: <b>{_fmt(data['premium'])}</b> ({_pct(data['premium'], total)})\n"
        f"🚫 Забанено: <b>{_fmt(data['banned'])}</b>\n"
        f"🧪 Бета-тестеры: <b>{_fmt(data['beta'])}</b>\n"
        f"💎 TON-кошелёк: <b>{_fmt(data['with_wallet'])}</b>\n"
        f"🔗 Пришли по рефералу: <b>{_fmt(data['via_referral'])}</b>"
        f" ({_pct(data['via_referral'], total)})\n"
    )
    if device is not None:
        t += _format_device_block(device)
    return t


def _format_game(data: dict, period: str) -> str:
    t = _section_header("Игра", period)
    t += (
        f"📈 <b>Прогресс (всё время)</b>\n"
        f"🏆 Макс. уровень: <b>{_fmt(data['max_level'])}</b>\n"
        f"📊 Ср. уровень на пользователя: <b>{data['avg_level']:.1f}</b>\n"
        f"✅ Всего уровней пройдено: <b>{_fmt(data['total_levels_completed'])}</b>\n"
        f"🎯 Всего ходов: <b>{_fmt(data['total_moves'])}</b>\n"
        f"💡 Хинтов использовано: <b>{_fmt(data['total_hints_used'])}</b>\n"
        f"⏱ Суммарное время: <b>{_fmt_time(data['total_playtime_seconds'])}</b>\n"
        f"🔥 Макс. стрик (всё время): <b>{_fmt(data['max_streak_ever'])}</b>\n"
        f"\n🎮 <b>Попытки за период</b>\n"
    )
    total_att = data["total_attempts"]
    if total_att > 0:
        t += (
            f"📋 Попыток: <b>{_fmt(total_att)}</b>"
            f" (уник. игроков: {_fmt(data['unique_players'])})\n"
            f"✅ Побед: <b>{_fmt(data['wins'])}</b> ({_fmt_pct(data['win_rate'])})\n"
            f"❌ Поражений: <b>{_fmt(data['losses'])}</b>"
            f" | 🏃 Брошено: <b>{_fmt(data['abandons'])}</b>\n"
            f"⏱ Ср. время: <b>{_fmt_time(data['avg_time_sec'])}</b>"
            f" | 💔 Ср. ошибок: <b>{data['avg_mistakes']:.1f}</b>\n"
        )
    else:
        t += "Нет данных за период\n"
    return t


def _format_economy(data: dict, period: str) -> str:
    t = _section_header("Экономика", period)
    t += (
        f"💰 <b>В обороте (сейчас)</b>\n"
        f"🟡 Монет: <b>{_fmt(data['coins_circ'])}</b>\n"
        f"⭐ Stars: <b>{_fmt(data['stars_circ'])}</b>\n"
        f"💡 Хинтов: <b>{_fmt(data['hints_circ'])}</b>\n"
        f"❤️ Ревайвов: <b>{_fmt(data['revives_circ'])}</b>\n"
        f"\n💳 <b>Транзакции за период (заверш.)</b>\n"
        f"📦 Всего: <b>{_fmt(data['total_tx'])}</b>\n"
    )
    if data["total_tx"] > 0:
        t += (
            f"💎 Покупки за Stars: <b>{_fmt(data['purchases_stars'])}</b>\n"
            f"🔷 Покупки за TON: <b>{_fmt(data['purchases_ton'])}</b>\n"
            f"🟡 Покупки за монеты: <b>{_fmt(data['purchases_coins'])}</b>\n"
            f"🎁 Вознаграждения: <b>{_fmt(data['rewards_tx'])}</b>\n"
            f"🔗 Реферальные выплаты: <b>{_fmt(data['referral_tx'])}</b>\n"
        )
    p_cnt = data["withdrawals_pending_count"]
    d_cnt = data["withdrawals_done_count"]
    t += f"\n💸 <b>Выводы Stars (всё время)</b>\n"
    t += f"⏳ Ожидают: <b>{_fmt(p_cnt)}</b>"
    if p_cnt > 0:
        t += f" ({_fmt(data['withdrawals_pending_amount'])} ⭐)"
    t += "\n"
    t += f"✅ Выполнено: <b>{_fmt(d_cnt)}</b>"
    if d_cnt > 0:
        t += f" ({_fmt(data['withdrawals_done_amount'])} ⭐)"
    t += "\n"
    return t


def _format_referrals(data: dict, period: str) -> str:
    total = data["total_refs"]
    t = _section_header("Рефералы", period)
    t += (
        f"📊 Всего рефералов: <b>{_fmt(total)}</b>\n"
        f"✅ Подтверждено: <b>{_fmt(data['total_confirmed'])}</b>"
        f" ({_fmt_pct(data['confirm_rate'])})\n"
        f"⏳ Ожидают подтверждения: <b>{_fmt(data['total_pending'])}</b>\n"
        f"\n🆕 <b>За период</b>\n"
        f"Новых рефералов: <b>{_fmt(data['new_refs'])}</b>\n"
        f"Подтверждено: <b>{_fmt(data['confirmed_in_period'])}</b>\n"
        f"\n💰 Выплачено монет рефererам: <b>{_fmt(data['total_earnings'])}</b> 🟡\n"
    )
    top = data.get("top_referrers", [])
    if top:
        t += "\n🏆 <b>Топ рефереры</b>\n"
        for i, r in enumerate(top, 1):
            name = _uname(r["username"], r["first_name"])
            t += f"  {i}. {name} — {_fmt(r['count'])} реф. ({_fmt(r['earnings'])} 🟡)\n"
    return t


def _format_cases(data: dict, period: str) -> str:
    total = data["total_cases"]
    t = _section_header("Кейсы & Спины", period)
    t += f"🎰 <b>Кейсы за период</b>\n"
    t += f"Всего открыто: <b>{_fmt(total)}</b>\n"
    if total > 0:
        t += (
            f"  ⚪ Common: {_fmt(data['cases_common'])} ({_pct(data['cases_common'], total)})\n"
            f"  🔵 Rare: {_fmt(data['cases_rare'])} ({_pct(data['cases_rare'], total)})\n"
            f"  🟣 Epic: {_fmt(data['cases_epic'])} ({_pct(data['cases_epic'], total)})\n"
            f"  🌟 Epic Stars: {_fmt(data['cases_epic_stars'])} ({_pct(data['cases_epic_stars'], total)})\n"
            f"  💫 Оплата Stars: {_fmt(data['cases_paid_stars'])}"
            f" | 💎 TON: {_fmt(data['cases_paid_ton'])}\n"
            f"\n🎁 <b>Выдано из кейсов за период</b>\n"
            f"  💡 Хинты: {_fmt(data['cases_hints_given'])}"
            f" | ❤️ Ревайвы: {_fmt(data['cases_revives_given'])}\n"
            f"  🟡 Монеты: {_fmt(data['cases_coins_given'])}"
            f" | ⭐ Stars: {_fmt(data['cases_stars_given'])}\n"
        )
    t += (
        f"\n📊 <b>Pity счётчики (сейчас)</b>\n"
        f"  Средний: {data['avg_pity']:.1f} | Макс: {_fmt(data['max_pity'])}\n"
    )
    total_u = data["total_users"]
    t += (
        f"\n🌀 <b>Спины & Стрики (сейчас)</b>\n"
        f"Активных спиннеров: <b>{_fmt(data['active_spinners'])}</b>"
        f" ({_pct(data['active_spinners'], total_u)})\n"
        f"Ср. стрик: <b>{data['avg_streak']:.1f}</b> | Макс: <b>{_fmt(data['max_streak'])}</b>\n"
        f"Непобранных призов: <b>{_fmt(data['unclaimed_prizes'])}</b>\n"
        f"\n📋 <b>Распределение стриков</b>\n"
        f"  0 дней: {_fmt(data['tier0'])} ({_pct(data['tier0'], total_u)})\n"
        f"  1–5 дней: {_fmt(data['tier1'])} ({_pct(data['tier1'], total_u)})\n"
        f"  6–13 дней: {_fmt(data['tier2'])} ({_pct(data['tier2'], total_u)})\n"
        f"  14+ дней: {_fmt(data['tier3'])} ({_pct(data['tier3'], total_u)})\n"
    )
    return t


def _format_ads(data: dict, period: str) -> str:
    t = _section_header("Реклама", period)
    PLACEMENT_NAMES = {
        "reward_daily_coins": ("💰 Ежедн. монеты", "🟡"),
        "reward_hint": ("💡 Подсказки", "💡"),
        "reward_revive": ("❤️ Ревайвы", "❤️"),
        "reward_spin_retry": ("🎰 Рестарт спина", ""),
        "reward_task": ("📋 Задачи", "🟡"),
    }
    t += f"📣 <b>Награды за рекламу (за период)</b>\n"
    t += f"Всего выдач: <b>{_fmt(data['total_claims'])}</b>\n\n"
    claims = data.get("claims_by_placement", {})
    for key, (label, unit) in PLACEMENT_NAMES.items():
        if key in claims:
            c = claims[key]
            amount_str = f" ({_fmt(c['amount'])} {unit})" if unit and c["amount"] else ""
            t += f"  {label}: <b>{_fmt(c['count'])}</b>{amount_str}\n"
    intents = data.get("intents_by_status", {})
    if intents:
        status_labels = {
            "pending": "⏳ Ожидают",
            "fulfilled": "✅ Выполнено",
            "failed": "❌ Провалено",
            "expired": "⏰ Истекло",
        }
        t += "\n🔄 <b>Интенты за период</b>\n"
        for status, label in status_labels.items():
            if status in intents:
                t += f"  {label}: <b>{_fmt(intents[status])}</b>\n"
    return t


def _format_seasons(data: dict) -> str:
    season = data["current_season"]
    t = f"📊 <b>ADMIN — Сезоны</b>\n{'━' * 28}\n\n"
    t += f"🏆 Текущий сезон: <b>#{season}</b>\n"
    board = data.get("board_counts", {})
    t += f"\n📊 <b>Игроки в лидерборде (сезон {season})</b>\n"
    label_map = {"global": "🌍 Глобальный", "weekly": "📅 Weekly", "arcade": "🎮 Arcade"}
    if board:
        for btype, blabel in label_map.items():
            if btype in board:
                t += f"  {blabel}: <b>{_fmt(board[btype])}</b>\n"
    else:
        t += "  Нет данных\n"
    history = data.get("season_history", [])
    if len(history) > 1:
        t += "\n📜 <b>История сезонов (глобальный)</b>\n"
        for h in history:
            marker = " ← текущий" if h["season"] == season else ""
            t += f"  Сезон #{h['season']}: {_fmt(h['players'])} игроков{marker}\n"
    top5 = data.get("top5", [])
    if top5:
        t += f"\n🥇 <b>Топ-5 глобального (сезон {season})</b>\n"
        for i, p in enumerate(top5, 1):
            name = _uname(p["username"], p["first_name"])
            t += f"  {i}. {name} — ур. {_fmt(p['level'])}\n"
    t += (
        f"\n📅 <b>Ежедневный вызов</b>\n"
        f"  Активных стриков: <b>{_fmt(data['daily_active_streaks'])}</b>\n"
        f"  Ср. стрик: <b>{data['daily_avg_streak']:.1f}</b>"
        f" | Макс: <b>{_fmt(data['daily_max_streak'])}</b>\n"
    )
    return t


def _format_user_profile(p: dict) -> str:
    name = _uname(p.get("username"), p.get("first_name"))
    t = f"👤 <b>ПРОФИЛЬ</b> | TG: <code>{p['telegram_id']}</code>\n{'━' * 28}\n\n"
    flags = []
    if p.get("is_premium"):
        flags.append("⭐ Premium")
    if p.get("is_beta_tester"):
        flags.append("🧪 Beta")
    if p.get("is_banned"):
        flags.append("🚫 БАН")
    t += f"🆔 {name}"
    if flags:
        t += "  " + " | ".join(flags)
    t += "\n"
    t += f"📅 Зарегистрирован: <b>{_fmt_date(p.get('created_at'))}</b>\n"
    t += f"👁 Последняя активность: <b>{_fmt_ago(p.get('last_active_at'))}</b>\n"
    t += f"🌐 Язык: <b>{p.get('locale', '—')}</b>\n"
    if p.get("is_banned"):
        t += f"\n🚫 <b>ЗАБАНЕН</b>: {p.get('ban_reason') or '—'}\n"
        t += f"   Дата бана: {_fmt_date(p.get('banned_at'))}\n"
    # Game
    t += "\n🎮 <b>Игра</b>\n"
    t += f"  Уровень: <b>{_fmt(p.get('current_level', 1))}</b>"
    if p.get("level_reached_at"):
        t += f" (достигнут {_fmt_date(p['level_reached_at'])})"
    t += "\n"
    t += (
        f"  ⭐ Всего звёзд: <b>{_fmt(p.get('total_stars', 0))}</b>\n"
        f"  ✅ Пройдено уровней: <b>{_fmt(p.get('levels_completed', 0))}</b>\n"
        f"  ⏱ Время в игре: <b>{_fmt_time(p.get('total_playtime_seconds', 0))}</b>\n"
        f"  🎯 Ходов: <b>{_fmt(p.get('total_moves', 0))}</b>"
        f" | 💔 Ошибок: <b>{_fmt(p.get('total_mistakes', 0))}</b>\n"
        f"  🔥 Стрик: <b>{p.get('current_streak', 0)}</b>"
        f" | Макс: <b>{p.get('max_streak', 0)}</b>\n"
        f"  🎨 Скин: {p.get('active_arrow_skin', 'default')}"
        f" | Тема: {p.get('active_theme', 'light')}\n"
    )
    # Economy
    t += (
        "\n💰 <b>Экономика</b>\n"
        f"  🟡 Монеты: <b>{_fmt(p.get('coins', 0))}</b>\n"
        f"  ⭐ Stars: <b>{_fmt(p.get('stars_balance', 0))}</b>\n"
        f"  💡 Хинты: <b>{_fmt(p.get('hint_balance', 0))}</b>"
        f" | ❤️ Ревайвы: <b>{_fmt(p.get('revive_balance', 0))}</b>\n"
        f"  🧬 Доп. жизни: <b>{p.get('extra_lives', 0)}</b>"
        f" | ⚡ Энергия: <b>{p.get('energy', 5)}/5</b>\n"
    )
    # Referrals
    ref_name = p.get("referrer_name")
    t += (
        "\n🔗 <b>Рефералы</b>\n"
        f"  Пригласил: <b>{_fmt(p.get('referrals_count', 0))}</b> (подтв.)"
        f" + <b>{_fmt(p.get('referrals_pending', 0))}</b> в ожидании\n"
        f"  💰 Заработано: <b>{_fmt(p.get('referrals_earnings', 0))}</b> 🟡\n"
        f"  Сам пришёл по рефералу: <b>{ref_name or 'нет'}</b>\n"
    )
    # Spin
    streak = p.get("login_streak", 0)
    last_spin = p.get("last_spin_at") or p.get("last_spin_date")
    t += "\n🌀 <b>Спин</b>\n"
    t += f"  Стрик: <b>{streak}</b> дн."
    if last_spin:
        t += f" | Последний: <b>{_fmt_date(last_spin)}</b>"
    t += "\n"
    pending_type = p.get("pending_spin_prize_type")
    if pending_type:
        t += f"  ⏳ Непобранный приз: {pending_type} ×{p.get('pending_spin_prize_amount', 0)}\n"
    # Case & Wallet
    pity = p.get("case_pity_counter", 0)
    t += f"\n🎁 Pity кейса: <b>{pity}/50</b>\n"
    wallet = p.get("wallet_address")
    if wallet:
        short_wallet = wallet[:6] + "…" + wallet[-4:]
        t += f"💎 Кошелёк: <b>{short_wallet}</b>"
        if p.get("wallet_connected_at"):
            t += f" (подключён {_fmt_date(p['wallet_connected_at'])})"
        t += "\n"
    else:
        t += "💎 Кошелёк: <b>не подключён</b>\n"
    # Misc
    misc = []
    if p.get("onboarding_shown"):
        misc.append("онбординг пройден")
    if p.get("welcome_offer_purchased"):
        misc.append("welcome offer куплен")
    if misc:
        t += f"📋 {' | '.join(misc)}\n"
    return t


# populate dispatch maps
SECTION_FETCHERS_MAP = {
    "u": fetch_users_stats,
    "g": fetch_game_stats,
    "e": fetch_economy_stats,
    "r": fetch_referral_stats,
    "c": fetch_cases_spins_stats,
    "a": fetch_ads_stats,
}
SECTION_FORMATTERS_MAP = {
    "u": _format_users,
    "g": _format_game,
    "e": _format_economy,
    "r": _format_referrals,
    "c": _format_cases,
    "a": _format_ads,
}


# ---- Command handlers ----

@dp.message(Command("admin"))
async def cmd_admin(message: types.Message):
    """Show admin statistics panel main menu."""
    if not is_admin_telegram_id(message.from_user.id if message.from_user else None):
        await message.answer("Нет доступа.")
        return
    try:
        async with AsyncSessionLocal() as db:
            data = await fetch_users_stats(db, "7d")
    except Exception as exc:
        logger.error("Admin panel DB error: %s", exc)
        await message.answer("Ошибка при загрузке статистики.")
        return
    await message.answer(
        _format_main_menu_text(data),
        reply_markup=build_admin_main_menu(),
        parse_mode="HTML",
    )


@dp.message(Command("admin_user"))
async def cmd_admin_user(message: types.Message):
    """Show detailed profile of a specific user. Usage: /admin_user <telegram_id or @username>"""
    if not is_admin_telegram_id(message.from_user.id if message.from_user else None):
        await message.answer("Нет доступа.")
        return
    text = message.text or ""
    parts = text.split(maxsplit=1)
    if len(parts) < 2 or not parts[1].strip():
        await message.answer("Использование: /admin_user &lt;telegram_id или @username&gt;", parse_mode="HTML")
        return
    identifier = parts[1].strip()
    try:
        async with AsyncSessionLocal() as db:
            profile = await fetch_user_profile(db, identifier)
    except Exception as exc:
        logger.error("Admin user profile DB error: %s", exc)
        await message.answer("Ошибка при загрузке профиля.")
        return
    if profile is None:
        await message.answer(f"Пользователь <code>{html.escape(identifier)}</code> не найден.", parse_mode="HTML")
        return
    await message.answer(_format_user_profile(profile), parse_mode="HTML")


# ---- Callback handler ----

@dp.callback_query(lambda c: c.data and c.data.startswith("adm:"))
async def process_admin_stats(callback: types.CallbackQuery):
    """Handle all admin panel inline navigation."""
    if not is_admin_telegram_id(callback.from_user.id):
        await callback.answer("Нет доступа.", show_alert=True)
        return

    raw = callback.data or ""
    parts = raw.split(":")
    # parts[0] == "adm"
    section = parts[1] if len(parts) > 1 else "menu"
    period = parts[2] if len(parts) > 2 else "all"

    try:
        if section == "menu":
            async with AsyncSessionLocal() as db:
                data = await fetch_users_stats(db, "7d")
            text = _format_main_menu_text(data)
            kb = build_admin_main_menu()

        elif section == "s":
            async with AsyncSessionLocal() as db:
                data = await fetch_seasons_stats(db)
            text = _format_seasons(data)
            kb = build_seasons_keyboard()

        elif section == "u":
            async with AsyncSessionLocal() as db:
                data = await fetch_users_stats(db, period)
                device = await fetch_device_stats(db)
            text = _format_users(data, period, device)
            kb = build_section_keyboard(section, period)

        elif section in SECTION_FETCHERS_MAP:
            async with AsyncSessionLocal() as db:
                data = await SECTION_FETCHERS_MAP[section](db, period)
            text = SECTION_FORMATTERS_MAP[section](data, period)
            kb = build_section_keyboard(section, period)

        else:
            await callback.answer("Неизвестный раздел.", show_alert=True)
            return

        await callback.message.edit_text(text, reply_markup=kb, parse_mode="HTML")

    except Exception as exc:
        logger.error("Admin stats callback error section=%s period=%s: %s", section, period, exc)
        await callback.answer("Ошибка при загрузке данных.", show_alert=True)
        return

    await callback.answer()


# ============================================
# END ADMIN STATS PANEL
# ============================================


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
