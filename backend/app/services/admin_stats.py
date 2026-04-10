"""
Admin Statistics Service

All async DB query functions for the /admin bot panel.
Returns plain dicts — formatting is done in bot.py.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, func, case as sa_case, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AdRewardClaim,
    AdRewardIntent,
    CaseOpening,
    Leaderboard,
    LevelAttempt,
    Referral,
    StarsWithdrawal,
    Transaction,
    User,
    UserStats,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_cutoff(period: str) -> datetime | None:
    """Return the lower-bound timestamp for the given period string, or None for 'all'."""
    now = _utcnow()
    if period == "1d":
        return now - timedelta(days=1)
    if period == "7d":
        return now - timedelta(days=7)
    if period == "30d":
        return now - timedelta(days=30)
    return None  # "all"


def _int(v: Any) -> int:
    return int(v) if v is not None else 0


def _float(v: Any, digits: int = 1) -> float:
    return round(float(v), digits) if v is not None else 0.0


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

async def fetch_users_stats(db: AsyncSession, period: str) -> dict:
    cutoff = get_cutoff(period)

    total = _int(await db.scalar(select(func.count(User.id))))
    premium = _int(await db.scalar(select(func.count(User.id)).where(User.is_premium == True)))
    banned = _int(await db.scalar(select(func.count(User.id)).where(User.is_banned == True)))
    beta = _int(await db.scalar(select(func.count(User.id)).where(User.is_beta_tester == True)))
    with_wallet = _int(await db.scalar(select(func.count(User.id)).where(User.wallet_address.is_not(None))))
    via_referral = _int(await db.scalar(select(func.count(User.id)).where(User.referred_by_id.is_not(None))))

    if cutoff is not None:
        new = _int(await db.scalar(select(func.count(User.id)).where(User.created_at >= cutoff)))
        active = _int(await db.scalar(select(func.count(User.id)).where(User.last_active_at >= cutoff)))
    else:
        new = total
        active = _int(
            await db.scalar(select(func.count(User.id)).where(User.last_active_at.is_not(None)))
        )

    return {
        "total": total,
        "new": new,
        "active": active,
        "premium": premium,
        "banned": banned,
        "beta": beta,
        "with_wallet": with_wallet,
        "via_referral": via_referral,
        "period": period,
    }


# ---------------------------------------------------------------------------
# Game
# ---------------------------------------------------------------------------

async def fetch_game_stats(db: AsyncSession, period: str) -> dict:
    cutoff = get_cutoff(period)

    # Lifetime totals from UserStats (always all-time aggregates)
    stats_row = (await db.execute(
        select(
            func.count(UserStats.id),
            func.coalesce(func.sum(UserStats.levels_completed), 0),
            func.coalesce(func.sum(UserStats.total_moves), 0),
            func.coalesce(func.sum(UserStats.total_mistakes), 0),
            func.coalesce(func.sum(UserStats.total_hints_used), 0),
            func.coalesce(func.sum(UserStats.total_playtime_seconds), 0),
            func.coalesce(func.max(UserStats.max_streak), 0),
            func.coalesce(func.avg(UserStats.levels_completed), 0),
        )
    )).one()

    users_with_stats = _int(stats_row[0])
    total_levels_completed = _int(stats_row[1])
    total_moves = _int(stats_row[2])
    total_mistakes = _int(stats_row[3])
    total_hints_used = _int(stats_row[4])
    total_playtime_seconds = _int(stats_row[5])
    max_streak_ever = _int(stats_row[6])
    avg_levels_per_user = _float(stats_row[7])

    max_level = _int(await db.scalar(select(func.max(User.current_level))))
    avg_level = _float(await db.scalar(select(func.avg(User.current_level))))

    # Windowed LevelAttempt stats
    attempt_q = select(
        func.count(LevelAttempt.id),
        func.coalesce(func.sum(
            sa_case((LevelAttempt.result == "win", 1), else_=0)
        ), 0),
        func.coalesce(func.sum(
            sa_case((LevelAttempt.result == "lose", 1), else_=0)
        ), 0),
        func.coalesce(func.sum(
            sa_case((LevelAttempt.result == "abandon", 1), else_=0)
        ), 0),
        func.coalesce(func.avg(LevelAttempt.time_seconds), 0),
        func.coalesce(func.avg(LevelAttempt.mistakes_count), 0),
    )
    if cutoff is not None:
        attempt_q = attempt_q.where(LevelAttempt.created_at >= cutoff)

    att = (await db.execute(attempt_q)).one()
    total_attempts = _int(att[0])
    wins = _int(att[1])
    losses = _int(att[2])
    abandons = _int(att[3])
    avg_time_sec = _int(att[4])
    avg_mistakes = _float(att[5])

    win_rate = round(wins / total_attempts * 100, 1) if total_attempts > 0 else 0.0

    # Unique players who attempted in period
    unique_q = select(func.count(func.distinct(LevelAttempt.user_id)))
    if cutoff is not None:
        unique_q = unique_q.where(LevelAttempt.created_at >= cutoff)
    unique_players = _int(await db.scalar(unique_q))

    return {
        "period": period,
        # lifetime
        "users_with_stats": users_with_stats,
        "total_levels_completed": total_levels_completed,
        "total_moves": total_moves,
        "total_mistakes": total_mistakes,
        "total_hints_used": total_hints_used,
        "total_playtime_seconds": total_playtime_seconds,
        "max_streak_ever": max_streak_ever,
        "avg_levels_per_user": avg_levels_per_user,
        "max_level": max_level,
        "avg_level": avg_level,
        # windowed
        "total_attempts": total_attempts,
        "wins": wins,
        "losses": losses,
        "abandons": abandons,
        "win_rate": win_rate,
        "avg_time_sec": avg_time_sec,
        "avg_mistakes": avg_mistakes,
        "unique_players": unique_players,
    }


# ---------------------------------------------------------------------------
# Economy
# ---------------------------------------------------------------------------

async def fetch_economy_stats(db: AsyncSession, period: str) -> dict:
    cutoff = get_cutoff(period)

    # Real-time balances (no period filter)
    coins_circ = _int(await db.scalar(select(func.coalesce(func.sum(User.coins), 0))))
    stars_circ = _int(await db.scalar(select(func.coalesce(func.sum(User.stars_balance), 0))))
    hints_circ = _int(await db.scalar(select(func.coalesce(func.sum(User.hint_balance), 0))))
    revives_circ = _int(await db.scalar(select(func.coalesce(func.sum(User.revive_balance), 0))))

    # Transactions in period
    tx_q = select(
        func.count(Transaction.id),
        func.coalesce(func.sum(
            sa_case((Transaction.type == "purchase", 1), else_=0)
        ), 0),
        func.coalesce(func.sum(
            sa_case((and_(Transaction.type == "purchase", Transaction.currency == "stars"), 1), else_=0)
        ), 0),
        func.coalesce(func.sum(
            sa_case((and_(Transaction.type == "purchase", Transaction.currency == "ton"), 1), else_=0)
        ), 0),
        func.coalesce(func.sum(
            sa_case((and_(Transaction.type == "purchase", Transaction.currency == "coins"), 1), else_=0)
        ), 0),
        func.coalesce(func.sum(
            sa_case((Transaction.type == "reward", 1), else_=0)
        ), 0),
        func.coalesce(func.sum(
            sa_case((Transaction.type == "referral", 1), else_=0)
        ), 0),
    ).where(Transaction.status == "completed")
    if cutoff is not None:
        tx_q = tx_q.where(Transaction.created_at >= cutoff)

    tx = (await db.execute(tx_q)).one()
    total_tx = _int(tx[0])
    total_purchases = _int(tx[1])
    purchases_stars = _int(tx[2])
    purchases_ton = _int(tx[3])
    purchases_coins = _int(tx[4])
    rewards_tx = _int(tx[5])
    referral_tx = _int(tx[6])

    # Stars withdrawals (all-time for context)
    wd_q = select(
        func.coalesce(func.sum(
            sa_case((StarsWithdrawal.status == "pending", 1), else_=0)
        ), 0),
        func.coalesce(func.sum(
            sa_case((StarsWithdrawal.status == "pending", StarsWithdrawal.amount), else_=0)
        ), 0),
        func.coalesce(func.sum(
            sa_case((StarsWithdrawal.status == "completed", 1), else_=0)
        ), 0),
        func.coalesce(func.sum(
            sa_case((StarsWithdrawal.status == "completed", StarsWithdrawal.amount), else_=0)
        ), 0),
    )
    wd = (await db.execute(wd_q)).one()
    withdrawals_pending_count = _int(wd[0])
    withdrawals_pending_amount = _int(wd[1])
    withdrawals_done_count = _int(wd[2])
    withdrawals_done_amount = _int(wd[3])

    return {
        "period": period,
        # balances
        "coins_circ": coins_circ,
        "stars_circ": stars_circ,
        "hints_circ": hints_circ,
        "revives_circ": revives_circ,
        # transactions
        "total_tx": total_tx,
        "total_purchases": total_purchases,
        "purchases_stars": purchases_stars,
        "purchases_ton": purchases_ton,
        "purchases_coins": purchases_coins,
        "rewards_tx": rewards_tx,
        "referral_tx": referral_tx,
        # withdrawals
        "withdrawals_pending_count": withdrawals_pending_count,
        "withdrawals_pending_amount": withdrawals_pending_amount,
        "withdrawals_done_count": withdrawals_done_count,
        "withdrawals_done_amount": withdrawals_done_amount,
    }


# ---------------------------------------------------------------------------
# Referrals
# ---------------------------------------------------------------------------

async def fetch_referral_stats(db: AsyncSession, period: str) -> dict:
    cutoff = get_cutoff(period)

    # All-time totals
    total_refs = _int(await db.scalar(select(func.count(Referral.id))))
    total_confirmed = _int(await db.scalar(
        select(func.count(Referral.id)).where(Referral.status == "confirmed")
    ))
    total_pending = _int(await db.scalar(
        select(func.count(Referral.id)).where(Referral.status == "pending")
    ))

    confirm_rate = round(total_confirmed / total_refs * 100, 1) if total_refs > 0 else 0.0

    # Period-windowed
    if cutoff is not None:
        new_refs = _int(await db.scalar(
            select(func.count(Referral.id)).where(Referral.created_at >= cutoff)
        ))
        confirmed_in_period = _int(await db.scalar(
            select(func.count(Referral.id))
            .where(Referral.status == "confirmed", Referral.confirmed_at >= cutoff)
        ))
    else:
        new_refs = total_refs
        confirmed_in_period = total_confirmed

    # Total coins paid via referrals
    total_earnings = _int(await db.scalar(
        select(func.coalesce(func.sum(User.referrals_earnings), 0))
    ))

    # Top 5 referrers
    top_rows = (await db.execute(
        select(User.username, User.first_name, User.telegram_id, User.referrals_count, User.referrals_earnings)
        .where(User.referrals_count > 0)
        .order_by(User.referrals_count.desc())
        .limit(5)
    )).all()
    top_referrers = [
        {
            "username": r.username,
            "first_name": r.first_name,
            "telegram_id": r.telegram_id,
            "count": r.referrals_count,
            "earnings": r.referrals_earnings,
        }
        for r in top_rows
    ]

    return {
        "period": period,
        "total_refs": total_refs,
        "total_confirmed": total_confirmed,
        "total_pending": total_pending,
        "confirm_rate": confirm_rate,
        "new_refs": new_refs,
        "confirmed_in_period": confirmed_in_period,
        "total_earnings": total_earnings,
        "top_referrers": top_referrers,
    }


# ---------------------------------------------------------------------------
# Cases & Spins
# ---------------------------------------------------------------------------

async def fetch_cases_spins_stats(db: AsyncSession, period: str) -> dict:
    cutoff = get_cutoff(period)

    # Case openings in period
    case_q = select(
        func.count(CaseOpening.id),
        func.coalesce(func.sum(sa_case((CaseOpening.rarity == "common", 1), else_=0)), 0),
        func.coalesce(func.sum(sa_case((CaseOpening.rarity == "rare", 1), else_=0)), 0),
        func.coalesce(func.sum(sa_case((CaseOpening.rarity == "epic", 1), else_=0)), 0),
        func.coalesce(func.sum(sa_case((CaseOpening.rarity == "epic_stars", 1), else_=0)), 0),
        func.coalesce(func.sum(sa_case((CaseOpening.payment_currency == "stars", 1), else_=0)), 0),
        func.coalesce(func.sum(sa_case((CaseOpening.payment_currency == "ton", 1), else_=0)), 0),
        func.coalesce(func.sum(CaseOpening.hints_given), 0),
        func.coalesce(func.sum(CaseOpening.revives_given), 0),
        func.coalesce(func.sum(CaseOpening.coins_given), 0),
        func.coalesce(func.sum(CaseOpening.stars_given), 0),
    )
    if cutoff is not None:
        case_q = case_q.where(CaseOpening.created_at >= cutoff)

    cr = (await db.execute(case_q)).one()
    total_cases = _int(cr[0])
    cases_common = _int(cr[1])
    cases_rare = _int(cr[2])
    cases_epic = _int(cr[3])
    cases_epic_stars = _int(cr[4])
    cases_paid_stars = _int(cr[5])
    cases_paid_ton = _int(cr[6])
    cases_hints_given = _int(cr[7])
    cases_revives_given = _int(cr[8])
    cases_coins_given = _int(cr[9])
    cases_stars_given = _int(cr[10])

    # User pity counters (real-time, all users)
    pity_row = (await db.execute(
        select(
            func.coalesce(func.avg(User.case_pity_counter), 0),
            func.coalesce(func.max(User.case_pity_counter), 0),
        )
    )).one()
    avg_pity = _float(pity_row[0])
    max_pity = _int(pity_row[1])

    # Spin / streak stats (real-time)
    spin_row = (await db.execute(
        select(
            func.count(User.id),
            func.coalesce(func.sum(sa_case((User.login_streak > 0, 1), else_=0)), 0),
            func.coalesce(func.avg(User.login_streak), 0),
            func.coalesce(func.max(User.login_streak), 0),
            # Streak tier distribution
            func.coalesce(func.sum(sa_case((User.login_streak == 0, 1), else_=0)), 0),
            func.coalesce(func.sum(
                sa_case((and_(User.login_streak >= 1, User.login_streak <= 5), 1), else_=0)
            ), 0),
            func.coalesce(func.sum(
                sa_case((and_(User.login_streak >= 6, User.login_streak <= 13), 1), else_=0)
            ), 0),
            func.coalesce(func.sum(sa_case((User.login_streak >= 14, 1), else_=0)), 0),
            # Unclaimed spin prizes
            func.coalesce(func.sum(
                sa_case((User.pending_spin_prize_type.is_not(None), 1), else_=0)
            ), 0),
        )
    )).one()

    total_users = _int(spin_row[0])
    active_spinners = _int(spin_row[1])
    avg_streak = _float(spin_row[2])
    max_streak = _int(spin_row[3])
    tier0 = _int(spin_row[4])
    tier1 = _int(spin_row[5])
    tier2 = _int(spin_row[6])
    tier3 = _int(spin_row[7])
    unclaimed_prizes = _int(spin_row[8])

    return {
        "period": period,
        # cases
        "total_cases": total_cases,
        "cases_common": cases_common,
        "cases_rare": cases_rare,
        "cases_epic": cases_epic,
        "cases_epic_stars": cases_epic_stars,
        "cases_paid_stars": cases_paid_stars,
        "cases_paid_ton": cases_paid_ton,
        "cases_hints_given": cases_hints_given,
        "cases_revives_given": cases_revives_given,
        "cases_coins_given": cases_coins_given,
        "cases_stars_given": cases_stars_given,
        # pity
        "avg_pity": avg_pity,
        "max_pity": max_pity,
        # spins
        "total_users": total_users,
        "active_spinners": active_spinners,
        "avg_streak": avg_streak,
        "max_streak": max_streak,
        "tier0": tier0,
        "tier1": tier1,
        "tier2": tier2,
        "tier3": tier3,
        "unclaimed_prizes": unclaimed_prizes,
    }


# ---------------------------------------------------------------------------
# Ads
# ---------------------------------------------------------------------------

async def fetch_ads_stats(db: AsyncSession, period: str) -> dict:
    cutoff = get_cutoff(period)

    PLACEMENTS = [
        "reward_daily_coins",
        "reward_hint",
        "reward_revive",
        "reward_spin_retry",
        "reward_task",
    ]

    # Claims per placement
    claims_q = select(
        AdRewardClaim.placement,
        func.count(AdRewardClaim.id),
        func.coalesce(func.sum(AdRewardClaim.reward_amount), 0),
    ).group_by(AdRewardClaim.placement)
    if cutoff is not None:
        claims_q = claims_q.where(AdRewardClaim.created_at >= cutoff)

    claims_rows = (await db.execute(claims_q)).all()
    claims_by_placement: dict[str, dict] = {}
    for row in claims_rows:
        claims_by_placement[row[0]] = {"count": _int(row[1]), "amount": _int(row[2])}

    total_claims = sum(v["count"] for v in claims_by_placement.values())

    # Intent statuses in period
    intent_q = select(
        AdRewardIntent.status,
        func.count(AdRewardIntent.id),
    ).group_by(AdRewardIntent.status)
    if cutoff is not None:
        intent_q = intent_q.where(AdRewardIntent.created_at >= cutoff)

    intent_rows = (await db.execute(intent_q)).all()
    intents_by_status: dict[str, int] = {}
    for row in intent_rows:
        intents_by_status[row[0]] = _int(row[1])

    return {
        "period": period,
        "total_claims": total_claims,
        "claims_by_placement": claims_by_placement,
        "intents_by_status": intents_by_status,
    }


# ---------------------------------------------------------------------------
# Seasons
# ---------------------------------------------------------------------------

async def fetch_seasons_stats(db: AsyncSession) -> dict:
    # Current season from global leaderboard
    current_season = _int(await db.scalar(
        select(func.max(Leaderboard.season)).where(Leaderboard.board_type == "global")
    )) or 1

    # Players per board_type for current season
    board_counts_rows = (await db.execute(
        select(Leaderboard.board_type, func.count(Leaderboard.id))
        .where(Leaderboard.season == current_season)
        .group_by(Leaderboard.board_type)
    )).all()
    board_counts: dict[str, int] = {r[0]: _int(r[1]) for r in board_counts_rows}

    # Historical season counts (global board)
    season_history_rows = (await db.execute(
        select(Leaderboard.season, func.count(Leaderboard.id))
        .where(Leaderboard.board_type == "global")
        .group_by(Leaderboard.season)
        .order_by(Leaderboard.season.desc())
        .limit(5)
    )).all()
    season_history = [{"season": _int(r[0]), "players": _int(r[1])} for r in season_history_rows]

    # Top 5 global current season
    top5_rows = (await db.execute(
        select(User.username, User.first_name, User.telegram_id, User.current_level, Leaderboard.score)
        .join(Leaderboard, Leaderboard.user_id == User.id)
        .where(Leaderboard.board_type == "global", Leaderboard.season == current_season)
        .order_by(Leaderboard.score.desc(), Leaderboard.updated_at.asc())
        .limit(5)
    )).all()
    top5 = [
        {
            "username": r.username,
            "first_name": r.first_name,
            "level": r.current_level,
            "score": r.score,
        }
        for r in top5_rows
    ]

    # Daily challenge stats (from UserStats)
    daily_row = (await db.execute(
        select(
            func.coalesce(func.sum(sa_case((UserStats.daily_streak > 0, 1), else_=0)), 0),
            func.coalesce(func.max(UserStats.daily_streak), 0),
            func.coalesce(func.avg(UserStats.daily_streak), 0),
        )
    )).one()
    daily_active_streaks = _int(daily_row[0])
    daily_max_streak = _int(daily_row[1])
    daily_avg_streak = _float(daily_row[2])

    return {
        "current_season": current_season,
        "board_counts": board_counts,
        "season_history": season_history,
        "top5": top5,
        "daily_active_streaks": daily_active_streaks,
        "daily_max_streak": daily_max_streak,
        "daily_avg_streak": daily_avg_streak,
    }


# ---------------------------------------------------------------------------
# User Profile
# ---------------------------------------------------------------------------

async def fetch_user_profile(db: AsyncSession, identifier: str) -> dict | None:
    """
    Look up a user by telegram_id (int string) or @username.
    Returns a rich profile dict, or None if not found.
    """
    user: User | None = None

    cleaned = identifier.strip()
    if cleaned.startswith("@"):
        uname = cleaned[1:]
        result = await db.execute(select(User).where(User.username == uname))
        user = result.scalar_one_or_none()
    else:
        try:
            tg_id = int(cleaned)
            result = await db.execute(select(User).where(User.telegram_id == tg_id))
            user = result.scalar_one_or_none()
        except ValueError:
            return None

    if user is None:
        return None

    # Load stats
    stats_result = await db.execute(select(UserStats).where(UserStats.user_id == user.id))
    stats: UserStats | None = stats_result.scalar_one_or_none()

    # Load referrer name
    referrer_name: str | None = None
    if user.referred_by_id:
        ref_result = await db.execute(
            select(User.username, User.first_name).where(User.id == user.referred_by_id)
        )
        ref_row = ref_result.one_or_none()
        if ref_row:
            referrer_name = f"@{ref_row.username}" if ref_row.username else ref_row.first_name

    return {
        "id": user.id,
        "telegram_id": user.telegram_id,
        "username": user.username,
        "first_name": user.first_name,
        "locale": user.locale,
        "is_premium": user.is_premium,
        "is_beta_tester": user.is_beta_tester,
        "is_banned": user.is_banned,
        "ban_reason": user.ban_reason,
        "banned_at": user.banned_at,
        "created_at": user.created_at,
        "last_active_at": user.last_active_at,
        # game
        "current_level": user.current_level,
        "total_stars": user.total_stars,
        "level_reached_at": user.level_reached_at,
        "active_arrow_skin": user.active_arrow_skin,
        "active_theme": user.active_theme,
        # economy
        "coins": user.coins,
        "stars_balance": user.stars_balance,
        "hint_balance": user.hint_balance,
        "revive_balance": user.revive_balance,
        "extra_lives": user.extra_lives,
        "energy": user.energy,
        # referrals
        "referrals_count": user.referrals_count,
        "referrals_pending": user.referrals_pending,
        "referrals_earnings": user.referrals_earnings,
        "referrer_name": referrer_name,
        # spin
        "login_streak": user.login_streak,
        "last_spin_at": user.last_spin_at,
        "last_spin_date": user.last_spin_date,
        "pending_spin_prize_type": user.pending_spin_prize_type,
        "pending_spin_prize_amount": user.pending_spin_prize_amount,
        # case
        "case_pity_counter": user.case_pity_counter,
        # wallet
        "wallet_address": user.wallet_address,
        "wallet_connected_at": user.wallet_connected_at,
        # onboarding
        "onboarding_shown": user.onboarding_shown,
        "welcome_offer_purchased": user.welcome_offer_purchased,
        # stats
        "levels_completed": stats.levels_completed if stats else 0,
        "total_moves": stats.total_moves if stats else 0,
        "total_mistakes": stats.total_mistakes if stats else 0,
        "total_hints_used": stats.total_hints_used if stats else 0,
        "total_playtime_seconds": stats.total_playtime_seconds if stats else 0,
        "current_streak": stats.current_streak if stats else 0,
        "max_streak": stats.max_streak if stats else 0,
        "daily_streak": stats.daily_streak if stats else 0,
    }
