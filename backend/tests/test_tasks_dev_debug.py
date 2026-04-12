from types import SimpleNamespace

import pytest

from app.services import tasks
from app.services.tasks_catalog import TASKS_CATALOG


def _get_task(task_id: str) -> dict:
    for task in TASKS_CATALOG:
        if task["id"] == task_id:
            return task
    raise AssertionError(f"Task {task_id} not found")


def test_link_task_stays_action_required_without_debug_override() -> None:
    user = SimpleNamespace(locale="en", current_level=1, referrals_count=0)
    task = _get_task("partner_zarub")

    dto = tasks._build_task_dto(
        task,
        set(),
        user,
        daily_levels_completed=None,
        debug_state={"partner_zarub": False},
    )

    assert dto.progress == 0
    assert dto.status == "action_required"


def test_link_task_debug_override_makes_task_claimable() -> None:
    user = SimpleNamespace(locale="en", current_level=1, referrals_count=0)
    task = _get_task("partner_zarub")

    dto = tasks._build_task_dto(
        task,
        set(),
        user,
        daily_levels_completed=None,
        debug_state={"partner_zarub": True},
    )

    assert dto.progress == 1
    assert dto.status == "claimable"


@pytest.mark.asyncio
async def test_dev_state_accepts_link_task_toggles(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tasks.settings, "ENVIRONMENT", "development")
    tasks.TASK_DEBUG_STATE.clear()
    try:
        state = await tasks.set_task_debug_state(
            123,
            {
                "partner_zarub": True,
                "partner_vpn_ru": False,
            },
        )

        assert state["partner_zarub"] is True
        assert state["partner_vpn_ru"] is False
        assert (await tasks.get_task_debug_state(123))["partner_zarub"] is True
    finally:
        tasks.TASK_DEBUG_STATE.clear()
