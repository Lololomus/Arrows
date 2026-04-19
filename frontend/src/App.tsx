import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import '@fontsource/bungee-inline';
import { useAppStore } from './stores/store';
import { authApi, contractsApi, socialApi } from './api/client';
import { ADS_ENABLED, UI_ANIMATIONS } from './config/constants';
import { RewardToastHost } from './components/ui/RewardToastHost';
import { TunnelDownOverlay } from './components/TunnelDownOverlay';
import { OnboardingSlides } from './components/OnboardingSlides';
import { SmartLoader } from './components/ui/SmartLoader';
import { AuthExpiredScreen } from './components/AuthExpiredScreen';
import { BottomNav, type TabId } from './components/BottomNav';
import { HomeScreen } from './screens/HomeScreen';
import { GameScreen } from './screens/GameScreen';
import nonGameBackgroundUrl from './assets/background.webp?url';
import gameBackgroundUrl from './assets/game-bg.webp?url';
import { bootstrapAuth, hasUsableTelegramInitData, markAuthExpired } from './services/authSession';
import { startRewardReconciler, stopRewardReconciler } from './services/rewardReconciler';
import { extractReferralCode, getSavedReferralCode, clearSavedReferralCode } from './utils/referralLaunch';
import { detectTelegramLocale, setAppLocale, translate } from './i18n';

// Key stored in localStorage so new-user onboarding survives app restarts
// if the /onboarding/complete request was dropped (fire-and-forget).
const PENDING_NEW_USER_KEY = 'arrowPendingNewUser';

const ShopScreen = lazy(() =>
  import('./screens/ShopScreen').then((module) => ({ default: module.ShopScreen }))
);
const FriendsScreen = lazy(() =>
  import('./screens/FriendsScreen').then((module) => ({ default: module.FriendsScreen }))
);
const TasksScreen = lazy(() =>
  import('./screens/TasksScreen').then((module) => ({ default: module.TasksScreen }))
);
const LeaderboardScreen = lazy(() =>
  import('./screens/LeaderboardScreen').then((module) => ({ default: module.LeaderboardScreen }))
);

const DEV_AUTH_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  String(import.meta.env.VITE_ENABLE_DEV_AUTH || '').toLowerCase()
);
const ENABLE_NON_GAME_BACKGROUND = true; // one-line toggle
const TON_CONNECT_MANIFEST_URL = `${window.location.origin}/tonconnect-manifest.json`;

export default function App() {
  return (
    <TonConnectUIProvider manifestUrl={TON_CONNECT_MANIFEST_URL}>
      <AppInner />
      <TunnelDownOverlay />
    </TonConnectUIProvider>
  );
}

function AppInner() {
  const {
    screen,
    authStatus,
    authMessage,
    locale,
    localeManuallySet,
    setUser,
    setError,
    setAuthenticatedSession,
    setLocale,
    onboardingPending,
    setOnboardingPending,
  } = useAppStore();
  const [activeTab, setActiveTab] = useState<TabId>('play');
  const handleTabChange = useCallback((id: TabId) => setActiveTab(id), []);
  const [navBadges, setNavBadges] = useState<Partial<Record<TabId, boolean>>>({});
  const handleFragmentBadgeChange = useCallback((hasPending: boolean) => {
    setNavBadges((prev) => ({ ...prev, tasks: hasPending }));
  }, []);

  const applyReferralIfPresent = useCallback(async (context: string, isCancelled?: () => boolean) => {
    // Try live extraction first, then fall back to localStorage
    const referralCode = extractReferralCode() ?? getSavedReferralCode();
    if (!referralCode) {
      return;
    }

    console.info(`[Referral] Extracted code in ${context}: ${referralCode}`);

    try {
      console.info(`[Referral] Applying code in ${context}`);
      const result = await socialApi.applyReferral(referralCode);
      console.info(
        `[Referral] Apply result in ${context}: success=${result.success}`
        + (result.reason ? ` reason=${result.reason}` : '')
      );

      // Clear localStorage on definitive outcomes (no point retrying)
      if (result.success || result.reason === 'already_referred' || result.reason === 'account_too_old'
          || result.reason === 'invalid_code' || result.reason === 'self_referral') {
        clearSavedReferralCode();
      }

      if (!result.success && result.reason !== 'already_referred') {
        return;
      }

      // Capture isNew synchronously before any async gap — /me never returns this field
      const isNewSnapshot = useAppStore.getState().user?.isNew ?? false;
      const syncedUser = await authApi.getMe();
      if (isCancelled?.()) return;
      setUser(isNewSnapshot ? { ...syncedUser, isNew: true } : syncedUser);
    } catch (error) {
      // Network error — keep code in localStorage for retry on next launch
      console.error('[Referral] Auto-apply failed:', error);
    }
  }, [setUser]);

  const runBootstrap = useCallback(async (isCancelled?: () => boolean) => {
    const cancelled = () => isCancelled?.() ?? false;

    setError(null);

    try {
      if (!hasUsableTelegramInitData()) {
        if (DEV_AUTH_ENABLED) {
          console.warn('No Telegram initData - using dev auth fallback');
          const devUser = await authApi.getMe();
          if (cancelled()) return;
          setAuthenticatedSession({
            token: null,
            user: devUser,
            expiresAt: null,
          });
          await applyReferralIfPresent('dev-auth', cancelled);
          return;
        }

        markAuthExpired(translate('auth:sessionExpired'));
        return;
      }

      console.log('Authenticating...');
      await bootstrapAuth();
      if (cancelled()) return;

      await applyReferralIfPresent('telegram-auth', cancelled);
      if (cancelled()) return;

      const currentUser = useAppStore.getState().user;
      if (currentUser) {
        console.log('Authenticated:', currentUser.id);
        const pendingNewUserId = localStorage.getItem(PENDING_NEW_USER_KEY);
        const hasPendingNewUserRecovery = pendingNewUserId === String(currentUser.id);

        if (currentUser.isNew) {
          localStorage.setItem(PENDING_NEW_USER_KEY, String(currentUser.id));
          useAppStore.getState().setOnboardingPending('new_user');
        } else if (hasPendingNewUserRecovery && !currentUser.onboardingShown) {
          // Crash recovery: this same user started registration onboarding but
          // /onboarding/complete did not reach the server before the app closed.
          useAppStore.getState().setOnboardingPending('new_user');
        } else if (!currentUser.onboardingShown) {
          useAppStore.getState().setOnboardingPending('existing_user');
        }
      }
    } catch (error) {
      if (cancelled()) return;
      console.error('Auth failed:', error);
      if (useAppStore.getState().authStatus !== 'expired') {
        markAuthExpired(translate('auth:sessionExpired'));
      }
    }
  }, [applyReferralIfPresent, setAuthenticatedSession, setError]);

  useEffect(() => {
    let cancelled = false;
    void runBootstrap(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [runBootstrap]);

  useEffect(() => {
    if (localeManuallySet) return;
    const detectedLocale = detectTelegramLocale();
    setLocale(detectedLocale);
    void setAppLocale(detectedLocale);
  }, [localeManuallySet, setLocale]);

  useEffect(() => {
    void setAppLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (!ADS_ENABLED) {
      return;
    }
    startRewardReconciler();
    return () => {
      stopRewardReconciler();
    };
  }, []);

  // Инициализируем бейдж фрагментов при запуске, не дожидаясь открытия вкладки Tasks.
  useEffect(() => {
    void contractsApi.getContracts()
      .then((data) => {
        if (data.hasPendingAction) {
          setNavBadges((prev) => ({ ...prev, tasks: true }));
        }
      })
      .catch(() => {/* не критично — молча игнорируем */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ENABLE_NON_GAME_BACKGROUND) return;

    const images: HTMLImageElement[] = [];
    let disposed = false;

    const preload = async (src: string) => {
      const img = new Image();
      images.push(img);
      img.decoding = 'async';
      img.src = src;

      await new Promise<void>((resolve) => {
        if (img.complete) {
          resolve();
          return;
        }

        const done = () => {
          img.onload = null;
          img.onerror = null;
          resolve();
        };

        img.onload = done;
        img.onerror = done;
      });

      if (disposed) return;
      if (typeof img.decode === 'function') {
        try {
          await img.decode();
        } catch {
          // Ignore decode failures: loaded image is enough for warm cache.
        }
      }
    };

    void Promise.allSettled([
      preload(nonGameBackgroundUrl),
      preload(gameBackgroundUrl),
    ]);

    return () => {
      disposed = true;
      for (const img of images) {
        img.onload = null;
        img.onerror = null;
      }
    };
  }, []);

  if (authStatus === 'booting') {
    return (
      <div className="relative w-full app-viewport overflow-hidden bg-slate-950">
        <RewardToastHost />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.16),transparent_36%),linear-gradient(180deg,#020617_0%,#0f172a_100%)]" />
        <div className="relative z-10 flex h-full items-center justify-center">
          <SmartLoader text={translate('auth:sessionCheck')} />
        </div>
      </div>
    );
  }

  if (authStatus === 'expired') {
    return (
      <AuthExpiredScreen
        message={authMessage || translate('auth:sessionExpired')}
        onRetry={() => {
          void runBootstrap();
        }}
      />
    );
  }

  if (screen === 'game') {
    return (
      <div className="relative w-full app-viewport overflow-hidden bg-slate-900 font-sans select-none">
        <RewardToastHost />
        {ENABLE_NON_GAME_BACKGROUND && (
          <div className="absolute inset-0 pointer-events-none opacity-0" aria-hidden="true">
            <div
              className="absolute inset-0 bg-cover bg-center bg-no-repeat"
              style={{ backgroundImage: `url(${nonGameBackgroundUrl})` }}
            />
          </div>
        )}
        <div className="relative z-10 h-full">
          <GameScreen />
        </div>
      </div>
    );
  }

  const getActiveComponent = () => {
      switch (activeTab) {
      case 'friends':
        return <FriendsScreen />;
      case 'tasks':
        return <TasksScreen onFragmentBadgeChange={handleFragmentBadgeChange} />;
      case 'play':
        return <HomeScreen />;
      case 'leaderboard':
        return <LeaderboardScreen />;
      case 'shop':
        return <ShopScreen />;
      default:
        return <HomeScreen />;
    }
  };

  return (
    <div className="relative w-full app-viewport overflow-hidden bg-slate-900 font-sans select-none">
      <RewardToastHost />
      {onboardingPending === 'existing_user' && (
        <OnboardingSlides
          isNewUser={false}
          onComplete={() => setOnboardingPending(null)}
        />
      )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&display=swap');
        .font-sans { font-family: 'Inter', sans-serif; }
        .drop-shadow-glow { filter: drop-shadow(0 0 10px rgba(250, 204, 21, 0.5)); }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
      `}</style>

      <div className="relative z-10 flex flex-col h-full max-w-md mx-auto shadow-2xl bg-black/20 overflow-hidden">
        {ENABLE_NON_GAME_BACKGROUND && (
          <div className="absolute inset-0 pointer-events-none z-0">
            <div
              className="absolute inset-0 bg-cover bg-center bg-no-repeat"
              style={{ backgroundImage: `url(${nonGameBackgroundUrl})` }}
            />
            <div className="absolute inset-0 bg-slate-950/55" />
          </div>
        )}

        <div className="flex-1 overflow-hidden relative pt-6 safe-area-top z-10">
          <AnimatePresence mode="wait" initial={false}>
            <Suspense fallback={<SmartLoader delayMs={180} />}>
              <motion.div
                key={activeTab}
                initial={false}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: UI_ANIMATIONS.fade / 1000 }}
                className="h-full w-full"
              >
                {getActiveComponent()}
              </motion.div>
            </Suspense>
          </AnimatePresence>
        </div>

        <div className="relative z-10">
          <BottomNav activeTab={activeTab} onTabChange={handleTabChange} badges={navBadges} />
        </div>
      </div>
    </div>
  );
}
