/**
 * Arrow Puzzle - Canvas Board Renderer (VIEWPORT CANVAS + GESTURES)
 *
 * АРХИТЕКТУРА:
 *   Canvas = viewport (100% контейнера). Камера через ctx.setTransform().
 *
 * ФИЧИ:
 *   - Tap: мгновенный клик → стрелка улетает
 *   - Hold (200ms): preview ray (пунктирный луч маршрута)
 *   - Bounce: ошибочная стрелка двигается к столкновению и отскакивает назад
 *   - Red vignette: экран краснеет по краям при ошибке
 *   - Blocked arrows: после ошибки стрелка краснеет до освобождения пути
 *   - LOD, culling, sweep intro, hint glow — без изменений
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';
import type { Arrow, Cell } from '../game/types';
import { DIRECTIONS, ARROW_EMOJIS } from '../config/constants';
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

  const levelStartTimeRef = useRef<number>(performance.now());
  const shakingArrowId = useGameStore(s => s.shakingArrowId);
  const blockedArrowIds = useGameStore(s => s.blockedArrowIds);

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

  // --- STEP 3: Numeric cell encoding (no string alloc) ---
  // Encode cell as single number: y * MAX_W + x. MAX_W must exceed any grid width.
  const MAX_W = 1024; // supports grids up to 1024 wide

  // Текущие занятые ячейки — numeric Set (no string keys)
  const currentOccupiedNum = useMemo(() => {
    const set = new Set<number>();
    for (const arrow of arrows) {
      for (const cell of arrow.cells) set.add(cell.y * MAX_W + cell.x);
    }
    return set;
  }, [arrows]);

  // Pre-parsed coordinate arrays for drawing (avoid split/map in hot path)
  const initialCellsParsed = useRef<{ x: number; y: number }[]>([]);
  const initialOccupiedNum = useRef<Set<number>>(new Set());

  if (initialOccupiedNum.current.size === 0 && currentOccupiedNum.size > 0) {
    initialOccupiedNum.current = new Set(currentOccupiedNum);
    const arr: { x: number; y: number }[] = [];
    for (const arrow of arrows) {
      for (const cell of arrow.cells) arr.push({ x: cell.x, y: cell.y });
    }
    initialCellsParsed.current = arr;
  }

  // blocked set для O(1) lookup в рендере
  const blockedSet = useMemo(() => new Set(blockedArrowIds), [blockedArrowIds]);

  // Precomputed arrow AABBs in cell-space to keep culling cheap per-frame.
  const arrowBBoxes = useMemo<ArrowBBox[]>(() => {
    const boxes = new Array<ArrowBBox>(arrows.length);
    for (let i = 0; i < arrows.length; i++) {
      const cells = arrows[i].cells;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (let j = 0; j < cells.length; j++) {
        const { x, y } = cells[j];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      if (minX === Infinity) {
        minX = 0;
        maxX = 0;
        minY = 0;
        maxY = 0;
      }

      boxes[i] = { minX, maxX, minY, maxY };
    }
    return boxes;
  }, [arrows]);

  // --- STEP 5: Offscreen canvas for static layers (background + grid dots) ---
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticDirtyRef = useRef(true);

  // Mark static layer dirty when arrows change (removal) or skin changes
  useEffect(() => { staticDirtyRef.current = true; }, [arrows, skin]);

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
    // Игнорируем всё, кроме ЛКМ или тапа
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
      // Захватываем pointer для получения move/up даже вне canvas
      e.currentTarget.setPointerCapture(e.pointerId);

      // Таймер для перехода в hold-режим
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      holdTimerRef.current = window.setTimeout(() => {
        const g = gestureRef.current;
        if (g.phase !== 'pending' || !g.arrowId) return;

        g.phase = 'holding';

        // Вычисляем preview ray
        const arrow = arrows.find(a => a.id === g.arrowId);
        if (arrow) {
          const grid = { width: gridSize.width, height: gridSize.height };
          const path = getArrowPath(arrow, grid);
          const collision = findCollision(arrow, arrows, grid);
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
  }, [arrows, gridSize.width, gridSize.height, screenToGrid, wakeRenderLoop]);

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
      // === TAP ===
      if (blockedSet.has(g.arrowId)) {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
      } else {
        onArrowClick(g.arrowId);
      }
    } else if (g.phase === 'holding' && g.arrowId) {
      // === HOLD RELEASE ===
      const cell = screenToGrid(e.clientX, e.clientY);
      const currentArrowId = cell ? globalIndex.getArrowAt(cell.x, cell.y) : null;

      if (currentArrowId === g.arrowId && !blockedSet.has(g.arrowId)) {
        onArrowClick(g.arrowId);
      }
      // Иначе: отмена
    }

    gestureRef.current = { arrowId: null, startX: 0, startY: 0, startTime: 0, phase: 'idle' };
    previewRayRef.current = null;
    wakeRenderLoop();
  }, [onArrowClick, screenToGrid, blockedSet, wakeRenderLoop]);

  // ============================================
  // BOUNCE TRIGGER (реакция на shakingArrowId из store)
  // ============================================

  useEffect(() => {
    if (!shakingArrowId) return;

    const arrow = arrows.find(a => a.id === shakingArrowId);
    if (!arrow) return;

    const dir = DIRECTIONS[arrow.direction];
    const grid = { width: gridSize.width, height: gridSize.height };
    const collision = findCollision(arrow, arrows, grid);

    // Расстояние до столкновения, максимум 1.5 ячейки
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
  }, [shakingArrowId, arrows, gridSize.width, gridSize.height, wakeRenderLoop]);

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
  // RENDER LOOP
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
      }

      const camX = springX.get();
      const camY = springY.get();
      const camScale = springScale.get();

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Камера
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(cw / 2 + camX, ch / 2 + camY);
      ctx.scale(camScale, camScale);
      ctx.translate(-totalBoardW / 2 + boardPadding, -totalBoardH / 2 + boardPadding);

      // Intro sweep
      const elapsedSinceStart = now - levelStartTimeRef.current;
      const maxGridDim = Math.max(gridSize.width, gridSize.height);
      const shouldRunIntroSweep = skin.effects.enableAppearAnimation && maxGridDim >= INTRO_MIN_DIM_FOR_SWEEP;
      const progress = shouldRunIntroSweep
        ? Math.max(0, Math.min(1, elapsedSinceStart / INTRO_SWEEP_DURATION_MS))
        : 1;
      const isIntro = shouldRunIntroSweep && progress < 1;
      const isLOD = (cellSize * camScale) < LOD_THRESHOLD;

      ctx.save();

      if (isIntro) {
        const ease = 1 - Math.pow(1 - progress, 3);
        const bw = gridSize.width * cellSize;
        const bh = gridSize.height * cellSize;
        const maxRadius = Math.max(0.1, Math.hypot(bw, bh));
        ctx.beginPath();
        ctx.arc(bw / 2, bh / 2, maxRadius * ease, 0, Math.PI * 2);
        ctx.clip();
      }

      const visibleArrows = getVisibleArrowsFromCamera(
        arrows, arrowBBoxes, cw, ch, camX, camY, camScale,
        totalBoardW, totalBoardH, boardPadding, cellSize,
      );

      // 0+1. Static layers via offscreen canvas (Step 5)
      const gridW = gridSize.width * cellSize;
      const gridH = gridSize.height * cellSize;

      if (staticDirtyRef.current || !staticCanvasRef.current) {
        // Create or resize offscreen canvas
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
          drawGridDots(offCtx, cellSize, initialCellsParsed.current, currentOccupiedNum, MAX_W, skin);
        }
        staticDirtyRef.current = false;
      }

      if (staticCanvasRef.current) {
        // Step 9: Only draw visible portion of static canvas when zoomed in
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
          // Full grid visible → simple drawImage (no sub-rect overhead)
          if (sx === 0 && sy === 0 && sw >= gridW && sh >= gridH) {
            ctx.drawImage(staticCanvasRef.current, 0, 0);
          } else {
            ctx.drawImage(staticCanvasRef.current, sx, sy, sw, sh, sx, sy, sw, sh);
          }
        }
      }

      // 2. Стрелки (batched by color)
      let hasAnimations = isIntro;
      const bounce = bounceRef.current;
      const bounceActive = bounce && (now - bounce.startTime < bounce.duration);
      if (bounceActive) hasAnimations = true;

      const globalHintPulse = hintedArrowId
        ? 0.5 + 0.5 * Math.sin(now * 0.001 * skin.animation.hintGlowSpeed * Math.PI * 2)
        : 0;

      drawArrowsBatched(
        ctx, visibleArrows, cellSize,
        hintedArrowId, globalHintPulse,
        blockedSet,
        bounceActive ? bounce : null,
        now, skin, isLOD,
      );

      // 3. Preview ray
      const ray = previewRayRef.current;
      if (ray) {
        hasAnimations = true;
        drawPreviewRay(ctx, ray, cellSize, now, skin);
      }

      ctx.restore(); // sweep clip

      // 4. Красная виньетка (screen-space)
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

      if (hasAnimations || hintedArrowId) {
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

    // Step 8: Throttled spring wakeUp — ignore micro-drift < 0.5px / 0.001 scale
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
    arrows, arrowBBoxes, gridSize, cellSize, currentOccupiedNum, hintedArrowId, blockedSet,
    totalBoardW, totalBoardH, boardPadding, dpr, skin,
    springX, springY, springScale,
  ]);

  // Перерисовка при смене blocked
  useEffect(() => { wakeRenderLoop(); }, [blockedArrowIds, wakeRenderLoop]);

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
// BOUNCE EASING: вперёд → назад
// ============================================

function bounceEasing(t: number): number {
  if (t < 0.4) {
    // easeIn cubic: резкое ускорение к преграде (рывок)
    const p = t / 0.4;
    return p * p * p;
  } else {
    // easeOut quad: плавный откат назад по инерции
    const p = (t - 0.4) / 0.6;
    return 1 - p * p;
  }
}

// ============================================
// VIEWPORT CULLING
// ============================================

function getVisibleArrowsFromCamera(
  arrows: Arrow[], arrowBBoxes: ArrowBBox[], containerW: number, containerH: number,
  camX: number, camY: number, camScale: number,
  totalBoardW: number, totalBoardH: number, boardPadding: number, cellSize: number,
): Arrow[] {
  // Step 6: Compute viewport AABB in world-space for ANY scale
  const halfVpW = containerW / 2 / camScale;
  const halfVpH = containerH / 2 / camScale;
  const vpCX = -camX / camScale + totalBoardW / 2 - boardPadding;
  const vpCY = -camY / camScale + totalBoardH / 2 - boardPadding;
  const margin = cellSize * 2;

  const left = vpCX - halfVpW - margin;
  const right = vpCX + halfVpW + margin;
  const top = vpCY - halfVpH - margin;
  const bottom = vpCY + halfVpH + margin;

  // Fast path: if viewport covers entire grid, skip filtering
  const gridPixelW = totalBoardW - 2 * boardPadding;
  const gridPixelH = totalBoardH - 2 * boardPadding;
  if (left <= 0 && top <= 0 && right >= gridPixelW && bottom >= gridPixelH) {
    return arrows;
  }

  // Filter by precomputed arrow AABB over all cells (works for bent shapes too).
  const result: Arrow[] = [];
  for (let i = 0; i < arrows.length; i++) {
    const a = arrows[i];
    const bbox = arrowBBoxes[i];
    if (!bbox) continue;
    const minX = bbox.minX * cellSize;
    const maxX = bbox.maxX * cellSize;
    const minY = bbox.minY * cellSize;
    const maxY = bbox.maxY * cellSize;
    if (maxX >= left && minX <= right && maxY >= top && minY <= bottom) {
      result.push(a);
    }
  }
  return result;
}

// ============================================
// DRAWING: Background, Grid Dots
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

function drawGridDots(ctx: CanvasRenderingContext2D, cellSize: number, initialCells: { x: number; y: number }[], currentOccupied: Set<number>, MAX_W: number, skin: GameSkin) {
  const half = cellSize / 2;
  const dotR = cellSize * skin.geometry.gridDotRadius;
  ctx.fillStyle = skin.colors.gridDotColor;
  for (let i = 0; i < initialCells.length; i++) {
    const { x, y } = initialCells[i];
    if (currentOccupied.has(y * MAX_W + x)) continue;
    ctx.beginPath();
    ctx.arc(x * cellSize + half, y * cellSize + half, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ============================================
// DRAWING: Preview Ray (SOLID & DIMMED VERSION)
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
  // Пиковая альфа повышена до 0.6
  if (t < 0.2) alpha = (t / 0.2) * 0.6;
  else if (t < 0.5) alpha = 0.6;
  else alpha = 0.6 * (1 - (t - 0.5) / 0.5);
  alpha = Math.max(0, Math.min(0.6, alpha));

  const cx = width / 2;
  const cy = height / 2;
  // Честная диагональ, чтобы углы не обрезались
  const outerR = Math.hypot(width, height) / 2;
  const grad = ctx.createRadialGradient(cx, cy, outerR * 0.4, cx, cy, outerR);
  grad.addColorStop(0, 'rgba(255, 0, 0, 0)');
  grad.addColorStop(1, `rgba(255, 0, 0, ${alpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

// ============================================
// PRECOMPUTED DIRECTION ROTATIONS (for batch chevrons)
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

/**
 * Draw all arrows with color batching.
 *
 * Normal arrows are grouped by color → 1 stroke per color instead of 1 per arrow.
 * Special arrows (blocked, hinted, bouncing, non-normal type) use individual drawArrow.
 *
 * Typical: 300 arrows × 9 colors → ~30 stroke calls instead of ~900.
 */
function drawArrowsBatched(
  ctx: CanvasRenderingContext2D,
  arrows: Arrow[],
  cellSize: number,
  hintedArrowId: string | null,
  hintPulse: number,
  blockedSet: Set<string>,
  bounce: BounceAnim | null,
  now: number,
  skin: GameSkin,
  isLOD: boolean,
) {
  const half = cellSize / 2;
  const strokeWidth = cellSize * skin.geometry.bodyStrokeRatio;
  const headGap = cellSize * skin.geometry.headGapRatio;
  const outlineWidth = strokeWidth + cellSize * skin.geometry.outlineExtraRatio;
  const chevLen = cellSize * skin.geometry.chevronLengthRatio;
  const chevSpread = cellSize * skin.geometry.chevronSpreadRatio;
  const chevStroke = strokeWidth * skin.geometry.chevronStrokeMultiplier;

  // --- Partition: batchable vs individual ---
  const byColor = new Map<string, Arrow[]>();
  const individual: Arrow[] = [];

  for (let i = 0; i < arrows.length; i++) {
    const a = arrows[i];
    if (
      a.type !== 'normal' ||
      blockedSet.has(a.id) ||
      a.id === hintedArrowId ||
      (bounce && bounce.arrowId === a.id)
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
    // Bodies by color
    for (const [color, group] of byColor) {
      ctx.beginPath();
      for (let g = 0; g < group.length; g++) {
        const a = group[g];
        const cells = a.cells;
        const len = cells.length;
        if (len < 2) continue;
        const dir = DIRECTIONS[a.direction];
        // tail → head (reversed)
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
      ctx.lineWidth = strokeWidth * 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // Head triangles by color (pre-rotated, filled)
    for (const [color, group] of byColor) {
      ctx.beginPath();
      for (let g = 0; g < group.length; g++) {
        const a = group[g];
        const head = a.cells[0];
        const hx = head.x * cellSize + half;
        const hy = head.y * cellSize + half;
        const sz = cellSize * 0.7;
        const rot = _dirRot[a.direction];
        // Triangle: (0.4, 0), (-0.4, -0.4), (-0.4, 0.4) — rotated
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
    // 1. All outlines in one path (white border behind everything)
    ctx.beginPath();
    for (const [, group] of byColor) {
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
    }
    ctx.strokeStyle = skin.colors.outlineColor;
    ctx.lineWidth = outlineWidth;
    ctx.lineCap = skin.geometry.lineCap;
    ctx.lineJoin = skin.geometry.lineJoin;
    ctx.stroke();

    // 2. Bodies by color
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
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // 3. Chevrons by color (pre-rotated V-shape, no save/translate/rotate)
    for (const [color, group] of byColor) {
      ctx.beginPath();
      for (let g = 0; g < group.length; g++) {
        const a = group[g];
        const head = a.cells[0];
        const hx = head.x * cellSize + half;
        const hy = head.y * cellSize + half;
        const rot = _dirRot[a.direction];
        // V-shape local: (-chevLen, -chevSpread) → (0,0) → (-chevLen, chevSpread)
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

  // === Individual arrows (blocked, hinted, bouncing, special types) ===
  for (let i = 0; i < individual.length; i++) {
    const a = individual[i];
    const isBouncing = bounce && bounce.arrowId === a.id;
    let bounceOffset = 0;
    if (isBouncing) {
      const t = (now - bounce!.startTime) / bounce!.duration;
      bounceOffset = bounce!.distance * bounceEasing(t) * cellSize;
    }
    const isHinted = a.id === hintedArrowId;
    const hp = isHinted ? hintPulse : 0;
    const isBlocked = blockedSet.has(a.id);
    drawArrow(ctx, a, cellSize, bounceOffset, isHinted, hp, skin, isLOD, isBlocked);
  }
}

// ============================================
// STATIC POINT BUFFER (Step 4: zero-alloc drawArrow)
// ============================================

const _ptBuf: { x: number; y: number }[] = [];
function ensurePtBuf(len: number) {
  while (_ptBuf.length < len) _ptBuf.push({ x: 0, y: 0 });
}

// ============================================
// DRAWING: Arrow
// ============================================

function drawArrow(
  ctx: CanvasRenderingContext2D, arrow: Arrow, cellSize: number,
  bounceOffset: number,
  isHinted: boolean, hintPulse: number,
  skin: GameSkin, isLOD: boolean, isBlocked: boolean,
) {
  const dir = DIRECTIONS[arrow.direction];
  const half = cellSize / 2;
  const strokeWidth = cellSize * skin.geometry.bodyStrokeRatio;
  const headGap = cellSize * skin.geometry.headGapRatio;

  let strokeColor = arrow.color;
  let needsWhiteHighlight = false;

  if (isBlocked) {
    const upperColor = arrow.color.toUpperCase();
    if (upperColor === '#FF3B30' || upperColor === '#FF0000' || upperColor === '#FF2D55') {
      strokeColor = '#8B0000';
      needsWhiteHighlight = true;
    } else {
      strokeColor = BLOCKED_COLOR;
    }
  } else if (isHinted) {
    strokeColor = skin.colors.hintColor;
  }

  if (isBlocked) { ctx.save(); ctx.globalAlpha = BLOCKED_ALPHA; }

  // Step 4: fill static buffer reversed (tail→head), zero allocs
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

  // LOD
  if (isLOD) {
    if (len >= 2) {
      buildPath();
      if (bounceOffset > 0) {
        ctx.setLineDash([geometricLength, 20000]);
        ctx.lineDashOffset = -bounceOffset;
      }
      if (needsWhiteHighlight) {
        // Step 7: wide white stroke instead of shadowBlur
        buildPath();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = strokeWidth * 1.5 + 4;
        ctx.globalAlpha = 0.35;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.globalAlpha = isBlocked ? BLOCKED_ALPHA : 1;
        buildPath();
      }
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth * 1.5;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.stroke();
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
    ctx.fillStyle = strokeColor;
    if (needsWhiteHighlight) {
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fill();
    ctx.restore();
    if (isBlocked) ctx.restore();
    return;
  }

  // Full detail
  if (len >= 2) {
    buildPath();
    if (bounceOffset > 0) {
      ctx.setLineDash([geometricLength, 20000]);
      ctx.lineDashOffset = -bounceOffset;
    }

    ctx.strokeStyle = needsWhiteHighlight ? 'white' : skin.colors.outlineColor;
    ctx.lineWidth = strokeWidth + cellSize * skin.geometry.outlineExtraRatio;
    ctx.lineCap = skin.geometry.lineCap; ctx.lineJoin = skin.geometry.lineJoin;
    ctx.stroke();

    buildPath();
    ctx.strokeStyle = isHinted && hintPulse > 0 ? skin.colors.hintColor : strokeColor;
    ctx.lineWidth = isHinted && hintPulse > 0 ? strokeWidth * skin.animation.hintGlowStrokeMultiplier : strokeWidth;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    if ((isHinted && hintPulse > 0) || needsWhiteHighlight) {
      // Step 7: Double-stroke glow (no shadowBlur)
      ctx.save();
      if (isHinted && hintPulse > 0) {
        // Wide translucent glow stroke underneath
        buildPath();
        ctx.globalAlpha = hintPulse * skin.animation.hintGlowAlpha;
        ctx.strokeStyle = skin.colors.hintColor;
        ctx.lineWidth = strokeWidth * skin.animation.hintGlowStrokeMultiplier * 2.5;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke();
        // Crisp stroke on top
        buildPath();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = skin.colors.hintColor;
        ctx.lineWidth = strokeWidth * skin.animation.hintGlowStrokeMultiplier;
        ctx.stroke();
      } else if (needsWhiteHighlight) {
        buildPath();
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = 'white';
        ctx.lineWidth = strokeWidth + cellSize * 0.25;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke();
        buildPath();
        ctx.globalAlpha = isBlocked ? BLOCKED_ALPHA : 1;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.stroke();
      }
      ctx.restore();
    } else {
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Шеврон
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
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth * skin.geometry.chevronStrokeMultiplier;
  ctx.lineCap = skin.geometry.lineCap; ctx.lineJoin = skin.geometry.lineJoin;
  if (needsWhiteHighlight) {
    // Step 7: wide white chevron underneath instead of shadowBlur
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = strokeWidth * skin.geometry.chevronStrokeMultiplier + 4;
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth * skin.geometry.chevronStrokeMultiplier;
  }
  ctx.stroke();
  ctx.restore();

  if (arrow.type !== 'normal') {
    ctx.font = `${cellSize * 0.5}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ARROW_EMOJIS[arrow.type], headX, headY);
  }

  if (isBlocked) ctx.restore();
}
