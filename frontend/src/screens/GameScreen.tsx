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
import { adsApi, gameApi, sendAuthorizedKeepalive, type CompleteAndNextResponse } from '../api/client';
import { isValidInterstitialBlockId, isValidRewardedBlockId, showInterstitialAd } from '../services/adsgram';
import {
  PENDING_RETRY_TIMEOUT_MS,
  getRewardedFlowMessage,
  pollRewardIntent,
  runRewardedFlow,
} from '../services/rewardedAds';
import {
  API_ENDPOINTS,
  MAX_CELL_SIZE,
  MIN_CELL_SIZE,
  ADS_ENABLED,
  ADSGRAM_BLOCK_IDS,
  ADS_FIRST_ELIGIBLE_LEVEL,
} from '../config/constants';
import { clearFlyFX } from '../game/fxBridge';
import { FXOverlay } from '../components/FXOverlay';
import { LevelTransitionLoader } from '../components/ui/LevelTransitionLoader';
import { GameHUD } from './game-screen/GameHUD';
import { getDifficultyTier, getLivesForDifficulty } from './game-screen/difficultyConfig';
import { ErrorVignette } from './game-screen/ErrorVignette';
import { GameMenuModal } from './game-screen/GameMenuModal';
import { HintEmptyModal } from './game-screen/HintEmptyModal';
import { GameResultModal } from './game-screen/GameResultModal';
import type { ReviveStatusResponse } from '../game/types';
import type { NextButtonState, PendingVictoryAction } from './game-screen/VictoryScreen';
import { useArrowActions } from './game-screen/useArrowActions';
import { getFreeArrows } from '../game/engine';
import { globalIndex } from '../game/spatialIndex';
import { useIOSGameFieldSelectionGuard } from '../hooks/useIOSGameFieldSelectionGuard';

import gameBgImage from '../assets/game-bg.webp?url';

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
// Server progression must stay enabled in all envs, because backend is authoritative.
const ENABLE_SERVER_PROGRESS_PERSIST = true;
const ENABLE_GAME_DEVTOOLS = import.meta.env.DEV;
const DEV_LEVEL_PRESETS = [35, 36, 37, 38] as const;

function createClientId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

type VictorySaveState = 'idle' | 'saving' | 'saved' | 'error';
type VictoryNavigationState = 'idle' | 'loading_next';
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

interface GameDevPanelProps {
  currentLevel: number;
  gameLevel: number;
  status: string;
  gridSize: { width: number; height: number };
  arrowsCount: number;
  noMoreLevels: boolean;
  isAutoSolving: boolean;
  onJumpToLevel: (level: number) => void;
  onStepLevel: (delta: number) => void;
  onReloadLevel: () => void;
  onAutoSolve: () => void;
}

function GameDevPanel({
  currentLevel,
  gameLevel,
  status,
  gridSize,
  arrowsCount,
  noMoreLevels,
  isAutoSolving,
  onJumpToLevel,
  onStepLevel,
  onReloadLevel,
  onAutoSolve,
}: GameDevPanelProps) {
  const [inputValue, setInputValue] = useState(() => String(currentLevel));
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    setInputValue(String(currentLevel));
  }, [currentLevel]);

  const submitJump = useCallback(() => {
    const nextLevel = Number(inputValue);
    if (!Number.isFinite(nextLevel)) return;
    onJumpToLevel(nextLevel);
  }, [inputValue, onJumpToLevel]);

  return (
    <div
      className="absolute right-3 z-[120] w-[min(280px,calc(100vw-24px))] text-white pointer-events-auto"
      style={{ top: 'calc(max(env(safe-area-inset-top), 12px) + 12px)' }}
    >
      <div className="flex justify-end">
        <button
          onClick={() => setIsExpanded((value) => !value)}
          className="flex items-center gap-2 rounded-2xl border border-amber-400/35 bg-slate-950/92 px-3 py-2 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur-md transition hover:bg-slate-900/95"
        >
          <span className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-300/85">Dev</span>
          <span className="text-sm font-bold leading-none">Tools</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-bold tabular-nums text-white/70">
            {currentLevel}
          </span>
          <span className="text-xs font-black text-white/70">{isExpanded ? '−' : '+'}</span>
        </button>
      </div>

      {isExpanded && (
        <div className="mt-2 rounded-2xl border border-amber-400/30 bg-slate-950/88 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur-md">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold leading-none">Level Tools</div>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-bold tabular-nums text-white/70">
              UI {currentLevel} / Store {gameLevel}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-5 gap-2">
            <button onClick={() => onStepLevel(-5)} className="rounded-xl bg-white/8 px-2 py-2 text-sm font-bold transition hover:bg-white/14">-5</button>
            <button onClick={() => onStepLevel(-1)} className="rounded-xl bg-white/8 px-2 py-2 text-sm font-bold transition hover:bg-white/14">-1</button>
            <button onClick={onReloadLevel} className="rounded-xl bg-amber-500/15 px-2 py-2 text-sm font-bold text-amber-200 transition hover:bg-amber-500/25">Reload</button>
            <button onClick={() => onStepLevel(1)} className="rounded-xl bg-white/8 px-2 py-2 text-sm font-bold transition hover:bg-white/14">+1</button>
            <button onClick={() => onStepLevel(5)} className="rounded-xl bg-white/8 px-2 py-2 text-sm font-bold transition hover:bg-white/14">+5</button>
          </div>

          <button
            onClick={onAutoSolve}
            className={`mt-2 w-full rounded-xl px-3 py-2 text-sm font-bold transition ${
              isAutoSolving
                ? 'bg-rose-500/20 text-rose-100 hover:bg-rose-500/30'
                : 'bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30'
            }`}
          >
            {isAutoSolving ? 'Stop Auto Solve' : 'Auto Solve'}
          </button>

          <div className="mt-2 grid grid-cols-4 gap-2">
            {DEV_LEVEL_PRESETS.map((level) => (
              <button
                key={level}
                onClick={() => onJumpToLevel(level)}
                className={`rounded-xl px-2 py-2 text-sm font-bold transition ${
                  level === currentLevel
                    ? 'bg-cyan-500/25 text-cyan-100'
                    : 'bg-white/8 text-white/85 hover:bg-white/14'
                }`}
              >
                {level}
              </button>
            ))}
          </div>

          <div className="mt-2 flex gap-2">
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value.replace(/[^\d]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitJump();
                }
              }}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm font-semibold text-white outline-none placeholder:text-white/25"
              placeholder="Level"
            />
            <button
              onClick={submitJump}
              className="rounded-xl bg-cyan-500/20 px-3 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-500/30"
            >
              Go
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-medium text-white/60">
            <div>Status: <span className="text-white/85">{status}</span></div>
            <div>Arrows: <span className="text-white/85">{arrowsCount}</span></div>
            <div>Grid: <span className="text-white/85">{gridSize.width}x{gridSize.height}</span></div>
            <div>End: <span className="text-white/85">{noMoreLevels ? 'yes' : 'no'}</span></div>
          </div>
        </div>
      )}
    </div>
  );
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
  const hintBalance = useAppStore(s => s.user?.hintBalance ?? 0);
  const hintedArrowId = useGameStore(s => s.hintedArrowId);
  const removedArrowIds = useGameStore(s => s.removedArrowIds);
  const levelStartTime = useGameStore(s => s.startTime);
  const levelEndTime = useGameStore(s => s.endTime);

  const initLevel = useGameStore(s => s.initLevel);
  const removeArrow = useGameStore(s => s.removeArrow);
  const removeArrows = useGameStore(s => s.removeArrows);
  const failMove = useGameStore(s => s.failMove);
  const showHint = useGameStore(s => s.showHint);
  const setStatus = useGameStore(s => s.setStatus);
  const triggerLifeHit = useGameStore(s => s.triggerLifeHit);
  const setShakingArrow = useGameStore(s => s.setShakingArrow);
  const blockArrow = useGameStore(s => s.blockArrow);
  const unblockArrows = useGameStore(s => s.unblockArrows);
  const lastInterstitialAt = useGameStore(s => s.lastInterstitialAt);
  const setLastInterstitial = useGameStore(s => s.setLastInterstitial);

  const [currentLevel, setCurrentLevel] = useState(() =>
    ENABLE_SERVER_PROGRESS_PERSIST ? resolveUserCurrentLevel(user) : 1
  );
  const containerRef = useRef<HTMLDivElement>(null);
  useIOSGameFieldSelectionGuard({ targetRef: containerRef, enabled: true });
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
  const autoSolveTimerRef = useRef<number | null>(null);
  const completedLevelsSentRef = useRef<Set<number>>(new Set());
  const hasInitialLevelSyncRef = useRef(false);
  const saveStartedLevelRef = useRef<number | null>(null);
  const saveResolvedLevelRef = useRef<number | null>(null);
  const savedNextLevelRef = useRef<number | null>(null);
  const nextLevelExistsRef = useRef(true);
  const pendingVictoryActionRef = useRef<PendingVictoryAction>(null);
  const prefetchedNextLevelRef = useRef<CompleteAndNextResponse['nextLevel']>(null);

  const [confirmAction, setConfirmAction] = useState<'restart' | 'menu' | 'unsaved_menu' | null>(null);
  const [showHintModal, setShowHintModal] = useState(false);
  const [noMoreLevels, setNoMoreLevels] = useState(false);
  const [isAutoSolving, setIsAutoSolving] = useState(false);
  const [levelDifficulty, setLevelDifficulty] = useState<string | number>(1);
  const [victoryCoinsEarned, setVictoryCoinsEarned] = useState<number | undefined>(undefined);
  const [victoryTotalCoins, setVictoryTotalCoins] = useState<number | undefined>(undefined);
  const [saveState, setSaveState] = useState<VictorySaveState>('idle');
  const [navigationState, setNavigationState] = useState<VictoryNavigationState>('idle');
  const [pendingVictoryAction, setPendingVictoryAction] = useState<PendingVictoryAction>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Revive
  const reviveOpportunityIdRef = useRef(createClientId());
  const previousStatusRef = useRef(status);
  const [reviveLoading, setReviveLoading] = useState(false);
  const [reviveMessage, setReviveMessage] = useState<string | null>(null);
  const [pendingReviveIntentId, setPendingReviveIntentId] = useState<string | null>(null);
  const [reviveQuota, setReviveQuota] = useState<ReviveStatusResponse | null>(null);
  const revivePending = pendingReviveIntentId !== null;
  const reviveAvailable = currentLevel >= ADS_FIRST_ELIGIBLE_LEVEL
    && ADS_ENABLED
    && isValidRewardedBlockId(ADSGRAM_BLOCK_IDS.rewardRevive)
    && (revivePending || reviveQuota === null || reviveQuota.remaining > 0);

  const getElapsedSeconds = useCallback(() => {
    if (levelStartTime <= 0) return 1;
    const finishAt = levelEndTime > 0 ? levelEndTime : Date.now();
    const elapsedMs = Math.max(0, finishAt - levelStartTime);
    return Math.max(1, Math.floor(elapsedMs / 1000));
  }, [levelStartTime, levelEndTime]);

  const resultTimeSeconds = useMemo(
    () => (status === 'victory' ? getElapsedSeconds() : 1),
    [status, getElapsedSeconds],
  );

  const nextButtonState = useMemo<NextButtonState>(() => {
    if (navigationState === 'loading_next') return 'loading';
    if (saveState === 'saving') return 'saving';
    if (saveState === 'error') return 'error';
    return 'idle';
  }, [navigationState, saveState]);

  const loadReviveStatus = useCallback(async (level: number) => {
    try {
      const nextStatus = await adsApi.getReviveStatus(level);
      setReviveQuota(nextStatus);
      return nextStatus;
    } catch {
      setReviveQuota(null);
      return null;
    }
  }, []);

  const applyReviveQuotaFromStatus = useCallback((rewardStatus?: {
    revivesUsed?: number;
    revivesLimit?: number;
  }) => {
    if (rewardStatus?.revivesUsed == null || rewardStatus.revivesLimit == null) {
      return false;
    }

    setReviveQuota({
      eligible: true,
      level: currentLevel,
      used: rewardStatus.revivesUsed,
      limit: rewardStatus.revivesLimit,
      remaining: Math.max(0, rewardStatus.revivesLimit - rewardStatus.revivesUsed),
    });
    return true;
  }, [currentLevel]);

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

  const cancelAutoSolve = useCallback(() => {
    if (autoSolveTimerRef.current != null) {
      window.clearTimeout(autoSolveTimerRef.current);
      autoSolveTimerRef.current = null;
    }
    setIsAutoSolving(false);
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
    cancelAutoSolve();
    setStatus('loading');
    clearFlyFX();
    setNoMoreLevels(false);
    setVictoryCoinsEarned(undefined);
    setVictoryTotalCoins(undefined);
    setSaveState('idle');
    setNavigationState('idle');
    setPendingVictoryAction(null);
    setSaveError(null);
    pendingVictoryActionRef.current = null;
    saveStartedLevelRef.current = null;
    saveResolvedLevelRef.current = null;
    savedNextLevelRef.current = null;
    nextLevelExistsRef.current = true;
    // Reset revive for new level
    setReviveLoading(false);
    setReviveMessage(null);
    setPendingReviveIntentId(null);
    setReviveQuota(null);
    reviveOpportunityIdRef.current = createClientId();

    const prefetched = prefetchedNextLevelRef.current;
    prefetchedNextLevelRef.current = null;

    if (prefetched && prefetched.level === levelNum) {
      const diff = prefetched.meta?.difficulty ?? 1;
      setLevelDifficulty(diff);
      const livesForLevel = getLivesForDifficulty(diff);
      initLevel(levelNum, prefetched.seed, prefetched.grid, prefetched.arrows, livesForLevel);
      return;
    }

    try {
      const levelData = await gameApi.getLevel(levelNum);
      const diff = levelData.meta?.difficulty ?? 1;
      setLevelDifficulty(diff);
      const livesForLevel = getLivesForDifficulty(diff);
      initLevel(levelNum, levelData.seed, levelData.grid, levelData.arrows, livesForLevel);
    } catch (error: any) {
      console.error(error);
      if (error?.status === 404) { setNoMoreLevels(true); setStatus('victory'); }
      else if (error?.status === 403) { alert(`🔒 Уровень ${levelNum} закрыт!`); setScreen('home'); }
      else { alert(`❌ Ошибка загрузки уровня ${levelNum}`); setScreen('home'); }
    }
  }, [cancelAutoSolve, initLevel, setStatus, setScreen]);

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
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;

    if (status !== 'defeat' || previousStatus === 'defeat') {
      return;
    }

    reviveOpportunityIdRef.current = createClientId();
    setReviveMessage(null);

    if (!pendingReviveIntentId) {
      void loadReviveStatus(currentLevel).then((nextStatus) => {
        if (nextStatus && nextStatus.remaining <= 0) {
          setReviveMessage('Лимит воскрешений на этом уровне исчерпан');
        }
      });
    }
  }, [currentLevel, loadReviveStatus, pendingReviveIntentId, status]);

  const setVictoryAction = useCallback((action: PendingVictoryAction) => {
    pendingVictoryActionRef.current = action;
    setPendingVictoryAction(action);
  }, []);

  const clearVictoryAction = useCallback(() => {
    pendingVictoryActionRef.current = null;
    setPendingVictoryAction(null);
  }, []);

  const navigateToSavedNextLevel = useCallback((targetLevel?: number) => {
    if (status !== 'victory') return;

    const nextLevel = targetLevel ?? savedNextLevelRef.current ?? (gameLevel + 1);
    setNavigationState('loading_next');

    window.setTimeout(() => {
      if (!nextLevelExistsRef.current) {
        clearVictoryAction();
        setNavigationState('idle');
        setNoMoreLevels(true);
        return;
      }

      clearVictoryAction();
      setCurrentLevel(nextLevel);
    }, 200);
  }, [clearVictoryAction, gameLevel, status]);

  const maybeShowInterstitialForVictory = useCallback((completedLevel: number, difficulty: string | number, timeSeconds: number) => {
    if (completedLevel < ADS_FIRST_ELIGIBLE_LEVEL || !ADS_ENABLED) return;

    const tier = getDifficultyTier(difficulty);
    const now = Date.now();
    const gap = now - lastInterstitialAt;
    let blockId = '';

    if (tier === 'easy' || tier === 'normal') {
      if (completedLevel < 25) return;
      if (completedLevel % 5 !== 0) return;
      if (timeSeconds < 20) return;
      if (gap < 90_000) return;
      blockId = ADSGRAM_BLOCK_IDS.interstitialProgress;
    } else {
      if (timeSeconds < 35) return;
      if (gap < 120_000) return;
      blockId = ADSGRAM_BLOCK_IDS.interstitialHard;
    }

    if (!isValidInterstitialBlockId(blockId)) return;

    void showInterstitialAd(blockId).then((result) => {
      if (result.success) {
        setLastInterstitial(now, completedLevel);
      }
    }).catch(() => {
      // Ignore interstitial failures: gameplay must not be blocked.
    });
  }, [lastInterstitialAt, setLastInterstitial]);

  const proceedToNextLevelWithInterstitial = useCallback((targetLevel: number, completedLevel: number) => {
    if (navigationState === 'loading_next') return;
    maybeShowInterstitialForVictory(completedLevel, levelDifficulty, getElapsedSeconds());
    navigateToSavedNextLevel(targetLevel);
  }, [getElapsedSeconds, levelDifficulty, maybeShowInterstitialForVictory, navigateToSavedNextLevel, navigationState]);

  const applyCompletionSuccess = useCallback((result: CompleteAndNextResponse, completedLevel: number) => {
    const { completion, nextLevel, nextLevelExists } = result;
    const pendingAction = pendingVictoryActionRef.current;

    completedLevelsSentRef.current.add(completedLevel);
    saveResolvedLevelRef.current = completedLevel;
    savedNextLevelRef.current = completion.currentLevel;
    nextLevelExistsRef.current = nextLevelExists;
    prefetchedNextLevelRef.current = nextLevel && nextLevel.level === completion.currentLevel ? nextLevel : null;

    setVictoryCoinsEarned(completion.coinsEarned);
    const nextCoinsTotal = completion.totalCoins ?? ((user?.coins ?? 0) + completion.coinsEarned);
    setVictoryTotalCoins(nextCoinsTotal);

    if (user) {
      setUser({
        ...user,
        currentLevel: completion.currentLevel,
        coins: nextCoinsTotal,
      });
    }

    setSaveState('saved');
    setSaveError(null);
    setNavigationState('idle');
    setConfirmAction(null);

    if (pendingAction === 'menu') {
      clearVictoryAction();
      setScreen('home');
      return;
    }

    if (pendingAction === 'next') {
      proceedToNextLevelWithInterstitial(completion.currentLevel, completedLevel);
    }
  }, [clearVictoryAction, proceedToNextLevelWithInterstitial, setScreen, setUser, user]);

  const startVictorySave = useCallback(async (completedLevel: number, force = false) => {
    if (status !== 'victory' || noMoreLevels) return;

    if (!ENABLE_SERVER_PROGRESS_PERSIST) {
      completedLevelsSentRef.current.add(completedLevel);
      saveResolvedLevelRef.current = completedLevel;
      savedNextLevelRef.current = completedLevel + 1;
      nextLevelExistsRef.current = true;
      setSaveState('saved');
      setSaveError(null);
      return;
    }

    if (!force) {
      if (completedLevelsSentRef.current.has(completedLevel)) return;
      if (saveStartedLevelRef.current === completedLevel) return;
      if (saveResolvedLevelRef.current === completedLevel) return;
    } else if (saveState === 'saving' && saveStartedLevelRef.current === completedLevel) {
      return;
    }

    saveStartedLevelRef.current = completedLevel;
    saveResolvedLevelRef.current = null;
    setSaveState('saving');
    setNavigationState('idle');
    setSaveError(null);
    setConfirmAction(null);

    try {
      const result = await gameApi.completeAndNext({
        level: completedLevel,
        seed: completedLevel,
        moves: removedArrowIds,
        timeSeconds: getElapsedSeconds(),
      });

      if (!result.completion.valid) {
        saveResolvedLevelRef.current = completedLevel;
        setSaveState('error');
        setSaveError(result.completion.error ?? 'Решение не принято сервером');
        return;
      }

      applyCompletionSuccess(result, completedLevel);
    } catch (error: any) {
      console.error('[startVictorySave] Failed:', error);
      saveResolvedLevelRef.current = completedLevel;
      setSaveState('error');

      if (typeof error?.message === 'string') {
        const message = error.message.toLowerCase();
        if (message.includes('fetch') || message.includes('network')) {
          setSaveError('Нет соединения. Проверьте интернет.');
          return;
        }
      }

      if (typeof error?.status === 'number' && error.status >= 500) {
        setSaveError('Ошибка сервера. Попробуйте ещё раз.');
        return;
      }

      setSaveError(error?.message ?? 'Не удалось сохранить прогресс');
    }
  }, [
    applyCompletionSuccess,
    getElapsedSeconds,
    noMoreLevels,
    removedArrowIds,
    saveState,
    status,
  ]);

  useEffect(() => {
    if (!ENABLE_SERVER_PROGRESS_PERSIST) return;
    if (status !== 'victory' || noMoreLevels) return;
    if (completedLevelsSentRef.current.has(gameLevel)) return;
    if (saveStartedLevelRef.current === gameLevel) return;
    if (saveResolvedLevelRef.current === gameLevel) return;

    void startVictorySave(gameLevel);
  }, [gameLevel, noMoreLevels, startVictorySave, status]);

  useEffect(() => {
    if (!ENABLE_SERVER_PROGRESS_PERSIST) return;
    if (status !== 'victory' || noMoreLevels) return;
    if (saveState !== 'saving') return;

    const handler = () => {
      sendAuthorizedKeepalive(API_ENDPOINTS.game.complete, {
        level: gameLevel,
        seed: gameLevel,
        moves: removedArrowIds,
        time_seconds: getElapsedSeconds(),
      });
    };

    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  }, [gameLevel, getElapsedSeconds, noMoreLevels, removedArrowIds, saveState, status]);

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
  // === КЛИК ПО СТРЕЛКЕ ===
  const { handleArrowClick } = useArrowActions({
    isIntroAnimating,
    baseCellSize,
    cameraScale,
    focusHintArrow,
    triggerLifeHit,
    setShakingArrow,
    blockArrow,
    unblockArrows,
    failMove,
    removeArrow,
    removeArrows,
    showHint,
  });

  // === ПОДСКАЗКА (server-side balance) ===
  const onHintClick = useCallback(async () => {
    if (isIntroAnimating) return;
    const { hintedArrowId: currentHinted, arrows: currentArrows, seed: currentSeed } = useGameStore.getState();

    // Re-focus existing hint
    if (currentHinted && currentArrows.some(a => a.id === currentHinted)) {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
      focusHintArrow(currentHinted, true);
      return;
    }

    // Check balance client-side first
    const balance = useAppStore.getState().user?.hintBalance ?? 0;
    if (balance <= 0) {
      setShowHintModal(true);
      return;
    }

    // Call API — server decrements balance & returns arrow to hint
    try {
      const remainingIds = currentArrows.map(a => a.id);
      const result = await gameApi.getHint(currentLevel, currentSeed, remainingIds);
      useAppStore.getState().updateUser({ hintBalance: result.hintBalance });
      if (result.arrowId) {
        showHint(result.arrowId);
        focusHintArrow(result.arrowId);
      }
    } catch (err: unknown) {
      // 409 = no hints available (race condition)
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 409) {
        setShowHintModal(true);
      }
    }
  }, [isIntroAnimating, focusHintArrow, showHint, currentLevel]);

  const handleAutoSolve = useCallback(() => {
    if (isAutoSolving) {
      cancelAutoSolve();
      return;
    }

    const step = () => {
      const state = useGameStore.getState();
      if (state.status !== 'playing') {
        cancelAutoSolve();
        return;
      }

      const free = getFreeArrows(state.arrows, {
        width: state.gridSize.width,
        height: state.gridSize.height,
      });

      if (free.length === 0) {
        cancelAutoSolve();
        return;
      }

      handleArrowClick(free[0].id);
      autoSolveTimerRef.current = window.setTimeout(step, 90);
    };

    setIsAutoSolving(true);
    step();
  }, [cancelAutoSolve, handleArrowClick, isAutoSolving]);

  useEffect(() => {
    if (status === 'playing') return;
    cancelAutoSolve();
  }, [cancelAutoSolve, status]);

  useEffect(() => cancelAutoSolve, [cancelAutoSolve]);

  const onMenuClick = useCallback(() => { if (!isIntroAnimating) setConfirmAction('menu'); }, [isIntroAnimating]);
  const jumpToLevel = useCallback((level: number) => {
    const nextLevel = Math.max(1, Math.floor(level));
    clearVictoryAction();
    setConfirmAction(null);
    setCurrentLevel(nextLevel);
  }, [clearVictoryAction]);
  const stepLevel = useCallback((delta: number) => {
    jumpToLevel(currentLevel + delta);
  }, [currentLevel, jumpToLevel]);
  const reloadCurrentLevel = useCallback(() => {
    clearVictoryAction();
    setConfirmAction(null);
    loadLevel(currentLevel);
  }, [clearVictoryAction, currentLevel, loadLevel]);
  const confirmRestart = useCallback(() => {
    reloadCurrentLevel();
  }, [reloadCurrentLevel]);
  const confirmMenu = useCallback(() => { setConfirmAction(null); setScreen('home'); }, [setScreen]);

  // === REVIVE через рекламу ===
  const handleRevive = useCallback(async () => {
    if (reviveLoading) return;
    setReviveLoading(true);
    setReviveMessage(null);
    try {
      const result = pendingReviveIntentId
        ? await pollRewardIntent(pendingReviveIntentId, PENDING_RETRY_TIMEOUT_MS)
        : await runRewardedFlow(ADSGRAM_BLOCK_IDS.rewardRevive, {
            placement: 'reward_revive',
            level: currentLevel,
            sessionId: reviveOpportunityIdRef.current,
          });
      if (result.outcome === 'granted') {
        useGameStore.getState().revivePlayer();
        setPendingReviveIntentId(null);
        setReviveMessage(null);
        if (!applyReviveQuotaFromStatus(result.status)) {
          await loadReviveStatus(currentLevel);
        }
        return;
      }
      if (result.outcome === 'timeout') {
        setPendingReviveIntentId(result.intentId);
        setReviveMessage(getRewardedFlowMessage('reward_revive', result));
        return;
      }
      if (result.outcome === 'ad_failed') {
        setPendingReviveIntentId(null);
        setReviveMessage(getRewardedFlowMessage('reward_revive', result));
        return;
      }
      if (result.outcome === 'error') {
        setPendingReviveIntentId(result.intentId);
        setReviveMessage(getRewardedFlowMessage('reward_revive', result));
        return;
      }
      setPendingReviveIntentId(null);
      if (result.failureCode === 'REVIVE_ALREADY_USED' && useGameStore.getState().status === 'defeat') {
        useGameStore.getState().revivePlayer();
        setReviveMessage(null);
        if (!applyReviveQuotaFromStatus(result.status)) {
          await loadReviveStatus(currentLevel);
        }
        return;
      }
      if (result.failureCode === 'REVIVE_LIMIT_REACHED'
        || result.failureCode === 'INTENT_EXPIRED'
        || result.failureCode === 'INTENT_SUPERSEDED') {
        await loadReviveStatus(currentLevel);
      }
      setReviveMessage(getRewardedFlowMessage('reward_revive', result));
    } catch {
      setPendingReviveIntentId(null);
      setReviveMessage('Не удалось связаться с сервером. Попробуйте еще раз.');
    } finally {
      setReviveLoading(false);
    }
  }, [applyReviveQuotaFromStatus, currentLevel, loadReviveStatus, pendingReviveIntentId, reviveLoading]);

  const handleNextLevel = useCallback(() => {
    if (status !== 'victory' || noMoreLevels) return;

    if (!ENABLE_SERVER_PROGRESS_PERSIST) {
      maybeShowInterstitialForVictory(gameLevel, levelDifficulty, getElapsedSeconds());
      setCurrentLevel(gameLevel + 1);
      return;
    }

    setVictoryAction('next');

    if (navigationState === 'loading_next') return;
    if (saveState === 'saved') {
      proceedToNextLevelWithInterstitial(savedNextLevelRef.current ?? (gameLevel + 1), gameLevel);
      return;
    }
    if (saveState === 'saving') return;

    void startVictorySave(gameLevel, true);
  }, [
    getElapsedSeconds,
    gameLevel,
    levelDifficulty,
    maybeShowInterstitialForVictory,
    navigationState,
    noMoreLevels,
    proceedToNextLevelWithInterstitial,
    saveState,
    setVictoryAction,
    startVictorySave,
    status,
  ]);

  const handleVictoryRetry = useCallback(() => {
    if (status !== 'victory' || noMoreLevels) return;
    void startVictorySave(gameLevel, true);
  }, [gameLevel, noMoreLevels, startVictorySave, status]);

  const handleVictoryMenu = useCallback(() => {
    if (status !== 'victory') {
      confirmMenu();
      return;
    }

    if (navigationState === 'loading_next') return;

    if (!ENABLE_SERVER_PROGRESS_PERSIST) {
      confirmMenu();
      return;
    }

    if (saveState === 'saved') {
      clearVictoryAction();
      confirmMenu();
      return;
    }

    if (saveState === 'error') {
      setConfirmAction('unsaved_menu');
      return;
    }

    setVictoryAction('menu');
    if (saveState === 'saving') return;

    void startVictorySave(gameLevel, true);
  }, [
    clearVictoryAction,
    confirmMenu,
    gameLevel,
    navigationState,
    saveState,
    setVictoryAction,
    startVictorySave,
    status,
  ]);

  const confirmRetryUnsavedMenu = useCallback(() => {
    setConfirmAction(null);
    setVictoryAction('menu');
    void startVictorySave(gameLevel, true);
  }, [gameLevel, setVictoryAction, startVictorySave]);

  const confirmExitUnsavedMenu = useCallback(() => {
    setConfirmAction(null);
    clearVictoryAction();
    setScreen('home');
  }, [clearVictoryAction, setScreen]);

  return (
    <div
      className="relative w-full h-full overflow-hidden font-sans select-none touch-none"
      style={{ backgroundImage: `url(${gameBgImage})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: '#1e3a52' }}
    >
      <GameHUD
        currentLevel={currentLevel}
        lives={lives}
        difficulty={levelDifficulty}
        hintBalance={hintBalance}
        onHintClick={onHintClick}
        onMenuClick={onMenuClick}
      >
        <div
          ref={containerRef}
          className="h-full overflow-hidden relative pointer-events-auto ios-game-field-guard"
          style={{
            cursor: isDragging ? 'grabbing' : 'default',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            WebkitTapHighlightColor: 'transparent',
          }}
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
      <ErrorVignette />

      {ENABLE_GAME_DEVTOOLS && (
        <GameDevPanel
          currentLevel={currentLevel}
          gameLevel={gameLevel}
          status={status}
          gridSize={gridSize}
          arrowsCount={arrows.length}
          noMoreLevels={noMoreLevels}
          isAutoSolving={isAutoSolving}
          onJumpToLevel={jumpToLevel}
          onStepLevel={stepLevel}
          onReloadLevel={reloadCurrentLevel}
          onAutoSolve={handleAutoSolve}
        />
      )}

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
        onConfirmRetrySave={confirmRetryUnsavedMenu}
        onConfirmExitUnsaved={confirmExitUnsavedMenu}
      />

      <HintEmptyModal
        open={showHintModal}
        onClose={() => setShowHintModal(false)}
        onHintEarned={() => void onHintClick()}
        onGoToShop={() => setScreen('shop')}
        adAllowed={currentLevel >= ADS_FIRST_ELIGIBLE_LEVEL
          && ADS_ENABLED
          && isValidRewardedBlockId(ADSGRAM_BLOCK_IDS.rewardHint)}
      />

      <GameResultModal
        status={status}
        difficulty={levelDifficulty}
        currentLevel={currentLevel}
        timeSeconds={resultTimeSeconds}
        coinsEarned={victoryCoinsEarned}
        totalCoins={victoryTotalCoins ?? user?.coins ?? 0}
        noMoreLevels={noMoreLevels}
        nextButtonState={nextButtonState}
        pendingAction={pendingVictoryAction}
        nextButtonError={saveError}
        reviveAvailable={reviveAvailable}
        reviveLoading={reviveLoading}
        reviveMessage={reviveMessage}
        revivePending={revivePending}
        reviveRemaining={reviveQuota?.remaining ?? null}
        reviveLimit={reviveQuota?.limit ?? null}
        onRevive={handleRevive}
        onNextLevel={handleNextLevel}
        onVictoryRetry={handleVictoryRetry}
        onDefeatRetry={confirmRestart}
        onVictoryMenu={handleVictoryMenu}
        onDefeatMenu={confirmMenu}
      />
    </div>
  );
}
