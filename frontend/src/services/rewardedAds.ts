import { ApiError, adsApi } from '../api/client';
import type {
  RewardPlacement,
  RewardIntentCreateRequest,
  RewardIntentStatusResponse,
} from '../game/types';
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
  | 'error';

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

export async function runRewardedFlow(
  blockId: string,
  payload: RewardIntentCreateRequest,
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
      // Fallback to polling if client-complete fails (webhook may still grant)
      return pollRewardIntent(intent.intentId);
    }
  }

  if (adResult.outcome === 'not_completed') {
    try {
      await adsApi.cancelRewardIntent(intent.intentId);
    } catch {
      // Best effort only: stale pending intents still expire on the server.
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

export function getRewardedFlowMessage(
  placement: RewardPlacement,
  result: Pick<RewardedFlowResult, 'outcome' | 'failureCode' | 'error'>,
): string {
  if (result.outcome === 'timeout') {
    return 'Подтверждение рекламы задерживается. Мы продолжим проверку автоматически.';
  }

  if (result.outcome === 'unavailable') {
    return 'Реклама временно недоступна';
  }

  if (result.outcome === 'not_completed') {
    return 'Реклама была закрыта до завершения. Награда не зачислена.';
  }

  if (result.outcome === 'provider_error') {
    return 'Мы ждём подтверждение от AdsGram. Награда начислится автоматически, как только просмотр подтвердится.';
  }

  if (result.outcome === 'error') {
    return 'Не удалось связаться с сервером. Попробуйте ещё раз.';
  }

  switch (result.failureCode) {
    case 'DAILY_LIMIT_REACHED':
      return 'Лимит наград на сегодня исчерпан';
    case 'HINT_BALANCE_NOT_ZERO':
      return 'У вас уже есть подсказки';
    case 'REVIVE_ALREADY_USED':
      return 'Награда уже была выдана';
    case 'REVIVE_LIMIT_REACHED':
      return 'Лимит воскрешений на этом уровне исчерпан';
    case 'ADS_LOCKED_BEFORE_LEVEL_21':
      return 'Реклама доступна с уровня 21';
    case 'AD_NOT_COMPLETED':
      return 'Реклама была закрыта до завершения. Награда не зачислена.';
    case 'INTENT_EXPIRED':
    case 'INTENT_SUPERSEDED':
      return 'Проверка награды истекла, попробуйте снова';
    case 'REWARD_INTENT_ALREADY_PENDING':
      return 'Награда уже проверяется. Мы продолжим проверку автоматически.';
    default:
      if (placement === 'reward_hint') {
        return 'Не удалось получить подсказку';
      }
      if (placement === 'reward_revive') {
        return 'Не удалось получить воскрешение';
      }
      return 'Не удалось получить награду';
  }
}
