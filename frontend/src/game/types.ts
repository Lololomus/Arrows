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
  photo_url?: string | null;
  
  // Прогресс
  currentLevel: number;
  totalStars: number;
  
  // Экономика
  coins: number;
  hintBalance: number;
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
  
  // Метаданные
  preview?: string;
  consumable?: boolean;
  owned?: boolean;
}

/** Каталог магазина */
export interface ShopCatalog {
  arrowSkins: ShopItem[];
  themes: ShopItem[];
  boosts: ShopItem[];
}

export interface PurchaseCoinsResponse {
  success: boolean;
  coins: number;
  hintBalance?: number;
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
}

/** Запрос завершения уровня */
export interface CompleteRequest {
  level: number;
  seed: number;
  moves: string[];
  timeSeconds: number;
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

export type RewardPlacement = 'reward_daily_coins' | 'reward_hint' | 'reward_revive';
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
  coins?: number;
  hintBalance?: number;
  reviveGranted: boolean;
  revivesUsed?: number;
  revivesLimit?: number;
  usedToday?: number;
  limitToday?: number;
  resetsAt?: string;
}

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

/** Слой DAG (для визуализации) */
export interface DagLayer {
  layer: number;
  arrows: Arrow[];
}
