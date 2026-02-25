// ===== 📄 ФАЙЛ: src/components/FXOverlay.tsx =====
/**
 * Arrow Puzzle - Screen-Space FX Canvas (v3 — ALL EDGE CASES)
 *
 * v3 fixes:
 * - minStrokeWorld: убран world-space cap (cellSize * 0.6), который делал штрих
 *   субпиксельным на extreme zoom-out. Теперь = MIN_STROKE_SCREEN_PX / camScale
 *   без ограничения сверху → гарантия видимости на любом масштабе.
 * - Cull: порог изменён с `screenCellSize * cells.length < 2` на
 *   `screenCellSize < 0.5` — одна ячейка < 0.5px действительно невидима.
 * - active transition: при active=false→true синхронизируем pointer без захвата,
 *   предотвращая burst старых FX.
 * - captureScale: убран (не использовался).
 *
 * v2 (сохранено):
 * - Lock-at-capture: flyDistance, minStroke, LOD, duration фиксируются в момент
 *   удаления → зум во время полёта не вызывает рывков.
 * - Clamped fly distance: оригинальная формула cellSize × multiplier, screen-
 *   результат зажат в [100, 350]px.
 * - LOD: треугольник вместо шеврона на мелком масштабе (как CanvasBoard).
 * - History pointer: обрабатывает ВСЕ новые diff'ы.
 * - Undo cleanup: летящие стрелки, вернувшиеся на доску, удаляются.
 * - Camera transform вынесен из цикла.
 * - Zero-alloc + ResizeObserver rect cache.
 */

import { useEffect, useRef } from 'react';
import { MotionValue } from 'framer-motion';
import { useGameStore } from '../stores/store';
import { useActiveSkin, type GameSkin } from '../game/skins';
import { DIRECTIONS, ARROW_EMOJIS } from '../config/constants';
import type { Arrow } from '../game/types';

// ============================================
// CONSTANTS
// ============================================

/** Padding ячеек (должен совпадать с CanvasBoard) */
const GRID_PADDING_CELLS = 0.4;

/** LOD порог (совпадает с CanvasBoard LOD_THRESHOLD) */
const LOD_THRESHOLD = 12;

/**
 * Экранные границы fly-дистанции (px).
 *
 * Оригинальная формула (cellSize × flyDistanceMultiplier) сохраняется,
 * но screen-результат зажимается в [MIN, MAX]:
 * - Маленький уровень (camScale≈1): 400px → clamp → 350px. Почти без изменений.
 * - Средний (camScale≈0.3): 120px → 120px. Идентично оригиналу.
 * - Большой (camScale≈0.03): 12px → 100px. Фикс видимости.
 */
const MIN_FLY_SCREEN_PX = 100;
const MAX_FLY_SCREEN_PX = 350;

/**
 * Минимальная толщина штриха на экране (px).
 *
 * Конвертируется в world-space: minStrokeWorld = MIN_STROKE_SCREEN_PX / camScale.
 * БЕЗ world-space cap — на extreme zoom-out штрих будет толстым в мировых единицах,
 * но нормальным (2px) на экране. В LOD-режиме это выглядит естественно.
 */
const MIN_STROKE_SCREEN_PX = 2.0;

/**
 * Cull порог (px размер одной ячейки на экране).
 * Если одна ячейка < 0.5px, анимация по-настоящему невидима.
 */
const CULL_CELL_SCREEN_PX = 0.5;

/** Минимальный camScale для расчётов (защита от деления на 0). */
const MIN_CAM_SCALE = 0.005;

// ============================================
// TYPES
// ============================================

interface CapturedArrow {
  arrow: Arrow;
  startTime: number;
  duration: number;
  progress: number;

  // Locked at capture — не пересчитываются при зуме
  flyDistanceWorld: number;
  minStrokeWorld: number;
  isLOD: boolean;
}

interface CachedRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FXOverlayProps {
  containerRef: React.RefObject<HTMLDivElement>;
  gridSize: { width: number; height: number };
  cellSize: number;
  springX: MotionValue<number>;
  springY: MotionValue<number>;
  springScale: MotionValue<number>;
  active: boolean;
}

// ============================================
// STATIC POINT BUFFER (zero-alloc drawing)
// ============================================

const _fxPtBuf: { x: number; y: number }[] = [];
function ensureFxPtBuf(len: number) {
  while (_fxPtBuf.length < len) _fxPtBuf.push({ x: 0, y: 0 });
}

// ============================================
// HELPERS
// ============================================

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Адаптивная длительность полёта.
 *
 * На нормальных масштабах = baseDuration (400ms) без изменений.
 * Укорачивается только при очень мелких стрелках (screenCell < 15px),
 * и не более чем на 30% (floor = 0.7).
 *
 * screenCell=40+ → 1.0 → 400ms (оригинал)
 * screenCell=15  → 1.0 → 400ms (оригинал)
 * screenCell=8   → 0.85 → 340ms
 * screenCell=3   → 0.7  → 280ms (минимум)
 */
function computeFlyDuration(baseDuration: number, cellSize: number, camScale: number): number {
  const screenCell = cellSize * camScale;
  if (screenCell >= 15) return baseDuration;
  const factor = clamp(screenCell / 15, 0.7, 1.0);
  return baseDuration * factor;
}

// ============================================
// COMPONENT
// ============================================

export function FXOverlay({ containerRef, gridSize, cellSize, springX, springY, springScale, active }: FXOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const wakeUpRef = useRef<() => void>(() => {});

  const arrows = useGameStore(s => s.arrows);
  const skin = useActiveSkin();

  const flyingArrowsRef = useRef<CapturedArrow[]>([]);

  // History pointer — обрабатываем ВСЕ новые записи, не только последнюю
  const prevHistoryLenRef = useRef<number>(0);

  // Детекция active=false→true перехода (предотвращает burst старых FX)
  const wasActiveRef = useRef<boolean>(false);

  // Cached container rect (ResizeObserver + scroll)
  const cachedRectRef = useRef<CachedRect>({ left: 0, top: 0, width: 0, height: 0 });

  // ============================================
  // RECT CACHE (ResizeObserver + scroll)
  // ============================================

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateRect = () => {
      const r = el.getBoundingClientRect();
      cachedRectRef.current = { left: r.left, top: r.top, width: r.width, height: r.height };
    };
    updateRect();

    const ro = new ResizeObserver(updateRect);
    ro.observe(el);
    window.addEventListener('scroll', updateRect, { passive: true });
    window.addEventListener('resize', updateRect, { passive: true });

    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', updateRect);
      window.removeEventListener('resize', updateRect);
    };
  }, [containerRef]);

  // ============================================
  // CAPTURE REMOVED ARROWS (history pointer)
  // ============================================

  useEffect(() => {
    // --- active=false: запоминаем состояние, ничего не делаем ---
    if (!active) {
      wasActiveRef.current = false;
      return;
    }

    const state = useGameStore.getState();
    const history = state.history;
    const currentIds = new Set(arrows.map(a => a.id));
    const flying = flyingArrowsRef.current;

    // --- active=false → true: синхронизируем pointer БЕЗ захвата ---
    // Предотвращает burst старых FX, накопившихся пока overlay был неактивен.
    if (!wasActiveRef.current) {
      wasActiveRef.current = true;
      prevHistoryLenRef.current = history.length;
      flyingArrowsRef.current = [];
      return;
    }

    const prevLen = prevHistoryLenRef.current;

    // --- Undo cleanup ---
    // Стрелка вернулась на доску → убрать из летящих
    if (flying.length > 0) {
      for (let i = flying.length - 1; i >= 0; i--) {
        if (currentIds.has(flying[i].arrow.id)) {
          flying.splice(i, 1);
        }
      }
    }

    // --- Undo detection: history стала короче ---
    if (history.length < prevLen) {
      prevHistoryLenRef.current = history.length;
      return;
    }

    // --- Нет новых записей ---
    if (history.length === prevLen) {
      return;
    }

    // --- Текущий camScale для lock-at-capture ---
    const camScale = Math.max(springScale.get(), MIN_CAM_SCALE);
    const screenCellSize = cellSize * camScale;
    const isLOD = screenCellSize < LOD_THRESHOLD;
    const invScale = 1 / camScale;

    // --- Обработать ВСЕ новые diff'ы ---
    for (let i = prevLen; i < history.length; i++) {
      const diff = history[i];
      if (!diff || diff.removedArrows.length === 0) continue;

      for (const removedArrow of diff.removedArrows) {
        // Cull: ячейка < 0.5px на экране — анимация невидима
        if (screenCellSize < CULL_CELL_SCREEN_PX) continue;

        // Fly distance: оригинальная формула, clamped в screen-space
        const rawWorldDist = cellSize * skin.animation.flyDistanceMultiplier;
        const rawScreenDist = rawWorldDist * camScale;
        const clampedScreenDist = clamp(rawScreenDist, MIN_FLY_SCREEN_PX, MAX_FLY_SCREEN_PX);
        const flyDistWorld = clampedScreenDist * invScale;

        // Min stroke: чистая screen-space гарантия, без world-space cap.
        // На extreme zoom-out штрих толстый в world-units, но 2px на экране.
        const minStrokeWorld = MIN_STROKE_SCREEN_PX * invScale;

        flying.push({
          arrow: removedArrow,
          startTime: performance.now(),
          duration: computeFlyDuration(skin.animation.flyDuration, cellSize, camScale),
          progress: 0,
          flyDistanceWorld: flyDistWorld,
          minStrokeWorld,
          isLOD,
        });
      }
    }

    prevHistoryLenRef.current = history.length;

    // Wake up render loop if sleeping
    if (flying.length > 0 && animFrameRef.current === 0) {
      wakeUpRef.current();
    }
  }, [arrows, active, skin.animation.flyDuration, skin.animation.flyDistanceMultiplier, cellSize, springScale]);

  // ============================================
  // RENDER LOOP
  // ============================================

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resizeCanvas = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Board dimensions in world coords (matches CanvasBoard)
    const totalBoardW = (gridSize.width + GRID_PADDING_CELLS) * cellSize;
    const totalBoardH = (gridSize.height + GRID_PADDING_CELLS) * cellSize;
    const boardPadding = cellSize * (GRID_PADDING_CELLS / 2);

    function render(now: number) {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const flying = flyingArrowsRef.current;
      if (flying.length === 0) {
        animFrameRef.current = 0;
        return;
      }

      // Cached rect — без getBoundingClientRect per-frame
      const rect = cachedRectRef.current;
      if (rect.width === 0) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // Live camera from springs
      const camX = springX.get();
      const camY = springY.get();
      const camScale = springScale.get();

      // Screen center of container
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      ctx.save();
      ctx.scale(dpr, dpr);

      // Camera transform — once, not per arrow
      ctx.save();
      ctx.translate(cx + camX, cy + camY);
      ctx.scale(camScale, camScale);
      ctx.translate(-totalBoardW / 2 + boardPadding, -totalBoardH / 2 + boardPadding);

      for (let i = flying.length - 1; i >= 0; i--) {
        const fa = flying[i];
        fa.progress = Math.min(1, (now - fa.startTime) / fa.duration);

        if (fa.progress >= 1) {
          flying.splice(i, 1);
          continue;
        }

        drawFlyingArrow(ctx, fa, cellSize, skin);
      }

      ctx.restore(); // camera
      ctx.restore(); // dpr

      animFrameRef.current = requestAnimationFrame(render);
    }

    animFrameRef.current = requestAnimationFrame(render);

    wakeUpRef.current = () => {
      if (animFrameRef.current === 0) {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      wakeUpRef.current = () => {};
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [active, cellSize, gridSize.width, gridSize.height, skin, springScale, springX, springY, containerRef]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none z-50"
    />
  );
}

// ============================================
// DRAWING: Flying Arrow (dispatcher)
// ============================================

function drawFlyingArrow(
  ctx: CanvasRenderingContext2D,
  fa: CapturedArrow,
  cellSize: number,
  skin: GameSkin,
) {
  const { arrow, progress, isLOD } = fa;
  const easedProgress = skin.animation.flyEasing(progress);

  // Locked values — не зависят от текущего camScale
  const flyDistance = fa.flyDistanceWorld * easedProgress;
  const opacity = 1 - easedProgress;

  ctx.save();
  ctx.globalAlpha = clamp(opacity, 0, 1);

  if (isLOD) {
    drawArrowLOD(ctx, arrow, cellSize, flyDistance, fa.minStrokeWorld, skin);
  } else {
    drawArrowFull(ctx, arrow, cellSize, flyDistance, fa.minStrokeWorld, skin);
  }

  ctx.restore();
}

// ============================================
// DRAWING: Full Detail (chevron head)
// ============================================

function drawArrowFull(
  ctx: CanvasRenderingContext2D,
  arrow: Arrow,
  cellSize: number,
  flyDistance: number,
  minStrokeWorld: number,
  skin: GameSkin,
) {
  const dir = DIRECTIONS[arrow.direction];
  const half = cellSize / 2;
  const headGap = cellSize * skin.geometry.headGapRatio;

  // Stroke widths with minimum enforcement (guarantees screen visibility)
  const rawBodyStroke = cellSize * skin.geometry.bodyStrokeRatio;
  const rawMonolith = rawBodyStroke + cellSize * skin.geometry.outlineExtraRatio;
  const strokeWidth = Math.max(rawBodyStroke, minStrokeWorld);
  const monolithStrokeWidth = Math.max(rawMonolith, minStrokeWorld);

  const cells = arrow.cells;
  const len = cells.length;

  // Zero-alloc: fill static buffer reversed (tail→head)
  ensureFxPtBuf(len);
  for (let i = 0; i < len; i++) {
    const c = cells[len - 1 - i];
    _fxPtBuf[i].x = c.x * cellSize + half;
    _fxPtBuf[i].y = c.y * cellSize + half;
  }

  if (len > 1) {
    _fxPtBuf[len - 1].x -= dir.dx * headGap;
    _fxPtBuf[len - 1].y -= dir.dy * headGap;
  }

  const geometricLength = Math.max(0, (len - 1) * cellSize - headGap);

  // Body path
  if (len >= 2) {
    ctx.beginPath();
    ctx.moveTo(_fxPtBuf[0].x, _fxPtBuf[0].y);
    for (let i = 1; i < len; i++) ctx.lineTo(_fxPtBuf[i].x, _fxPtBuf[i].y);
    // Extend far in fly direction for lineDash trick
    ctx.lineTo(
      _fxPtBuf[len - 1].x + dir.dx * cellSize * 15,
      _fxPtBuf[len - 1].y + dir.dy * cellSize * 15,
    );

    ctx.setLineDash([geometricLength, 20000]);
    ctx.lineDashOffset = -flyDistance;
    ctx.strokeStyle = arrow.color;
    ctx.lineWidth = monolithStrokeWidth;
    ctx.lineCap = skin.geometry.lineCap;
    ctx.lineJoin = skin.geometry.lineJoin;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Chevron head
  const head = cells[0];
  const headX = head.x * cellSize + half + dir.dx * flyDistance;
  const headY = head.y * cellSize + half + dir.dy * flyDistance;

  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(dir.angle * (Math.PI / 180));

  ctx.beginPath();
  ctx.moveTo(-cellSize * skin.geometry.chevronLengthRatio, -cellSize * skin.geometry.chevronSpreadRatio);
  ctx.lineTo(0, 0);
  ctx.lineTo(-cellSize * skin.geometry.chevronLengthRatio, cellSize * skin.geometry.chevronSpreadRatio);
  ctx.strokeStyle = arrow.color;
  ctx.lineWidth = Math.max(strokeWidth * skin.geometry.chevronStrokeMultiplier, minStrokeWorld);
  ctx.lineCap = skin.geometry.lineCap;
  ctx.lineJoin = skin.geometry.lineJoin;
  ctx.stroke();
  ctx.restore();

  // Special arrow emoji
  if (arrow.type !== 'normal') {
    ctx.font = `${cellSize * 0.5}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ARROW_EMOJIS[arrow.type], headX, headY);
  }
}

// ============================================
// DRAWING: LOD (filled triangle head)
// Matches CanvasBoard LOD style exactly.
// ============================================

function drawArrowLOD(
  ctx: CanvasRenderingContext2D,
  arrow: Arrow,
  cellSize: number,
  flyDistance: number,
  minStrokeWorld: number,
  skin: GameSkin,
) {
  const dir = DIRECTIONS[arrow.direction];
  const half = cellSize / 2;
  const headGap = cellSize * skin.geometry.headGapRatio;

  const rawMonolith = cellSize * skin.geometry.bodyStrokeRatio + cellSize * skin.geometry.outlineExtraRatio;
  const monolithStrokeWidth = Math.max(rawMonolith, minStrokeWorld);

  const cells = arrow.cells;
  const len = cells.length;

  // Zero-alloc: fill static buffer reversed (tail→head)
  ensureFxPtBuf(len);
  for (let i = 0; i < len; i++) {
    const c = cells[len - 1 - i];
    _fxPtBuf[i].x = c.x * cellSize + half;
    _fxPtBuf[i].y = c.y * cellSize + half;
  }

  if (len > 1) {
    _fxPtBuf[len - 1].x -= dir.dx * headGap;
    _fxPtBuf[len - 1].y -= dir.dy * headGap;
  }

  const geometricLength = Math.max(0, (len - 1) * cellSize - headGap);

  // Body (single stroke, no outline — LOD simplification)
  if (len >= 2) {
    ctx.beginPath();
    ctx.moveTo(_fxPtBuf[0].x, _fxPtBuf[0].y);
    for (let i = 1; i < len; i++) ctx.lineTo(_fxPtBuf[i].x, _fxPtBuf[i].y);
    ctx.lineTo(
      _fxPtBuf[len - 1].x + dir.dx * cellSize * 15,
      _fxPtBuf[len - 1].y + dir.dy * cellSize * 15,
    );

    ctx.setLineDash([geometricLength, 20000]);
    ctx.lineDashOffset = -flyDistance;
    ctx.strokeStyle = arrow.color;
    ctx.lineWidth = monolithStrokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Filled triangle head (matches CanvasBoard LOD exactly)
  const head = cells[0];
  const hx = head.x * cellSize + half + dir.dx * flyDistance;
  const hy = head.y * cellSize + half + dir.dy * flyDistance;
  const sz = cellSize * 0.7;

  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(dir.angle * (Math.PI / 180));
  ctx.beginPath();
  ctx.moveTo(sz * 0.4, 0);
  ctx.lineTo(-sz * 0.4, -sz * 0.4);
  ctx.lineTo(-sz * 0.4, sz * 0.4);
  ctx.closePath();
  ctx.fillStyle = arrow.color;
  ctx.fill();
  ctx.restore();

  // No emoji in LOD mode — too small to see
}