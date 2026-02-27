"""
Arrow Puzzle - Game API

Игровые эндпоинты: уровни, завершение, энергия, подсказки.
"""

import time
from datetime import datetime
from typing import Any, List

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
# Используем загрузчик файлов вместо генератора
from ..services.level_loader import load_level_from_file
from ..services.generator import get_hint as get_hint_arrow, get_free_arrows


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
    # Если energy_updated_at None (старые юзеры), ставим сейчас
    if not user.energy_updated_at:
        user.energy_updated_at = now
        
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


def normalize_difficulty_tier(value: Any) -> str:
    """Normalizes backend level difficulty into a stable tier key."""
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
        difficulty = float(value)
        if difficulty <= 3:
            return "easy"
        if difficulty <= 6:
            return "normal"
        if difficulty <= 8:
            return "hard"
        if difficulty <= 10:
            return "extreme"
        return "impossible"

    return "normal"


def coins_by_difficulty(value: Any) -> int:
    tier = normalize_difficulty_tier(value)
    if tier == "easy":
        return settings.COINS_REWARD_EASY
    if tier == "hard":
        return settings.COINS_REWARD_HARD
    if tier == "extreme":
        return settings.COINS_REWARD_EXTREME
    if tier == "impossible":
        return settings.COINS_REWARD_IMPOSSIBLE
    return settings.COINS_REWARD_NORMAL


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
    Получить данные уровня из файла.
    (Strict Linear Mode: only current unlocked level is accessible)
    """
    if level_num < 1:
        raise HTTPException(status_code=400, detail="Invalid level number")
    if level_num != user.current_level:
        raise HTTPException(status_code=403, detail="Level not unlocked")
    
    print(f"🎮 Loading level {level_num} for user {user.id}")
    
    # Загружаем из файла
    level_data = load_level_from_file(level_num)
    
    # Если уровня нет - 404 (Фронт покажет "Конец контента")
    if not level_data:
        print(f"❌ Level {level_num} file not found")
        raise HTTPException(status_code=404, detail="Level not found (End of content)")
    
    print(f"✅ Level {level_num} loaded successfully")

    # Конвертируем в Pydantic схемы
    try:
        grid_data = level_data["grid"]
        grid_obj = Grid(
            width=grid_data["width"], 
            height=grid_data["height"],
            void_cells=[Cell(x=c["x"], y=c["y"]) for c in grid_data["void_cells"]]
        )

        arrows_obj = [
            Arrow(
                id=a["id"],
                cells=[Cell(x=c["x"], y=c["y"]) for c in a["cells"]],
                direction=a["direction"],
                type=a["type"],
                color=a["color"],
                frozen=a["frozen"]
            ) for a in level_data["arrows"]
        ]
        
        meta_obj = LevelMeta(
            difficulty=level_data["meta"]["difficulty"],
            arrow_count=level_data["meta"]["arrow_count"],
            special_arrow_count=0,
            dag_depth=1
        )

        return LevelResponse(
            level=level_num,
            seed=level_data["seed"],
            grid=grid_obj,
            arrows=arrows_obj,
            meta=meta_obj
        )
    except Exception as e:
        print(f"❌ Serialization error: {e}")
        raise HTTPException(status_code=500, detail=f"Level data error: {str(e)}")


@router.post("/start/{level_num}")
async def start_level(
    level_num: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Начать уровень - тратит энергию."""
    if level_num != user.current_level:
        raise HTTPException(status_code=403, detail="Level not unlocked")
    
    # Проверяем и тратим энергию
    if not await spend_energy(user, db):
        raise HTTPException(status_code=402, detail="Not enough energy")
    
    # Записываем попытку
    attempt = LevelAttempt(
        user_id=user.id,
        level_number=level_num,
        seed=level_num,
        result="pending"
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
    Завершить уровень и сохранить прогресс.
    """
    # Lock user row to make reward logic atomic under concurrent requests.
    locked_user_result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    locked_user = locked_user_result.scalar_one_or_none()
    if not locked_user:
        raise HTTPException(status_code=401, detail="User not found")

    user = locked_user
    level_num = request.level

    if level_num < 1:
        return CompleteResponse(valid=False, error="Invalid level number")
    if request.time_seconds <= 0:
        return CompleteResponse(valid=False, error="Invalid completion time")
    if level_num != user.current_level:
        return CompleteResponse(valid=False, error="Level not unlocked")
    
    # One reward per level: repeated valid submissions should not grant rewards again.
    rewarded_attempt_result = await db.execute(
        select(LevelAttempt.id).where(
            LevelAttempt.user_id == user.id,
            LevelAttempt.level_number == level_num,
            LevelAttempt.result == "win",
        ).limit(1)
    )
    already_rewarded = rewarded_attempt_result.scalar_one_or_none() is not None
    if already_rewarded:
        return CompleteResponse(
            valid=True,
            stars=0,
            coins_earned=0,
            new_level_unlocked=False,
            error="ALREADY_REWARDED"
        )

    # Загружаем уровень для проверки
    level_data = load_level_from_file(level_num)
    if not level_data:
        return CompleteResponse(valid=False, error="Level data not found on server")

    if request.seed != level_data["seed"]:
        return CompleteResponse(valid=False, error="Invalid seed")

    grid_width = level_data["grid"]["width"]
    grid_height = level_data["grid"]["height"]
    total_arrows = len(level_data["arrows"])
    if len(request.moves) != total_arrows:
        return CompleteResponse(valid=False, error="Invalid move count")

    # Validate move legality step-by-step (not just set equality).
    remaining_arrows = [
        {
            **arrow,
            "id": str(arrow["id"]),
            "cells": [{"x": int(cell["x"]), "y": int(cell["y"])} for cell in arrow["cells"]],
        }
        for arrow in level_data["arrows"]
    ]

    for index, raw_move_id in enumerate(request.moves):
        move_id = str(raw_move_id)
        free_arrow_ids = {str(arrow["id"]) for arrow in get_free_arrows(remaining_arrows, grid_width, grid_height)}
        if move_id not in free_arrow_ids:
            return CompleteResponse(valid=False, error=f"Illegal move at step {index + 1}")

        remaining_arrows = [arrow for arrow in remaining_arrows if str(arrow["id"]) != move_id]

    if remaining_arrows:
        return CompleteResponse(valid=False, error="Not all arrows removed")
    
    # Расчет награды
    total_moves = len(request.moves)
    optimal_moves = level_data["meta"]["arrow_count"]
    
    mistakes = total_moves - optimal_moves
    if mistakes <= 0:
        stars = 3
    elif mistakes <= 2:
        stars = 2
    else:
        stars = 1
    
    coins_earned = coins_by_difficulty(level_data["meta"].get("difficulty"))
    
    # 🔥 СОХРАНЕНИЕ ПРОГРЕССА (БУХГАЛТЕР)
    new_level = False
    
    # Если прошли уровень, который равен ИЛИ БОЛЬШЕ текущего максимального -> повышаем планку
    # Пример: Был на 1, прошел 5 -> Теперь на 6.
    if level_num == user.current_level:
        user.current_level = level_num + 1
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
        if mistakes <= 0 and hasattr(stats, "perfect_levels"):
            stats.perfect_levels += 1
    
    # Сохраняем попытку
    attempt = LevelAttempt(
        user_id=user.id,
        level_number=level_num,
        seed=request.seed,
        result="win",
        moves_count=total_moves,
        mistakes_count=mistakes,
        time_seconds=request.time_seconds,
        moves_log=request.moves
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
    Получить подсказку.
    """
    # Загружаем уровень
    level_data = load_level_from_file(request.level)
    if not level_data:
        raise HTTPException(status_code=404, detail="Level not found")
    
    # Фильтруем оставшиеся стрелки
    remaining = [a for a in level_data["arrows"] if str(a["id"]) in request.remaining_arrows]
    
    if not remaining:
        raise HTTPException(status_code=400, detail="No arrows remaining")
    
    # Получаем безопасную стрелку через алгоритм
    hint_arrow_id = get_hint_arrow(
        remaining, 
        level_data["grid"]["width"], 
        level_data["grid"]["height"]
    )

    if not hint_arrow_id:
        raise HTTPException(status_code=500, detail="No valid move found")

    return HintResponse(arrow_id=hint_arrow_id)

@router.post("/reset")
async def reset_progress(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    🛠 DEV: Сброс прогресса пользователя на 1 уровень.
    """
    user.current_level = 1
    user.coins = settings.INITIAL_COINS
    user.total_stars = 0
    # user.energy = settings.MAX_ENERGY # Раскомментируй, если нужно сбрасывать и энергию
    
    # Очищаем статистику (опционально, но полезно для тестов)
    result = await db.execute(select(UserStats).where(UserStats.user_id == user.id))
    stats = result.scalar_one_or_none()
    if stats:
        stats.levels_completed = 0
        stats.total_moves = 0
        stats.total_mistakes = 0
    
    await db.commit()
    print(f"♻️ User {user.id} progress reset to Level 1")
    
    return {"success": True, "level": 1}

@router.post("/undo")
async def undo_move(
    user: User = Depends(get_current_user)
):
    """Отменить последний ход (обрабатывается на клиенте)."""
    # Undo обрабатывается на клиенте через history
    return {"success": True}
