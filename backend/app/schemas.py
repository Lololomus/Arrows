"""
Arrow Puzzle - Pydantic Schemas

Все схемы валидации в одном файле.
"""

from datetime import datetime
from typing import Literal, Optional, List, Union, Dict
from pydantic import BaseModel, Field


# ============================================
# AUTH
# ============================================

class TelegramAuthRequest(BaseModel):
    """Запрос авторизации через Telegram."""
    init_data: str


class UserLocaleUpdateRequest(BaseModel):
    locale: Literal["ru", "en"]


class AuthResponse(BaseModel):
    """Ответ авторизации."""
    token: str
    expires_at: str
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
    locale: Literal["ru", "en"] = "en"
    locale_manually_set: bool = False
    photo_url: Optional[str]
    current_level: int
    total_stars: int
    coins: int
    hint_balance: int
    revive_balance: int
    extra_lives: int = 0
    energy: int
    is_premium: bool
    active_arrow_skin: str
    active_theme: str
    referrals_count: int = 0
    referrals_pending: int = 0
    wallet_address: Optional[str] = None
    stars_balance: int = 0
    case_pity_counter: int = 0
    onboarding_shown: bool = False
    welcome_offer_opened_at: Optional[str] = None
    welcome_offer_purchased: bool = False

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
    daily_day_number: Optional[int] = None
    daily_date: Optional[str] = None


class CompleteRequest(BaseModel):
    """Запрос завершения уровня."""
    level: int
    seed: int
    moves: List[str]  # Последовательность ID стрелок
    time_seconds: int
    is_daily: bool = False


class CompleteResponse(BaseModel):
    """Ответ завершения уровня."""
    valid: bool
    stars: int = 0
    coins_earned: int = 0
    total_coins: Optional[int] = None
    current_level: int
    new_level_unlocked: bool = False
    already_completed: bool = False
    error: Optional[str] = None
    # Реферал: true если на этом уровне подтвердился реферал invitee
    referral_confirmed: bool = False


class CompleteAndNextResponse(BaseModel):
    """Ответ атомарного complete + next."""
    completion: CompleteResponse
    next_level: Optional[LevelResponse] = None
    next_level_exists: bool = False


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
    hint_balance: int


# ============================================
# SHOP
# ============================================

class ShopDiscountTier(BaseModel):
    min_quantity: int
    percent: int


class ShopItem(BaseModel):
    """Товар в магазине."""
    id: str
    name: str
    price_coins: Optional[int] = None
    price_stars: Optional[int] = None
    price_ton: Optional[float] = None
    discount_tiers: List[ShopDiscountTier] = []
    preview: Optional[str] = None
    owned: bool = False
    max_purchases: Optional[int] = None
    purchased_count: Optional[int] = None


class ShopCatalog(BaseModel):
    """Каталог магазина."""
    arrow_skins: List[ShopItem]
    themes: List[ShopItem]
    boosts: List[ShopItem]
    upgrades: List[ShopItem] = []


class PurchaseRequest(BaseModel):
    """Запрос покупки."""
    item_type: str  # 'arrow_skins', 'themes', 'boosts'
    item_id: str
    quantity: int = Field(default=1, ge=1, le=10)


class PurchaseResponse(BaseModel):
    """Ответ покупки."""
    success: bool
    coins: Optional[int] = None
    hint_balance: Optional[int] = None
    revive_balance: Optional[int] = None
    error: Optional[str] = None


class TonPaymentInfo(BaseModel):
    """Информация для TON оплаты."""
    transaction_id: int
    address: str
    amount: float
    amount_nano: str  # nanoTON string for TonConnect sendTransaction
    comment: str


class TransactionStatusResponse(BaseModel):
    """Статус транзакции."""
    transaction_id: int
    status: str


# ============================================
# WALLET (TON Connect)
# ============================================

class WalletConnectRequest(BaseModel):
    """TON Connect proof для привязки кошелька."""
    address: str
    proof: dict

class WalletConnectResponse(BaseModel):
    """Результат подключения кошелька."""
    success: bool
    wallet_address: Optional[str] = None
    error: Optional[str] = None

class WalletStatusResponse(BaseModel):
    """Статус кошелька."""
    connected: bool
    wallet_address: Optional[str] = None

class WalletDisconnectResponse(BaseModel):
    """Результат отключения кошелька."""
    success: bool


# ============================================
# CASES
# ============================================

class CaseInfo(BaseModel):
    """Информация о кейсе."""
    id: str
    name: str
    price_stars: int
    price_ton: float
    pity_counter: int
    pity_threshold: int


class CaseRewardItem(BaseModel):
    """Позиция награды из кейса."""
    type: str   # 'hints' | 'revives' | 'coins' | 'stars'
    amount: int


class CaseOpenResult(BaseModel):
    """Результат открытия кейса."""
    rarity: str                     # 'common' | 'rare' | 'epic' | 'epic_stars'
    rewards: List[CaseRewardItem]
    hint_balance: int
    revive_balance: int
    coins: int
    stars_balance: int
    case_pity_counter: int


class CaseStarsBalance(BaseModel):
    """Баланс накопленных Stars пользователя."""
    stars_balance: int


class WithdrawStarsRequest(BaseModel):
    amount: int


class WithdrawalResponse(BaseModel):
    id: int
    amount: int
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class WithdrawalListResponse(BaseModel):
    withdrawals: List[WithdrawalResponse]


# ============================================
# SOCIAL - REFERRALS
# ============================================

class ReferralCodeResponse(BaseModel):
    """Ответ реферального кода."""
    code: str
    link: str


class ReferralApplyRequest(BaseModel):
    """Запрос применения реферала."""
    code: str


class ReferralApplyResponse(BaseModel):
    """
    Ответ применения реферала.
    reason присутствует только при success=False.
    """
    success: bool
    bonus: int = 0
    reason: Optional[str] = None  # 'already_referred' | 'self_referral' | 'invalid_code' | 'account_too_old'


class ReferralStatsResponse(BaseModel):
    """Статистика рефералов текущего пользователя."""
    referrals_count: int
    referrals_pending: int
    total_earned: int
    referral_code: Optional[str]
    referral_link: Optional[str]
    referral_confirm_level: int


class ReferralInfo(BaseModel):
    """Один реферал в списке приглашённых."""
    id: int
    username: Optional[str]
    first_name: Optional[str]
    photo_url: Optional[str]
    current_level: int
    status: str  # 'pending' | 'confirmed'
    confirmed_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class ReferralListResponse(BaseModel):
    """Список приглашённых рефералов."""
    referrals: List[ReferralInfo]


class ReferralLeaderboardEntry(BaseModel):
    """Запись в лидерборде рефоводов."""
    rank: int
    user_id: int
    username: Optional[str]
    first_name: Optional[str]
    photo_url: Optional[str]
    score: int  # кол-во подтверждённых рефералов


class ReferralLeaderboardResponse(BaseModel):
    """Ответ лидерборда рефоводов."""
    leaders: List[ReferralLeaderboardEntry]
    my_position: Optional[int]
    my_score: int = 0
    my_in_top: bool = False
    total_participants: int = 0


# ============================================
# SOCIAL - LEADERBOARD
# ============================================

class LeaderboardEntry(BaseModel):
    """Запись в лидерборде."""
    rank: int
    user_id: int
    username: Optional[str]
    first_name: Optional[str]
    photo_url: Optional[str] = None
    score: int


class LeaderboardResponse(BaseModel):
    """Ответ лидерборда."""
    leaders: List[LeaderboardEntry]
    my_position: Optional[int]
    my_score: Optional[int] = None
    my_in_top: bool = False
    total_participants: int = 0


# ============================================
# SOCIAL - CHANNELS
# ============================================

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
# TASKS
# ============================================

TaskStatus = Literal["in_progress", "claimable", "completed", "action_required"]


class TaskTierDto(BaseModel):
    claim_id: str
    target: int
    reward_coins: int
    reward_hints: int = 0
    reward_revives: int = 0
    title: str
    claimed: bool


class ChannelMetaDto(BaseModel):
    channel_id: str
    name: str
    username: Optional[str] = None
    url: Optional[str] = None


class TaskDto(BaseModel):
    id: Literal["arcade_levels", "daily_levels", "friends_confirmed", "official_channel", "partner_channel"]
    kind: Literal["stepped", "single"]
    base_title: str
    base_description: str
    progress: int
    status: TaskStatus
    next_tier_index: Optional[int] = None
    tiers: List[TaskTierDto]
    channel: Optional[ChannelMetaDto] = None


class TasksResponse(BaseModel):
    tasks: List[TaskDto]


class TaskClaimRequest(BaseModel):
    claim_id: str


class TaskClaimResponse(BaseModel):
    success: bool
    claim_id: str
    coins: int
    reward_coins: int
    reward_hints: int = 0
    reward_revives: int = 0
    hint_balance: Optional[int] = None
    revive_balance: Optional[int] = None
    task_id: str
    task_status: TaskStatus
    next_tier_index: Optional[int] = None


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


# ============================================
# ADS
# ============================================

class DailyCoinsStatus(BaseModel):
    """Статус дневных монет за рекламу."""
    used: int
    limit: int
    resets_at: str

class TaskReviveStatus(BaseModel):
    """Статус AdsGram-награды на воскрешение с кулдауном."""
    used: int
    limit: int
    resets_at: str

class AdsStatusResponse(BaseModel):
    """Статус рекламы для пользователя."""
    eligible: bool
    current_level: int
    daily_coins: DailyCoinsStatus
    hint_ad_available: bool
    hint_ad_reward: int
    task_revive: TaskReviveStatus

class ClaimDailyCoinsRequest(BaseModel):
    """Запрос награды за рекламу — дневные монеты."""
    ad_reference: Optional[str] = None

class ClaimDailyCoinsResponse(BaseModel):
    """Ответ награды — дневные монеты."""
    success: bool
    coins: int
    reward_coins: int
    used_today: int
    limit_today: int
    resets_at: str

class ClaimHintRequest(BaseModel):
    """Запрос награды за рекламу — подсказка."""
    ad_reference: Optional[str] = None

class ClaimHintResponse(BaseModel):
    """Ответ награды — подсказка."""
    success: bool
    hint_balance: int

class ClaimReviveRequest(BaseModel):
    """Запрос награды за рекламу — воскрешение."""
    level: int
    session_id: str
    ad_reference: Optional[str] = None

class ClaimReviveResponse(BaseModel):
    """Ответ награды — воскрешение."""
    success: bool
    revive_granted: bool
    session_id: str


RewardPlacement = Literal["reward_daily_coins", "reward_hint", "reward_revive", "reward_spin_retry", "reward_task"]
RewardIntentStatus = Literal["pending", "granted", "rejected", "expired"]


class RewardIntentCreateRequest(BaseModel):
    """Запрос на создание pending reward intent."""
    placement: RewardPlacement
    level: Optional[int] = None
    session_id: Optional[str] = None


class RewardIntentCreateResponse(BaseModel):
    """Ответ создания reward intent."""
    intent_id: str
    placement: RewardPlacement
    status: RewardIntentStatus
    expires_at: str


class RewardIntentStatusResponse(BaseModel):
    """Статус reward intent для polling на фронте."""
    intent_id: str
    placement: RewardPlacement
    status: RewardIntentStatus
    failure_code: Optional[str] = None
    expires_at: Optional[str] = None
    created_at: Optional[str] = None
    level: Optional[int] = None
    session_id: Optional[str] = None
    coins: Optional[int] = None
    hint_balance: Optional[int] = None
    revive_granted: bool = False
    revives_used: Optional[int] = None
    revives_limit: Optional[int] = None
    used_today: Optional[int] = None
    limit_today: Optional[int] = None
    resets_at: Optional[str] = None


class ActiveRewardIntentResponse(RewardIntentStatusResponse):
    """Активный unresolved reward intent для resume и диагностики."""


class ReviveStatusResponse(BaseModel):
    eligible: bool
    level: int
    used: int
    limit: int
    remaining: int


# ============================================
# FRAGMENT DROPS
# ============================================

class FragmentDropClaimDto(BaseModel):
    """Состояние клейма дропа для конкретного пользователя."""
    status: str
    created_at: str
    delivered_at: Optional[str] = None
    failure_reason: Optional[str] = None


FragmentDropStatus = Literal[
    "in_progress", "claimable", "claiming", "delivered",
    "failed", "out_of_stock",
]


class FragmentDropDto(BaseModel):
    """Дроп-кампания с прогрессом пользователя."""
    id: int
    slug: str
    title: str
    description: Optional[str] = None
    emoji: str
    condition_type: str
    condition_target: int
    remaining_stock: int
    total_stock: int
    gift_star_cost: int
    progress: int
    status: FragmentDropStatus
    claim: Optional[FragmentDropClaimDto] = None


class FragmentDropsResponse(BaseModel):
    """Ответ списка дропов."""
    drops: List[FragmentDropDto]


class FragmentClaimResponse(BaseModel):
    """Ответ на запрос клейма подарка."""
    success: bool
    claim_status: str
    message: str
    code: Optional[str] = None


class FragmentClaimStatusResponse(BaseModel):
    """Статус доставки подарка (для поллинга)."""
    claim_status: str
    failure_reason: Optional[str] = None
    attempts: int
    created_at: str
    delivered_at: Optional[str] = None


# ── Admin Fragments ──

class FragmentDropCreateRequest(BaseModel):
    """Создание новой кампании дропа."""
    slug: str = Field(min_length=1, max_length=64, pattern=r'^[a-z0-9_]+$')
    title: Optional[str] = Field(default=None, min_length=1, max_length=256)
    description: Optional[str] = None
    title_translations: Optional[Dict[str, str]] = None
    description_translations: Optional[Dict[str, str]] = None
    emoji: str = Field(default="🎁", max_length=16)
    telegram_gift_id: str
    gift_star_cost: int = Field(gt=0)
    condition_type: Literal["arcade_levels", "friends_confirmed"]
    condition_target: int = Field(gt=0)
    total_stock: int = Field(gt=0)


class FragmentDropUpdateRequest(BaseModel):
    """Обновление кампании."""
    title: Optional[str] = None
    description: Optional[str] = None
    title_translations: Optional[Dict[str, str]] = None
    description_translations: Optional[Dict[str, str]] = None
    emoji: Optional[str] = None
    gift_star_cost: Optional[int] = Field(default=None, gt=0)
    total_stock: Optional[int] = Field(default=None, gt=0)
    is_active: Optional[bool] = None


class AddStockRequest(BaseModel):
    """Добавление стока к существующей кампании."""
    additional_stock: int = Field(gt=0)


class ResolveClaimRequest(BaseModel):
    """Ручной резолв зависшего клейма."""
    action: Literal["mark_delivered", "mark_failed", "retry"]


# ============================================
# ADMIN USERBOT
# ============================================

UserbotGiftOrderStatus = Literal["pending", "processing", "completed", "failed", "activation_required"]
UserbotGiftOperation = Literal["send_gift", "transfer_gift"]


class UserbotOrderDto(BaseModel):
    id: int
    user_id: int
    recipient_telegram_id: int
    operation_type: UserbotGiftOperation
    status: UserbotGiftOrderStatus
    telegram_gift_id: Optional[int] = None
    owned_gift_slug: Optional[str] = None
    star_cost_estimate: Optional[int] = None
    priority: int
    attempts: int
    max_attempts: int
    retry_after: Optional[str] = None
    failure_reason: Optional[str] = None
    source_kind: str
    source_ref: str
    telegram_result_json: Optional[dict] = None
    created_at: Optional[str] = None
    processing_started_at: Optional[str] = None
    completed_at: Optional[str] = None
    failed_at: Optional[str] = None


class UserbotOrdersResponse(BaseModel):
    orders: List[UserbotOrderDto]


class UserbotStatusResponse(BaseModel):
    enabled: bool
    connected: bool
    authorized: bool
    session_path: str
    ledger_balance: int
    observed_balance: Optional[int] = None
    observed_balance_updated_at: Optional[str] = None
    low_balance_paused: bool
    circuit_breaker_active: bool
    circuit_breaker_until: Optional[str] = None
    catalog_count: int
    pending_orders: int
    processing_orders: int
    failed_orders: int
    activation_required_orders: int = 0


class UserbotStarsTopupRequest(BaseModel):
    amount: int = Field(gt=0)
    note: str = Field(default="manual", max_length=256)


class UserbotOrderResolveRequest(BaseModel):
    action: Literal["mark_completed", "mark_failed", "retry"]
    note: Optional[str] = Field(default=None, max_length=256)
    telegram_result_json: Optional[dict] = None
