/**
 * Arrow Puzzle - Game Screen (VIEWPORT CANVAS)
 *
 * ИЗМЕНЕНИЯ:
 * - Убран <motion.div style={{ x, y, scale }}> вокруг доски.
 * - CanvasBoard заполняет весь containerRef, камера внутри ctx.setTransform().
 * - Убран GameBoard (SVG) и useCanvas threshold — всегда Canvas.
 * - cameraX/Y/Scale прокидываются напрямую в CanvasBoard и FXOverlay.
 * - Кинематографичное интро и zoom controls — без изменений.
 *
 * ОПТИМИЗАЦИИ (merged from old):
 * - getHintCameraTarget: globalIndex.getArrow() O(1) вместо arrows.find() O(n)
 * - arrows убран из deps getHintCameraTarget — globalIndex всегда актуален
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useMotionValue, motion } from 'framer-motion';
import { useAppStore, useGameStore } from '../stores/store';
import { CanvasBoard } from '../components/CanvasBoard';
import { gameApi } from '../api/client';
import { MAX_CELL_SIZE, MIN_CELL_SIZE } from '../config/constants';
import { clearFlyFX } from '../game/fxBridge';
import { FXOverlay } from '../components/FXOverlay';
import { LevelTransitionLoader } from '../components/ui/LevelTransitionLoader';
import { GameHUD } from './game-screen/GameHUD';
import { GameMenuModal } from './game-screen/GameMenuModal';
import { GameResultModal } from './game-screen/GameResultModal';
import { useArrowActions } from './game-screen/useArrowActions';
import { globalIndex } from '../game/spatialIndex';

import gameBgImage from '../assets/game-bg.jpg?url';

type ZoomBounds = { minScale: number; maxScale: number; fitScale: number };
type PanBounds = { minX: number; maxX: number; minY: number; maxY: number };

const GRID_PADDING_CELLS = 0.4;
const FIT_MARGIN_RATIO = 0.05;
const ZOOM_OUT_MARGIN_RATIO = 0.10;
const PAN_EDGE_SLACK_RATIO = 0.15;
const MIN_ABS_SCALE = 0.02;
const MIN_VISIBLE_CELLS = 7;
const MAX_ABS_SCALE = 4.0;
const ZOOM_EPS = 0.001;
const INTRO_MIN_DIM_FOR_BLOCK = 10;
const INTRO_INPUT_LOCK_MS = 650;
const INTRO_ZOOM_DELAY_MS = 350;
const HINT_MIN_VISIBLE_CELLS = 12;
const HINT_FOCUS_PADDING_CELLS = 2;
const HINT_FOCUS_BASE_DURATION_MS = 320;
const HINT_FOCUS_MIN_DURATION_MS = 280;
const HINT_FOCUS_MAX_DURATION_MS = 460;
const HINT_REFOCUS_PAN_EPS_PX = 6;
const HINT_REFOCUS_SCALE_EPS = 0.02;
// false: start and stay at fitScale. true: restore delayed intro push-in zoom.
const ENABLE_INTRO_CAMERA_PUSH_IN = false;
const ENABLE_SERVER_PROGRESS_PERSIST = import.meta.env.PROD;
const ENABLE_TEMP_SMART_CONTEXT = true;
// TODO [ВАЖНЫЙ ДО РЕЛИЗА]: удалить временный smart context и вернуть обычный flow сохранения.

function resolveUserCurrentLevel(rawUser: unknown): number {
  if (!rawUser || typeof rawUser !== 'object') return 1;

  const userRecord = rawUser as { currentLevel?: unknown; current_level?: unknown };
  const rawLevel = userRecord.currentLevel ?? userRecord.current_level;
  const parsedLevel = Number(rawLevel);
  if (!Number.isFinite(parsedLevel) || parsedLevel < 1) return 1;
  return Math.floor(parsedLevel);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function computeZoomBounds(
  viewW: number,
  viewH: number,
  gridSize: { width: number; height: number },
  baseCellSize: number,
): ZoomBounds {
  const boardPixelW = (gridSize.width + GRID_PADDING_CELLS) * baseCellSize;
  const boardPixelH = (gridSize.height + GRID_PADDING_CELLS) * baseCellSize;
  const safeW = Math.max(1, viewW * (1 - FIT_MARGIN_RATIO * 2));
  const safeH = Math.max(1, viewH * (1 - FIT_MARGIN_RATIO * 2));

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
  const setUser = useAppStore(s => s.setUser);
  const setScreen = useAppStore(s => s.setScreen);

  const gridSize = useGameStore(s => s.gridSize);
  const gameLevel = useGameStore(s => s.level);
  const arrows = useGameStore(s => s.arrows);
  const lives = useGameStore(s => s.lives);
  const status = useGameStore(s => s.status);
  const hintsRemaining = useGameStore(s => s.hintsRemaining);
  const hintedArrowId = useGameStore(s => s.hintedArrowId);
  const history = useGameStore(s => s.history);
  const removedArrowIds = useGameStore(s => s.removedArrowIds);
  const levelStartTime = useGameStore(s => s.startTime);

  const initLevel = useGameStore(s => s.initLevel);
  const removeArrow = useGameStore(s => s.removeArrow);
  const removeArrows = useGameStore(s => s.removeArrows);
  const failMove = useGameStore(s => s.failMove);
  const undo = useGameStore(s => s.undo);
  const showHint = useGameStore(s => s.showHint);
  const setStatus = useGameStore(s => s.setStatus);
  const setShakingArrow = useGameStore(s => s.setShakingArrow);
  const blockArrow = useGameStore(s => s.blockArrow);
  const unblockArrows = useGameStore(s => s.unblockArrows);

  const [currentLevel, setCurrentLevel] = useState(() =>
    ENABLE_SERVER_PROGRESS_PERSIST ? resolveUserCurrentLevel(user) : 1
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
  });

  // === FRAMER MOTION CAMERA PHYSICS ===
  const cameraX = useMotionValue(0);
  const cameraY = useMotionValue(0);
  const cameraScale = useMotionValue(1);

  const [isDragging, setIsDragging] = useState(false);
  const [isIntroAnimating, setIsIntroAnimating] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const lastTransform = useRef({ x: 0, y: 0 });
  const pinchStartDist = useRef<number | null>(null);
  const pinchLastMidpoint = useRef<{ x: number; y: number } | null>(null);
  const pinchStartScale = useRef(1);
  const lastFocusedHintRef = useRef<string | null>(null);
  const panTweenFrameRef = useRef<number>(0);
  const panTweenTokenRef = useRef(0);
  const hasManualNavigationInSessionRef = useRef(false);
  const completedLevelsSentRef = useRef<Set<number>>(new Set());
  const pendingLevelCompletionRef = useRef<Set<number>>(new Set());
  const hasInitialLevelSyncRef = useRef(false);

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

  const cancelPanTween = useCallback(() => {
    panTweenTokenRef.current += 1;
    if (panTweenFrameRef.current) {
      cancelAnimationFrame(panTweenFrameRef.current);
      panTweenFrameRef.current = 0;
    }
  }, []);

  const applyScaleImmediate = useCallback((targetScale: number) => {
    const boundedScale = clamp(targetScale, zoomBounds.minScale, zoomBounds.maxScale);
    cameraScale.set(boundedScale);
    const pan = clampPanToBounds(cameraX.get(), cameraY.get(), boundedScale);
    cameraX.set(pan.x);
    cameraY.set(pan.y);
  }, [zoomBounds.minScale, zoomBounds.maxScale, cameraScale, cameraX, cameraY, clampPanToBounds]);

  const animateCameraTo = useCallback((targetX: number, targetY: number, targetScale: number, durationMs = 180) => {
    const boundedScale = clamp(targetScale, zoomBounds.minScale, zoomBounds.maxScale);
    const target = clampPanToBounds(targetX, targetY, boundedScale);
    const startScale = cameraScale.get();
    const startPan = clampPanToBounds(cameraX.get(), cameraY.get(), startScale);
    const startX = startPan.x;
    const startY = startPan.y;

    cancelPanTween();

    if (
      durationMs <= 0
      || (
        Math.abs(target.x - startX) < 0.5
        && Math.abs(target.y - startY) < 0.5
        && Math.abs(boundedScale - startScale) < 0.001
      )
    ) {
      cameraScale.set(boundedScale);
      cameraX.set(target.x);
      cameraY.set(target.y);
      return;
    }

    const token = ++panTweenTokenRef.current;
    const startTime = performance.now();

    const tick = (now: number) => {
      if (token !== panTweenTokenRef.current) return;
      const t = Math.min(1, (now - startTime) / durationMs);
      const eased = easeInOutCubic(t);
      const scale = startScale + (boundedScale - startScale) * eased;
      const x = startX + (target.x - startX) * eased;
      const y = startY + (target.y - startY) * eased;
      const clamped = clampPanToBounds(x, y, scale);
      const nextX = Math.abs(clamped.x - x) < 0.01 ? x : clamped.x;
      const nextY = Math.abs(clamped.y - y) < 0.01 ? y : clamped.y;
      cameraScale.set(scale);
      cameraX.set(nextX);
      cameraY.set(nextY);
      if (t < 1) {
        panTweenFrameRef.current = requestAnimationFrame(tick);
      } else {
        cameraScale.set(boundedScale);
        const finalPan = clampPanToBounds(target.x, target.y, boundedScale);
        cameraX.set(finalPan.x);
        cameraY.set(finalPan.y);
        panTweenFrameRef.current = 0;
      }
    };

    panTweenFrameRef.current = requestAnimationFrame(tick);
  }, [zoomBounds.minScale, zoomBounds.maxScale, clampPanToBounds, cameraScale, cameraX, cameraY, cancelPanTween]);

  useEffect(() => {
    applyScaleImmediate(cameraScale.get());
  }, [zoomBounds.minScale, zoomBounds.maxScale, viewW, viewH, applyScaleImmediate, cameraScale]);

  useEffect(() => () => cancelPanTween(), [cancelPanTween]);

  // ⚡ globalIndex.getArrow() O(1) вместо arrows.find() O(n)
  // ⚡ arrows убран из deps — globalIndex всегда актуален
  const getHintCameraTarget = useCallback((arrowId: string) => {
    const arrow = globalIndex.getArrow(arrowId);
    if (!arrow) return null;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < arrow.cells.length; i++) {
      const c = arrow.cells[i];
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }
    if (minX === Infinity || minY === Infinity) return null;

    const hintWidthCells = maxX - minX + 1 + HINT_FOCUS_PADDING_CELLS * 2;
    const hintHeightCells = maxY - minY + 1 + HINT_FOCUS_PADDING_CELLS * 2;
    const minFocusWCells = Math.max(HINT_MIN_VISIBLE_CELLS, hintWidthCells);
    const minFocusHCells = Math.max(HINT_MIN_VISIBLE_CELLS, hintHeightCells);

    const safeW = Math.max(1, viewW * (1 - FIT_MARGIN_RATIO * 2));
    const safeH = Math.max(1, viewH * (1 - FIT_MARGIN_RATIO * 2));
    const hintFocusScale = Math.min(
      safeW / (Math.max(1, minFocusWCells) * baseCellSize),
      safeH / (Math.max(1, minFocusHCells) * baseCellSize),
      zoomBounds.maxScale,
    );
    const currentScale = cameraScale.get();
    const targetScale = clamp(Math.max(currentScale, hintFocusScale), zoomBounds.minScale, zoomBounds.maxScale);

    const targetX = ((minX + maxX + 1) / 2) * baseCellSize;
    const targetY = ((minY + maxY + 1) / 2) * baseCellSize;
    const boardPadding = baseCellSize * (GRID_PADDING_CELLS / 2);
    const totalBoardW = (gridSize.width + GRID_PADDING_CELLS) * baseCellSize;
    const totalBoardH = (gridSize.height + GRID_PADDING_CELLS) * baseCellSize;
    const camX = -targetScale * (targetX - totalBoardW / 2 + boardPadding);
    const camY = -targetScale * (targetY - totalBoardH / 2 + boardPadding);

    return { camX, camY, targetScale };
  }, [
    // ⚡ Убран arrows из deps — globalIndex всегда актуален
    viewW, viewH, baseCellSize, cameraScale, zoomBounds.minScale, zoomBounds.maxScale, gridSize.width, gridSize.height,
  ]);

  const focusHintArrow = useCallback((arrowId: string, force = false): boolean => {
    if (isIntroAnimating) return false;
    const target = getHintCameraTarget(arrowId);
    if (!target) return false;

    const currentX = cameraX.get();
    const currentY = cameraY.get();
    const currentScale = cameraScale.get();
    const panDelta = Math.hypot(target.camX - currentX, target.camY - currentY);
    const scaleDelta = Math.abs(target.targetScale - currentScale);

    const alreadyFocused = panDelta <= HINT_REFOCUS_PAN_EPS_PX && scaleDelta <= HINT_REFOCUS_SCALE_EPS;
    if (alreadyFocused) {
      lastFocusedHintRef.current = arrowId;
      return false;
    }

    if (!force && lastFocusedHintRef.current === arrowId) return false;

    const scaleDeltaPx = scaleDelta * Math.min(viewW, viewH);
    const travel = panDelta + scaleDeltaPx;
    const duration = clamp(
      HINT_FOCUS_BASE_DURATION_MS + travel * 0.12,
      HINT_FOCUS_MIN_DURATION_MS,
      HINT_FOCUS_MAX_DURATION_MS,
    );

    animateCameraTo(target.camX, target.camY, target.targetScale, duration);
    lastFocusedHintRef.current = arrowId;
    return true;
  }, [isIntroAnimating, getHintCameraTarget, animateCameraTo, cameraX, cameraY, cameraScale, viewW, viewH]);

  // === ЗАГРУЗКА УРОВНЯ ===
  const loadLevel = useCallback(async (levelNum: number) => {
    setStatus('loading');
    clearFlyFX();
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

  useEffect(() => {
    if (!ENABLE_SERVER_PROGRESS_PERSIST) return;
    if (hasInitialLevelSyncRef.current) return;
    if (!user) return;

    hasInitialLevelSyncRef.current = true;
    setCurrentLevel(resolveUserCurrentLevel(user));
  }, [user]);

  useEffect(() => {
    if (status !== 'victory') return;
    if (noMoreLevels) return;
    if (!ENABLE_SERVER_PROGRESS_PERSIST) return;
    if (ENABLE_TEMP_SMART_CONTEXT && hasManualNavigationInSessionRef.current) return;
    const completedLevel = gameLevel;
    if (completedLevel < 1) return;
    if (completedLevelsSentRef.current.has(completedLevel)) return;
    if (pendingLevelCompletionRef.current.has(completedLevel)) return;

    const elapsedMs = levelStartTime > 0 ? Date.now() - levelStartTime : 0;
    const timeSeconds = Math.max(1, Math.floor(elapsedMs / 1000));
    pendingLevelCompletionRef.current.add(completedLevel);

    void (async () => {
      try {
        const response = await gameApi.complete({
          level: completedLevel,
          seed: completedLevel,
          moves: removedArrowIds,
          timeSeconds,
        });

        if (!response.valid) {
          pendingLevelCompletionRef.current.delete(completedLevel);
          console.warn(`[Progress] Completion rejected for level ${completedLevel}: ${response.error ?? 'unknown error'}`);
          return;
        }

        completedLevelsSentRef.current.add(completedLevel);
        pendingLevelCompletionRef.current.delete(completedLevel);

        if (response.newLevelUnlocked && user) {
          const nextUnlockedLevel = Math.max(resolveUserCurrentLevel(user), completedLevel + 1);
          const nextUser = {
            ...user,
            currentLevel: nextUnlockedLevel,
          };
          setUser(nextUser);
        }
      } catch (error) {
        pendingLevelCompletionRef.current.delete(completedLevel);
        console.error('[Progress] Failed to persist level completion:', error);
      }
    })();
  }, [status, noMoreLevels, gameLevel, levelStartTime, removedArrowIds, user, setUser]);

  // === КИНЕМАТОГРАФИЧНОЕ ИНТРО ===
  useEffect(() => {
    if (status !== 'playing') return;

    const fitAllScale = zoomBounds.fitScale;
    const safeW = Math.max(1, viewW * (1 - FIT_MARGIN_RATIO * 2));
    const safeH = Math.max(1, viewH * (1 - FIT_MARGIN_RATIO * 2));
    const playScaleRaw = Math.min(safeW / (10 * baseCellSize), safeH / (10 * baseCellSize), 1.5);

    // Масштаб чтобы влез весь уровень
    const playScale = clamp(playScaleRaw, zoomBounds.minScale, zoomBounds.maxScale);
    const shouldUseIntroPushIn = ENABLE_INTRO_CAMERA_PUSH_IN && (gridSize.width > 12 || gridSize.height > 12);
    // Масштаб для комфортной игры (~10x10 ячеек на экране)

    // Жёсткий сброс камеры
    cancelPanTween();
    cameraX.set(0);
    cameraY.set(0);
    cameraScale.set(fitAllScale);
    applyScaleImmediate(fitAllScale);

    const maxGridDim = Math.max(gridSize.width, gridSize.height);
    const shouldLockInputForIntro = maxGridDim >= INTRO_MIN_DIM_FOR_BLOCK;
    setIsIntroAnimating(shouldLockInputForIntro);

    // ⚡ FIX: input lock масштабируется вместе со sweep длительностью
    // Формула идентична CanvasBoard: base + min(dim - threshold, 100) * 5
    const introLockMs = shouldLockInputForIntro
      ? INTRO_INPUT_LOCK_MS + Math.min(maxGridDim - INTRO_MIN_DIM_FOR_BLOCK, 100) * 5
      : INTRO_INPUT_LOCK_MS;

    // Ждём sweep-волну, затем зумим
    const t1 = setTimeout(() => {
      const finalScale = shouldUseIntroPushIn ? playScale : fitAllScale;
      cameraX.set(0);
      cameraY.set(0);
      applyScaleImmediate(finalScale);
    }, shouldLockInputForIntro && shouldUseIntroPushIn ? INTRO_ZOOM_DELAY_MS : 0);

    if (!shouldLockInputForIntro) {
      return () => { clearTimeout(t1); };
    }

    const t2 = setTimeout(() => {
      setIsIntroAnimating(false);
    }, introLockMs);

    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [
    status, gridSize.width, gridSize.height, baseCellSize,
    zoomBounds.fitScale, zoomBounds.minScale, zoomBounds.maxScale, viewW, viewH,
    cameraX, cameraY, cameraScale, applyScaleImmediate, cancelPanTween,
  ]);

  useEffect(() => {
    if (!hintedArrowId) {
      lastFocusedHintRef.current = null;
      return;
    }
    focusHintArrow(hintedArrowId);
  }, [hintedArrowId, focusHintArrow]);

  // === ZOOM / PAN HANDLERS ===
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (isIntroAnimating) return;
    if (e.cancelable) e.preventDefault();
    cancelPanTween();

    const normalized = clamp(-e.deltaY, -120, 120) / 120;
    if (Math.abs(normalized) < ZOOM_EPS) return;

    const currentScale = cameraScale.get();
    const targetScale = currentScale * Math.pow(1.12, normalized);
    applyScaleImmediate(targetScale);
  }, [cameraScale, isIntroAnimating, cancelPanTween, applyScaleImmediate]);

  const getTouchMidpointInContainer = useCallback((
    a: { clientX: number; clientY: number },
    b: { clientX: number; clientY: number },
  ): { x: number; y: number } | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: (a.clientX + b.clientX) / 2 - rect.left,
      y: (a.clientY + b.clientY) / 2 - rect.top,
    };
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isIntroAnimating) return;
    cancelPanTween();

    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist.current = Math.hypot(dx, dy);
      pinchStartScale.current = cameraScale.get();
      pinchLastMidpoint.current = getTouchMidpointInContainer(e.touches[0], e.touches[1]);
      setIsDragging(false);
    } else if (e.touches.length === 1) {
      setIsDragging(true);
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastTransform.current = { x: cameraX.get(), y: cameraY.get() };
    }
  }, [cameraScale, cameraX, cameraY, isIntroAnimating, cancelPanTween, getTouchMidpointInContainer]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isIntroAnimating) return;

    if (e.touches.length === 2 && pinchStartDist.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const rawScale = pinchStartScale.current * (dist / pinchStartDist.current);
      const boundedScale = clamp(rawScale, zoomBounds.minScale, zoomBounds.maxScale);

      const midpoint = getTouchMidpointInContainer(e.touches[0], e.touches[1]);
      if (!midpoint || !pinchLastMidpoint.current) {
        applyScaleImmediate(boundedScale);
        return;
      }

      const prevMidDx = pinchLastMidpoint.current.x - viewW / 2;
      const prevMidDy = pinchLastMidpoint.current.y - viewH / 2;
      const prevX = cameraX.get();
      const prevY = cameraY.get();
      const safePrevScale = Math.max(cameraScale.get(), 0.001);

      const currentMidDx = midpoint.x - viewW / 2;
      const currentMidDy = midpoint.y - viewH / 2;

      const nextX = currentMidDx - ((prevMidDx - prevX) / safePrevScale) * boundedScale;
      const nextY = currentMidDy - ((prevMidDy - prevY) / safePrevScale) * boundedScale;
      const pan = clampPanToBounds(nextX, nextY, boundedScale);

      cameraScale.set(boundedScale);
      cameraX.set(pan.x);
      cameraY.set(pan.y);
      pinchLastMidpoint.current = midpoint;
    } else if (e.touches.length === 1 && isDragging) {
      const dx = e.touches[0].clientX - dragStart.current.x;
      const dy = e.touches[0].clientY - dragStart.current.y;
      const pan = clampPanToBounds(lastTransform.current.x + dx, lastTransform.current.y + dy, cameraScale.get());
      cameraX.set(pan.x);
      cameraY.set(pan.y);
    }
  }, [
    isDragging,
    cameraScale,
    cameraX,
    cameraY,
    isIntroAnimating,
    applyScaleImmediate,
    clampPanToBounds,
    getTouchMidpointInContainer,
    zoomBounds.minScale,
    zoomBounds.maxScale,
    viewW,
    viewH,
  ]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastTransform.current = { x: cameraX.get(), y: cameraY.get() };
      pinchStartDist.current = null;
      pinchLastMidpoint.current = null;
      return;
    }

    setIsDragging(false);
    pinchStartDist.current = null;
    pinchLastMidpoint.current = null;
  }, [cameraX, cameraY]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isIntroAnimating) return;
    if (e.ctrlKey && e.button === 0) {
      cancelPanTween();
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      lastTransform.current = { x: cameraX.get(), y: cameraY.get() };
      e.preventDefault();
    }
  }, [cameraX, cameraY, isIntroAnimating, cancelPanTween]);

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
    animateCameraTo(0, 0, zoomBounds.fitScale, 180);
  }, [isIntroAnimating, zoomBounds.fitScale, animateCameraTo]);

  const handleZoomIn = useCallback(() => {
    if (isIntroAnimating) return;
    cancelPanTween();
    const step = clamp((zoomBounds.maxScale - zoomBounds.minScale) * 0.12, 0.08, 0.25);
    const target = cameraScale.get() + step;
    applyScaleImmediate(target);
  }, [isIntroAnimating, zoomBounds.maxScale, zoomBounds.minScale, cameraScale, cancelPanTween, applyScaleImmediate]);

  const handleZoomOut = useCallback(() => {
    if (isIntroAnimating) return;
    cancelPanTween();
    const step = clamp((zoomBounds.maxScale - zoomBounds.minScale) * 0.12, 0.08, 0.25);
    const target = cameraScale.get() - step;
    applyScaleImmediate(target);
  }, [isIntroAnimating, zoomBounds.maxScale, zoomBounds.minScale, cameraScale, cancelPanTween, applyScaleImmediate]);

  // === КЛИК ПО СТРЕЛКЕ ===
  const { handleArrowClick, handleHint } = useArrowActions({
    isIntroAnimating,
    baseCellSize,
    cameraScale,
    focusHintArrow,
    setShakingArrow,
    blockArrow,
    unblockArrows,
    failMove,
    removeArrow,
    removeArrows,
    showHint,
  });

  const onRestartClick = useCallback(() => { if (!isIntroAnimating) setConfirmAction('restart'); }, [isIntroAnimating]);
  const onMenuClick = useCallback(() => { if (!isIntroAnimating) setConfirmAction('menu'); }, [isIntroAnimating]);
  const confirmRestart = useCallback(() => { setConfirmAction(null); loadLevel(currentLevel); }, [currentLevel, loadLevel]);
  const confirmMenu = useCallback(() => { setConfirmAction(null); setScreen('home'); }, [setScreen]);
  const handleNextLevel = useCallback(() => setCurrentLevel(prev => prev + 1), []);
  const markManualNavigation = useCallback(() => {
    if (!ENABLE_TEMP_SMART_CONTEXT) return;
    hasManualNavigationInSessionRef.current = true;
  }, []);
  const handlePrevLevel = useCallback(() => {
    markManualNavigation();
    setCurrentLevel((l) => Math.max(1, l - 1));
  }, [markManualNavigation]);
  const handleJumpLevel = useCallback((lvl: number) => {
    markManualNavigation();
    setCurrentLevel(Math.max(1, lvl));
  }, [markManualNavigation]);
  const handleHudNextLevelClick = useCallback(() => {
    markManualNavigation();
    setCurrentLevel((l) => l + 1);
  }, [markManualNavigation]);
  const handleDevReset = useCallback(async () => {
    if (!confirm('⚠️ СБРОС ПРОГРЕССА (DEV)')) return;
    try { await gameApi.resetProgress(); setCurrentLevel(1); window.location.reload(); }
    catch (e) { console.error(e); }
  }, []);

  return (
    <div
      className="relative w-full h-full overflow-hidden font-sans select-none touch-none"
      style={{ backgroundImage: `url(${gameBgImage})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: '#1e3a52' }}
    >
      <GameHUD
        currentLevel={currentLevel}
        lives={lives}
        gridSize={gridSize}
        noMoreLevels={noMoreLevels}
        hintsRemaining={hintsRemaining}
        canUndo={history.length > 0}
        onMenuClick={onMenuClick}
        onRestartClick={onRestartClick}
        onHintClick={handleHint}
        onUndoClick={undo}
        onPrevLevel={handlePrevLevel}
        onJumpLevel={handleJumpLevel}
        onNextLevelClick={handleHudNextLevelClick}
        onDevReset={handleDevReset}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={resetZoom}
      >
        <div
          ref={containerRef}
          className="h-full overflow-hidden relative pointer-events-auto"
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
              springX={cameraX}
              springY={cameraY}
              springScale={cameraScale}
            />
          )}
        </div>
      </GameHUD>

      {/* ===== СЛОЙ ЭФФЕКТОВ (fly-out) ===== */}
      <FXOverlay
        containerRef={containerRef}
        gridSize={gridSize}
        cellSize={baseCellSize}
        springX={cameraX}
        springY={cameraY}
        springScale={cameraScale}
        active={true}
      />

      <GameMenuModal
        action={confirmAction}
        onCancel={() => setConfirmAction(null)}
        onConfirmRestart={confirmRestart}
        onConfirmMenu={confirmMenu}
      />

      <GameResultModal
        status={status}
        noMoreLevels={noMoreLevels}
        onNextLevel={handleNextLevel}
        onRetry={confirmRestart}
        onMenu={confirmMenu}
      />
    </div>
  );
}
