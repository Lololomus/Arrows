import { ApiError, adsApi } from '../api/client';
import type {
  RewardPlacement,
  RewardIntentCreateRequest,
  RewardIntentStatusResponse,
} from '../game/types';
import { getErrorCodeMessage } from '../i18n/content';
import { translate } from '../i18n';
import { preflightAdsgramAd, showRewardedAd } from './adsgram';

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 45_000;
export const PENDING_RETRY_TIMEOUT_MS = 10_000;

export type RewardedFlowOutcome =
  | 'granted'
  | 'rejected'
  | 'timeout'
  | 'not_completed'
  | 'provider_error'
  | 'unavailable'
  | 'error'
  | 'completed';

export interface RewardedFlowResult {
  outcome: RewardedFlowOutcome;
  intentId: string | null;
  status?: RewardIntentStatusResponse;
  failureCode?: string;
  error?: string;
  retriable?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function pollRewardIntent(
  intentId: string,
  timeoutMs = POLL_TIMEOUT_MS,
): Promise<RewardedFlowResult> {
  const startedAt = Date.now();
  let lastKnownStatus: RewardIntentStatusResponse | undefined;
  let lastError: string | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await adsApi.getRewardIntentStatus(intentId);
      lastKnownStatus = status;
      if (status.status === 'granted') {
        return { outcome: 'granted', intentId, status };
      }
      if (status.status === 'rejected' || status.status === 'expired') {
        return {
          outcome: 'rejected',
          intentId,
          status,
          failureCode: status.failureCode,
        };
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw error;
      }
      lastError = error instanceof Error ? error.message : 'request_failed';
    }
    await sleep(POLL_INTERVAL_MS);
  }

  try {
    const status = await adsApi.getRewardIntentStatus(intentId);
    if (status.status === 'granted') {
      return { outcome: 'granted', intentId, status };
    }
    if (status.status === 'rejected' || status.status === 'expired') {
      return {
        outcome: 'rejected',
        intentId,
        status,
        failureCode: status.failureCode,
      };
    }
    return {
      outcome: 'timeout',
      intentId,
      status,
      failureCode: status.failureCode,
      retriable: true,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw error;
    }
    if (lastKnownStatus) {
      return {
        outcome: 'timeout',
        intentId,
        status: lastKnownStatus,
        failureCode: lastKnownStatus.failureCode,
        retriable: true,
      };
    }
    return {
      outcome: 'error',
      intentId,
      error: error instanceof Error ? error.message : lastError ?? 'request_failed',
      retriable: true,
    };
  }
}

export interface RewardedFlowOptions {
  optimistic?: boolean;
}

export async function runRewardedFlow(
  blockId: string,
  payload: RewardIntentCreateRequest,
  options: RewardedFlowOptions = {},
): Promise<RewardedFlowResult> {
  const preflight = preflightAdsgramAd('rewarded', blockId);
  if (!preflight.ok) {
    return {
      outcome: 'unavailable',
      intentId: null,
      error: preflight.error,
      retriable: false,
    };
  }

  let intent;
  try {
    intent = await adsApi.createRewardIntent(payload);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw error;
    }
    if (error instanceof ApiError && (error.status === 409 || error.status === 422)) {
      return {
        outcome: 'rejected',
        intentId: null,
        failureCode: error.code ?? error.message,
        error: error.message,
        retriable: false,
      };
    }
    return {
      outcome: 'error',
      intentId: null,
      error: error instanceof Error ? error.message : 'request_failed',
      retriable: true,
    };
  }

  const adResult = await showRewardedAd(blockId);
  if (adResult.success) {
    if (options.optimistic) {
      void adsApi.clientCompleteRewardIntent(intent.intentId).catch(() => undefined);
      return { outcome: 'completed', intentId: intent.intentId, retriable: false };
    }

    try {
      const status = await adsApi.clientCompleteRewardIntent(intent.intentId);
      if (status.status === 'granted') {
        return { outcome: 'granted', intentId: intent.intentId, status };
      }
      return {
        outcome: 'rejected',
        intentId: intent.intentId,
        status,
        failureCode: status.failureCode,
      };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw error;
      }
      return pollRewardIntent(intent.intentId);
    }
  }

  if (adResult.outcome === 'not_completed') {
    try {
      await adsApi.cancelRewardIntent(intent.intentId);
    } catch {
      // Best effort only.
    }
    return {
      outcome: 'not_completed',
      intentId: null,
      error: adResult.error,
      retriable: true,
    };
  }

  return {
    outcome: 'provider_error',
    intentId: intent.intentId,
    error: adResult.error,
    retriable: true,
  };
}

function getPlacementFallbackMessage(placement: RewardPlacement): string {
  if (placement === 'reward_hint') {
    return translate('errors:generic.server');
  }
  if (placement === 'reward_revive') {
    return translate('errors:generic.server');
  }
  if (placement === 'reward_spin_retry') {
    return getErrorCodeMessage('SPIN_RETRY_NOT_AVAILABLE', translate('errors:generic.server'));
  }
  if (placement === 'reward_task') {
    return translate('errors:generic.server');
  }
  return translate('errors:generic.server');
}

export function getRewardedFlowMessage(
  placement: RewardPlacement,
  result: Pick<RewardedFlowResult, 'outcome' | 'failureCode' | 'error'>,
): string {
  if (result.outcome === 'timeout') {
    return translate('tasks:dailyCoins.checking');
  }

  if (result.outcome === 'unavailable') {
    return translate('errors:generic.network');
  }

  if (result.outcome === 'not_completed') {
    return getErrorCodeMessage('AD_NOT_COMPLETED', translate('errors:generic.server'));
  }

  if (result.outcome === 'provider_error') {
    return translate('tasks:dailyCoins.checking');
  }

  if (result.outcome === 'error') {
    return translate('errors:generic.network');
  }

  if (result.failureCode) {
    const byCode = getErrorCodeMessage(result.failureCode);
    if (byCode) {
      return byCode;
    }
  }

  return getPlacementFallbackMessage(placement);
}
