/**
 * Arrow Puzzle — Skin System Entry Point
 * 
 * Реестр скинов, хелперы, React-хук для доступа к активному скину.
 * 
 * Использование в рендерерах:
 *   import { useActiveSkin } from '../game/skins';
 *   const skin = useActiveSkin();
 *   const strokeWidth = cellSize * skin.geometry.bodyStrokeRatio;
 * 
 * Добавление нового скина:
 *   1. Создать файл src/game/skins/neon.ts (по образцу classic.ts)
 *   2. Импортировать и добавить в SKIN_REGISTRY ниже
 *   3. Готово — скин доступен в магазине и через setSkin()
 */

import type { GameSkin, SkinRegistry } from './types';
import { ClassicSkin } from './classic';
import { useGameStore } from '../../stores/store';

// ============================================
// RE-EXPORTS
// ============================================

export type { GameSkin, ArrowGeometry, SkinColorPalette, AnimationConfig, EffectsConfig, EasingFn } from './types';
export { ClassicSkin } from './classic';

// ============================================
// SKIN REGISTRY
// ============================================

/**
 * Все доступные скины.
 * Для добавления нового: импортируй и добавь сюда.
 */
export const SKIN_REGISTRY: SkinRegistry = {
  classic: ClassicSkin,
  // Будущие скины:
  // neon: NeonSkin,
  // pastel: PastelSkin,
  // retro: RetroSkin,
};

/** Скин по умолчанию */
export const DEFAULT_SKIN_ID = 'classic';

// ============================================
// HELPERS
// ============================================

/** Получить скин по ID. Fallback на classic если не найден. */
export function getSkin(skinId: string): GameSkin {
  return SKIN_REGISTRY[skinId] ?? SKIN_REGISTRY[DEFAULT_SKIN_ID];
}

/** Список всех скинов (для магазина) */
export function getAllSkins(): GameSkin[] {
  return Object.values(SKIN_REGISTRY);
}

/** Список скинов доступных для покупки */
export function getShopSkins(): GameSkin[] {
  return getAllSkins().filter(s => s.price > 0);
}

// ============================================
// REACT HOOK
// ============================================

/**
 * Хук для доступа к активному скину.
 * 
 * Читает activeSkinId из store → возвращает полный объект GameSkin.
 * Мемоизирован через Zustand selector — ре-рендер только при смене скина.
 * 
 * Использование:
 *   const skin = useActiveSkin();
 *   // skin.geometry.bodyStrokeRatio
 *   // skin.colors.outlineColor
 *   // skin.animation.flyEasing(t)
 */
export function useActiveSkin(): GameSkin {
  const skinId = useGameStore(s => s.activeSkinId);
  return getSkin(skinId);
}