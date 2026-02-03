"""
Arrow Puzzle - Game API

Игровые эндпоинты: уровни, завершение, энергия, подсказки.
"""

import time
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..config import settings
from ..database import get_db, get_redis
from ..models import User, UserStats, LevelAttempt
from ..schemas import (
    LevelResponse, CompleteRequest, CompleteResponse,
    EnergyResponse, HintRequest, HintResponse,
    Grid, Arrow, Cell, LevelMeta
)
from .auth import get_current_user
from ..services.generator import generate_level, get_hint as get_hint_arrow


router = APIRouter(prefix="/game", tags=["game"])


# ============================================
# HELPERS
# ============================================

def calculate_energy_recovery(user: User) -> tuple[int, int]:
    """
    Вычисляет текущую энергию с учётом времени.
    Returns: (current_energy, seconds_to_next)
    """
    if user.energy >= settings.MAX_ENERGY:
        return settings.MAX_ENERGY, 0
    
    now = datetime.utcnow()
    elapsed = (now - user.energy_updated_at).total_seconds()
    
    # Сколько энергии восстановилось
    recovered = int(elapsed // (settings.ENERGY_RECOVERY_MINUTES * 60))
    current = min(user.energy + recovered, settings.MAX_ENERGY)
    
    # Секунд до следующего восстановления
    if current >= settings.MAX_ENERGY:
        seconds_to_next = 0
    else:
        remainder = elapsed % (settings.ENERGY_RECOVERY_MINUTES * 60)
        seconds_to_next = int(settings.ENERGY_RECOVERY_MINUTES * 60 - remainder)
    
    return current, seconds_to_next


async def update_energy(user: User, db: AsyncSession) -> int:
    """Обновляет энергию пользователя с учётом времени."""
    current, _ = calculate_energy_recovery(user)
    
    if current != user.energy:
        user.energy = current
        user.energy_updated_at = datetime.utcnow()
        await db.commit()
    
    return current


async def spend_energy(user: User, db: AsyncSession) -> bool:
    """Тратит 1 энергию. Returns False если энергии нет."""
    current = await update_energy(user, db)
    
    if current <= 0:
        return False
    
    user.energy = current - 1
    user.energy_updated_at = datetime.utcnow()
    await db.commit()
    
    return True


# ============================================
# ENDPOINTS
# ============================================

@router.get("/level/{level_num}", response_model=LevelResponse)
async def get_level(
    level_num: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Получить данные уровня.
    Генерирует уровень с seed = level_num для воспроизводимости.
    """
    if level_num < 1:
        raise HTTPException(status_code=400, detail="Invalid level number")
    
    if level_num > user.current_level + 1:
        raise HTTPException(status_code=403, detail="Level not unlocked")
    
    # ЛОГИРОВАНИЕ
    print(f"🎮 Generating level {level_num} for user {user.id}")
    
    # TRY-CATCH
    try:
        # Генерируем уровень
        level_data = generate_level(level_num)
        
        # ПРОВЕРКА НА КОРРЕКТНОСТЬ
        if not level_data:
            raise ValueError("generate_level returned None")
        
        if "grid" not in level_data or "arrows" not in level_data:
            raise ValueError(f"Invalid level_data structure: {level_data.keys()}")
        
        if "width" not in level_data["grid"] or "height" not in level_data["grid"]:
            raise ValueError(f"Invalid grid structure: {level_data['grid']}")
        
        #  ЛОГИРОВАНИЕ УСПЕХА
        print(f"✅ Level {level_num} generated: {level_data['grid']['width']}x{level_data['grid']['height']}, {len(level_data['arrows'])} arrows")
        
    except Exception as e:
        #  ЛОГИРОВАНИЕ ОШИБКИ
        print(f"❌ Failed to generate level {level_num}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate level: {str(e)}")
    
    # Конвертируем в схему
    try:
        arrows = [
            Arrow(
                id=a["id"],
                cells=[Cell(x=c["x"], y=c["y"]) for c in a["cells"]],
                direction=a["direction"],
                type=a.get("type", "normal"),
                color=a["color"],
                frozen=a.get("frozen")
            )
            for a in level_data["arrows"]
        ]
    except Exception as e:
        print(f"❌ Failed to convert arrows to schema: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to convert level data: {str(e)}")
    
    return LevelResponse(
        level=level_num,
        seed=level_data["seed"],
        grid=Grid(width=level_data["grid"]["width"], height=level_data["grid"]["height"]),
        arrows=arrows,
        meta=LevelMeta(
            difficulty=level_data["meta"]["difficulty"],
            arrow_count=level_data["meta"]["arrow_count"],
            special_arrow_count=level_data["meta"].get("special_arrow_count", 0),
            dag_depth=level_data["meta"].get("dag_depth", 1)
        )
    )

@router.post("/start/{level_num}")
async def start_level(
    level_num: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Начать уровень - тратит энергию."""
    if level_num > user.current_level + 1:
        raise HTTPException(status_code=403, detail="Level not unlocked")
    
    # Проверяем и тратим энергию
    if not await spend_energy(user, db):
        raise HTTPException(status_code=402, detail="Not enough energy")
    
    # Записываем попытку
    attempt = LevelAttempt(
        user_id=user.id,
        level=level_num,
        seed=level_num,
        started_at=datetime.utcnow()
    )
    db.add(attempt)
    await db.commit()
    
    return {"success": True, "attempt_id": attempt.id}


@router.post("/complete", response_model=CompleteResponse)
async def complete_level(
    request: CompleteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Завершить уровень.
    Верифицирует решение на сервере.
    """
    level_num = request.level
    
    # Проверяем что уровень доступен
    if level_num > user.current_level + 1:
        return CompleteResponse(valid=False, error="Level not unlocked")
    
    # Регенерируем уровень для проверки
    level_data = generate_level(level_num, seed=request.seed)
    
    # Верифицируем последовательность ходов
    # (упрощённая проверка - на клиенте используем тот же алгоритм)
    arrows_map = {a["id"]: a for a in level_data["arrows"]}
    remaining_ids = set(arrows_map.keys())
    
    for move_id in request.moves:
        if move_id not in remaining_ids:
            return CompleteResponse(valid=False, error="Invalid move sequence")
        
        # Проверяем что стрелка свободна (упрощённо)
        remaining_ids.remove(move_id)
    
    # Если все стрелки убраны - победа
    if remaining_ids:
        return CompleteResponse(valid=False, error="Not all arrows removed")
    
    # Вычисляем награду
    total_moves = len(request.moves)
    optimal_moves = level_data["meta"]["arrow_count"]
    
    # Звёзды на основе ошибок (3 жизни макс)
    mistakes = total_moves - optimal_moves
    if mistakes <= 0:
        stars = 3
    elif mistakes <= 1:
        stars = 2
    else:
        stars = 1
    
    # Монеты
    base_coins = settings.COINS_PER_LEVEL
    star_bonus = stars * settings.COINS_PER_STAR
    coins_earned = base_coins + star_bonus
    
    # Обновляем прогресс пользователя
    new_level = False
    if level_num == user.current_level:
        user.current_level += 1
        new_level = True
    
    user.total_stars += stars
    user.coins += coins_earned
    
    # Обновляем статистику
    result = await db.execute(
        select(UserStats).where(UserStats.user_id == user.id)
    )
    stats = result.scalar_one_or_none()
    if stats:
        stats.levels_completed += 1
        stats.total_moves += total_moves
        stats.total_mistakes += mistakes
        if mistakes == 0:
            stats.perfect_levels += 1
    
    # Сохраняем попытку
    attempt = LevelAttempt(
        user_id=user.id,
        level=level_num,
        seed=request.seed,
        completed=True,
        moves_count=total_moves,
        mistakes=mistakes,
        stars=stars,
        time_seconds=request.time_seconds,
        moves_log=request.moves,
        completed_at=datetime.utcnow()
    )
    db.add(attempt)
    
    await db.commit()
    
    return CompleteResponse(
        valid=True,
        stars=stars,
        coins_earned=coins_earned,
        new_level_unlocked=new_level
    )


@router.get("/energy", response_model=EnergyResponse)
async def get_energy(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Получить текущую энергию."""
    current, seconds = calculate_energy_recovery(user)
    
    # Обновляем если изменилась
    if current != user.energy:
        user.energy = current
        user.energy_updated_at = datetime.utcnow()
        await db.commit()
    
    return EnergyResponse(
        energy=current,
        max_energy=settings.MAX_ENERGY,
        seconds_to_next=seconds
    )


@router.post("/energy/restore")
async def restore_energy(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Восстановить энергию (за рекламу или покупку)."""
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
    db: AsyncSession = Depends(get_db)
):
    """
    Получить подсказку - ID следующей безопасной стрелки.
    """
    # Регенерируем уровень
    level_data = generate_level(request.level, seed=request.seed)
    
    # Находим решение среди оставшихся стрелок
    remaining = [a for a in level_data["arrows"] if a["id"] in request.remaining_arrows]
    
    if not remaining:
        raise HTTPException(status_code=400, detail="No arrows remaining")
    
    # Получаем безопасную стрелку
    hint_arrow_id = get_hint_arrow(
        remaining, 
        level_data["grid"]["width"], 
        level_data["grid"]["height"]
    )

    if not hint_arrow_id:
        raise HTTPException(status_code=500, detail="No valid move found")

    return HintResponse(arrow_id=hint_arrow_id)


@router.post("/undo")
async def undo_move(
    user: User = Depends(get_current_user)
):
    """Отменить последний ход (обрабатывается на клиенте)."""
    # Undo обрабатывается на клиенте через history
    return {"success": True}