"""
Contracts service — бизнес-логика системы контрактов (фрагментов).

Флоу:
  activate_contract   → пользователь запускает контракт, берётся snapshot этапа 0
  complete_stage      → пользователь подтверждает завершение этапа, берётся snapshot следующего
  collect_reward      → пользователь забирает финальную награду, бот отправляет подарок
  get_contract_status → опрос статуса доставки подарка (polling)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import User, UserContract
from .contracts_catalog import CONTRACTS, get_contract, get_stage
from .telegram_gifts_api import (
    GiftApiBadRequest,
    GiftApiForbidden,
    GiftApiUnknownOutcome,
    GiftApiRetryAfter,
    send_gift,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Хелперы
# ---------------------------------------------------------------------------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _metric_current_value(user: User, metric: str) -> int:
    """Вернуть текущее значение метрики для пользователя."""
    if metric == "levels_completed_delta":
        return max(0, user.current_level - 1)
    if metric == "referrals_confirmed_delta":
        return max(0, user.referrals_count)
    if metric == "drum_streak_absolute":
        return user.login_streak or 0
    # TODO: ВРЕМЕННО для тестирования — проверяем только welcome bundle.
    #       Позже расширить на все бандлы через запрос к transactions.
    if metric == "any_bundle_purchased_absolute":
        return 1 if user.welcome_offer_purchased else 0
    return 0


def _take_snapshot(user: User, metric: str) -> int | None:
    """
    Взять snapshot текущего значения метрики.
    Для delta-метрик возвращает текущее значение (будет вычтено при расчёте прогресса).
    Для absolute-метрик возвращает None (snapshot не нужен).
    """
    if metric.endswith("_delta"):
        return _metric_current_value(user, metric)
    return None  # absolute metric — no snapshot needed


def compute_progress(user: User, stage: dict, snapshot: dict) -> tuple[int, int]:
    """
    Вернуть (current_progress, target) для заданного этапа.
    snapshot — элемент stage_snapshots[str(stage_index)].
    """
    metric: str = stage["metric"]
    target: int = stage["target"]
    current_value = _metric_current_value(user, metric)

    if metric.endswith("_delta"):
        snapshot_value = snapshot.get("snapshot_value", 0) or 0
        current = max(0, current_value - snapshot_value)
    else:
        # absolute metric
        current = current_value

    return current, target


def is_stage_complete(user: User, stage: dict, snapshot: dict) -> bool:
    current, target = compute_progress(user, stage, snapshot)
    return current >= target


# ---------------------------------------------------------------------------
# Получение списка контрактов
# ---------------------------------------------------------------------------

def _available_contracts() -> list[dict]:
    """
    Вернуть контракты доступные для показа.
    В production скрывает контракты без telegram_gift_id — они не готовы к работе.
    В development показывает все (для тестирования флоу без реального подарка).
    """
    if settings.ENVIRONMENT == "development":
        return CONTRACTS
    return [c for c in CONTRACTS if c.get("telegram_gift_id")]


async def get_contracts_list(user: User, db: AsyncSession) -> tuple[list[dict], bool]:
    """
    Вернуть список DTO контрактов с пользовательским состоянием.
    Второй элемент — has_pending_action (нужно что-то нажать).
    """
    visible_contracts = _available_contracts()

    # Загрузить все UserContract этого пользователя
    result = await db.execute(
        select(UserContract).where(UserContract.user_id == user.id)
    )
    user_contracts: dict[str, UserContract] = {
        uc.contract_id: uc for uc in result.scalars().all()
    }

    # Проверить, есть ли у пользователя активный контракт (блокирует активацию других)
    has_active = any(
        uc.status in ("active", "reward_ready", "collecting")
        for uc in user_contracts.values()
    )

    # Посчитать занятые слоты для каждого контракта (active + collecting + completed, не считая abandoned)
    # Используем подзапрос для всех контрактов сразу
    count_result = await db.execute(
        select(
            UserContract.contract_id,
            func.count(UserContract.id).label("cnt")
        )
        .where(UserContract.contract_id.in_([c["id"] for c in visible_contracts]))
        .group_by(UserContract.contract_id)
    )
    slot_counts: dict[str, int] = {row.contract_id: row.cnt for row in count_result}

    contracts_dto = []
    has_pending_action = False

    for contract_def in visible_contracts:
        cid = contract_def["id"]
        uc = user_contracts.get(cid)
        used_slots = slot_counts.get(cid, 0)
        remaining = max(0, contract_def["total_quantity"] - used_slots)
        stages_count = len(contract_def["stages"])

        user_state = None
        if uc is not None:
            user_state = _build_user_state(user, contract_def, uc)
            if user_state.get("has_pending_action"):
                has_pending_action = True

        contracts_dto.append({
            "id": cid,
            "type": contract_def["type"],
            "title_ru": contract_def.get("title_ru", cid),
            "title_en": contract_def.get("title_en", cid),
            "emoji": contract_def["emoji"],
            "gift_star_cost": contract_def["gift_star_cost"],
            "total_quantity": contract_def["total_quantity"],
            "remaining_quantity": remaining,
            "stages_count": stages_count,
            "has_active_elsewhere": has_active and (uc is None or uc.status == "completed"),
            "user_state": user_state,
        })

    return contracts_dto, has_pending_action


def _build_user_state(user: User, contract_def: dict, uc: UserContract) -> dict:
    """Построить user_state DTO для активированного контракта."""
    stages_completed: list[int] = uc.stages_completed or []
    stage_snapshots: dict = uc.stage_snapshots or {}
    current_idx = uc.current_stage_index

    stages_dto = []

    # Показываем этапы только до current включительно (следующие скрыты)
    for stage_def in contract_def["stages"]:
        idx = stage_def["index"]
        if idx > current_idx:
            break  # скрыть следующие этапы

        snapshot = stage_snapshots.get(str(idx), {})
        is_completed = idx in stages_completed
        is_current = idx == current_idx

        if is_current and uc.status == "active":
            progress_current, _ = compute_progress(user, stage_def, snapshot)
            is_completable = is_stage_complete(user, stage_def, snapshot)
        else:
            # Завершённые этапы — прогресс = target
            progress_current = stage_def["target"] if is_completed else 0
            is_completable = False

        stages_dto.append({
            "index": idx,
            "metric": stage_def["metric"],
            "target": stage_def["target"],
            "title_ru": stage_def.get("title_ru", ""),
            "title_en": stage_def.get("title_en", ""),
            "progress_current": progress_current,
            "is_current": is_current,
            "is_completed": is_completed,
            "is_completable": is_completable,
            "snapshot_value": snapshot.get("snapshot_value"),
        })

    # has_pending_action = нужно нажать кнопку
    has_pending_action = False
    if uc.status == "reward_ready":
        has_pending_action = True
    elif uc.status == "active":
        # Проверяем текущий этап
        current_stage_def = get_stage(contract_def, current_idx)
        if current_stage_def:
            snapshot = stage_snapshots.get(str(current_idx), {})
            if is_stage_complete(user, current_stage_def, snapshot):
                has_pending_action = True

    reward_claim_status = None
    if uc.reward_claim:
        reward_claim_status = uc.reward_claim.get("status")

    return {
        "status": uc.status,
        "current_stage_index": current_idx,
        "stages": stages_dto,
        "activated_at": uc.activated_at.isoformat() if uc.activated_at else "",
        "completed_at": uc.completed_at.isoformat() if uc.completed_at else None,
        "reward_claim_status": reward_claim_status,
        "has_pending_action": has_pending_action,
    }


# ---------------------------------------------------------------------------
# Активация контракта
# ---------------------------------------------------------------------------

async def activate_contract(user: User, contract_id: str, db: AsyncSession) -> UserContract:
    """
    Активировать контракт для пользователя.
    Raises HTTPException при нарушении бизнес-правил.
    """
    from ..api.error_utils import api_error  # local import to avoid circular deps

    # В production показываем только контракты с telegram_gift_id;
    # активация несуществующего/скрытого контракта → 404.
    contract_def = get_contract(contract_id)
    if contract_def is None:
        raise api_error(404, "CONTRACT_NOT_FOUND", "Contract not found")
    if settings.ENVIRONMENT != "development" and not contract_def.get("telegram_gift_id"):
        raise api_error(404, "CONTRACT_NOT_FOUND", "Contract not found")

    # SELECT FOR UPDATE: заблокировать строки пользователя для атомарной проверки
    existing_result = await db.execute(
        select(UserContract)
        .where(UserContract.user_id == user.id)
        .with_for_update()
    )
    existing_contracts = list(existing_result.scalars().all())

    # Проверить нет ли другого активного контракта
    for ec in existing_contracts:
        if ec.status in ("active", "reward_ready", "collecting"):
            raise api_error(409, "ANOTHER_ACTIVE", "You already have an active contract")
        if ec.contract_id == contract_id and ec.status == "completed":
            raise api_error(409, "ALREADY_COMPLETED", "You have already completed this contract")
        if ec.contract_id == contract_id:
            raise api_error(409, "ALREADY_ACTIVATED", "This contract is already activated")

    # Advisory lock: сериализует активации одного и того же контракта разными пользователями.
    # hashtext() — встроенная функция PostgreSQL, возвращает int4.
    # pg_advisory_xact_lock удерживается до конца транзакции.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
        {"lock_key": f"contract_activate:{contract_id}"},
    )

    # Теперь считаем занятые слоты внутри блокировки — гонка невозможна.
    count_result = await db.execute(
        select(func.count(UserContract.id))
        .where(UserContract.contract_id == contract_id)
    )
    used_slots = count_result.scalar() or 0
    if used_slots >= contract_def["total_quantity"]:
        raise api_error(409, "OUT_OF_STOCK", "This contract is out of stock")

    # Взять snapshot для этапа 0
    first_stage = get_stage(contract_def, 0)
    if first_stage is None:
        raise api_error(500, "CATALOG_ERROR", "Contract has no stages defined")

    now = _utcnow()
    snapshot_value = _take_snapshot(user, first_stage["metric"])
    initial_snapshots = {
        "0": {
            "snapshot_value": snapshot_value,
            "started_at": now.isoformat(),
        }
    }

    uc = UserContract(
        user_id=user.id,
        contract_id=contract_id,
        status="active",
        current_stage_index=0,
        activated_at=now,
        stage_snapshots=initial_snapshots,
        stages_completed=[],
        reward_claim=None,
    )
    db.add(uc)
    await db.commit()
    await db.refresh(uc)

    logger.info("contracts: user %d activated contract %s", user.id, contract_id)
    return uc


# ---------------------------------------------------------------------------
# Завершение этапа
# ---------------------------------------------------------------------------

async def complete_stage(user: User, contract_id: str, db: AsyncSession) -> UserContract:
    """
    Подтвердить завершение текущего этапа.
    Если это последний этап — переводит в reward_ready.
    Иначе — переходит к следующему этапу, берёт snapshot.
    """
    from ..api.error_utils import api_error

    contract_def = get_contract(contract_id)
    if contract_def is None:
        raise api_error(404, "CONTRACT_NOT_FOUND", "Contract not found")

    # SELECT FOR UPDATE
    uc_result = await db.execute(
        select(UserContract)
        .where(
            UserContract.user_id == user.id,
            UserContract.contract_id == contract_id,
        )
        .with_for_update()
    )
    uc = uc_result.scalar_one_or_none()

    if uc is None:
        raise api_error(404, "CONTRACT_NOT_FOUND", "Contract not activated")
    if uc.status != "active":
        raise api_error(409, "WRONG_STATUS", f"Cannot complete stage in status '{uc.status}'")

    current_idx = uc.current_stage_index
    current_stage_def = get_stage(contract_def, current_idx)
    if current_stage_def is None:
        raise api_error(500, "CATALOG_ERROR", "Stage not found in catalog")

    stage_snapshots = dict(uc.stage_snapshots or {})
    snapshot = stage_snapshots.get(str(current_idx), {})

    # Перепроверить условие завершения
    if not is_stage_complete(user, current_stage_def, snapshot):
        raise api_error(409, "STAGE_NOT_COMPLETE", "Stage requirements are not yet met")

    now = _utcnow()
    stages_completed = list(uc.stages_completed or [])
    stages_completed.append(current_idx)

    last_stage_index = max(s["index"] for s in contract_def["stages"])

    if current_idx == last_stage_index:
        # Все этапы завершены
        uc.status = "reward_ready"
        uc.stages_completed = stages_completed
        logger.info("contracts: user %d completed all stages of %s", user.id, contract_id)
    else:
        # Перейти к следующему этапу
        next_idx = current_idx + 1
        next_stage_def = get_stage(contract_def, next_idx)
        if next_stage_def is None:
            raise api_error(500, "CATALOG_ERROR", "Next stage not found in catalog")

        snapshot_value = _take_snapshot(user, next_stage_def["metric"])
        stage_snapshots[str(next_idx)] = {
            "snapshot_value": snapshot_value,
            "started_at": now.isoformat(),
        }

        uc.current_stage_index = next_idx
        uc.stage_snapshots = stage_snapshots
        uc.stages_completed = stages_completed
        logger.info(
            "contracts: user %d completed stage %d of %s, moving to stage %d",
            user.id, current_idx, contract_id, next_idx,
        )

    await db.commit()
    await db.refresh(uc)
    return uc


# ---------------------------------------------------------------------------
# Забрать награду (collect)
# ---------------------------------------------------------------------------

async def collect_reward(user: User, contract_id: str, db: AsyncSession) -> str:
    """
    Пользователь нажал «Забрать». Запускает доставку подарка.
    Возвращает claim_status: "delivered" | "sending" | "failed".

    Логика защиты от двойной отправки:
    - Только "reward_ready" → начинает новую доставку (атомарный переход в collecting).
    - "collecting" + reward_claim.status == "sending" → доставка уже идёт, вернуть "sending".
    - "collecting" + reward_claim.status == "failed" → предыдущая попытка упала, retry разрешён.
    """
    from ..api.error_utils import api_error

    contract_def = get_contract(contract_id)
    if contract_def is None:
        raise api_error(404, "CONTRACT_NOT_FOUND", "Contract not found")

    # SELECT FOR UPDATE — единственный способ атомарно прочитать и обновить статус.
    uc_result = await db.execute(
        select(UserContract)
        .where(
            UserContract.user_id == user.id,
            UserContract.contract_id == contract_id,
        )
        .with_for_update()
    )
    uc = uc_result.scalar_one_or_none()

    if uc is None:
        raise api_error(404, "CONTRACT_NOT_FOUND", "Contract not activated")

    now = _utcnow()

    if uc.status == "collecting":
        claim_status = (uc.reward_claim or {}).get("status")
        if claim_status == "sending":
            # Доставка уже в процессе — не дублировать.
            logger.info(
                "contracts: collect called for already-sending contract %s (user %d) — returning 'sending'",
                contract_id, user.id,
            )
            return "sending"
        elif claim_status == "failed":
            # Предыдущая попытка упала — разрешаем retry.
            logger.info(
                "contracts: retrying failed delivery for contract %s (user %d)",
                contract_id, user.id,
            )
            uc.reward_claim = {"status": "sending", "created_at": now.isoformat()}
            await db.commit()
            return await _deliver_gift(user, contract_def, uc, db)
        else:
            # Неизвестный промежуточный статус — консервативно вернуть "sending".
            logger.warning(
                "contracts: collect for contract %s (user %d) in unexpected reward_claim state: %s",
                contract_id, user.id, claim_status,
            )
            return "sending"

    if uc.status != "reward_ready":
        raise api_error(409, "WRONG_STATUS", f"Cannot collect in status '{uc.status}'")

    # Атомарный переход reward_ready → collecting/sending.
    # После этого коммита любой параллельный запрос увидит "collecting/sending"
    # и вернёт "sending" без повторного вызова send_gift.
    uc.status = "collecting"
    uc.reward_claim = {"status": "sending", "created_at": now.isoformat()}
    await db.commit()

    return await _deliver_gift(user, contract_def, uc, db)


async def _deliver_gift(user: User, contract_def: dict, uc: UserContract, db: AsyncSession) -> str:
    """Низкоуровневая доставка подарка — адаптирована под UserContract."""
    now = _utcnow()
    telegram_gift_id = contract_def.get("telegram_gift_id")

    if settings.ENVIRONMENT == "development":
        logger.info(
            "[DEV] Contract gift auto-delivered (user=%d, contract=%s)",
            user.id, contract_def["id"],
        )
        uc.reward_claim = {"status": "delivered", "created_at": now.isoformat()}
        uc.status = "completed"
        uc.completed_at = now
        await db.commit()
        return "delivered"

    if not telegram_gift_id:
        # В production telegram_gift_id обязателен для реальной отправки.
        # Без него подарок не ушёл бы — не помечаем как "delivered".
        # Помечаем как "failed" и возвращаем reward_ready, чтобы можно было повторить
        # после того как администратор укажет gift_id в каталоге.
        logger.critical(
            "contracts: telegram_gift_id not configured for contract %s (user=%d) — "
            "delivery aborted, reverting to reward_ready",
            contract_def["id"], user.id,
        )
        uc.reward_claim = {
            "status": "failed",
            "created_at": now.isoformat(),
            "reason": "gift_not_configured",
        }
        uc.status = "reward_ready"  # позволяет повторить попытку после настройки
        await db.commit()
        from ..api.error_utils import api_error
        raise api_error(
            503,
            "GIFT_NOT_CONFIGURED",
            "Подарок ещё не настроен. Попробуй позже.",
        )

    # Отправить через Telegram Gifts API
    try:
        await send_gift(
            bot_token=settings.TELEGRAM_BOT_TOKEN,
            user_id=user.telegram_id,
            gift_id=telegram_gift_id,
        )
    except GiftApiForbidden:
        logger.warning("contracts: user %d blocked bot (contract=%s)", user.id, contract_def["id"])
        uc.reward_claim = {"status": "failed", "created_at": now.isoformat(), "reason": "user_blocked_bot"}
        uc.status = "reward_ready"  # откат — можно попробовать снова
        await db.commit()
        from ..api.error_utils import api_error
        raise api_error(409, "USER_BLOCKED_BOT", "Разблокируй бота, чтобы получить подарок")

    except GiftApiBadRequest as exc:
        reason = str(exc.description or "")
        logger.warning("contracts: bad request for contract %s: %s", contract_def["id"], reason)
        uc.reward_claim = {"status": "failed", "created_at": now.isoformat(), "reason": reason[:200]}
        uc.status = "reward_ready"
        await db.commit()
        from ..api.error_utils import api_error
        if "BALANCE" in reason.upper() or "TOO LOW" in reason.upper() or "STARS" in reason.upper():
            logger.critical(
                "contracts: bot Stars balance insufficient (contract=%s, user=%d) — top up the bot balance",
                contract_def["id"], user.id,
            )
            raise api_error(503, "BOT_BALANCE_LOW", "Недостаточно Stars у бота. Попробуй позже.")
        raise api_error(409, "GIFT_SEND_FAILED", "Не удалось отправить подарок")

    except GiftApiRetryAfter as exc:
        logger.warning("contracts: rate limited for contract %s, retry after %ds", contract_def["id"], exc.retry_after)
        uc.reward_claim = {"status": "sending", "created_at": now.isoformat(), "reason": f"rate_limited:{exc.retry_after}s"}
        await db.commit()
        return "sending"

    except GiftApiUnknownOutcome as exc:
        logger.error("contracts: unknown outcome for contract %s: %s", contract_def["id"], exc.description)
        uc.reward_claim = {"status": "sending", "created_at": now.isoformat(), "reason": f"unknown:{str(exc.description)[:200]}"}
        await db.commit()
        return "sending"

    except Exception as exc:
        logger.exception("contracts: unexpected error delivering gift (contract=%s)", contract_def["id"])
        uc.reward_claim = {"status": "sending", "created_at": now.isoformat(), "reason": f"unknown:{str(exc)[:200]}"}
        await db.commit()
        return "sending"

    # Успешная доставка
    logger.info("contracts: gift delivered (user=%d, contract=%s)", user.id, contract_def["id"])
    uc.reward_claim = {"status": "delivered", "created_at": now.isoformat()}
    uc.status = "completed"
    uc.completed_at = now
    await db.commit()
    return "delivered"


# ---------------------------------------------------------------------------
# Статус доставки (polling)
# ---------------------------------------------------------------------------

async def get_contract_status(user: User, contract_id: str, db: AsyncSession) -> dict:
    """Вернуть текущий статус контракта и доставки подарка."""
    from ..api.error_utils import api_error

    result = await db.execute(
        select(UserContract)
        .where(
            UserContract.user_id == user.id,
            UserContract.contract_id == contract_id,
        )
    )
    uc = result.scalar_one_or_none()
    if uc is None:
        raise api_error(404, "CONTRACT_NOT_FOUND", "Contract not found")

    claim_status = None
    if uc.reward_claim:
        claim_status = uc.reward_claim.get("status")

    return {
        "status": uc.status,
        "claim_status": claim_status,
    }
