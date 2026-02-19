/**
 * Arrow Puzzle - Game Constants
 * 
 * Все игровые константы в одном месте.
 * Изменяйте здесь для балансировки игры.
 */

// ============================================
// GAME MECHANICS
// ============================================

/** Начальное количество жизней */
export const INITIAL_LIVES = 3;

/** Максимальное количество жизней */
export const MAX_LIVES = 5;

/** Количество подсказок на уровень */
export const HINTS_PER_LEVEL = 3;

// ============================================
// ENERGY SYSTEM
// ============================================

/** Максимум энергии */
export const MAX_ENERGY = 5;

/** Время восстановления 1 энергии (секунды) */
export const ENERGY_REGEN_SECONDS = 30 * 60; // 30 минут

// ============================================
// REWARDS
// ============================================

/** Базовые монеты за уровень */
export const BASE_COINS_PER_LEVEL = 10;

/** Множитель монет за звёзды */
export const COINS_STAR_MULTIPLIER = {
  1: 1.0,  // 1 звезда
  2: 1.2,  // 2 звезды
  3: 1.5,  // 3 звезды
};

/** Награда за реферала (пригласившему) */
export const REFERRAL_REWARD_INVITER = 200;

/** Награда за реферала (приглашённому) */
export const REFERRAL_REWARD_INVITEE = 100;

// ============================================
// DIRECTIONS
// ============================================

export type Direction = 'right' | 'left' | 'up' | 'down';

export const DIRECTIONS: Record<Direction, { dx: number; dy: number; angle: number }> = {
  right: { dx: 1, dy: 0, angle: 0 },
  left: { dx: -1, dy: 0, angle: 180 },
  up: { dx: 0, dy: -1, angle: 270 },
  down: { dx: 0, dy: 1, angle: 90 },
};

// ============================================
// ARROW TYPES
// ============================================

export type ArrowType = 'normal' | 'ice' | 'plus_life' | 'minus_life' | 'bomb' | 'electric';

/** Уровни разблокировки спецстрелок */
export const ARROW_TYPE_UNLOCK_LEVELS: Record<ArrowType, number> = {
  normal: 1,
  plus_life: 15,
  ice: 25,
  minus_life: 40,
  bomb: 60,
  electric: 90,
};

/** Эмодзи для типов стрелок */
export const ARROW_EMOJIS: Record<ArrowType, string> = {
  normal: '➡️',
  ice: '🧊',
  plus_life: '❤️',
  minus_life: '💔',
  bomb: '💣',
  electric: '⚡',
};

// ============================================
// ARROW COLORS
// ============================================

export const ARROW_COLORS = [
  '#FF3B30', // Красный
  '#FF9500', // Оранжевый
  '#FFCC00', // Жёлтый
  '#34C759', // Зелёный
  '#007AFF', // Синий
  '#AF52DE', // Фиолетовый
  '#FF2D55', // Розовый
  '#5856D6', // Индиго
  '#00C7BE', // Бирюзовый
];

/** Цвета для специальных стрелок */
export const SPECIAL_ARROW_COLORS: Partial<Record<ArrowType, string>> = {
  ice: '#87CEEB',      // Голубой
  plus_life: '#34C759', // Зелёный
  minus_life: '#FF3B30', // Красный
  bomb: '#1A1A1A',      // Чёрный
  electric: '#FFD700',  // Золотой/жёлтый
};

// ============================================
// SHAPE TYPES
// ============================================

export type ShapeType = 'straight' | 'L' | 'S' | 'U' | 'T' | 'zigzag' | 'blob';

/** Уровни разблокировки форм */
export const SHAPE_UNLOCK_LEVELS: Record<ShapeType, number> = {
  straight: 1,
  L: 8,
  S: 20,
  U: 35,
  T: 50,
  zigzag: 70,
  blob: 150,
};

// ============================================
// GRID SIZE PROGRESSION
// ============================================

/** Размер поля по уровням */
export const getGridSize = (level: number): { width: number; height: number } => {
  let base: number;
  
  if (level <= 5) base = 4;
  else if (level <= 10) base = 4;
  else if (level <= 20) base = 5;
  else if (level <= 35) base = 6;
  else if (level <= 50) base = 7;
  else if (level <= 70) base = 8;
  else if (level <= 100) base = 10;
  else if (level <= 150) base = 12;
  else if (level <= 200) base = 14;
  else if (level <= 300) base = 17;
  else if (level <= 500) base = 22;
  else base = Math.min(250, 22 + Math.floor((level - 500) / 50));
  
  return { width: base, height: base };
};

/** Параметры стрелок по уровням */
export const getArrowParams = (level: number) => {
  const minSize = 2;
  let maxSize: number;
  
  if (level <= 10) maxSize = 4;
  else if (level <= 30) maxSize = 6;
  else if (level <= 70) maxSize = 8;
  else if (level <= 150) maxSize = 12;
  else maxSize = Math.min(30, 12 + Math.floor(level / 50));
  
  return { minSize, maxSize };
};

// ============================================
// UI CONSTANTS
// ============================================

/** Минимальный размер ячейки (px) */
export const MIN_CELL_SIZE = 20;

/** Максимальный размер ячейки (px) */
export const MAX_CELL_SIZE = 60;

/** Геометрия стрелки (доля от размера ячейки) */
export const ARROW_GEOMETRY = {
  bodyThickness: 0.16,
  headWidth: 0.45,
  headLength: 0.35,
  cornerRadius: 0.15,
  dotRadius: 0.08,
};

// ============================================
// ANIMATION DURATIONS (ms)
// ============================================

export const ANIMATIONS = {
  arrowFlyOut: 300,
  arrowError: 400,
  heartBreak: 500,
  victory: 1000,
  defeat: 800,
  bombExplosion: 600,
  iceDefrost: 400,
  electricStrike: 300,
};

// ============================================
// API ENDPOINTS
// ============================================

export const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

export const API_ENDPOINTS = {
  auth: {
    telegram: '/auth/telegram',
    me: '/auth/me',
  },
  game: {
    level: (n: number) => `/game/level/${n}`,
    complete: '/game/complete',
    energy: '/game/energy',
    energyAd: '/game/energy/ad',
    hint: '/game/hint',
    reset: '/game/reset',
  },
  shop: {
    catalog: '/shop/catalog',
    purchaseCoins: '/shop/purchase/coins',
    purchaseStars: '/shop/purchase/stars',
    purchaseTon: '/shop/purchase/ton',
  },
  social: {
    referralCode: '/social/referral/code',
    applyReferral: '/social/referral/apply',
    leaderboard: (type: string) => `/social/leaderboard/${type}`,
    channels: '/social/channels',
    claimChannel: '/social/channels/claim',
  },
};

// ============================================
// ADSGRAM CONFIG
// ============================================

export const ADSGRAM_BLOCK_ID = import.meta.env.VITE_ADSGRAM_BLOCK_ID || '';
