/**
 * AdsGram SDK Service
 *
 * Единая точка работы с AdsGram SDK.
 * Fail-closed: если что-то не так — возвращаем ошибку, не ломаем приложение.
 */

import { ADS_ENABLED } from '../config/constants';
import { useAppStore } from '../stores/store';

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
      init(params: {
        blockId: string;
        userId?: string;
        debug?: boolean;
        debugBannerType?: string;
      }): AdsgramAdController;
    };
  }
}

// ============================================
// Result type
// ============================================

export interface AdsgramResult {
  success: boolean;
  outcome: 'completed' | 'shown' | 'not_completed' | 'provider_error';
  error?: string;
}

export type AdsgramAdKind = 'rewarded' | 'interstitial';

export interface AdsgramPreflightResult {
  ok: boolean;
  blockId?: string;
  userId?: string;
  error?: string;
}

// ============================================
// Internal helpers
// ============================================

const AD_TIMEOUT_MS = 45_000;
const INTERSTITIAL_PREFIX = 'int-';
const REWARDED_BLOCK_ID_PATTERN = /^\d+$/;
const INTERSTITIAL_BLOCK_ID_PATTERN = /^int-\d+$/;
const TASK_BLOCK_ID_PATTERN = /^task-\d+$/;
const ADSGRAM_CLEANUP_DELAYS_MS = [0, 150, 600];

function normalizeBlockId(rawBlockId: string): string {
  return rawBlockId.trim();
}

export function isValidInterstitialBlockId(rawBlockId: string): boolean {
  const blockId = normalizeBlockId(rawBlockId);
  return INTERSTITIAL_BLOCK_ID_PATTERN.test(blockId);
}

export function isValidRewardedBlockId(rawBlockId: string): boolean {
  const blockId = normalizeBlockId(rawBlockId);
  return REWARDED_BLOCK_ID_PATTERN.test(blockId);
}

export function isValidTaskBlockId(rawBlockId: string): boolean {
  const blockId = normalizeBlockId(rawBlockId);
  return TASK_BLOCK_ID_PATTERN.test(blockId);
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

function elementLooksLikeAdsgramResidue(element: Element): boolean {
  const values: string[] = [];
  const collect = (node: Element) => {
    values.push(node.id);
    const className = node.getAttribute('class');
    if (className) values.push(className);
    const src = node.getAttribute('src');
    if (src) values.push(src);
    const dataName = Array.from(node.attributes)
      .filter((attr) => attr.name.toLowerCase().includes('adsgram') || attr.value.toLowerCase().includes('adsgram'))
      .map((attr) => `${attr.name}=${attr.value}`);
    values.push(...dataName);
  };

  collect(element);
  for (const child of Array.from(element.querySelectorAll('[id], [class], [src], iframe'))) {
    collect(child);
  }

  return values.join(' ').toLowerCase().includes('adsgram');
}

function runAdsgramResidueCleanup(): void {
  if (typeof document === 'undefined' || !document.body) return;

  document.documentElement.style.removeProperty('pointer-events');
  document.body.style.removeProperty('pointer-events');
  document.body.removeAttribute('inert');

  const appRoot = document.getElementById('root');
  appRoot?.removeAttribute('inert');
  if (appRoot?.getAttribute('aria-hidden') === 'true') {
    appRoot.removeAttribute('aria-hidden');
  }

  for (const child of Array.from(document.body.children)) {
    if (child.id === 'root') continue;
    if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK') continue;
    if (elementLooksLikeAdsgramResidue(child)) {
      child.remove();
    }
  }
}

export function cleanupAdsgramResidue(): void {
  if (typeof window === 'undefined') return;
  for (const delay of ADSGRAM_CLEANUP_DELAYS_MS) {
    window.setTimeout(runAdsgramResidueCleanup, delay);
  }
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

  const telegramId = useAppStore.getState().user?.telegramId;
  if (kind === 'rewarded' && (!Number.isFinite(telegramId) || !telegramId || telegramId <= 0)) {
    return { ok: false, error: 'missing_user_id' };
  }

  return {
    ok: true,
    blockId,
    userId: kind === 'rewarded' ? String(telegramId) : undefined,
  };
}

async function showAd(kind: AdsgramAdKind, rawBlockId: string): Promise<AdsgramResult> {
  const preflight = preflightAdsgramAd(kind, rawBlockId);
  if (!preflight.ok || !preflight.blockId) {
    return { success: false, outcome: 'provider_error', error: preflight.error };
  }

  let controller: AdsgramAdController | null = null;
  try {
    controller = window.Adsgram!.init({
      blockId: preflight.blockId,
      userId: preflight.userId,
    });
    const result = await withTimeout(controller.show(), AD_TIMEOUT_MS);
    if (result.done) {
      return {
        success: true,
        outcome: kind === 'interstitial' ? 'shown' : 'completed',
      };
    }

    if (kind === 'interstitial' && !result.error) {
      return { success: true, outcome: 'shown' };
    }

    if (!result.error) {
      return { success: false, outcome: 'not_completed', error: result.description || 'not_completed' };
    }

    return { success: false, outcome: 'provider_error', error: result.description || 'provider_error' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return { success: false, outcome: 'provider_error', error: msg };
  } finally {
    controller?.destroy();
    cleanupAdsgramResidue();
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
