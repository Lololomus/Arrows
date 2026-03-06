import { ApiError, adsApi, authApi } from '../api/client';
import type {
  ActiveRewardIntentResponse,
  RewardIntentStatusResponse,
  RewardPlacement,
} from '../game/types';
import { useAppStore } from '../stores/store';
import { useRewardStore } from '../stores/rewardStore';

const RECONCILE_INTERVAL_MS = 5_000;
const PENDING_INTENTS_LS_KEY = 'arrows_pending_intents';

type PersistedIntent = Pick<ActiveRewardIntentResponse, 'intentId' | 'placement' | 'level' | 'sessionId'>;

function loadPersistedIntents(): PersistedIntent[] {
  try {
    const raw = localStorage.getItem(PENDING_INTENTS_LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PersistedIntent[];
  } catch {
    return [];
  }
}

function savePersistedIntents(intents: PersistedIntent[]): void {
  try {
    localStorage.setItem(PENDING_INTENTS_LS_KEY, JSON.stringify(intents));
  } catch {
    // Private mode or storage quota — ignore.
  }
}

let started = false;
let intervalId: number | null = null;
let inFlight: Promise<void> | null = null;
let visibilityHandler: (() => void) | null = null;
let focusHandler: (() => void) | null = null;

function getRewardToastMessage(status: RewardIntentStatusResponse): string | null {
  if (status.status === 'granted') {
    switch (status.placement) {
      case 'reward_daily_coins':
        return '+20 монет начислены';
      case 'reward_hint':
        return '+3 подсказки начислены';
      case 'reward_revive':
        return 'Награда за продолжение подтверждена';
      case 'reward_spin_retry':
        return 'Респин за рекламу подтвержден';
      default:
        return 'Награда начислена';
    }
  }

  if (status.failureCode === 'AD_NOT_COMPLETED') {
    return null;
  }

  switch (status.failureCode) {
    case 'INTENT_EXPIRED':
      return 'Проверка награды истекла';
    case 'INVALID_SIGNATURE':
      return 'Не удалось подтвердить просмотр рекламы';
    default:
      return null;
  }
}

async function syncGrantedReward(status: RewardIntentStatusResponse): Promise<void> {
  const { setUser, updateUser } = useAppStore.getState();

  if (status.placement === 'reward_daily_coins') {
    if (status.coins != null) {
      updateUser({ coins: status.coins });
      return;
    }
  }

  if (status.placement === 'reward_hint') {
    if (status.hintBalance != null) {
      updateUser({ hintBalance: status.hintBalance });
      return;
    }
  }

  try {
    const me = await authApi.getMe();
    setUser(me);
  } catch {
    // Keep UI state as-is if sync fails; screens can retry on focus.
  }
}

async function handleResolvedIntent(status: RewardIntentStatusResponse): Promise<void> {
  if (status.status === 'granted') {
    await syncGrantedReward(status);
  }

  // Remove from localStorage now that it's resolved.
  const persisted = loadPersistedIntents().filter((i) => i.intentId !== status.intentId);
  savePersistedIntents(persisted);

  useRewardStore.getState().markResolved(status);
  const toast = getRewardToastMessage(status);
  if (toast) {
    useRewardStore.getState().enqueueToast(toast, status.status === 'granted' ? 'success' : 'info');
  }
}

function buildTrackedIntentMap(
  activeIntents: ActiveRewardIntentResponse[],
  previous: Partial<Record<RewardPlacement, ActiveRewardIntentResponse>>,
): Map<string, ActiveRewardIntentResponse> {
  const tracked = new Map<string, ActiveRewardIntentResponse>();
  for (const intent of Object.values(previous)) {
    if (intent) {
      tracked.set(intent.intentId, intent);
    }
  }
  for (const intent of activeIntents) {
    tracked.set(intent.intentId, intent);
  }
  return tracked;
}

export async function reconcileRewardIntents(): Promise<void> {
  if (useAppStore.getState().authStatus !== 'authenticated') {
    return;
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    try {
      const previous = useRewardStore.getState().activeIntents;
      const activeIntents = await adsApi.getActiveRewardIntents();
      useRewardStore.getState().setActiveIntents(activeIntents);

      const tracked = buildTrackedIntentMap(activeIntents, previous);
      for (const intent of tracked.values()) {
        let status: RewardIntentStatusResponse;
        try {
          status = await adsApi.getRewardIntentStatus(intent.intentId);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            throw error;
          }
          continue;
        }

        if (status.status === 'granted' || status.status === 'rejected' || status.status === 'expired') {
          await handleResolvedIntent(status);
          continue;
        }

        useRewardStore.getState().upsertActiveIntent({
          ...intent,
          ...status,
        });
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return;
      }
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export function rememberPendingRewardIntent(
  intent: Pick<ActiveRewardIntentResponse, 'intentId' | 'placement' | 'level' | 'sessionId'>,
): void {
  useRewardStore.getState().upsertActiveIntent({
    intentId: intent.intentId,
    placement: intent.placement,
    status: 'pending',
    reviveGranted: false,
    level: intent.level,
    sessionId: intent.sessionId,
  });

  // Persist so the intent survives app reloads.
  const existing = loadPersistedIntents().filter((i) => i.intentId !== intent.intentId);
  savePersistedIntents([...existing, {
    intentId: intent.intentId,
    placement: intent.placement,
    level: intent.level,
    sessionId: intent.sessionId,
  }]);
}

export function clearPendingRewardIntent(placement: RewardPlacement, intentId?: string): void {
  useRewardStore.getState().clearActiveIntent(placement, intentId);

  // Remove from localStorage.
  const existing = loadPersistedIntents();
  const filtered = intentId
    ? existing.filter((i) => i.intentId !== intentId)
    : existing.filter((i) => i.placement !== placement);
  savePersistedIntents(filtered);
}

export function startRewardReconciler(): void {
  if (started) {
    return;
  }
  started = true;

  // Restore any intents that were pending when the app was last closed.
  for (const intent of loadPersistedIntents()) {
    useRewardStore.getState().upsertActiveIntent({
      intentId: intent.intentId,
      placement: intent.placement,
      status: 'pending',
      reviveGranted: false,
      level: intent.level,
      sessionId: intent.sessionId,
    });
  }

  visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      void reconcileRewardIntents();
    }
  };

  focusHandler = () => {
    void reconcileRewardIntents();
  };

  document.addEventListener('visibilitychange', visibilityHandler);
  window.addEventListener('focus', focusHandler);
  intervalId = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void reconcileRewardIntents();
    }
  }, RECONCILE_INTERVAL_MS);

  void reconcileRewardIntents();
}

export function stopRewardReconciler(): void {
  if (!started) {
    return;
  }
  started = false;
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  if (focusHandler) {
    window.removeEventListener('focus', focusHandler);
    focusHandler = null;
  }
  if (intervalId != null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
}
