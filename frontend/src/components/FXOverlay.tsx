/**
 * Arrow Puzzle — Screen-Space FX Canvas (OPTIMIZED)
 *
 * Оптимизации:
 * 1. УБРАНА подписка на arrows — undo cleanup через history.length
 *    (arrows менялся каждый клик → лишний ре-рендер FXOverlay)
 * 2. Адаптивные эффекты: fly-out / shrink / pop в зависимости от масштаба
 * 3. camScale из FlyFXItem для screen-space эффектов
 */

import { useEffect, useRef } from 'react';
import { MotionValue } from 'framer-motion';
import { useGameStore } from '../stores/store';
import { useActiveSkin, type GameSkin } from '../game/skins';
import { DIRECTIONS } from '../config/constants';
import type { Arrow } from '../game/types';
import { drainFlyFX, type FlyFXItem } from '../game/fxBridge';

// ============================================
// CONSTANTS
// ============================================

const GRID_PADDING_CELLS = 0.4;

/** Пороги для адаптивных эффектов (screen-space px/cell) */
const FX_FULL_FLY_THRESHOLD = 12;    // > 12px: полный fly-out
const FX_SHRINK_THRESHOLD = 3;       // 3-12px: shrink + flash
// < 3px: screen-space pop (всегда видимый)

// ============================================
// TYPES
// ============================================

interface FlyingArrow extends FlyFXItem {
  progress: number;
}

interface CachedRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FXOverlayProps {
  containerRef: React.RefObject<HTMLDivElement>;
  gridSize: { width: number; height: number };
  cellSize: number;
  springX: MotionValue<number>;
  springY: MotionValue<number>;
  springScale: MotionValue<number>;
  active: boolean;
}

// ============================================
// STATIC BUFFERS (zero-alloc)
// ============================================

const _fxPtBuf: { x: number; y: number }[] = [];
function ensureFxPtBuf(len: number) {
  while (_fxPtBuf.length < len) _fxPtBuf.push({ x: 0, y: 0 });
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

// ============================================
// WAKE SINGLETON
// ============================================

let _wakeFn: (() => void) | null = null;

export function wakeFXOverlay(): void {
  _wakeFn?.();
}

// ============================================
// COMPONENT
// ============================================

export function FXOverlay({ containerRef, gridSize, cellSize, springX, springY, springScale, active }: FXOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const flyingRef = useRef<FlyingArrow[]>([]);
  const skin = useActiveSkin();

  const cachedRectRef = useRef<CachedRect>({ left: 0, top: 0, width: 0, height: 0 });

  // ============================================
  // RECT CACHE (ResizeObserver)
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
  // UNDO CLEANUP — через history.length вместо arrows
  // ⚡ arrows менялся каждый клик → лишний ре-рендер
  //    history.length уменьшается ТОЛЬКО при undo
  // ============================================

  const historyLen = useGameStore(s => s.history.length);
  const prevHistoryLenRef = useRef(historyLen);

  useEffect(() => {
    if (!active) return;
    const flying = flyingRef.current;

    // history.length уменьшился → undo произошёл
    if (historyLen < prevHistoryLenRef.current && flying.length > 0) {
      // Получаем текущие arrow IDs из store
      const currentArrows = useGameStore.getState().arrows;
      const currentIds = new Set(currentArrows.map(a => a.id));

      // Убираем анимации стрелок, которые вернулись
      for (let i = flying.length - 1; i >= 0; i--) {
        if (currentIds.has(flying[i].arrow.id)) {
          flying.splice(i, 1);
        }
      }
    }

    prevHistoryLenRef.current = historyLen;
  }, [historyLen, active]);

  // ============================================
  // RENDER LOOP
  // ============================================

  useEffect(() => {
    if (!active) {
      _wakeFn = null;
      return;
    }
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

    const totalBoardW = (gridSize.width + GRID_PADDING_CELLS) * cellSize;
    const totalBoardH = (gridSize.height + GRID_PADDING_CELLS) * cellSize;
    const boardPadding = cellSize * (GRID_PADDING_CELLS / 2);

    let isRunning = true;

    function render(now: number) {
      if (!isRunning || !ctx || !canvas) return;

      // === DRAIN QUEUE ===
      const newItems = drainFlyFX();
      const flying = flyingRef.current;
      for (let i = 0; i < newItems.length; i++) {
        (flying as FlyingArrow[]).push({ ...newItems[i], progress: 0 });
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (flying.length === 0) {
        animFrameRef.current = 0;
        return;
      }

      const rect = cachedRectRef.current;
      if (rect.width === 0) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      const camX = springX.get();
      const camY = springY.get();
      const camScale = springScale.get();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      ctx.save();
      ctx.scale(dpr, dpr);

      // Camera transform — once
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

        // ⚡ Адаптивный эффект по screenCellSize
        drawAdaptiveFX(ctx, fa, cellSize, skin);
      }

      ctx.restore(); // camera
      ctx.restore(); // dpr

      animFrameRef.current = requestAnimationFrame(render);
    }

    animFrameRef.current = requestAnimationFrame(render);

    const wakeUp = () => {
      if (animFrameRef.current === 0 && isRunning) {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };
    _wakeFn = wakeUp;

    return () => {
      isRunning = false;
      _wakeFn = null;
      window.removeEventListener('resize', resizeCanvas);
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
// ADAPTIVE FX DISPATCHER
// ============================================

function drawAdaptiveFX(
  ctx: CanvasRenderingContext2D,
  fa: FlyingArrow,
  cellSize: number,
  skin: GameSkin,
) {
  const scs = fa.screenCellSize;

  if (scs >= FX_FULL_FLY_THRESHOLD) {
    // Полный fly-out (стрелка хорошо видна)
    drawFlyEffect(ctx, fa, cellSize, skin);
  } else if (scs >= FX_SHRINK_THRESHOLD) {
    // Shrink + цветная вспышка (стрелка мелкая, но видна пятном)
    drawShrinkEffect(ctx, fa, cellSize);
  } else {
    // Screen-space pop (стрелка невидима, нужен гарантированный маркер)
    drawPopEffect(ctx, fa, cellSize);
  }
}

// ============================================
// EFFECT: Full Fly-out (screenCell >= 12px)
// ============================================

function drawFlyEffect(
  ctx: CanvasRenderingContext2D,
  fa: FlyingArrow,
  cellSize: number,
  skin: GameSkin,
) {
  const easedProgress = skin.animation.flyEasing(fa.progress);
  const flyDistance = fa.flyDistanceWorld * easedProgress;
  const opacity = 1 - easedProgress;

  ctx.save();
  ctx.globalAlpha = clamp(opacity, 0, 1);

  if (fa.isLOD) {
    drawArrowLOD(ctx, fa.arrow, cellSize, flyDistance, fa.minStrokeWorld, skin);
  } else {
    drawArrowFull(ctx, fa.arrow, cellSize, flyDistance, fa.minStrokeWorld, skin);
  }

  ctx.restore();
}

// ============================================
// EFFECT: Shrink + Flash (screenCell 3-12px)
// ============================================

function drawShrinkEffect(
  ctx: CanvasRenderingContext2D,
  fa: FlyingArrow,
  cellSize: number,
) {
  const t = fa.progress;
  const eased = 1 - (1 - t) * (1 - t); // easeOut quad

  const head = fa.arrow.cells[0];
  const half = cellSize / 2;
  const cx = head.x * cellSize + half;
  const cy = head.y * cellSize + half;

  // Масштаб: 1 → 0 (стрелка сжимается в точку)
  const scale = 1 - eased;
  // Вспышка: 0 → peak → 0
  const flashAlpha = t < 0.3 ? (t / 0.3) * 0.8 : 0.8 * (1 - (t - 0.3) / 0.7);
  // Радиус вспышки в world coords, гарантированно видимый
  const flashRadius = (12 + 20 * eased) / fa.camScale;

  ctx.save();

  // 1. Цветная вспышка (всегда видима)
  ctx.globalAlpha = clamp(flashAlpha, 0, 1);
  ctx.beginPath();
  ctx.arc(cx, cy, flashRadius, 0, Math.PI * 2);
  ctx.fillStyle = fa.arrow.color;
  ctx.fill();

  // 2. Белый core (ещё более видимый)
  ctx.globalAlpha = clamp(flashAlpha * 0.9, 0, 1);
  ctx.beginPath();
  ctx.arc(cx, cy, flashRadius * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  // 3. Сжимающаяся стрелка (пока видна)
  if (scale > 0.1) {
    ctx.globalAlpha = clamp(scale, 0, 1);
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    // Простой LOD треугольник
    const dir = DIRECTIONS[fa.arrow.direction];
    const sz = cellSize * 0.7;
    ctx.translate(cx, cy);
    ctx.rotate(dir.angle * (Math.PI / 180));
    ctx.beginPath();
    ctx.moveTo(sz * 0.4, 0);
    ctx.lineTo(-sz * 0.4, -sz * 0.4);
    ctx.lineTo(-sz * 0.4, sz * 0.4);
    ctx.closePath();
    ctx.fillStyle = fa.arrow.color;
    ctx.fill();
  }

  ctx.restore();
}

// ============================================
// EFFECT: Screen-space Pop (screenCell < 3px)
// ============================================

function drawPopEffect(
  ctx: CanvasRenderingContext2D,
  fa: FlyingArrow,
  cellSize: number,
) {
  const t = fa.progress;
  const eased = 1 - (1 - t) * (1 - t); // easeOut quad

  const head = fa.arrow.cells[0];
  const half = cellSize / 2;
  const cx = head.x * cellSize + half;
  const cy = head.y * cellSize + half;

  // Радиус в screen-pixels, делённый на camScale → гарантированно видим
  const minScreenRadius = 16;
  const maxScreenRadius = 32;
  const screenRadius = minScreenRadius + (maxScreenRadius - minScreenRadius) * eased;
  const worldRadius = screenRadius / fa.camScale;

  const alpha = 1 - eased;

  ctx.save();

  // Цветное кольцо
  ctx.globalAlpha = clamp(alpha * 0.7, 0, 1);
  ctx.beginPath();
  ctx.arc(cx, cy, worldRadius, 0, Math.PI * 2);
  ctx.fillStyle = fa.arrow.color;
  ctx.fill();

  // Белый центр
  ctx.globalAlpha = clamp(alpha * 0.9, 0, 1);
  ctx.beginPath();
  ctx.arc(cx, cy, worldRadius * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  ctx.restore();
}

// ============================================
// DRAWING: Full Detail (unchanged)
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

  const rawBodyStroke = cellSize * skin.geometry.bodyStrokeRatio;
  const rawMonolith = rawBodyStroke + cellSize * skin.geometry.outlineExtraRatio;
  const strokeWidth = Math.max(rawBodyStroke, minStrokeWorld);
  const monolithStrokeWidth = Math.max(rawMonolith, minStrokeWorld);

  const cells = arrow.cells;
  const len = cells.length;

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
    ctx.lineCap = skin.geometry.lineCap;
    ctx.lineJoin = skin.geometry.lineJoin;
    ctx.stroke();
    ctx.setLineDash([]);
  }

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

  // [Legacy] Special arrow emoji
  // if (arrow.type !== 'normal') { ... }
}

// ============================================
// DRAWING: LOD (unchanged)
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
}