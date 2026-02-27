"""
Arrow Puzzle - Database Models

Все SQLAlchemy модели в одном файле.
"""

from datetime import datetime
from sqlalchemy import (
    Column, Integer, BigInteger, String, Boolean, DateTime, 
    ForeignKey, Text, Numeric, Date, JSON
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
    photo_url = Column(String(512), nullable=True)
    
    # Прогресс
    current_level = Column(Integer, default=1)
    total_stars = Column(Integer, default=0)
    
    # Экономика
    coins = Column(Integer, default=0)
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
    
    # Активные скины
    active_arrow_skin = Column(String(64), default="default")
    active_theme = Column(String(64), default="light")
    
    
    # Ban система (для anti-cheat)
    is_banned = Column(Boolean, default=False)
    ban_reason = Column(String(256), nullable=True)
    banned_at = Column(DateTime, nullable=True)
    
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
    
    def to_dict(self):
        return {
            "id": self.id,
            "telegram_id": self.telegram_id,
            "username": self.username,
            "first_name": self.first_name,
            "photo_url": self.photo_url,
            "current_level": self.current_level,
            "total_stars": self.total_stars,
            "coins": self.coins,
            "energy": self.energy,
            "is_premium": self.is_premium,
            "active_arrow_skin": self.active_arrow_skin,
            "active_theme": self.active_theme,
            "referrals_count": self.referrals_count,
            "referrals_pending": self.referrals_pending,
        }


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
        # Уникальность: user + item_type + item_id
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
    subscribed_at = Column(DateTime, default=datetime.utcnow)
    reward_claimed = Column(Boolean, default=False)
