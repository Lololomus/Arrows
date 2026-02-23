/**
 * Arrow Puzzle - Game Screen (VIEWPORT CANVAS)
 *
 * ИЗМЕНЕНИЯ:
 * - Убран <motion.div style={{ x, y, scale }}> вокруг доски.
 * - CanvasBoard заполняет весь containerRef, камера внутри ctx.setTransform().
 * - Убран GameBoard (SVG) и useCanvas threshold — всегда Canvas.
 * - springX/Y/Scale прокидываются напрямую в CanvasBoard и FXOverlay.
 * - Кинематографичное интро и zoom controls — без изменений.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { AnimatePresence, useMotionValue, useSpring, motion } from 'framer-motion';
import { useAppStore, useGameStore } from '../stores/store';
import { CanvasBoard } from '../components/CanvasBoard';
import { gameApi } from '../api/client';
import { RefreshCw, Lightbulb, RotateCcw, AlertTriangle, Heart, Trash2, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { ANIMATIONS, MAX_CELL_SIZE, MIN_CELL_SIZE } from '../config/constants';
import { processMove, getFreeArrows, isArrowBlocked } from '../game/engine';
import { FXOverlay } from '../components/FXOverlay';
import { LevelTransitionLoader } from '../components/ui/LevelTransitionLoader';

import gameBgImage from '../assets/game-bg.jpg?url';

type ZoomBounds = { minScale: number; maxScale: number; fitScale: number };
type PanBounds = { minX: number; maxX: number; minY: number; maxY: number };
type ZoomSource = 'wheel' | 'pinch' | 'button';

const GRID_PADDING_CELLS = 0.4;
const ZOOM_OUT_MARGIN_RATIO = 0.10;
const PAN_EDGE_SLACK_RATIO = 0.15;
const MIN_ABS_SCALE = 0.35;
const MIN_VISIBLE_CELLS = 7;
const MAX_ABS_SCALE = 4.0;
const ZOOM_EPS = 0.001;
const INTRO_MIN_DIM_FOR_BLOCK = 10;
const INTRO_INPUT_LOCK_MS = 650;
const INTRO_ZOOM_DELAY_MS = 350;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function computeZoomBounds(
  viewW: number,
  viewH: number,
  gridSize: { width: number; height: number },
  baseCellSize: number,
): ZoomBounds {
  const boardPixelW = (gridSize.width + GRID_PADDING_CELLS) * baseCellSize;
  const boardPixelH = (gridSize.height + GRID_PADDING_CELLS) * baseCellSize;
  const safeW = Math.max(1, viewW - 64);
  const safeH = Math.max(1, viewH - 64);

  const fitScale = Math.min(safeW / boardPixelW, safeH / boardPixelH, 1);
  const minScale = Math.max(MIN_ABS_SCALE, fitScale / (1 + ZOOM_OUT_MARGIN_RATIO));
  const maxScaleByVisibleCells = Math.min(safeW, safeH) / (Math.max(baseCellSize, 1) * MIN_VISIBLE_CELLS);
  const maxScale = clamp(maxScaleByVisibleCells, minScale + 0.2, MAX_ABS_SCALE);

  return { minScale, maxScale, fitScale };
}

function computePanBounds(
  viewW: number,
  viewH: number,
  boardPixelW: number,
  boardPixelH: number,
  scale: number,
): PanBounds {
  const overflowX = (boardPixelW * scale - viewW) / 2;
  const overflowY = (boardPixelH * scale - viewH) / 2;

  // Extra pan breathing room near clamp edges; tune independently from zoom-out limit.
  const edgeSlackX = viewW * PAN_EDGE_SLACK_RATIO;
  const edgeSlackY = viewH * PAN_EDGE_SLACK_RATIO;

  const maxPanX = overflowX > 0 ? overflowX + edgeSlackX : 0;
  const maxPanY = overflowY > 0 ? overflowY + edgeSlackY : 0;

  return {
    minX: -maxPanX,
    maxX: maxPanX,
    minY: -maxPanY,
    maxY: maxPanY,
  };
}

function clampPan(x: number, y: number, bounds: PanBounds): { x: number; y: number } {
  return {
    x: clamp(x, bounds.minX, bounds.maxX),
    y: clamp(y, bounds.minY, bounds.maxY),
  };
}

export function GameScreen() {
  const user = useAppStore(s => s.user);
  const setScreen = useAppStore(s => s.setScreen);

  const gridSize = useGameStore(s => s.gridSize);
  const arrows = useGameStore(s => s.arrows);
  const lives = useGameStore(s => s.lives);
  const status = useGameStore(s => s.status);
  const hintsRemaining = useGameStore(s => s.hintsRemaining);
  const hintedArrowId = useGameStore(s => s.hintedArrowId);
  const history = useGameStore(s => s.history);

  const initLevel = useGameStore(s => s.initLevel);
  const removeArrow = useGameStore(s => s.removeArrow);
  const removeArrows = useGameStore(s => s.removeArrows);
  const failMove = useGameStore(s => s.failMove);
  const undo = useGameStore(s => s.undo);
  const showHint = useGameStore(s => s.showHint);
  const clearHint = useGameStore(s => s.clearHint);
  const setStatus = useGameStore(s => s.setStatus);
  const setShakingArrow = useGameStore(s => s.setShakingArrow);
  const blockArrow = useGameStore(s => s.blockArrow);
  const unblockArrows = useGameStore(s => s.unblockArrows);

  const [currentLevel, setCurrentLevel] = useState(user?.currentLevel || 1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
  });

  // === FRAMER MOTION CAMERA PHYSICS ===
  const cameraX = useMotionValue(0);
  const cameraY = useMotionValue(0);
  const cameraScale = useMotionValue(1);

  const springConfig = { stiffness: 300, damping: 30 };
  const springX = useSpring(cameraX, springConfig);
  const springY = useSpring(cameraY, springConfig);
  const springScale = useSpring(cameraScale, springConfig);

  const [isDragging, setIsDragging] = useState(false);
  const [isIntroAnimating, setIsIntroAnimating] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const lastTransform = useRef({ x: 0, y: 0 });
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const lastZoomTsRef = useRef(performance.now());

  const [confirmAction, setConfirmAction] = useState<'restart' | 'menu' | null>(null);
  const [noMoreLevels, setNoMoreLevels] = useState(false);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      setContainerSize({
        w: container.clientWidth || window.innerWidth,
        h: container.clientHeight || window.innerHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    window.addEventListener('resize', updateSize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  // cellSize вычисляется чтобы уровень влез на экран при scale=1
  const baseCellSize = useMemo(() => {
    const w = containerSize.w || window.innerWidth;
    const h = containerSize.h || window.innerHeight;
    if (w === 0 || h === 0) return 40;

    const SCREEN_PADDING = 32;
    const availableW = w - SCREEN_PADDING;
    const availableH = h - SCREEN_PADDING;
    const maxWidth = availableW / (gridSize.width + GRID_PADDING_CELLS);
    const maxHeight = availableH / (gridSize.height + GRID_PADDING_CELLS);
    const newSize = Math.min(maxWidth, maxHeight, MAX_CELL_SIZE);
    return Math.floor(Math.max(newSize, MIN_CELL_SIZE));
  }, [containerSize.w, containerSize.h, gridSize.width, gridSize.height]);

  const viewW = containerSize.w || window.innerWidth;
  const viewH = containerSize.h || window.innerHeight;
  const boardPixelW = (gridSize.width + GRID_PADDING_CELLS) * baseCellSize;
  const boardPixelH = (gridSize.height + GRID_PADDING_CELLS) * baseCellSize;

  const zoomBounds = useMemo(
    () => computeZoomBounds(viewW, viewH, { width: gridSize.width, height: gridSize.height }, baseCellSize),
    [viewW, viewH, gridSize.width, gridSize.height, baseCellSize],
  );

  const clampPanToBounds = useCallback((x: number, y: number, scale: number) => {
    const panBounds = computePanBounds(viewW, viewH, boardPixelW, boardPixelH, scale);
    return clampPan(x, y, panBounds);
  }, [viewW, viewH, boardPixelW, boardPixelH]);

  const applyScaleImmediate = useCallback((targetScale: number) => {
    const boundedScale = clamp(targetScale, zoomBounds.minScale, zoomBounds.maxScale);
    cameraScale.set(boundedScale);
    const pan = clampPanToBounds(cameraX.get(), cameraY.get(), boundedScale);
    cameraX.set(pan.x);
    cameraY.set(pan.y);
    lastZoomTsRef.current = performance.now();
  }, [zoomBounds.minScale, zoomBounds.maxScale, cameraScale, cameraX, cameraY, clampPanToBounds]);

  const applyScaleWithRateLimit = useCallback((targetScale: number, nowMs: number, _source: ZoomSource) => {
    const currentScale = cameraScale.get();
    const boundedTarget = clamp(targetScale, zoomBounds.minScale, zoomBounds.maxScale);
    const levelFactor = clamp((Math.max(gridSize.width, gridSize.height) - 4) / 16, 0, 1);
    const zoomInRate = lerp(0.9, 1.6, levelFactor);
    const zoomOutRate = lerp(1.2, 2.0, levelFactor);
    const dtSec = clamp((nowMs - lastZoomTsRef.current) / 1000, 1 / 120, 0.1);
    const rate = boundedTarget >= currentScale ? zoomInRate : zoomOutRate;
    const maxDelta = rate * dtSec;
    const delta = clamp(boundedTarget - currentScale, -maxDelta, maxDelta);
    const nextScale = clamp(currentScale + delta, zoomBounds.minScale, zoomBounds.maxScale);

    if (Math.abs(nextScale - currentScale) > ZOOM_EPS) {
      cameraScale.set(nextScale);
      const pan = clampPanToBounds(cameraX.get(), cameraY.get(), nextScale);
      cameraX.set(pan.x);
      cameraY.set(pan.y);
    }

    lastZoomTsRef.current = nowMs;
  }, [
    cameraScale, cameraX, cameraY, zoomBounds.minScale, zoomBounds.maxScale,
    gridSize.width, gridSize.height, clampPanToBounds,
  ]);

  useEffect(() => {
    applyScaleImmediate(cameraScale.get());
  }, [zoomBounds.minScale, zoomBounds.maxScale, viewW, viewH, applyScaleImmediate, cameraScale]);

  // === ЗАГРУЗКА УРОВНЯ ===
  const loadLevel = useCallback(async (levelNum: number) => {
    setStatus('loading');
    setNoMoreLevels(false);
    try {
      const levelData = await gameApi.getLevel(levelNum);
      initLevel(levelNum, levelData.seed, levelData.grid, levelData.arrows);
    } catch (error: any) {
      console.error(error);
      if (error?.status === 404) { setNoMoreLevels(true); setStatus('victory'); }
      else if (error?.status === 403) { alert(`🔒 Уровень ${levelNum} закрыт!`); setScreen('home'); }
      else { alert(`❌ Ошибка загрузки уровня ${levelNum}`); setScreen('home'); }
    }
  }, [initLevel, setStatus, setScreen]);

  useEffect(() => {
    loadLevel(currentLevel);
  }, [currentLevel, loadLevel]);

  // === КИНЕМАТОГРАФИЧНОЕ ИНТРО ===
  useEffect(() => {
    if (status !== 'playing') return;

    const fitAllScale = zoomBounds.fitScale;
    const playScaleRaw = Math.min((viewW - 64) / (10 * baseCellSize), (viewH - 64) / (10 * baseCellSize), 1.5);

    // Масштаб чтобы влез весь уровень
    const playScale = clamp(playScaleRaw, zoomBounds.minScale, zoomBounds.maxScale);
    // Масштаб для комфортной игры (~10x10 ячеек на экране)

    // Жёсткий сброс камеры
    springX.jump(0);
    springY.jump(0);
    springScale.jump(fitAllScale);
    cameraX.set(0);
    cameraY.set(0);
    applyScaleImmediate(fitAllScale);

    const maxGridDim = Math.max(gridSize.width, gridSize.height);
    const shouldLockInputForIntro = maxGridDim >= INTRO_MIN_DIM_FOR_BLOCK;
    setIsIntroAnimating(shouldLockInputForIntro);

    // Ждём sweep-волну, затем зумим
    const t1 = setTimeout(() => {
      const finalScale = (gridSize.width > 12 || gridSize.height > 12) ? playScale : fitAllScale;
      cameraX.set(0);
      cameraY.set(0);
      applyScaleImmediate(finalScale);
    }, shouldLockInputForIntro ? INTRO_ZOOM_DELAY_MS : 0);

    if (!shouldLockInputForIntro) {
      return () => { clearTimeout(t1); };
    }

    const t2 = setTimeout(() => {
      setIsIntroAnimating(false);
    }, INTRO_INPUT_LOCK_MS);

    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [
    status, gridSize.width, gridSize.height, baseCellSize,
    zoomBounds.fitScale, zoomBounds.minScale, zoomBounds.maxScale, viewW, viewH,
    cameraX, cameraY, springX, springY, springScale, applyScaleImmediate,
  ]);

  // === ZOOM / PAN HANDLERS ===
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (isIntroAnimating) return;
    if (e.cancelable) e.preventDefault();

    const normalized = clamp(-e.deltaY, -120, 120) / 120;
    if (Math.abs(normalized) < ZOOM_EPS) return;

    const currentScale = cameraScale.get();
    const targetScale = currentScale * Math.pow(1.12, normalized);
    applyScaleWithRateLimit(targetScale, performance.now(), 'wheel');
  }, [cameraScale, isIntroAnimating, applyScaleWithRateLimit]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isIntroAnimating) return;
    if (e.touches.length === 2) {
      setIsDragging(false);
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (dist <= 0) return;
      pinchStartDist.current = dist;
      pinchStartScale.current = cameraScale.get();
      lastZoomTsRef.current = performance.now();
    } else if (e.touches.length === 1) {
      setIsDragging(true);
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastTransform.current = { x: cameraX.get(), y: cameraY.get() };
    }
  }, [cameraScale, cameraX, cameraY, isIntroAnimating]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isIntroAnimating) return;
    if (e.touches.length === 2 && pinchStartDist.current && pinchStartDist.current > 0) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (dist <= 0) return;
      const targetScale = pinchStartScale.current * (dist / pinchStartDist.current);
      applyScaleWithRateLimit(targetScale, performance.now(), 'pinch');
    } else if (e.touches.length === 1 && isDragging) {
      const dx = e.touches[0].clientX - dragStart.current.x;
      const dy = e.touches[0].clientY - dragStart.current.y;
      const pan = clampPanToBounds(lastTransform.current.x + dx, lastTransform.current.y + dy, cameraScale.get());
      cameraX.set(pan.x);
      cameraY.set(pan.y);
    }
  }, [isDragging, cameraScale, cameraX, cameraY, isIntroAnimating, applyScaleWithRateLimit, clampPanToBounds]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastTransform.current = { x: cameraX.get(), y: cameraY.get() };
      pinchStartDist.current = null;
      return;
    }

    setIsDragging(false);
    pinchStartDist.current = null;
  }, [cameraX, cameraY]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isIntroAnimating) return;
    if (e.ctrlKey && e.button === 0) {
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      lastTransform.current = { x: cameraX.get(), y: cameraY.get() };
      e.preventDefault();
    }
  }, [cameraX, cameraY, isIntroAnimating]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && !isIntroAnimating) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      const pan = clampPanToBounds(lastTransform.current.x + dx, lastTransform.current.y + dy, cameraScale.get());
      cameraX.set(pan.x);
      cameraY.set(pan.y);
    }
  }, [isDragging, cameraX, cameraY, cameraScale, isIntroAnimating, clampPanToBounds]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  const resetZoom = useCallback(() => {
    if (isIntroAnimating) return;
    cameraX.set(0);
    cameraY.set(0);
    applyScaleImmediate(zoomBounds.fitScale);
  }, [cameraX, cameraY, isIntroAnimating, applyScaleImmediate, zoomBounds.fitScale]);

  const handleZoomIn = useCallback(() => {
    if (isIntroAnimating) return;
    const step = clamp((zoomBounds.maxScale - zoomBounds.minScale) * 0.12, 0.08, 0.25);
    const target = cameraScale.get() + step;
    applyScaleWithRateLimit(target, performance.now(), 'button');
  }, [isIntroAnimating, zoomBounds.maxScale, zoomBounds.minScale, cameraScale, applyScaleWithRateLimit]);

  const handleZoomOut = useCallback(() => {
    if (isIntroAnimating) return;
    const step = clamp((zoomBounds.maxScale - zoomBounds.minScale) * 0.12, 0.08, 0.25);
    const target = cameraScale.get() - step;
    applyScaleWithRateLimit(target, performance.now(), 'button');
  }, [isIntroAnimating, zoomBounds.maxScale, zoomBounds.minScale, cameraScale, applyScaleWithRateLimit]);

  // === КЛИК ПО СТРЕЛКЕ ===
  const handleArrowClick = useCallback((arrowId: string) => {
    if (isIntroAnimating) return;

    const currentState = useGameStore.getState();
    const { arrows: currentArrows, status: currentStatus, gridSize: currentGrid, hintedArrowId: currentHint } = currentState;

    if (currentStatus !== 'playing') return;

    const arrow = currentArrows.find(a => a.id === arrowId);
    if (!arrow) return;

    if (currentHint) clearHint();

    const grid = { width: currentGrid.width, height: currentGrid.height };
    const result = processMove(arrow, currentArrows, grid);

    if (result.defrosted) return;

    if (result.collision) {
      setShakingArrow(arrowId);
      blockArrow(arrowId);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
      setTimeout(() => {
        setShakingArrow(null);
        failMove(arrowId);
      }, ANIMATIONS.arrowError);
    } else {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');

      const idsToRemove: string[] = [arrowId];
      if (result.bombExplosion?.length) {
        for (const exploded of result.bombExplosion) idsToRemove.push(exploded.id);
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('heavy');
      }
      if (result.electricTarget) idsToRemove.push(result.electricTarget.id);

      if (idsToRemove.length === 1) removeArrow(arrowId);
      else removeArrows(idsToRemove);

      // Авто-разблокировка: проверяем blocked стрелки после удаления
      requestAnimationFrame(() => {
        const state = useGameStore.getState();
        const blocked = state.blockedArrowIds;
        if (blocked.length === 0) return;
        const currentArrows = state.arrows;
        const currentGrid = { width: state.gridSize.width, height: state.gridSize.height };
        const toUnblock = blocked.filter(id => {
          const a = currentArrows.find(ar => ar.id === id);
          if (!a) return true; // стрелка удалена — чистим
          return !isArrowBlocked(a, currentArrows, currentGrid);
        });
        if (toUnblock.length > 0) unblockArrows(toUnblock);
      });
    }
  }, [clearHint, setShakingArrow, blockArrow, unblockArrows, failMove, removeArrow, removeArrows, isIntroAnimating]);

  const handleHint = useCallback(() => {
    if (isIntroAnimating) return;
    const { arrows: currentArrows, gridSize: currentGrid, hintsRemaining: hints } = useGameStore.getState();
    if (hints <= 0) return;
    const free = getFreeArrows(currentArrows, { width: currentGrid.width, height: currentGrid.height });
    if (free.length > 0) showHint(free[0].id);
  }, [showHint, isIntroAnimating]);

  const onRestartClick = useCallback(() => { if (!isIntroAnimating) setConfirmAction('restart'); }, [isIntroAnimating]);
  const onMenuClick = useCallback(() => { if (!isIntroAnimating) setConfirmAction('menu'); }, [isIntroAnimating]);
  const confirmRestart = useCallback(() => { setConfirmAction(null); loadLevel(currentLevel); }, [currentLevel, loadLevel]);
  const confirmMenu = useCallback(() => { setConfirmAction(null); setScreen('home'); }, [setScreen]);
  const handleNextLevel = useCallback(() => setCurrentLevel(prev => prev + 1), []);
  const handleDevReset = useCallback(async () => {
    if (!confirm('⚠️ СБРОС ПРОГРЕССА (DEV)')) return;
    try { await gameApi.resetProgress(); setCurrentLevel(1); window.location.reload(); }
    catch (e) { console.error(e); }
  }, []);

  const livesUI = useMemo(() => (
    <div className="flex gap-1.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <motion.div key={i} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.1 }}>
          <Heart size={24} fill={i < lives ? '#ef4444' : 'transparent'} stroke={i < lives ? '#ef4444' : 'rgba(255,255,255,0.3)'} strokeWidth={2} />
        </motion.div>
      ))}
    </div>
  ), [lives]);

  return (
    <div
      className="relative w-full h-screen overflow-hidden font-sans select-none touch-none"
      style={{ backgroundImage: `url(${gameBgImage})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: '#1e3a52' }}
    >
      <div className="relative z-10 flex flex-col h-full mx-auto pointer-events-none">

        {/* HEADER */}
        <div className="flex justify-center items-center p-4 pt-6 safe-area-top gap-4 pointer-events-auto">
          <div className="bg-slate-800/80 backdrop-blur-md px-6 py-2 rounded-2xl border border-white/10 shadow-lg flex items-center gap-2">
            <span className="text-white/60 text-xs font-medium uppercase tracking-wider">Level</span>
            <span className="text-white font-bold text-xl">{currentLevel}</span>
          </div>
          <div className="bg-slate-800/80 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10 shadow-lg">
            {livesUI}
          </div>
          <div className="bg-slate-800/60 px-3 py-1 rounded-xl border border-white/5">
            <span className="text-white/40 text-[10px] font-mono">🖼 Canvas {gridSize.width}×{gridSize.height}</span>
          </div>
        </div>

        {/* GAME AREA — CanvasBoard заполняет весь контейнер */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden relative pointer-events-auto"
          style={{ cursor: isDragging ? 'grabbing' : 'default' }}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {noMoreLevels ? (
            <div className="flex h-full items-center justify-center">
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center bg-slate-900/80 backdrop-blur-xl p-8 rounded-3xl border border-white/20 shadow-2xl max-w-xs">
                  <div className="text-5xl mb-4">🎉</div>
                  <h2 className="text-2xl font-bold text-white mb-2">Скоро новые уровни!</h2>
                  <button onClick={() => setScreen('home')} className="w-full py-3 bg-blue-600 rounded-xl text-white font-bold mt-4">В меню</button>
                </motion.div>
            </div>
          ) : status === 'loading' ? (
            <LevelTransitionLoader level={currentLevel} />
          ) : (
            <CanvasBoard
              key={`canvas-${currentLevel}`}
              arrows={arrows}
              gridSize={gridSize}
              cellSize={baseCellSize}
              hintedArrowId={hintedArrowId}
              onArrowClick={handleArrowClick}
              springX={springX}
              springY={springY}
              springScale={springScale}
            />
          )}

          {/* Zoom Controls */}
          <div className="absolute top-4 right-4 flex flex-col gap-2 z-20">
             <button onClick={handleZoomIn} className="p-2 bg-black/40 rounded-full text-white/70 hover:text-white"><ZoomIn size={20}/></button>
             <button onClick={handleZoomOut} className="p-2 bg-black/40 rounded-full text-white/70 hover:text-white"><ZoomOut size={20}/></button>
             <button onClick={resetZoom} className="p-2 bg-black/40 rounded-full text-white/70 hover:text-white"><Maximize size={20}/></button>
          </div>
        </div>

        {/* FOOTER */}
        <div className="flex flex-col items-center px-4 pb-8 safe-bottom pointer-events-auto bg-gradient-to-t from-slate-900/80 to-transparent pt-4">
          {!noMoreLevels && (
            <div className="flex justify-center items-center gap-3 w-full max-w-sm">
              <motion.button whileTap={{ scale: 0.9 }} onClick={onMenuClick} className="bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-lg"><span className="text-white font-bold text-xs">MENU</span></motion.button>
              <motion.button whileTap={{ scale: 0.9 }} onClick={onRestartClick} className="bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-lg"><RefreshCw size={24} className="text-white" /></motion.button>
              <motion.button whileTap={{ scale: 0.9 }} onClick={handleHint} disabled={hintsRemaining === 0} className="flex-1 bg-gradient-to-br from-amber-600/90 to-orange-600/90 backdrop-blur-md p-4 rounded-2xl border border-amber-500/30 flex items-center justify-center gap-3 shadow-lg"><Lightbulb size={24} className={hintsRemaining > 0 ? 'text-yellow-100' : 'text-white/30'} /><span className="text-white font-bold text-lg">{hintsRemaining}</span></motion.button>
              <motion.button whileTap={{ scale: 0.9 }} onClick={undo} disabled={history.length === 0} className="bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-lg"><RotateCcw size={24} className="text-white" /></motion.button>
            </div>
          )}

          <div className="flex flex-col items-center gap-2 mt-4 opacity-90 transition-opacity w-full">
              <div className="flex items-center gap-2 text-white/50 text-xs uppercase tracking-widest mb-1">Навигация</div>
              <div className="flex items-center gap-3 bg-slate-900/50 p-2 rounded-xl border border-white/10">
                <button onClick={() => setCurrentLevel(l => Math.max(1, l - 1))} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white disabled:opacity-30" disabled={currentLevel <= 1}>←</button>
                {[1, 5, 10, 15, 20].map(lvl => (
                  <button key={lvl} onClick={() => setCurrentLevel(lvl)} className={`px-3 py-1 text-xs rounded-lg font-bold ${currentLevel === lvl ? 'bg-blue-500 text-white' : 'bg-white/5 text-white/60'}`}>{lvl}</button>
                ))}
                <button onClick={() => setCurrentLevel(l => l + 1)} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white">→</button>
                <div className="w-px h-6 bg-white/10 mx-1"></div>
                <button onClick={handleDevReset} className="p-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20"><Trash2 size={16} /></button>
              </div>
          </div>
        </div>
      </div>

      {/* ===== СЛОЙ ЭФФЕКТОВ (fly-out) ===== */}
      <FXOverlay
        containerRef={containerRef}
        gridSize={gridSize}
        cellSize={baseCellSize}
        springX={springX}
        springY={springY}
        springScale={springScale}
        active={true}
      />

      <AnimatePresence>
        {confirmAction && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm pointer-events-auto">
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="w-full max-w-xs bg-slate-900 border border-white/10 rounded-3xl p-6 text-center shadow-2xl">
              <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto mb-4"><AlertTriangle size={32} className="text-yellow-500" /></div>
              <h3 className="text-xl font-bold text-white mb-2">{confirmAction === 'restart' ? 'Начать заново?' : 'Выйти в меню?'}</h3>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setConfirmAction(null)} className="flex-1 py-3 bg-white/5 rounded-xl text-white">Отмена</button>
                <button onClick={confirmAction === 'restart' ? confirmRestart : confirmMenu} className="flex-1 py-3 bg-red-500 rounded-xl text-white font-bold">{confirmAction === 'restart' ? 'Рестарт' : 'Выйти'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(status === 'victory' || status === 'defeat') && !noMoreLevels && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto">
             <motion.div initial={{ scale: 0.8, y: 50 }} animate={{ scale: 1, y: 0 }} transition={{ delay: 0.4 }} className="w-full max-w-sm bg-gradient-to-br from-slate-900/95 to-blue-900/95 backdrop-blur-xl rounded-3xl border border-white/20 shadow-2xl p-8 text-center">
                <h2 className="text-4xl font-black text-white mb-2">{status === 'victory' ? 'Victory!' : 'Game Over'}</h2>
                <div className="space-y-3 mt-6">
                    <button onClick={status === 'victory' ? handleNextLevel : confirmRestart} className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl shadow-lg">{status === 'victory' ? 'Next Level' : 'Retry'}</button>
                    <button onClick={confirmMenu} className="w-full bg-white/10 text-white font-medium py-3 rounded-2xl">Menu</button>
                </div>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
