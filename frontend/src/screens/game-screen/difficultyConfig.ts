/**
 * Arrow Puzzle - Difficulty & Defeat Visual Config
 *
 * Source of truth for victory/defeat visuals + lives-per-difficulty.
 *
 * `difficulty` comes from `level.meta.difficulty` and may be:
 * - string from JSON levels: "Легкий" | "Нормальный" | "Сложный" | "Экстремальный"
 * - numeric legacy value from older generated levels
 *
 * Lives are fixed across all difficulty tiers.
 */

import { Trophy, Crown, Medal, Flame, HeartCrack, type LucideIcon } from 'lucide-react';

// ============================================
// TYPES
// ============================================

export type DifficultyTier = 'easy' | 'normal' | 'hard' | 'extreme' | 'impossible';
export type DifficultyValue = number | string | null | undefined;

export interface DifficultyVisualConfig {
  label: string;
  headerColor: string;
  /** Tailwind text color for difficulty badge in HUD pill */
  hudBadgeColor: string;
  /** Tailwind dot/accent color for HUD */
  hudDotColor: string;
  /** Lives granted for this difficulty tier */
  lives: number;
  victoryTitle: string;
  victoryIcon: LucideIcon;
  victoryIconColor: string;
  victoryGlow: string;
  victoryTextGradient: string;
  victoryButton: string;
  badgeStyle: string;
  primary: string;
  secondary: string;
  scale: number;
  bounce: number;
  reward: number;
}

export interface DefeatVisualConfig {
  title: string;
  icon: LucideIcon;
  iconColor: string;
  glow: string;
  textGradient: string;
  button: string;
  primary: string;
  secondary: string;
}

// ============================================
// DIFFICULTY CONFIG
// ============================================

export const DIFFICULTY_CONFIG: Record<DifficultyTier, DifficultyVisualConfig> = {
  easy: {
    label: 'Easy',
    headerColor: 'text-blue-400',
    hudBadgeColor: 'text-blue-400',
    hudDotColor: 'bg-blue-400',
    lives: 3,
    victoryTitle: 'ПРОЙДЕНО',
    victoryIcon: Medal,
    victoryIconColor: 'text-blue-200',
    victoryGlow: 'bg-blue-500',
    victoryTextGradient: 'from-white to-blue-300',
    victoryButton:
      'bg-gradient-to-r from-blue-600 to-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.3)]',
    badgeStyle: 'bg-blue-500/20 border-blue-500/30 text-blue-300',
    primary: '#3b82f6',
    secondary: '#22d3ee',
    scale: 0.9,
    bounce: 0.4,
    reward: 5,
  },
  normal: {
    label: 'Normal',
    headerColor: 'text-yellow-400',
    hudBadgeColor: 'text-yellow-400',
    hudDotColor: 'bg-yellow-400',
    lives: 3,
    victoryTitle: 'ПОБЕДА!',
    victoryIcon: Trophy,
    victoryIconColor: 'text-yellow-400',
    victoryGlow: 'bg-yellow-500',
    victoryTextGradient: 'from-white to-yellow-300',
    victoryButton:
      'bg-gradient-to-r from-yellow-600 to-amber-500 shadow-[0_0_25px_rgba(250,204,21,0.3)]',
    badgeStyle: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-300',
    primary: '#eab308',
    secondary: '#fef08a',
    scale: 1.1,
    bounce: 0.5,
    reward: 10,
  },
  hard: {
    label: 'Hard',
    headerColor: 'text-rose-400',
    hudBadgeColor: 'text-rose-400',
    hudDotColor: 'bg-rose-400',
    lives: 3,
    victoryTitle: 'ПРЕВОСХОДНО!',
    victoryIcon: Crown,
    victoryIconColor: 'text-amber-100',
    victoryGlow: 'bg-rose-500',
    victoryTextGradient: 'from-yellow-100 via-yellow-400 to-rose-400',
    victoryButton:
      'bg-gradient-to-r from-rose-600 to-orange-500 shadow-[0_0_30px_rgba(244,63,94,0.4)]',
    badgeStyle: 'bg-rose-500/20 border-rose-500/30 text-rose-300',
    primary: '#e11d48',
    secondary: '#fbbf24',
    scale: 1.3,
    bounce: 0.7,
    reward: 30,
  },
  extreme: {
    label: 'Extreme',
    headerColor: 'text-purple-400',
    hudBadgeColor: 'text-purple-400',
    hudDotColor: 'bg-purple-400',
    lives: 3,
    victoryTitle: 'ЛЕГЕНДА!',
    victoryIcon: Flame,
    victoryIconColor: 'text-purple-200',
    victoryGlow: 'bg-purple-600',
    victoryTextGradient: 'from-purple-200 via-fuchsia-400 to-orange-400',
    victoryButton:
      'bg-gradient-to-r from-purple-700 to-fuchsia-600 shadow-[0_0_35px_rgba(147,51,234,0.5)]',
    badgeStyle: 'bg-purple-500/20 border-purple-500/30 text-purple-300',
    primary: '#9333ea',
    secondary: '#c084fc',
    scale: 1.4,
    bounce: 0.8,
    reward: 50,
  },
  impossible: {
    label: 'Impossible',
    headerColor: 'text-purple-400',
    hudBadgeColor: 'text-purple-400',
    hudDotColor: 'bg-purple-400',
    lives: 3,
    victoryTitle: 'Р›Р•Р“Р•РќР”Рђ!',
    victoryIcon: Flame,
    victoryIconColor: 'text-purple-200',
    victoryGlow: 'bg-purple-600',
    victoryTextGradient: 'from-purple-200 via-fuchsia-400 to-orange-400',
    victoryButton:
      'bg-gradient-to-r from-purple-700 to-fuchsia-600 shadow-[0_0_35px_rgba(147,51,234,0.5)]',
    badgeStyle: 'bg-purple-500/20 border-purple-500/30 text-purple-300',
    primary: '#9333ea',
    secondary: '#c084fc',
    scale: 1.4,
    bounce: 0.8,
    reward: 100,
  },
};

// ============================================
// DEFEAT CONFIG
// ============================================

export const DEFEAT_CONFIG: DefeatVisualConfig = {
  title: 'ИГРА ОКОНЧЕНА',
  icon: HeartCrack,
  iconColor: 'text-red-400',
  glow: 'bg-red-900',
  textGradient: 'from-red-200 to-red-600',
  button:
    'bg-gradient-to-r from-red-700 to-red-600 shadow-[0_0_20px_rgba(220,38,38,0.3)]',
  primary: '#9f1239',
  secondary: '#4c0519',
};

// ============================================
// HELPERS
// ============================================

function normalizeDifficultyText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

const RU_EASY = '\u043b\u0435\u0433\u043a\u0438\u0439';
const RU_EASY_ALT = '\u043b\u0451\u0433\u043a\u0438\u0439';
const RU_NORMAL = '\u043d\u043e\u0440\u043c\u0430\u043b\u044c\u043d\u044b\u0439';
const RU_HARD = '\u0441\u043b\u043e\u0436\u043d\u044b\u0439';
const RU_EXTREME = '\u044d\u043a\u0441\u0442\u0440\u0435\u043c\u0430\u043b\u044c\u043d\u044b\u0439';
const RU_IMPOSSIBLE = '\u043d\u0435\u0432\u043e\u0437\u043c\u043e\u0436\u043d\u044b\u0439';

/**
 * Maps backend difficulty to UI tier.
 * - Легкий -> easy
 * - Нормальный -> normal
 * - Сложный -> hard
 * - Экстремальный -> extreme
 */
export function getDifficultyTier(difficulty: DifficultyValue): DifficultyTier {
  if (typeof difficulty === 'string') {
    const text = normalizeDifficultyText(difficulty);
    if (text === RU_EASY || text === RU_EASY_ALT || text === 'easy') return 'easy';
    if (text === RU_NORMAL || text === 'normal' || text === 'medium' || text === 'mid') {
      return 'normal';
    }
    if (text === RU_HARD || text === 'hard') return 'hard';
    if (text === RU_EXTREME || text === 'extreme') return 'extreme';
    if (text === RU_IMPOSSIBLE || text === 'impossible') return 'impossible';
  }

  if (typeof difficulty === 'number' && Number.isFinite(difficulty)) {
    if (difficulty <= 3) return 'easy';
    if (difficulty <= 6) return 'normal';
    if (difficulty <= 8) return 'hard';
    if (difficulty <= 10) return 'extreme';
    return 'impossible';
  }

  return 'normal';
}

/** Returns visual config for backend difficulty value */
export function getDifficultyConfig(difficulty: DifficultyValue): DifficultyVisualConfig {
  return DIFFICULTY_CONFIG[getDifficultyTier(difficulty)];
}

/** Returns lives count for difficulty tier */
export function getLivesForDifficulty(difficulty: DifficultyValue): number {
  return getDifficultyConfig(difficulty).lives;
}

/** Formats seconds to MM:SS */
export function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
