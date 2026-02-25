import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

type SafeAreaInsets = Partial<Record<'top' | 'bottom' | 'left' | 'right', unknown>>;

const TG_SAFE_PREFIX = '--tg-safe-area-inset';
const TG_CONTENT_SAFE_PREFIX = '--tg-content-safe-area-inset';

const normalizeInset = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return null;
};

const setInsetVariables = (prefix: string, rawInsets?: SafeAreaInsets | null) => {
  if (!rawInsets || typeof rawInsets !== 'object') return;

  const rootStyle = document.documentElement.style;
  const sides: Array<'top' | 'bottom' | 'left' | 'right'> = ['top', 'bottom', 'left', 'right'];
  for (const side of sides) {
    const value = normalizeInset(rawInsets[side]);
    if (value !== null) {
      rootStyle.setProperty(`${prefix}-${side}`, `${value}px`);
    }
  }
};

const unwrapInsetsPayload = (payload: unknown): SafeAreaInsets | null => {
  if (!payload || typeof payload !== 'object') return null;

  const raw = payload as Record<string, unknown>;
  const nested =
    (raw.insets as SafeAreaInsets | undefined) ??
    (raw.safe_area_inset as SafeAreaInsets | undefined) ??
    (raw.content_safe_area_inset as SafeAreaInsets | undefined);

  if (nested && typeof nested === 'object') {
    return nested;
  }

  return payload as SafeAreaInsets;
};

const setupTelegramSafeAreaSync = (tg: any): (() => void) => {
  const applySafeArea = (payload: unknown) => {
    const insets = unwrapInsetsPayload(payload) ?? unwrapInsetsPayload(tg.safeAreaInset);
    setInsetVariables(TG_SAFE_PREFIX, insets);
  };
  const applyContentSafeArea = (payload: unknown) => {
    const insets = unwrapInsetsPayload(payload) ?? unwrapInsetsPayload(tg.contentSafeAreaInset);
    setInsetVariables(TG_CONTENT_SAFE_PREFIX, insets);
  };

  try {
    applySafeArea(tg.safeAreaInset);
    applyContentSafeArea(tg.contentSafeAreaInset);
  } catch (error) {
    console.warn('[Arrow Puzzle] Safe-area init sync failed:', error);
  }

  if (typeof tg.onEvent !== 'function') {
    return () => {};
  }

  const bindings: Array<[string, (payload: unknown) => void]> = [
    ['safeAreaChanged', applySafeArea],
    ['contentSafeAreaChanged', applyContentSafeArea],
    // Backward compatibility with possible snake_case bridges.
    ['safe_area_changed', applySafeArea],
    ['content_safe_area_changed', applyContentSafeArea],
  ];

  for (const [eventName, handler] of bindings) {
    try {
      tg.onEvent(eventName, handler);
    } catch (error) {
      console.warn(`[Arrow Puzzle] Failed to subscribe ${eventName}:`, error);
    }
  }

  return () => {
    if (typeof tg.offEvent !== 'function') return;

    for (const [eventName, handler] of bindings) {
      try {
        tg.offEvent(eventName, handler);
      } catch {
        // Ignore teardown errors for unsupported app versions.
      }
    }
  };
};

let disposeTelegramSafeAreaSync: (() => void) | null = null;

const initTelegramApp = () => {
  const tg = (window as any).Telegram?.WebApp;

  disposeTelegramSafeAreaSync?.();
  disposeTelegramSafeAreaSync = null;

  if (!tg) {
    console.log('[Arrow Puzzle] Local mode - running without Telegram WebApp');
    return;
  }

  tg.ready();

  if (tg.requestFullscreen) {
    try {
      tg.requestFullscreen();
      console.log('[Arrow Puzzle] Fullscreen mode enabled (native)');
    } catch (error) {
      console.warn('[Arrow Puzzle] requestFullscreen exists but unsupported:', error);
      tg.expand();
    }
  } else {
    tg.expand();
    console.log('[Arrow Puzzle] Fullscreen not supported, using expand()');
  }

  tg.setHeaderColor('#1e3a52');
  tg.setBackgroundColor('#1e3a52');

  try {
    disposeTelegramSafeAreaSync = setupTelegramSafeAreaSync(tg);
  } catch (error) {
    console.warn('[Arrow Puzzle] Safe-area sync setup failed:', error);
  }

  if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
  if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();

  console.log('[Arrow Puzzle] Telegram Mini App initialized', {
    version: tg.version,
    platform: tg.platform,
    isExpanded: tg.isExpanded,
    fullscreenSupported: !!tg.requestFullscreen,
  });
};

initTelegramApp();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeTelegramSafeAreaSync?.();
    disposeTelegramSafeAreaSync = null;
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
