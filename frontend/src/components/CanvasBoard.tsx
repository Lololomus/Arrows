/**
 * Arrow Puzzle - Canvas Board Renderer (OPTIMIZED)
 *
 * ОПТИМИЗАЦИИ:
 * 1. IMMORTAL RENDER LOOP — useEffect НЕ зависит от arrows/hints/blocked
 *    → Render loop создаётся ОДИН раз, НЕ убивается при каждом клике
 *    → Все данные читаются из refs (обновляются через лёгкие useEffect)
 *    → 0 кадров мёртвой зоны между удалением стрелки и FX
 *
 * 2. УБРАН useMemo(currentOccupiedNum) — используется globalIndex.isOccupied()
 *    → Экономия O(totalCells) на каждый клик
 *
 * 3. BBOX CACHE по arrow.id — не пересчитывается для существующих стрелок
 *
 * 4. STATIC CANVAS не инвалидируется на каждый клик
 *    → Рисуется 1 раз при initLevel, обновляется инкрементально
 *
 * 5. getVisibleArrows — возвращает indices, не копирует массив
 *
 * 6. globalIndex.getArrow() вместо .find() — O(1) вместо O(n)
 *
 * 7. [Legacy] Специальные стрелки закомментированы
 */

import { useEffect, useRef, useCallback } from 'react';
import type { Arrow, Cell } from '../game/types';
import { DIRECTIONS } from '../config/constants';
import { useGameStore } from '../stores/store';
import { useActiveSkin, type GameSkin } from '../game/skins';
import type { MotionValue } from 'framer-motion';
import { globalIndex } from '../game/spatialIndex';
import { getArrowPath, findCollision } from '../game/engine';

// ============================================
// TYPES
// ============================================

interface GestureState {
  arrowId: string | null;
  startX: number;
  startY: number;
  startTime: number;
  phase: 'idle' | 'pending' | 'holding' | 'cancelled';
}

interface PreviewRay {
  arrowId: string;
  headCell: Cell;
  pathCells: Cell[];
  collisionCell: Cell | null;
  isFree: boolean;
  color: string;
  direction: { dx: number; dy: number };
}

interface BounceAnim {
  arrowId: string;
  startTime: number;
  duration: number;
  dx: number;
  dy: number;
  distance: number;
}

interface ErrorFlash {
  startTime: number;
  duration: number;
}

interface ArrowBBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface CanvasBoardProps {
  arrows: Arrow[];
  gridSize: { width: number; height: number };
  cellSize: number;
  hintedArrowId: string | null;
  onArrowClick: (arrowId: string) => void;
  springX: MotionValue<number>;
  springY: MotionValue<number>;
  springScale: MotionValue<number>;
}

// ============================================
// CONSTANTS
// ============================================

const LOD_THRESHOLD = 12;
const GRID_PADDING_CELLS = 0.4;
const HOLD_THRESHOLD_MS = 200;
const MOVE_THRESHOLD_PX = 15;
const BOUNCE_DURATION = 320;
const BOUNCE_DISTANCE_MIN_CELLS = 0.3;
const BOUNCE_DISTANCE_DEFAULT_CELLS = 1.5;
const BOUNCE_DISTANCE_MAX_CELLS = 4.5;
const VIGNETTE_DURATION = 600;
const BLOCKED_COLOR = '#FF3B30';
const BLOCKED_ALPHA = 0.8;
const PREVIEW_RAY_STROKE_MULTIPLIER = 1;
const PREVIEW_RAY_FREE_COLOR = 'rgba(52, 199, 89, 0.45)';
const PREVIEW_RAY_BLOCKED_COLOR = 'rgba(255, 59, 48, 0.45)';
const PREVIEW_MARKER_OUTLINE_COLOR = 'rgba(255, 255, 255, 0.9)';
const PREVIEW_CHECK_SIZE_RATIO = 0.24;
const PREVIEW_CROSS_SIZE_RATIO = 0.28;
const PREVIEW_MARKER_STROKE_MULTIPLIER = 1.15;
const INTRO_MIN_DIM_FOR_SWEEP = 10;
const INTRO_SWEEP_DURATION_MS = 650;

// ============================================
// BBOX CACHE (persists across renders)
// ============================================

const _bboxCache = new Map<string, ArrowBBox>();

function getBBox(arrow: Arrow): ArrowBBox {
  let bb = _bboxCache.get(arrow.id);
  if (bb) return bb;

  const cells = arrow.cells;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let j = 0; j < cells.length; j++) {
    const { x, y } = cells[j];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) { minX = 0; maxX = 0; minY = 0; maxY = 0; }
  bb = { minX, maxX, minY, maxY };
  _bboxCache.set(arrow.id, bb);
  return bb;
}

export function clearBBoxCache(): void {
  _bboxCache.clear();
}

// ============================================
// COMPONENT
// ============================================

export function CanvasBoard({
  arrows,
  gridSize,
  cellSize,
  hintedArrowId,
  onArrowClick,
  springX,
  springY,
  springScale,
}: CanvasBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const skin = useActiveSkin();
  const animFrameRef = useRef<number>(0);
  const wakeUpRenderRef = useRef<() => void>(() => {});

  // ⚡ Lazy init: -1 = не стартовал, таймер запустится на первом кадре render()
  const levelStartTimeRef = useRef<number>(-1);
  const shakingArrowId = useGameStore(s => s.shakingArrowId);
  const blockedArrowIds = useGameStore(s => s.blockedArrowIds);

  // ⚡ REFS для immortal render loop — данные обновляются без пересоздания loop
  const arrowsRef = useRef(arrows);
  const hintedRef = useRef(hintedArrowId);
  const blockedSetRef = useRef(new Set<string>());

  // Gesture refs
  const gestureRef = useRef<GestureState>({
    arrowId: null, startX: 0, startY: 0, startTime: 0, phase: 'idle',
  });
  const holdTimerRef = useRef<number>(0);
  const previewRayRef = useRef<PreviewRay | null>(null);

  // Animation refs
  const bounceRef = useRef<BounceAnim | null>(null);
  const errorFlashRef = useRef<ErrorFlash | null>(null);

  const containerSizeRef = useRef({ w: window.innerWidth, h: window.innerHeight });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const totalBoardW = (gridSize.width + GRID_PADDING_CELLS) * cellSize;
  const totalBoardH = (gridSize.height + GRID_PADDING_CELLS) * cellSize;
  const boardPadding = cellSize * (GRID_PADDING_CELLS / 2);

  // ⚡ Initial cells — рисуется 1 раз при initLevel
  const initialCellsParsed = useRef<{ x: number; y: number }[]>([]);
  const initialCellsSet = useRef(false);

  if (!initialCellsSet.current && arrows.length > 0) {
    initialCellsSet.current = true;
    // ⚡ FIX: очищаем bbox cache при смене уровня.
    // Без этого протухшие bbox от предыдущих уровней (с теми же arrow.id)
    // приводят к фантомным стрелкам при зуме.
    _bboxCache.clear();
    const arr: { x: number; y: number }[] = [];
    for (const arrow of arrows) {
      for (const cell of arrow.cells) arr.push({ x: cell.x, y: cell.y });
    }
    initialCellsParsed.current = arr;
  }

  // ⚡ Sync refs (дёшево, без пересоздания render loop)
  useEffect(() => {
    arrowsRef.current = arrows;
    wakeUpRenderRef.current();
  }, [arrows]);

  useEffect(() => {
    hintedRef.current = hintedArrowId;
    wakeUpRenderRef.current();
  }, [hintedArrowId]);

  useEffect(() => {
    blockedSetRef.current = new Set(blockedArrowIds);
    wakeUpRenderRef.current();
  }, [blockedArrowIds]);

  // Static canvas
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticDirtyRef = useRef(true);

  // ⚡ Static layer dirty ТОЛЬКО при смене уровня (skin или cellSize)
  // НЕ при каждом удалении стрелки
  useEffect(() => { staticDirtyRef.current = true; }, [skin, cellSize, gridSize.width, gridSize.height]);

  // ============================================
  // SCREEN → GRID CONVERSION
  // ============================================

  const screenToGrid = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const camX = springX.get();
    const camY = springY.get();
    const camScale = springScale.get();

    const worldX = (localX - cx - camX) / camScale;
    const worldY = (localY - cy - camY) / camScale;
    const gridLocalX = worldX + totalBoardW / 2 - boardPadding;
    const gridLocalY = worldY + totalBoardH / 2 - boardPadding;
    const gx = Math.floor(gridLocalX / cellSize);
    const gy = Math.floor(gridLocalY / cellSize);

    if (gx < 0 || gx >= gridSize.width || gy < 0 || gy >= gridSize.height) return null;
    return { x: gx, y: gy };
  }, [springX, springY, springScale, cellSize, gridSize.width, gridSize.height, totalBoardW, totalBoardH, boardPadding]);

  // ============================================
  // WAKE RENDER LOOP HELPER
  // ============================================

  const wakeRenderLoop = useCallback(() => {
    wakeUpRenderRef.current();
  }, []);

  // ============================================
  // GESTURE HANDLERS (tap / hold)
  // ============================================

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const cell = screenToGrid(e.clientX, e.clientY);
    const arrowId = cell ? globalIndex.getArrowAt(cell.x, cell.y) : null;

    gestureRef.current = {
      arrowId,
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
      phase: arrowId ? 'pending' : 'idle',
    };

    if (arrowId) {
      e.currentTarget.setPointerCapture(e.pointerId);

      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      holdTimerRef.current = window.setTimeout(() => {
        const g = gestureRef.current;
        if (g.phase !== 'pending' || !g.arrowId) return;

        g.phase = 'holding';

        // ⚡ globalIndex.getArrow() вместо .find()
        const arrow = globalIndex.getArrow(g.arrowId);
        if (arrow) {
          const grid = { width: gridSize.width, height: gridSize.height };
          const path = getArrowPath(arrow, grid);
          const collision = findCollision(arrow, arrowsRef.current, grid);
          const dir = DIRECTIONS[arrow.direction];

          let rayCells = path;
          let collisionCell: Cell | null = null;
          if (collision) {
            const collisionCellKeys = new Set(collision.cells.map(c => `${c.x},${c.y}`));
            const hitIdx = path.findIndex(c => collisionCellKeys.has(`${c.x},${c.y}`));
            if (hitIdx >= 0) {
              rayCells = path.slice(0, hitIdx);
              collisionCell = path[hitIdx];
            }
          }

          previewRayRef.current = {
            arrowId: g.arrowId,
            headCell: arrow.cells[0],
            pathCells: rayCells,
            collisionCell,
            isFree: !collision,
            color: arrow.color,
            direction: { dx: dir.dx, dy: dir.dy },
          };
        }

        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
        wakeRenderLoop();
      }, HOLD_THRESHOLD_MS);
    }
  }, [gridSize.width, gridSize.height, screenToGrid, wakeRenderLoop]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gestureRef.current;
    if (g.phase === 'idle' || g.phase === 'cancelled') return;

    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const currentThreshold = g.phase === 'holding' ? (cellSize * 0.5) : MOVE_THRESHOLD_PX;

    if (dist > currentThreshold) {
      g.phase = 'cancelled';
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (previewRayRef.current) {
        previewRayRef.current = null;
        wakeRenderLoop();
      }
    }
  }, [cellSize, wakeRenderLoop]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gestureRef.current;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);

    if (g.phase === 'pending' && g.arrowId) {
      if (blockedSetRef.current.has(g.arrowId)) {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
      } else {
        onArrowClick(g.arrowId);
      }
    } else if (g.phase === 'holding' && g.arrowId) {
      const cell = screenToGrid(e.clientX, e.clientY);
      const currentArrowId = cell ? globalIndex.getArrowAt(cell.x, cell.y) : null;
      if (currentArrowId === g.arrowId && !blockedSetRef.current.has(g.arrowId)) {
        onArrowClick(g.arrowId);
      }
    }

    gestureRef.current = { arrowId: null, startX: 0, startY: 0, startTime: 0, phase: 'idle' };
    previewRayRef.current = null;
    wakeRenderLoop();
  }, [onArrowClick, screenToGrid, wakeRenderLoop]);

  // ============================================
  // BOUNCE TRIGGER
  // ============================================

  useEffect(() => {
    if (!shakingArrowId) return;

    // ⚡ globalIndex.getArrow() вместо .find()
    const arrow = globalIndex.getArrow(shakingArrowId);
    if (!arrow) return;

    const dir = DIRECTIONS[arrow.direction];
    const grid = { width: gridSize.width, height: gridSize.height };
    const collision = globalIndex.findFirstOnPath(arrow, grid);

    let distance = BOUNCE_DISTANCE_DEFAULT_CELLS;
    if (collision) {
      const head = arrow.cells[0];
      let minDist = Infinity;
      for (const c of collision.cells) {
        const d = Math.abs(c.x - head.x) + Math.abs(c.y - head.y);
        if (d < minDist) minDist = d;
      }
      distance = Math.max(BOUNCE_DISTANCE_MIN_CELLS, Math.min(minDist - 0.5, BOUNCE_DISTANCE_MAX_CELLS));
    }

    bounceRef.current = {
      arrowId: shakingArrowId,
      startTime: performance.now(),
      duration: BOUNCE_DURATION,
      dx: dir.dx,
      dy: dir.dy,
      distance,
    };

    errorFlashRef.current = {
      startTime: performance.now(),
      duration: VIGNETTE_DURATION,
    };

    wakeRenderLoop();
  }, [shakingArrowId, gridSize.width, gridSize.height, wakeRenderLoop]);

  // ============================================
  // RESIZE OBSERVER
  // ============================================

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerSizeRef.current = { w: entry.contentRect.width, h: entry.contentRect.height };
        wakeRenderLoop();
      }
    });
    observer.observe(wrapper);
    containerSizeRef.current = { w: wrapper.clientWidth, h: wrapper.clientHeight };
    return () => observer.disconnect();
  }, [wakeRenderLoop]);

  // ============================================
  // ⚡ IMMORTAL RENDER LOOP
  // Зависит ТОЛЬКО от структурных параметров (меняются при смене уровня).
  // Данные (arrows, hints, blocked) читаются из refs.
  // ============================================

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isRunning = true;

    function render(now: number) {
      if (!isRunning || !ctx || !canvas) return;

      const { w: cw, h: ch } = containerSizeRef.current;
      if (cw === 0 || ch === 0) { animFrameRef.current = requestAnimationFrame(render); return; }

      const targetW = Math.round(cw * dpr);
      const targetH = Math.round(ch * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;
        staticDirtyRef.current = true; // resize invalidates static
      }

      const camX = springX.get();
      const camY = springY.get();
      const camScale = springScale.get();

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(cw / 2 + camX, ch / 2 + camY);
      ctx.scale(camScale, camScale);
      ctx.translate(-totalBoardW / 2 + boardPadding, -totalBoardH / 2 + boardPadding);

      // Intro sweep
      // ⚡ FIX: таймер стартует на первом кадре, а не на маунте компонента
      if (levelStartTimeRef.current < 0) {
        levelStartTimeRef.current = now;
      }
      const elapsedSinceStart = now - levelStartTimeRef.current;
      const maxGridDim = Math.max(gridSize.width, gridSize.height);
      const shouldRunIntroSweep = skin.effects.enableAppearAnimation && maxGridDim >= INTRO_MIN_DIM_FOR_SWEEP;

      // ⚡ FIX: длительность масштабируется по размеру уровня
      // Маленькие (10-20): 650ms, средние (30-50): ~850ms, большие (100+): ~1200ms
      const introSweepDuration = shouldRunIntroSweep
        ? INTRO_SWEEP_DURATION_MS + Math.min(maxGridDim - INTRO_MIN_DIM_FOR_SWEEP, 100) * 5
        : INTRO_SWEEP_DURATION_MS;

      const progress = shouldRunIntroSweep
        ? Math.max(0, Math.min(1, elapsedSinceStart / introSweepDuration))
        : 1;
      const isIntro = shouldRunIntroSweep && progress < 1;
      const isLOD = (cellSize * camScale) < LOD_THRESHOLD;

      ctx.save();

      if (isIntro) {
        // easeOutCubic для прогресса
        const ease = 1 - (1 - progress) * (1 - progress) * (1 - progress);
        const bw = gridSize.width * cellSize;
        const bh = gridSize.height * cellSize;
        const maxRadius = Math.max(0.1, Math.hypot(bw, bh));
        // ⚡ FIX: sqrt(ease) — площадь круга растёт как r², поэтому sqrt
        // даёт визуально равномерное расширение площади
        const radius = maxRadius * Math.sqrt(ease);
        ctx.beginPath();
        ctx.arc(bw / 2, bh / 2, radius, 0, Math.PI * 2);
        ctx.clip();
      }

      // ⚡ Read current data from refs
      const currentArrows = arrowsRef.current;
      const currentHinted = hintedRef.current;
      const currentBlocked = blockedSetRef.current;

      // Viewport culling
      const visibleArrows = getVisibleArrowsFromCamera(
        currentArrows, cw, ch, camX, camY, camScale,
        totalBoardW, totalBoardH, boardPadding, cellSize,
      );

      // Static layers (background + grid dots)
      const gridW = gridSize.width * cellSize;
      const gridH = gridSize.height * cellSize;

      if (staticDirtyRef.current || !staticCanvasRef.current) {
        let offscreen = staticCanvasRef.current;
        if (!offscreen || offscreen.width !== gridW || offscreen.height !== gridH) {
          offscreen = document.createElement('canvas');
          offscreen.width = gridW;
          offscreen.height = gridH;
          staticCanvasRef.current = offscreen;
        }
        const offCtx = offscreen.getContext('2d');
        if (offCtx) {
          offCtx.clearRect(0, 0, gridW, gridH);
          drawBoardBackground(offCtx, cellSize, initialCellsParsed.current);
          // ⚡ Grid dots: рисуем ВСЕ ячейки на static canvas при initLevel.
          // Dots под существующими стрелками не видны (стрелки сверху).
          // При удалении стрелки dot "появляется" автоматически.
          drawGridDotsAll(offCtx, cellSize, initialCellsParsed.current, skin);
        }
        staticDirtyRef.current = false;
      }

      if (staticCanvasRef.current) {
        const halfVpW = cw / 2 / camScale;
        const halfVpH = ch / 2 / camScale;
        const vpCX = -camX / camScale + totalBoardW / 2 - boardPadding;
        const vpCY = -camY / camScale + totalBoardH / 2 - boardPadding;
        const margin = cellSize;

        const sx = Math.max(0, Math.floor(vpCX - halfVpW - margin));
        const sy = Math.max(0, Math.floor(vpCY - halfVpH - margin));
        const sx2 = Math.min(gridW, Math.ceil(vpCX + halfVpW + margin));
        const sy2 = Math.min(gridH, Math.ceil(vpCY + halfVpH + margin));
        const sw = sx2 - sx;
        const sh = sy2 - sy;

        if (sw > 0 && sh > 0) {
          if (sx === 0 && sy === 0 && sw >= gridW && sh >= gridH) {
            ctx.drawImage(staticCanvasRef.current, 0, 0);
          } else {
            ctx.drawImage(staticCanvasRef.current, sx, sy, sw, sh, sx, sy, sw, sh);
          }
        }
      }

      // Arrows
      let hasAnimations = isIntro;
      const bounce = bounceRef.current;
      const bounceActive = bounce && (now - bounce.startTime < bounce.duration);
      if (bounceActive) hasAnimations = true;

      const globalHintPulse = currentHinted
        ? 0.5 + 0.5 * Math.sin(now * 0.001 * skin.animation.hintGlowSpeed * Math.PI * 2)
        : 0;
      const ray = previewRayRef.current;
      const activeHoldArrowId = ray?.arrowId ?? null;
      const holdPulse = activeHoldArrowId
        ? 0.5 + 0.5 * Math.sin(now * 0.001 * 3 * Math.PI * 2)
        : 0;

      drawArrowsBatched(
        ctx, visibleArrows, cellSize,
        currentHinted, globalHintPulse, activeHoldArrowId, holdPulse,
        currentBlocked,
        bounceActive ? bounce : null,
        now, skin, isLOD,
      );

      // Preview ray
      if (ray) {
        hasAnimations = true;
        drawPreviewRay(ctx, ray, cellSize, now, skin);
      }

      ctx.restore(); // sweep clip

      // Error vignette
      const flash = errorFlashRef.current;
      const flashActive = flash && (now - flash.startTime < flash.duration);
      if (flashActive) {
        hasAnimations = true;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const ft = (now - flash!.startTime) / flash!.duration;
        ctx.globalCompositeOperation = 'multiply';
        drawErrorVignette(ctx, cw, ch, ft);
        ctx.globalCompositeOperation = 'source-over';
      }

      if (bounce && !bounceActive) bounceRef.current = null;
      if (flash && !flashActive) errorFlashRef.current = null;

      if (hasAnimations || currentHinted) {
        animFrameRef.current = requestAnimationFrame(render);
      } else {
        animFrameRef.current = 0;
      }
    }

    animFrameRef.current = requestAnimationFrame(render);

    const wakeUp = () => {
      if (animFrameRef.current === 0 && isRunning) {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };
    wakeUpRenderRef.current = wakeUp;

    // Spring subscriptions
    const lastSpring = { x: springX.get(), y: springY.get(), s: springScale.get() };
    const springWake = () => {
      const x = springX.get(), y = springY.get(), s = springScale.get();
      if (Math.abs(x - lastSpring.x) < 0.5
       && Math.abs(y - lastSpring.y) < 0.5
       && Math.abs(s - lastSpring.s) < 0.001) return;
      lastSpring.x = x; lastSpring.y = y; lastSpring.s = s;
      wakeUp();
    };
    const unsubX = springX.on('change', springWake);
    const unsubY = springY.on('change', springWake);
    const unsubScale = springScale.on('change', springWake);

    return () => {
      isRunning = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      unsubX(); unsubY(); unsubScale();
    };
  }, [
    // ⚡ ТОЛЬКО структурные зависимости (меняются при смене уровня)
    cellSize, gridSize.width, gridSize.height,
    totalBoardW, totalBoardH, boardPadding, dpr, skin,
    springX, springY, springScale,
  ]);

  return (
    <div ref={wrapperRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: 'pointer', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}

// ============================================
// BOUNCE EASING
// ============================================

function bounceEasing(t: number): number {
  if (t < 0.4) {
    const p = t / 0.4;
    return p * p * p;
  } else {
    const p = (t - 0.4) / 0.6;
    return 1 - p * p;
  }
}

// ============================================
// VIEWPORT CULLING (⚡ uses cached BBoxes)
// ============================================

function getVisibleArrowsFromCamera(
  arrows: Arrow[], containerW: number, containerH: number,
  camX: number, camY: number, camScale: number,
  totalBoardW: number, totalBoardH: number, boardPadding: number, cellSize: number,
): Arrow[] {
  // ⚡ Защита от нулевого/негативного масштаба
  const safeCamScale = Math.max(camScale, 0.001);

  const halfVpW = containerW / 2 / safeCamScale;
  const halfVpH = containerH / 2 / safeCamScale;
  const vpCX = -camX / safeCamScale + totalBoardW / 2 - boardPadding;
  const vpCY = -camY / safeCamScale + totalBoardH / 2 - boardPadding;

  // ⚡ FIX: margin покрывает bounce (до 4.5 cells) + chevron (~0.5 cell) + запас
  // Плюс гарантируем минимум 100 screen-pixels в world-coords
  const worldMargin = cellSize * 6;
  const screenMargin = 100 / safeCamScale;
  const margin = Math.max(worldMargin, screenMargin);

  const left = vpCX - halfVpW - margin;
  const right = vpCX + halfVpW + margin;
  const top = vpCY - halfVpH - margin;
  const bottom = vpCY + halfVpH + margin;

  const gridPixelW = totalBoardW - 2 * boardPadding;
  const gridPixelH = totalBoardH - 2 * boardPadding;
  if (left <= 0 && top <= 0 && right >= gridPixelW && bottom >= gridPixelH) {
    return arrows;
  }

  const result: Arrow[] = [];
  for (let i = 0; i < arrows.length; i++) {
    const a = arrows[i];
    const bbox = getBBox(a); // ⚡ cached
    // ⚡ FIX: bbox.maxX/maxY — индекс ячейки, нужен правый/нижний край → +1
    const minX = bbox.minX * cellSize;
    const maxX = (bbox.maxX + 1) * cellSize;
    const minY = bbox.minY * cellSize;
    const maxY = (bbox.maxY + 1) * cellSize;
    if (maxX >= left && minX <= right && maxY >= top && minY <= bottom) {
      result.push(a);
    }
  }
  return result;
}

// ============================================
// DRAWING: Background
// ============================================

function drawBoardBackground(ctx: CanvasRenderingContext2D, cellSize: number, cells: { x: number; y: number }[]) {
  if (cells.length === 0) return;
  const pad = cellSize * 0.15;
  const radius = cellSize * 0.22;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < cells.length; i++) {
    const { x, y } = cells[i];
    ctx.roundRect(x * cellSize - pad, y * cellSize - pad, cellSize + pad * 2, cellSize + pad * 2, radius);
  }
  ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
  ctx.fill();
  ctx.restore();
}

// ⚡ Рисуем ВСЕ dots (не проверяем occupied). Стрелки рисуются поверх.
function drawGridDotsAll(ctx: CanvasRenderingContext2D, cellSize: number, cells: { x: number; y: number }[], skin: GameSkin) {
  const half = cellSize / 2;
  const dotR = cellSize * skin.geometry.gridDotRadius;
  ctx.fillStyle = skin.colors.gridDotColor;
  for (let i = 0; i < cells.length; i++) {
    const { x, y } = cells[i];
    ctx.beginPath();
    ctx.arc(x * cellSize + half, y * cellSize + half, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ============================================
// DRAWING: Preview Ray
// ============================================

function drawPreviewRay(ctx: CanvasRenderingContext2D, ray: PreviewRay, cellSize: number, now: number, skin: GameSkin) {
  const half = cellSize / 2;
  const strokeWidth = cellSize * skin.geometry.bodyStrokeRatio * PREVIEW_RAY_STROKE_MULTIPLIER;
  const markerStrokeWidth = strokeWidth * PREVIEW_MARKER_STROKE_MULTIPLIER;

  ctx.save();

  if (ray.pathCells.length > 0 || ray.collisionCell) {
    const headX = ray.headCell.x * cellSize + half;
    const headY = ray.headCell.y * cellSize + half;

    ctx.beginPath();
    ctx.moveTo(headX, headY);

    for (let i = 0; i < ray.pathCells.length; i++) {
      const c = ray.pathCells[i];
      ctx.lineTo(c.x * cellSize + half, c.y * cellSize + half);
    }

    if (!ray.isFree && ray.pathCells.length === 0 && ray.collisionCell) {
      ctx.lineTo(ray.collisionCell.x * cellSize + half, ray.collisionCell.y * cellSize + half);
    }

    if (ray.isFree && ray.pathCells.length > 0) {
      const last = ray.pathCells[ray.pathCells.length - 1];
      ctx.lineTo(
        (last.x + ray.direction.dx * 3) * cellSize + half,
        (last.y + ray.direction.dy * 3) * cellSize + half,
      );
    }

    ctx.strokeStyle = ray.isFree ? PREVIEW_RAY_FREE_COLOR : PREVIEW_RAY_BLOCKED_COLOR;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  if (ray.collisionCell) {
    const cx = ray.collisionCell.x * cellSize + half;
    const cy = ray.collisionCell.y * cellSize + half;
    const sz = cellSize * PREVIEW_CROSS_SIZE_RATIO;
    const pulse = 0.8 + 0.2 * Math.sin(now * 0.008);

    ctx.save();
    ctx.globalAlpha = pulse * 0.92;

    ctx.beginPath();
    ctx.arc(cx, cy, sz * 1.15, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 59, 48, 0.2)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx - sz, cy - sz); ctx.lineTo(cx + sz, cy + sz);
    ctx.moveTo(cx + sz, cy - sz); ctx.lineTo(cx - sz, cy + sz);
    ctx.strokeStyle = PREVIEW_MARKER_OUTLINE_COLOR;
    ctx.lineWidth = markerStrokeWidth + cellSize * 0.035;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - sz, cy - sz); ctx.lineTo(cx + sz, cy + sz);
    ctx.moveTo(cx + sz, cy - sz); ctx.lineTo(cx - sz, cy + sz);
    ctx.strokeStyle = '#FF3B30';
    ctx.lineWidth = markerStrokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255, 59, 48, 0.7)';
    ctx.shadowBlur = cellSize * 0.2;
    ctx.stroke();
    ctx.restore();
  }

  if (ray.isFree && ray.pathCells.length > 0) {
    const last = ray.pathCells[ray.pathCells.length - 1];
    const cx = last.x * cellSize + half;
    const cy = last.y * cellSize + half;
    const sz = cellSize * PREVIEW_CHECK_SIZE_RATIO;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, sz * 1.25, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(52, 199, 89, 0.18)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx - sz, cy);
    ctx.lineTo(cx - sz * 0.2, cy + sz * 0.72);
    ctx.lineTo(cx + sz, cy - sz * 0.56);
    ctx.strokeStyle = PREVIEW_MARKER_OUTLINE_COLOR;
    ctx.lineWidth = markerStrokeWidth + cellSize * 0.03;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - sz, cy);
    ctx.lineTo(cx - sz * 0.2, cy + sz * 0.72);
    ctx.lineTo(cx + sz, cy - sz * 0.56);
    ctx.strokeStyle = '#34C759';
    ctx.lineWidth = markerStrokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(52, 199, 89, 0.7)';
    ctx.shadowBlur = cellSize * 0.18;
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

// ============================================
// DRAWING: Error Vignette
// ============================================

function drawErrorVignette(ctx: CanvasRenderingContext2D, width: number, height: number, t: number) {
  let alpha: number;
  if (t < 0.2) alpha = (t / 0.2) * 0.6;
  else if (t < 0.5) alpha = 0.6;
  else alpha = 0.6 * (1 - (t - 0.5) / 0.5);
  alpha = Math.max(0, Math.min(0.6, alpha));

  const cx = width / 2;
  const cy = height / 2;
  const outerR = Math.hypot(width, height) / 2;
  const grad = ctx.createRadialGradient(cx, cy, outerR * 0.4, cx, cy, outerR);
  grad.addColorStop(0, 'rgba(255, 0, 0, 0)');
  grad.addColorStop(1, `rgba(255, 0, 0, ${alpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

// ============================================
// PRECOMPUTED DIRECTION ROTATIONS
// ============================================

const _dirRot: Record<string, { cos: number; sin: number }> = {};
for (const key in DIRECTIONS) {
  const d = DIRECTIONS[key as keyof typeof DIRECTIONS];
  const rad = d.angle * (Math.PI / 180);
  _dirRot[key] = { cos: Math.cos(rad), sin: Math.sin(rad) };
}

// ============================================
// BATCHED ARROW RENDERING
// ============================================

function drawArrowsBatched(
  ctx: CanvasRenderingContext2D,
  arrows: Arrow[],
  cellSize: number,
  hintedArrowId: string | null,
  hintPulse: number,
  activeHoldArrowId: string | null,
  holdPulse: number,
  blockedSet: Set<string>,
  bounce: BounceAnim | null,
  now: number,
  skin: GameSkin,
  isLOD: boolean,
) {
  const half = cellSize / 2;
  const strokeWidth = cellSize * skin.geometry.bodyStrokeRatio;
  const monolithStrokeWidth = strokeWidth + cellSize * skin.geometry.outlineExtraRatio;
  const headGap = cellSize * skin.geometry.headGapRatio;
  const chevLen = cellSize * skin.geometry.chevronLengthRatio;
  const chevSpread = cellSize * skin.geometry.chevronSpreadRatio;
  const chevStroke = strokeWidth * skin.geometry.chevronStrokeMultiplier;

  const byColor = new Map<string, Arrow[]>();
  const individual: Arrow[] = [];

  for (let i = 0; i < arrows.length; i++) {
    const a = arrows[i];
    if (
      blockedSet.has(a.id) ||
      a.id === hintedArrowId ||
      a.id === activeHoldArrowId ||
      (bounce && bounce.arrowId === a.id)
      // [Legacy] || a.type !== 'normal'
    ) {
      individual.push(a);
    } else {
      let group = byColor.get(a.color);
      if (!group) { group = []; byColor.set(a.color, group); }
      group.push(a);
    }
  }

  // === LOD BATCHED ===
  if (isLOD) {
    for (const [color, group] of byColor) {
      ctx.beginPath();
      for (let g = 0; g < group.length; g++) {
        const a = group[g];
        const cells = a.cells;
        const len = cells.length;
        if (len < 2) continue;
        const dir = DIRECTIONS[a.direction];
        ctx.moveTo(cells[len - 1].x * cellSize + half, cells[len - 1].y * cellSize + half);
        for (let j = len - 2; j > 0; j--) {
          ctx.lineTo(cells[j].x * cellSize + half, cells[j].y * cellSize + half);
        }
        ctx.lineTo(
          cells[0].x * cellSize + half - dir.dx * headGap,
          cells[0].y * cellSize + half - dir.dy * headGap,
        );
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = monolithStrokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    for (const [color, group] of byColor) {
      ctx.beginPath();
      for (let g = 0; g < group.length; g++) {
        const a = group[g];
        const head = a.cells[0];
        const hx = head.x * cellSize + half;
        const hy = head.y * cellSize + half;
        const sz = cellSize * 0.7;
        const rot = _dirRot[a.direction];
        const tipX = sz * 0.4, tipY = 0;
        const blX = -sz * 0.4, blY = -sz * 0.4;
        const brX = -sz * 0.4, brY = sz * 0.4;
        ctx.moveTo(hx + tipX * rot.cos - tipY * rot.sin, hy + tipX * rot.sin + tipY * rot.cos);
        ctx.lineTo(hx + blX * rot.cos - blY * rot.sin, hy + blX * rot.sin + blY * rot.cos);
        ctx.lineTo(hx + brX * rot.cos - brY * rot.sin, hy + brX * rot.sin + brY * rot.cos);
        ctx.closePath();
      }
      ctx.fillStyle = color;
      ctx.fill();
    }

  // === FULL DETAIL BATCHED ===
  } else {
    for (const [color, group] of byColor) {
      ctx.beginPath();
      for (let g = 0; g < group.length; g++) {
        const a = group[g];
        const cells = a.cells;
        const len = cells.length;
        if (len < 2) continue;
        const dir = DIRECTIONS[a.direction];
        ctx.moveTo(cells[len - 1].x * cellSize + half, cells[len - 1].y * cellSize + half);
        for (let j = len - 2; j > 0; j--) {
          ctx.lineTo(cells[j].x * cellSize + half, cells[j].y * cellSize + half);
        }
        ctx.lineTo(
          cells[0].x * cellSize + half - dir.dx * headGap,
          cells[0].y * cellSize + half - dir.dy * headGap,
        );
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = monolithStrokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    for (const [color, group] of byColor) {
      ctx.beginPath();
      for (let g = 0; g < group.length; g++) {
        const a = group[g];
        const head = a.cells[0];
        const hx = head.x * cellSize + half;
        const hy = head.y * cellSize + half;
        const rot = _dirRot[a.direction];
        const ax = -chevLen, ay = -chevSpread;
        const bx = -chevLen, by = chevSpread;
        ctx.moveTo(hx + ax * rot.cos - ay * rot.sin, hy + ax * rot.sin + ay * rot.cos);
        ctx.lineTo(hx, hy);
        ctx.lineTo(hx + bx * rot.cos - by * rot.sin, hy + bx * rot.sin + by * rot.cos);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = chevStroke;
      ctx.lineCap = skin.geometry.lineCap;
      ctx.lineJoin = skin.geometry.lineJoin;
      ctx.stroke();
    }
  }

  // Individual arrows (blocked, hinted, bouncing)
  for (let i = 0; i < individual.length; i++) {
    const a = individual[i];
    const isBouncing = bounce && bounce.arrowId === a.id;
    let bounceOffset = 0;
    if (isBouncing) {
      const t = (now - bounce!.startTime) / bounce!.duration;
      bounceOffset = bounce!.distance * bounceEasing(t) * cellSize;
    }
    const isHinted = a.id === hintedArrowId;
    const isHeld = a.id === activeHoldArrowId;
    const hp = isHinted ? hintPulse : 0;
    const isBlocked = blockedSet.has(a.id);
    drawArrow(ctx, a, cellSize, bounceOffset, isHinted, hp, isHeld, holdPulse, skin, isLOD, isBlocked);
  }
}

// ============================================
// STATIC POINT BUFFER (zero-alloc)
// ============================================

const _ptBuf: { x: number; y: number }[] = [];
function ensurePtBuf(len: number) {
  while (_ptBuf.length < len) _ptBuf.push({ x: 0, y: 0 });
}

// ============================================
// DRAWING: Individual Arrow
// ============================================

function drawArrow(
  ctx: CanvasRenderingContext2D, arrow: Arrow, cellSize: number,
  bounceOffset: number,
  isHinted: boolean, hintPulse: number,
  isHeld: boolean, holdPulse: number,
  skin: GameSkin, isLOD: boolean, isBlocked: boolean,
) {
  const dir = DIRECTIONS[arrow.direction];
  const half = cellSize / 2;
  const strokeWidth = cellSize * skin.geometry.bodyStrokeRatio;
  const monolithStrokeWidth = strokeWidth + cellSize * skin.geometry.outlineExtraRatio;
  const headGap = cellSize * skin.geometry.headGapRatio;
  const HOLD_CORE_COLOR = '#00E5FF';
  const isHoldActive = isHeld;
  const isHintActive = isHinted && !isHoldActive;
  const applyBlockedDim = isBlocked && !isHintActive && !isHoldActive;

  let strokeColor = arrow.color;
  if (isHoldActive) {
    strokeColor = HOLD_CORE_COLOR;
  } else if (isHintActive) {
    strokeColor = skin.colors.hintColor;
  } else if (isBlocked) {
    const upperColor = arrow.color.toUpperCase();
    if (upperColor === '#FF3B30' || upperColor === '#FF0000' || upperColor === '#FF2D55') {
      strokeColor = '#8B0000';
    } else {
      strokeColor = BLOCKED_COLOR;
    }
  }

  if (applyBlockedDim) {
    ctx.save();
    ctx.globalAlpha = BLOCKED_ALPHA;
  }

  const hintGlowAlpha = Math.max(0, Math.min(1, 0.18 + 0.22 * hintPulse));
  const hintBodyGlowWidth = monolithStrokeWidth * 2.4;
  const hintBodyCoreWidth = monolithStrokeWidth * (1.02 + 0.18 * hintPulse);
  const holdHaloAlpha = Math.max(0, Math.min(1, 0.28 + 0.30 * holdPulse));
  const holdBodyHaloWidth = monolithStrokeWidth * 2.2;
  const holdBodyCoreWidth = monolithStrokeWidth * 1.28;

  const cells = arrow.cells;
  const len = cells.length;
  ensurePtBuf(len);
  for (let i = 0; i < len; i++) {
    const c = cells[len - 1 - i];
    _ptBuf[i].x = c.x * cellSize + half;
    _ptBuf[i].y = c.y * cellSize + half;
  }

  if (len > 1) {
    _ptBuf[len - 1].x -= dir.dx * headGap;
    _ptBuf[len - 1].y -= dir.dy * headGap;
  }

  const geometricLength = Math.max(0, (len - 1) * cellSize - headGap);

  const buildPath = () => {
    ctx.beginPath();
    ctx.moveTo(_ptBuf[0].x, _ptBuf[0].y);
    for (let i = 1; i < len; i++) ctx.lineTo(_ptBuf[i].x, _ptBuf[i].y);
    if (bounceOffset > 0 && len > 0) {
      ctx.lineTo(
        _ptBuf[len - 1].x + dir.dx * bounceOffset,
        _ptBuf[len - 1].y + dir.dy * bounceOffset,
      );
    }
  };

  const strokeBodyPath = () => {
    if (isHoldActive) {
      buildPath();
      ctx.save();
      ctx.globalAlpha = holdHaloAlpha;
      ctx.strokeStyle = 'white';
      ctx.lineWidth = holdBodyHaloWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();

      buildPath();
      ctx.strokeStyle = HOLD_CORE_COLOR;
      ctx.lineWidth = holdBodyCoreWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      return;
    }

    if (isHintActive) {
      buildPath();
      ctx.save();
      ctx.globalAlpha = hintGlowAlpha;
      ctx.strokeStyle = skin.colors.hintColor;
      ctx.lineWidth = hintBodyGlowWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();

      buildPath();
      ctx.strokeStyle = skin.colors.hintColor;
      ctx.lineWidth = hintBodyCoreWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      return;
    }

    buildPath();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = monolithStrokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  // LOD
  if (isLOD) {
    if (len >= 2) {
      if (bounceOffset > 0) {
        ctx.setLineDash([geometricLength, 20000]);
        ctx.lineDashOffset = -bounceOffset;
      }
      strokeBodyPath();
      ctx.setLineDash([]);
    }

    const head = cells[0];
    const hx = head.x * cellSize + half + dir.dx * bounceOffset;
    const hy = head.y * cellSize + half + dir.dy * bounceOffset;
    const sz = cellSize * 0.7;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(dir.angle * (Math.PI / 180));
    ctx.beginPath();
    ctx.moveTo(sz * 0.4, 0);
    ctx.lineTo(-sz * 0.4, -sz * 0.4);
    ctx.lineTo(-sz * 0.4, sz * 0.4);
    ctx.closePath();

    if (isHoldActive) {
      ctx.save();
      ctx.globalAlpha = holdHaloAlpha;
      ctx.strokeStyle = 'white';
      ctx.lineWidth = Math.max(1.5, cellSize * 0.08);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = HOLD_CORE_COLOR;
      ctx.fill();
    } else if (isHintActive) {
      ctx.save();
      ctx.globalAlpha = hintGlowAlpha;
      ctx.strokeStyle = skin.colors.hintColor;
      ctx.lineWidth = Math.max(1.5, cellSize * 0.1);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = skin.colors.hintColor;
      ctx.fill();
    } else {
      ctx.fillStyle = strokeColor;
      ctx.fill();
    }

    ctx.restore();
    if (applyBlockedDim) ctx.restore();
    return;
  }

  // Full detail
  if (len >= 2) {
    if (bounceOffset > 0) {
      ctx.setLineDash([geometricLength, 20000]);
      ctx.lineDashOffset = -bounceOffset;
    }
    strokeBodyPath();
    ctx.setLineDash([]);
  }

  // Chevron
  const head = cells[0];
  const headX = head.x * cellSize + half + dir.dx * bounceOffset;
  const headY = head.y * cellSize + half + dir.dy * bounceOffset;

  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(dir.angle * (Math.PI / 180));
  ctx.beginPath();
  ctx.moveTo(-cellSize * skin.geometry.chevronLengthRatio, -cellSize * skin.geometry.chevronSpreadRatio);
  ctx.lineTo(0, 0);
  ctx.lineTo(-cellSize * skin.geometry.chevronLengthRatio, cellSize * skin.geometry.chevronSpreadRatio);
  const baseChevronStroke = strokeWidth * skin.geometry.chevronStrokeMultiplier;
  ctx.lineCap = skin.geometry.lineCap;
  ctx.lineJoin = skin.geometry.lineJoin;

  if (isHoldActive) {
    ctx.save();
    ctx.globalAlpha = holdHaloAlpha;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = Math.max(1.5, baseChevronStroke + cellSize * 0.03);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = HOLD_CORE_COLOR;
    ctx.lineWidth = baseChevronStroke * 1.12;
    ctx.stroke();
  } else if (isHintActive) {
    ctx.save();
    ctx.globalAlpha = hintGlowAlpha;
    ctx.strokeStyle = skin.colors.hintColor;
    ctx.lineWidth = baseChevronStroke * 2.2;
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = skin.colors.hintColor;
    ctx.lineWidth = baseChevronStroke * (1.02 + 0.18 * hintPulse);
    ctx.stroke();
  } else {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = baseChevronStroke;
    ctx.stroke();
  }

  ctx.restore();

  // [Legacy] Special arrow emoji
  // if (arrow.type !== 'normal') {
  //   ctx.font = `${cellSize * 0.5}px serif`;
  //   ctx.textAlign = 'center';
  //   ctx.textBaseline = 'middle';
  //   ctx.fillText(ARROW_EMOJIS[arrow.type], headX, headY);
  // }

  if (applyBlockedDim) ctx.restore();
}