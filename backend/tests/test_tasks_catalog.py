from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.tasks_catalog import TASKS_CATALOG


def _get_task(task_id: str) -> dict:
    for task in TASKS_CATALOG:
        if task["id"] == task_id:
            return task
    raise AssertionError(f"Task {task_id} not found")


def test_arcade_levels_contains_expected_tiers() -> None:
    arcade = _get_task("arcade_levels")
    tiers = arcade["tiers"]
    assert len(tiers) == 12
    assert [tier["target"] for tier in tiers] == [5, 10, 25, 50, 75, 100, 250, 500, 1000, 1500, 2500, 5000]


def test_arcade_levels_mixed_rewards() -> None:
    arcade = _get_task("arcade_levels")
    tiers_by_target = {tier["target"]: tier for tier in arcade["tiers"]}

    assert tiers_by_target[250]["reward_coins"] == 110
    assert tiers_by_target[250].get("reward_hints", 0) == 0
    assert tiers_by_target[250].get("reward_revives", 0) == 0

    assert tiers_by_target[500]["reward_coins"] == 120
    assert tiers_by_target[500]["reward_hints"] == 1
    assert tiers_by_target[1000]["reward_hints"] == 2
    assert tiers_by_target[1500]["reward_hints"] == 3

    assert tiers_by_target[2500]["reward_coins"] == 180
    assert tiers_by_target[2500]["reward_revives"] == 1
    assert tiers_by_target[5000]["reward_coins"] == 200
    assert tiers_by_target[5000]["reward_revives"] == 2
