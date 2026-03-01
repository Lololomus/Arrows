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

export type RewardedFlowOutcome = 'granted' | 'rejected' | 'timeout' | 'ad_failed' | 'error';

export interface RewardedFlowResult {
  outcome: RewardedFlowOutcome;
  intentId: string | null;
  status?: RewardIntentStatusResponse;
  failureCode?: string;
  error?: string;
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
      };
    }
    return {
      outcome: 'error',
      intentId,
      error: error instanceof Error ? error.message : lastError ?? 'request_failed',
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
      outcome: 'ad_failed',
      intentId: null,
      error: preflight.error,
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
      };
    }
    return {
      outcome: 'error',
      intentId: null,
      error: error instanceof Error ? error.message : 'request_failed',
    };
  }

  const adResult = await showRewardedAd(blockId);
  if (!adResult.success) {
    return {
      outcome: 'ad_failed',
      intentId: intent.intentId,
      error: adResult.error,
    };
  }
  return pollRewardIntent(intent.intentId);
}

export function getRewardedFlowMessage(
  placement: RewardPlacement,
  result: Pick<RewardedFlowResult, 'outcome' | 'failureCode' | 'error'>,
): string {
  if (result.outcome === 'timeout') {
    return 'Награда проверяется. Нажмите ещё раз, чтобы проверить результат.';
  }

  if (result.outcome === 'ad_failed') {
    switch (result.error) {
      case 'disabled':
      case 'no_block_id':
      case 'invalid_block_id':
      case 'sdk_not_loaded':
        return 'Реклама недоступна';
      default:
        return 'Не удалось досмотреть рекламу. Попробуйте ещё раз.';
    }
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
    case 'INTENT_EXPIRED':
    case 'INTENT_SUPERSEDED':
      return 'Проверка награды истекла, попробуйте снова';
    case 'REWARD_INTENT_ALREADY_PENDING':
      return 'Награда еще проверяется. Попробуйте снова через несколько секунд.';
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
