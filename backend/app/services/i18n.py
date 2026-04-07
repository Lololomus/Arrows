from __future__ import annotations

from typing import Any, Literal, Mapping


SupportedLocale = Literal["ru", "en"]
SUPPORTED_LOCALES: tuple[SupportedLocale, ...] = ("ru", "en")
DEFAULT_LOCALE: SupportedLocale = "en"
FRAGMENT_LOCALE_FALLBACKS: tuple[SupportedLocale, ...] = ("en", "ru")


def get_supported_locale(raw_locale: str | None) -> SupportedLocale | None:
    if not raw_locale:
        return None

    normalized = raw_locale.strip().lower().replace("_", "-")
    language = normalized.split("-", 1)[0]
    if language in SUPPORTED_LOCALES:
        return language  # type: ignore[return-value]
    return None


def normalize_locale(raw_locale: str | None) -> SupportedLocale:
    return get_supported_locale(raw_locale) or DEFAULT_LOCALE


def normalize_translation_map(
    value: Mapping[str, Any] | None,
    *,
    fallback_text: str | None = None,
) -> dict[str, str]:
    data: dict[str, str] = {}
    if isinstance(value, Mapping):
        for raw_locale, raw_text in value.items():
            if not isinstance(raw_text, str):
                continue
            text = raw_text.strip()
            if not text:
                continue
            locale = get_supported_locale(str(raw_locale))
            if locale is None:
                continue
            data.setdefault(locale, text)

    if fallback_text:
        fallback = fallback_text.strip()
        if fallback:
            data.setdefault("ru", fallback)

    return data


def get_localized_text(
    translations: Mapping[str, Any] | None,
    locale: str | None,
    *,
    fallback_text: str | None = None,
) -> str | None:
    normalized = normalize_translation_map(translations, fallback_text=fallback_text)
    if not normalized:
        return fallback_text

    requested = normalize_locale(locale)
    for candidate in (requested, *FRAGMENT_LOCALE_FALLBACKS):
        text = normalized.get(candidate)
        if text:
            return text

    return next(iter(normalized.values()), fallback_text)


BOT_TEXT: dict[str, dict[SupportedLocale, str]] = {
    "player_name_fallback": {
        "ru": "игрок",
        "en": "player",
    },
    "start_text": {
        "ru": (
            "Привет, <b>{player_name}</b>! 👋\n\n"
            "ArrowReward — это логическая игра с ежедневными наградами.\n\n"
            "Как играть:\n"
            "• Нажми на стрелку, чтобы запустить её.\n"
            "• Избегай столкновений.\n"
            "• Проходи уровни и соревнуйся с друзьями.\n\n"
            "Жми кнопку ниже, чтобы начать."
        ),
        "en": (
            "Hi, <b>{player_name}</b>! 👋\n\n"
            "ArrowReward is a puzzle game with daily rewards.\n\n"
            "How to play:\n"
            "• Tap an arrow to launch it.\n"
            "• Avoid collisions.\n"
            "• Clear levels and compete with friends.\n\n"
            "Tap the button below to start."
        ),
    },
    "start_button": {
        "ru": "Запустить ArrowReward",
        "en": "Launch ArrowReward",
    },
    "info_button": {
        "ru": "Инфо",
        "en": "Info",
    },
    "back_button": {
        "ru": "Назад",
        "en": "Back",
    },
    "info_text": {
        "ru": "Обратная связь и поддержка:\n\n@ArrowRewardSupport",
        "en": "Feedback and support:\n\n@ArrowRewardSupport",
    },
    "spin_button": {
        "ru": "🎰 Крутить рулетку",
        "en": "🎰 Spin the wheel",
    },
    "spin_ready": {
        "ru": (
            "🎰 <b>Рулетка снова доступна!</b>\n\n"
            "Прошло 24 часа — можно крутить снова.\n"
            "Не прерывай серию 🔥"
        ),
        "en": (
            "🎰 <b>The wheel is ready again!</b>\n\n"
            "24 hours passed — time to spin again.\n"
            "Keep your streak alive 🔥"
        ),
    },
    "spin_streak_reset": {
        "ru": (
            "💔 <b>Серия прервана</b>\n\n"
            "Ты пропустил день — серия сброшена (было: <b>{old_streak} дн.</b>).\n\n"
            "Возвращайся каждый день, чтобы снова поднять Tier."
        ),
        "en": (
            "💔 <b>Your streak has been reset</b>\n\n"
            "You missed a day, so the streak was reset (was: <b>{old_streak} days</b>).\n\n"
            "Come back daily to build your Tier again."
        ),
    },
    "spin_streak_warning": {
        "ru": (
            "⏰ <b>Серия {streak} дн. сгорит примерно через 6 часов</b>\n\n"
            "Не теряй <b>{tier_name}</b> — зайди и крути, пока не поздно."
        ),
        "en": (
            "⏰ <b>Your {streak}-day streak will expire in about 6 hours</b>\n\n"
            "Don't lose <b>{tier_name}</b> — jump in and spin before it's too late."
        ),
    },
    "new_season": {
        "ru": (
            "🏆 <b>Новый сезон начался!</b>\n\n"
            "Стрелки летят снова — и теперь с увеличенными наградами!\n\n"
            "🎁 <b>Высокие призы</b> за каждый пройденный уровень\n"
            "🔥 Топовые места в таблице лидеров дают <b>особые бонусы</b>\n\n"
            "Не упусти шанс взять максимум с самого старта!"
        ),
        "en": (
            "🏆 <b>New Season has started!</b>\n\n"
            "Arrows are flying again — now with bigger rewards!\n\n"
            "🎁 <b>High prizes</b> for every level you clear\n"
            "🔥 Top leaderboard spots earn <b>special bonuses</b>\n\n"
            "Don't miss your chance to grab the most from day one!"
        ),
    },
    "new_season_button": {
        "ru": "🚀 Играть сейчас",
        "en": "🚀 Play now",
    },
    "daily_task_available": {
        "ru": (
            "📋 <b>Новое ежедневное задание!</b>\n\n"
            "Выполни задание и получи <b>1 ревайв + 50 монет</b>.\n"
            "Задание сбрасывается каждый день — не пропусти!"
        ),
        "en": (
            "📋 <b>New daily task available!</b>\n\n"
            "Complete the task and get <b>1 revive + 50 coins</b>.\n"
            "Resets every day — don't miss it!"
        ),
    },
    "tasks_button": {
        "ru": "📋 Задания",
        "en": "📋 Tasks",
    },
    "adsgram_task_reward": {
        "ru": (
            "✅ <b>Задание выполнено!</b>\n\n"
            "Ты получил <b>+1 ревайв</b> и <b>+50 монет</b>.\n"
            "Возвращайся завтра за новой наградой!"
        ),
        "en": (
            "✅ <b>Task completed!</b>\n\n"
            "You received <b>+1 revive</b> and <b>+50 coins</b>.\n"
            "Come back tomorrow for another reward!"
        ),
    },
    "play_button": {
        "ru": "🎮 Играть",
        "en": "🎮 Play",
    },
}


def bot_text(key: str, locale: str | None, **params: Any) -> str:
    normalized = normalize_locale(locale)
    template = BOT_TEXT[key][normalized]
    return template.format(**params)
