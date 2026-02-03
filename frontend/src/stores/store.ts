/**
 * Arrow Puzzle - Zustand Store
 * 
 * Централизованное хранилище состояния приложения.
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { Arrow, GameState, User, HistoryEntry, GameStatus } from '../game/types';
import { INITIAL_LIVES, MAX_LIVES, HINTS_PER_LEVEL } from '../config/constants';

// ============================================
// APP STORE
// ============================================

export type ScreenName = 'home' | 'game' | 'shop' | 'profile' | 'leaderboard';

interface AppState {
  // Навигация
  screen: ScreenName;
  setScreen: (screen: ScreenName) => void;
  
  // Пользователь
  user: User | null;
  setUser: (user: User | null) => void;
  updateUser: (updates: Partial<User>) => void;
  
  // Авторизация
  token: string | null;
  setToken: (token: string | null) => void;
  isAuthenticated: boolean;
  
  // UI состояние
  loading: boolean;
  setLoading: (loading: boolean) => void;
  modal: string | null;
  setModal: (modal: string | null) => void;
  
  // Ошибки
  error: string | null;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set, get) => ({
        // Навигация
        screen: 'home',
        setScreen: (screen) => set({ screen }),
        
        // Пользователь
        user: null,
        setUser: (user) => set({ user }),
        updateUser: (updates) => {
          const currentUser = get().user;
          if (currentUser) {
            set({ user: { ...currentUser, ...updates } });
          }
        },
        
        // Авторизация
        token: null,
        setToken: (token) => set({ token }),
        get isAuthenticated() {
          return !!get().token && !!get().user;
        },
        
        // UI
        loading: false,
        setLoading: (loading) => set({ loading }),
        modal: null,
        setModal: (modal) => set({ modal }),
        
        // Ошибки
        error: null,
        setError: (error) => set({ error }),
        clearError: () => set({ error: null }),
      }),
      {
        name: 'arrow-puzzle-app',
        partialize: (state) => ({
          token: state.token,
          // Не сохраняем user - получаем с сервера
        }),
      }
    ),
    { name: 'AppStore' }
  )
);

// ============================================
// GAME STORE
// ============================================

interface GameStore {
  // Состояние уровня
  level: number;
  seed: number;
  gridSize: { width: number; height: number };
  arrows: Arrow[];
  removedArrows: string[];
  lives: number;
  moves: number;
  status: GameStatus;
  startTime: number;
  
  // История для undo
  history: HistoryEntry[];
  
  // Подсказки
  hintsRemaining: number;
  hintedArrowId: string | null;
  
  // Анимация
  shakingArrowId: string | null;
  flyingArrowId: string | null;
  
  // Действия
  initLevel: (level: number, seed: number, gridSize: { width: number; height: number }, arrows: Arrow[]) => void;
  removeArrow: (arrowId: string) => void;
  failMove: (arrowId: string) => void;
  undo: () => void;
  showHint: (arrowId: string) => void;
  clearHint: () => void;
  setStatus: (status: GameStatus) => void;
  reset: () => void;
  
  // Анимация
  setShakingArrow: (arrowId: string | null) => void;
  setFlyingArrow: (arrowId: string | null) => void;
}

const initialGameState: Omit<GameStore, 'initLevel' | 'removeArrow' | 'failMove' | 'undo' | 'showHint' | 'clearHint' | 'setStatus' | 'reset' | 'setShakingArrow' | 'setFlyingArrow'> = {
  level: 1,
  seed: 0,
  gridSize: { width: 4, height: 4 },
  arrows: [],
  removedArrows: [],
  lives: INITIAL_LIVES,
  moves: 0,
  status: 'loading',
  startTime: 0,
  history: [],
  hintsRemaining: HINTS_PER_LEVEL,
  hintedArrowId: null,
  shakingArrowId: null,
  flyingArrowId: null,
};

export const useGameStore = create<GameStore>()(
  devtools(
    (set, get) => ({
      ...initialGameState,
      
      initLevel: (level, seed, gridSize, arrows) => {
        set({
          level,
          seed,
          gridSize,
          arrows,
          removedArrows: [],
          lives: INITIAL_LIVES,
          moves: 0,
          status: 'playing',
          startTime: Date.now(),
          history: [],
          hintsRemaining: HINTS_PER_LEVEL,
          hintedArrowId: null,
          shakingArrowId: null,
          flyingArrowId: null,
        });
      },
      
      removeArrow: (arrowId) => {
        const { arrows, removedArrows, history, lives, hintsRemaining } = get();
        
        // Находим стрелку
        const arrow = arrows.find(a => a.id === arrowId);
        if (!arrow) return;
        
        // Сохраняем в историю
        const newHistory: HistoryEntry[] = [
          ...history,
          { arrows: [...arrows], lives, removedArrows: [...removedArrows] }
        ];
        
        // Удаляем стрелку
        const newArrows = arrows.filter(a => a.id !== arrowId);
        const newRemoved = [...removedArrows, arrowId];
        
        // Проверяем победу
        const newStatus: GameStatus = newArrows.length === 0 ? 'victory' : 'playing';
        
        // Обрабатываем спецстрелки
        let newLives = lives;
        if (arrow.type === 'plus_life') {
          newLives = Math.min(MAX_LIVES, lives + 1);
        }
        
        set({
          arrows: newArrows,
          removedArrows: newRemoved,
          moves: get().moves + 1,
          history: newHistory,
          status: newStatus,
          hintedArrowId: null,
          lives: newLives,
        });
      },
      
      failMove: (arrowId) => {
        const { lives, arrows, history, removedArrows } = get();
        
        // Находим стрелку (для проверки minus_life)
        const arrow = arrows.find(a => a.id === arrowId);
        
        // Считаем урон
        let damage = 1;
        if (arrow?.type === 'minus_life') {
          damage = 2;
        }
        
        const newLives = Math.max(0, lives - damage);
        
        // Сохраняем в историю
        const newHistory: HistoryEntry[] = [
          ...history,
          { arrows: [...arrows], lives, removedArrows: [...removedArrows] }
        ];
        
        // Проверяем поражение
        const newStatus: GameStatus = newLives <= 0 ? 'defeat' : 'playing';
        
        set({
          lives: newLives,
          moves: get().moves + 1,
          history: newHistory,
          status: newStatus,
        });
      },
      
      undo: () => {
        const { history } = get();
        if (history.length === 0) return;
        
        const prev = history[history.length - 1];
        set({
          arrows: prev.arrows,
          lives: prev.lives,
          removedArrows: prev.removedArrows,
          moves: get().moves - 1,
          history: history.slice(0, -1),
          hintedArrowId: null,
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
          removedArrows: [],
          moves: 0,
          lives: INITIAL_LIVES,
          hintsRemaining: HINTS_PER_LEVEL,
          hintedArrowId: null,
        });
      },
      
      setShakingArrow: (arrowId) => {
        set({ shakingArrowId: arrowId });
      },
      
      setFlyingArrow: (arrowId) => {
        set({ flyingArrowId: arrowId });
      },
    }),
    { name: 'GameStore' }
  )
);

// ============================================
// SELECTORS (для оптимизации рендеринга)
// ============================================

/** Селектор для проверки авторизации */
export const useIsAuthenticated = () => useAppStore((s) => !!s.token && !!s.user);

/** Селектор для текущего уровня пользователя */
export const useCurrentUserLevel = () => useAppStore((s) => s.user?.currentLevel ?? 1);

/** Селектор для монет */
export const useUserCoins = () => useAppStore((s) => s.user?.coins ?? 0);

/** Селектор для энергии */
export const useUserEnergy = () => useAppStore((s) => s.user?.energy ?? 0);

/** Селектор для статуса игры */
export const useGameStatus = () => useGameStore((s) => s.status);

/** Селектор для жизней */
export const useGameLives = () => useGameStore((s) => s.lives);

/** Селектор для стрелок */
export const useGameArrows = () => useGameStore((s) => s.arrows);

/** Селектор для подсказки */
export const useHintedArrow = () => useGameStore((s) => s.hintedArrowId);