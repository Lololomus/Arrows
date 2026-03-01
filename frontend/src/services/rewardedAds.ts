import { adsApi } from '../api/client';
import type {
  RewardIntentCreateRequest,
  RewardIntentStatusResponse,
} from '../game/types';
import { showRewardedAd } from './adsgram';

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 45_000;

export type RewardedFlowOutcome = 'granted' | 'rejected' | 'timeout' | 'ad_failed';

export interface RewardedFlowResult {
  outcome: RewardedFlowOutcome;
  intentId: string;
  status?: RewardIntentStatusResponse;
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

  while (Date.now() - startedAt < timeoutMs) {
    const status = await adsApi.getRewardIntentStatus(intentId);
    if (status.status === 'granted') {
      return { outcome: 'granted', intentId, status };
    }
    if (status.status === 'rejected' || status.status === 'expired') {
      return { outcome: 'rejected', intentId, status };
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const status = await adsApi.getRewardIntentStatus(intentId);
  if (status.status === 'granted') {
    return { outcome: 'granted', intentId, status };
  }
  if (status.status === 'rejected' || status.status === 'expired') {
    return { outcome: 'rejected', intentId, status };
  }
  return { outcome: 'timeout', intentId, status };
}

export async function runRewardedFlow(
  blockId: string,
  payload: RewardIntentCreateRequest,
): Promise<RewardedFlowResult> {
  const intent = await adsApi.createRewardIntent(payload);
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
