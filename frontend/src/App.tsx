import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import '@fontsource/bungee-inline';
import { useAppStore } from './stores/store';
import { authApi, socialApi } from './api/client';
import { UI_ANIMATIONS } from './config/constants';
import { RewardToastHost } from './components/ui/RewardToastHost';
import { SmartLoader } from './components/ui/SmartLoader';
import { AuthExpiredScreen } from './components/AuthExpiredScreen';
import { BottomNav, type TabId } from './components/BottomNav';
import { HomeScreen } from './screens/HomeScreen';
import { GameScreen } from './screens/GameScreen';
import nonGameBackgroundUrl from './assets/background.webp?url';
import { bootstrapAuth, hasUsableTelegramInitData, markAuthExpired } from './services/authSession';
import { startRewardReconciler, stopRewardReconciler } from './services/rewardReconciler';
import { extractReferralCode } from './utils/referralLaunch';

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

export default function App() {
  const {
    screen,
    authStatus,
    authMessage,
    setUser,
    setError,
    setAuthenticatedSession,
  } = useAppStore();
  const [activeTab, setActiveTab] = useState<TabId>('play');
  const handleTabChange = useCallback((id: TabId) => setActiveTab(id), []);

  const applyReferralIfPresent = useCallback(async (context: string, isCancelled?: () => boolean) => {
    const referralCode = extractReferralCode();
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

      if (!result.success && result.reason !== 'already_referred') {
        return;
      }

      const syncedUser = await authApi.getMe();
      if (isCancelled?.()) return;
      setUser(syncedUser);
    } catch (error) {
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

        markAuthExpired('Сессия истекла. Переоткройте Mini App из Telegram.');
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
      }
    } catch (error) {
      if (cancelled()) return;
      console.error('Auth failed:', error);
      if (useAppStore.getState().authStatus !== 'expired') {
        markAuthExpired('Сессия истекла. Переоткройте Mini App из Telegram.');
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
    startRewardReconciler();
    return () => {
      stopRewardReconciler();
    };
  }, []);

  useEffect(() => {
    if (!ENABLE_NON_GAME_BACKGROUND) return;

    let disposed = false;
    const img = new Image();
    img.decoding = 'async';
    img.src = nonGameBackgroundUrl;

    const waitForLoad = () => new Promise<void>((resolve) => {
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

    void (async () => {
      await waitForLoad();
      if (disposed) return;
      if (typeof img.decode === 'function') {
        try {
          await img.decode();
        } catch {
          // ignore decode failures: loaded image is enough for warm cache
        }
      }
    })();

    return () => {
      disposed = true;
      img.onload = null;
      img.onerror = null;
    };
  }, []);

  if (authStatus === 'booting') {
    return (
      <div className="relative w-full app-viewport overflow-hidden bg-slate-950">
        <RewardToastHost />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.16),transparent_36%),linear-gradient(180deg,#020617_0%,#0f172a_100%)]" />
        <div className="relative z-10 flex h-full items-center justify-center">
          <SmartLoader text="Проверяем сессию..." />
        </div>
      </div>
    );
  }

  if (authStatus === 'expired') {
    return (
      <AuthExpiredScreen
        message={authMessage || 'Сессия истекла. Переоткройте Mini App из Telegram.'}
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
        return <TasksScreen />;
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
          <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
        </div>
      </div>
    </div>
  );
}
