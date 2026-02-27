"""
Arrow Puzzle - Social API

Социальные функции: рефералы, лидерборды, подписки на каналы.
"""

import secrets
from datetime import datetime, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from sqlalchemy.exc import IntegrityError

from ..config import settings
from ..database import get_db, get_redis
from ..models import User, Referral, Leaderboard, ChannelSubscription
from ..schemas import (
    ReferralCodeResponse, ReferralApplyRequest, ReferralApplyResponse,
    ReferralStatsResponse, ReferralInfo, ReferralListResponse,
    ReferralLeaderboardEntry, ReferralLeaderboardResponse,
    LeaderboardEntry, LeaderboardResponse,
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
    if not user.referral_code:
        user.referral_code = secrets.token_urlsafe(6).upper()[:8]
        await db.commit()
    
    link = f"https://t.me/{settings.TELEGRAM_BOT_USERNAME}?start=ref_{user.referral_code}"
    
    return ReferralCodeResponse(code=user.referral_code, link=link)


@router.post("/referral/apply", response_model=ReferralApplyResponse)
async def apply_referral(
    request: ReferralApplyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Применить реферальный код.
    
    Invitee получает +100 монет СРАЗУ.
    Inviter получит +200 монет, когда invitee достигнет уровня подтверждения.
    
    Edge cases:
      - already_referred: уже есть реферер
      - account_too_old: аккаунту > 72 часов
      - invalid_code: код не найден
      - self_referral: свой собственный код
    """
    # EC-3: Уже есть реферер
    if user.referred_by_id is not None:
        print(f"ℹ️ [Referral] User {user.id} already has referrer")
        return ReferralApplyResponse(success=False, reason="already_referred")
    
    # EC-18: Grace period для существующих аккаунтов
    account_age = datetime.utcnow() - user.created_at
    if account_age > timedelta(hours=settings.REFERRAL_GRACE_PERIOD_HOURS):
        print(f"ℹ️ [Referral] User {user.id} is too old for referral apply")
        return ReferralApplyResponse(success=False, reason="account_too_old")
    
    # EC-5: Ищем владельца кода
    result = await db.execute(
        select(User).where(User.referral_code == request.code.upper())
    )
    referrer = result.scalar_one_or_none()
    
    if not referrer:
        print(f"ℹ️ [Referral] Invalid code used by user {user.id}")
        return ReferralApplyResponse(success=False, reason="invalid_code")
    
    # EC-4: Самореферал
    if referrer.id == user.id:
        print(f"ℹ️ [Referral] Self-referral blocked for user {user.id}")
        return ReferralApplyResponse(success=False, reason="self_referral")
    
    # EC-11: Создаём Referral (UNIQUE на invitee_id защитит от race condition)
    try:
        referral = Referral(
            inviter_id=referrer.id,
            invitee_id=user.id,
            status="pending",
            invitee_bonus_paid=True,  # invitee получает бонус прямо сейчас
        )
        db.add(referral)
        
        user.referred_by_id = referrer.id
        user.coins += settings.REFERRAL_REWARD_INVITEE  # +100 монет СРАЗУ invitee
        
        referrer.referrals_pending += 1
        # inviter НЕ получает бонус сейчас — только когда invitee достигнет уровня подтверждения
        
        await db.commit()
        print(f"✅ [Referral] Pending created: invitee={user.id}, inviter={referrer.id}")
    except IntegrityError:
        await db.rollback()
        print(f"ℹ️ [Referral] Duplicate apply ignored for user {user.id}")
        return ReferralApplyResponse(success=False, reason="already_referred")
    
    return ReferralApplyResponse(success=True, bonus=settings.REFERRAL_REWARD_INVITEE)


@router.get("/referral/stats", response_model=ReferralStatsResponse)
async def get_referral_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Получить статистику рефералов."""
    # Генерируем код если нет (чтобы всегда возвращать ссылку)
    if not user.referral_code:
        user.referral_code = secrets.token_urlsafe(6).upper()[:8]
        await db.commit()
    
    link = f"https://t.me/{settings.TELEGRAM_BOT_USERNAME}?start=ref_{user.referral_code}"
    
    return ReferralStatsResponse(
        referrals_count=user.referrals_count,
        referrals_pending=user.referrals_pending,
        total_earned=user.referrals_earnings,
        referral_code=user.referral_code,
        referral_link=link,
        referral_confirm_level=settings.REFERRAL_CONFIRM_LEVEL,
    )


@router.get("/referral/list", response_model=ReferralListResponse)
async def get_referral_list(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Список приглашённых рефералов (для вкладки «Мои друзья»).
    Сортировка: confirmed сверху, затем по уровню убывание.
    """
    result = await db.execute(
        select(Referral, User)
        .join(User, Referral.invitee_id == User.id)
        .where(Referral.inviter_id == user.id)
        .order_by(
            # confirmed сверху
            desc(Referral.status == "confirmed"),
            desc(User.current_level),
        )
    )
    rows = result.all()
    
    referrals = [
        ReferralInfo(
            id=invitee.id,
            username=invitee.username,
            first_name=invitee.first_name,
            photo_url=invitee.photo_url,
            current_level=invitee.current_level,
            status=ref.status,
            confirmed_at=ref.confirmed_at,
            created_at=ref.created_at,
        )
        for ref, invitee in rows
    ]
    
    return ReferralListResponse(referrals=referrals)


@router.get("/referral/leaderboard", response_model=ReferralLeaderboardResponse)
async def get_referral_leaderboard(
    limit: int = 100,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Глобальный лидерборд рефоводов.
    Ранжирование по кол-ву подтверждённых рефералов (referrals_count).
    """
    # Топ рефоводов
    result = await db.execute(
        select(User)
        .where(User.referrals_count > 0)
        .order_by(desc(User.referrals_count), desc(User.referrals_earnings))
        .limit(limit)
    )
    users = result.scalars().all()
    
    leaders = [
        ReferralLeaderboardEntry(
            rank=i + 1,
            user_id=u.id,
            username=u.username,
            first_name=u.first_name,
            photo_url=u.photo_url,
            score=u.referrals_count,
        )
        for i, u in enumerate(users)
    ]
    
    # Позиция текущего пользователя
    my_position = None
    if user.referrals_count > 0:
        rank_result = await db.execute(
            select(func.count())
            .select_from(User)
            .where(User.referrals_count > user.referrals_count)
        )
        my_position = rank_result.scalar() + 1
    
    return ReferralLeaderboardResponse(
        leaders=leaders,
        my_position=my_position,
        my_score=user.referrals_count,
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
            .where(Leaderboard.board_type == "weekly")
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
            .where(Leaderboard.user_id == user.id, Leaderboard.board_type == "weekly")
        )
        my_entry = my_lb.scalar_one_or_none()
        
        if my_entry:
            rank_query = await db.execute(
                select(func.count())
                .select_from(Leaderboard)
                .where(
                    Leaderboard.board_type == "weekly",
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
            .where(Leaderboard.board_type == "arcade")
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
    Лидерборд среди друзей (приглашённых рефералов + сам пользователь).
    Ранжирование по current_level.
    """
    # Получаем подтверждённых и pending рефералов
    result = await db.execute(
        select(User)
        .join(Referral, Referral.invitee_id == User.id)
        .where(Referral.inviter_id == user.id)
        .order_by(desc(User.current_level))
    )
    referrals = result.scalars().all()
    
    # Добавляем самого пользователя и сортируем
    all_users = [user] + list(referrals)
    all_users.sort(key=lambda u: (u.current_level, u.total_stars), reverse=True)
    
    leaders = [
        LeaderboardEntry(
            rank=i + 1,
            user_id=u.id,
            username=u.username,
            first_name=u.first_name,
            score=u.current_level,
        )
        for i, u in enumerate(all_users)
    ]
    
    my_position = next(
        (i + 1 for i, u in enumerate(all_users) if u.id == user.id),
        None
    )
    
    return LeaderboardResponse(leaders=leaders, my_position=my_position)
