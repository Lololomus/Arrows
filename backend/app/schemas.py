"""
Arrow Puzzle - Pydantic Schemas

Все схемы валидации в одном файле.
"""

from datetime import datetime
from typing import Optional, List, Union
from pydantic import BaseModel, Field


# ============================================
# AUTH
# ============================================

class TelegramAuthRequest(BaseModel):
    """Запрос авторизации через Telegram."""
    init_data: str


class AuthResponse(BaseModel):
    """Ответ авторизации."""
    token: str
    user: dict


# ============================================
# USER
# ============================================

class UserBase(BaseModel):
    """Базовая схема пользователя."""
    telegram_id: int
    username: Optional[str] = None
    first_name: Optional[str] = None
    photo_url: Optional[str] = None


class UserResponse(BaseModel):
    """Ответ с данными пользователя."""
    id: int
    telegram_id: int
    username: Optional[str]
    first_name: Optional[str]
    photo_url: Optional[str]
    current_level: int
    total_stars: int
    coins: int
    energy: int
    is_premium: bool
    active_arrow_skin: str
    active_theme: str
    
    class Config:
        from_attributes = True


# ============================================
# GAME
# ============================================

class Cell(BaseModel):
    """Клетка на поле."""
    x: int
    y: int


class Arrow(BaseModel):
    """Стрелка."""
    id: str
    cells: List[Cell]
    direction: str  # 'right', 'left', 'up', 'down'
    type: str = "normal"  # 'normal', 'ice', 'plus_life', etc.
    color: str
    frozen: Optional[bool] = None


class Grid(BaseModel):
    """Сетка поля."""
    width: int
    height: int
    # Поддержка пустых клеток для сложных форм
    void_cells: List[Cell] = []


class LevelMeta(BaseModel):
    """Метаданные уровня."""
    # Разрешаем число или строку (для совместимости с Godot JSON)
    difficulty: Union[float, int, str]
    arrow_count: int
    special_arrow_count: int = 0
    dag_depth: int = 1


class LevelResponse(BaseModel):
    """Ответ с данными уровня."""
    level: int
    seed: int
    grid: Grid
    arrows: List[Arrow]
    meta: LevelMeta


class CompleteRequest(BaseModel):
    """Запрос завершения уровня."""
    level: int
    seed: int
    moves: List[str]  # Последовательность ID стрелок
    time_seconds: int


class CompleteResponse(BaseModel):
    """Ответ завершения уровня."""
    valid: bool
    stars: int = 0
    coins_earned: int = 0
    new_level_unlocked: bool = False
    error: Optional[str] = None


class EnergyResponse(BaseModel):
    """Ответ энергии."""
    energy: int
    max_energy: int
    seconds_to_next: int


class HintRequest(BaseModel):
    """Запрос подсказки."""
    level: int
    seed: int
    remaining_arrows: List[str]


class HintResponse(BaseModel):
    """Ответ подсказки."""
    arrow_id: str


# ============================================
# SHOP
# ============================================

class ShopItem(BaseModel):
    """Товар в магазине."""
    id: str
    name: str
    price_coins: Optional[int] = None
    price_stars: Optional[int] = None
    price_ton: Optional[float] = None
    preview: Optional[str] = None
    owned: bool = False


class ShopCatalog(BaseModel):
    """Каталог магазина."""
    arrow_skins: List[ShopItem]
    themes: List[ShopItem]
    boosts: List[ShopItem]


class PurchaseRequest(BaseModel):
    """Запрос покупки."""
    item_type: str  # 'arrow_skins', 'themes', 'boosts'
    item_id: str


class PurchaseResponse(BaseModel):
    """Ответ покупки."""
    success: bool
    coins: Optional[int] = None
    error: Optional[str] = None


class TonPaymentInfo(BaseModel):
    """Информация для TON оплаты."""
    transaction_id: int
    address: str
    amount: float
    comment: str


# ============================================
# SOCIAL
# ============================================

class ReferralCodeResponse(BaseModel):
    """Ответ реферального кода."""
    code: str
    link: str


class ReferralApplyRequest(BaseModel):
    """Запрос применения реферала."""
    code: str


class ReferralApplyResponse(BaseModel):
    """Ответ применения реферала."""
    success: bool
    bonus: int = 0


class ReferralStatsResponse(BaseModel):
    """Статистика рефералов."""
    referrals_count: int
    total_earned: int


class LeaderboardEntry(BaseModel):
    """Запись в лидерборде."""
    rank: int
    user_id: int
    username: Optional[str]
    first_name: Optional[str]
    score: int


class LeaderboardResponse(BaseModel):
    """Ответ лидерборда."""
    leaders: List[LeaderboardEntry]
    my_position: Optional[int]


class RewardChannel(BaseModel):
    """Канал для подписки."""
    id: str
    name: str
    reward_coins: int
    claimed: bool = False


class ClaimChannelRequest(BaseModel):
    """Запрос награды за подписку."""
    channel_id: str


# ============================================
# WEBHOOKS
# ============================================

class TelegramPaymentWebhook(BaseModel):
    """Вебхук оплаты Telegram."""
    update_id: int
    # ... остальные поля


class TonPaymentWebhook(BaseModel):
    """Вебхук оплаты TON."""
    tx_hash: str
    comment: str
    amount: float


class AdsgramRewardWebhook(BaseModel):
    """Вебхук награды за рекламу."""
    user_id: int
    reward_type: str
    ad_id: str
