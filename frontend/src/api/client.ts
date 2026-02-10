/**
 * Arrow Puzzle - API Client
 * * HTTP клиент для взаимодействия с backend API.
 */

import { API_URL, API_ENDPOINTS } from '../config/constants';
import { useAppStore } from '../stores/store';
import type {
  AuthResponse,
  LevelResponse,
  CompleteRequest,
  CompleteResponse,
  EnergyResponse,
  HintResponse,
  ShopCatalog,
  LeaderboardResponse,
  RewardChannel,
  User,
} from '../game/types';

// Определяем, запущены ли мы в режиме разработки
const IS_DEV = import.meta.env.DEV;

// ============================================
// API ERROR
// ============================================

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ============================================
// BASE REQUEST FUNCTION
// ============================================

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAppStore.getState().token;
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };
  
  // 🛠 DEV MODE INJECTION
  // Если мы локально (IS_DEV) и у нас нет токена (не логинились через ТГ),
  // то добавляем заголовок разработчика, чтобы бэкенд нас пустил.
  if (IS_DEV && !token) {
    // @ts-ignore
    headers['X-Dev-User-Id'] = '999999';
    // Можно раскомментировать для отладки, если нужно видеть в консоли
    // console.debug(`🔧 [API] Dev mode: Injecting X-Dev-User-Id for ${endpoint}`);
  }
  
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });
  
  // Парсим ответ
  let data: any;
  const contentType = response.headers.get('content-type');
  
  if (contentType?.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }
  
  // Обрабатываем ошибки
  if (!response.ok) {
    const message = typeof data === 'object' ? data.detail || 'Unknown error' : data;
    const code = typeof data === 'object' ? data.code : undefined;
    throw new ApiError(response.status, message, code);
  }
  
  return data as T;
}

// ============================================
// AUTH API
// ============================================

export const authApi = {
  /**
   * Авторизация через Telegram
   */
  telegram: (initData: string): Promise<AuthResponse> =>
    request<AuthResponse>(API_ENDPOINTS.auth.telegram, {
      method: 'POST',
      body: JSON.stringify({ init_data: initData }),
    }),
};

// ============================================
// GAME API
// ============================================

export const gameApi = {
  /**
   * Получить уровень
   */
  getLevel: (level: number): Promise<LevelResponse> =>
    request<LevelResponse>(API_ENDPOINTS.game.level(level)),
  
  /**
   * Завершить уровень
   */
  complete: (data: CompleteRequest): Promise<CompleteResponse> =>
    request<CompleteResponse>(API_ENDPOINTS.game.complete, {
      method: 'POST',
      body: JSON.stringify({
        level: data.level,
        seed: data.seed,
        moves: data.moves,
        time_seconds: data.timeSeconds,
      }),
    }),
  
  /**
   * Получить энергию
   */
  getEnergy: (): Promise<EnergyResponse> =>
    request<EnergyResponse>(API_ENDPOINTS.game.energy),
  
  /**
   * Сброс прогресса (DEV)
   */
  resetProgress: (): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(API_ENDPOINTS.game.reset || '/game/reset', { // Fallback если в constants нет пути
      method: 'POST',
    }),
  /**
   * Восстановить энергию за рекламу
   */
  restoreEnergyAd: (adId: string): Promise<{ energy: number }> =>
    request<{ energy: number }>(API_ENDPOINTS.game.energyAd, {
      method: 'POST',
      body: JSON.stringify({ ad_id: adId }),
    }),
  
  /**
   * Получить подсказку
   */
  getHint: (
    level: number,
    seed: number,
    remainingArrows: string[]
  ): Promise<HintResponse> =>
    request<HintResponse>(API_ENDPOINTS.game.hint, {
      method: 'POST',
      body: JSON.stringify({
        level,
        seed,
        remaining_arrows: remainingArrows,
      }),
    }),
};

// ============================================
// SHOP API
// ============================================

export const shopApi = {
  /**
   * Получить каталог
   */
  getCatalog: (): Promise<ShopCatalog> =>
    request<ShopCatalog>(API_ENDPOINTS.shop.catalog),
  
  /**
   * Покупка за монеты
   */
  purchaseCoins: (
    itemType: string,
    itemId: string
  ): Promise<{ success: boolean; coins: number }> =>
    request<{ success: boolean; coins: number }>(API_ENDPOINTS.shop.purchaseCoins, {
      method: 'POST',
      body: JSON.stringify({ item_type: itemType, item_id: itemId }),
    }),
  
  /**
   * Покупка за Stars
   */
  purchaseStars: (
    itemType: string,
    itemId: string
  ): Promise<{ invoice_url: string }> =>
    request<{ invoice_url: string }>(API_ENDPOINTS.shop.purchaseStars, {
      method: 'POST',
      body: JSON.stringify({ item_type: itemType, item_id: itemId }),
    }),
  
  /**
   * Покупка за TON
   */
  purchaseTon: (
    itemType: string,
    itemId: string
  ): Promise<{ transaction_id: number; address: string; amount: number; comment: string }> =>
    request<{ transaction_id: number; address: string; amount: number; comment: string }>(
      API_ENDPOINTS.shop.purchaseTon,
      {
        method: 'POST',
        body: JSON.stringify({ item_type: itemType, item_id: itemId }),
      }
    ),
};

// ============================================
// SOCIAL API
// ============================================

export const socialApi = {
  /**
   * Получить реферальный код
   */
  getReferralCode: (): Promise<{ code: string; link: string }> =>
    request<{ code: string; link: string }>(API_ENDPOINTS.social.referralCode),
  
  /**
   * Применить реферальный код
   */
  applyReferral: (code: string): Promise<{ success: boolean; bonus: number }> =>
    request<{ success: boolean; bonus: number }>(API_ENDPOINTS.social.applyReferral, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  
  /**
   * Получить лидерборд
   */
  getLeaderboard: (
    type: 'global' | 'weekly' | 'arcade',
    limit = 100
  ): Promise<LeaderboardResponse> =>
    request<LeaderboardResponse>(`${API_ENDPOINTS.social.leaderboard(type)}?limit=${limit}`),
  
  /**
   * Получить каналы для подписки
   */
  getChannels: (): Promise<RewardChannel[]> =>
    request<RewardChannel[]>(API_ENDPOINTS.social.channels),
  
  /**
   * Получить награду за подписку
   */
  claimChannel: (channelId: string): Promise<{ success: boolean; coins: number }> =>
    request<{ success: boolean; coins: number }>(API_ENDPOINTS.social.claimChannel, {
      method: 'POST',
      body: JSON.stringify({ channel_id: channelId }),
    }),
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Проверка доступности API
 */
export const checkApiHealth = async (): Promise<boolean> => {
  try {
    await fetch(`${API_URL}/health`, { method: 'GET' });
    return true;
  } catch {
    return false;
  }
};

/**
 * Обработчик ошибок API
 */
export const handleApiError = (error: unknown): string => {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return 'Требуется авторизация';
      case 403:
        return 'Доступ запрещён';
      case 404:
        return 'Не найдено';
      case 400:
        if (error.code === 'NO_ENERGY') {
          return 'Недостаточно энергии';
        }
        return error.message;
      case 500:
        return 'Ошибка сервера';
      default:
        return error.message;
    }
  }
  
  if (error instanceof Error) {
    return error.message;
  }
  
  return 'Неизвестная ошибка';
};