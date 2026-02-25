/**
 * Arrow Puzzle — FX Event Bridge (SYNCHRONOUS)
 *
 * Синхронный канал между GameScreen (продюсер) и FXOverlay (консьюмер).
 *
 * ЗАЧЕМ:
 * Раньше FXOverlay ловил удалённые стрелки через useEffect + history diff.
 * useEffect выполняется ПОСЛЕ paint → 2-10 кадров задержки на мобиле.
 * Стрелка "просто исчезала" без анимации.
 *
 * Теперь: handleArrowClick() → emitFlyFX() → queue пополняется синхронно.
 * FXOverlay render loop (rAF) → drainFlyFX() → анимация в ЭТОМ ЖЕ кадре.
 * Zero delay. Стрелка бесшовно переходит из CanvasBoard в FXOverlay.
 *
 * АРХИТЕКТУРА:
 * - Модуль без React-зависимостей (чистый TS)
 * - Глобальный синглтон (как globalIndex в spatialIndex.ts)
 * - Продюсер: GameScreen.handleArrowClick() вызывает emitFlyFX()
 * - Консьюмер: FXOverlay render() вызывает drainFlyFX()
 * - Undo: GameScreen вызывает cancelFlyFX(arrowId) при undo
 */

import type { Arrow } from '../game/types';
import type { GameSkin } from '../game/skins';

// ============================================
// TYPES
// ============================================

export interface FlyFXItem {
  arrow: Arrow;
  startTime: number;        // performance.now() в момент КЛИКА
  duration: number;          // Залочена при создании
  flyDistanceWorld: number;  // Залочена при создании
  minStrokeWorld: number;    // Залочена при создании
  isLOD: boolean;            // Залочена при создании
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

/**
 * Вызывается из GameScreen.handleArrowClick() СИНХРОННО.
 *
 * Принимает массив удалённых стрелок + текущие параметры камеры/скина.
 * Создаёт FlyFXItem'ы и складывает в очередь.
 * startTime = now (момент клика, не момент useEffect).
 */
export function emitFlyFX(
  removedArrows: Arrow[],
  cellSize: number,
  camScale: number,
  skin: GameSkin,
): void {
  const scale = Math.max(camScale, MIN_CAM_SCALE);
  const screenCellSize = cellSize * scale;

  // Вся карта субпиксельная — не создаём анимации
  if (screenCellSize < CULL_CELL_SCREEN_PX) return;

  const invScale = 1 / scale;
  const isLOD = screenCellSize < LOD_THRESHOLD;
  const now = performance.now();

  // Fly distance: оригинальная формула clamped в screen-space
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
    });
  }
}

/**
 * Вызывается из FXOverlay render loop (rAF).
 * Забирает все накопленные элементы из очереди.
 * Возвращает пустой массив если очереди нет.
 */
export function drainFlyFX(): FlyFXItem[] {
  if (_queue.length === 0) return _queue; // fast path: вернуть тот же пустой массив
  return _queue.splice(0);
}

/**
 * Вызывается при undo — убирает стрелки из очереди (если ещё не забраны).
 */
export function cancelFlyFX(arrowIds: Set<string>): void {
  for (let i = _queue.length - 1; i >= 0; i--) {
    if (arrowIds.has(_queue[i].arrow.id)) {
      _queue.splice(i, 1);
    }
  }
}

/**
 * Полный сброс (при смене уровня).
 */
export function clearFlyFX(): void {
  _queue.length = 0;
}

/**
 * Есть ли что-то в очереди? (Для wake-up FXOverlay render loop)
 */
export function hasPendingFX(): boolean {
  return _queue.length > 0;
}