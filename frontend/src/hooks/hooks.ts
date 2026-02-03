/**
 * Arrow Puzzle - React Hooks
 * 
 * Хуки для работы с Telegram SDK, авторизацией, игрой.
 */

import { useEffect, useCallback, useRef, useState } from 'react';
import { useAppStore, useGameStore } from '../stores/store';
import { authApi, gameApi, shopApi, socialApi } from '../api/client';
import { Arrow, Level, GameState } from '../game/types';
import { 
  processMove, 
  checkCollision, 
  simulateMoves,
  calculateStars,
  calculateCoins
} from '../game/engine';
import { generateLevel } from '../game/generator';
import { 
  MAX_LIVES, 
  ANIMATION_DURATIONS,
  HAPTIC_FEEDBACK 
} from '../config/constants';

// ============================================
// TELEGRAM SDK HOOK
// ============================================

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  close: () => void;
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      username?: string;
      first_name?: string;
      is_premium?: boolean;
    };
    start_param?: string;
  };
  themeParams: {
    bg_color?: string;
    text_color?: string;
    button_color?: string;
    button_text_color?: string;
  };
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  MainButton: {
    show: () => void;
    hide: () => void;
    setText: (text: string) => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
  };
  HapticFeedback: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
  showAlert: (message: string) => void;
  showConfirm: (message: string, callback: (confirmed: boolean) => void) => void;
  openLink: (url: string) => void;
  openTelegramLink: (url: string) => void;
  showPopup: (params: {
    title?: string;
    message: string;
    buttons?: Array<{
      id?: string;
      type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive';
      text?: string;
    }>;
  }, callback?: (buttonId: string) => void) => void;
}

export function useTelegram() {
  const tg = window.Telegram?.WebApp;
  
  useEffect(() => {
    if (tg) {
      tg.ready();
      tg.expand();
    }
  }, [tg]);
  
  const haptic = useCallback((type: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning') => {
    if (!tg?.HapticFeedback) return;
    
    if (type === 'success' || type === 'error' || type === 'warning') {
      tg.HapticFeedback.notificationOccurred(type);
    } else {
      tg.HapticFeedback.impactOccurred(type);
    }
  }, [tg]);
  
  const showBackButton = useCallback((onBack: () => void) => {
    if (!tg?.BackButton) return;
    tg.BackButton.show();
    tg.BackButton.onClick(onBack);
    
    return () => {
      tg.BackButton.offClick(onBack);
      tg.BackButton.hide();
    };
  }, [tg]);
  
  const showMainButton = useCallback((text: string, onClick: () => void) => {
    if (!tg?.MainButton) return;
    tg.MainButton.setText(text);
    tg.MainButton.show();
    tg.MainButton.onClick(onClick);
    
    return () => {
      tg.MainButton.offClick(onClick);
      tg.MainButton.hide();
    };
  }, [tg]);
  
  const openLink = useCallback((url: string, inTelegram = false) => {
    if (!tg) {
      window.open(url, '_blank');
      return;
    }
    
    if (inTelegram && url.includes('t.me')) {
      tg.openTelegramLink(url);
    } else {
      tg.openLink(url);
    }
  }, [tg]);
  
  const showPopup = useCallback((params: {
    title?: string;
    message: string;
    buttons?: Array<{ id: string; text: string; type?: string }>;
  }): Promise<string> => {
    return new Promise((resolve) => {
      if (!tg?.showPopup) {
        alert(params.message);
        resolve('ok');
        return;
      }
      
      tg.showPopup(params, (buttonId) => {
        resolve(buttonId);
      });
    });
  }, [tg]);
  
  return {
    tg,
    initData: tg?.initData || '',
    user: tg?.initDataUnsafe?.user,
    startParam: tg?.initDataUnsafe?.start_param,
    themeParams: tg?.themeParams || {},
    haptic,
    showBackButton,
    showMainButton,
    openLink,
    showPopup,
  };
}

// ============================================
// AUTH HOOK
// ============================================

export function useAuth() {
  const { setUser, setToken, setLoading, setError } = useAppStore();
  const { initData, startParam } = useTelegram();
  
  const authenticate = useCallback(async () => {
    if (!initData) {
      // Dev mode - без Telegram
      setLoading(false);
      return false;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await authApi.telegram(initData);
      setToken(response.token);
      setUser(response.user);
      
      // Проверяем реферальный код
      if (startParam?.startsWith('ref_')) {
        const refCode = startParam.replace('ref_', '');
        try {
          await socialApi.applyReferral(refCode);
        } catch (e) {
          console.log('Referral already applied or invalid');
        }
      }
      
      setLoading(false);
      return true;
    } catch (error) {
      console.error('Auth error:', error);
      setError('Ошибка авторизации');
      setLoading(false);
      return false;
    }
  }, [initData, startParam, setUser, setToken, setLoading, setError]);
  
  const refreshUser = useCallback(async () => {
    try {
      const user = await authApi.getMe();
      setUser(user);
    } catch (error) {
      console.error('Refresh user error:', error);
    }
  }, [setUser]);
  
  return { authenticate, refreshUser };
}

// ============================================
// ENERGY HOOK
// ============================================

export function useEnergy() {
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const [secondsToNext, setSecondsToNext] = useState(0);
  const timerRef = useRef<NodeJS.Timeout>();
  
  // Получаем энергию с сервера
  const fetchEnergy = useCallback(async () => {
    try {
      const response = await gameApi.getEnergy();
      setUser({ ...user!, energy: response.energy });
      setSecondsToNext(response.seconds_to_next);
    } catch (error) {
      console.error('Fetch energy error:', error);
    }
  }, [user, setUser]);
  
  // Таймер восстановления
  useEffect(() => {
    if (secondsToNext > 0) {
      timerRef.current = setInterval(() => {
        setSecondsToNext((s) => {
          if (s <= 1) {
            fetchEnergy();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    }
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [secondsToNext, fetchEnergy]);
  
  // Восстановить энергию (за рекламу)
  const restoreEnergy = useCallback(async () => {
    try {
      const response = await gameApi.restoreEnergy();
      if (response.success) {
        await fetchEnergy();
      }
      return response.success;
    } catch (error) {
      console.error('Restore energy error:', error);
      return false;
    }
  }, [fetchEnergy]);
  
  // Форматирование времени
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);
  
  return {
    energy: user?.energy || 0,
    maxEnergy: 5, // из констант
    secondsToNext,
    formattedTime: formatTime(secondsToNext),
    fetchEnergy,
    restoreEnergy,
  };
}

// ============================================
// GAME HOOK
// ============================================

export function useGame() {
  const { haptic } = useTelegram();
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  
  const {
    level,
    arrows,
    grid,
    lives,
    moves,
    history,
    hintArrowId,
    isAnimating,
    setLevel,
    setArrows,
    setGrid,
    setLives,
    addMove,
    pushHistory,
    popHistory,
    setHintArrowId,
    setAnimating,
    resetGame,
  } = useGameStore();
  
  // Загрузить уровень
  const loadLevel = useCallback(async (levelNum: number) => {
    resetGame();
    
    try {
      // Генерируем на клиенте (или загружаем с сервера)
      const levelData = generateLevel(levelNum);
      
      setLevel(levelNum);
      setGrid(levelData.grid);
      setArrows(levelData.arrows);
      setLives(MAX_LIVES);
      
      // Начинаем уровень на сервере (тратим энергию)
      await gameApi.startLevel(levelNum);
      
      return true;
    } catch (error) {
      console.error('Load level error:', error);
      return false;
    }
  }, [resetGame, setLevel, setGrid, setArrows, setLives]);
  
  // Клик по стрелке
  const clickArrow = useCallback((arrowId: string) => {
    if (isAnimating || !arrows.length) return;
    
    const arrow = arrows.find((a) => a.id === arrowId);
    if (!arrow) return;
    
    // Проверяем лёд
    if (arrow.type === 'ice' && arrow.frozen && arrow.frozen > 0) {
      // Размораживаем
      const newArrows = arrows.map((a) =>
        a.id === arrowId
          ? { ...a, frozen: (a.frozen || 0) - 1 }
          : a
      );
      setArrows(newArrows);
      haptic('light');
      return;
    }
    
    // Проверяем коллизию
    const collision = checkCollision(arrow, arrows, grid.width, grid.height);
    
    if (collision) {
      // Столкновение!
      haptic('error');
      
      const newLives = lives - 1;
      setLives(newLives);
      
      if (newLives <= 0) {
        // Game Over
        return { gameOver: true };
      }
      
      return { collision: true };
    }
    
    // Успешное удаление
    haptic('medium');
    setAnimating(true);
    
    // Сохраняем для undo
    pushHistory(arrows);
    
    // Обрабатываем специальные эффекты
    let newArrows = arrows.filter((a) => a.id !== arrowId);
    
    // Бомба - удаляет соседей
    if (arrow.type === 'bomb') {
      const arrowCells = new Set(arrow.cells.map((c) => `${c.x},${c.y}`));
      const neighbors = new Set<string>();
      
      arrow.cells.forEach((cell) => {
        [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dx, dy]) => {
          neighbors.add(`${cell.x + dx},${cell.y + dy}`);
        });
      });
      
      newArrows = newArrows.filter((a) => {
        const isNeighbor = a.cells.some((c) => neighbors.has(`${c.x},${c.y}`));
        return !isNeighbor;
      });
      
      haptic('heavy');
    }
    
    // +Life
    if (arrow.type === 'life') {
      setLives(Math.min(lives + 1, MAX_LIVES + 1));
    }
    
    // Danger (-life при ошибке уже обработано в collision)
    
    // Electric - удаляет первую на пути
    if (arrow.type === 'electric') {
      const dx = arrow.direction === 'right' ? 1 : arrow.direction === 'left' ? -1 : 0;
      const dy = arrow.direction === 'down' ? 1 : arrow.direction === 'up' ? -1 : 0;
      
      const head = arrow.cells[0];
      let x = head.x + dx;
      let y = head.y + dy;
      
      while (x >= 0 && x < grid.width && y >= 0 && y < grid.height) {
        const target = newArrows.find((a) =>
          a.cells.some((c) => c.x === x && c.y === y)
        );
        
        if (target) {
          newArrows = newArrows.filter((a) => a.id !== target.id);
          break;
        }
        
        x += dx;
        y += dy;
      }
    }
    
    setArrows(newArrows);
    addMove(arrowId);
    setHintArrowId(null);
    
    // Анимация завершена
    setTimeout(() => {
      setAnimating(false);
      
      // Проверяем победу
      if (newArrows.length === 0) {
        return { victory: true };
      }
    }, ANIMATION_DURATIONS.arrowRemove);
    
    return { success: true };
  }, [
    arrows, grid, lives, isAnimating,
    setArrows, setLives, addMove, pushHistory, setHintArrowId, setAnimating,
    haptic
  ]);
  
  // Undo
  const undo = useCallback(() => {
    const prevArrows = popHistory();
    if (prevArrows) {
      setArrows(prevArrows);
      haptic('light');
    }
  }, [popHistory, setArrows, haptic]);
  
  // Подсказка
  const getHint = useCallback(async () => {
    if (!level || !arrows.length) return;
    
    try {
      const remainingIds = arrows.map((a) => a.id);
      const response = await gameApi.getHint(level, level, remainingIds);
      setHintArrowId(response.arrow_id);
      haptic('success');
    } catch (error) {
      console.error('Hint error:', error);
    }
  }, [level, arrows, setHintArrowId, haptic]);
  
  // Завершить уровень
  const completeLevel = useCallback(async (timeSeconds: number) => {
    if (!level) return null;
    
    try {
      const response = await gameApi.completeLevel({
        level,
        seed: level,
        moves,
        time_seconds: timeSeconds,
      });
      
      if (response.valid) {
        // Обновляем пользователя
        if (user) {
          setUser({
            ...user,
            current_level: response.new_level_unlocked
              ? user.current_level + 1
              : user.current_level,
            coins: user.coins + (response.coins_earned || 0),
            total_stars: user.total_stars + (response.stars || 0),
          });
        }
      }
      
      return response;
    } catch (error) {
      console.error('Complete level error:', error);
      return null;
    }
  }, [level, moves, user, setUser]);
  
  // Рестарт
  const restart = useCallback(() => {
    if (level) {
      loadLevel(level);
    }
  }, [level, loadLevel]);
  
  // Проверка победы
  const isVictory = arrows.length === 0 && level !== null;
  
  // Проверка поражения
  const isGameOver = lives <= 0;
  
  return {
    level,
    arrows,
    grid,
    lives,
    moves,
    history,
    hintArrowId,
    isAnimating,
    isVictory,
    isGameOver,
    loadLevel,
    clickArrow,
    undo,
    getHint,
    completeLevel,
    restart,
    canUndo: history.length > 0,
  };
}

// ============================================
// SHOP HOOK
// ============================================

export function useShop() {
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const [catalog, setCatalog] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  
  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const data = await shopApi.getCatalog();
      setCatalog(data);
    } catch (error) {
      console.error('Fetch catalog error:', error);
    }
    setLoading(false);
  }, []);
  
  const purchaseWithCoins = useCallback(async (itemType: string, itemId: string) => {
    try {
      const response = await shopApi.purchaseCoins(itemType, itemId);
      if (response.success && user) {
        setUser({ ...user, coins: response.coins! });
        await fetchCatalog();
      }
      return response;
    } catch (error) {
      console.error('Purchase error:', error);
      return { success: false, error: 'Ошибка покупки' };
    }
  }, [user, setUser, fetchCatalog]);
  
  const equipItem = useCallback(async (itemType: string, itemId: string) => {
    try {
      await shopApi.equipItem(itemType, itemId);
      // Обновляем локально
      if (user) {
        if (itemType === 'arrow_skins') {
          setUser({ ...user, active_arrow_skin: itemId });
        } else if (itemType === 'themes') {
          setUser({ ...user, active_theme: itemId });
        }
      }
      return true;
    } catch (error) {
      console.error('Equip error:', error);
      return false;
    }
  }, [user, setUser]);
  
  return {
    catalog,
    loading,
    fetchCatalog,
    purchaseWithCoins,
    equipItem,
  };
}

// ============================================
// LEADERBOARD HOOK
// ============================================

export function useLeaderboard() {
  const [leaders, setLeaders] = useState<any[]>([]);
  const [myPosition, setMyPosition] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  
  const fetchLeaderboard = useCallback(async (type: 'global' | 'weekly' | 'arcade' = 'global') => {
    setLoading(true);
    try {
      const data = await socialApi.getLeaderboard(type);
      setLeaders(data.leaders);
      setMyPosition(data.my_position);
    } catch (error) {
      console.error('Fetch leaderboard error:', error);
    }
    setLoading(false);
  }, []);
  
  const fetchFriendsLeaderboard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await socialApi.getFriendsLeaderboard();
      setLeaders(data.leaders);
      setMyPosition(data.my_position);
    } catch (error) {
      console.error('Fetch friends leaderboard error:', error);
    }
    setLoading(false);
  }, []);
  
  return {
    leaders,
    myPosition,
    loading,
    fetchLeaderboard,
    fetchFriendsLeaderboard,
  };
}

// ============================================
// REFERRAL HOOK
// ============================================

export function useReferral() {
  const [code, setCode] = useState('');
  const [link, setLink] = useState('');
  const [stats, setStats] = useState({ count: 0, earned: 0 });
  
  const fetchReferralCode = useCallback(async () => {
    try {
      const data = await socialApi.getReferralCode();
      setCode(data.code);
      setLink(data.link);
    } catch (error) {
      console.error('Fetch referral code error:', error);
    }
  }, []);
  
  const fetchReferralStats = useCallback(async () => {
    try {
      const data = await socialApi.getReferralStats();
      setStats({ count: data.referrals_count, earned: data.total_earned });
    } catch (error) {
      console.error('Fetch referral stats error:', error);
    }
  }, []);
  
  const shareReferral = useCallback(() => {
    if (!link) return;
    
    const text = `🎯 Играй в Arrow Puzzle и получи бонус!\n${link}`;
    const tg = window.Telegram?.WebApp;
    
    if (tg) {
      // Через Telegram share
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('🎯 Играй в Arrow Puzzle!')}`;
      tg.openTelegramLink(shareUrl);
    } else {
      // Копируем в буфер
      navigator.clipboard.writeText(text);
    }
  }, [link]);
  
  return {
    code,
    link,
    stats,
    fetchReferralCode,
    fetchReferralStats,
    shareReferral,
  };
}

// ============================================
// CHANNELS HOOK
// ============================================

export function useChannels() {
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const [channels, setChannels] = useState<any[]>([]);
  
  const fetchChannels = useCallback(async () => {
    try {
      const data = await socialApi.getChannels();
      setChannels(data);
    } catch (error) {
      console.error('Fetch channels error:', error);
    }
  }, []);
  
  const claimReward = useCallback(async (channelId: string) => {
    try {
      const response = await socialApi.claimChannelReward(channelId);
      if (response.success && user) {
        setUser({ ...user, coins: response.coins });
        await fetchChannels();
      }
      return response;
    } catch (error) {
      console.error('Claim reward error:', error);
      return { success: false };
    }
  }, [user, setUser, fetchChannels]);
  
  return {
    channels,
    fetchChannels,
    claimReward,
  };
}

// ============================================
// ADS HOOK
// ============================================

declare global {
  interface Window {
    Adsgram?: {
      init: (params: { blockId: string }) => {
        show: () => Promise<{ done: boolean; description: string }>;
      };
    };
  }
}

export function useAds() {
  const [adController, setAdController] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    // Инициализация Adsgram
    if (window.Adsgram) {
      const controller = window.Adsgram.init({
        blockId: import.meta.env.VITE_ADSGRAM_BLOCK_ID || 'test-block',
      });
      setAdController(controller);
    }
  }, []);
  
  const showAd = useCallback(async (): Promise<boolean> => {
    if (!adController) {
      console.log('Ads not available');
      return false;
    }
    
    setLoading(true);
    
    try {
      const result = await adController.show();
      setLoading(false);
      return result.done;
    } catch (error) {
      console.error('Show ad error:', error);
      setLoading(false);
      return false;
    }
  }, [adController]);
  
  return {
    available: !!adController,
    loading,
    showAd,
  };
}