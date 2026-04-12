from app.api.game import coins_by_difficulty


def test_coins_by_difficulty_uses_configured_level_rewards() -> None:
    assert coins_by_difficulty("easy") == 1
    assert coins_by_difficulty("normal") == 2
    assert coins_by_difficulty("hard") == 3
    assert coins_by_difficulty("extreme") == 4
    assert coins_by_difficulty("impossible") == 5

