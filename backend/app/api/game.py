"""
Arrow Puzzle - Game API (OPTIMIZED)

Изменения:
1. validate_moves_fast() — линейная валидация через dependency graph
2. /complete-and-next — атомарный endpoint (проверка + следующий уровень)
3. Кэш уровней в памяти (LRU)
"""

import time
from datetime import datetime
from functools import lru_cache
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from ..config import settings
from ..database import get_db, get_redis
from ..models import User, UserStats, LevelAttempt, Referral
from ..schemas import (
    LevelResponse, CompleteRequest, CompleteResponse, CompleteAndNextResponse,
    EnergyResponse, HintRequest, HintResponse,
    Grid, Arrow, Cell, LevelMeta
)
from .auth import get_current_user
from ..services.level_loader import load_level_from_file
from ..services.generator import get_hint as get_hint_arrow, get_free_arrows


router = APIRouter(prefix="/game", tags=["game"])


# ============================================
# LEVEL CACHE (in-memory LRU)
# ============================================

@lru_cache(maxsize=256)
def _cached_level(level_num: int) -> Optional[Dict]:
    """LRU кэш загруженных уровней. JSON файлы не меняются в рантайме."""
    return load_level_from_file(level_num)


def get_cached_level(level_num: int) -> Optional[Dict]:
    return _cached_level(level_num)


# ============================================
# FAST MOVE VALIDATION (Dependency Graph)
# ============================================

def _build_dependency_graph(
    arrows: List[Dict],
    grid_width: int,
    grid_height: int,
) -> Tuple[Dict[str, Set[str]], Dict[str, Set[str]]]:
    """
    Строит граф зависимостей за ОДИН проход.
    
    Returns:
        blockers_of:  arrow_id → set of arrow_ids that block it
        dependents_of: arrow_id → set of arrow_ids that depend on it (it blocks them)
    """
    DIRECTION_VECTORS = {
        "up": (0, -1), "down": (0, 1),
        "left": (-1, 0), "right": (1, 0),
    }

    # 1. Строим cell_map один раз
    cell_map: Dict[Tuple[int, int], str] = {}
    arrow_cells: Dict[str, Set[Tuple[int, int]]] = {}

    for arrow in arrows:
        aid = str(arrow["id"])
        cells = set()
        for c in arrow["cells"]:
            pos = (int(c["x"]), int(c["y"]))
            cell_map[pos] = aid
            cells.add(pos)
        arrow_cells[aid] = cells

    # 2. Для каждой стрелки находим блокеров по направлению головы
    blockers_of: Dict[str, Set[str]] = {}
    dependents_of: Dict[str, Set[str]] = {}

    for arrow in arrows:
        aid = str(arrow["id"])
        direction = arrow.get("direction")
        if not direction or direction not in DIRECTION_VECTORS:
            blockers_of[aid] = set()
            continue

        head_x = int(arrow["cells"][0]["x"])
        head_y = int(arrow["cells"][0]["y"])
        dx, dy = DIRECTION_VECTORS[direction]
        own_cells = arrow_cells[aid]

        blocker_ids: Set[str] = set()
        x, y = head_x + dx, head_y + dy
        while 0 <= x < grid_width and 0 <= y < grid_height:
            pos = (x, y)
            if pos in cell_map:
                other = cell_map[pos]
                if other != aid and pos not in own_cells:
                    blocker_ids.add(other)
            x += dx
            y += dy

        blockers_of[aid] = blocker_ids

    # 3. Строим обратный индекс
    for aid in blockers_of:
        dependents_of.setdefault(aid, set())
    for aid, blockers in blockers_of.items():
        for b in blockers:
            dependents_of.setdefault(b, set()).add(aid)

    return blockers_of, dependents_of


def validate_moves_fast(
    arrows: List[Dict],
    moves: List[str],
    grid_width: int,
    grid_height: int,
) -> Tuple[bool, Optional[str]]:
    """
    Проверяет последовательность ходов за ~O(N × avg_path_length) вместо O(N²).
    
    Алгоритм:
    1. Однократно строим граф зависимостей
    2. Для каждого хода:
       - Проверяем что blocker_count == 0 (стрелка свободна)
       - Уменьшаем blocker_count у всех зависимых
    """
    all_ids = {str(a["id"]) for a in arrows}

    if len(moves) != len(all_ids):
        return False, f"Expected {len(all_ids)} moves, got {len(moves)}"

    if set(moves) != all_ids:
        return False, "Move IDs don't match arrow IDs"

    # Строим граф один раз
    blockers_of, dependents_of = _build_dependency_graph(arrows, grid_width, grid_height)

    # Счётчик активных блокеров (только те что ещё не удалены)
    blocker_count: Dict[str, int] = {}
    for aid, blockers in blockers_of.items():
        blocker_count[aid] = len(blockers & all_ids)  # только существующие

    removed: Set[str] = set()

    for step, move_id in enumerate(moves):
        mid = str(move_id)

        if mid in removed:
            return False, f"Step {step + 1}: arrow '{mid}' already removed"

        if mid not in all_ids:
            return False, f"Step {step + 1}: unknown arrow '{mid}'"

        # Стрелка должна быть свободна
        if blocker_count.get(mid, 0) > 0:
            return False, f"Step {step + 1}: arrow '{mid}' is blocked"

        # Удаляем стрелку — уменьшаем счётчики зависимых
        removed.add(mid)
        for dep_id in dependents_of.get(mid, set()):
            if dep_id not in removed:
                blocker_count[dep_id] = max(0, blocker_count.get(dep_id, 0) - 1)

    if len(removed) != len(all_ids):
        return False, "Not all arrows removed"

    return True, None


# ============================================
# HELPERS (без изменений, сокращено для читаемости)
# ============================================

def calculate_energy_recovery(user: User) -> tuple[int, int]:
    if user.energy >= settings.MAX_ENERGY:
        return settings.MAX_ENERGY, 0
    now = datetime.utcnow()
    if not user.energy_updated_at:
        user.energy_updated_at = now
    elapsed = (now - user.energy_updated_at).total_seconds()
    recovered = int(elapsed // (settings.ENERGY_RECOVERY_MINUTES * 60))
    current = min(user.energy + recovered, settings.MAX_ENERGY)
    if current >= settings.MAX_ENERGY:
        seconds_to_next = 0
    else:
        remainder = elapsed % (settings.ENERGY_RECOVERY_MINUTES * 60)
        seconds_to_next = int(settings.ENERGY_RECOVERY_MINUTES * 60 - remainder)
    return current, seconds_to_next


def normalize_difficulty_tier(value: Any) -> str:
    if isinstance(value, str):
        text = " ".join(value.strip().lower().replace("ё", "е").split())
        if text in {"легкий", "easy"}:
            return "easy"
        if text in {"нормальный", "normal", "medium", "mid"}:
            return "normal"
        if text in {"сложный", "hard"}:
            return "hard"
        if text in {"экстремальный", "extreme"}:
            return "extreme"
        if text in {"невозможный", "impossible"}:
            return "impossible"
        return "normal"
    if isinstance(value, (int, float)):
        d = float(value)
        if d <= 3: return "easy"
        if d <= 6: return "normal"
        if d <= 8: return "hard"
        if d <= 10: return "extreme"
        return "impossible"
    return "normal"


def coins_by_difficulty(value: Any) -> int:
    tier = normalize_difficulty_tier(value)
    mapping = {
        "easy": settings.COINS_REWARD_EASY,
        "hard": settings.COINS_REWARD_HARD,
        "extreme": settings.COINS_REWARD_EXTREME,
        "impossible": settings.COINS_REWARD_IMPOSSIBLE,
    }
    return mapping.get(tier, settings.COINS_REWARD_NORMAL)


async def update_energy(user: User, db: AsyncSession) -> int:
    current, _ = calculate_energy_recovery(user)
    if current != user.energy:
        user.energy = current
        user.energy_updated_at = datetime.utcnow()
        await db.commit()
    return current


async def spend_energy(user: User, db: AsyncSession) -> bool:
    current = await update_energy(user, db)
    if current <= 0:
        return False
    user.energy = current - 1
    user.energy_updated_at = datetime.utcnow()
    await db.commit()
    return True


async def check_referral_confirmation(user: User, completed_level: int, db: AsyncSession) -> bool:
    if completed_level < settings.REFERRAL_CONFIRM_LEVEL:
        return False
    result = await db.execute(
        select(Referral).where(
            Referral.invitee_id == user.id,
            Referral.status == "pending",
        )
    )
    referral = result.scalar_one_or_none()
    if not referral:
        return False
    referral.status = "confirmed"
    referral.confirmed_at = datetime.utcnow()
    if referral.inviter_id:
        inviter = await db.get(User, referral.inviter_id)
        if inviter and not inviter.is_banned:
            inviter.coins += settings.REFERRAL_REWARD_INVITER
            inviter.referrals_earnings += settings.REFERRAL_REWARD_INVITER
            inviter.referrals_count += 1
            inviter.referrals_pending = max(0, inviter.referrals_pending - 1)
            inviter.last_referral_confirmed_at = referral.confirmed_at
            referral.inviter_bonus_paid = True
        elif inviter:
            inviter.referrals_count += 1
            inviter.referrals_pending = max(0, inviter.referrals_pending - 1)
            inviter.last_referral_confirmed_at = referral.confirmed_at
            referral.inviter_bonus_paid = False
    return True


def is_dev_level_unlock_bypass_active(x_dev_user_id: str | None) -> bool:
    return settings.dev_auth_active and bool(x_dev_user_id)


def _serialize_level_response(level_num: int, level_data: Dict) -> LevelResponse:
    """Конвертирует dict уровня в Pydantic LevelResponse."""
    grid_data = level_data["grid"]
    grid_obj = Grid(
        width=grid_data["width"],
        height=grid_data["height"],
        void_cells=[Cell(x=c["x"], y=c["y"]) for c in grid_data.get("void_cells", [])],
    )
    arrows_obj = [
        Arrow(
            id=a["id"],
            cells=[Cell(x=c["x"], y=c["y"]) for c in a["cells"]],
            direction=a["direction"],
            type=a.get("type", "normal"),
            color=a.get("color", "#FFFFFF"),
            frozen=a.get("frozen", False),
        )
        for a in level_data["arrows"]
    ]
    meta_obj = LevelMeta(
        difficulty=level_data["meta"]["difficulty"],
        arrow_count=level_data["meta"]["arrow_count"],
        special_arrow_count=level_data["meta"].get("special_arrow_count", 0),
        dag_depth=level_data["meta"].get("dag_depth", 1),
    )
    return LevelResponse(
        level=level_num,
        seed=level_data["seed"],
        grid=grid_obj,
        arrows=arrows_obj,
        meta=meta_obj,
    )


# ============================================
# CORE: complete + reward logic (extracted)
# ============================================

async def _do_complete(
    user: User,
    request: CompleteRequest,
    db: AsyncSession,
    allow_locked_level_debug: bool = False,
) -> tuple[CompleteResponse, Dict[str, Any]]:
    """
    Вся логика завершения уровня, вынесенная для переиспользования
    в /complete и /complete-and-next.
    
    Предполагает что user уже залочен (FOR UPDATE).
    """
    level_num = request.level
    metrics: Dict[str, Any] = {
        "level": level_num,
        "arrow_count": 0,
        "validation_ms": 0.0,
        "already_completed": False,
    }

    if level_num < 1:
        return (
            CompleteResponse(valid=False, current_level=user.current_level, error="Invalid level number"),
            metrics,
        )
    if request.time_seconds <= 0:
        return (
            CompleteResponse(valid=False, current_level=user.current_level, error="Invalid completion time"),
            metrics,
        )

    # Idempotency: уже награждён?
    if allow_locked_level_debug and level_num > user.current_level:
        user.current_level = level_num

    rewarded = await db.execute(
        select(LevelAttempt.id).where(
            LevelAttempt.user_id == user.id,
            LevelAttempt.level_number == level_num,
            LevelAttempt.result == "win",
        ).limit(1)
    )
    if rewarded.scalar_one_or_none() is not None:
        metrics["already_completed"] = True
        return (
            CompleteResponse(
                valid=True,
                stars=0,
                coins_earned=0,
                total_coins=user.coins,
                current_level=user.current_level,
                new_level_unlocked=False,
                already_completed=True,
                error=None,
            ),
            metrics,
        )

    if level_num != user.current_level:
        return (
            CompleteResponse(valid=False, current_level=user.current_level, error="Level not unlocked"),
            metrics,
        )

    # Загружаем уровень (кэш)
    level_data = get_cached_level(level_num)
    if not level_data:
        return (
            CompleteResponse(valid=False, current_level=user.current_level, error="Level data not found on server"),
            metrics,
        )

    if request.seed != level_data["seed"]:
        return (
            CompleteResponse(valid=False, current_level=user.current_level, error="Invalid seed"),
            metrics,
        )

    grid_width = level_data["grid"]["width"]
    grid_height = level_data["grid"]["height"]
    arrows_raw = level_data["arrows"]
    metrics["arrow_count"] = len(arrows_raw)

    if len(request.moves) != len(arrows_raw):
        return (
            CompleteResponse(valid=False, current_level=user.current_level, error="Invalid move count"),
            metrics,
        )

    # ===== БЫСТРАЯ ВАЛИДАЦИЯ через dependency graph =====
    t0 = time.monotonic()

    normalized_arrows = [
        {
            **arrow,
            "id": str(arrow["id"]),
            "cells": [{"x": int(c["x"]), "y": int(c["y"])} for c in arrow["cells"]],
        }
        for arrow in arrows_raw
    ]

    valid, error_msg = validate_moves_fast(
        normalized_arrows,
        [str(m) for m in request.moves],
        grid_width,
        grid_height,
    )

    elapsed_ms = (time.monotonic() - t0) * 1000
    metrics["validation_ms"] = round(elapsed_ms, 1)
    print(f"[Validation] level={level_num} arrow_count={len(arrows_raw)} validation_ms={elapsed_ms:.1f} valid={valid}")

    if not valid:
        return (
            CompleteResponse(valid=False, current_level=user.current_level, error=error_msg or "Invalid moves"),
            metrics,
        )

    # Расчёт награды
    total_moves = len(request.moves)
    optimal_moves = level_data["meta"]["arrow_count"]
    mistakes = total_moves - optimal_moves
    stars = 3 if mistakes <= 0 else (2 if mistakes <= 2 else 1)
    coins_earned = coins_by_difficulty(level_data["meta"].get("difficulty"))

    # Сохранение прогресса
    new_level = False
    if level_num == user.current_level:
        user.current_level = level_num + 1
        new_level = True

    user.total_stars += stars
    user.coins += coins_earned

    # Статистика
    result = await db.execute(select(UserStats).where(UserStats.user_id == user.id))
    stats = result.scalar_one_or_none()
    if stats:
        stats.levels_completed += 1
        stats.total_moves += total_moves
        stats.total_mistakes += mistakes
        if mistakes <= 0 and hasattr(stats, "perfect_levels"):
            stats.perfect_levels += 1

    # Попытка
    attempt = LevelAttempt(
        user_id=user.id,
        level_number=level_num,
        seed=request.seed,
        result="win",
        moves_count=total_moves,
        mistakes_count=mistakes,
        time_seconds=request.time_seconds,
        moves_log=request.moves,
    )
    db.add(attempt)

    referral_confirmed = await check_referral_confirmation(user, level_num, db)
    await db.commit()

    return (
        CompleteResponse(
            valid=True,
            stars=stars,
            coins_earned=coins_earned,
            total_coins=user.coins,
            current_level=user.current_level,
            new_level_unlocked=new_level,
            already_completed=False,
            referral_confirmed=referral_confirmed,
        ),
        metrics,
    )


# ============================================
# ENDPOINTS
# ============================================

@router.get("/level/{level_num}", response_model=LevelResponse)
async def get_level(
    level_num: int,
    x_dev_user_id: str | None = Header(None, alias="X-Dev-User-Id"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    allow_locked = is_dev_level_unlock_bypass_active(x_dev_user_id)
    if level_num < 1:
        raise HTTPException(status_code=400, detail="Invalid level number")
    if level_num != user.current_level and not allow_locked:
        raise HTTPException(status_code=403, detail="Level not unlocked")

    level_data = get_cached_level(level_num)
    if not level_data:
        raise HTTPException(status_code=404, detail="Level not found (End of content)")

    try:
        return _serialize_level_response(level_num, level_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Level data error: {str(e)}")


@router.post("/complete", response_model=CompleteResponse)
async def complete_level(
    request: CompleteRequest,
    x_dev_user_id: str | None = Header(None, alias="X-Dev-User-Id"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    locked_user_result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    locked_user = locked_user_result.scalar_one_or_none()
    if not locked_user:
        raise HTTPException(status_code=401, detail="User not found")

    endpoint_started = time.monotonic()
    completion, metrics = await _do_complete(
        locked_user,
        request,
        db,
        allow_locked_level_debug=is_dev_level_unlock_bypass_active(x_dev_user_id),
    )
    endpoint_ms = (time.monotonic() - endpoint_started) * 1000
    print(
        f"[Complete] level={metrics['level']} arrow_count={metrics['arrow_count']} "
        f"validation_ms={metrics['validation_ms']:.1f} endpoint_ms={endpoint_ms:.1f} "
        f"already_completed={metrics['already_completed']}"
    )
    return completion


@router.post("/complete-and-next", response_model=CompleteAndNextResponse)
async def complete_and_next(
    request: CompleteRequest,
    x_dev_user_id: str | None = Header(None, alias="X-Dev-User-Id"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Атомарный endpoint: проверить победу → сохранить → вернуть следующий уровень.
    Один запрос вместо двух (complete + getLevel).
    
    Response:
    {
      "completion": { ...CompleteResponse },
      "next_level": { ...LevelResponse } | null
    }
    """
    locked_user_result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    locked_user = locked_user_result.scalar_one_or_none()
    if not locked_user:
        raise HTTPException(status_code=401, detail="User not found")

    # 1. Проверяем и сохраняем
    endpoint_started = time.monotonic()
    completion, metrics = await _do_complete(
        locked_user,
        request,
        db,
        allow_locked_level_debug=is_dev_level_unlock_bypass_active(x_dev_user_id),
    )

    # 2. Если валидно — сразу отдаём следующий уровень
    next_level_data = None
    next_level_exists = False
    next_level_prefetched = False
    if completion.valid:
        next_num = completion.current_level
        raw = get_cached_level(next_num)
        if raw:
            next_level_exists = True
            try:
                next_level_data = _serialize_level_response(next_num, raw)
                next_level_prefetched = True
            except Exception:
                next_level_data = None

    endpoint_ms = (time.monotonic() - endpoint_started) * 1000
    print(
        f"[CompleteAndNext] level={metrics['level']} arrow_count={metrics['arrow_count']} "
        f"validation_ms={metrics['validation_ms']:.1f} endpoint_ms={endpoint_ms:.1f} "
        f"already_completed={metrics['already_completed']} "
        f"next_level_exists={next_level_exists} next_level_prefetched={next_level_prefetched}"
    )

    return CompleteAndNextResponse(
        completion=completion,
        next_level=next_level_data,
        next_level_exists=next_level_exists,
    )


@router.post("/start/{level_num}")
async def start_level(
    level_num: int,
    x_dev_user_id: str | None = Header(None, alias="X-Dev-User-Id"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    allow_locked = is_dev_level_unlock_bypass_active(x_dev_user_id)
    if level_num != user.current_level and not allow_locked:
        raise HTTPException(status_code=403, detail="Level not unlocked")
    if not await spend_energy(user, db):
        raise HTTPException(status_code=402, detail="Not enough energy")
    attempt = LevelAttempt(
        user_id=user.id, level_number=level_num,
        seed=level_num, result="pending",
    )
    db.add(attempt)
    await db.commit()
    return {"success": True, "attempt_id": attempt.id}


@router.get("/energy", response_model=EnergyResponse)
async def get_energy(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current, seconds = calculate_energy_recovery(user)
    if current != user.energy:
        user.energy = current
        user.energy_updated_at = datetime.utcnow()
        await db.commit()
    return EnergyResponse(
        energy=current, max_energy=settings.MAX_ENERGY,
        seconds_to_next=seconds,
    )


@router.post("/energy/restore")
async def restore_energy(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current, _ = calculate_energy_recovery(user)
    if current >= settings.MAX_ENERGY:
        return {"success": False, "message": "Energy is full"}
    user.energy = min(current + 1, settings.MAX_ENERGY)
    user.energy_updated_at = datetime.utcnow()
    await db.commit()
    return {"success": True, "energy": user.energy}


@router.post("/hint", response_model=HintResponse)
async def get_hint(
    request: HintRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Атомарный декремент hint_balance
    result = await db.execute(
        update(User)
        .where(User.id == user.id, User.hint_balance > 0)
        .values(hint_balance=User.hint_balance - 1)
        .returning(User.hint_balance)
    )
    row = result.first()
    if row is None:
        raise HTTPException(status_code=409, detail="No hints available")

    new_balance = row[0]

    level_data = get_cached_level(request.level)
    if not level_data:
        raise HTTPException(status_code=404, detail="Level not found")
    remaining = [a for a in level_data["arrows"] if str(a["id"]) in request.remaining_arrows]
    if not remaining:
        raise HTTPException(status_code=400, detail="No arrows remaining")
    hint_arrow_id = get_hint_arrow(remaining, level_data["grid"]["width"], level_data["grid"]["height"])
    if not hint_arrow_id:
        raise HTTPException(status_code=500, detail="No valid move found")

    await db.commit()
    return HintResponse(arrow_id=hint_arrow_id, hint_balance=new_balance)


@router.post("/reset")
async def reset_progress(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user.current_level = 1
    user.coins = settings.INITIAL_COINS
    user.total_stars = 0
    result = await db.execute(select(UserStats).where(UserStats.user_id == user.id))
    stats = result.scalar_one_or_none()
    if stats:
        stats.levels_completed = 0
        stats.total_moves = 0
        stats.total_mistakes = 0
    await db.commit()
    return {"success": True, "level": 1}


@router.post("/undo")
async def undo_move(user: User = Depends(get_current_user)):
    return {"success": True}
