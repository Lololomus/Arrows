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

export function extractReferralCode(): string | null {
  const tg = (window as TelegramWindow).Telegram?.WebApp;

  return (
    normalizeReferralCode(tg?.initDataUnsafe?.start_param)
    ?? normalizeReferralCode(tg?.initDataUnsafe?.startapp)
    ?? extractFromInitData(tg?.initData)
    ?? extractFromLocation()
  );
}
