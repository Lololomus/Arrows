import { useSyncExternalStore } from 'react';

export interface ParticleRuntimeProfile {
  isReducedMotion: boolean;
  isLowEnd: boolean;
  isPageVisible: boolean;
}

const DEFAULT_PROFILE: ParticleRuntimeProfile = {
  isReducedMotion: false,
  isLowEnd: false,
  isPageVisible: true,
};

let currentProfile: ParticleRuntimeProfile = DEFAULT_PROFILE;
const subscribers = new Set<() => void>();

let mediaQuery: MediaQueryList | null = null;
let isListening = false;

const profileEquals = (a: ParticleRuntimeProfile, b: ParticleRuntimeProfile) => (
  a.isReducedMotion === b.isReducedMotion &&
  a.isLowEnd === b.isLowEnd &&
  a.isPageVisible === b.isPageVisible
);

function measureProfile(): ParticleRuntimeProfile {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;

  const isReducedMotion = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
  const hardwareConcurrency = typeof navigator !== 'undefined'
    ? navigator.hardwareConcurrency || 8
    : 8;
  const dpr = window.devicePixelRatio || 1;
  const isLowEnd = hardwareConcurrency <= 4 || dpr > 2.5;
  const isPageVisible = !document.hidden;

  return { isReducedMotion, isLowEnd, isPageVisible };
}

function emitIfChanged(next: ParticleRuntimeProfile) {
  if (profileEquals(currentProfile, next)) return;
  currentProfile = next;
  subscribers.forEach((notify) => notify());
}

function syncProfile() {
  emitIfChanged(measureProfile());
}

function startListeners() {
  if (isListening || typeof window === 'undefined') return;
  isListening = true;

  mediaQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  syncProfile();

  if (mediaQuery) {
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncProfile);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(syncProfile);
    }
  }

  window.addEventListener('resize', syncProfile);
  document.addEventListener('visibilitychange', syncProfile);
}

function stopListeners() {
  if (!isListening || typeof window === 'undefined') return;
  isListening = false;

  if (mediaQuery) {
    if (typeof mediaQuery.removeEventListener === 'function') {
      mediaQuery.removeEventListener('change', syncProfile);
    } else if (typeof mediaQuery.removeListener === 'function') {
      mediaQuery.removeListener(syncProfile);
    }
  }

  window.removeEventListener('resize', syncProfile);
  document.removeEventListener('visibilitychange', syncProfile);
  mediaQuery = null;
}

function subscribe(listener: () => void) {
  subscribers.add(listener);

  if (subscribers.size === 1) {
    startListeners();
  } else if (typeof window !== 'undefined') {
    syncProfile();
  }

  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) {
      stopListeners();
    }
  };
}

function getSnapshot() {
  return currentProfile;
}

function getServerSnapshot() {
  return DEFAULT_PROFILE;
}

export function useParticleRuntimeProfile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

