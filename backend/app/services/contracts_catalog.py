"""
Каталог контрактов (фрагментов) — code-defined конфигурация.

Каждый контракт — набор этапов, которые пользователь проходит последовательно.
Прогресс засчитывается с момента активации (snapshot-based delta).
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Типы метрик
# ---------------------------------------------------------------------------
# levels_completed_delta   — кол-во пройденных уровней ПОСЛЕ активации этапа
#                            вычисляется как (user.current_level - 1) - snapshot_value
#
# referrals_confirmed_delta — кол-во подтверждённых рефералов ПОСЛЕ активации этапа
#                            вычисляется как user.referrals_count - snapshot_value
#
# drum_streak_absolute     — текущая длина стрика барабана (user.login_streak)
#                            не требует snapshot; цель — держать стрик >= target дней
# ---------------------------------------------------------------------------

CONTRACTS: list[dict] = [
    # TODO: ВРЕМЕННО для тестирования — убрать или заменить реальными параметрами перед запуском
    {
        "id": "test_nft",
        "type": "nft_gift",
        "title_ru": "NFT Тест",
        "title_en": "NFT Test",
        "emoji": "🧪",
        "gift_star_cost": 0,
        "total_quantity": 1,
        "stages": [
            {
                "index": 0,
                "metric": "levels_completed_delta",
                "target": 1,
                "title_ru": "Пройти 1 уровень",
                "title_en": "Complete 1 level",
            },
            {
                "index": 1,
                "metric": "any_bundle_purchased_absolute",
                "target": 1,
                "title_ru": "Купить любой бандл",
                "title_en": "Purchase any bundle",
            },
        ],
    },
    {
        "id": "bear_25",
        "type": "simple_gift",
        "title_ru": "Мишка",
        "title_en": "Bear",
        "emoji": "🧸",
        "gift_star_cost": 25,
        "total_quantity": 1,
        "stages": [
            {
                "index": 0,
                "metric": "levels_completed_delta",
                "target": 1,
                "title_ru": "Пройти 1 уровень",
                "title_en": "Complete 1 level",
            },
        ],
    },
    # ──────────────────────────────────────────
    {
        "id": "bear_gift",
        "type": "simple_gift",
        "title_ru": "Мишка",
        "title_en": "Bear",
        "emoji": "🧸",
        "gift_star_cost": 15,
        "total_quantity": 40,
        "stages": [
            {
                "index": 0,
                "metric": "levels_completed_delta",
                "target": 100,
                "title_ru": "Пройти 100 уровней",
                "title_en": "Complete 100 levels",
            },
        ],
    },
    {
        "id": "vice_cream",
        "type": "nft_gift",
        "title_ru": "Vice Cream",
        "title_en": "Vice Cream",
        "emoji": "🍦",
        "gift_star_cost": 0,
        "total_quantity": 2,
        "stages": [
            {
                "index": 0,
                "metric": "levels_completed_delta",
                "target": 500,
                "title_ru": "Пройти 500 уровней",
                "title_en": "Complete 500 levels",
            },
            {
                "index": 1,
                "metric": "referrals_confirmed_delta",
                "target": 1,
                "title_ru": "Пригласить 1 подтверждённого реферала",
                "title_en": "Invite 1 confirmed referral",
            },
        ],
    },
    {
        "id": "victory_medal",
        "type": "nft_gift",
        "title_ru": "Victory Medal",
        "title_en": "Victory Medal",
        "emoji": "🥇",
        "gift_star_cost": 0,
        "total_quantity": 3,
        "stages": [
            {
                "index": 0,
                "metric": "levels_completed_delta",
                "target": 1000,
                "title_ru": "Пройти 1000 уровней",
                "title_en": "Complete 1000 levels",
            },
            {
                "index": 1,
                "metric": "drum_streak_absolute",
                "target": 5,
                "title_ru": "Держать стрик 5 дней",
                "title_en": "Maintain a 5-day streak",
            },
        ],
    },
]

# Быстрый доступ по id
CONTRACTS_BY_ID: dict[str, dict] = {c["id"]: c for c in CONTRACTS}


def get_contract(contract_id: str) -> dict | None:
    """Вернуть определение контракта по его id."""
    return CONTRACTS_BY_ID.get(contract_id)


def get_stage(contract: dict, stage_index: int) -> dict | None:
    """Вернуть определение этапа по индексу."""
    stages = contract.get("stages", [])
    for s in stages:
        if s["index"] == stage_index:
            return s
    return None
