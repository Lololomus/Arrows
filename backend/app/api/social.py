"""
Arrow Puzzle - Social API

Социальные функции: рефералы, лидерборды, подписки на каналы.
"""

import secrets
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc

from ..config import settings
from ..database import get_db, get_redis
from ..models import User, Leaderboard, ChannelSubscription
from ..schemas import (
    ReferralCodeResponse, ReferralApplyRequest, ReferralApplyResponse,
    ReferralStatsResponse, LeaderboardEntry, LeaderboardResponse,
    RewardChannel, ClaimChannelRequest
)
from .auth import get_current_user


router = APIRouter(prefix="/social", tags=["social"])


# ============================================
# REFERRALS
# ============================================

@router.get("/referral/code", response_model=ReferralCodeResponse)
async def get_referral_code(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Получить реферальный код и ссылку."""
    # Генерируем код если нет
    if not user.referral_code:
        user.referral_code = secrets.token_urlsafe(6).upper()[:8]
        await db.commit()
    
    # Формируем ссылку
    link = f"https://t.me/{settings.TELEGRAM_BOT_USERNAME}?start=ref_{user.referral_code}"
    
    return ReferralCodeResponse(code=user.referral_code, link=link)


@router.post("/referral/apply", response_model=ReferralApplyResponse)
async def apply_referral(
    request: ReferralApplyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Применить реферальный код (для нового пользователя)."""
    # Проверяем что пользователь ещё не применял код
    if user.referred_by_id:
        return ReferralApplyResponse(success=False, bonus=0)
    
    # Ищем владельца кода
    result = await db.execute(
        select(User).where(User.referral_code == request.code.upper())
    )
    referrer = result.scalar_one_or_none()
    
    if not referrer:
        return ReferralApplyResponse(success=False, bonus=0)
    
    # Нельзя реферить самого себя
    if referrer.id == user.id:
        return ReferralApplyResponse(success=False, bonus=0)
    
    # Применяем реферал
    user.referred_by_id = referrer.id
    user.coins += settings.REFERRAL_BONUS_COINS
    
    # Награждаем владельца кода
    referrer.referrals_count += 1
    referrer.referrals_earnings += settings.REFERRAL_OWNER_BONUS
    referrer.coins += settings.REFERRAL_OWNER_BONUS
    
    await db.commit()
    
    return ReferralApplyResponse(success=True, bonus=settings.REFERRAL_BONUS_COINS)


@router.get("/referral/stats", response_model=ReferralStatsResponse)
async def get_referral_stats(user: User = Depends(get_current_user)):
    """Получить статистику рефералов."""
    return ReferralStatsResponse(
        referrals_count=user.referrals_count,
        total_earned=user.referrals_earnings
    )


# ============================================
# LEADERBOARDS
# ============================================

@router.get("/leaderboard/{board_type}", response_model=LeaderboardResponse)
async def get_leaderboard(
    board_type: str,
    limit: int = 100,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Получить лидерборд.
    board_type: 'global' | 'weekly' | 'arcade'
    """
    if board_type not in ["global", "weekly", "arcade"]:
        raise HTTPException(status_code=400, detail="Invalid leaderboard type")
    
    if board_type == "global":
        # По уровню
        result = await db.execute(
            select(User)
            .order_by(desc(User.current_level), desc(User.total_stars))
            .limit(limit)
        )
        users = result.scalars().all()
        
        leaders = [
            LeaderboardEntry(
                rank=i + 1,
                user_id=u.id,
                username=u.username,
                first_name=u.first_name,
                score=u.current_level
            )
            for i, u in enumerate(users)
        ]
        
        # Позиция текущего пользователя
        my_rank = await db.execute(
            select(func.count())
            .where(User.current_level > user.current_level)
        )
        my_position = my_rank.scalar() + 1
        
    elif board_type == "weekly":
        # По очкам за неделю из таблицы Leaderboard
        result = await db.execute(
            select(Leaderboard, User)
            .join(User, Leaderboard.user_id == User.id)
            .where(Leaderboard.period == "weekly")
            .order_by(desc(Leaderboard.score))
            .limit(limit)
        )
        rows = result.all()
        
        leaders = [
            LeaderboardEntry(
                rank=i + 1,
                user_id=lb.user_id,
                username=u.username,
                first_name=u.first_name,
                score=lb.score
            )
            for i, (lb, u) in enumerate(rows)
        ]
        
        # Позиция текущего пользователя
        my_lb = await db.execute(
            select(Leaderboard)
            .where(Leaderboard.user_id == user.id, Leaderboard.period == "weekly")
        )
        my_entry = my_lb.scalar_one_or_none()
        
        if my_entry:
            rank_query = await db.execute(
                select(func.count())
                .select_from(Leaderboard)
                .where(
                    Leaderboard.period == "weekly",
                    Leaderboard.score > my_entry.score
                )
            )
            my_position = rank_query.scalar() + 1
        else:
            my_position = None
            
    else:  # arcade
        result = await db.execute(
            select(Leaderboard, User)
            .join(User, Leaderboard.user_id == User.id)
            .where(Leaderboard.period == "arcade")
            .order_by(desc(Leaderboard.score))
            .limit(limit)
        )
        rows = result.all()
        
        leaders = [
            LeaderboardEntry(
                rank=i + 1,
                user_id=lb.user_id,
                username=u.username,
                first_name=u.first_name,
                score=lb.score
            )
            for i, (lb, u) in enumerate(rows)
        ]
        my_position = None
    
    return LeaderboardResponse(leaders=leaders, my_position=my_position)


# ============================================
# CHANNEL SUBSCRIPTIONS
# ============================================

# Каналы для подписки (конфигурируется)
REWARD_CHANNELS = [
    {"id": "main", "name": "@ArrowPuzzleGame", "username": "ArrowPuzzleGame", "reward_coins": 100},
    {"id": "news", "name": "@ArrowPuzzleNews", "username": "ArrowPuzzleNews", "reward_coins": 50},
]


@router.get("/channels", response_model=List[RewardChannel])
async def get_channels(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Получить список каналов для подписки."""
    # Получаем уже заклейменные
    result = await db.execute(
        select(ChannelSubscription)
        .where(ChannelSubscription.user_id == user.id)
    )
    claimed = {sub.channel_id for sub in result.scalars().all()}
    
    return [
        RewardChannel(
            id=ch["id"],
            name=ch["name"],
            reward_coins=ch["reward_coins"],
            claimed=ch["id"] in claimed
        )
        for ch in REWARD_CHANNELS
    ]


@router.post("/channels/claim")
async def claim_channel_reward(
    request: ClaimChannelRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Получить награду за подписку на канал."""
    # Ищем канал
    channel = next((ch for ch in REWARD_CHANNELS if ch["id"] == request.channel_id), None)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    
    # Проверяем что ещё не получал
    result = await db.execute(
        select(ChannelSubscription)
        .where(
            ChannelSubscription.user_id == user.id,
            ChannelSubscription.channel_id == request.channel_id
        )
    )
    if result.scalar_one_or_none():
        return {"success": False, "error": "Already claimed"}
    
    # TODO: Проверить подписку через Telegram Bot API
    # chat_member = await bot.get_chat_member(f"@{channel['username']}", user.telegram_id)
    # if chat_member.status not in ['member', 'administrator', 'creator']:
    #     return {"success": False, "error": "Not subscribed"}
    
    # Даём награду
    user.coins += channel["reward_coins"]
    
    sub = ChannelSubscription(
        user_id=user.id,
        channel_id=request.channel_id,
        channel_username=channel["username"]
    )
    db.add(sub)
    
    await db.commit()
    
    return {"success": True, "coins": user.coins, "bonus": channel["reward_coins"]}


# ============================================
# FRIENDS
# ============================================

@router.get("/friends/leaderboard", response_model=LeaderboardResponse)
async def get_friends_leaderboard(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Лидерборд среди друзей.
    В Telegram Mini Apps можно получить список друзей через CloudStorage или share.
    Здесь упрощённая версия - те, кого пригласил пользователь.
    """
    # Получаем рефералов пользователя
    result = await db.execute(
        select(User)
        .where(User.referred_by_id == user.id)
        .order_by(desc(User.current_level))
    )
    referrals = result.scalars().all()
    
    # Добавляем самого пользователя
    all_users = [user] + list(referrals)
    all_users.sort(key=lambda u: (u.current_level, u.total_stars), reverse=True)
    
    leaders = [
        LeaderboardEntry(
            rank=i + 1,
            user_id=u.id,
            username=u.username,
            first_name=u.first_name,
            score=u.current_level
        )
        for i, u in enumerate(all_users)
    ]
    
    my_position = next(
        (i + 1 for i, u in enumerate(all_users) if u.id == user.id),
        None
    )
    
    return LeaderboardResponse(leaders=leaders, my_position=my_position)