/**
 * Arrow Puzzle — FX Event Bridge (OPTIMIZED)
 *
 * Изменения:
 * 1. camScale сохраняется в FlyFXItem — FXOverlay использует для адаптивного эффекта
 * 2. screenCellSize сохраняется — для выбора типа эффекта (fly/shrink/pop)
 */

import type { Arrow } from '../game/types';
import type { GameSkin } from '../game/skins';

// ============================================
// TYPES
// ============================================

export interface FlyFXItem {
  arrow: Arrow;
  startTime: number;
  duration: number;
  flyDistanceWorld: number;
  minStrokeWorld: number;
  isLOD: boolean;
  /** ⚡ Масштаб камеры в момент клика — для адаптивного эффекта */
  camScale: number;
  /** ⚡ Размер ячейки на экране в момент клика */
  screenCellSize: number;
}

// ============================================
// CONSTANTS
// ============================================

const LOD_THRESHOLD = 12;
const MIN_FLY_SCREEN_PX = 100;
const MAX_FLY_SCREEN_PX = 350;
const MIN_STROKE_SCREEN_PX = 2.0;
const CULL_CELL_SCREEN_PX = 0.5;
const MIN_CAM_SCALE = 0.005;

// ============================================
// HELPERS
// ============================================

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function computeFlyDuration(baseDuration: number, cellSize: number, camScale: number): number {
  const screenCell = cellSize * camScale;
  if (screenCell >= 15) return baseDuration;
  return baseDuration * clamp(screenCell / 15, 0.7, 1.0);
}

// ============================================
// QUEUE
// ============================================

const _queue: FlyFXItem[] = [];

export function emitFlyFX(
  removedArrows: Arrow[],
  cellSize: number,
  camScale: number,
  skin: GameSkin,
): void {
  const scale = Math.max(camScale, MIN_CAM_SCALE);
  const screenCellSize = cellSize * scale;

  // Субпиксельная карта — не создаём анимации
  if (screenCellSize < CULL_CELL_SCREEN_PX) return;

  const invScale = 1 / scale;
  const isLOD = screenCellSize < LOD_THRESHOLD;
  const now = performance.now();

  const rawWorldDist = cellSize * skin.animation.flyDistanceMultiplier;
  const rawScreenDist = rawWorldDist * scale;
  const clampedScreenDist = clamp(rawScreenDist, MIN_FLY_SCREEN_PX, MAX_FLY_SCREEN_PX);
  const flyDistWorld = clampedScreenDist * invScale;

  const duration = computeFlyDuration(skin.animation.flyDuration, cellSize, scale);
  const minStrokeWorld = MIN_STROKE_SCREEN_PX * invScale;

  for (const arrow of removedArrows) {
    _queue.push({
      arrow,
      startTime: now,
      duration,
      flyDistanceWorld: flyDistWorld,
      minStrokeWorld,
      isLOD,
      camScale: scale,
      screenCellSize,
    });
  }
}

export function drainFlyFX(): FlyFXItem[] {
  if (_queue.length === 0) return _queue;
  return _queue.splice(0);
}

export function cancelFlyFX(arrowIds: Set<string>): void {
  for (let i = _queue.length - 1; i >= 0; i--) {
    if (arrowIds.has(_queue[i].arrow.id)) {
      _queue.splice(i, 1);
    }
  }
}

export function clearFlyFX(): void {
  _queue.length = 0;
}

export function hasPendingFX(): boolean {
  return _queue.length > 0;
}