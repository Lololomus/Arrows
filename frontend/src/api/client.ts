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
  ReferralApplyResponse,
  ReferralStatsResponse,
  ReferralListResponse,
  ReferralLeaderboardResponse,
} from '../game/types';

interface RawCompleteResponse {
  valid: boolean;
  stars?: number;
  coins_earned?: number;
  new_level_unlocked?: boolean;
  error?: string;
  referral_confirmed?: boolean;
}

interface RawUserResponse {
  id: number;
  telegram_id?: number;
  telegramId?: number;
  username: string | null;
  first_name?: string | null;
  firstName?: string | null;
  photo_url?: string | null;
  current_level?: number;
  currentLevel?: number;
  total_stars?: number;
  totalStars?: number;
  coins?: number;
  energy?: number;
  energy_updated_at?: string;
  energyUpdatedAt?: string;
  active_arrow_skin?: string;
  activeArrowSkin?: string;
  active_theme?: string;
  activeTheme?: string;
  is_premium?: boolean;
  isPremium?: boolean;
  referrals_count?: number;
  referrals_pending?: number;
}

function normalizeUserResponse(raw: RawUserResponse): User {
  return {
    id: raw.id,
    telegramId: raw.telegramId ?? raw.telegram_id ?? 0,
    username: raw.username ?? null,
    firstName: raw.firstName ?? raw.first_name ?? null,
    photo_url: raw.photo_url ?? null,
    currentLevel: raw.currentLevel ?? raw.current_level ?? 1,
    totalStars: raw.totalStars ?? raw.total_stars ?? 0,
    coins: raw.coins ?? 0,
    energy: raw.energy ?? 0,
    energyUpdatedAt: raw.energyUpdatedAt ?? raw.energy_updated_at ?? '',
    activeArrowSkin: raw.activeArrowSkin ?? raw.active_arrow_skin ?? 'default',
    activeTheme: raw.activeTheme ?? raw.active_theme ?? 'light',
    isPremium: raw.isPremium ?? raw.is_premium ?? false,
    referrals_count: raw.referrals_count ?? 0,
    referrals_pending: raw.referrals_pending ?? 0,
  };
}

// Определяем, запущены ли мы в режиме разработки
const IS_DEV = import.meta.env.DEV;
const DEV_AUTH_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  String(import.meta.env.VITE_ENABLE_DEV_AUTH || '').toLowerCase()
);
const DEV_AUTH_USER_ID = String(import.meta.env.VITE_DEV_AUTH_USER_ID || '').trim();

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

  // Dev заголовок передаем только когда это явно включено через env.
  if (DEV_AUTH_ENABLED && DEV_AUTH_USER_ID) {
    (headers as Record<string, string>)['X-Dev-User-Id'] = DEV_AUTH_USER_ID;
  }

  if (IS_DEV) {
    console.log(
      '🔧 [client] IS_DEV:',
      IS_DEV,
      '| DEV_AUTH_ENABLED:',
      DEV_AUTH_ENABLED,
      '| headers:',
      JSON.stringify(headers)
    );
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
  telegram: async (initData: string): Promise<AuthResponse> => {
    const raw = await request<{ token: string; user: RawUserResponse }>(API_ENDPOINTS.auth.telegram, {
      method: 'POST',
      body: JSON.stringify({ init_data: initData }),
    });
    return {
      token: raw.token,
      user: normalizeUserResponse(raw.user),
    };
  },

  /**
   * Получить текущего пользователя (работает и для dev bypass)
   */
  getMe: async (): Promise<User> =>
    normalizeUserResponse(await request<RawUserResponse>(API_ENDPOINTS.auth.me)),
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
  complete: async (data: CompleteRequest): Promise<CompleteResponse> => {
    const raw = await request<RawCompleteResponse | CompleteResponse>(API_ENDPOINTS.game.complete, {
      method: 'POST',
      body: JSON.stringify({
        level: data.level,
        seed: data.seed,
        moves: data.moves,
        time_seconds: data.timeSeconds,
      }),
    });

    const normalized = raw as RawCompleteResponse & Partial<CompleteResponse>;
    const coinsEarned = normalized.coinsEarned ?? normalized.coins_earned ?? 0;
    const newLevelUnlocked = normalized.newLevelUnlocked ?? normalized.new_level_unlocked ?? false;
    const referralConfirmed = normalized.referralConfirmed ?? normalized.referral_confirmed ?? false;

    return {
      valid: Boolean(normalized.valid),
      stars: normalized.stars ?? 0,
      coinsEarned,
      newLevelUnlocked,
      error: normalized.error,
      referralConfirmed,
    };
  },
  
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
   * Применить реферальный код.
   * Invitee получает +100 монет СРАЗУ.
   * reason: 'already_referred' | 'self_referral' | 'invalid_code' | 'account_too_old'
   */
  applyReferral: (code: string): Promise<ReferralApplyResponse> =>
    request<ReferralApplyResponse>(API_ENDPOINTS.social.applyReferral, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  
  /**
   * Статистика рефералов текущего пользователя
   */
  getReferralStats: (): Promise<ReferralStatsResponse> =>
    request<ReferralStatsResponse>(API_ENDPOINTS.social.referralStats),
  
  /**
   * Список приглашённых рефералов (для вкладки «Мои друзья»)
   */
  getMyReferrals: (): Promise<ReferralListResponse> =>
    request<ReferralListResponse>(API_ENDPOINTS.social.referralList),
  
  /**
   * Глобальный лидерборд рефоводов
   */
  getReferralLeaderboard: (limit = 100): Promise<ReferralLeaderboardResponse> =>
    request<ReferralLeaderboardResponse>(
      `${API_ENDPOINTS.social.referralLeaderboard}?limit=${limit}`
    ),
  
  /**
   * Лидерборд среди друзей (приглашённых)
   */
  getFriendsLeaderboard: (): Promise<LeaderboardResponse> =>
    request<LeaderboardResponse>(API_ENDPOINTS.social.friendsLeaderboard),
  
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