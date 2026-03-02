import { create } from 'zustand';
import type {
  ActiveRewardIntentResponse,
  RewardIntentStatusResponse,
  RewardPlacement,
} from '../game/types';

export interface RewardToast {
  id: string;
  tone: 'success' | 'info' | 'error';
  message: string;
}

export interface RewardResolutionEvent extends RewardIntentStatusResponse {
  resolvedAt: number;
}

type ActiveRewardIntentMap = Partial<Record<RewardPlacement, ActiveRewardIntentResponse>>;
type RewardResolutionMap = Partial<Record<RewardPlacement, RewardResolutionEvent>>;

interface RewardStoreState {
  activeIntents: ActiveRewardIntentMap;
  lastResolved: RewardResolutionMap;
  toasts: RewardToast[];
  setActiveIntents: (intents: ActiveRewardIntentResponse[]) => void;
  upsertActiveIntent: (intent: ActiveRewardIntentResponse) => void;
  clearActiveIntent: (placement: RewardPlacement, intentId?: string) => void;
  markResolved: (status: RewardIntentStatusResponse) => void;
  clearResolved: (placement: RewardPlacement, intentId?: string) => void;
  enqueueToast: (message: string, tone?: RewardToast['tone']) => void;
  dismissToast: (id: string) => void;
}

function createToast(message: string, tone: RewardToast['tone']): RewardToast {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    tone,
    message,
  };
}

export const useRewardStore = create<RewardStoreState>()((set, get) => ({
  activeIntents: {},
  lastResolved: {},
  toasts: [],

  setActiveIntents: (intents) => {
    const next: ActiveRewardIntentMap = {};
    for (const intent of intents) {
      next[intent.placement] = intent;
    }
    set({ activeIntents: next });
  },

  upsertActiveIntent: (intent) => set((state) => ({
    activeIntents: {
      ...state.activeIntents,
      [intent.placement]: intent,
    },
  })),

  clearActiveIntent: (placement, intentId) => set((state) => {
    const current = state.activeIntents[placement];
    if (!current || (intentId && current.intentId !== intentId)) {
      return state;
    }
    const next = { ...state.activeIntents };
    delete next[placement];
    return { activeIntents: next };
  }),

  markResolved: (status) => set((state) => {
    const nextActive = { ...state.activeIntents };
    const current = nextActive[status.placement];
    if (current?.intentId === status.intentId) {
      delete nextActive[status.placement];
    }
    return {
      activeIntents: nextActive,
      lastResolved: {
        ...state.lastResolved,
        [status.placement]: {
          ...status,
          resolvedAt: Date.now(),
        },
      },
    };
  }),

  clearResolved: (placement, intentId) => set((state) => {
    const current = state.lastResolved[placement];
    if (!current || (intentId && current.intentId !== intentId)) {
      return state;
    }
    const next = { ...state.lastResolved };
    delete next[placement];
    return { lastResolved: next };
  }),

  enqueueToast: (message, tone = 'info') => set((state) => ({
    toasts: [...state.toasts, createToast(message, tone)],
  })),

  dismissToast: (id) => set((state) => ({
    toasts: state.toasts.filter((toast) => toast.id !== id),
  })),
}));

export function getActiveRewardIntent(placement: RewardPlacement): ActiveRewardIntentResponse | null {
  return getPlacementIntent(get().activeIntents, placement);
}

function getPlacementIntent(
  activeIntents: ActiveRewardIntentMap,
  placement: RewardPlacement,
): ActiveRewardIntentResponse | null {
  return activeIntents[placement] ?? null;
}

function get() {
  return useRewardStore.getState();
}
