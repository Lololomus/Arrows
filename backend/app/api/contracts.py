"""Contracts API — пользовательские эндпоинты системы контрактов (фрагментов)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..schemas import (
    ContractDto,
    ContractStateResponse,
    ContractCollectResponse,
    ContractStatusResponse,
    ContractsListResponse,
    ContractStageDto,
    UserContractStateDto,
    ContractReadinessItem,
    ContractsReadinessResponse,
)
from ..services.contracts import (
    get_contracts_list,
    activate_contract,
    complete_stage,
    collect_reward,
    get_contract_status,
    _build_user_state,
)
from ..services.contracts_catalog import CONTRACTS, get_contract
from ..config import settings
from .auth import get_current_user
from ..models import User, UserContract

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/contracts", tags=["contracts"])


def _to_stage_dto(s: dict) -> ContractStageDto:
    return ContractStageDto(
        index=s["index"],
        metric=s["metric"],
        target=s["target"],
        title_ru=s.get("title_ru", ""),
        title_en=s.get("title_en", ""),
        progress_current=s["progress_current"],
        is_current=s["is_current"],
        is_completed=s["is_completed"],
        is_completable=s["is_completable"],
        snapshot_value=s.get("snapshot_value"),
    )


def _to_user_state_dto(state: dict) -> UserContractStateDto:
    return UserContractStateDto(
        status=state["status"],
        current_stage_index=state["current_stage_index"],
        stages=[_to_stage_dto(s) for s in state["stages"]],
        activated_at=state["activated_at"],
        completed_at=state.get("completed_at"),
        reward_claim_status=state.get("reward_claim_status"),
        has_pending_action=state["has_pending_action"],
    )


def _to_contract_dto(c: dict) -> ContractDto:
    return ContractDto(
        id=c["id"],
        type=c["type"],
        title_ru=c["title_ru"],
        title_en=c["title_en"],
        emoji=c["emoji"],
        gift_star_cost=c["gift_star_cost"],
        total_quantity=c["total_quantity"],
        remaining_quantity=c["remaining_quantity"],
        stages_count=c["stages_count"],
        has_active_elsewhere=c["has_active_elsewhere"],
        user_state=_to_user_state_dto(c["user_state"]) if c.get("user_state") else None,
    )


async def _get_remaining_quantity(contract_id: str, total_quantity: int, db: AsyncSession) -> int:
    """Вернуть точный остаток слотов для контракта."""
    used = await db.scalar(
        select(func.count(UserContract.id)).where(UserContract.contract_id == contract_id)
    )
    return max(0, total_quantity - (used or 0))


async def _uc_to_contract_dto(user: User, uc: UserContract, db: AsyncSession) -> ContractDto:
    """Конвертировать UserContract + User в ContractDto (для ответов после мутаций)."""
    contract_def = get_contract(uc.contract_id)
    if contract_def is None:
        raise ValueError(f"Contract {uc.contract_id} not found in catalog")

    user_state = _build_user_state(user, contract_def, uc)
    remaining = await _get_remaining_quantity(uc.contract_id, contract_def["total_quantity"], db)

    return ContractDto(
        id=contract_def["id"],
        type=contract_def["type"],
        title_ru=contract_def.get("title_ru", contract_def["id"]),
        title_en=contract_def.get("title_en", contract_def["id"]),
        emoji=contract_def["emoji"],
        gift_star_cost=contract_def["gift_star_cost"],
        total_quantity=contract_def["total_quantity"],
        remaining_quantity=remaining,
        stages_count=len(contract_def["stages"]),
        has_active_elsewhere=False,
        user_state=_to_user_state_dto(user_state),
    )


# ============================================
# GET /contracts/readiness  (admin, no auth)
# ============================================

@router.get("/readiness", response_model=ContractsReadinessResponse, include_in_schema=True)
async def contracts_readiness():
    """
    Показывает какие контракты готовы к работе (gift_id настроен).
    Используется администратором для проверки перед запуском.
    В production telegram_gift_id обязателен для каждого контракта.
    """
    is_prod = settings.ENVIRONMENT != "development"
    items = []

    for c in CONTRACTS:
        issues = []
        if is_prod and not c.get("telegram_gift_id"):
            issues.append("telegram_gift_id не задан — подарок не будет отправлен")
        if not c.get("stages"):
            issues.append("нет этапов (stages пустой)")

        items.append(ContractReadinessItem(
            id=c["id"],
            title_ru=c.get("title_ru", c["id"]),
            emoji=c["emoji"],
            ready=len(issues) == 0,
            issues=issues,
        ))

    return ContractsReadinessResponse(
        all_ready=all(item.ready for item in items),
        contracts=items,
    )


# ============================================
# GET /contracts/
# ============================================

@router.get("/", response_model=ContractsListResponse)
async def list_contracts(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    contracts_data, has_pending_action = await get_contracts_list(user, db)
    return ContractsListResponse(
        contracts=[_to_contract_dto(c) for c in contracts_data],
        has_pending_action=has_pending_action,
    )


# ============================================
# POST /contracts/{contract_id}/activate
# ============================================

@router.post("/{contract_id}/activate", response_model=ContractStateResponse)
async def activate(
    contract_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    uc = await activate_contract(user, contract_id, db)
    return ContractStateResponse(contract=await _uc_to_contract_dto(user, uc, db))


# ============================================
# POST /contracts/{contract_id}/complete-stage
# ============================================

@router.post("/{contract_id}/complete-stage", response_model=ContractStateResponse)
async def complete_stage_endpoint(
    contract_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    uc = await complete_stage(user, contract_id, db)
    return ContractStateResponse(contract=await _uc_to_contract_dto(user, uc, db))


# ============================================
# POST /contracts/{contract_id}/collect
# ============================================

@router.post("/{contract_id}/collect", response_model=ContractCollectResponse)
async def collect(
    contract_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    claim_status = await collect_reward(user, contract_id, db)
    return ContractCollectResponse(claim_status=claim_status)


# ============================================
# GET /contracts/{contract_id}/status
# ============================================

@router.get("/{contract_id}/status", response_model=ContractStatusResponse)
async def contract_status(
    contract_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    status_data = await get_contract_status(user, contract_id, db)
    return ContractStatusResponse(
        status=status_data["status"],
        claim_status=status_data.get("claim_status"),
    )
