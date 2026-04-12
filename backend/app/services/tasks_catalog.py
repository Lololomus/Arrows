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
        "id": "daily_levels",
        "kind": "stepped",
        "base_title": "Пройти 10 уровней",
        "base_description": "Ежедневное задание",
        "tiers": [
            {"claim_id": "daily_levels_10", "target": 10, "reward_coins": 50, "title": "Пройди 10 уровней"},
        ],
    },
    {
        "id": "partner_channel",
        "kind": "single",
        "base_title": "Подпишитесь на канал",
        "base_description": "+50 монет за подписку",
        "tiers": [
            {
                "claim_id": "partner_channel_subscribe",
                "target": 1,
                "reward_coins": 50,
                "title": "Подпишитесь на канал",
            }
        ],
    },
    {
        "id": "partner_zarub",
        "kind": "link",
        "audience": ["ru"],
        "link_url": "https://t.me/zarub_robot?start=ref_KEay8n",
        "base_title": "Виртуальная карта Visa/MC — ZARUB",
        "base_description": "Карта без документов, пополнение СБП или криптой. ChatGPT, Netflix, Spotify и др.",
        "tiers": [
            {
                "claim_id": "partner_zarub_visit",
                "target": 1,
                "reward_coins": 100,
                "title": "Виртуальная карта Visa/MC — ZARUB",
            }
        ],
    },
    {
        "id": "partner_vpn_ru",
        "kind": "link",
        "audience": ["ru"],
        "link_url": "https://t.me/blacktemple_space_bot?start=ref852738218",
        "base_title": "BlackTemple VPN",
        "base_description": "Дешёвый, быстрый и удобный VPN. 700+ серверов, iOS и Android",
        "tiers": [
            {
                "claim_id": "partner_vpn_ru_visit",
                "target": 1,
                "reward_coins": 100,
                "title": "BlackTemple VPN",
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
            {"claim_id": "arcade_levels_250", "target": 250, "reward_coins": 110, "title": "Пройди 250 уровней"},
            {"claim_id": "arcade_levels_500", "target": 500, "reward_coins": 120, "reward_hints": 1, "title": "Пройди 500 уровней"},
            {"claim_id": "arcade_levels_1000", "target": 1000, "reward_coins": 140, "reward_hints": 2, "title": "Пройди 1000 уровней"},
            {"claim_id": "arcade_levels_1500", "target": 1500, "reward_coins": 160, "reward_hints": 3, "title": "Пройди 1500 уровней"},
            {"claim_id": "arcade_levels_2500", "target": 2500, "reward_coins": 180, "reward_revives": 1, "title": "Пройди 2500 уровней"},
            {"claim_id": "arcade_levels_5000", "target": 5000, "reward_coins": 200, "reward_revives": 2, "title": "Пройди 5000 уровней"},
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
