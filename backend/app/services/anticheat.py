"""
Arrow Puzzle - Anti-Cheat System

Детекция читеров и подозрительной активности.
"""

from datetime import datetime, timedelta
from typing import List, Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from ..models import User, LevelAttempt, UserStats
from ..config import settings
from ..services.generator import generate_level, get_full_solution


# ============================================
# ANTI-CHEAT VALIDATORS
# ============================================

async def validate_level_completion(
    user: User,
    level: int,
    seed: int,
    moves: List[str],
    time_seconds: int,
    db: AsyncSession
) -> Dict[str, any]:
    """
    Валидация прохождения уровня (anti-cheat).
    
    Returns:
        {
            "valid": bool,
            "reason": str,
            "suspicious": bool,
            "flags": List[str]
        }
    """
    flags = []
    
    if not settings.ANTICHEAT_ENABLED:
        return {"valid": True, "suspicious": False, "flags": []}
    
    # ============================================
    # 1. ПРОВЕРКА ВРЕМЕНИ
    # ============================================
    
    if time_seconds < settings.ANTICHEAT_MIN_LEVEL_TIME:
        flags.append(f"TOO_FAST: {time_seconds}s < {settings.ANTICHEAT_MIN_LEVEL_TIME}s")
        return {
            "valid": False,
            "reason": "Level completed too fast",
            "suspicious": True,
            "flags": flags
        }
    
    # Проверка на нереально долгое время (>1 час = AFK)
    if time_seconds > 3600:
        flags.append(f"TOO_SLOW: {time_seconds}s > 3600s")
    
    # ============================================
    # 2. ПРОВЕРКА SEED
    # ============================================
    
    # Seed должен совпадать с уровнем (или быть валидным)
    expected_seed = level
    if seed != expected_seed and seed < 0:
        flags.append(f"INVALID_SEED: {seed} != {expected_seed}")
        return {
            "valid": False,
            "reason": "Invalid seed",
            "suspicious": True,
            "flags": flags
        }
    
    # ============================================
    # 3. ВАЛИДАЦИЯ РЕШЕНИЯ (SERVER-SIDE!)
    # ============================================
    
    try:
        # Регенерируем уровень
        level_data = generate_level(level, seed=seed)
        
        # Проверяем что количество ходов корректно
        if len(moves) != level_data["meta"]["arrow_count"]:
            flags.append(f"MOVE_COUNT_MISMATCH: {len(moves)} != {level_data['meta']['arrow_count']}")
            return {
                "valid": False,
                "reason": "Invalid move count",
                "suspicious": True,
                "flags": flags
            }
        
        # Получаем валидное решение
        solution = get_full_solution(
            level_data["arrows"],
            level_data["grid"]["width"],
            level_data["grid"]["height"]
        )
        
        if not solution or len(solution) != len(moves):
            flags.append("NO_SOLUTION_EXISTS")
            return {
                "valid": False,
                "reason": "Level has no solution",
                "suspicious": True,
                "flags": flags
            }
        
        # Проверяем что все moves валидны (существуют в уровне)
        arrow_ids = {a["id"] for a in level_data["arrows"]}
        for move_id in moves:
            if move_id not in arrow_ids:
                flags.append(f"INVALID_ARROW_ID: {move_id}")
                return {
                    "valid": False,
                    "reason": "Invalid arrow ID in moves",
                    "suspicious": True,
                    "flags": flags
                }
        
    except Exception as e:
        print(f"❌ [AntiCheat] Level validation error: {e}")
        flags.append(f"VALIDATION_ERROR: {str(e)}")
        return {
            "valid": False,
            "reason": "Level validation failed",
            "suspicious": True,
            "flags": flags
        }
    
    # ============================================
    # 4. ПРОВЕРКА ПАТТЕРНОВ ПОЛЬЗОВАТЕЛЯ
    # ============================================
    
    # Получаем статистику пользователя
    result = await db.execute(
        select(UserStats).where(UserStats.user_id == user.id)
    )
    stats = result.scalar_one_or_none()
    
    if stats:
        # Винрейт (должен быть <95%)
        if stats.levels_completed > 10:
            winrate = (stats.levels_completed / (stats.levels_completed + 1)) * 100
            
            if winrate > settings.ANTICHEAT_MAX_WINRATE:
                flags.append(f"HIGH_WINRATE: {winrate:.1f}%")
        
        # Средние ошибки (если 0 ошибок постоянно = подозрительно)
        if stats.levels_completed > 20:
            avg_mistakes = stats.total_mistakes / stats.levels_completed
            
            if avg_mistakes < 0.1:
                flags.append(f"PERFECT_PLAY: avg_mistakes={avg_mistakes:.2f}")
    
    # ============================================
    # 5. ПРОВЕРКА ПОСЛЕДНИХ ПОПЫТОК (SPAM DETECTION)
    # ============================================
    
    # Получаем последние 10 попыток
    recent_result = await db.execute(
        select(LevelAttempt)
        .where(
            LevelAttempt.user_id == user.id,
            LevelAttempt.created_at > datetime.utcnow() - timedelta(minutes=5)
        )
        .order_by(LevelAttempt.created_at.desc())
        .limit(10)
    )
    recent_attempts = recent_result.scalars().all()
    
    # Если >5 попыток за 5 минут = подозрительно (spam/bot)
    if len(recent_attempts) >= 5:
        flags.append(f"SPAM_ATTEMPTS: {len(recent_attempts)} in 5min")
    
    # ============================================
    # РЕЗУЛЬТАТ
    # ============================================
    
    suspicious = len(flags) > 0
    
    return {
        "valid": True,
        "suspicious": suspicious,
        "flags": flags
    }


# ============================================
# CHEAT DETECTION
# ============================================

async def detect_cheater(user: User, db: AsyncSession) -> Dict[str, any]:
    """
    Анализ пользователя на читерство.
    
    Returns:
        {
            "is_cheater": bool,
            "confidence": float (0-1),
            "reasons": List[str]
        }
    """
    reasons = []
    confidence = 0.0
    
    # Получаем статистику
    result = await db.execute(
        select(UserStats).where(UserStats.user_id == user.id)
    )
    stats = result.scalar_one_or_none()
    
    if not stats or stats.levels_completed < 10:
        return {"is_cheater": False, "confidence": 0.0, "reasons": []}
    
    # ============================================
    # КРИТЕРИИ ЧИТЕРСТВА
    # ============================================
    
    # 1. Нереальный винрейт (>98%)
    winrate = (stats.levels_completed / (stats.levels_completed + 1)) * 100
    if winrate > 98:
        reasons.append(f"Perfect winrate: {winrate:.1f}%")
        confidence += 0.4
    
    # 2. Почти нет ошибок
    avg_mistakes = stats.total_mistakes / stats.levels_completed
    if avg_mistakes < 0.05:
        reasons.append(f"Almost no mistakes: {avg_mistakes:.2f}")
        confidence += 0.3
    
    # 3. Супер быстрое прохождение
    avg_time = stats.total_playtime_seconds / stats.levels_completed
    if avg_time < 10:
        reasons.append(f"Too fast: {avg_time:.1f}s per level")
        confidence += 0.2
    
    # 4. Проверяем последние попытки
    recent_result = await db.execute(
        select(LevelAttempt)
        .where(LevelAttempt.user_id == user.id)
        .order_by(LevelAttempt.created_at.desc())
        .limit(20)
    )
    recent = recent_result.scalars().all()
    
    if recent:
        # Все успешны?
        all_success = all(a.result == "win" for a in recent)
        if all_success and len(recent) >= 10:
            reasons.append("Last 10+ attempts all perfect")
            confidence += 0.1
    
    # ============================================
    # ФИНАЛЬНАЯ ОЦЕНКА
    # ============================================
    
    is_cheater = confidence >= 0.7
    
    return {
        "is_cheater": is_cheater,
        "confidence": min(1.0, confidence),
        "reasons": reasons
    }


# ============================================
# BAN SYSTEM
# ============================================

async def ban_user(user: User, reason: str, db: AsyncSession):
    """Банит пользователя."""
    user.is_banned = True
    user.ban_reason = reason
    user.banned_at = datetime.utcnow()
    await db.commit()
    
    print(f"🚫 [AntiCheat] User {user.id} banned: {reason}")


async def is_user_banned(user: User) -> bool:
    """Проверка бана."""
    return getattr(user, 'is_banned', False)


# ============================================
# SUSPICIOUS ACTIVITY LOGGING
# ============================================

async def log_suspicious_activity(
    user: User,
    activity_type: str,
    details: Dict,
    db: AsyncSession
):
    """
    Логирование подозрительной активности.
    
    В production можно сохранять в отдельную таблицу или Sentry.
    """
    log_entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "user_id": user.id,
        "telegram_id": user.telegram_id,
        "activity_type": activity_type,
        "details": details
    }
    
    print(f"⚠️  [AntiCheat] Suspicious activity: {log_entry}")
    
    # TODO: Сохранить в БД или отправить в Sentry
    # Пока просто логируем