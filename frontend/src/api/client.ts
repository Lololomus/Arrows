/**
 * Arrow Puzzle - API Client (OPTIMIZED)
 *
 * Изменения:
 * 1. Добавлен gameApi.completeAndNext() — один запрос вместо двух
 * 2. Типы CompleteAndNextResponse
 */

import { API_URL, API_ENDPOINTS } from '../config/constants';
import { normalizeAuthResponse, normalizeUserResponse, type RawAuthResponse, type RawUserResponse } from './authTransforms';
import { ensureFreshSession, markAuthExpired, reauthenticate } from '../services/authSession';
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
  ShopItem,
  PurchaseCoinsResponse,
  LeaderboardResponse,
  RewardChannel,
  TaskDto,
  TasksResponse,
  TaskClaimResponse,
  User,
  ReferralApplyResponse,
  ReferralStatsResponse,
  ReferralListResponse,
  ReferralLeaderboardResponse,
  AdsStatusResponse,
  ClaimDailyCoinsResponse,
  ClaimHintResponse,
  ClaimReviveResponse,
  ActiveRewardIntentResponse,
  RewardIntentCreateRequest,
  RewardIntentCreateResponse,
  RewardIntentStatusResponse,
  ReviveStatusResponse,
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

interface RawRewardChannel {
  id: string;
  name: string;
  reward_coins?: number;
  rewardCoins?: number;
  claimed: boolean;
}

interface RawTaskTier {
  claim_id?: string;
  claimId?: string;
  target: number;
  reward_coins?: number;
  rewardCoins?: number;
  title: string;
  claimed: boolean;
}

interface RawTaskChannelMeta {
  channel_id?: string;
  channelId?: string;
  name: string;
  username: string;
  url: string;
}

interface RawTaskDto {
  id: TaskDto['id'];
  kind: TaskDto['kind'];
  base_title?: string;
  baseTitle?: string;
  base_description?: string;
  baseDescription?: string;
  progress: number;
  status: TaskDto['status'];
  next_tier_index?: number | null;
  nextTierIndex?: number | null;
  tiers: RawTaskTier[];
  channel?: RawTaskChannelMeta | null;
}

interface RawTasksResponse {
  tasks: RawTaskDto[];
}

interface RawTaskClaimResponse {
  success: boolean;
  claim_id?: string;
  claimId?: string;
  coins: number;
  reward_coins?: number;
  rewardCoins?: number;
  task_id?: string;
  taskId?: string;
  task_status?: TaskDto['status'];
  taskStatus?: TaskDto['status'];
  next_tier_index?: number | null;
  nextTierIndex?: number | null;
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

function normalizeRewardChannel(raw: RawRewardChannel): RewardChannel {
  return {
    id: raw.id,
    name: raw.name,
    rewardCoins: raw.rewardCoins ?? raw.reward_coins ?? 0,
    claimed: raw.claimed,
  };
}

function normalizeTask(raw: RawTaskDto): TaskDto {
  return {
    id: raw.id,
    kind: raw.kind,
    baseTitle: raw.baseTitle ?? raw.base_title ?? '',
    baseDescription: raw.baseDescription ?? raw.base_description ?? '',
    progress: raw.progress,
    status: raw.status,
    nextTierIndex: raw.nextTierIndex ?? raw.next_tier_index ?? null,
    tiers: raw.tiers.map((tier) => ({
      claimId: tier.claimId ?? tier.claim_id ?? '',
      target: tier.target,
      rewardCoins: tier.rewardCoins ?? tier.reward_coins ?? 0,
      title: tier.title,
      claimed: tier.claimed,
    })),
    channel: raw.channel
      ? {
          channelId: raw.channel.channelId ?? raw.channel.channel_id ?? '',
          name: raw.channel.name,
          username: raw.channel.username,
          url: raw.channel.url,
        }
      : undefined,
  };
}

function normalizeTasksResponse(raw: RawTasksResponse): TasksResponse {
  return {
    tasks: raw.tasks.map(normalizeTask),
  };
}

function normalizeTaskClaimResponse(raw: RawTaskClaimResponse): TaskClaimResponse {
  return {
    success: raw.success,
    claimId: raw.claimId ?? raw.claim_id ?? '',
    coins: raw.coins,
    rewardCoins: raw.rewardCoins ?? raw.reward_coins ?? 0,
    taskId: raw.taskId ?? raw.task_id ?? 'official_channel',
    taskStatus: raw.taskStatus ?? raw.task_status ?? 'completed',
    nextTierIndex: raw.nextTierIndex ?? raw.next_tier_index ?? null,
  };
}

interface RawShopItem {
  id: string;
  name: string;
  price_coins?: number | null;
  price_stars?: number | null;
  price_ton?: number | null;
  preview?: string | null;
  owned?: boolean;
}

interface RawShopCatalog {
  arrow_skins?: RawShopItem[];
  themes?: RawShopItem[];
  boosts?: RawShopItem[];
}

function normalizeShopItem(raw: RawShopItem, itemType: ShopItem['itemType']): ShopItem {
  return {
    id: raw.id,
    name: raw.name,
    itemType,
    priceCoins: raw.price_coins ?? null,
    priceStars: raw.price_stars ?? null,
    priceTon: raw.price_ton ?? null,
    preview: raw.preview ?? undefined,
    owned: raw.owned ?? false,
  };
}

function normalizeShopCatalog(raw: RawShopCatalog): ShopCatalog {
  return {
    arrowSkins: (raw.arrow_skins ?? []).map((item) => normalizeShopItem(item, 'arrow_skin')),
    themes: (raw.themes ?? []).map((item) => normalizeShopItem(item, 'theme')),
    boosts: (raw.boosts ?? []).map((item) => normalizeShopItem(item, 'boost')),
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

const DEV_AUTH_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  String(import.meta.env.VITE_ENABLE_DEV_AUTH || '').toLowerCase()
);
const DEV_AUTH_USER_ID = String(import.meta.env.VITE_DEV_AUTH_USER_ID || '').trim();
const DEV_AUTH_ACTIVE = DEV_AUTH_ENABLED && DEV_AUTH_USER_ID.length > 0;
const SESSION_EXPIRED_MESSAGE = 'Сессия истекла. Переоткройте Mini App из Telegram.';
const AUTH_REQUIRED_MESSAGE = 'Требуется авторизация';

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

type RequestAuthMode = 'required' | 'none';

interface RequestOptions extends RequestInit {
  auth?: RequestAuthMode;
  _retry?: boolean;
}

async function parseResponseData(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function parseApiErrorPayload(data: unknown): { message: string; code?: string } {
  if (typeof data === 'string') {
    return { message: data };
  }

  if (typeof data !== 'object' || data === null) {
    return { message: 'Unknown error' };
  }

  const payload = data as Record<string, unknown>;
  const detail = typeof payload.detail === 'object' && payload.detail !== null
    ? payload.detail as Record<string, unknown>
    : null;
  const detailString = typeof payload.detail === 'string' ? payload.detail : undefined;
  const code = firstString(detail?.error, detail?.code, payload.error, payload.code);
  const message = firstString(
    detail?.message,
    detail?.error,
    detail?.code,
    detailString,
    payload.message,
    payload.error,
    payload.code,
  ) ?? 'Unknown error';

  return { message, code };
}

async function executeRequest(
  endpoint: string,
  options: RequestOptions,
  token: string | null,
): Promise<Response> {
  const { auth, _retry, headers: extraHeaders, ...fetchOptions } = options;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders,
  };

  if (DEV_AUTH_ACTIVE) {
    (headers as Record<string, string>)['X-Dev-User-Id'] = DEV_AUTH_USER_ID;
  }

  return fetch(`${API_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
  });
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const authMode = options.auth ?? 'required';
  const managesSession = authMode !== 'none' && !DEV_AUTH_ACTIVE;
  const stateBeforeRequest = useAppStore.getState();

  if (managesSession && stateBeforeRequest.authStatus === 'expired') {
    throw new ApiError(401, stateBeforeRequest.authMessage || SESSION_EXPIRED_MESSAGE);
  }

  if (managesSession) {
    try {
      await ensureFreshSession();
    } catch {
      const expiredState = useAppStore.getState();
      if (expiredState.authStatus === 'expired') {
        throw new ApiError(401, expiredState.authMessage || SESSION_EXPIRED_MESSAGE);
      }
      throw new ApiError(401, AUTH_REQUIRED_MESSAGE);
    }
  }

  const token = authMode === 'none' ? null : useAppStore.getState().token;
  const response = await executeRequest(endpoint, options, token);
  const data = await parseResponseData(response);

  if (!response.ok) {
    if (response.status === 401 && managesSession && !options._retry) {
      try {
        await reauthenticate('401');
      } catch {
        const expiredState = useAppStore.getState();
        throw new ApiError(401, expiredState.authMessage || SESSION_EXPIRED_MESSAGE);
      }
      return request<T>(endpoint, { ...options, _retry: true });
    }

    if (response.status === 401 && managesSession && options._retry) {
      markAuthExpired(SESSION_EXPIRED_MESSAGE);
    }

    const { message, code } = parseApiErrorPayload(data);
    throw new ApiError(response.status, message, code);
  }

  return data as T;
}

// ============================================
// AUTH API
// ============================================

export const authApi = {
  telegram: async (initData: string): Promise<AuthResponse> => {
    const raw = await request<RawAuthResponse>(API_ENDPOINTS.auth.telegram, {
      method: 'POST',
      body: JSON.stringify({ init_data: initData }),
      auth: 'none',
    });
    return normalizeAuthResponse(raw);
  },

  getMe: async (): Promise<User> =>
    normalizeUserResponse(await request<RawUserResponse>(API_ENDPOINTS.auth.me)),

  refresh: async (): Promise<AuthResponse> =>
    normalizeAuthResponse(await request<RawAuthResponse>(API_ENDPOINTS.auth.refresh, {
      method: 'POST',
    })),
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

  getHint: async (
    level: number,
    seed: number,
    remainingArrows: string[]
  ): Promise<HintResponse> => {
    const raw = await request<{ arrow_id?: string; arrowId?: string; hint_balance?: number; hintBalance?: number }>(
      API_ENDPOINTS.game.hint,
      {
        method: 'POST',
        body: JSON.stringify({
          level,
          seed,
          remaining_arrows: remainingArrows,
        }),
      },
    );
    return {
      arrowId: raw.arrowId ?? raw.arrow_id ?? '',
      hintBalance: raw.hintBalance ?? raw.hint_balance ?? 0,
    };
  },
};

// ============================================
// ADS API
// ============================================

export const adsApi = {
  getStatus: async (): Promise<AdsStatusResponse> => {
    const raw = await request<Record<string, unknown>>(API_ENDPOINTS.ads.status);
    const dc = raw.daily_coins as Record<string, unknown> | undefined;
    return {
      eligible: raw.eligible as boolean,
      currentLevel: (raw.current_level ?? raw.currentLevel) as number,
      dailyCoins: {
        used: (dc?.used ?? 0) as number,
        limit: (dc?.limit ?? 3) as number,
        resetsAt: (dc?.resets_at ?? dc?.resetsAt ?? '') as string,
      },
      hintAdAvailable: (raw.hint_ad_available ?? raw.hintAdAvailable ?? false) as boolean,
    };
  },

  claimDailyCoins: async (adReference?: string): Promise<ClaimDailyCoinsResponse> => {
    const raw = await request<Record<string, unknown>>(API_ENDPOINTS.ads.claimDailyCoins, {
      method: 'POST',
      body: JSON.stringify({ ad_reference: adReference }),
    });
    return {
      success: raw.success as boolean,
      coins: raw.coins as number,
      rewardCoins: (raw.reward_coins ?? raw.rewardCoins) as number,
      usedToday: (raw.used_today ?? raw.usedToday) as number,
      limitToday: (raw.limit_today ?? raw.limitToday) as number,
      resetsAt: (raw.resets_at ?? raw.resetsAt) as string,
    };
  },

  claimHint: async (adReference?: string): Promise<ClaimHintResponse> => {
    const raw = await request<Record<string, unknown>>(API_ENDPOINTS.ads.claimHint, {
      method: 'POST',
      body: JSON.stringify({ ad_reference: adReference }),
    });
    return {
      success: raw.success as boolean,
      hintBalance: (raw.hint_balance ?? raw.hintBalance) as number,
    };
  },

  claimRevive: async (
    level: number,
    sessionId: string,
    adReference?: string,
  ): Promise<ClaimReviveResponse> => {
    const raw = await request<Record<string, unknown>>(API_ENDPOINTS.ads.claimRevive, {
      method: 'POST',
      body: JSON.stringify({
        level,
        session_id: sessionId,
        ad_reference: adReference,
      }),
    });
    return {
      success: raw.success as boolean,
      reviveGranted: (raw.revive_granted ?? raw.reviveGranted) as boolean,
      sessionId: (raw.session_id ?? raw.sessionId) as string,
    };
  },

  createRewardIntent: async (payload: RewardIntentCreateRequest): Promise<RewardIntentCreateResponse> => {
    const raw = await request<Record<string, unknown>>(API_ENDPOINTS.ads.rewardIntents, {
      method: 'POST',
      body: JSON.stringify({
        placement: payload.placement,
        level: payload.level,
        session_id: payload.sessionId,
      }),
    });
    return {
      intentId: (raw.intent_id ?? raw.intentId) as string,
      placement: (raw.placement ?? payload.placement) as RewardIntentCreateResponse['placement'],
      status: (raw.status ?? 'pending') as RewardIntentCreateResponse['status'],
      expiresAt: (raw.expires_at ?? raw.expiresAt ?? '') as string,
    };
  },

  getRewardIntentStatus: async (intentId: string): Promise<RewardIntentStatusResponse> => {
    const raw = await request<Record<string, unknown>>(`${API_ENDPOINTS.ads.rewardIntents}/${intentId}`);
    return {
      intentId: (raw.intent_id ?? raw.intentId ?? intentId) as string,
      placement: raw.placement as RewardIntentStatusResponse['placement'],
      status: (raw.status ?? 'pending') as RewardIntentStatusResponse['status'],
      failureCode: (raw.failure_code ?? raw.failureCode) as string | undefined,
      expiresAt: (raw.expires_at ?? raw.expiresAt) as string | undefined,
      createdAt: (raw.created_at ?? raw.createdAt) as string | undefined,
      level: raw.level != null ? Number(raw.level) : undefined,
      sessionId: (raw.session_id ?? raw.sessionId) as string | undefined,
      coins: raw.coins != null ? Number(raw.coins) : undefined,
      hintBalance: raw.hint_balance != null
        ? Number(raw.hint_balance)
        : raw.hintBalance != null
          ? Number(raw.hintBalance)
          : undefined,
      reviveGranted: Boolean(raw.revive_granted ?? raw.reviveGranted),
      revivesUsed: raw.revives_used != null
        ? Number(raw.revives_used)
        : raw.revivesUsed != null
          ? Number(raw.revivesUsed)
          : undefined,
      revivesLimit: raw.revives_limit != null
        ? Number(raw.revives_limit)
        : raw.revivesLimit != null
          ? Number(raw.revivesLimit)
          : undefined,
      usedToday: raw.used_today != null
        ? Number(raw.used_today)
        : raw.usedToday != null
          ? Number(raw.usedToday)
          : undefined,
      limitToday: raw.limit_today != null
        ? Number(raw.limit_today)
        : raw.limitToday != null
          ? Number(raw.limitToday)
          : undefined,
      resetsAt: (raw.resets_at ?? raw.resetsAt) as string | undefined,
    };
  },

  getActiveRewardIntents: async (): Promise<ActiveRewardIntentResponse[]> => {
    const raw = await request<Record<string, unknown>[]>(API_ENDPOINTS.ads.activeRewardIntents);
    return raw.map((item) => ({
      intentId: (item.intent_id ?? item.intentId) as string,
      placement: item.placement as ActiveRewardIntentResponse['placement'],
      status: (item.status ?? 'pending') as ActiveRewardIntentResponse['status'],
      failureCode: (item.failure_code ?? item.failureCode) as string | undefined,
      expiresAt: (item.expires_at ?? item.expiresAt) as string | undefined,
      createdAt: (item.created_at ?? item.createdAt) as string | undefined,
      level: item.level != null ? Number(item.level) : undefined,
      sessionId: (item.session_id ?? item.sessionId) as string | undefined,
      coins: item.coins != null ? Number(item.coins) : undefined,
      hintBalance: item.hint_balance != null
        ? Number(item.hint_balance)
        : item.hintBalance != null
          ? Number(item.hintBalance)
          : undefined,
      reviveGranted: Boolean(item.revive_granted ?? item.reviveGranted),
      revivesUsed: item.revives_used != null
        ? Number(item.revives_used)
        : item.revivesUsed != null
          ? Number(item.revivesUsed)
          : undefined,
      revivesLimit: item.revives_limit != null
        ? Number(item.revives_limit)
        : item.revivesLimit != null
          ? Number(item.revivesLimit)
          : undefined,
      usedToday: item.used_today != null
        ? Number(item.used_today)
        : item.usedToday != null
          ? Number(item.usedToday)
          : undefined,
      limitToday: item.limit_today != null
        ? Number(item.limit_today)
        : item.limitToday != null
          ? Number(item.limitToday)
          : undefined,
      resetsAt: (item.resets_at ?? item.resetsAt) as string | undefined,
    }));
  },

  cancelRewardIntent: async (intentId: string): Promise<RewardIntentStatusResponse> => {
    const raw = await request<Record<string, unknown>>(`${API_ENDPOINTS.ads.rewardIntents}/${intentId}/cancel`, {
      method: 'POST',
    });
    return {
      intentId: (raw.intent_id ?? raw.intentId ?? intentId) as string,
      placement: raw.placement as RewardIntentStatusResponse['placement'],
      status: (raw.status ?? 'rejected') as RewardIntentStatusResponse['status'],
      failureCode: (raw.failure_code ?? raw.failureCode) as string | undefined,
      expiresAt: (raw.expires_at ?? raw.expiresAt) as string | undefined,
      createdAt: (raw.created_at ?? raw.createdAt) as string | undefined,
      level: raw.level != null ? Number(raw.level) : undefined,
      sessionId: (raw.session_id ?? raw.sessionId) as string | undefined,
      coins: raw.coins != null ? Number(raw.coins) : undefined,
      hintBalance: raw.hint_balance != null
        ? Number(raw.hint_balance)
        : raw.hintBalance != null
          ? Number(raw.hintBalance)
          : undefined,
      reviveGranted: Boolean(raw.revive_granted ?? raw.reviveGranted),
      revivesUsed: raw.revives_used != null
        ? Number(raw.revives_used)
        : raw.revivesUsed != null
          ? Number(raw.revivesUsed)
          : undefined,
      revivesLimit: raw.revives_limit != null
        ? Number(raw.revives_limit)
        : raw.revivesLimit != null
          ? Number(raw.revivesLimit)
          : undefined,
      usedToday: raw.used_today != null
        ? Number(raw.used_today)
        : raw.usedToday != null
          ? Number(raw.usedToday)
          : undefined,
      limitToday: raw.limit_today != null
        ? Number(raw.limit_today)
        : raw.limitToday != null
          ? Number(raw.limitToday)
          : undefined,
      resetsAt: (raw.resets_at ?? raw.resetsAt) as string | undefined,
    };
  },

  clientCompleteRewardIntent: async (intentId: string): Promise<RewardIntentStatusResponse> => {
    const raw = await request<Record<string, unknown>>(
      `${API_ENDPOINTS.ads.rewardIntents}/${intentId}/client-complete`,
      { method: 'POST' },
    );
    return {
      intentId: (raw.intent_id ?? raw.intentId ?? intentId) as string,
      placement: raw.placement as RewardIntentStatusResponse['placement'],
      status: (raw.status ?? 'pending') as RewardIntentStatusResponse['status'],
      failureCode: (raw.failure_code ?? raw.failureCode) as string | undefined,
      expiresAt: (raw.expires_at ?? raw.expiresAt) as string | undefined,
      createdAt: (raw.created_at ?? raw.createdAt) as string | undefined,
      level: raw.level != null ? Number(raw.level) : undefined,
      sessionId: (raw.session_id ?? raw.sessionId) as string | undefined,
      coins: raw.coins != null ? Number(raw.coins) : undefined,
      hintBalance: raw.hint_balance != null
        ? Number(raw.hint_balance)
        : raw.hintBalance != null
          ? Number(raw.hintBalance)
          : undefined,
      reviveGranted: Boolean(raw.revive_granted ?? raw.reviveGranted),
      revivesUsed: raw.revives_used != null
        ? Number(raw.revives_used)
        : raw.revivesUsed != null
          ? Number(raw.revivesUsed)
          : undefined,
      revivesLimit: raw.revives_limit != null
        ? Number(raw.revives_limit)
        : raw.revivesLimit != null
          ? Number(raw.revivesLimit)
          : undefined,
      usedToday: raw.used_today != null
        ? Number(raw.used_today)
        : raw.usedToday != null
          ? Number(raw.usedToday)
          : undefined,
      limitToday: raw.limit_today != null
        ? Number(raw.limit_today)
        : raw.limitToday != null
          ? Number(raw.limitToday)
          : undefined,
      resetsAt: (raw.resets_at ?? raw.resetsAt) as string | undefined,
    };
  },

  getReviveStatus: async (level: number): Promise<ReviveStatusResponse> => {
    const raw = await request<Record<string, unknown>>(`${API_ENDPOINTS.ads.reviveStatus}?level=${level}`);
    return {
      eligible: Boolean(raw.eligible),
      level: Number(raw.level ?? level),
      used: Number(raw.used ?? 0),
      limit: Number(raw.limit ?? 0),
      remaining: Number(raw.remaining ?? 0),
    };
  },
};

// ============================================
// SHOP API
// ============================================

export const shopApi = {
  getCatalog: async (): Promise<ShopCatalog> =>
    normalizeShopCatalog(await request<RawShopCatalog>(API_ENDPOINTS.shop.catalog)),

  purchaseCoins: (
    itemType: string,
    itemId: string
  ): Promise<PurchaseCoinsResponse> =>
    request<Record<string, unknown>>(API_ENDPOINTS.shop.purchaseCoins, {
      method: 'POST',
      body: JSON.stringify({ item_type: itemType, item_id: itemId }),
    }).then((raw) => ({
      success: Boolean(raw.success),
      coins: Number(raw.coins ?? 0),
      hintBalance: raw.hintBalance != null
        ? Number(raw.hintBalance)
        : raw.hint_balance != null
          ? Number(raw.hint_balance)
          : undefined,
      error: typeof raw.error === 'string' ? raw.error : undefined,
    })),

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
    request<RawRewardChannel[]>(API_ENDPOINTS.social.channels).then((raw) => raw.map(normalizeRewardChannel)),

  claimChannel: (channelId: string): Promise<{ success: boolean; coins: number }> =>
    request<{ success: boolean; coins: number }>(API_ENDPOINTS.social.claimChannel, {
      method: 'POST',
      body: JSON.stringify({ channel_id: channelId }),
    }),
};

export const tasksApi = {
  getTasks: async (): Promise<TasksResponse> =>
    normalizeTasksResponse(await request<RawTasksResponse>(API_ENDPOINTS.tasks.list)),

  claimTask: async (claimId: string): Promise<TaskClaimResponse> =>
    normalizeTaskClaimResponse(await request<RawTaskClaimResponse>(API_ENDPOINTS.tasks.claim, {
      method: 'POST',
      body: JSON.stringify({ claim_id: claimId }),
    })),
};

// ============================================
// HELPER FUNCTIONS
// ============================================

export function sendAuthorizedKeepalive(endpoint: string, body: unknown): void {
  const { token, authStatus } = useAppStore.getState();
  if (authStatus === 'expired' || authStatus === 'reauthenticating') {
    return;
  }
  if (!token && !DEV_AUTH_ACTIVE) {
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (DEV_AUTH_ACTIVE) {
    headers['X-Dev-User-Id'] = DEV_AUTH_USER_ID;
  }

  void fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => undefined);
}

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
