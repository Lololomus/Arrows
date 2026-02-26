/**
 * Arrow Puzzle - Zustand Store (OPTIMIZED)
 *
 * Оптимизации:
 * 1. devtools() УБРАН — сериализовал весь state на каждый set() (~5-15ms на мобиле)
 * 2. Иммутабельные spread для history/removedArrowIds (FIX: мутабельный push нарушал reference equality)
 * 3. Единый removeArrow() — removeArrows() batch удалён (только normal стрелки)
 * 4. globalIndex.getArrow() вместо .find() — O(1) вместо O(n)
 * 5. Специальные стрелки закомментированы как Legacy
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Arrow, User, GameStatus } from '../game/types';
import { INITIAL_LIVES, HINTS_PER_LEVEL } from '../config/constants';
import { rebuildIndex, removeFromIndex, globalIndex } from '../game/spatialIndex';

// ============================================
// APP STORE (без изменений)
// ============================================

export type ScreenName = 'home' | 'game' | 'shop' | 'profile' | 'leaderboard';

interface AppState {
  screen: ScreenName;
  setScreen: (screen: ScreenName) => void;

  user: User | null;
  setUser: (user: User | null) => void;
  updateUser: (updates: Partial<User>) => void;

  token: string | null;
  setToken: (token: string | null) => void;
  isAuthenticated: boolean;

  loading: boolean;
  setLoading: (loading: boolean) => void;
  modal: string | null;
  setModal: (modal: string | null) => void;

  error: string | null;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      screen: 'home',
      setScreen: (screen) => set({ screen }),

      user: null,
      setUser: (user) => set({ user }),
      updateUser: (updates) => {
        const currentUser = get().user;
        if (currentUser) {
          set({ user: { ...currentUser, ...updates } });
        }
      },

      token: null,
      setToken: (token) => set({ token }),
      get isAuthenticated() {
        return !!get().token && !!get().user;
      },

      loading: false,
      setLoading: (loading) => set({ loading }),
      modal: null,
      setModal: (modal) => set({ modal }),

      error: null,
      setError: (error) => set({ error }),
      clearError: () => set({ error: null }),
    }),
    {
      name: 'arrow-puzzle-app',
      partialize: (state) => ({
        token: state.token,
      }),
    }
  )
);

// ============================================
// HISTORY DIFF
// ============================================

interface HistoryDiff {
  /** Удалённые стрелки (1 для обычного хода) */
  removedArrows: Arrow[];
  /** Жизни ДО этого хода */
  prevLives: number;
}

// ============================================
// GAME STORE
// ============================================

interface GameStore {
  level: number;
  seed: number;
  gridSize: { width: number; height: number };
  arrows: Arrow[];
  removedArrowIds: string[];
  lives: number;
  moves: number;
  status: GameStatus;
  startTime: number;
  endTime: number;

  history: HistoryDiff[];

  hintsRemaining: number;
  hintedArrowId: string | null;

  shakingArrowId: string | null;
  flyingArrowId: string | null;

  /** Стрелки заблокированные после ошибки */
  blockedArrowIds: string[];

  initLevel: (
    level: number,
    seed: number,
    gridSize: { width: number; height: number },
    arrows: Arrow[],
    lives?: number
  ) => void;
  removeArrow: (arrowId: string) => void;
  // [Legacy] removeArrows: batch-удаление для бомбы/электро
  removeArrows: (arrowIds: string[]) => void;
  failMove: (arrowId: string) => void;
  undo: () => void;
  showHint: (arrowId: string) => void;
  clearHint: () => void;
  setStatus: (status: GameStatus) => void;
  reset: () => void;

  setShakingArrow: (arrowId: string | null) => void;
  setFlyingArrow: (arrowId: string | null) => void;

  blockArrow: (arrowId: string) => void;
  unblockArrows: (arrowIds: string[]) => void;

  activeSkinId: string;
  ownedSkinIds: string[];
  setSkin: (skinId: string) => void;
  purchaseSkin: (skinId: string) => void;
}

const initialGameState: Omit<GameStore, 'initLevel' | 'removeArrow' | 'removeArrows' | 'failMove' | 'undo' | 'showHint' | 'clearHint' | 'setStatus' | 'reset' | 'setShakingArrow' | 'setFlyingArrow' | 'blockArrow' | 'unblockArrows' | 'setSkin' | 'purchaseSkin'> = {
  level: 1,
  seed: 0,
  gridSize: { width: 4, height: 4 },
  arrows: [],
  removedArrowIds: [],
  lives: INITIAL_LIVES,
  moves: 0,
  status: 'loading',
  startTime: 0,
  endTime: 0,
  history: [],
  hintsRemaining: HINTS_PER_LEVEL,
  hintedArrowId: null,
  shakingArrowId: null,
  flyingArrowId: null,
  blockedArrowIds: [],
  activeSkinId: 'classic',
  ownedSkinIds: ['classic'],
};

export const useGameStore = create<GameStore>()(
  // ⚡ devtools() УБРАН — сериализовал весь state на каждый set()
  (set, get) => ({
    ...initialGameState,

    initLevel: (level, seed, serverGridSize, arrows, lives = INITIAL_LIVES) => {
      // === НОРМАЛИЗАЦИЯ КООРДИНАТ ===
      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;

      arrows.forEach(arrow => {
        arrow.cells.forEach(cell => {
          const cx = Number(cell.x);
          const cy = Number(cell.y);
          if (cx < minX) minX = cx;
          if (cy < minY) minY = cy;
          if (cx > maxX) maxX = cx;
          if (cy > maxY) maxY = cy;
        });
      });

      if (minX === Infinity) { minX = 0; maxX = 0; minY = 0; maxY = 0; }

      const normalizedArrows = arrows.map(arrow => ({
        ...arrow,
        cells: arrow.cells.map(cell => ({
          x: Number(cell.x) - minX,
          y: Number(cell.y) - minY
        }))
      }));

      const strictWidth = maxX - minX + 1;
      const strictHeight = maxY - minY + 1;

      const serverWidth = Number(serverGridSize?.width ?? strictWidth);
      const serverHeight = Number(serverGridSize?.height ?? strictHeight);
      if (serverWidth !== strictWidth || serverHeight !== strictHeight) {
        const looksTransposed = serverWidth === strictHeight && serverHeight === strictWidth;
        console.warn(
          `[System] Level ${level} grid mismatch: server ${serverWidth}x${serverHeight}, normalized ${strictWidth}x${strictHeight}`
          + (looksTransposed ? ' (possible axis transpose)' : '')
        );
      }

      rebuildIndex(normalizedArrows);

      console.log(`[System] Level ${level} Normalized: Grid ${strictWidth}x${strictHeight}, ${normalizedArrows.length} arrows`);

      set({
        level,
        seed,
        gridSize: { width: strictWidth, height: strictHeight },
        arrows: normalizedArrows,
        removedArrowIds: [],
        lives,
        moves: 0,
        status: 'playing',
        startTime: Date.now(),
        endTime: 0,
        history: [],
        hintsRemaining: HINTS_PER_LEVEL,
        hintedArrowId: null,
        shakingArrowId: null,
        flyingArrowId: null,
        blockedArrowIds: [],
      });
    },

    removeArrow: (arrowId) => {
      const { arrows, removedArrowIds, lives, hintedArrowId } = get();

      // ⚡ O(1) через globalIndex вместо O(n) .find()
      const arrow = globalIndex.getArrow(arrowId);
      if (!arrow) return;

      const diff: HistoryDiff = {
        removedArrows: [arrow],
        prevLives: lives,
      };

      const newArrows = arrows.filter(a => a.id !== arrowId);

      // [Legacy] Специальные стрелки
      // let newLives = lives;
      // if (arrow.type === 'plus_life') {
      //   newLives = Math.min(MAX_LIVES, lives + 1);
      // }

      // ⚡ Инкрементальное обновление индекса
      removeFromIndex(arrowId);

      // ⚡ FIX: иммутабельные новые массивы — мутация get() нарушает reference equality
      const newRemovedIds = [...removedArrowIds, arrowId];
      const newHistory = [...get().history, diff];

      const isVictory = newArrows.length === 0;
      set({
        arrows: newArrows,
        removedArrowIds: newRemovedIds,
        moves: get().moves + 1,
        history: newHistory,
        status: isVictory ? 'victory' : 'playing',
        endTime: isVictory ? Date.now() : 0,
        hintedArrowId: hintedArrowId === arrowId ? null : hintedArrowId,
        lives,
      });
    },

    /**
     * [Legacy] Batch-удаление для бомбы/электро.
     * Оставлен для обратной совместимости.
     */
    removeArrows: (arrowIds) => {
      if (arrowIds.length === 0) return;
      if (arrowIds.length === 1) {
        get().removeArrow(arrowIds[0]);
        return;
      }

      const { arrows, removedArrowIds, lives, hintedArrowId } = get();
      const idsToRemove = new Set(arrowIds);

      const removedArrowObjects: Arrow[] = [];
      for (const id of arrowIds) {
        const arrow = globalIndex.getArrow(id);
        if (arrow) removedArrowObjects.push(arrow);
      }
      if (removedArrowObjects.length === 0) return;

      const diff: HistoryDiff = {
        removedArrows: removedArrowObjects,
        prevLives: lives,
      };

      const newArrows = arrows.filter(a => !idsToRemove.has(a.id));

      // ⚡ Инкрементальное batch-удаление
      for (const id of arrowIds) removeFromIndex(id);

      // ⚡ FIX: иммутабельные новые массивы
      const newRemovedIds = [...removedArrowIds, ...arrowIds];
      const newHistory = [...get().history, diff];

      const isVictory = newArrows.length === 0;
      set({
        arrows: newArrows,
        removedArrowIds: newRemovedIds,
        moves: get().moves + 1,
        history: newHistory,
        status: isVictory ? 'victory' : 'playing',
        endTime: isVictory ? Date.now() : 0,
        hintedArrowId: (hintedArrowId && idsToRemove.has(hintedArrowId)) ? null : hintedArrowId,
        lives,
      });
    },

    failMove: (_arrowId) => {
      const { lives } = get();

      // [Legacy] Специальные стрелки: damage = 2 для minus_life
      const damage = 1;
      const newLives = Math.max(0, lives - damage);

      const diff: HistoryDiff = {
        removedArrows: [],
        prevLives: lives,
      };

      // ⚡ FIX: иммутабельный новый массив
      const newHistory = [...get().history, diff];

      const isDefeat = newLives <= 0;
      set({
        lives: newLives,
        moves: get().moves + 1,
        history: newHistory,
        status: isDefeat ? 'defeat' : 'playing',
        endTime: 0,
      });
    },

    undo: () => {
      const { history, arrows, removedArrowIds } = get();
      if (history.length === 0) return;

      const diff = history[history.length - 1];

      const restoredArrows = diff.removedArrows.length > 0
        ? [...arrows, ...diff.removedArrows]
        : arrows;

      const restoredRemovedIds = diff.removedArrows.length > 0
        ? removedArrowIds.slice(0, -diff.removedArrows.length)
        : removedArrowIds;

      rebuildIndex(restoredArrows);

      set({
        arrows: restoredArrows,
        lives: diff.prevLives,
        removedArrowIds: restoredRemovedIds,
        moves: get().moves - 1,
        history: history.slice(0, -1),
        hintedArrowId: null,
        status: 'playing',
        endTime: 0,
      });
    },

    showHint: (arrowId) => {
      set({
        hintedArrowId: arrowId,
        hintsRemaining: get().hintsRemaining - 1,
      });
    },

    clearHint: () => set({ hintedArrowId: null }),
    setStatus: (status) => set({ status }),

    reset: () => {
      set({
        status: 'loading',
        startTime: 0,
        endTime: 0,
        history: [],
        removedArrowIds: [],
        moves: 0,
        lives: INITIAL_LIVES,
        hintsRemaining: HINTS_PER_LEVEL,
        hintedArrowId: null,
        blockedArrowIds: [],
      });
    },

    setShakingArrow: (arrowId) => set({ shakingArrowId: arrowId }),
    setFlyingArrow: (arrowId) => set({ flyingArrowId: arrowId }),

    blockArrow: (arrowId) => {
      const { blockedArrowIds } = get();
      if (!blockedArrowIds.includes(arrowId)) {
        set({ blockedArrowIds: [...blockedArrowIds, arrowId] });
      }
    },

    unblockArrows: (arrowIds) => {
      if (arrowIds.length === 0) return;
      const toRemove = new Set(arrowIds);
      set({ blockedArrowIds: get().blockedArrowIds.filter(id => !toRemove.has(id)) });
    },

    setSkin: (skinId) => {
      const { ownedSkinIds } = get();
      if (ownedSkinIds.includes(skinId)) set({ activeSkinId: skinId });
    },

    purchaseSkin: (skinId) => {
      const { ownedSkinIds } = get();
      if (!ownedSkinIds.includes(skinId)) set({ ownedSkinIds: [...ownedSkinIds, skinId] });
    },
  })
);

// ============================================
// SELECTORS
// ============================================

export const useIsAuthenticated = () => useAppStore(s => !!s.token && !!s.user);
export const useCurrentUserLevel = () => useAppStore(s => s.user?.currentLevel ?? 1);
export const useUserCoins = () => useAppStore(s => s.user?.coins ?? 0);
export const useUserEnergy = () => useAppStore(s => s.user?.energy ?? 0);

export const useGameStatus = () => useGameStore(s => s.status);
export const useGameLives = () => useGameStore(s => s.lives);
export const useGameArrows = () => useGameStore(s => s.arrows);
export const useGameGridSize = () => useGameStore(s => s.gridSize);
export const useHintedArrow = () => useGameStore(s => s.hintedArrowId);
export const useHintsRemaining = () => useGameStore(s => s.hintsRemaining);
export const useGameHistory = () => useGameStore(s => s.history);
export const useShakingArrow = () => useGameStore(s => s.shakingArrowId);
export const useBlockedArrows = () => useGameStore(s => s.blockedArrowIds);
export const useActiveSkinId = () => useGameStore(s => s.activeSkinId);
export const useOwnedSkins = () => useGameStore(s => s.ownedSkinIds);
