"""
Arrow Puzzle - Ads API

Rewarded ads now use server-authoritative reward intents.
Legacy /ads/claim/* endpoints remain for temporary compatibility.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models import AdRewardClaim, Transaction, User
from ..schemas import (
    ActiveRewardIntentResponse,
    AdsStatusResponse,
    ClaimDailyCoinsRequest,
    ClaimDailyCoinsResponse,
    ClaimHintRequest,
    ClaimHintResponse,
    ClaimReviveRequest,
    ClaimReviveResponse,
    DailyCoinsStatus,
    ReviveStatusResponse,
    RewardIntentCreateRequest,
    RewardIntentCreateResponse,
    RewardIntentStatusResponse,
    TaskReviveStatus,
)
from ..services.ad_rewards import (
    FAILURE_DAILY_LIMIT_REACHED,
    FAILURE_HINT_BALANCE_NOT_ZERO,
    FAILURE_REVIVE_ALREADY_USED,
    FAILURE_AD_NOT_COMPLETED,
    INTENT_STATUS_PENDING,
    REVIVE_LIMIT_PER_LEVEL,
    PLACEMENT_DAILY_COINS,
    PLACEMENT_HINT,
    PLACEMENT_REVIVE,
    REWARDED_PLACEMENTS,
    cancel_pending_intent,
    create_reward_intent,
    ensure_eligible,
    expire_stale_pending_intents,
    get_daily_coins_status,
    get_intent_by_public_id,
    get_revive_limit_status,
    get_task_revive_status,
    grant_intent,
    list_active_pending_intents,
    mark_expired,
    serialize_create_intent,
    serialize_intent,
    today_msk,
    utcnow,
)
from .auth import get_current_user


router = APIRouter(prefix="/ads", tags=["ads"])


@router.get("/status", response_model=AdsStatusResponse)
async def get_ads_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    eligible = user.current_level >= settings.AD_FIRST_ELIGIBLE_LEVEL
    daily_status = await get_daily_coins_status(db, user.id) if eligible else {
        "used": 0,
        "limit": settings.AD_DAILY_COINS_LIMIT,
        "resets_at": None,
    }
    resets_at = daily_status["resets_at"]
    task_revive_status = await get_task_revive_status(db, user.id)
    task_revive_resets_at = task_revive_status["resets_at"]
    return AdsStatusResponse(
        eligible=eligible,
        current_level=user.current_level,
        daily_coins=DailyCoinsStatus(
            used=int(daily_status["used"]),
            limit=int(daily_status["limit"]),
            resets_at=resets_at.replace(tzinfo=timezone.utc).isoformat() if isinstance(resets_at, datetime) else "",
        ),
        hint_ad_available=eligible and user.hint_balance == 0,
        hint_ad_reward=settings.AD_HINT_REWARD,
        task_revive=TaskReviveStatus(
            used=int(task_revive_status["used"]),
            limit=int(task_revive_status["limit"]),
            resets_at=(
                task_revive_resets_at.replace(tzinfo=timezone.utc).isoformat()
                if isinstance(task_revive_resets_at, datetime)
                else ""
            ),
        ),
    )


@router.post("/reward-intents", response_model=RewardIntentCreateResponse)
async def create_reward_intent_endpoint(
    request: RewardIntentCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    intent = await create_reward_intent(
        db,
        user,
        request.placement,
        level=request.level,
        session_id=request.session_id,
    )
    return serialize_create_intent(intent)


@router.get("/reward-intents/active", response_model=list[ActiveRewardIntentResponse])
async def get_active_reward_intents(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    for placement in REWARDED_PLACEMENTS:
        await expire_stale_pending_intents(db, user.id, placement)

    intents = await list_active_pending_intents(db, user.id)
    serialized: list[ActiveRewardIntentResponse] = []
    for intent in intents:
        revive_status = None
        if intent.placement == PLACEMENT_REVIVE and intent.level_number is not None:
            revive_status = await get_revive_limit_status(db, user.id, intent.level_number)
        serialized.append(
            ActiveRewardIntentResponse.model_validate(
                serialize_intent(
                    intent,
                    revives_used=revive_status["used"] if revive_status else None,
                    revives_limit=revive_status["limit"] if revive_status else None,
                ).model_dump()
            )
        )
    return serialized


@router.get("/revive-status", response_model=ReviveStatusResponse)
async def get_revive_status(
    level: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    eligible = user.current_level >= settings.AD_FIRST_ELIGIBLE_LEVEL
    if not eligible:
        return ReviveStatusResponse(
            eligible=False,
            level=level,
            used=0,
            limit=REVIVE_LIMIT_PER_LEVEL,
            remaining=0,
        )

    status = await get_revive_limit_status(db, user.id, level)
    return ReviveStatusResponse(
        eligible=True,
        level=level,
        used=status["used"],
        limit=status["limit"],
        remaining=status["remaining"],
    )


@router.get("/reward-intents/{intent_id}", response_model=RewardIntentStatusResponse)
async def get_reward_intent_status(
    intent_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    intent = await get_intent_by_public_id(db, user.id, intent_id)
    if intent is None:
        raise HTTPException(status_code=404, detail={"error": "INTENT_NOT_FOUND"})

    if intent.status == "pending" and intent.expires_at <= utcnow():
        mark_expired(intent)
        await db.commit()
        await db.refresh(intent)

    revive_status = None
    if intent.placement == PLACEMENT_REVIVE and intent.level_number is not None:
        revive_status = await get_revive_limit_status(db, user.id, intent.level_number)

    return serialize_intent(
        intent,
        revives_used=revive_status["used"] if revive_status else None,
        revives_limit=revive_status["limit"] if revive_status else None,
    )


@router.post("/reward-intents/{intent_id}/cancel", response_model=RewardIntentStatusResponse)
async def cancel_reward_intent(
    intent_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    intent = await cancel_pending_intent(db, user.id, intent_id, FAILURE_AD_NOT_COMPLETED)
    if intent is None:
        raise HTTPException(status_code=404, detail={"error": "INTENT_NOT_FOUND"})

    revive_status = None
    if intent.placement == PLACEMENT_REVIVE and intent.level_number is not None:
        revive_status = await get_revive_limit_status(db, user.id, intent.level_number)

    return serialize_intent(
        intent,
        revives_used=revive_status["used"] if revive_status else None,
        revives_limit=revive_status["limit"] if revive_status else None,
    )


@router.post("/reward-intents/{intent_id}/client-complete", response_model=RewardIntentStatusResponse)
async def client_complete_reward_intent(
    intent_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    intent = await get_intent_by_public_id(db, user.id, intent_id)
    if intent is None:
        raise HTTPException(status_code=404, detail={"error": "INTENT_NOT_FOUND"})

    revive_status = None
    if intent.placement == PLACEMENT_REVIVE and intent.level_number is not None:
        revive_status = await get_revive_limit_status(db, user.id, intent.level_number)

    if intent.status != INTENT_STATUS_PENDING:
        return serialize_intent(
            intent,
            revives_used=revive_status["used"] if revive_status else None,
            revives_limit=revive_status["limit"] if revive_status else None,
        )

    if intent.expires_at <= utcnow():
        mark_expired(intent)
        await db.commit()
        await db.refresh(intent)
        return serialize_intent(
            intent,
            revives_used=revive_status["used"] if revive_status else None,
            revives_limit=revive_status["limit"] if revive_status else None,
        )

    intent = await grant_intent(db, user, intent)

    if intent.placement == PLACEMENT_REVIVE and intent.level_number is not None:
        revive_status = await get_revive_limit_status(db, user.id, intent.level_number)

    return serialize_intent(
        intent,
        revives_used=revive_status["used"] if revive_status else None,
        revives_limit=revive_status["limit"] if revive_status else None,
    )


@router.post("/claim/daily-coins", response_model=ClaimDailyCoinsResponse)
async def claim_daily_coins(
    request: ClaimDailyCoinsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_eligible(user)
    daily_status = await get_daily_coins_status(db, user.id)
    used_today = int(daily_status["used"])
    if used_today >= settings.AD_DAILY_COINS_LIMIT:
        raise HTTPException(status_code=409, detail={"error": FAILURE_DAILY_LIMIT_REACHED})

    reward = settings.AD_DAILY_COINS_REWARD
    now = utcnow()
    user.coins += reward
    window_start = daily_status["window_start"] if isinstance(daily_status.get("window_start"), datetime) else None
    if window_start is None:
        window_start = now
    resets_at = window_start + timedelta(hours=24)
    db.add(
        AdRewardClaim(
            user_id=user.id,
            placement=PLACEMENT_DAILY_COINS,
            ad_reference=request.ad_reference,
            reward_amount=reward,
            claim_day_msk=today_msk(),
            created_at=now,
        )
    )
    db.add(
        Transaction(
            user_id=user.id,
            type="ad_reward",
            currency="coins",
            amount=reward,
            item_type="ad",
            item_id="daily_coins",
            status="completed",
        )
    )
    await db.commit()
    return ClaimDailyCoinsResponse(
        success=True,
        coins=user.coins,
        reward_coins=reward,
        used_today=used_today + 1,
        limit_today=settings.AD_DAILY_COINS_LIMIT,
        resets_at=resets_at.replace(tzinfo=timezone.utc).isoformat(),
    )


@router.post("/claim/hint", response_model=ClaimHintResponse)
async def claim_hint(
    request: ClaimHintRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_eligible(user)
    result = await db.execute(
        update(User)
        .where(User.id == user.id, User.hint_balance == 0)
        .values(hint_balance=User.hint_balance + settings.AD_HINT_REWARD)
        .returning(User.hint_balance)
    )
    row = result.first()
    if row is None:
        raise HTTPException(status_code=409, detail={"error": FAILURE_HINT_BALANCE_NOT_ZERO})

    new_balance = int(row[0])
    db.add(
        AdRewardClaim(
            user_id=user.id,
            placement=PLACEMENT_HINT,
            ad_reference=request.ad_reference,
            reward_amount=settings.AD_HINT_REWARD,
        )
    )
    await db.commit()
    return ClaimHintResponse(success=True, hint_balance=new_balance)


@router.post("/claim/revive", response_model=ClaimReviveResponse)
async def claim_revive(
    request: ClaimReviveRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_eligible(user)
    db.add(
        AdRewardClaim(
            user_id=user.id,
            placement=PLACEMENT_REVIVE,
            ad_reference=request.ad_reference,
            session_id=request.session_id,
            level_number=request.level,
            reward_amount=1,
        )
    )
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail={"error": FAILURE_REVIVE_ALREADY_USED})
    await db.commit()
    return ClaimReviveResponse(
        success=True,
        revive_granted=True,
        session_id=request.session_id,
    )
