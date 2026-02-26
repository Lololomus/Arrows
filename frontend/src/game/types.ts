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
  energy: number;
  energyUpdatedAt: string;
  
  // Скины
  activeArrowSkin: string;
  activeTheme: string;
  
  // Статус
  isPremium: boolean;
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
}

/** Ответ лидерборда */
export interface LeaderboardResponse {
  leaders: LeaderboardEntry[];
  myPosition: number | null;
  myScore: number | null;
}

/** Канал для подписки */
export interface RewardChannel {
  id: string;
  name: string;
  rewardCoins: number;
  claimed: boolean;
}

// ============================================
// API RESPONSES
// ============================================

/** Ответ авторизации */
export interface AuthResponse {
  token: string;
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
  newLevelUnlocked: boolean;
  error?: string;
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
