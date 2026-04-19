import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/store';
import { IceOverlay } from '../components/spin/IceOverlay';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';
import { HeaderBar } from '../components/ui/HeaderBar';
import { useWalletConnectionController } from '../hooks/useWalletConnectionController';
import { SpinScreen } from './SpinScreen';
import { HowToPlayModal } from '../components/HowToPlayModal';
import { OnboardingSlides } from '../components/OnboardingSlides';
import { authApi, handleApiError, onboardingApi, spinApi } from '../api/client';
import { setAppLocale, type AppLocale } from '../i18n';

const HOME_BG_STAR_SIZE_PROFILE = { small: 0.8, medium: 0.16, large: 0.04 } as const;
const SHOW_HOME_DEV_TOOLS = import.meta.env.DEV;

const titleContainer = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.08,
    },
  },
};

const titleLine = {
  hidden: { opacity: 0, y: -16, scale: 0.96, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: { duration: 0.36, ease: 'easeOut' },
  },
};

export function HomeScreen() {
  const { t } = useTranslation();
  const { setScreen, user, spinAvailable, spinPendingPrize, loginStreak, setSpinStatus, setDailyMode, locale, setLocaleManually, setUser, spinStreakLostAt, spinStreakLostCount, staticBackground, setStaticBackground, onboardingPending, setOnboardingPending } = useAppStore();
  const isNewUserOnboarding = onboardingPending === 'new_user';
  const [showSpin, setShowSpin] = useState(isNewUserOnboarding);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [spinStatusResolved, setSpinStatusResolved] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [showDevLauncher, setShowDevLauncher] = useState(false);
  const [devLaunchMode, setDevLaunchMode] = useState<'new_user' | 'existing_user' | null>(null);
  const [devLauncherError, setDevLauncherError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingLocale, setSavingLocale] = useState<AppLocale | null>(null);
  const walletController = useWalletConnectionController();
  const displayTitleFont = { fontFamily: '"Bungee Inline", cursive' } as const;
  const coinBalance = user?.coins ?? 0;
  const isStreakFrozen = spinStreakLostAt !== null
    && spinStreakLostCount >= 7
    && Date.now() < Date.parse(spinStreakLostAt) + 48 * 60 * 60 * 1000;
  const displayedLevel = (user as (typeof user & { current_level?: number }) | null)?.currentLevel
    ?? (user as (typeof user & { current_level?: number }) | null)?.current_level
    ?? 1;

  const handleSelectLocale = async (next: AppLocale) => {
    if (!user) return;
    if (user.localeManuallySet && locale === next) {
      setShowSettings(false);
      return;
    }

    const previousUser = user;
    setSettingsError(null);
    setSavingLocale(next);
    setLocaleManually(next);
    await setAppLocale(next);

    try {
      const syncedUser = await authApi.updateLocale(next);
      setUser(syncedUser);
      setShowSettings(false);
    } catch (error) {
      setUser(previousUser);
      await setAppLocale(previousUser.locale);
      setSettingsError(handleApiError(error));
    } finally {
      setSavingLocale(null);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const syncSpinStatus = async () => {
      try {
        const s = await spinApi.getStatus();
        if (cancelled) return;
        setSpinStatus(s.available, s.streak, s.retryAvailable, s.pendingPrize, s.nextAvailableAt, s.streakLostAt, s.streakLostCount);
        setSpinStatusResolved(true);
      } catch {
        if (!cancelled) setSpinStatusResolved(true);
        // not critical
      }
    };

    const onFocus = () => { void syncSpinStatus(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void syncSpinStatus();
      }
    };

    void syncSpinStatus();
    const poll = window.setInterval(() => { void syncSpinStatus(); }, 30_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [setSpinStatus]);

  useEffect(() => {
    if (onboardingPending === 'new_user') {
      setShowSpin(true);
      setShowOnboarding(false);
      return;
    }

    if (onboardingPending === 'existing_user') {
      setShowSpin(false);
      setShowOnboarding(false);
    }
  }, [onboardingPending]);

  useEffect(() => {
    if (onboardingPending !== 'new_user') return;
    if (!showSpin || !spinStatusResolved) return;
    if (spinAvailable || spinPendingPrize) return;

    setShowSpin(false);
    setShowOnboarding(true);
  }, [onboardingPending, showSpin, spinAvailable, spinPendingPrize, spinStatusResolved]);

  const handlePlayArcade = () => {
    setDailyMode(false);
    setScreen('game');
  };

  const launchDevOnboarding = async (mode: 'new_user' | 'existing_user') => {
    if (devLaunchMode) return;

    setDevLauncherError(null);
    setDevLaunchMode(mode);

    try {
      const [resetUser] = await Promise.all([
        onboardingApi.devReset(mode),
        mode === 'new_user' ? spinApi.devReset() : Promise.resolve({ success: true }),
      ]);

      const spinStatus = await spinApi.getStatus();
      setUser(mode === 'new_user' ? { ...resetUser, isNew: true } : { ...resetUser, isNew: false });
      setSpinStatus(
        spinStatus.available,
        spinStatus.streak,
        spinStatus.retryAvailable,
        spinStatus.pendingPrize,
        spinStatus.nextAvailableAt,
        spinStatus.streakLostAt,
        spinStatus.streakLostCount,
      );

      setShowDevLauncher(false);
      setShowSpin(false);
      setShowOnboarding(false);
      setOnboardingPending(null);
      setOnboardingPending(mode);
    } catch (error) {
      setDevLauncherError(handleApiError(error));
    } finally {
      setDevLaunchMode(null);
    }
  };

  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden">
      {showSpin && (
        <SpinScreen
          isForced={isNewUserOnboarding}
          onClose={() => {
            setShowSpin(false);
            if (isNewUserOnboarding) {
              setShowOnboarding(true);
            }
          }}
        />
      )}
      {showOnboarding && (
        <OnboardingSlides
          isNewUser={true}
          onComplete={(navigateToGame) => {
            setShowOnboarding(false);
            setOnboardingPending(null);
            if (navigateToGame) setScreen('game');
          }}
        />
      )}

      <AdaptiveParticles
        variant="bg"
        tone="neutral"
        baseCount={101}
        baseSpeed={0.12}
        sizeProfile={HOME_BG_STAR_SIZE_PROFILE}
        className="z-0 opacity-60"
      />

      <div className="relative z-10 flex flex-col h-full px-6">
        <motion.div
          className="absolute top-[10%] sm:top-[14%] left-6 right-6 text-center z-10"
          variants={titleContainer}
          initial="hidden"
          animate="visible"
        >
          <h1
            style={displayTitleFont}
            className="text-5xl leading-[0.9] text-white tracking-wider drop-shadow-[0_0_18px_rgba(255,255,255,0.3)]"
          >
            <motion.span variants={titleLine} className="block">
              ARROW
            </motion.span>
            <motion.span variants={titleLine} className="block">
              REWARD
            </motion.span>
          </h1>
        </motion.div>

        <div className="flex-1 flex flex-col justify-center space-y-4 pb-8">
          <HeaderBar
            balance={coinBalance}
            walletMode={walletController.walletMode}
            walletDisplay={walletController.walletDisplay}
            walletError={walletController.walletError}
            showDisconnectAction={walletController.showDisconnectAction}
            onWalletClick={walletController.onWalletClick}
            onDisconnect={walletController.onDisconnect}
            delay={0.22}
          />

          <motion.button
            type="button"
            aria-label={t('game:home.arcade')}
            className="relative w-full group cursor-pointer text-left"
            whileTap={{ scale: 0.97 }}
            onClick={handlePlayArcade}
          >
            <div className="absolute inset-0 bg-purple-500 rounded-3xl blur-xl opacity-40 group-hover:opacity-60 transition-opacity animate-pulse" />

            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
              className="relative bg-[#16192d]/60 backdrop-blur-xl border border-white/10 border-t-white/20 p-8 rounded-3xl text-center shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden"
            >
              <AdaptiveParticles
                variant="accent"
                tone="violet"
                baseCount={24}
                baseSpeed={0.22}
                className="z-0 opacity-80"
              />

              <div className="absolute top-0 right-0 p-4 opacity-20 z-10">
                <span className="text-7xl leading-none">{'\u{1F579}\uFE0F'}</span>
              </div>

              <h2
                style={displayTitleFont}
                className="relative z-10 text-4xl text-transparent bg-clip-text bg-gradient-to-r from-purple-300 to-pink-300 tracking-wider uppercase mb-2 drop-shadow-md"
              >
                {t('game:home.arcade')}
              </h2>
              <p className="relative z-10 text-purple-100/80 text-sm font-medium">
                {t('game:home.level', { count: displayedLevel })}
              </p>
            </motion.div>
          </motion.button>

          <motion.div
            initial={false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0 }}
            className="relative w-full group cursor-not-allowed opacity-60"
          >
            <div className="absolute inset-0 bg-cyan-500 rounded-3xl blur-xl opacity-20" />
            <div className="relative bg-[#0c0e1c]/60 backdrop-blur-xl border border-white/10 border-t-white/20 p-8 rounded-3xl text-center shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-20">
                <span className="text-7xl leading-none">{'\u2694\uFE0F'}</span>
              </div>
              <h2
                style={displayTitleFont}
                className="relative z-10 text-4xl text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-300 tracking-wider uppercase mb-2"
              >
                {t('game:home.battle')}
              </h2>
              <p className="relative z-10 text-blue-100/70 text-sm font-medium">{t('common:comingSoon')}</p>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="absolute bottom-[110px] left-6 z-40">
        <motion.button
          onClick={() => setShowSettings(true)}
          className="relative flex items-center justify-center w-[76px] h-[76px] rounded-full backdrop-blur-xl bg-[#16192d]/60 border border-white/10 shadow-none opacity-70 hover:opacity-100 transition-opacity duration-300"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          aria-label={t('common:settings')}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </motion.button>
      </div>

      <div className="absolute bottom-[110px] left-1/2 -translate-x-1/2 z-40 flex items-center">
        <motion.button
          onClick={() => setShowHowToPlay(true)}
          className="flex items-center gap-2 px-4 py-3 rounded-2xl backdrop-blur-xl bg-[#16192d]/60 border border-white/10 text-white/60 text-sm font-medium opacity-70 hover:opacity-100 transition-opacity duration-300"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.95 }}
          aria-label={t('game:howToPlay.title')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          {t('game:howToPlay.title')}
        </motion.button>
      </div>

      {SHOW_HOME_DEV_TOOLS && (
        <div className="absolute top-6 right-6 z-40">
          <motion.button
            type="button"
            onClick={() => {
              setDevLauncherError(null);
              setShowDevLauncher(true);
            }}
            className="flex items-center justify-center min-w-[72px] h-11 px-4 rounded-2xl backdrop-blur-xl bg-[#16192d]/75 border border-amber-400/20 text-amber-200 text-sm font-bold tracking-[0.2em] shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.95 }}
          >
            DEV
          </motion.button>
        </div>
      )}

      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div
              className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
            />
            <motion.div
              className="absolute bottom-[100px] left-6 z-50 w-[220px] bg-[#16192d]/95 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.95 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <p className="text-white/50 text-xs font-medium uppercase tracking-widest mb-3 px-1">
                {t('common:language')}
              </p>
              {settingsError && (
                <p className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {settingsError}
                </p>
              )}
              <div className="flex flex-col gap-2">
                {(['ru', 'en'] as AppLocale[]).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => void handleSelectLocale(lang)}
                    disabled={savingLocale !== null}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors duration-150 ${
                      locale === lang
                        ? 'bg-white/15 text-white'
                        : 'text-white/60 hover:bg-white/8 hover:text-white/90'
                    }`}
                  >
                    <span className="text-lg leading-none">{lang === 'ru' ? '\u{1F1F7}\u{1F1FA}' : '\u{1F1EC}\u{1F1E7}'}</span>
                    <span>
                      {savingLocale === lang
                        ? t('common:processing')
                        : lang === 'ru'
                          ? 'Русский'
                          : 'English'}
                    </span>
                    {locale === lang && (
                      <svg className="ml-auto w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setStaticBackground(!staticBackground)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium text-white/60 hover:bg-white/8 hover:text-white/90 transition-colors duration-150"
                >
                  <span>{t('game:menu.staticBg')}</span>
                  <span className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 relative ${staticBackground ? 'bg-blue-500' : 'bg-white/20'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${staticBackground ? 'translate-x-5' : 'translate-x-0'}`} />
                  </span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {SHOW_HOME_DEV_TOOLS && showDevLauncher && (
          <>
            <motion.div
              className="absolute inset-0 z-50 bg-black/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDevLauncher(false)}
            />
            <motion.div
              className="absolute top-20 right-6 z-50 w-[240px] bg-[#16192d]/95 backdrop-blur-xl border border-amber-400/20 rounded-2xl p-4 shadow-[0_12px_36px_rgba(0,0,0,0.55)]"
              initial={{ opacity: 0, y: -12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.96 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <p className="mb-3 px-1 text-[11px] font-bold uppercase tracking-[0.22em] text-amber-200/70">
                DEV Onboarding
              </p>
              {devLauncherError && (
                <p className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {devLauncherError}
                </p>
              )}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => void launchDevOnboarding('new_user')}
                  disabled={devLaunchMode !== null}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Новый пользователь
                </button>
                <button
                  type="button"
                  onClick={() => void launchDevOnboarding('existing_user')}
                  disabled={devLaunchMode !== null}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Уже играющий пользователь
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <HowToPlayModal open={showHowToPlay} onClose={() => setShowHowToPlay(false)} />

      <div className="absolute bottom-[110px] right-6 z-40">
        {/* Ping glow: cyan when frozen, pink when spin available */}
        {isStreakFrozen && (
          <div className="absolute inset-0 rounded-full bg-cyan-400 opacity-30 animate-ping" style={{ animationDuration: '2.5s' }} />
        )}
        {!isStreakFrozen && spinAvailable && (
          <div className="absolute inset-0 rounded-full bg-pink-500 opacity-40 animate-ping" style={{ animationDuration: '2s' }} />
        )}

        <motion.button
          onClick={() => setShowSpin(true)}
          className={`relative flex items-center justify-center w-[76px] h-[76px] rounded-full backdrop-blur-xl transition-all duration-500 ${
            isStreakFrozen
              ? 'shadow-[0_0_28px_rgba(34,211,238,0.55)]'
              : spinAvailable
                ? 'shadow-[0_0_25px_rgba(236,72,153,0.5)]'
                : 'shadow-none opacity-70'
          }`}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          aria-label={t('game:spin.title')}
        >
          {/* Border ring */}
          <div className={`absolute inset-0 rounded-full border-[3px] z-20 pointer-events-none transition-colors duration-500 ${
            isStreakFrozen ? 'border-cyan-400/80' : spinAvailable ? 'border-pink-500/80' : 'border-white/10'
          }`} />

          {/* Wheel gradient — icy when frozen */}
          <motion.div
            className={`absolute inset-1 rounded-full overflow-hidden ${!spinAvailable && !isStreakFrozen && 'grayscale opacity-60'}`}
            style={{
              background: 'conic-gradient(#0f766e 0 40deg, #047857 40deg 80deg, #1d4ed8 80deg 120deg, #2563eb 120deg 160deg, #7e22ce 160deg 200deg, #9333ea 200deg 240deg, #b45309 240deg 280deg, #be123c 280deg 320deg, #15803d 320deg 360deg)',
            }}
            animate={spinAvailable && !isStreakFrozen ? { rotate: 360 } : { rotate: 0 }}
            transition={{ repeat: Infinity, duration: 12, ease: 'linear' }}
          >
            <div className="absolute inset-0 rounded-full border border-white/20 mix-blend-overlay" />
          </motion.div>

          <AnimatePresence>
            {isStreakFrozen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-1 pointer-events-none"
              >
                <IceOverlay isSmall />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Center hub */}
          {!isStreakFrozen && (
            <div className={`absolute m-auto w-[18px] h-[18px] rounded-full z-20 ${
              spinAvailable ? 'bg-[#0a0c1a] border-2 border-[#d8b4fe]' : 'bg-gray-600 border-2 border-gray-400'
            }`} />
          )}

          {/* Pointer */}
          <div className={`absolute -top-[6px] left-1/2 -translate-x-1/2 z-30 drop-shadow-md ${!spinAvailable && !isStreakFrozen && 'grayscale opacity-60'}`}>
            <svg width="16" height="22" viewBox="0 0 24 34" fill="none">
              <path d="M12 34L2 14C2 8.477 6.477 4 12 4C17.523 4 22 8.477 22 14L12 34Z"
                fill={isStreakFrozen ? 'url(#miniPointerIce)' : 'url(#miniPointerGrad)'}
                stroke="#ffffff" strokeWidth="2.5" strokeLinejoin="round"
              />
              <circle cx="12" cy="10" r="3.5" fill="#1e1b4b" />
              <defs>
                <linearGradient id="miniPointerGrad" x1="12" y1="4" x2="12" y2="34" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#fbcfe8" />
                  <stop offset="1" stopColor="#ec4899" />
                </linearGradient>
                <linearGradient id="miniPointerIce" x1="12" y1="4" x2="12" y2="34" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#bae6fd" />
                  <stop offset="1" stopColor="#0ea5e9" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          <AnimatePresence>
            {isStreakFrozen && (
              <motion.div
                key="frozen-badge"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="absolute -top-1 -right-1 flex h-[24px] min-w-[24px] items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 px-1.5 text-[13px] shadow-md border-2 border-[#0a0c1a] z-40"
              >
                ❄️
              </motion.div>
            )}
            {!isStreakFrozen && spinAvailable && (
              <motion.div
                key="streak-badge"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="absolute -top-1 -right-1 flex h-[24px] min-w-[24px] items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-red-500 px-1.5 text-[12px] font-black text-white shadow-md border-2 border-[#0a0c1a] z-40"
              >
                {loginStreak > 0 ? `\u{1F525}${loginStreak}` : '!'}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
    </div>
  );
}
