/**
 * Arrow Puzzle - API Client (OPTIMIZED)
 *
 * Изменения:
 * 1. Добавлен gameApi.completeAndNext() — один запрос вместо двух
 * 2. Типы CompleteAndNextResponse
 */

import { API_URL, API_ENDPOINTS } from '../config/constants';
import { useAppStore } from '../stores/store';
import type {
  AuthResponse,
  LevelResponse,
  CompleteRequest,
  CompleteResponse,
  CompleteAndNextResponse,
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

// === NEW: Тип ответа от complete-and-next ===
export type { CompleteAndNextResponse } from '../game/types';

interface RawCompleteResponse {
  valid: boolean;
  stars?: number;
  coins_earned?: number;
  total_coins?: number;
  current_level?: number;
  new_level_unlocked?: boolean;
  already_completed?: boolean;
  error?: string;
  referral_confirmed?: boolean;
}

interface RawCompleteAndNextResponse {
  completion: RawCompleteResponse & Partial<CompleteResponse>;
  next_level: LevelResponse | null;
  next_level_exists?: boolean;
}

// --- Raw leaderboard types (snake_case from backend) ---

interface RawLeaderboardEntry {
  rank: number;
  user_id: number;
  username: string | null;
  first_name: string | null;
  photo_url?: string | null;
  score: number;
}

interface RawLeaderboardResponse {
  leaders: RawLeaderboardEntry[];
  my_position: number | null;
  my_score?: number | null;
  my_in_top?: boolean;
  total_participants?: number;
}

function normalizeLeaderboardResponse(raw: RawLeaderboardResponse): LeaderboardResponse {
  return {
    leaders: raw.leaders.map(e => ({
      rank: e.rank,
      userId: e.user_id,
      username: e.username,
      firstName: e.first_name,
      score: e.score,
      photoUrl: e.photo_url ?? null,
    })),
    myPosition: raw.my_position,
    myScore: raw.my_score ?? null,
    myInTop: raw.my_in_top ?? false,
    totalParticipants: raw.total_participants ?? 0,
  };
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

function normalizeCompleteResponse(
  raw: RawCompleteResponse & Partial<CompleteResponse>,
  requestedLevel?: number,
): CompleteResponse {
  const newLevelUnlocked = raw.newLevelUnlocked ?? raw.new_level_unlocked ?? false;
  const currentLevel = raw.currentLevel
    ?? raw.current_level
    ?? (typeof requestedLevel === 'number'
      ? (newLevelUnlocked ? requestedLevel + 1 : requestedLevel)
      : 1);

  return {
    valid: Boolean(raw.valid),
    stars: raw.stars ?? 0,
    coinsEarned: raw.coinsEarned ?? raw.coins_earned ?? 0,
    totalCoins: raw.totalCoins ?? raw.total_coins,
    currentLevel,
    newLevelUnlocked,
    alreadyCompleted: raw.alreadyCompleted ?? raw.already_completed ?? false,
    error: raw.error,
    referralConfirmed: raw.referralConfirmed ?? raw.referral_confirmed ?? false,
  };
}

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

  if (DEV_AUTH_ENABLED && DEV_AUTH_USER_ID) {
    (headers as Record<string, string>)['X-Dev-User-Id'] = DEV_AUTH_USER_ID;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  let data: any;
  const contentType = response.headers.get('content-type');

  if (contentType?.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

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

  getMe: async (): Promise<User> =>
    normalizeUserResponse(await request<RawUserResponse>(API_ENDPOINTS.auth.me)),
};

// ============================================
// GAME API
// ============================================

export const gameApi = {
  getLevel: (level: number): Promise<LevelResponse> =>
    request<LevelResponse>(API_ENDPOINTS.game.level(level)),

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
    return normalizeCompleteResponse(raw as RawCompleteResponse & Partial<CompleteResponse>, data.level);
  },

  /**
   * === NEW: Атомарный complete + загрузка следующего уровня ===
   * Один запрос вместо двух. Сервер проверяет, сохраняет, и сразу
   * возвращает данные следующего уровня (если он существует).
   */
  completeAndNext: async (data: CompleteRequest): Promise<CompleteAndNextResponse> => {
    try {
      const raw = await request<RawCompleteAndNextResponse>(
        API_ENDPOINTS.game.completeAndNext ?? '/game/complete-and-next',
        {
          method: 'POST',
          body: JSON.stringify({
            level: data.level,
            seed: data.seed,
            moves: data.moves,
            time_seconds: data.timeSeconds,
          }),
        }
      );
      return {
        completion: normalizeCompleteResponse(raw.completion, data.level),
        nextLevel: raw.next_level ?? null,
        nextLevelExists: raw.next_level_exists ?? raw.next_level != null,
      };
    } catch (error) {
      if (!(error instanceof ApiError) || ![404, 405, 501].includes(error.status)) {
        throw error;
      }

      const completion = await gameApi.complete(data);
      const shouldTryPrefetch = completion.valid && completion.currentLevel > data.level;
      if (!shouldTryPrefetch) {
        return {
          completion,
          nextLevel: null,
          nextLevelExists: false,
        };
      }

      try {
        const nextLevel = await gameApi.getLevel(completion.currentLevel);
        return {
          completion,
          nextLevel,
          nextLevelExists: true,
        };
      } catch (prefetchError) {
        if (prefetchError instanceof ApiError && prefetchError.status === 404) {
          return {
            completion,
            nextLevel: null,
            nextLevelExists: false,
          };
        }
        return {
          completion,
          nextLevel: null,
          nextLevelExists: true,
        };
      }
    }
  },

  getEnergy: (): Promise<EnergyResponse> =>
    request<EnergyResponse>(API_ENDPOINTS.game.energy),

  resetProgress: (): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(API_ENDPOINTS.game.reset || '/game/reset', {
      method: 'POST',
    }),

  restoreEnergyAd: (adId: string): Promise<{ energy: number }> =>
    request<{ energy: number }>(API_ENDPOINTS.game.energyAd, {
      method: 'POST',
      body: JSON.stringify({ ad_id: adId }),
    }),

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
  getCatalog: (): Promise<ShopCatalog> =>
    request<ShopCatalog>(API_ENDPOINTS.shop.catalog),

  purchaseCoins: (
    itemType: string,
    itemId: string
  ): Promise<{ success: boolean; coins: number }> =>
    request<{ success: boolean; coins: number }>(API_ENDPOINTS.shop.purchaseCoins, {
      method: 'POST',
      body: JSON.stringify({ item_type: itemType, item_id: itemId }),
    }),

  purchaseStars: (
    itemType: string,
    itemId: string
  ): Promise<{ invoice_url: string }> =>
    request<{ invoice_url: string }>(API_ENDPOINTS.shop.purchaseStars, {
      method: 'POST',
      body: JSON.stringify({ item_type: itemType, item_id: itemId }),
    }),

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
  getReferralCode: (): Promise<{ code: string; link: string }> =>
    request<{ code: string; link: string }>(API_ENDPOINTS.social.referralCode),

  applyReferral: (code: string): Promise<ReferralApplyResponse> =>
    request<ReferralApplyResponse>(API_ENDPOINTS.social.applyReferral, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  getReferralStats: (): Promise<ReferralStatsResponse> =>
    request<ReferralStatsResponse>(API_ENDPOINTS.social.referralStats),

  getMyReferrals: (): Promise<ReferralListResponse> =>
    request<ReferralListResponse>(API_ENDPOINTS.social.referralList),

  getReferralLeaderboard: (limit = 100): Promise<ReferralLeaderboardResponse> =>
    request<ReferralLeaderboardResponse>(
      `${API_ENDPOINTS.social.referralLeaderboard}?limit=${limit}`
    ),

  getLeaderboard: async (
    type: 'global' | 'weekly' | 'arcade',
    limit = 100
  ): Promise<LeaderboardResponse> => {
    const raw = await request<RawLeaderboardResponse>(
      `${API_ENDPOINTS.social.leaderboard(type)}?limit=${limit}`
    );
    return normalizeLeaderboardResponse(raw);
  },

  getFriendsLeaderboard: async (): Promise<LeaderboardResponse> => {
    const raw = await request<RawLeaderboardResponse>(
      API_ENDPOINTS.social.friendsLeaderboard
    );
    return normalizeLeaderboardResponse(raw);
  },

  getChannels: (): Promise<RewardChannel[]> =>
    request<RewardChannel[]>(API_ENDPOINTS.social.channels),

  claimChannel: (channelId: string): Promise<{ success: boolean; coins: number }> =>
    request<{ success: boolean; coins: number }>(API_ENDPOINTS.social.claimChannel, {
      method: 'POST',
      body: JSON.stringify({ channel_id: channelId }),
    }),
};

// ============================================
// HELPER FUNCTIONS
// ============================================

export const checkApiHealth = async (): Promise<boolean> => {
  try {
    await fetch(`${API_URL}/health`, { method: 'GET' });
    return true;
  } catch {
    return false;
  }
};

export const handleApiError = (error: unknown): string => {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401: return 'Требуется авторизация';
      case 403: return 'Доступ запрещён';
      case 404: return 'Не найдено';
      case 400:
        if (error.code === 'NO_ENERGY') return 'Недостаточно энергии';
        return error.message;
      case 500: return 'Ошибка сервера';
      default: return error.message;
    }
  }
  if (error instanceof Error) return error.message;
  return 'Неизвестная ошибка';
};
