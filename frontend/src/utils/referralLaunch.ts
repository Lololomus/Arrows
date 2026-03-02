type TelegramInitDataUnsafe = {
  start_param?: unknown;
  startapp?: unknown;
};

type TelegramWebAppLike = {
  initData?: string;
  initDataUnsafe?: TelegramInitDataUnsafe;
};

type TelegramWindow = Window & {
  Telegram?: {
    WebApp?: TelegramWebAppLike;
  };
};

function normalizeReferralCode(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string') {
    return null;
  }

  const value = rawValue.trim();
  if (!value.toLowerCase().startsWith('ref_')) {
    return null;
  }

  const code = value.slice(4).trim().toUpperCase();
  return code || null;
}

function extractFromInitData(initData?: string): string | null {
  if (!initData) {
    return null;
  }

  const params = new URLSearchParams(initData);
  return normalizeReferralCode(
    params.get('start_param')
    ?? params.get('startapp')
    ?? params.get('tgWebAppStartParam')
  );
}

function extractFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search);
  return normalizeReferralCode(
    params.get('startapp')
    ?? params.get('tgWebAppStartParam')
  );
}

const LS_KEY = 'pending_referral_code';

export function extractReferralCode(): string | null {
  const tg = (window as TelegramWindow).Telegram?.WebApp;

  const code =
    normalizeReferralCode(tg?.initDataUnsafe?.start_param)
    ?? normalizeReferralCode(tg?.initDataUnsafe?.startapp)
    ?? extractFromInitData(tg?.initData)
    ?? extractFromLocation();

  if (code) {
    saveReferralCode(code);
  }

  return code;
}

export function saveReferralCode(code: string): void {
  try {
    localStorage.setItem(LS_KEY, code);
  } catch { /* quota / private mode */ }
}

export function getSavedReferralCode(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

export function clearSavedReferralCode(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch { /* ignore */ }
}
