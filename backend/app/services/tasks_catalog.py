"""Declarative task catalog for TasksScreen."""

TASKS_CATALOG = [
    {
        "id": "official_channel",
        "kind": "single",
        "base_title": "Подпишись на канал",
        "base_description": "Официальные новости и промокоды",
        "tiers": [
            {
                "claim_id": "official_channel_subscribe",
                "target": 1,
                "reward_coins": 50,
                "title": "Подпишись на канал",
            }
        ],
    },
    {
        "id": "arcade_levels",
        "kind": "stepped",
        "base_title": "Пройти уровни",
        "base_description": "Завершите уровни в Arcade",
        "tiers": [
            {"claim_id": "arcade_levels_5", "target": 5, "reward_coins": 10, "title": "Пройди 5 уровней"},
            {"claim_id": "arcade_levels_10", "target": 10, "reward_coins": 20, "title": "Пройди 10 уровней"},
            {"claim_id": "arcade_levels_25", "target": 25, "reward_coins": 40, "title": "Пройди 25 уровней"},
            {"claim_id": "arcade_levels_50", "target": 50, "reward_coins": 60, "title": "Пройди 50 уровней"},
            {"claim_id": "arcade_levels_75", "target": 75, "reward_coins": 80, "title": "Пройди 75 уровней"},
            {"claim_id": "arcade_levels_100", "target": 100, "reward_coins": 100, "title": "Пройди 100 уровней"},
        ],
    },
    {
        "id": "friends_confirmed",
        "kind": "stepped",
        "base_title": "Пригласи друзей",
        "base_description": "Зови друзей по реферальной ссылке",
        "tiers": [
            {"claim_id": "friends_confirmed_3", "target": 3, "reward_coins": 50, "title": "Пригласи 3 друзей"},
            {"claim_id": "friends_confirmed_6", "target": 6, "reward_coins": 50, "title": "Пригласи 6 друзей"},
            {"claim_id": "friends_confirmed_9", "target": 9, "reward_coins": 100, "title": "Пригласи 9 друзей"},
            {"claim_id": "friends_confirmed_12", "target": 12, "reward_coins": 100, "title": "Пригласи 12 друзей"},
        ],
    },
]

