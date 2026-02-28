// ===== 📄 ФАЙЛ: frontend/src/screens/FriendsLeaderboardScreen.tsx =====
import { useState, useMemo, useRef, useEffect, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Info, UserPlus, Gift } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../stores/store';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';
import { StarParticles } from '../components/ui/StarParticles';
import { useParticleRuntimeProfile } from '../components/ui/particleRuntimeProfile';
import { useReferral } from '../hooks/hooks';
import type { ReferralLeaderboardEntry } from '../game/types';

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
interface ReferralPlayer {
  rank: number;
  displayName: string;
  username: string | null;
  referrals: number;
  avatarSeed: number;
  photoUrl?: string | null;
  userId?: number;
}

const CYAN_RANK_STYLES: Record<number, { bg: string; border: string; rankClass: string; icon: string; particleColor?: string }> = {
  1: { bg: 'bg-[#0a2530]', border: 'border-[#22d3ee]/30', rankClass: 'text-cyan-400 drop-shadow-glow', icon: '🥇', particleColor: '6, 182, 212' },
  2: { bg: 'bg-[#121c2d]', border: 'border-[#60a5fa]/30', rankClass: 'text-blue-300', icon: '🥈', particleColor: '59, 130, 246' },
  3: { bg: 'bg-[#0f2430]', border: 'border-[#38bdf8]/30', rankClass: 'text-sky-400', icon: '🥉', particleColor: '14, 165, 233' },
};

const DEFAULT_RANK_STYLE = { bg: 'bg-white/5', border: 'border-white/5', rankClass: 'text-white/40', icon: '', particleColor: undefined };
const DEFAULT_PLAYER_NAME = 'Player';

const normalizeUsername = (rawUsername: unknown): string | null => {
  if (typeof rawUsername !== 'string') return null;
  const normalized = rawUsername.trim().replace(/^@+/, '');
  return normalized.length > 0 ? normalized : null;
};

const normalizeDisplayName = (rawDisplayName: unknown, rawUsername?: unknown, fallback = DEFAULT_PLAYER_NAME): string => {
  if (typeof rawDisplayName === 'string') {
    const trimmed = rawDisplayName.trim();
    if (trimmed.length > 0) return trimmed;
  }
  const normalizedUsername = normalizeUsername(rawUsername);
  if (normalizedUsername) return normalizedUsername;
  return fallback;
};

const formatUsernameForUi = (username: string | null): string | null => {
  if (!username) return null;
  return `@${username}`;
};

/** Маппинг API данных → ReferralPlayer для UI */
function mapApiToPlayers(entries: ReferralLeaderboardEntry[]): ReferralPlayer[] {
  return entries.map((entry) => {
    const normalizedUsername = normalizeUsername(entry.username);
    return {
      rank: entry.rank,
      displayName: normalizeDisplayName(entry.first_name, entry.username, DEFAULT_PLAYER_NAME),
      username: normalizedUsername,
      referrals: entry.score,
      avatarSeed: entry.user_id,
      photoUrl: entry.photo_url,
      userId: entry.user_id,
    };
  });
}

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
      if (timeoutId !== null) window.clearTimeout(timeoutId);
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
      image.decode().then(finish).catch(() => {});
    }
  });
}

async function prepareLeaderboardForDisplay(players: ReferralPlayer[]): Promise<void> {
  const visiblePlayers = players.slice(0, INITIAL_VISIBLE_COUNT);
  await Promise.allSettled(
    visiblePlayers.map((player) =>
      preloadImage(player.photoUrl || getAvatarUrl(player.avatarSeed))
    )
  );
  await waitFrame();
  await waitFrame();
}

// --- КОМПОНЕНТ: ИНФО О СЕЗОНЕ (СВАЙП-МОДАЛКА) ---
const ReferralInfoModal = memo(({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/55 backdrop-blur-[2px] z-[2000]"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(e, info) => {
              if (info.offset.y > 100 || info.velocity.y > 500) {
                onClose();
              }
            }}
            className="fixed bottom-0 left-0 right-0 z-[2001] bg-[#1a1a24] rounded-t-[32px] border-t border-[#22d3ee]/30 p-6 pb-12 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
            style={{ paddingBottom: 'calc(3rem + var(--app-safe-bottom))' }}
          >
            {/* Ползунок для свайпа */}
            <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-6" />

            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/20 mb-4">
                <Gift className="text-cyan-400 w-8 h-8" />
              </div>
              <h3 className="text-2xl font-black text-white uppercase tracking-wide mb-6 drop-shadow-md">
                Правила и Награды
              </h3>
              
              <div className="space-y-4 text-left">
                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <p className="text-white/90 font-medium text-sm leading-relaxed">
                    Зови друзей и поднимайся в топе.
                  </p>
                </div>

                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <p className="text-white/90 font-medium text-sm leading-relaxed">
                    Приглашенным пользователем считается игрок, достигший <span className="text-cyan-400 font-bold">50-го уровня</span> в режиме Arcade.
                  </p>
                </div>

                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <p className="text-white/90 font-medium text-sm leading-relaxed">
                    По завершении сезона игроки, пригласившие <span className="text-cyan-400 font-bold">наибольшее количество активных пользователей</span>, получат награды.
                  </p>
                </div>
                
                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <p className="text-white/90 font-medium text-sm leading-relaxed">
                    Также <span className="text-cyan-400 font-bold">5 случайных пользователей</span>, попавших в топ-1000 получат призы.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
    ,
    document.body
  );
});
ReferralInfoModal.displayName = 'ReferralInfoModal';

// --- КОМПОНЕНТ: ASYNC AVATAR ---
const AsyncAvatar = memo(({ seed, rank, photoUrl }: { seed: number, rank?: number, photoUrl?: string | null }) => {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={`w-10 h-10 rounded-full overflow-hidden shrink-0 ring-2 relative bg-[#1A1A24] ${rank && rank <= 3 ? 'ring-white/10' : 'ring-transparent'}`}>
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

interface PlayerIdentityTextProps {
  displayName: string;
  username: string | null;
  nameClassName?: string;
  usernameClassName?: string;
}

const PlayerIdentityText = memo(({ displayName, username, nameClassName, usernameClassName }: PlayerIdentityTextProps) => {
  const formattedUsername = formatUsernameForUi(username);

  return (
    <>
      <div className={nameClassName ?? 'text-white text-[15px] font-bold leading-tight truncate'}>{displayName}</div>
      {formattedUsername && (
        <div className={usernameClassName ?? 'text-[11px] leading-tight text-white/55 truncate mt-0.5'}>{formattedUsername}</div>
      )}
    </>
  );
});
PlayerIdentityText.displayName = 'PlayerIdentityText';

// --- КОМПОНЕНТ: ЭЛЕМЕНТ ТОП-3 ---
const TopReferralItem = memo(({ player, index, animateEntry }: { player: ReferralPlayer, index: number, animateEntry: boolean }) => {
  const styles = CYAN_RANK_STYLES[player.rank];
  const [isAnimationDone, setIsAnimationDone] = useState(!animateEntry);
  const { isReducedMotion, isLowEnd, isPageVisible } = useParticleRuntimeProfile();
  const topParticleProfile = useMemo(() => {
    if (isReducedMotion) return { enabled: false, count: 20, speed: 0.28 };
    if (isLowEnd) return { enabled: true, count: 11, speed: 0.238 };
    return { enabled: true, count: 20, speed: 0.28 };
  }, [isReducedMotion, isLowEnd]);

  const handleAnimationComplete = useCallback(() => {
    if (!animateEntry) return; 
    setIsAnimationDone(true);
  }, [animateEntry]);

  const startX = index % 2 === 0 ? 80 : -80;

  return (
    <motion.div
      initial={animateEntry ? { opacity: 0, x: startX } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={animateEntry ? { delay: index * 0.1, duration: 0.4, ease: "easeOut" } : { duration: 0 }} 
      onAnimationComplete={handleAnimationComplete}
      className={`flex items-center px-3 py-2 rounded-2xl border relative overflow-hidden h-[72px] mb-3 ${styles.bg} ${styles.border} shadow-lg`}
    >
      {isAnimationDone && styles.particleColor && topParticleProfile.enabled && (
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
        <span className="text-xl drop-shadow-md">{styles.icon}</span>
      </div>
      <div className="relative z-20 mr-3">
        <AsyncAvatar seed={player.avatarSeed} rank={player.rank} photoUrl={player.photoUrl} />
      </div>
      <div className="flex-1 min-w-0 relative z-20 py-1">
        <PlayerIdentityText displayName={player.displayName} username={player.username} />
      </div>
      <div className="font-mono text-base font-black relative z-20 text-cyan-400 drop-shadow-md shrink-0 pl-2 text-right flex items-center gap-1.5">
        {player.referrals.toLocaleString()} <UserPlus size={16} className="text-cyan-500/70" />
      </div>
    </motion.div>
  );
});
TopReferralItem.displayName = 'TopReferralItem';

// --- КОМПОНЕНТ: ОБЫЧНЫЙ ЭЛЕМЕНТ ТОП-4+ ---
const RegularReferralItem = memo(({ player, isCurrentUser }: { player: ReferralPlayer; isCurrentUser?: boolean }) => {
  const styles = DEFAULT_RANK_STYLE;
  return (
    <div className={`flex items-center px-3 py-2 rounded-2xl border relative overflow-hidden h-[72px] mb-3 ${isCurrentUser ? 'bg-blue-500/8 border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.15)]' : `${styles.bg} ${styles.border}`}`}>
      <div className="flex items-center justify-center w-8 mr-2 relative z-10 shrink-0">
        <span className={`font-bold text-lg ${isCurrentUser ? 'text-blue-300' : styles.rankClass}`}>{player.rank}</span>
      </div>
      <div className="relative z-10 mr-3">
        <AsyncAvatar seed={player.avatarSeed} rank={player.rank} photoUrl={player.photoUrl} />
      </div>
      <div className="flex-1 min-w-0 relative z-10 py-0.5">
        <PlayerIdentityText
          displayName={player.displayName}
          username={player.username}
          usernameClassName="text-[11px] leading-tight text-white/50 truncate mt-0.5"
        />
      </div>
      <div className="font-mono text-base font-black relative z-10 text-cyan-400/80 shrink-0 pl-2 text-right flex items-center gap-1.5">
        {player.referrals.toLocaleString()} <UserPlus size={16} className="text-white/30" />
      </div>
    </div>
  );
});
RegularReferralItem.displayName = 'RegularReferralItem';

const SkeletonReferralItem = memo(({ rank }: { rank: number }) => {
  const isTop = rank <= 3;
  const topStyles = CYAN_RANK_STYLES[rank];
  const cardClass = isTop
    ? `${topStyles.bg} ${topStyles.border} shadow-lg`
    : `${DEFAULT_RANK_STYLE.bg} ${DEFAULT_RANK_STYLE.border}`;

  return (
    <div className={`flex items-center px-3 py-2 rounded-2xl border relative overflow-hidden mb-3 ${cardClass} h-[72px]`}>
      <div className="flex items-center justify-center w-8 mr-2 relative z-10 shrink-0">
        {isTop ? (
          <span className="text-xl opacity-35">{topStyles.icon}</span>
        ) : (
          <div className="h-5 w-5 rounded-md bg-white/10 animate-pulse" />
        )}
      </div>
      <div className="relative z-10 mr-3">
        <div className={`w-10 h-10 rounded-full bg-white/10 animate-pulse ${isTop ? 'ring-2 ring-white/10' : ''}`} />
      </div>
      <div className="flex-1 min-w-0 relative z-10 py-1">
        <div className="h-4 w-28 rounded bg-white/12 animate-pulse mb-1.5" />
        <div className="h-2.5 w-24 rounded bg-white/10 animate-pulse" />
      </div>
      <div className="h-5 w-12 rounded bg-white/12 animate-pulse" />
    </div>
  );
});
SkeletonReferralItem.displayName = 'SkeletonReferralItem';

const LeaderboardSkeleton = memo(({ count = INITIAL_VISIBLE_COUNT }: { count?: number }) => (
  <>
    {Array.from({ length: count }).map((_, index) => (
      <SkeletonReferralItem key={`skeleton-${index}`} rank={index + 1} />
    ))}
  </>
));
LeaderboardSkeleton.displayName = 'LeaderboardSkeleton';

// --- КОМПОНЕНТ: ДИНАМИЧЕСКИЙ ФУТЕР ТЕКУЩЕГО ИГРОКА ---
const CARD_GAP_PX = 12;
const BOTTOM_NAV_SELECTOR = '[data-bottom-nav]';

const CurrentUserFooter = memo(({ user, isDocked, pulseTrigger, myPosition, myScore }: {
  user: any;
  isDocked: boolean;
  pulseTrigger?: number;
  myPosition: number | null;
  myScore: number;
}) => {
  const currentUserRank = useMemo(() => {
    const normalizedUsername = normalizeUsername(user?.username);
    const displayName = normalizeDisplayName(user?.firstName ?? user?.first_name, normalizedUsername, DEFAULT_PLAYER_NAME);

    return {
      rank: myPosition ?? 0,
      displayName,
      username: normalizedUsername,
      referrals: myScore,
      avatarSeed: user?.id || 999,
      photoUrl: user?.photo_url || user?.photoUrl,
    };
  }, [user, myPosition, myScore]);
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

  const rankDisplay = currentUserRank.rank > 0
    ? `#${currentUserRank.rank.toLocaleString()}`
    : '—';

  return (
    <motion.div
      animate={isDocked ? (isPulseActive ? pulseDocked : baseDocked) : floating}
      transition={isPulseActive ? { duration: 0.55, ease: 'easeOut', times: [0, 0.5, 1] } : { duration: 0.25, ease: "easeOut" }}
      className="relative overflow-hidden rounded-2xl border-2 flex items-center h-[72px] px-3 py-2 pointer-events-auto"
    >
      <motion.div
        animate={{ opacity: isDocked ? 0 : 0.6 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-blue-500/10 via-blue-400/5 to-transparent skew-x-12"
      />

      <div className="flex flex-col items-center justify-center w-8 mr-2 leading-none relative z-10 shrink-0">
         <span className="text-white/40 font-bold text-[10px] uppercase mb-1">Место</span>
         <span className={`font-black tracking-tighter transition-colors ${isDocked ? 'text-blue-200 text-sm' : 'text-cyan-300 text-sm drop-shadow-md'}`}>
           {rankDisplay}
         </span>
      </div>

      <div className="relative z-10 mr-3">
        <AsyncAvatar seed={currentUserRank.avatarSeed} photoUrl={currentUserRank.photoUrl} />
      </div>

      <div className="flex-1 min-w-0 relative z-10 py-0.5">
        <PlayerIdentityText displayName={currentUserRank.displayName} username={currentUserRank.username} />
      </div>

      <div className={`font-mono text-xl font-black drop-shadow-md relative z-10 transition-colors flex items-center gap-1.5 ${isDocked ? 'text-blue-200' : 'text-cyan-300'}`}>
        {currentUserRank.referrals.toLocaleString()} <UserPlus size={18} className="opacity-70" />
      </div>
    </motion.div>
  );
});
CurrentUserFooter.displayName = 'CurrentUserFooter';

// --- ОСНОВНОЙ ЭКРАН ---
interface FriendsLeaderboardScreenProps {
  embedded?: boolean;
}

export function FriendsLeaderboardScreen({ embedded = false }: FriendsLeaderboardScreenProps) {
  const [listRenderVersion, setListRenderVersion] = useState(0);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [isDocked, setIsDocked] = useState(false);
  const [dockPulseKey, setDockPulseKey] = useState(0);
  const [bottomNavHeight, setBottomNavHeight] = useState(96);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  const { user } = useAppStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentUserRowRef = useRef<HTMLDivElement>(null);
  const visibleCountRef = useRef(INITIAL_VISIBLE_COUNT);

  const {
    referralLeaders: apiLeaders,
    myReferralPosition,
    myReferralScore,
    myReferralInTop,
    referralTotalParticipants,
    fetchReferralLeaderboard,
  } = useReferral();

  // Маппим API данные → UI формат
  const leaderboard = useMemo(() => mapApiToPlayers(apiLeaders), [apiLeaders]);

  const stickyBottomPx = bottomNavHeight + CARD_GAP_PX;
  const shouldAnimateListEnter = listRenderVersion > 0;

  // Загрузка данных
  useEffect(() => {
    const startedAt = performance.now();
    void (async () => {
      await fetchReferralLeaderboard(100);
    })();
  }, [fetchReferralLeaderboard]);

  // Подготовка аватаров и отображение
  useEffect(() => {
    if (apiLeaders.length === 0 && isLoading) return;

    const startedAt = performance.now();
    void (async () => {
      await prepareLeaderboardForDisplay(leaderboard);
      const elapsed = performance.now() - startedAt;
      if (elapsed < SKELETON_MIN_VISIBLE_MS) {
        await waitMs(SKELETON_MIN_VISIBLE_MS - elapsed);
      }
      setIsLoading(false);
      setListRenderVersion(1);
    })();
  }, [leaderboard, apiLeaders.length]);

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
    if (myReferralInTop) {
      setIsDocked(false);
      return;
    }

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
  }, [visibleCount, leaderboard.length, myReferralInTop]);

  const prevDocked = useRef(isDocked);
  useEffect(() => {
    if (isDocked !== prevDocked.current) {
      if (isDocked) {
        triggerHaptic('medium');
        setDockPulseKey((prev) => prev + 1);
      }
      else triggerHaptic('light');
      prevDocked.current = isDocked;
    }
  }, [isDocked]);

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
    <div className={`h-full flex flex-col relative overflow-hidden ${embedded ? '' : 'px-4 pt-6'}`}>
      <AdaptiveParticles
        variant="bg"
        tone="blue"
        baseCount={18}
        baseSpeed={0.09}
        className="z-0 opacity-35"
      />
      
      {/* Banner */}
      <div className="bg-gradient-to-b from-cyan-500/20 to-transparent p-6 rounded-3xl border border-cyan-500/30 mb-6 text-center relative overflow-hidden shrink-0">
        <AdaptiveParticles
          variant="accent"
          tone="blue"
          baseCount={14}
          baseSpeed={0.16}
          className="z-0 opacity-55"
        />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 bg-cyan-500/20 blur-3xl -z-10"></div>
        
        <button 
          onClick={() => { triggerHaptic('light'); setIsInfoModalOpen(true); }}
          aria-label="Информация о сезоне"
          className="absolute top-3.5 right-3.5 z-20 w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 border border-white/20 text-white/75 hover:text-white hover:bg-white/15 active:scale-95 transition-all backdrop-blur-sm shadow-[0_4px_14px_rgba(0,0,0,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
        >
          <Info size={21} />
        </button>

        <Trophy size={56} className="mx-auto text-cyan-400 mb-2 drop-shadow-glow relative z-10" />
        <h2 className="text-3xl font-black text-white uppercase tracking-wide drop-shadow-md relative z-10">Топ рефоводов</h2>
        <div className="inline-flex items-center gap-2 mt-2 bg-black/30 px-3 py-1 rounded-full border border-white/10 relative z-10">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div>
          <p className="text-cyan-200/80 text-xs font-mono">Сезон 1</p>
        </div>
      </div>

      {/* List Container */}
      <div className="flex-1 overflow-hidden relative rounded-t-2xl">
        <div 
          ref={scrollRef} 
          onScroll={isLoading ? undefined : handleScroll}
          style={{ paddingBottom: stickyBottomPx }}
          className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar px-1"
        >
          {isLoading ? (
            <LeaderboardSkeleton />
          ) : leaderboard.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">🏆</div>
              <p className="text-white/50 text-sm">Пока нет участников</p>
              <p className="text-white/30 text-xs mt-1">Приглашай друзей и стань первым!</p>
            </div>
          ) : (
            <motion.div
              key={`friends-list-${listRenderVersion}`}
              initial={shouldAnimateListEnter ? { opacity: 0, y: 10, filter: 'blur(4px)' } : false}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={shouldAnimateListEnter ? { duration: 0.28, ease: 'easeOut' } : { duration: 0 }}
            >
              {leaderboard.slice(0, visibleCount).map((player, i) => {
                const isMe = player.userId === user?.id;
                if (player.rank <= 3) {
                  return (
                    <div key={`top-ref-${player.rank}`} className={isMe ? 'rounded-2xl ring-2 ring-blue-500/40 shadow-[0_0_12px_rgba(59,130,246,0.15)]' : ''}>
                      <TopReferralItem player={player} index={i} animateEntry={true} />
                    </div>
                  );
                }
                return <RegularReferralItem key={`reg-ref-${player.rank}`} player={player} isCurrentUser={isMe} />;
              })}

              {visibleCount < leaderboard.length && (
                <div className="py-4 flex justify-center opacity-50">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                </div>
              )}

              {visibleCount >= leaderboard.length && (
                <>
                  {/* End-of-list indicator */}
                  <div className="flex flex-col items-center py-6 opacity-50">
                    <div className="w-12 h-[1px] bg-white/20 mb-3" />
                    <p className="text-white/30 text-xs font-medium">
                      {referralTotalParticipants > leaderboard.length
                        ? `Топ-${leaderboard.length} из ${referralTotalParticipants}`
                        : `${leaderboard.length} ${leaderboard.length === 1 ? 'участник' : leaderboard.length < 5 ? 'участника' : 'участников'}`
                      }
                    </p>
                  </div>

                  {/* Docked current user footer (only when NOT in top) */}
                  {!myReferralInTop && (
                    <div
                      ref={currentUserRowRef}
                      className={isDocked ? 'visible' : 'invisible pointer-events-none'}
                      aria-hidden={!isDocked}
                    >
                      <CurrentUserFooter
                        user={user}
                        isDocked
                        pulseTrigger={dockPulseKey}
                        myPosition={myReferralPosition}
                        myScore={myReferralScore}
                      />
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}
        </div>

        {!isLoading && !isDocked && !myReferralInTop && leaderboard.length > 0 && (
          <div className="absolute left-1 right-1 z-50 pointer-events-none" style={{ bottom: stickyBottomPx }}>
            <CurrentUserFooter
              user={user}
              isDocked={false}
              myPosition={myReferralPosition}
              myScore={myReferralScore}
            />
          </div>
        )}
      </div>
      
      {/* Модалка с информацией */}
      <ReferralInfoModal isOpen={isInfoModalOpen} onClose={() => setIsInfoModalOpen(false)} />
    </div>
  );
}