// ===== 📄 ФАЙЛ: frontend/src/screens/LeaderboardScreen.tsx =====
import { useState, useMemo, useRef, useEffect, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Gift } from 'lucide-react';
import { useAppStore } from '../stores/store';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';
import { StarParticles } from '../components/ui/StarParticles';
import { useParticleRuntimeProfile } from '../components/ui/particleRuntimeProfile';

// --- ХЕЛПЕРЫ ДЛЯ TELEGRAM ---
const triggerHaptic = (style: 'light' | 'medium' | 'heavy' | 'selection') => {
  const tg = (window as any).Telegram?.WebApp;
  if (!tg?.HapticFeedback) return;
  
  if (style === 'selection') {
    tg.HapticFeedback.selectionChanged();
  } else {
    tg.HapticFeedback.impactOccurred(style);
  }
};

// --- ТИПЫ И ДАННЫЕ ---
interface Player {
  rank: number;
  username: string;
  score: number;
  prize?: string;
  avatarSeed: number;
}

type LeaderboardTab = 'arcade' | 'campaign';

const RANK_STYLES: Record<number, { bg: string; border: string; rankClass: string; icon: string; particleColor?: string }> = {
  1: { bg: 'bg-[#3f3113]', border: 'border-[#ca8a04]/30', rankClass: 'text-yellow-400 drop-shadow-glow', icon: '👑', particleColor: '255, 215, 0' },
  2: { bg: 'bg-[#2c303a]', border: 'border-[#94a3b8]/30', rankClass: 'text-gray-300', icon: '🥈', particleColor: '176, 196, 222' },
  3: { bg: 'bg-[#402314]', border: 'border-[#ea580c]/30', rankClass: 'text-orange-400', icon: '🥉', particleColor: '205, 127, 50' },
};

const DEFAULT_RANK_STYLE = { bg: 'bg-white/5', border: 'border-white/5', rankClass: 'text-white/40', icon: '', particleColor: undefined };

const generateLeaderboard = (count: number): Player[] => {
  return Array.from({ length: count }).map((_, i) => ({
    rank: i + 1,
    username: `Player_${9900 - i}`,
    score: Math.max(1000, 10000 - i * 50 - Math.floor(Math.random() * 30)),
    prize: i === 0 ? '🐸 Эксклюзивный Пепе' : i === 1 ? '⭐ Telegram Premium' : i === 2 ? '✨ 1000 звёзд' : undefined,
    avatarSeed: i + 1
  }));
};

const INITIAL_VISIBLE_COUNT = 15;
const SKELETON_MIN_VISIBLE_MS = 240;
const AVATAR_PRELOAD_TIMEOUT_MS = 1400;

const getAvatarUrl = (seed: number) => `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;

const waitMs = (ms: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, ms);
});

const waitFrame = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => resolve());
});

function preloadImage(src: string, timeoutMs = AVATAR_PRELOAD_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    let timeoutId: number | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      resolve();
    };

    timeoutId = window.setTimeout(finish, timeoutMs);
    image.onload = finish;
    image.onerror = finish;
    image.src = src;

    if (image.complete) {
      finish();
      return;
    }

    if (typeof image.decode === 'function') {
      image.decode().then(finish).catch(() => {
        // fallback to onload/onerror/timeout
      });
    }
  });
}

async function prepareLeaderboardForDisplay(players: Player[]): Promise<void> {
  const visiblePlayers = players.slice(0, INITIAL_VISIBLE_COUNT);
  await Promise.allSettled(visiblePlayers.map((player) => preloadImage(getAvatarUrl(player.avatarSeed))));
  await waitFrame();
  await waitFrame();
}

// --- КОМПОНЕНТ: ASYNC AVATAR ---
const AsyncAvatar = memo(({ seed, rank, photoUrl }: { seed: number, rank?: number, photoUrl?: string }) => {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={`w-12 h-12 rounded-full overflow-hidden shrink-0 ring-2 relative bg-[#1A1A24] ${rank && rank <= 3 ? 'ring-white/10' : 'ring-transparent'}`}>
      <div className={`absolute inset-0 bg-white/5 ${!loaded && !photoUrl ? 'animate-pulse' : ''}`} />
      <img 
        src={photoUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`} 
        alt="avatar"
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`w-full h-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
});
AsyncAvatar.displayName = 'AsyncAvatar';

// --- КОМПОНЕНТ: ЭЛЕМЕНТ ТОП-3 ---
const TopLeaderboardItem = memo(({ player, index, animateEntry }: { player: Player, index: number, animateEntry: boolean }) => {
  const styles = RANK_STYLES[player.rank];
  const [isStamped, setIsStamped] = useState(!animateEntry);
  const [showShockwave, setShowShockwave] = useState(false);
  const { isReducedMotion, isLowEnd, isPageVisible } = useParticleRuntimeProfile();
  const topParticleProfile = useMemo(() => {
    if (isReducedMotion) {
      return { enabled: false, count: 20, speed: 0.28 };
    }
    if (isLowEnd) {
      return { enabled: true, count: 11, speed: 0.238 };
    }

    return { enabled: true, count: 20, speed: 0.28 };
  }, [isReducedMotion, isLowEnd]);

  const handleStampComplete = useCallback(() => {
    if (!animateEntry) return; 
    setIsStamped(true);
    setShowShockwave(true);
    if (player.rank === 1) triggerHaptic('heavy');
    else if (player.rank === 2) triggerHaptic('medium');
    else triggerHaptic('light');
  }, [player.rank, animateEntry]);

  return (
    <motion.div
      initial={animateEntry ? { opacity: 0, scale: 2.5, y: -40 } : false}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={animateEntry ? { delay: index * 0.3, type: "spring", stiffness: 350, damping: 24, mass: 1 } : { duration: 0 }} 
      onAnimationComplete={handleStampComplete}
      className={`flex items-center p-4 rounded-2xl border relative overflow-hidden h-[82px] mb-3 ${styles.bg} ${styles.border} shadow-lg`}
    >
      {showShockwave && (
        <motion.div
          initial={{ opacity: 0.8, scale: 0.8 }}
          animate={{ opacity: 0, scale: 2 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="absolute inset-0 bg-white/30 rounded-2xl pointer-events-none z-10"
        />
      )}
      {isStamped && styles.particleColor && topParticleProfile.enabled && (
        <div className="absolute inset-0 z-0 opacity-80 mix-blend-screen pointer-events-none overflow-hidden">
          <StarParticles
            colorRGB={styles.particleColor}
            count={topParticleProfile.count}
            speed={topParticleProfile.speed}
            running={isPageVisible}
          />
        </div>
      )}
      <div className="flex items-center justify-center w-8 mr-2 relative z-20 shrink-0">
        <span className="text-2xl drop-shadow-md">{styles.icon}</span>
      </div>
      <div className="relative z-20 mr-3">
        <AsyncAvatar seed={player.avatarSeed} rank={player.rank} />
      </div>
      <div className="flex-1 min-w-0 relative z-20 py-1">
        <div className="text-white text-base font-bold truncate">{player.username}</div>
        {player.prize && (
          <div className="flex items-center gap-1 mt-0.5">
            <Gift size={12} className="text-purple-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              {player.prize}
            </span>
          </div>
        )}
      </div>
      <div className="font-mono text-base font-black relative z-20 text-yellow-400 drop-shadow-md">
        {player.score.toLocaleString()}
      </div>
    </motion.div>
  );
});
TopLeaderboardItem.displayName = 'TopLeaderboardItem';

// --- КОМПОНЕНТ: ОБЫЧНЫЙ ЭЛЕМЕНТ ТОП-4+ ---
const RegularLeaderboardItem = memo(({ player }: { player: Player }) => {
  const styles = DEFAULT_RANK_STYLE;
  return (
    <div className={`flex items-center p-4 rounded-2xl border relative overflow-hidden h-[82px] mb-3 ${styles.bg} ${styles.border}`}>
      <div className="flex items-center justify-center w-8 mr-2 relative z-10 shrink-0">
        <span className={`font-bold text-lg ${styles.rankClass}`}>{player.rank}</span>
      </div>
      <div className="relative z-10 mr-3">
        <AsyncAvatar seed={player.avatarSeed} rank={player.rank} />
      </div>
      <div className="flex-1 min-w-0 relative z-10 py-1">
        <div className="text-white text-base font-bold truncate">{player.username}</div>
      </div>
      <div className="font-mono text-base font-black relative z-10 text-yellow-400/80">
        {player.score.toLocaleString()}
      </div>
    </div>
  );
});
RegularLeaderboardItem.displayName = 'RegularLeaderboardItem';

const SkeletonLeaderboardItem = memo(({ rank }: { rank: number }) => {
  const isTop = rank <= 3;
  const topStyles = RANK_STYLES[rank];
  const cardClass = isTop
    ? `${topStyles.bg} ${topStyles.border} shadow-lg`
    : `${DEFAULT_RANK_STYLE.bg} ${DEFAULT_RANK_STYLE.border}`;

  return (
    <div className={`flex items-center p-4 rounded-2xl border relative overflow-hidden h-[82px] mb-3 ${cardClass}`}>
      <div className="flex items-center justify-center w-8 mr-2 relative z-10 shrink-0">
        {isTop ? (
          <span className="text-2xl opacity-35">{topStyles.icon}</span>
        ) : (
          <div className="h-5 w-5 rounded-md bg-white/10 animate-pulse" />
        )}
      </div>
      <div className="relative z-10 mr-3">
        <div className={`w-12 h-12 rounded-full bg-white/10 animate-pulse ${isTop ? 'ring-2 ring-white/10' : ''}`} />
      </div>
      <div className="flex-1 min-w-0 relative z-10 py-1">
        <div className="h-4 w-28 rounded bg-white/12 animate-pulse mb-2" />
        {isTop && <div className="h-2.5 w-24 rounded bg-white/10 animate-pulse" />}
      </div>
      <div className="h-5 w-16 rounded bg-white/12 animate-pulse" />
    </div>
  );
});
SkeletonLeaderboardItem.displayName = 'SkeletonLeaderboardItem';

const LeaderboardSkeleton = memo(({ count = INITIAL_VISIBLE_COUNT }: { count?: number }) => (
  <>
    {Array.from({ length: count }).map((_, index) => (
      <SkeletonLeaderboardItem key={`skeleton-${index}`} rank={index + 1} />
    ))}
  </>
));
LeaderboardSkeleton.displayName = 'LeaderboardSkeleton';

// --- КОМПОНЕНТ: ДИНАМИЧЕСКИЙ ФУТЕР ТЕКУЩЕГО ИГРОКА ---
const CARD_GAP_PX = 12;
const BOTTOM_NAV_SELECTOR = '[data-bottom-nav]';

const CurrentUserFooter = memo(({ user, isDocked, pulseTrigger }: { user: any, isDocked: boolean, pulseTrigger?: number }) => {
  const currentUserRank = useMemo(() => ({
    rank: 101,
    username: user?.username || user?.first_name || 'Вы',
    score: 150,
    avatarSeed: user?.id || 999,
    photoUrl: user?.photo_url || user?.photoUrl 
  }), [user]);
  const [isPulseActive, setIsPulseActive] = useState(false);

  useEffect(() => {
    if (!isDocked || pulseTrigger === undefined) return;
    setIsPulseActive(true);
    const timeout = window.setTimeout(() => setIsPulseActive(false), 560);
    return () => window.clearTimeout(timeout);
  }, [isDocked, pulseTrigger]);

  const baseDocked = {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderColor: 'rgba(96, 165, 250, 0.35)',
    boxShadow: '0 0 10px rgba(96, 165, 250, 0.25)',
    scale: 1,
  };

  const floating = {
    backgroundColor: 'rgba(26, 26, 36, 1)',
    borderColor: 'rgba(59, 130, 246, 0.5)',
    boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
    scale: 1.02,
  };

  const pulseDocked = {
    backgroundColor: ['rgba(255, 255, 255, 0.07)', 'rgba(255, 255, 255, 0.10)', 'rgba(255, 255, 255, 0.07)'],
    borderColor: ['rgba(59, 130, 246, 0.45)', 'rgba(34, 211, 238, 0.95)', 'rgba(96, 165, 250, 0.35)'],
    boxShadow: ['0 0 0 rgba(0,0,0,0)', '0 0 22px rgba(34, 211, 238, 0.45)', '0 0 10px rgba(96, 165, 250, 0.25)'],
    scale: [1.02, 1.015, 1],
  };

  return (
    <motion.div
      animate={isDocked ? (isPulseActive ? pulseDocked : baseDocked) : floating}
      transition={isPulseActive ? { duration: 0.55, ease: 'easeOut', times: [0, 0.5, 1] } : { duration: 0.25, ease: "easeOut" }}
      className="relative overflow-hidden rounded-2xl border-2 flex items-center h-[82px] p-4 pointer-events-auto"
    >
      <motion.div
        animate={{ opacity: isDocked ? 0 : 0.6 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-blue-500/10 via-blue-400/5 to-transparent skew-x-12"
      />

      <div className="flex flex-col items-center justify-center w-8 mr-2 leading-none relative z-10 shrink-0">
         <span className="text-white/40 font-bold text-[10px] uppercase mb-1">Место</span>
         <span className={`font-black tracking-tighter transition-colors ${isDocked ? 'text-blue-200 text-sm' : 'text-cyan-300 text-sm drop-shadow-md'}`}>
           #{currentUserRank.rank.toLocaleString()}
         </span>
      </div>

      <div className="relative z-10 mr-3">
        <AsyncAvatar seed={currentUserRank.avatarSeed} photoUrl={currentUserRank.photoUrl} />
      </div>

      <div className="flex-1 min-w-0 relative z-10 py-1">
        <div className="text-white text-base font-bold truncate">{currentUserRank.username}</div>
      </div>

      <div className={`font-mono text-xl font-black drop-shadow-md relative z-10 transition-colors ${isDocked ? 'text-blue-200' : 'text-cyan-300'}`}>
        {currentUserRank.score.toLocaleString()}
      </div>
    </motion.div>
  );
});
CurrentUserFooter.displayName = 'CurrentUserFooter';

// --- ОСНОВНОЙ ЭКРАН ---
export function LeaderboardScreen() {
  const [activeTab, setActiveTab] = useState<LeaderboardTab>('arcade');
  const [displayTab, setDisplayTab] = useState<LeaderboardTab>('arcade');
  const [isSwitchingTab, setIsSwitchingTab] = useState(false);
  const [listRenderVersion, setListRenderVersion] = useState(0);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [isDocked, setIsDocked] = useState(false);
  const [dockPulseKey, setDockPulseKey] = useState(0);
  const [bottomNavHeight, setBottomNavHeight] = useState(96);
  
  const { user } = useAppStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentUserRowRef = useRef<HTMLDivElement>(null);
  const visibleCountRef = useRef(INITIAL_VISIBLE_COUNT);
  const switchRequestIdRef = useRef(0);

  const leaderboards = useMemo<Record<LeaderboardTab, Player[]>>(() => ({
    arcade: generateLeaderboard(100),
    campaign: generateLeaderboard(100),
  }), []);
  const leaderboard = leaderboards[displayTab];
  const stickyBottomPx = bottomNavHeight + CARD_GAP_PX;
  const shouldAnimateListEnter = listRenderVersion > 0;

  useEffect(() => {
    const nav = document.querySelector(BOTTOM_NAV_SELECTOR) as HTMLElement | null;
    if (!nav) return;

    const measure = () => {
      const measuredHeight = Math.ceil(nav.getBoundingClientRect().height);
      if (measuredHeight > 0) setBottomNavHeight(measuredHeight);
    };

    measure();
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    resizeObserver?.observe(nav);
    window.addEventListener('resize', measure);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    if (visibleCount < leaderboard.length) {
      setIsDocked(false);
      return;
    }

    const root = scrollRef.current;
    const target = currentUserRowRef.current;
    if (!root || !target || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsDocked(entry.isIntersecting),
      { root, threshold: 0.6 }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [visibleCount, leaderboard.length, displayTab]);

  // ИСПРАВЛЕНО: Звук/отклик при стыковке обрабатывается через эффект, чтобы не спамить
  const prevDocked = useRef(isDocked);
  useEffect(() => {
    if (isDocked !== prevDocked.current) {
      if (isDocked) {
        triggerHaptic('medium'); // Щелчок при стыковке
        setDockPulseKey((prev) => prev + 1);
      }
      else triggerHaptic('light'); // Мягкий отрыв
      prevDocked.current = isDocked;
    }
  }, [isDocked]);

  useEffect(() => () => {
    switchRequestIdRef.current += 1;
  }, []);

  const handleTabChange = useCallback((tab: LeaderboardTab) => {
    if (tab === activeTab && !isSwitchingTab) return;

    const requestId = switchRequestIdRef.current + 1;
    switchRequestIdRef.current = requestId;
    triggerHaptic('selection');
    setActiveTab(tab);
    setIsSwitchingTab(true);
    setIsDocked(false);
    setVisibleCount(INITIAL_VISIBLE_COUNT);
    visibleCountRef.current = INITIAL_VISIBLE_COUNT;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    const startedAt = performance.now();
    const targetLeaderboard = leaderboards[tab];

    void (async () => {
      try {
        await prepareLeaderboardForDisplay(targetLeaderboard);
        const elapsed = performance.now() - startedAt;
        if (elapsed < SKELETON_MIN_VISIBLE_MS) {
          await waitMs(SKELETON_MIN_VISIBLE_MS - elapsed);
        }

        if (switchRequestIdRef.current !== requestId) return;

        setDisplayTab(tab);
        setListRenderVersion((prev) => prev + 1);
      } finally {
        if (switchRequestIdRef.current === requestId) {
          setIsSwitchingTab(false);
        }
      }
    })();
  }, [activeTab, isSwitchingTab, leaderboards]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const currentCount = visibleCountRef.current;

    // Пагинация
    if (scrollHeight - scrollTop <= clientHeight + 200) {
      if (currentCount < leaderboard.length) {
        const next = Math.min(currentCount + 10, leaderboard.length);
        setVisibleCount(next);
        visibleCountRef.current = next;
      }
    }

    if (typeof IntersectionObserver === 'undefined') {
      if (visibleCountRef.current >= leaderboard.length) {
        const isAtBottom = (scrollHeight - scrollTop - clientHeight) <= 5;
        setIsDocked(prev => (prev !== isAtBottom ? isAtBottom : prev));
      } else {
        setIsDocked(false);
      }
    }
  }, [leaderboard.length]);

  return (
    <div className="px-4 h-full flex flex-col pt-4 relative overflow-hidden">
      <AdaptiveParticles
        variant="bg"
        tone="blue"
        baseCount={18}
        baseSpeed={0.09}
        className="z-0 opacity-35"
      />
      
      {/* Banner */}
      <div className="bg-gradient-to-b from-yellow-500/20 to-transparent p-6 rounded-3xl border border-yellow-500/30 mb-6 text-center relative overflow-hidden shrink-0">
        <AdaptiveParticles
          variant="accent"
          tone="gold"
          baseCount={14}
          baseSpeed={0.16}
          className="z-0 opacity-55"
        />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 bg-yellow-500/20 blur-3xl -z-10"></div>
        <Trophy size={56} className="mx-auto text-yellow-400 mb-2 drop-shadow-glow relative z-10" />
        <h2 className="text-3xl font-black text-white uppercase tracking-wide drop-shadow-md relative z-10">Сезон #1</h2>
        <div className="inline-flex items-center gap-2 mt-2 bg-black/30 px-3 py-1 rounded-full border border-white/10 relative z-10">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <p className="text-yellow-200/80 text-xs font-mono">14д 08ч 15м</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-1 mb-6 flex relative border border-white/10 shrink-0">
        <div className="absolute top-1 bottom-1 left-1 right-1 flex">
          {activeTab === 'arcade' ? (
            <motion.div layoutId="activeTab" className="flex-1 bg-white/10 rounded-xl shadow-sm" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
          ) : <div className="flex-1" />}
          {activeTab === 'campaign' ? (
            <motion.div layoutId="activeTab" className="flex-1 bg-white/10 rounded-xl shadow-sm" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
          ) : <div className="flex-1" />}
        </div>
        <button onClick={() => handleTabChange('arcade')} className={`flex-1 py-3 text-sm font-bold z-10 transition-colors flex items-center justify-center gap-2 ${activeTab === 'arcade' ? 'text-white' : 'text-white/50'}`}>
          <span aria-hidden="true">🕹</span> Arcade
        </button>
        <button onClick={() => handleTabChange('campaign')} className={`flex-1 py-3 text-sm font-bold z-10 transition-colors flex items-center justify-center gap-2 ${activeTab === 'campaign' ? 'text-white' : 'text-white/50'}`}>
          <span aria-hidden="true">⚡️</span> Adventure
        </button>
      </div>

      {/* List Container */}
      <div className="flex-1 overflow-hidden relative rounded-t-2xl">
        <div 
          ref={scrollRef} 
          onScroll={isSwitchingTab ? undefined : handleScroll}
          style={{ paddingBottom: stickyBottomPx }}
          className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar px-1"
        >
          {isSwitchingTab ? (
            <LeaderboardSkeleton />
          ) : (
            <motion.div
              key={`${displayTab}-${listRenderVersion}`}
              initial={shouldAnimateListEnter ? { opacity: 0, y: 10, filter: 'blur(4px)' } : false}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={shouldAnimateListEnter ? { duration: 0.28, ease: 'easeOut' } : { duration: 0 }}
            >
              {leaderboard.slice(0, visibleCount).map((player, i) => {
                if (player.rank <= 3) {
                  return <TopLeaderboardItem key={`top-${displayTab}-${player.rank}`} player={player} index={i} animateEntry={true} />;
                }
                return <RegularLeaderboardItem key={`reg-${displayTab}-${player.rank}`} player={player} />;
              })}

              {visibleCount < leaderboard.length && (
                <div className="py-4 flex justify-center opacity-50">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                </div>
              )}

              {visibleCount >= leaderboard.length && (
                <div
                  ref={currentUserRowRef}
                  className={isDocked ? 'visible' : 'invisible pointer-events-none'}
                  aria-hidden={!isDocked}
                >
                  <CurrentUserFooter user={user} isDocked pulseTrigger={dockPulseKey} />
                </div>
              )}
            </motion.div>
          )}
        </div>

        {!isSwitchingTab && !isDocked && (
          <div className="absolute left-1 right-1 z-50 pointer-events-none" style={{ bottom: stickyBottomPx }}>
            <CurrentUserFooter user={user} isDocked={false} />
          </div>
        )}
      </div>

    </div>
  );
}
