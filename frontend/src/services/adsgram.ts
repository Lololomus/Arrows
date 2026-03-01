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

// ============================================
// Internal helpers
// ============================================

const AD_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

async function showAd(blockId: string): Promise<AdsgramResult> {
  if (!ADS_ENABLED) {
    return { success: false, error: 'disabled' };
  }
  if (!blockId) {
    return { success: false, error: 'no_block_id' };
  }
  if (!window.Adsgram) {
    return { success: false, error: 'sdk_not_loaded' };
  }

  try {
    const controller = window.Adsgram.init({ blockId });
    const result = await withTimeout(controller.show(), AD_TIMEOUT_MS);
    if (result.done) {
      return { success: true };
    }
    return { success: false, error: result.description || 'not_completed' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return { success: false, error: msg };
  }
}

// ============================================
// Public API
// ============================================

export async function showRewardedAd(blockId: string): Promise<AdsgramResult> {
  return showAd(blockId);
}

export async function showInterstitialAd(blockId: string): Promise<AdsgramResult> {
  return showAd(blockId);
}
