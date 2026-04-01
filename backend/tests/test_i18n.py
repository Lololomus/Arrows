from app.services.i18n import get_localized_text, normalize_locale, normalize_translation_map


def test_normalize_locale_maps_supported_variants() -> None:
    assert normalize_locale("ru") == "ru"
    assert normalize_locale("ru-RU") == "ru"
    assert normalize_locale("en") == "en"
    assert normalize_locale("en_US") == "en"
    assert normalize_locale("de") == "en"
    assert normalize_locale(None) == "en"


def test_get_localized_text_uses_requested_locale_then_fallbacks() -> None:
    translations = {"ru": "Привет", "en": "Hello"}

    assert get_localized_text(translations, "ru") == "Привет"
    assert get_localized_text(translations, "en") == "Hello"
    assert get_localized_text({"ru": "Привет"}, "en") == "Привет"
    assert get_localized_text({"en": "Hello"}, "ru") == "Hello"
    assert get_localized_text({}, "en", fallback_text="Fallback") == "Fallback"


def test_normalize_translation_map_keeps_supported_locales() -> None:
    normalized = normalize_translation_map(
        {"ru": "Привет", "en-US": "Hello", "de": "Hallo"},
        fallback_text="Fallback",
    )

    assert normalized == {"ru": "Привет", "en": "Hello"}

def test_normalize_translation_map_ignores_unsupported_locales() -> None:
    assert normalize_translation_map({"de": "Hallo", "fr": "Bonjour"}) == {}
