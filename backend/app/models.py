"""
Arrow Puzzle - Database Models

Все SQLAlchemy модели в одном файле.
"""

from datetime import datetime
from sqlalchemy import (
    Column, Integer, BigInteger, String, Boolean, DateTime,
    ForeignKey, Text, Numeric, Date, JSON, UniqueConstraint, func, text
)
from sqlalchemy.orm import relationship

from .database import Base


# ============================================
# USER
# ============================================

class User(Base):
    """Пользователь."""
    
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    telegram_id = Column(BigInteger, unique=True, nullable=False, index=True)
    username = Column(String(64), nullable=True)
    first_name = Column(String(128), nullable=True)
    locale = Column(String(8), nullable=False, server_default="en")
    locale_manually_set = Column(Boolean, nullable=False, server_default=text("false"))
    photo_url = Column(String(512), nullable=True)
    userbot_access_hash = Column(BigInteger, nullable=True)
    userbot_peer_status = Column(String(32), nullable=False, server_default="unknown", index=True)
    userbot_peer_verified_at = Column(DateTime, nullable=True)
    
    # Прогресс
    current_level = Column(Integer, default=1)
    total_stars = Column(Integer, default=0)
    level_reached_at = Column(DateTime, nullable=True)
    
    # Экономика
    coins = Column(Integer, default=0)
    hint_balance = Column(Integer, nullable=False, server_default="5")
    revive_balance = Column(Integer, nullable=False, server_default="0")
    extra_lives = Column(Integer, nullable=False, server_default="0")
    energy = Column(Integer, default=5)
    energy_updated_at = Column(DateTime, default=datetime.utcnow)
    
    # Статус
    is_premium = Column(Boolean, default=False)
    is_beta_tester = Column(Boolean, default=False)
    
    # Рефералы
    referral_code = Column(String(16), unique=True, nullable=True, index=True)
    referred_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    referrals_count = Column(Integer, default=0)       # подтверждённых (invitee достиг уровня подтверждения)
    referrals_pending = Column(Integer, default=0)     # ожидающих подтверждения
    referrals_earnings = Column(Integer, default=0)    # всего монет заработано с рефералов
    last_referral_confirmed_at = Column(DateTime, nullable=True)  # дата подтверждения последнего реферала (tiebreaker)
    
    # Активные скины
    active_arrow_skin = Column(String(64), default="default")
    active_theme = Column(String(64), default="light")

    # TON Wallet
    wallet_address = Column(String(128), nullable=True, unique=True, index=True)
    wallet_connected_at = Column(DateTime, nullable=True)

    # Кейсы
    stars_balance = Column(Integer, nullable=False, server_default="0")
    case_pity_counter = Column(Integer, nullable=False, server_default="0")

    # Ежедневная рулетка
    login_streak = Column(Integer, default=0)
    last_spin_date = Column(Date, nullable=True)
    last_spin_at = Column(DateTime, nullable=True)
    pending_spin_prize_type = Column(String(16), nullable=True)   # "coins"|"hints"|"revive"
    pending_spin_prize_amount = Column(Integer, nullable=True)
    spin_retry_used_date = Column(Date, nullable=True)
    spin_retry_used_at = Column(DateTime, nullable=True)
    spin_ready_notified_for_spin_at = Column(DateTime, nullable=True)
    streak_warning_notified_for_spin_at = Column(DateTime, nullable=True)
    streak_reset_notified_for_spin_at = Column(DateTime, nullable=True)
    
    
    # Онбординг
    onboarding_shown = Column(Boolean, nullable=False, server_default=text("false"))

    # Welcome offer
    welcome_offer_opened_at = Column(DateTime, nullable=True)   # когда юзер впервые открыл магазин
    welcome_offer_purchased = Column(Boolean, nullable=False, server_default=text("false"))

    # USDT blast уведомление (одноразовая рассылка)
    usdt_blast_sent = Column(Boolean, nullable=False, server_default=text("false"))

    # Ban система (для anti-cheat)
    is_banned = Column(Boolean, default=False)
    ban_reason = Column(String(256), nullable=True)
    banned_at = Column(DateTime, nullable=True)
    
    # Устройство (платформа Telegram: ios, android, tdesktop, macos, web, weba)
    platform = Column(String(32), nullable=True)

    # Метаданные
    created_at = Column(DateTime, default=datetime.utcnow)
    last_active_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    referred_by = relationship("User", remote_side=[id], backref="referrals")
    stats = relationship("UserStats", back_populates="user", uselist=False)
    inventory = relationship("Inventory", back_populates="user")
    transactions = relationship("Transaction", back_populates="user")
    referrals_sent = relationship("Referral", foreign_keys="Referral.inviter_id", back_populates="inviter")
    referral_received = relationship("Referral", foreign_keys="Referral.invitee_id", back_populates="invitee", uselist=False)
    stars_withdrawals = relationship("StarsWithdrawal", back_populates="user")
    
    def to_dict(self):
        return {
            "id": self.id,
            "telegram_id": self.telegram_id,
            "username": self.username,
            "first_name": self.first_name,
            "locale": self.locale,
            "locale_manually_set": self.locale_manually_set,
            "photo_url": self.photo_url,
            "current_level": self.current_level,
            "total_stars": self.total_stars,
            "coins": self.coins,
            "hint_balance": self.hint_balance,
            "revive_balance": self.revive_balance,
            "extra_lives": self.extra_lives,
            "energy": self.energy,
            "is_premium": self.is_premium,
            "active_arrow_skin": self.active_arrow_skin,
            "active_theme": self.active_theme,
            "referrals_count": self.referrals_count,
            "referrals_pending": self.referrals_pending,
            "wallet_address": self.wallet_address,
            "stars_balance": self.stars_balance,
            "case_pity_counter": self.case_pity_counter,
        }


# ============================================
# USER PLATFORM LOGINS
# ============================================

class UserPlatformLogin(Base):
    """
    Уникальная платформа, с которой заходил пользователь.
    Одна строка на пару (user_id, platform).
    first_seen_at — когда впервые, last_seen_at — когда последний раз.
    """

    __tablename__ = "user_platform_logins"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    platform = Column(String(32), nullable=False)
    first_seen_at = Column(DateTime, nullable=False)
    last_seen_at = Column(DateTime, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "platform", name="uq_user_platform"),
    )


# ============================================
# USER STATS
# ============================================

class UserStats(Base):
    """Статистика игрока."""
    
    __tablename__ = "user_stats"
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    
    # Общая статистика
    levels_completed = Column(Integer, default=0)
    total_moves = Column(Integer, default=0)
    total_mistakes = Column(Integer, default=0)
    total_hints_used = Column(Integer, default=0)
    
    # Аркадный режим
    arcade_best_score = Column(Integer, default=0)
    
    # Серии
    current_streak = Column(Integer, default=0)
    max_streak = Column(Integer, default=0)
    last_played_date = Column(Date, nullable=True)

    # Daily Challenge
    last_daily_date = Column(Date, nullable=True)
    daily_streak = Column(Integer, default=0)
    
    # Время
    total_playtime_seconds = Column(Integer, default=0)
    
    # Relationship
    user = relationship("User", back_populates="stats")


# ============================================
# INVENTORY
# ============================================

class Inventory(Base):
    """Инвентарь пользователя (купленные предметы)."""
    
    __tablename__ = "inventory"
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    
    item_type = Column(String(32), nullable=False)  # 'arrow_skin', 'theme', 'boost'
    item_id = Column(String(64), nullable=False)
    
    purchased_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationship
    user = relationship("User", back_populates="inventory")
    
    __table_args__ = (
        UniqueConstraint("user_id", "item_type", "item_id", name="uq_inventory_user_item"),
    )


# ============================================
# TRANSACTION
# ============================================

class Transaction(Base):
    """Транзакция (покупка, награда и т.д.)."""
    
    __tablename__ = "transactions"
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    
    type = Column(String(32), nullable=False)  # 'purchase', 'reward', 'ad', 'referral'
    currency = Column(String(16), nullable=False)  # 'coins', 'stars', 'ton'
    amount = Column(Numeric(18, 8), nullable=False)
    
    item_type = Column(String(32), nullable=True)
    item_id = Column(String(64), nullable=True)
    
    status = Column(String(16), default="completed")  # 'pending', 'completed', 'failed'
    
    # Для TON
    ton_tx_hash = Column(String(128), nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationship
    user = relationship("User", back_populates="transactions")


# ============================================
# STARS WITHDRAWAL
# ============================================

class StarsWithdrawal(Base):
    """Заявка пользователя на вывод накопленных Stars."""

    __tablename__ = "stars_withdrawals"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Снапшот данных пользователя на момент заявки
    telegram_id = Column(BigInteger, nullable=False)
    username = Column(String(64), nullable=True)

    amount = Column(Integer, nullable=False)

    # pending → completed | rejected
    status = Column(String(16), nullable=False, server_default="pending", index=True)
    admin_note = Column(String(256), nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    completed_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="stars_withdrawals")


# ============================================
# LEVEL ATTEMPT
# ============================================

class LevelAttempt(Base):
    """Попытка прохождения уровня (для античита)."""
    
    __tablename__ = "level_attempts"
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    
    level_number = Column(Integer, nullable=False)
    seed = Column(BigInteger, nullable=False)
    
    # Результат
    result = Column(String(16), nullable=True)  # 'win', 'lose', 'abandon'
    moves_count = Column(Integer, nullable=True)
    mistakes_count = Column(Integer, nullable=True)
    time_seconds = Column(Integer, nullable=True)
    
    # Детали
    moves_log = Column(JSON, nullable=True)  # Последовательность ходов
    
    created_at = Column(DateTime, default=datetime.utcnow)


# ============================================
# LEADERBOARD
# ============================================

class Leaderboard(Base):
    """Лидерборд."""
    
    __tablename__ = "leaderboard"
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    
    board_type = Column(String(32), nullable=False)  # 'global', 'weekly', 'arcade'
    score = Column(Integer, nullable=False)
    
    season = Column(Integer, default=1)
    
    updated_at = Column(DateTime, default=datetime.utcnow)


# ============================================
# REFERRAL
# ============================================

class Referral(Base):
    """
    Реферальная связь между пригласившим (inviter) и приглашённым (invitee).
    
    Жизненный цикл:
      pending   — invitee зарегистрировался по ссылке, получил +100 монет
      confirmed — invitee достиг уровня подтверждения, inviter получил +200 монет
    """
    
    __tablename__ = "referrals"
    
    id = Column(Integer, primary_key=True)
    inviter_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    invitee_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, unique=True)
    
    # Статус
    status = Column(String(16), default="pending", nullable=False, index=True)  # 'pending' | 'confirmed'
    confirmed_at = Column(DateTime, nullable=True)
    
    # Выплаты
    inviter_bonus_paid = Column(Boolean, default=False)
    invitee_bonus_paid = Column(Boolean, default=False)  # True сразу при создании (invitee получает +100)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    inviter = relationship("User", foreign_keys=[inviter_id], back_populates="referrals_sent")
    invitee = relationship("User", foreign_keys=[invitee_id], back_populates="referral_received")


# ============================================
# CHANNEL SUBSCRIPTION
# ============================================

class ChannelSubscription(Base):
    """Подписка на канал."""
    
    __tablename__ = "channel_subscriptions"
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    
    channel_id = Column(String(64), nullable=False)
    channel_username = Column(String(128), nullable=True)
    subscribed_at = Column(DateTime, default=datetime.utcnow)
    reward_claimed = Column(Boolean, default=False)

    __table_args__ = (
        UniqueConstraint("user_id", "channel_id", name="uq_channel_subscription_user_channel"),
    )


class TaskClaim(Base):
    """Факт успешного клейма задачи."""

    __tablename__ = "task_claims"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    claim_id = Column(String(128), nullable=False)
    task_group = Column(String(64), nullable=False)
    reward_coins = Column(Integer, nullable=False)
    claimed_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "claim_id", name="uq_task_claim_user_claim"),
    )


# ============================================
# AD REWARD CLAIM
# ============================================

class AdRewardClaim(Base):
    """Запись о выдаче награды за рекламу."""

    __tablename__ = "ad_reward_claims"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    placement = Column(String(32), nullable=False)    # reward_daily_coins | reward_hint | reward_revive
    ad_reference = Column(String(256), nullable=True)  # телеметрия от AdsGram
    session_id = Column(String(64), nullable=True)     # для revive idempotency
    level_number = Column(Integer, nullable=True)
    reward_amount = Column(Integer, nullable=True)
    claim_day_msk = Column(Date, nullable=True)        # для daily coins лимита

    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "placement", "session_id", name="uq_revive_per_session"),
    )


class AdRewardIntent(Base):
    """Pending/server-authoritative reward intent for rewarded ads."""

    __tablename__ = "ad_reward_intents"

    id = Column(Integer, primary_key=True)
    intent_id = Column(String(64), unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    placement = Column(String(32), nullable=False, index=True)
    status = Column(String(16), nullable=False, default="pending", index=True)
    session_id = Column(String(64), nullable=True)
    level_number = Column(Integer, nullable=True)
    failure_code = Column(String(64), nullable=True)

    coins = Column(Integer, nullable=True)
    hint_balance = Column(Integer, nullable=True)
    revive_granted = Column(Boolean, nullable=False, default=False)
    used_today = Column(Integer, nullable=True)
    limit_today = Column(Integer, nullable=True)
    resets_at = Column(DateTime, nullable=True)
    claim_day_msk = Column(Date, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    expires_at = Column(DateTime, nullable=False, index=True)
    fulfilled_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("intent_id", name="uq_ad_reward_intents_intent_id"),
    )


# ============================================
# FRAGMENT DROPS (Telegram Gifts)
# ============================================

class FragmentDrop(Base):
    """Кампания лимитного дропа — подарок Telegram за выполнение условия."""

    __tablename__ = "fragment_drops"

    id = Column(Integer, primary_key=True)
    slug = Column(String(64), unique=True, nullable=False, index=True)
    title = Column(String(256), nullable=False)
    description = Column(Text, nullable=True)
    title_translations = Column(JSON, nullable=True)
    description_translations = Column(JSON, nullable=True)
    emoji = Column(String(16), nullable=False, server_default="🎁")

    # Telegram Gift
    telegram_gift_id = Column(String(128), nullable=False)
    gift_star_cost = Column(Integer, nullable=False)

    # Условие
    condition_type = Column(String(32), nullable=False)   # arcade_levels | friends_confirmed
    condition_target = Column(Integer, nullable=False)

    # Сток: available = total_stock - reserved_stock - delivered_stock
    total_stock = Column(Integer, nullable=False)
    reserved_stock = Column(Integer, nullable=False, server_default="0")
    delivered_stock = Column(Integer, nullable=False, server_default="0")

    # Жизненный цикл
    is_active = Column(Boolean, nullable=False, server_default="true")
    priority = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    claims = relationship("FragmentClaim", back_populates="drop")


class FragmentClaim(Base):
    """Заявка пользователя на получение подарка из дропа."""

    __tablename__ = "fragment_claims"

    id = Column(Integer, primary_key=True)
    drop_id = Column(Integer, ForeignKey("fragment_drops.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # pending → sending → delivered | failed
    status = Column(String(16), nullable=False, server_default="pending", index=True)

    # Снапшот на момент клейма
    telegram_gift_id = Column(String(128), nullable=False)
    stars_cost = Column(Integer, nullable=False)

    # Ошибки и повторы
    failure_reason = Column(String(256), nullable=True)
    attempts = Column(Integer, nullable=False, server_default="0")
    last_attempt_at = Column(DateTime, nullable=True)

    # Таймстемпы
    created_at = Column(DateTime, server_default=func.now())
    delivered_at = Column(DateTime, nullable=True)
    failed_at = Column(DateTime, nullable=True)

    drop = relationship("FragmentDrop", back_populates="claims")

    __table_args__ = (
        UniqueConstraint("drop_id", "user_id", name="uq_fragment_claim_drop_user"),
    )


class BotStarsLedger(Base):
    """Аудит-лог изменений баланса Stars бота."""

    __tablename__ = "bot_stars_ledger"

    id = Column(Integer, primary_key=True)
    event_type = Column(String(32), nullable=False)       # gift_sent | stars_received | manual_topup | sync
    amount = Column(Integer, nullable=False)               # + приход, - расход
    balance_after = Column(Integer, nullable=True)

    fragment_claim_id = Column(Integer, ForeignKey("fragment_claims.id"), nullable=True)
    note = Column(String(256), nullable=True)
    created_at = Column(DateTime, server_default=func.now())


# ============================================
# USERBOT GIFTS (MTProto)
# ============================================

class UserbotGiftOrder(Base):
    """Очередь userbot-операций с подарками."""

    __tablename__ = "userbot_gift_orders"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    recipient_telegram_id = Column(BigInteger, nullable=False, index=True)

    operation_type = Column(String(32), nullable=False, index=True)  # send_gift | transfer_gift
    status = Column(String(16), nullable=False, server_default="pending", index=True)

    telegram_gift_id = Column(BigInteger, nullable=True)
    owned_gift_slug = Column(String(128), nullable=True)
    star_cost_estimate = Column(Integer, nullable=True)

    priority = Column(Integer, nullable=False, server_default="0", index=True)
    attempts = Column(Integer, nullable=False, server_default="0")
    max_attempts = Column(Integer, nullable=False, server_default="5")
    retry_after = Column(DateTime, nullable=True, index=True)
    failure_reason = Column(String(256), nullable=True)

    source_kind = Column(String(64), nullable=False)
    source_ref = Column(String(256), nullable=False)
    telegram_result_json = Column(JSON, nullable=True)

    created_at = Column(DateTime, server_default=func.now(), index=True)
    processing_started_at = Column(DateTime, nullable=True, index=True)
    completed_at = Column(DateTime, nullable=True)
    failed_at = Column(DateTime, nullable=True)

    user = relationship("User")


class UserbotStarsLedger(Base):
    """Аудит Stars-баланса userbot-аккаунта."""

    __tablename__ = "userbot_stars_ledger"

    id = Column(Integer, primary_key=True)
    event_type = Column(String(32), nullable=False)  # manual_topup | gift_purchase | transfer_fee | reconcile_adjustment
    amount = Column(Integer, nullable=False)
    balance_after = Column(Integer, nullable=True)

    gift_order_id = Column(Integer, ForeignKey("userbot_gift_orders.id"), nullable=True, index=True)
    note = Column(String(256), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    order = relationship("UserbotGiftOrder")


# ============================================
# CASE OPENINGS
# ============================================

class CaseOpening(Base):
    """Запись об открытии кейса."""

    __tablename__ = "case_openings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True, index=True)

    rarity = Column(String(16), nullable=False)           # 'common' | 'rare' | 'epic' | 'epic_stars'
    hints_given = Column(Integer, nullable=False)
    revives_given = Column(Integer, nullable=False)
    coins_given = Column(Integer, nullable=False)
    stars_given = Column(Integer, nullable=False)
    payment_currency = Column(String(8), nullable=False)  # 'stars' | 'ton'

    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User")

