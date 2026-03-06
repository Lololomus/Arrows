import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../stores/store';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';
import { CoinStashCard } from '../components/ui/CoinStashCard';
import { SpinScreen } from './SpinScreen';
import { spinApi } from '../api/client';

const HOME_BG_STAR_SIZE_PROFILE = { small: 0.8, medium: 0.16, large: 0.04 } as const;

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
  const { setScreen, user, spinAvailable, loginStreak, setSpinStatus, setDailyMode } = useAppStore();
  const [showSpin, setShowSpin] = useState(false);
  const displayTitleFont = { fontFamily: '"Bungee Inline", cursive' } as const;
  const coinBalance = user?.coins ?? 0;
  const displayedLevel = (user as (typeof user & { current_level?: number }) | null)?.currentLevel
    ?? (user as (typeof user & { current_level?: number }) | null)?.current_level
    ?? 1;

  useEffect(() => {
    let cancelled = false;

    const syncSpinStatus = async () => {
      try {
        const s = await spinApi.getStatus();
        if (cancelled) return;
        setSpinStatus(s.available, s.streak, s.retryAvailable, s.pendingPrize, s.nextAvailableAt);
      } catch {
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

  const handlePlayArcade = () => {
    setDailyMode(false);
    setScreen('game');
  };

  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden">
      {/* Модалка Рулетки */}
      {showSpin && <SpinScreen onClose={() => setShowSpin(false)} />}
      
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
          <CoinStashCard balance={coinBalance} />

          <motion.button
            type="button"
            aria-label="Start Arcade"
            initial={false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0 }}
            className="relative w-full group cursor-pointer text-left"
            onClick={handlePlayArcade}
          >
            <div className="absolute inset-0 bg-purple-500 rounded-3xl blur-xl opacity-40 group-hover:opacity-60 transition-opacity animate-pulse" />

            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
              className="relative bg-[#16192d]/60 backdrop-blur-xl border border-white/10 border-t-white/20 p-8 rounded-3xl text-center shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden hover:scale-[1.02] transition-transform duration-300"
            >
              <AdaptiveParticles
                variant="accent"
                tone="violet"
                baseCount={24}
                baseSpeed={0.22}
                className="z-0 opacity-80"
              />

              <div className="absolute top-0 right-0 p-4 opacity-20 z-10">
                <span className="text-7xl leading-none">🕹️</span>
              </div>

              <h2
                style={displayTitleFont}
                className="relative z-10 text-4xl text-transparent bg-clip-text bg-gradient-to-r from-purple-300 to-pink-300 tracking-wider uppercase mb-2 drop-shadow-md"
              >
                Arcade
              </h2>
              <p className="relative z-10 text-purple-100/80 text-sm font-medium">
                Уровень {displayedLevel}
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
                <span className="text-7xl leading-none">⚔️</span>
              </div>
              <h2
                style={displayTitleFont}
                className="relative z-10 text-4xl text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-300 tracking-wider uppercase mb-2"
              >
                Battle
              </h2>
              <p className="relative z-10 text-blue-100/70 text-sm font-medium">Скоро</p>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Floating Spin Button (Справа снизу, приподнята над навигацией) */}
      <div className="absolute bottom-[110px] right-6 z-40">
        {/* Пульсирующий круг на фоне, если рулетка доступна */}
        {spinAvailable && (
          <div className="absolute inset-0 rounded-full bg-pink-500 opacity-40 animate-ping" style={{ animationDuration: '2s' }} />
        )}
        
        <motion.button
          onClick={() => setShowSpin(true)}
          className={`relative flex items-center justify-center w-[76px] h-[76px] rounded-full backdrop-blur-xl transition-all duration-500 ${
            spinAvailable
              ? 'shadow-[0_0_25px_rgba(236,72,153,0.5)]'
              : 'shadow-none opacity-70'
          }`}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          {/* Внешний ободок кнопки */}
          <div className={`absolute inset-0 rounded-full border-[3px] z-20 pointer-events-none transition-colors duration-500 ${
            spinAvailable ? 'border-pink-500/80' : 'border-white/10'
          }`} />

          {/* Само мини-колесо рулетки */}
          <motion.div
            className={`absolute inset-1 rounded-full overflow-hidden ${!spinAvailable && 'grayscale opacity-60'}`}
            style={{
              // Точно те же цвета, что и в SpinScreen.tsx, поделенные на 8 секторов по 45 градусов
              background: 'conic-gradient(#0f766e 0 45deg, #047857 45deg 90deg, #1d4ed8 90deg 135deg, #2563eb 135deg 180deg, #7e22ce 180deg 225deg, #9333ea 225deg 270deg, #b45309 270deg 315deg, #be123c 315deg 360deg)'
            }}
            animate={spinAvailable ? { rotate: 360 } : { rotate: 0 }}
            transition={{ repeat: Infinity, duration: 12, ease: "linear" }}
          >
            {/* Тонкие разделители секторов для объема */}
            <div className="absolute inset-0 rounded-full border border-white/20 mix-blend-overlay" />
          </motion.div>

          {/* Центр рулетки */}
          <div className={`absolute m-auto w-[18px] h-[18px] rounded-full z-20 ${
            spinAvailable ? 'bg-[#0a0c1a] border-2 border-[#d8b4fe]' : 'bg-gray-600 border-2 border-gray-400'
          }`} />

          {/* Миниатюрный язычок (указатель) сверху */}
          <div className={`absolute -top-[6px] left-1/2 -translate-x-1/2 z-30 drop-shadow-md ${!spinAvailable && 'grayscale opacity-60'}`}>
            <svg width="16" height="22" viewBox="0 0 24 34" fill="none">
              <path d="M12 34L2 14C2 8.477 6.477 4 12 4C17.523 4 22 8.477 22 14L12 34Z" fill="url(#miniPointerGrad)" stroke="#ffffff" strokeWidth="2.5" strokeLinejoin="round"/>
              <circle cx="12" cy="10" r="3.5" fill="#1e1b4b" />
              <defs>
                <linearGradient id="miniPointerGrad" x1="12" y1="4" x2="12" y2="34" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#fbcfe8" />
                  <stop offset="1" stopColor="#ec4899" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* Бейджик нотификации/стрика */}
          <AnimatePresence>
            {spinAvailable && (
              <motion.div 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-1 -right-1 flex h-[24px] min-w-[24px] items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-red-500 px-1.5 text-[12px] font-black text-white shadow-md border-2 border-[#0a0c1a] z-40"
              >
                {loginStreak > 0 ? `🔥${loginStreak}` : '!'}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
    </div>
  );
}

