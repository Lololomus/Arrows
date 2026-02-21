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
