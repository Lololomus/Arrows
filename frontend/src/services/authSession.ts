import { API_ENDPOINTS, API_URL } from '../config/constants';
import { useAppStore } from '../stores/store';
import { normalizeAuthResponse, type RawAuthResponse } from '../api/authTransforms';

const PROACTIVE_RENEW_WINDOW_MS = 5 * 60 * 1000;
const AUTH_EXPIRED_MESSAGE = 'Сессия истекла. Переоткройте Mini App из Telegram.';

let reauthPromise: Promise<void> | null = null;

function getTelegramInitData(): string {
  return String((window as any).Telegram?.WebApp?.initData || '').trim();
}

function isDevAuthActive(): boolean {
  const enabled = ['1', 'true', 'yes', 'on'].includes(
    String(import.meta.env.VITE_ENABLE_DEV_AUTH || '').toLowerCase()
  );
  const userId = String(import.meta.env.VITE_DEV_AUTH_USER_ID || '').trim();
  return enabled && userId.length > 0;
}

function resolveAuthFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return AUTH_EXPIRED_MESSAGE;
}

async function performTelegramAuth(): Promise<void> {
  const initData = getTelegramInitData();
  if (!initData) {
    throw new Error(AUTH_EXPIRED_MESSAGE);
  }

  const response = await fetch(`${API_URL}${API_ENDPOINTS.auth.telegram}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ init_data: initData }),
  });

  const contentType = response.headers.get('content-type');
  const data = contentType?.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail = response.status === 401
      ? AUTH_EXPIRED_MESSAGE
      : typeof data === 'object' && data !== null && 'detail' in data
        ? String((data as { detail?: unknown }).detail || AUTH_EXPIRED_MESSAGE)
        : AUTH_EXPIRED_MESSAGE;
    throw new Error(detail);
  }

  const normalized = normalizeAuthResponse(data as RawAuthResponse);
  useAppStore.getState().setAuthenticatedSession({
    token: normalized.token,
    user: normalized.user,
    expiresAt: normalized.expiresAt,
  });
}

async function runReauthentication(mode: 'boot' | 'proactive' | '401' | 'manual'): Promise<void> {
  const store = useAppStore.getState();
  store.setAuthMessage(null);
  store.setError(null);

  if (mode === 'boot') {
    store.setAuthStatus('booting');
  } else {
    store.setAuthStatus('reauthenticating');
  }

  try {
    await performTelegramAuth();
  } catch (error) {
    markAuthExpired(resolveAuthFailureMessage(error));
    throw error;
  }
}

export function hasUsableTelegramInitData(): boolean {
  return getTelegramInitData().length > 0;
}

export function markAuthExpired(message: string): void {
  const store = useAppStore.getState();
  store.clearAuthState();
  store.setError(null);
  store.setAuthMessage(message);
  store.setAuthStatus('expired');
}

export async function bootstrapAuth(): Promise<void> {
  await runReauthentication('boot');
}

export async function reauthenticate(reason: 'proactive' | '401' | 'manual'): Promise<void> {
  if (isDevAuthActive()) {
    return;
  }

  if (reauthPromise) {
    return reauthPromise;
  }

  reauthPromise = runReauthentication(reason).finally(() => {
    reauthPromise = null;
  });

  return reauthPromise;
}

export async function ensureFreshSession(): Promise<void> {
  if (isDevAuthActive()) {
    return;
  }

  if (reauthPromise) {
    return reauthPromise;
  }

  const state = useAppStore.getState();
  if (state.authStatus === 'expired') {
    throw new Error(state.authMessage || AUTH_EXPIRED_MESSAGE);
  }

  if (state.authStatus !== 'authenticated') {
    return;
  }

  if (!state.token || !state.authExpiresAt) {
    await reauthenticate('proactive');
    return;
  }

  const expiresAtMs = Date.parse(state.authExpiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    await reauthenticate('proactive');
    return;
  }

  if (expiresAtMs - Date.now() <= PROACTIVE_RENEW_WINDOW_MS) {
    await reauthenticate('proactive');
  }
}
