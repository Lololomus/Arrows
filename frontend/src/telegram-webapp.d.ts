export {};

declare global {
  interface TelegramWebAppUser {
    language_code?: string;
  }

  interface TelegramWebAppInitDataUnsafe {
    user?: TelegramWebAppUser;
    start_param?: unknown;
    startapp?: unknown;
  }

  interface TelegramWebAppHapticFeedback {
    impactOccurred(style: string): void;
    notificationOccurred(type: string): void;
    selectionChanged(): void;
  }

  interface TelegramWebApp {
    initData?: string;
    initDataUnsafe?: TelegramWebAppInitDataUnsafe;
    HapticFeedback?: TelegramWebAppHapticFeedback;
    version?: string;
    platform?: string;
    isExpanded?: boolean;
    safeAreaInset?: unknown;
    contentSafeAreaInset?: unknown;
    ready(): void;
    expand(): void;
    close?(): void;
    requestFullscreen?(): void;
    setHeaderColor(color: string): void;
    setBackgroundColor(color: string): void;
    disableVerticalSwipes?(): void;
    enableClosingConfirmation?(): void;
    openTelegramLink?(url: string): void;
    onEvent?(eventName: string, handler: (payload?: unknown) => void): void;
    offEvent?(eventName: string, handler: (payload?: unknown) => void): void;
  }

  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}
