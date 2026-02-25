/**
 * Arrow Puzzle - Zustand Store (PHASE 1 + 2 + 3 + 4 FINAL)
 * 
 * Фаза 1: атомарные селекторы
 * Фаза 2: SpatialIndex интеграция (rebuildIndex / removeFromIndex)
 * Фаза 3: без изменений в store (Canvas прозрачен)
 * Фаза 4: 
 *   - History diffs вместо полных копий (экономия RAM в ~N раз)
 *   - removeArrows() используется для бомбы/электро (1 ре-рендер)
 *   - Undo корректно восстанавливает batch-удаления
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { Arrow, User, GameStatus } from '../game/types';
import { INITIAL_LIVES, MAX_LIVES, HINTS_PER_LEVEL } from '../config/constants';
import { rebuildIndex, removeFromIndex, removeFromIndexBatch } from '../game/spatialIndex';

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
  devtools(
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
    ),
    { name: 'AppStore' }
  )
);

// ============================================
// HISTORY DIFF (Фаза 4)
// ============================================

/**
 * Лёгкий снимок вместо полной копии Arrow[].
 * 
 * Было (Фаза 1-3):
 *   { arrows: [...arrows], lives, removedArrows: [...] }
 *   → 500 стрелок × 200 ходов = 100,000 Arrow объектов в памяти
 * 
 * Стало (Фаза 4):
 *   { removedArrows: [Arrow, Arrow?], prevLives }
 *   → 200 ходов × 1-20 стрелок = 200-4,000 Arrow объектов
 *   → Экономия RAM в 25-500 раз
 */
interface HistoryDiff {
  /** Удалённые стрелки (1 = обычный ход, N = бомба/электро) */
  removedArrows: Arrow[];
  /** Жизни ДО этого хода (для точного отката) */
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
  
  /** Фаза 4: дифф-история вместо полных копий */
  history: HistoryDiff[];
  
  hintsRemaining: number;
  hintedArrowId: string | null;
  
  shakingArrowId: string | null;
  flyingArrowId: string | null;
  
  /** Стрелки заблокированные после ошибки (краснеют, нельзя кликать) */
  blockedArrowIds: string[];
  
  initLevel: (level: number, seed: number, gridSize: { width: number; height: number }, arrows: Arrow[]) => void;
  /** Удалить одну стрелку (обычный ход) */
  removeArrow: (arrowId: string) => void;
  /** Batch-удаление (бомба + соседи, основная стрелка + электро-цель) */
  removeArrows: (arrowIds: string[]) => void;
  failMove: (arrowId: string) => void;
  undo: () => void;
  showHint: (arrowId: string) => void;
  clearHint: () => void;
  setStatus: (status: GameStatus) => void;
  reset: () => void;
  
  setShakingArrow: (arrowId: string | null) => void;
  setFlyingArrow: (arrowId: string | null) => void;
  
  /** Заблокировать стрелку после ошибки */
  blockArrow: (arrowId: string) => void;
  /** Разблокировать стрелки (путь освободился) */
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
  history: [],
  hintsRemaining: HINTS_PER_LEVEL,
  hintedArrowId: null,
  shakingArrowId: null,
  flyingArrowId: null,
  blockedArrowIds: [],
  // СКИНЫ
  activeSkinId: 'classic',
  ownedSkinIds: ['classic'],
};

export const useGameStore = create<GameStore>()(
  devtools(
    (set, get) => ({
      ...initialGameState,
      
      initLevel: (level, seed, serverGridSize, arrows) => {
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

        // Фаза 2: SpatialIndex
        rebuildIndex(normalizedArrows);

        console.log(`[System] Level ${level} Normalized: Grid ${strictWidth}x${strictHeight}, ${normalizedArrows.length} arrows`);

        set({
          level,
          seed,
          gridSize: { width: strictWidth, height: strictHeight },
          arrows: normalizedArrows,
          removedArrowIds: [],
          lives: INITIAL_LIVES,
          moves: 0,
          status: 'playing',
          startTime: Date.now(),
          history: [],
          hintsRemaining: HINTS_PER_LEVEL,
          hintedArrowId: null,
          shakingArrowId: null,
          flyingArrowId: null,
          blockedArrowIds: [],
        });
      },

      /**
       * Удалить одну стрелку.
       * Для обычных ходов без спецэффектов.
       */
      removeArrow: (arrowId) => {
        const { arrows, removedArrowIds, lives, hintedArrowId } = get();
        
        const arrow = arrows.find(a => a.id === arrowId);
        if (!arrow) return;
        
        // Фаза 4: сохраняем только дельту
        const diff: HistoryDiff = {
          removedArrows: [arrow],
          prevLives: lives,
        };
        
        const newArrows = arrows.filter(a => a.id !== arrowId);
        
        let newLives = lives;
        if (arrow.type === 'plus_life') {
          newLives = Math.min(MAX_LIVES, lives + 1);
        }
        
        // Фаза 2: инкрементальное обновление индекса
        removeFromIndex(arrowId);
        
        set({
          arrows: newArrows,
          removedArrowIds: [...removedArrowIds, arrowId],
          moves: get().moves + 1,
          history: [...get().history, diff],
          status: newArrows.length === 0 ? 'victory' : 'playing',
          hintedArrowId: hintedArrowId === arrowId ? null : hintedArrowId,
          lives: newLives,
        });
      },

      /**
       * Batch-удаление нескольких стрелок за один set().
       * 
       * Используется для:
       * - Бомба: основная стрелка + соседи (1-20 стрелок)
       * - Электро: основная + цель (2 стрелки)
       * - Любая комбинация
       * 
       * 1 вызов set() = 1 ре-рендер (вместо N)
       * 1 запись в history (вместо N)
       */
      removeArrows: (arrowIds) => {
        if (arrowIds.length === 0) return;
        
        const { arrows, removedArrowIds, lives, hintedArrowId } = get();
        
        const idsToRemove = new Set(arrowIds);
        
        // Собираем удаляемые стрелки для истории
        const removedArrowObjects: Arrow[] = [];
        for (const id of arrowIds) {
          const arrow = arrows.find(a => a.id === id);
          if (arrow) removedArrowObjects.push(arrow);
        }
        
        if (removedArrowObjects.length === 0) return;
        
        // Фаза 4: один дифф для всего batch
        const diff: HistoryDiff = {
          removedArrows: removedArrowObjects,
          prevLives: lives,
        };
        
        const newArrows = arrows.filter(a => !idsToRemove.has(a.id));
        
        // Считаем бонусные жизни
        let newLives = lives;
        for (const arrow of removedArrowObjects) {
          if (arrow.type === 'plus_life') {
            newLives = Math.min(MAX_LIVES, newLives + 1);
          }
        }
        
        // Фаза 2: batch-удаление из индекса
        removeFromIndexBatch(arrowIds);
        
        set({
          arrows: newArrows,
          removedArrowIds: [...removedArrowIds, ...arrowIds],
          moves: get().moves + 1,
          history: [...get().history, diff],
          status: newArrows.length === 0 ? 'victory' : 'playing',
          hintedArrowId: (hintedArrowId && idsToRemove.has(hintedArrowId)) ? null : hintedArrowId,
          lives: newLives,
        });
      },
      
      failMove: (arrowId) => {
        const { lives, arrows } = get();
        
        const arrow = arrows.find(a => a.id === arrowId);
        
        let damage = 1;
        if (arrow?.type === 'minus_life') {
          damage = 2;
        }
        
        const newLives = Math.max(0, lives - damage);
        
        // failMove НЕ удаляет стрелку → в историю пишем пустой diff
        // (нужен чтобы undo корректно откатил жизни)
        const diff: HistoryDiff = {
          removedArrows: [],  // Ничего не удалено
          prevLives: lives,
        };
        
        set({
          lives: newLives,
          moves: get().moves + 1,
          history: [...get().history, diff],
          status: newLives <= 0 ? 'defeat' : 'playing',
        });
      },
      
      /**
       * Undo — откат одного хода.
       * 
       * Фаза 4: вместо полной замены arrows[] — вставляем удалённые стрелки обратно.
       * Это O(removedCount) вместо O(totalArrows).
       * 
       * После вставки пересобираем SpatialIndex (O(totalCells) ≈ 0.1ms).
       */
      undo: () => {
        const { history, arrows, removedArrowIds } = get();
        if (history.length === 0) return;
        
        const diff = history[history.length - 1];
        
        // Вставляем удалённые стрелки обратно в массив
        const restoredArrows = diff.removedArrows.length > 0
          ? [...arrows, ...diff.removedArrows]
          : arrows;  // failMove — ничего не было удалено
        
        // Убираем из removedArrowIds
        const restoredRemovedIds = diff.removedArrows.length > 0
          ? removedArrowIds.slice(0, -diff.removedArrows.length)
          : removedArrowIds;
        
        // Фаза 2: пересобираем индекс
        rebuildIndex(restoredArrows);
        
        set({
          arrows: restoredArrows,
          lives: diff.prevLives,
          removedArrowIds: restoredRemovedIds,
          moves: get().moves - 1,
          history: history.slice(0, -1),
          hintedArrowId: null,
          status: 'playing',  // Undo всегда возвращает в playing
        });
      },
      
      showHint: (arrowId) => {
        set({
          hintedArrowId: arrowId,
          hintsRemaining: get().hintsRemaining - 1,
        });
      },
      
      clearHint: () => {
        set({ hintedArrowId: null });
      },
      
      setStatus: (status) => {
        set({ status });
      },
      
      reset: () => {
        set({
          status: 'loading',
          history: [],
          removedArrowIds: [],
          moves: 0,
          lives: INITIAL_LIVES,
          hintsRemaining: HINTS_PER_LEVEL,
          hintedArrowId: null,
          blockedArrowIds: [],
        });
      },
      
      setShakingArrow: (arrowId) => {
        set({ shakingArrowId: arrowId });
      },
      
      setFlyingArrow: (arrowId) => {
        set({ flyingArrowId: arrowId });
      },
      
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
        if (ownedSkinIds.includes(skinId)) {
          set({ activeSkinId: skinId });
        }
      },
      
      purchaseSkin: (skinId) => {
        const { ownedSkinIds } = get();
        if (!ownedSkinIds.includes(skinId)) {
          set({ ownedSkinIds: [...ownedSkinIds, skinId] });
        }
      },
      
    }),
    { name: 'GameStore' }
  )
);

// ============================================
// SELECTORS
// ============================================

// AppStore
export const useIsAuthenticated = () => useAppStore(s => !!s.token && !!s.user);
export const useCurrentUserLevel = () => useAppStore(s => s.user?.currentLevel ?? 1);
export const useUserCoins = () => useAppStore(s => s.user?.coins ?? 0);
export const useUserEnergy = () => useAppStore(s => s.user?.energy ?? 0);

// GameStore — данные
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

// GameStore — действия
export const useGameActions = () => useGameStore(s => ({
  initLevel: s.initLevel,
  removeArrow: s.removeArrow,
  removeArrows: s.removeArrows,
  failMove: s.failMove,
  undo: s.undo,
  showHint: s.showHint,
  clearHint: s.clearHint,
  setStatus: s.setStatus,
  reset: s.reset,
  setShakingArrow: s.setShakingArrow,
  setFlyingArrow: s.setFlyingArrow,
  blockArrow: s.blockArrow,
  unblockArrows: s.unblockArrows,
}));
