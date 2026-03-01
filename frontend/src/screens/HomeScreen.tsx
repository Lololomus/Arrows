import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Coins, Play, TimerReset } from 'lucide-react';
import { useAppStore } from '../stores/store';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';
import { CoinStashCard } from '../components/ui/CoinStashCard';
import { adsApi, authApi } from '../api/client';
import { ADS_ENABLED, ADS_FIRST_ELIGIBLE_LEVEL, ADSGRAM_BLOCK_IDS } from '../config/constants';
import { isValidRewardedBlockId } from '../services/adsgram';
import {
  PENDING_RETRY_TIMEOUT_MS,
  getRewardedFlowMessage,
  pollRewardIntent,
  runRewardedFlow,
} from '../services/rewardedAds';

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

function formatResetTime(resetsAt: string, now: number): string {
  const resetTimestamp = Date.parse(resetsAt);
  if (!Number.isFinite(resetTimestamp)) return 'до сброса позже';

  const diffMs = Math.max(0, resetTimestamp - now);
  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${Math.max(1, minutes)} мин`;
  return `${hours} ч ${minutes.toString().padStart(2, '0')} мин`;
}

function DailyCoinsCard({ currentLevel }: { currentLevel: number }) {
  const updateUser = useAppStore((s) => s.updateUser);
  const setUser = useAppStore((s) => s.setUser);
  const [eligible, setEligible] = useState(false);
  const [used, setUsed] = useState(0);
  const [limit, setLimit] = useState(3);
  const [resetsAt, setResetsAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [pendingIntentId, setPendingIntentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const status = await adsApi.getStatus();
      setEligible(status.eligible);
      setUsed(status.dailyCoins.used);
      setLimit(status.dailyCoins.limit);
      setResetsAt(status.dailyCoins.resetsAt);
      setStatusLoaded(true);
    } catch {
      setStatusLoaded(false);
    }
  }, []);

  const syncCoins = useCallback(async () => {
    try {
      const me = await authApi.getMe();
      setUser(me);
    } catch {
      void 0;
    }
  }, [setUser]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadStatus();
      }
    };

    const handleWindowFocus = () => {
      void loadStatus();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [loadStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const handleWatch = useCallback(async () => {
    if (loading || used >= limit) return;
    setLoading(true);
    setError(null);
    setInfoMessage(null);

    try {
      const result = pendingIntentId
        ? await pollRewardIntent(pendingIntentId, PENDING_RETRY_TIMEOUT_MS)
        : await runRewardedFlow(ADSGRAM_BLOCK_IDS.rewardDailyCoins, {
            placement: 'reward_daily_coins',
          });

      if (result.outcome === 'timeout') {
        setPendingIntentId(result.intentId);
        setInfoMessage(getRewardedFlowMessage('reward_daily_coins', result));
        return;
      }

      if (result.outcome === 'ad_failed') {
        setPendingIntentId(null);
        setError(getRewardedFlowMessage('reward_daily_coins', result));
        return;
      }
      if (result.outcome === 'error') {
        setPendingIntentId(result.intentId);
        setError(getRewardedFlowMessage('reward_daily_coins', result));
        return;
      }

      if (result.outcome === 'rejected') {
        setPendingIntentId(null);
        setError(getRewardedFlowMessage('reward_daily_coins', result));
        await loadStatus();
        return;
      }

      setPendingIntentId(null);
      setUsed(result.status?.usedToday ?? used);
      setLimit(result.status?.limitToday ?? limit);
      if (result.status?.resetsAt) setResetsAt(result.status.resetsAt);
      if (result.status?.coins != null) {
        updateUser({ coins: result.status.coins });
      } else {
        await syncCoins();
      }
    } catch {
      setError('Не удалось связаться с сервером. Попробуйте еще раз.');
    } finally {
      setLoading(false);
    }
  }, [limit, loadStatus, loading, pendingIntentId, syncCoins, updateUser, used]);

  if (!statusLoaded || !eligible || currentLevel < ADS_FIRST_ELIGIBLE_LEVEL) {
    return null;
  }

  const remaining = Math.max(0, limit - used);
  const limitReached = used >= limit;
  const waitingForReward = pendingIntentId !== null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative bg-[#16192d]/60 backdrop-blur-xl border border-amber-500/20 rounded-2xl p-4 flex items-center gap-4 shadow-[0_4px_20px_rgba(0,0,0,0.3)]"
    >
      <div className="w-12 h-12 shrink-0 bg-gradient-to-br from-amber-500/20 to-orange-600/20 border border-amber-500/30 rounded-xl flex items-center justify-center">
        <Coins size={24} className="text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white font-bold text-sm">+20 монет</p>
        {limitReached ? (
          <div className="flex items-center gap-1.5 text-white/50 text-xs">
            <TimerReset size={12} />
            <span>Лимит исчерпан, сброс через {formatResetTime(resetsAt, now)}</span>
          </div>
        ) : waitingForReward ? (
          <p className="text-white/50 text-xs">Награда еще проверяется</p>
        ) : (
          <p className="text-white/50 text-xs">Осталось: {remaining}/{limit}</p>
        )}
        {infoMessage && <p className="mt-1 text-xs text-amber-300">{infoMessage}</p>}
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
      <button
        onClick={handleWatch}
        disabled={loading || limitReached}
        className="shrink-0 px-4 py-2.5 bg-gradient-to-b from-amber-500 to-orange-600 rounded-xl text-white font-bold text-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Play size={14} />
        {loading ? '...' : waitingForReward ? 'Проверить награду' : 'Смотреть'}
      </button>
    </motion.div>
  );
}

export function HomeScreen() {
  const { setScreen, user } = useAppStore();
  const displayTitleFont = { fontFamily: '"Bungee Inline", cursive' } as const;
  const coinBalance = user?.coins ?? 0;
  const displayedLevel = (user as (typeof user & { current_level?: number }) | null)?.currentLevel
    ?? (user as (typeof user & { current_level?: number }) | null)?.current_level
    ?? 1;

  const showDailyCoins = displayedLevel >= ADS_FIRST_ELIGIBLE_LEVEL
    && ADS_ENABLED
    && isValidRewardedBlockId(ADSGRAM_BLOCK_IDS.rewardDailyCoins);

  const handlePlayArcade = () => {
    setScreen('game');
  };

  return (
    <div className="relative flex flex-col h-full w-full">
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

        <div className="flex-1 flex flex-col justify-center space-y-3 pb-8">
          <CoinStashCard balance={coinBalance} />

          {showDailyCoins && <DailyCoinsCard currentLevel={displayedLevel} />}

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
                <span className="text-7xl leading-none">⚡</span>
              </div>
              <h2
                style={displayTitleFont}
                className="relative z-10 text-4xl text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-300 tracking-wider uppercase mb-2"
              >
                Adventure
              </h2>
              <p className="relative z-10 text-blue-100/70 text-sm font-medium">Скоро</p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
