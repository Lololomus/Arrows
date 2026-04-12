/**
 * Arrow Puzzle - Game Types
 * 
 * Все TypeScript типы для игровой логики.
 */

import type { Direction, ArrowType, ShapeType } from '../config/constants';

// ============================================
// BASIC TYPES
// ============================================

/** Клетка на поле */
export interface Cell {
  x: number;
  y: number;
}

/** Сетка поля */
export interface Grid {
  width: number;
  height: number;
  shape?: 'rectangle' | 'L' | 'plus' | 'donut';
  cells?: Cell[]; // Для нестандартных форм
}

// ============================================
// ARROW
// ============================================

/** Стрелка на поле */
export interface Arrow {
  id: string;
  cells: Cell[];           // [0] = голова
  direction: Direction;
  type: ArrowType;
  color: string;
  
  // Состояние (для спецстрелок)
  frozen?: boolean;        // Для ice
}

/** Результат создания стрелки */
export interface ArrowCreationResult {
  success: boolean;
  arrow?: Arrow;
  error?: string;
}

// ============================================
// LEVEL
// ============================================

/** Данные уровня */
export interface Level {
  levelNumber: number;
  seed: number;
  grid: Grid;
  arrows: Arrow[];
  solution?: string[];     // Порядок решения (только для сервера)
  meta: LevelMeta;
}

/** Метаданные уровня */
export interface LevelMeta {
  difficulty: number | string;
  arrowCount: number;
  specialArrowCount: number;
  dagDepth: number;
}

// ============================================
// GAME STATE
// ============================================

export type GameStatus = 'loading' | 'playing' | 'victory' | 'defeat';

/** Состояние игры */
export interface GameState {
  level: number;
  seed: number;
  grid: Grid;
  arrows: Arrow[];
  removedArrows: string[];
  lives: number;
  maxLives: number;
  moves: number;
  status: GameStatus;
  startTime: number;
  
  // История для undo
  history: HistoryEntry[];
  
  // Подсказки
  hintsRemaining: number;
  hintedArrowId: string | null;
}

/** Запись истории для undo */
export interface HistoryEntry {
  arrows: Arrow[];
  lives: number;
  removedArrows: string[];
}

// ============================================
// SIMULATION RESULT
// ============================================

/** Результат симуляции хода */
export interface MoveResult {
  success: boolean;
  collision: boolean;
  collidedWith?: Arrow;
  
  // Для спецстрелок
  bonusLife?: boolean;
  bombExplosion?: Arrow[];
  electricTarget?: Arrow;
  defrosted?: boolean;
}

/** Результат валидации прохождения */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  mistakes: number;
  stars: number;
  coinsEarned: number;
}

// ============================================
// USER
// ============================================

/** Данные пользователя */
export interface User {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  locale: 'ru' | 'en';
  localeManuallySet: boolean;
  photo_url?: string | null;
  
  // Прогресс
  currentLevel: number;
  totalStars: number;
  
  // Экономика
  coins: number;
  hintBalance: number;
  reviveBalance: number;
  extraLives: number;
  energy: number;
  energyUpdatedAt: string;
  
  // Скины
  activeArrowSkin: string;
  activeTheme: string;
  
  // Статус
  isPremium: boolean;
  
  // Рефералы
  referrals_count?: number;
  referrals_pending?: number;

  // TON Wallet
  walletAddress?: string | null;

  // Кейсы
  starsBalance?: number;
  casePityCounter?: number;

  // Онбординг и welcome offer
  onboardingShown: boolean;
  welcomeOfferOpenedAt: string | null;
  welcomeOfferPurchased: boolean;
  isNew?: boolean;
}

/** Статистика пользователя */
export interface UserStats {
  levelsCompleted: number;
  totalMoves: number;
  totalMistakes: number;
  totalHintsUsed: number;
  arcadeBestScore: number;
  currentStreak: number;
  maxStreak: number;
  totalPlaytimeSeconds: number;
}

// ============================================
// SHOP
// ============================================

export type ItemType = 'arrow_skin' | 'theme' | 'boost';
export type Currency = 'coins' | 'stars' | 'ton';

export interface ShopDiscountTier {
  minQuantity: number;
  percent: number;
}

/** Товар в магазине */
export interface ShopItem {
  id: string;
  name: string;
  description?: string;
  itemType: ItemType;

  // Цены (null = недоступно за эту валюту)
  priceCoins: number | null;
  priceStars: number | null;
  priceTon: number | null;
  discountTiers?: ShopDiscountTier[];

  // Метаданные
  preview?: string;
  consumable?: boolean;
  owned?: boolean;
  maxPurchases?: number;
  purchasedCount?: number;
}

/** Каталог магазина */
export interface ShopCatalog {
  arrowSkins: ShopItem[];
  themes: ShopItem[];
  boosts: ShopItem[];
  upgrades: ShopItem[];
}

export interface PurchaseCoinsResponse {
  success: boolean;
  coins: number;
  hintBalance?: number;
  reviveBalance?: number;
  error?: string;
}

// ============================================
// SOCIAL
// ============================================

/** Позиция в лидерборде */
export interface LeaderboardEntry {
  rank: number;
  userId: number;
  username: string | null;
  firstName: string | null;
  score: number;
  avatarUrl?: string;
  photoUrl?: string | null;
}

/** Ответ лидерборда */
export interface LeaderboardResponse {
  leaders: LeaderboardEntry[];
  myPosition: number | null;
  myScore: number | null;
  myInTop: boolean;
  totalParticipants: number;
}

/** Канал для подписки */
export interface RewardChannel {
  id: string;
  name: string;
  rewardCoins: number;
  claimed: boolean;
}

export type TaskStatus = 'in_progress' | 'claimable' | 'completed' | 'action_required';

export interface TaskTier {
  claimId: string;
  target: number;
  rewardCoins: number;
  rewardHints: number;
  rewardRevives: number;
  title: string;
  claimed: boolean;
}

export interface TaskChannelMeta {
  channelId: string;
  name: string;
  username?: string | null;
  url?: string | null;
}

export interface TaskDto {
  id: 'arcade_levels' | 'daily_levels' | 'friends_confirmed' | 'official_channel' | 'partner_channel' | 'partner_zarub' | 'partner_vpn_ru';
  kind: 'stepped' | 'single' | 'link';
  baseTitle: string;
  baseDescription: string;
  progress: number;
  status: TaskStatus;
  nextTierIndex: number | null;
  tiers: TaskTier[];
  channel?: TaskChannelMeta;
  linkUrl?: string | null;
}

export interface TasksResponse {
  tasks: TaskDto[];
}

export interface TaskClaimResponse {
  success: boolean;
  claimId: string;
  coins: number;
  rewardCoins: number;
  rewardHints: number;
  rewardRevives: number;
  hintBalance?: number;
  reviveBalance?: number;
  taskId: string;
  taskStatus: TaskStatus;
  nextTierIndex: number | null;
}

/** Ответ применения реферала */
export interface ReferralApplyResponse {
  success: boolean;
  bonus: number;
  reason?: 'already_referred' | 'self_referral' | 'invalid_code' | 'account_too_old';
}

/** Статистика рефералов */
export interface ReferralStatsResponse {
  referrals_count: number;
  referrals_pending: number;
  total_earned: number;
  referral_code: string | null;
  referral_link: string | null;
  referral_confirm_level: number;
}

/** Реферал в списке приглашённых */
export interface ReferralInfo {
  id: number;
  username: string | null;
  first_name: string | null;
  photo_url: string | null;
  current_level: number;
  status: 'pending' | 'confirmed';
  confirmed_at: string | null;
  created_at: string;
}

/** Список рефералов */
export interface ReferralListResponse {
  referrals: ReferralInfo[];
}

/** Запись лидерборда рефоводов */
export interface ReferralLeaderboardEntry {
  rank: number;
  user_id: number;
  username: string | null;
  first_name: string | null;
  photo_url: string | null;
  score: number;
}

/** Ответ лидерборда рефоводов */
export interface ReferralLeaderboardResponse {
  leaders: ReferralLeaderboardEntry[];
  my_position: number | null;
  my_score: number;
  my_in_top: boolean;
  total_participants: number;
}

// ============================================
// API RESPONSES
// ============================================

/** Ответ авторизации */
export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: User;
}

/** Ответ получения уровня */
export interface LevelResponse {
  level: number;
  seed: number;
  grid: Grid;
  arrows: Arrow[];
  meta: LevelMeta;
  daily_day_number?: number;
  daily_date?: string;
}

/** Запрос завершения уровня */
export interface CompleteRequest {
  level: number;
  seed: number;
  moves: string[];
  timeSeconds: number;
  isDaily?: boolean;
}

/** Ответ завершения уровня */
export interface CompleteResponse {
  valid: boolean;
  stars: number;
  coinsEarned: number;
  totalCoins?: number;
  currentLevel: number;
  newLevelUnlocked: boolean;
  alreadyCompleted: boolean;
  error?: string;
  /** true если на этом уровне подтвердился реферал (invitee достиг уровня подтверждения) */
  referralConfirmed?: boolean;
}

export interface CompleteAndNextResponse {
  completion: CompleteResponse;
  nextLevel: LevelResponse | null;
  nextLevelExists: boolean;
}

/** Ответ энергии */
export interface EnergyResponse {
  energy: number;
  maxEnergy: number;
  secondsToNext: number;
}

/** Ответ подсказки */
export interface HintResponse {
  arrowId: string;
  hintBalance: number;
}

// ============================================
// ADS
// ============================================

export interface DailyCoinsStatus {
  used: number;
  limit: number;
  resetsAt: string;
}

export interface AdsStatusResponse {
  eligible: boolean;
  currentLevel: number;
  dailyCoins: DailyCoinsStatus;
  hintAdAvailable: boolean;
  hintAdReward: number;
  taskRevive: DailyCoinsStatus;
}

export interface ClaimDailyCoinsResponse {
  success: boolean;
  coins: number;
  rewardCoins: number;
  usedToday: number;
  limitToday: number;
  resetsAt: string;
}

export interface ClaimHintResponse {
  success: boolean;
  hintBalance: number;
}

export interface ClaimReviveResponse {
  success: boolean;
  reviveGranted: boolean;
  sessionId: string;
}

export type RewardPlacement = 'reward_daily_coins' | 'reward_hint' | 'reward_revive' | 'reward_spin_retry' | 'reward_task';
export type RewardIntentStatus = 'pending' | 'granted' | 'rejected' | 'expired';

export interface RewardIntentCreateRequest {
  placement: RewardPlacement;
  level?: number;
  sessionId?: string;
}

export interface RewardIntentCreateResponse {
  intentId: string;
  placement: RewardPlacement;
  status: RewardIntentStatus;
  expiresAt: string;
}

export interface RewardIntentStatusResponse {
  intentId: string;
  placement: RewardPlacement;
  status: RewardIntentStatus;
  failureCode?: string;
  expiresAt?: string;
  createdAt?: string;
  level?: number;
  sessionId?: string;
  coins?: number;
  hintBalance?: number;
  reviveGranted: boolean;
  revivesUsed?: number;
  revivesLimit?: number;
  usedToday?: number;
  limitToday?: number;
  resetsAt?: string;
}

export interface ActiveRewardIntentResponse extends RewardIntentStatusResponse {}

export interface ReviveStatusResponse {
  eligible: boolean;
  level: number;
  used: number;
  limit: number;
  remaining: number;
}

// ============================================
// DEPENDENCY GRAPH
// ============================================

/** Граф зависимостей */
export interface DependencyGraph {
  nodes: Map<string, Arrow>;
  edges: Map<string, string[]>;  // arrowId -> [blockedByIds]
  reverseEdges: Map<string, string[]>;  // arrowId -> [blocksIds]
}

// ============================================
// FRAGMENTS / DROPS
// ============================================

export type FragmentStatus = 'claimable' | 'in_progress' | 'claiming' | 'completed' | 'failed' | 'sold_out';

export interface FragmentDrop {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  description: string;
  status: FragmentStatus;
  totalStock: number;
  remainingStock: number;
  progressCurrent?: number;
  progressTarget?: number;
}

/** Слой DAG (для визуализации) */
export interface DagLayer {
  layer: number;
  arrows: Arrow[];
}

// ============================================
// CASES
// ============================================

export type CaseRarity = 'common' | 'rare' | 'epic' | 'epic_stars';

export interface CaseRewardItem {
  type: 'hints' | 'revives' | 'coins' | 'stars';
  amount: number;
}

export interface CaseInfo {
  id: string;
  name: string;
  priceStars: number;
  priceTon: number;
  pityCounter: number;
  pityThreshold: number;
}

export interface CaseOpenResult {
  rarity: CaseRarity;
  rewards: CaseRewardItem[];
  hintBalance: number;
  reviveBalance: number;
  coins: number;
  starsBalance: number;
  casePityCounter: number;
}

export interface WithdrawalRequest {
  id: number;
  amount: number;
  status: 'pending' | 'completed' | 'rejected';
  createdAt: string;
}
