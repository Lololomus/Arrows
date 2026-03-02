export interface GameRenderProfile {
  isIOS: boolean;
  isLegacyIOS: boolean;
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
  const isIOS = isIOSPlatform();
  const screenWidth = typeof window !== 'undefined' ? window.screen?.width ?? window.innerWidth : 0;
  const screenHeight = typeof window !== 'undefined' ? window.screen?.height ?? window.innerHeight : 0;
  const maxScreenSize = Math.max(screenWidth, screenHeight);
  const lacksRoundRectSupport = !supportsCanvasRoundRect();
  const isLegacyIOS = isIOS && ((isIPhoneLikeDevice() && maxScreenSize <= LEGACY_IPHONE_MAX_SCREEN_SIZE) || lacksRoundRectSupport);

  return {
    isIOS,
    isLegacyIOS,
    boardDprCap: isLegacyIOS ? 1 : 2,
    useStaticCanvas: !isLegacyIOS,
    enableFxOverlay: !isLegacyIOS,
  };
}
