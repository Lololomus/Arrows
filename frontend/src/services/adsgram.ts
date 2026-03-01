/**
 * AdsGram SDK Service
 *
 * Единая точка работы с AdsGram SDK.
 * Fail-closed: если что-то не так — возвращаем ошибку, не ломаем приложение.
 */

import { ADS_ENABLED } from '../config/constants';

// ============================================
// TypeScript declarations for AdsGram SDK
// ============================================

interface AdsgramAdController {
  show(): Promise<AdsgramShowResult>;
  destroy(): void;
}

interface AdsgramShowResult {
  done: boolean;
  description: string;
  state: 'load' | 'render' | 'playing' | 'destroy';
  error: boolean;
}

declare global {
  interface Window {
    Adsgram?: {
      init(params: { blockId: string; debug?: boolean }): AdsgramAdController;
    };
  }
}

// ============================================
// Result type
// ============================================

export interface AdsgramResult {
  success: boolean;
  error?: string;
}

export type AdsgramAdKind = 'rewarded' | 'interstitial';

export interface AdsgramPreflightResult {
  ok: boolean;
  blockId?: string;
  error?: string;
}

// ============================================
// Internal helpers
// ============================================

const AD_TIMEOUT_MS = 30_000;
const INTERSTITIAL_PREFIX = 'int-';

function normalizeBlockId(rawBlockId: string): string {
  return rawBlockId.trim();
}

export function isValidInterstitialBlockId(rawBlockId: string): boolean {
  const blockId = normalizeBlockId(rawBlockId);
  return blockId.length > 0 && blockId.startsWith(INTERSTITIAL_PREFIX);
}

export function isValidRewardedBlockId(rawBlockId: string): boolean {
  const blockId = normalizeBlockId(rawBlockId);
  return blockId.length > 0 && !blockId.startsWith(INTERSTITIAL_PREFIX);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export function preflightAdsgramAd(kind: AdsgramAdKind, rawBlockId: string): AdsgramPreflightResult {
  if (!ADS_ENABLED) {
    return { ok: false, error: 'disabled' };
  }

  const blockId = normalizeBlockId(rawBlockId);
  if (!blockId) {
    return { ok: false, error: 'no_block_id' };
  }

  const valid = kind === 'interstitial'
    ? isValidInterstitialBlockId(blockId)
    : isValidRewardedBlockId(blockId);
  if (!valid) {
    return { ok: false, error: 'invalid_block_id' };
  }

  if (!window.Adsgram) {
    return { ok: false, error: 'sdk_not_loaded' };
  }

  return { ok: true, blockId };
}

async function showAd(kind: AdsgramAdKind, rawBlockId: string): Promise<AdsgramResult> {
  const preflight = preflightAdsgramAd(kind, rawBlockId);
  if (!preflight.ok || !preflight.blockId) {
    return { success: false, error: preflight.error };
  }

  let controller: AdsgramAdController | null = null;
  try {
    controller = window.Adsgram!.init({ blockId: preflight.blockId });
    const result = await withTimeout(controller.show(), AD_TIMEOUT_MS);
    if (result.done) {
      return { success: true };
    }
    return { success: false, error: result.description || 'not_completed' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return { success: false, error: msg };
  } finally {
    controller?.destroy();
  }
}

// ============================================
// Public API
// ============================================

export async function showRewardedAd(blockId: string): Promise<AdsgramResult> {
  return showAd('rewarded', blockId);
}

export async function showInterstitialAd(blockId: string): Promise<AdsgramResult> {
  return showAd('interstitial', blockId);
}
