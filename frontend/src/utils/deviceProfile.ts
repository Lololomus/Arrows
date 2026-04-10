export interface GameRenderProfile {
  isAndroid: boolean;
  isIOS: boolean;
  isLegacyIOS: boolean;
  isLowEnd: boolean;
  boardDprCap: 1 | 2;
  useStaticCanvas: boolean;
  enableFxOverlay: boolean;
}

const LEGACY_IPHONE_MAX_SCREEN_SIZE = 736;

type TelegramWindow = Window & {
  Telegram?: {
    WebApp?: {
      platform?: string;
    };
  };
};

function getTelegramPlatform(): string {
  if (typeof window === 'undefined') return '';
  const tgWindow = window as TelegramWindow;
  return String(tgWindow.Telegram?.WebApp?.platform ?? '').toLowerCase();
}

function supportsCanvasRoundRect(): boolean {
  if (typeof CanvasRenderingContext2D === 'undefined') return false;
  return typeof CanvasRenderingContext2D.prototype.roundRect === 'function';
}

function isIPhoneLikeDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  return /iPhone|iPod/.test(ua);
}

function isAndroidPlatform(): boolean {
  if (typeof window === 'undefined') return false;

  if (getTelegramPlatform() === 'android') {
    return true;
  }

  const ua = window.navigator.userAgent || '';
  return /Android/i.test(ua);
}

export function isIOSPlatform(): boolean {
  if (typeof window === 'undefined') return false;

  if (getTelegramPlatform() === 'ios') {
    return true;
  }

  const ua = window.navigator.userAgent || '';
  const isIPhoneFamily = /iPad|iPhone|iPod/.test(ua);
  const isIPadDesktopMode = window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
  return isIPhoneFamily || isIPadDesktopMode;
}

export function getGameRenderProfile(): GameRenderProfile {
  const isAndroid = isAndroidPlatform();
  const isIOS = isIOSPlatform();
  const screenWidth = typeof window !== 'undefined' ? window.screen?.width ?? window.innerWidth : 0;
  const screenHeight = typeof window !== 'undefined' ? window.screen?.height ?? window.innerHeight : 0;
  const maxScreenSize = Math.max(screenWidth, screenHeight);
  const lacksRoundRectSupport = !supportsCanvasRoundRect();
  const isLegacyIOS = isIOS && ((isIPhoneLikeDevice() && maxScreenSize <= LEGACY_IPHONE_MAX_SCREEN_SIZE) || lacksRoundRectSupport);
  const hardwareConcurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 8 : 8;
  const deviceMemory = typeof navigator !== 'undefined' && 'deviceMemory' in navigator
    ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0)
    : 0;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const isLowEnd = hardwareConcurrency <= 4 || (deviceMemory > 0 && deviceMemory <= 4) || (isAndroid && dpr >= 3);

  return {
    isAndroid,
    isIOS,
    isLegacyIOS,
    isLowEnd,
    boardDprCap: isLegacyIOS ? 1 : 2,
    useStaticCanvas: !isLegacyIOS,
    enableFxOverlay: !isLegacyIOS,
  };
}
