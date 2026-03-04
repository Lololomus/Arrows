"""
Arrow Puzzle - Social API

Социальные функции: рефералы, лидерборды, подписки на каналы.
"""

import json
import secrets
from datetime import date, datetime
from typing import List, Optional, Tuple
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, asc, and_, or_
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
from ..services.tasks import claim_task, get_official_channel_config
from .auth import get_current_user


router = APIRouter(prefix="/social", tags=["social"])

def _utc_today() -> date:
    return datetime.utcnow().date()

# TTL кэша лидербордов (секунды)
_LB_CACHE_TTL = 30


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

    Только для НОВЫХ пользователей (current_level <= 1).
    Invitee получает +100 монет СРАЗУ.
    Inviter получит +200 монет, когда invitee достигнет уровня подтверждения.

    Edge cases:
      - already_referred: уже есть реферер
      - account_too_old: юзер уже начал играть (current_level > 1)
      - invalid_code: код не найден
      - self_referral: свой собственный код
    """
    # Lock user row to prevent race condition with apply_redis_referral
    locked = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    user = locked.scalar_one()

    # EC-3: Уже есть реферер
    if user.referred_by_id is not None:
        print(f"ℹ️ [Referral] User {user.id} already has referrer")
        return ReferralApplyResponse(success=False, reason="already_referred")

    # EC-18: Рефералка только для новых пользователей
    if user.current_level > 1:
        print(f"ℹ️ [Referral] User {user.id} is not new (level={user.current_level})")
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


# ============================================
# REFERRAL LEADERBOARD (с Redis-кэшем)
# ============================================

async def _fetch_referral_leaderboard_top(db: AsyncSession, limit: int) -> Tuple[list, int]:
    """Загрузить топ рефоводов и total из БД."""
    _FAR_FUTURE = datetime(9999, 1, 1)
    base_filter = [User.referrals_count > 0, User.is_banned == False]
    confirmed_at_safe = func.coalesce(User.last_referral_confirmed_at, _FAR_FUTURE)

    result = await db.execute(
        select(User)
        .where(*base_filter)
        .order_by(desc(User.referrals_count), asc(confirmed_at_safe), asc(User.id))
        .limit(limit)
    )
    users = result.scalars().all()

    leaders = [
        {
            "rank": i + 1,
            "user_id": u.id,
            "username": u.username,
            "first_name": u.first_name,
            "photo_url": u.photo_url,
            "score": u.referrals_count,
        }
        for i, u in enumerate(users)
    ]

    total_result = await db.execute(
        select(func.count()).select_from(User).where(*base_filter)
    )
    total_participants = total_result.scalar()

    return leaders, total_participants


async def _fetch_referral_position(db: AsyncSession, user: User) -> Optional[int]:
    """Вычислить позицию юзера в реферальном лидерборде."""
    _FAR_FUTURE = datetime(9999, 1, 1)
    base_filter = [User.referrals_count > 0, User.is_banned == False]
    confirmed_at_safe = func.coalesce(User.last_referral_confirmed_at, _FAR_FUTURE)
    my_confirmed = user.last_referral_confirmed_at or _FAR_FUTURE

    count_above = await db.execute(
        select(func.count())
        .select_from(User)
        .where(
            *base_filter,
            or_(
                User.referrals_count > user.referrals_count,
                and_(
                    User.referrals_count == user.referrals_count,
                    confirmed_at_safe < my_confirmed,
                ),
                and_(
                    User.referrals_count == user.referrals_count,
                    confirmed_at_safe == my_confirmed,
                    User.id < user.id,
                ),
            )
        )
    )
    return count_above.scalar() + 1


@router.get("/referral/leaderboard", response_model=ReferralLeaderboardResponse)
async def get_referral_leaderboard(
    limit: int = 100,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Глобальный лидерборд рефоводов.
    Ранжирование: referrals_count DESC, last_referral_confirmed_at ASC, id ASC.
    Tiebreaker: кто набрал N рефералов раньше — тот выше.
    NULL last_referral_confirmed_at трактуется как «бесконечно далёкое будущее» (внизу группы).

    Кэшируется в Redis (TTL 30 сек).
    """
    redis = await get_redis()
    cache_key = f"lb:referral:top:{limit}"

    # Пробуем взять топ из кэша
    cached = await redis.get(cache_key)
    if cached:
        data = json.loads(cached)
        leaders_raw = data["leaders"]
        total_participants = data["total"]
    else:
        leaders_raw, total_participants = await _fetch_referral_leaderboard_top(db, limit)
        await redis.set(cache_key, json.dumps({"leaders": leaders_raw, "total": total_participants}), ex=_LB_CACHE_TTL)

    leaders = [ReferralLeaderboardEntry(**entry) for entry in leaders_raw]

    # Позиция текущего пользователя
    my_position = None
    my_in_top = False
    my_score = user.referrals_count

    if my_score > 0 and not user.is_banned:
        # Проверяем, есть ли юзер в топ-100
        for entry in leaders_raw:
            if entry["user_id"] == user.id:
                my_position = entry["rank"]
                my_in_top = True
                break

        if not my_in_top:
            # Юзера нет в топ — считаем позицию (кэш per-user)
            pos_key = f"lb:referral:pos:{user.id}"
            cached_pos = await redis.get(pos_key)
            if cached_pos:
                my_position = int(cached_pos)
            else:
                my_position = await _fetch_referral_position(db, user)
                await redis.set(pos_key, str(my_position), ex=_LB_CACHE_TTL)

    return ReferralLeaderboardResponse(
        leaders=leaders,
        my_position=my_position,
        my_score=my_score,
        my_in_top=my_in_top,
        total_participants=total_participants,
    )


# ============================================
# LEADERBOARDS (с Redis-кэшем)
# ============================================

async def _fetch_global_top(db: AsyncSession, limit: int) -> Tuple[list, int]:
    """Загрузить global leaderboard из БД."""
    base_filter = [User.current_level > 1, User.is_banned == False]

    result = await db.execute(
        select(User)
        .where(*base_filter)
        .order_by(desc(User.current_level), desc(User.total_stars), asc(User.id))
        .limit(limit)
    )
    users = result.scalars().all()

    leaders = [
        {
            "rank": i + 1,
            "user_id": u.id,
            "username": u.username,
            "first_name": u.first_name,
            "photo_url": u.photo_url,
            "score": u.current_level - 1,
        }
        for i, u in enumerate(users)
    ]

    total_result = await db.execute(
        select(func.count()).select_from(User).where(*base_filter)
    )
    total_participants = total_result.scalar()

    return leaders, total_participants


async def _fetch_global_position(db: AsyncSession, user: User) -> int:
    """Вычислить позицию юзера в global leaderboard."""
    base_filter = [User.current_level > 1, User.is_banned == False]

    count_above = await db.execute(
        select(func.count())
        .select_from(User)
        .where(
            *base_filter,
            or_(
                User.current_level > user.current_level,
                and_(
                    User.current_level == user.current_level,
                    User.total_stars > user.total_stars,
                ),
                and_(
                    User.current_level == user.current_level,
                    User.total_stars == user.total_stars,
                    User.id < user.id,
                ),
            )
        )
    )
    return count_above.scalar() + 1


async def _fetch_board_top(db: AsyncSession, board_type: str, limit: int) -> Tuple[list, int]:
    """Загрузить weekly/arcade leaderboard из БД."""
    result = await db.execute(
        select(Leaderboard, User)
        .join(User, Leaderboard.user_id == User.id)
        .where(
            Leaderboard.board_type == board_type,
            Leaderboard.score > 0,
            User.is_banned == False,
        )
        .order_by(desc(Leaderboard.score), asc(Leaderboard.updated_at), asc(User.id))
        .limit(limit)
    )
    rows = result.all()

    leaders = [
        {
            "rank": i + 1,
            "user_id": lb.user_id,
            "username": u.username,
            "first_name": u.first_name,
            "photo_url": u.photo_url,
            "score": lb.score,
        }
        for i, (lb, u) in enumerate(rows)
    ]

    total_result = await db.execute(
        select(func.count())
        .select_from(Leaderboard)
        .join(User, Leaderboard.user_id == User.id)
        .where(
            Leaderboard.board_type == board_type,
            Leaderboard.score > 0,
            User.is_banned == False,
        )
    )
    total_participants = total_result.scalar()

    return leaders, total_participants


async def _fetch_board_position(db: AsyncSession, user: User, board_type: str) -> Optional[int]:
    """Вычислить позицию юзера в weekly/arcade leaderboard."""
    my_lb = await db.execute(
        select(Leaderboard)
        .where(Leaderboard.user_id == user.id, Leaderboard.board_type == board_type)
    )
    my_entry = my_lb.scalar_one_or_none()

    if not my_entry or my_entry.score <= 0 or user.is_banned:
        return None, 0

    count_above = await db.execute(
        select(func.count())
        .select_from(Leaderboard)
        .join(User, Leaderboard.user_id == User.id)
        .where(
            Leaderboard.board_type == board_type,
            Leaderboard.score > 0,
            User.is_banned == False,
            or_(
                Leaderboard.score > my_entry.score,
                and_(
                    Leaderboard.score == my_entry.score,
                    Leaderboard.updated_at < my_entry.updated_at,
                ),
                and_(
                    Leaderboard.score == my_entry.score,
                    Leaderboard.updated_at == my_entry.updated_at,
                    User.id < user.id,
                ),
            )
        )
    )
    return count_above.scalar() + 1, my_entry.score


async def _fetch_daily_top(db: AsyncSession, limit: int) -> Tuple[list, int]:
    """Загрузить daily leaderboard из БД (score ASC — меньше ходов = лучше)."""
    today_int = int(_utc_today().strftime("%Y%m%d"))
    result = await db.execute(
        select(Leaderboard, User)
        .join(User, Leaderboard.user_id == User.id)
        .where(
            Leaderboard.board_type == "daily",
            Leaderboard.season == today_int,
            User.is_banned == False,
        )
        .order_by(asc(Leaderboard.score), asc(Leaderboard.updated_at), asc(User.id))
        .limit(limit)
    )
    rows = result.all()
    leaders = [
        {
            "rank": i + 1,
            "user_id": lb.user_id,
            "username": u.username,
            "first_name": u.first_name,
            "photo_url": u.photo_url,
            "score": lb.score,
        }
        for i, (lb, u) in enumerate(rows)
    ]
    total_result = await db.execute(
        select(func.count())
        .select_from(Leaderboard)
        .join(User, Leaderboard.user_id == User.id)
        .where(
            Leaderboard.board_type == "daily",
            Leaderboard.season == today_int,
            User.is_banned == False,
        )
    )
    return leaders, total_result.scalar()


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
    Score для global = current_level - 1 (кол-во пройдённых уровней).
    Только юзеры с score > 0 попадают в борд.

    Кэшируется в Redis (TTL 30 сек).
    """
    if board_type not in ["global", "weekly", "arcade", "daily"]:
        raise HTTPException(status_code=400, detail="Invalid leaderboard type")

    redis = await get_redis()
    # Для daily кэш по дате, чтобы автоматически сбрасывался на следующий день
    cache_key = f"lb:{board_type}:top:{limit}" if board_type != "daily" else f"lb:daily:{_utc_today().isoformat()}:top:{limit}"

    # Пробуем взять топ из кэша
    cached = await redis.get(cache_key)
    if cached:
        data = json.loads(cached)
        leaders_raw = data["leaders"]
        total_participants = data["total"]
    else:
        if board_type == "global":
            leaders_raw, total_participants = await _fetch_global_top(db, limit)
        elif board_type == "daily":
            leaders_raw, total_participants = await _fetch_daily_top(db, limit)
        else:
            leaders_raw, total_participants = await _fetch_board_top(db, board_type, limit)
        await redis.set(cache_key, json.dumps({"leaders": leaders_raw, "total": total_participants}), ex=_LB_CACHE_TTL)

    leaders = [LeaderboardEntry(**entry) for entry in leaders_raw]

    # Позиция текущего пользователя
    my_position = None
    my_in_top = False

    if board_type == "global":
        my_score = max(0, user.current_level - 1)
        eligible = my_score > 0 and not user.is_banned
    else:
        # Для weekly/arcade score берём из кэшированного топа или из БД
        my_score = 0
        eligible = not user.is_banned

    if eligible:
        # Проверяем, есть ли юзер в топ-100
        for entry in leaders_raw:
            if entry["user_id"] == user.id:
                my_position = entry["rank"]
                my_in_top = True
                if board_type != "global":
                    my_score = entry["score"]
                break

        if not my_in_top:
            # Юзера нет в топ — считаем позицию (кэш per-user)
            pos_key = f"lb:{board_type}:pos:{user.id}"
            cached_pos = await redis.get(pos_key)
            if cached_pos:
                pos_data = json.loads(cached_pos)
                my_position = pos_data["pos"]
                if board_type != "global":
                    my_score = pos_data["score"]
            else:
                if board_type == "global":
                    if my_score > 0:
                        my_position = await _fetch_global_position(db, user)
                        await redis.set(pos_key, json.dumps({"pos": my_position, "score": my_score}), ex=_LB_CACHE_TTL)
                else:
                    result = await _fetch_board_position(db, user, board_type)
                    if result[0] is not None:
                        my_position = result[0]
                        my_score = result[1]
                        await redis.set(pos_key, json.dumps({"pos": my_position, "score": my_score}), ex=_LB_CACHE_TTL)

    return LeaderboardResponse(
        leaders=leaders,
        my_position=my_position,
        my_score=my_score,
        my_in_top=my_in_top,
        total_participants=total_participants,
    )


# ============================================
# CHANNEL SUBSCRIPTIONS
# ============================================

@router.get("/channels", response_model=List[RewardChannel])
async def get_channels(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Получить список каналов для подписки."""
    channel = get_official_channel_config()
    if not channel:
        return []

    # Получаем уже заклейменные
    result = await db.execute(
        select(ChannelSubscription)
        .where(ChannelSubscription.user_id == user.id)
    )
    claimed = {sub.channel_id for sub in result.scalars().all()}

    return [
        RewardChannel(
            id=channel["channel_id"],
            name=channel["name"],
            reward_coins=channel["reward_coins"],
            claimed=channel["channel_id"] in claimed,
        )
    ]


@router.post("/channels/claim")
async def claim_channel_reward(
    request: ClaimChannelRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Получить награду за подписку на канал."""
    channel = get_official_channel_config()
    if not channel or request.channel_id != channel["channel_id"]:
        raise HTTPException(status_code=404, detail="Channel not found")

    locked_user_result = await db.execute(select(User).where(User.id == user.id).with_for_update())
    locked_user = locked_user_result.scalar_one_or_none()
    if not locked_user:
        raise HTTPException(status_code=401, detail="User not found")

    result = await claim_task(locked_user, "official_channel_subscribe", db)
    await db.commit()
    return {"success": True, "coins": result.coins, "bonus": result.reward_coins}


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
    Ранжирование по current_level (пройдённые уровни).
    Только юзеры с current_level > 1 (прошли хотя бы 1 уровень).
    """
    # Получаем рефералов
    result = await db.execute(
        select(User)
        .join(Referral, Referral.invitee_id == User.id)
        .where(Referral.inviter_id == user.id)
    )
    referrals = result.scalars().all()

    # Все юзеры (пользователь + рефералы), фильтруем тех кто прошёл ≥1 уровень
    all_users = [u for u in [user] + list(referrals) if u.current_level > 1]
    all_users.sort(key=lambda u: (u.current_level, u.total_stars, -u.id), reverse=True)

    leaders = [
        LeaderboardEntry(
            rank=i + 1,
            user_id=u.id,
            username=u.username,
            first_name=u.first_name,
            photo_url=u.photo_url,
            score=u.current_level - 1,
        )
        for i, u in enumerate(all_users)
    ]

    my_position = next(
        (i + 1 for i, u in enumerate(all_users) if u.id == user.id),
        None
    )
    my_score = max(0, user.current_level - 1)
    my_in_top = my_position is not None

    return LeaderboardResponse(
        leaders=leaders,
        my_position=my_position,
        my_score=my_score,
        my_in_top=my_in_top,
        total_participants=len(all_users),
    )
