// ===== 📄 ФАЙЛ: src/components/FXOverlay.tsx =====
/**
 * Arrow Puzzle — Screen-Space FX Canvas (v4 — SYNCHRONOUS BRIDGE)
 *
 * АРХИТЕКТУРА v4:
 * Раньше: useEffect → diff history → создать CapturedArrow → wakeUp → draw.
 *   → 2-10 кадров задержки на мобиле. Стрелка "исчезала".
 *
 * Теперь: GameScreen.handleArrowClick() → emitFlyFX() → queue (синхронно).
 *   → FXOverlay render loop → drainFlyFX() → draw. Zero кадров задержки.
 *
 * FXOverlay больше НЕ:
 * - парсит history
 * - использует useEffect для захвата стрелок
 * - отслеживает prevHistoryLen/prevArrowIds
 *
 * FXOverlay ДЕЛАЕТ:
 * - Drain fxBridge queue в render loop (rAF)
 * - Рисует летящие стрелки с lock-at-capture параметрами
 * - Undo cleanup: useEffect на arrows убирает вернувшиеся стрелки
 * - LOD, zero-alloc, camera out of loop, rect cache — сохранены
 */

import { useEffect, useRef } from 'react';
import { MotionValue } from 'framer-motion';
import { useGameStore } from '../stores/store';
import { useActiveSkin, type GameSkin } from '../game/skins';
import { DIRECTIONS, ARROW_EMOJIS } from '../config/constants';
import type { Arrow } from '../game/types';
import { drainFlyFX, hasPendingFX, type FlyFXItem } from '../game/fxBridge';

// ============================================
// CONSTANTS
// ============================================

const GRID_PADDING_CELLS = 0.4;

// ============================================
// TYPES
// ============================================

/** Runtime fly state = bridge item + mutable progress */
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
// STATIC POINT BUFFER (zero-alloc)
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

/**
 * FXOverlay регистрирует свою wake-функцию сюда.
 * GameScreen вызывает wakeFXOverlay() после emitFlyFX().
 */
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

  // Cached container rect
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
  // UNDO CLEANUP — единственный useEffect для arrows
  // ============================================

  const arrows = useGameStore(s => s.arrows);

  useEffect(() => {
    if (!active) return;
    const flying = flyingRef.current;
    if (flying.length === 0) return;

    const currentIds = new Set(arrows.map(a => a.id));
    for (let i = flying.length - 1; i >= 0; i--) {
      if (currentIds.has(flying[i].arrow.id)) {
        flying.splice(i, 1);
      }
    }
  }, [arrows, active]);

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

      // === DRAIN QUEUE — синхронно из fxBridge ===
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

        drawFlyingArrow(ctx, fa, cellSize, skin);
      }

      ctx.restore(); // camera
      ctx.restore(); // dpr

      animFrameRef.current = requestAnimationFrame(render);
    }

    animFrameRef.current = requestAnimationFrame(render);

    // Register wake function for GameScreen
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
// DRAWING: Flying Arrow (dispatcher)
// ============================================

function drawFlyingArrow(
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
// DRAWING: Full Detail
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

  if (arrow.type !== 'normal') {
    ctx.font = `${cellSize * 0.5}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ARROW_EMOJIS[arrow.type], headX, headY);
  }
}

// ============================================
// DRAWING: LOD
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