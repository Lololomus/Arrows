// ===== 📄 ФАЙЛ: frontend/src/screens/LeaderboardScreen.tsx =====
import { useState, useMemo, useRef, useEffect, useCallback, memo, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Gift, Info } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../stores/store';
import { socialApi } from '../api/client';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';
import { StarParticles } from '../components/ui/StarParticles';
import { useParticleRuntimeProfile } from '../components/ui/particleRuntimeProfile';
import { useCountdown } from '../hooks/useCountdown';
import { formatNumber, getAppLocale, translate } from '../i18n';

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
  displayName: string;
  username: string | null;
  score: number;
  prize?: string;
  avatarSeed: number;
  photoUrl?: string | null;
  userId?: number;
}

type LeaderboardModeId = 'arcade' | 'campaign';
type LiveBoardType = 'global' | 'weekly' | 'arcade';

interface LeaderboardModeConfig {
  id: LeaderboardModeId;
  label: string;
  icon: string;
  state: 'live' | 'coming_soon';
  boardType?: LiveBoardType;
  emptyTitle?: string;
  emptySubtitle?: string;
}

const RANK_STYLES: Record<number, { bg: string; border: string; rankClass: string; icon: string; particleColor?: string }> = {
  1: { bg: 'bg-[#3f3113]', border: 'border-[#ca8a04]/30', rankClass: 'text-yellow-400 drop-shadow-glow', icon: '🥇', particleColor: '255, 215, 0' },
  2: { bg: 'bg-[#2c303a]', border: 'border-[#94a3b8]/30', rankClass: 'text-gray-300', icon: '🥈', particleColor: '176, 196, 222' },
  3: { bg: 'bg-[#402314]', border: 'border-[#ea580c]/30', rankClass: 'text-orange-400', icon: '🥉', particleColor: '205, 127, 50' },
  4: { bg: 'bg-[#2a2515]', border: 'border-yellow-500/40', rankClass: 'text-yellow-400/80', icon: '', particleColor: undefined },
  5: { bg: 'bg-[#272418]', border: 'border-yellow-500/30', rankClass: 'text-yellow-400/70', icon: '', particleColor: undefined },
  6: { bg: 'bg-[#252415]', border: 'border-yellow-500/25', rankClass: 'text-yellow-400/60', icon: '', particleColor: undefined },
};

const DEFAULT_RANK_STYLE = { bg: 'bg-white/5', border: 'border-white/5', rankClass: 'text-white/40', icon: '', particleColor: undefined };

function getDefaultPlayerName(): string {
  return translate('common:playerFallback');
}

function formatParticipantsLabel(count: number): string {
  const locale = getAppLocale();
  const formattedCount = formatNumber(count);

  if (locale === 'ru') {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) {
      return translate('leaderboard:participant_one', { count: formattedCount });
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return translate('leaderboard:participant_few', { count: formattedCount });
    }
    return translate('leaderboard:participant_many', { count: formattedCount });
  }

  return translate(count === 1 ? 'leaderboard:participant_one' : 'leaderboard:participant_other', {
    count: formattedCount,
  });
}

function formatCompactCountdown(days: number, hours: number, minutes: number): string {
  const formattedDays = formatNumber(days);
  const formattedHours = String(hours).padStart(2, '0');
  const formattedMinutes = String(minutes).padStart(2, '0');
  const dayLabel = translate('common:units.dayCompact');
  const hourLabel = translate('common:units.hourCompact');
  const minuteLabel = translate('common:units.minuteCompact');

  return `${formattedDays}${dayLabel} ${formattedHours}${hourLabel} ${formattedMinutes}${minuteLabel}`;
}

type PrizeTier = {
  label: string;
  badgeClass: string;
  small?: boolean;
};

const PRIZE_BADGE_BASE_CLASS = 'inline-flex items-center justify-center min-w-[56px] px-3 py-1 rounded-full border text-[12px] font-black tracking-tight whitespace-nowrap shrink-0 leading-none';

const PRIZE_TIERS_BY_RANK: Record<number, PrizeTier> = {
  1: { label: 'Precious Peach', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20', small: true },
  2: { label: 'Heroic Helmet',  badgeClass: 'text-gray-200 border-gray-400/40 bg-black/20',   small: true },
  3: { label: 'Astral Shard',   badgeClass: 'text-orange-300 border-orange-500/40 bg-black/20', small: true },
  4: { label: 'Loot Bag',       badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20', small: true },
  5: { label: 'Perfume Bottle', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20', small: true },
  6: { label: 'Ion Gem',        badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20', small: true },
  7: { label: '100 USDt', badgeClass: 'text-green-300 border-green-500/40 bg-black/20' },
  8: { label: '90 USDt', badgeClass: 'text-green-300 border-green-500/40 bg-black/20' },
  9: { label: '80 USDt', badgeClass: 'text-green-300 border-green-500/40 bg-black/20' },
  10: { label: '70 USDt', badgeClass: 'text-green-300 border-green-500/40 bg-black/20' },
  11: { label: '50 USDt', badgeClass: 'text-green-300 border-green-500/40 bg-black/20' },
  12: { label: '50 USDt', badgeClass: 'text-green-300 border-green-500/40 bg-black/20' },
  13: { label: '50 USDt', badgeClass: 'text-green-300 border-green-500/40 bg-black/20' },
  14: { label: '50 USDt', badgeClass: 'text-green-300 border-green-500/40 bg-black/20' },
  15: { label: '50 USDt', badgeClass: 'text-green-300 border-green-500/40 bg-black/20' },
  16: { label: '50 USDt', badgeClass: 'text-green-300 border-green-500/40 bg-black/20' },
  17: { label: '50 USDt', badgeClass: 'text-green-300 border-green-500/40 bg-black/20' },
  18: { label: '50 USDt', badgeClass: 'text-green-300 border-green-500/40 bg-black/20' },
  19: { label: '50 USDt', badgeClass: 'text-green-300 border-green-500/40 bg-black/20' },
  20: { label: '50 USDt', badgeClass: 'text-green-300 border-green-500/40 bg-black/20' },
  21: { label: '2000 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  22: { label: '2000 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  23: { label: '2000 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  24: { label: '2000 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  25: { label: '1500 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  26: { label: '1500 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  27: { label: '1500 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  28: { label: '1500 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  29: { label: '1500 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  30: { label: '1500 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  31: { label: '1000 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  32: { label: '1000 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  33: { label: '1000 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  34: { label: '1000 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  35: { label: '1000 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  36: { label: '1000 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  37: { label: '1000 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  38: { label: '1000 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  39: { label: '1000 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  40: { label: '500 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  41: { label: '500 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  42: { label: '500 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  43: { label: '500 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  44: { label: '500 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  45: { label: '500 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  46: { label: '300 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  47: { label: '300 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  48: { label: '300 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  49: { label: '300 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
  50: { label: '300 ⭐', badgeClass: 'text-yellow-300 border-yellow-500/40 bg-black/20' },
};

type SeasonGiftRow = {
  rank: number;
  medal: string;
  giftName: string;
  prizeValue: string;
  gradientClass: string;
  borderClass: string;
  nameClass: string;
};

const SEASON_GIFT_ROWS: readonly SeasonGiftRow[] = [
  { rank: 1, medal: '🥇', giftName: 'Precious Peach',  prizeValue: '~$500', gradientClass: 'from-yellow-500/25 via-yellow-900/15 to-transparent', borderClass: 'border-yellow-500/40', nameClass: 'text-yellow-300' },
  { rank: 2, medal: '🥈', giftName: 'Heroic Helmet',   prizeValue: '~$270', gradientClass: 'from-slate-400/20 via-slate-700/10 to-transparent',   borderClass: 'border-gray-400/35',    nameClass: 'text-gray-200'   },
  { rank: 3, medal: '🥉', giftName: 'Astral Shard',    prizeValue: '~$230', gradientClass: 'from-orange-500/25 via-orange-900/15 to-transparent', borderClass: 'border-orange-500/35',  nameClass: 'text-orange-300' },
  { rank: 4, medal: '',   giftName: 'Loot Bag',         prizeValue: '~$180', gradientClass: 'from-yellow-500/15 to-transparent',                  borderClass: 'border-yellow-500/20',  nameClass: 'text-yellow-200' },
  { rank: 5, medal: '',   giftName: 'Perfume Bottle',   prizeValue: '~$120', gradientClass: 'from-yellow-500/10 to-transparent',                  borderClass: 'border-yellow-500/15',  nameClass: 'text-yellow-200' },
  { rank: 6, medal: '',   giftName: 'Ion Gem',          prizeValue: '~$105', gradientClass: 'from-yellow-500/10 to-transparent',                  borderClass: 'border-yellow-500/10',  nameClass: 'text-yellow-200' },
];

type SeasonPrizeGroup = {
  rankLabel: string;
  reward: string;
};

const SEASON_USDT_GROUPS: readonly SeasonPrizeGroup[] = [
  { rankLabel: '7',    reward: '100 USDt' },
  { rankLabel: '8',    reward: '90 USDt'  },
  { rankLabel: '9',    reward: '80 USDt'  },
  { rankLabel: '10',   reward: '70 USDt'  },
  { rankLabel: '11–20', reward: '50 USDt' },
];

const SEASON_STARS_GROUPS: readonly SeasonPrizeGroup[] = [
  { rankLabel: '21–24', reward: '2000 ⭐' },
  { rankLabel: '25–30', reward: '1500 ⭐' },
  { rankLabel: '31–39', reward: '1000 ⭐' },
  { rankLabel: '40–45', reward: '500 ⭐'  },
  { rankLabel: '46–50', reward: '300 ⭐'  },
];

const getPrizeTierByRank = (rank: number): PrizeTier | null => {
  return PRIZE_TIERS_BY_RANK[rank] ?? null;
};

const PRIZE_BADGE_SMALL_CLASS = 'inline-flex items-center justify-center px-2 py-1 rounded-full border text-[9px] font-black tracking-tight whitespace-nowrap shrink-0 leading-none';

const PrizeBadge = memo(({ tier }: { tier: PrizeTier }) => (
  <span className={`${tier.small ? PRIZE_BADGE_SMALL_CLASS : PRIZE_BADGE_BASE_CLASS} ${tier.badgeClass}`}>
    <span>{tier.label}</span>
  </span>
));
PrizeBadge.displayName = 'PrizeBadge';

interface ScoreRewardStackProps {
  score: number;
  prizeTier: PrizeTier | null;
  scoreClassName: string;
  wrapperClassName?: string;
  reservePrizeRow?: boolean;
}

const ScoreRewardStack = memo(({
  score,
  prizeTier,
  scoreClassName,
  wrapperClassName,
  reservePrizeRow = true,
}: ScoreRewardStackProps) => (
  <div className={`${wrapperClassName ?? ''} shrink-0 pl-2`}>
    {prizeTier || reservePrizeRow ? (
      <div className="grid w-[110px] grid-rows-[20px_24px] justify-items-end content-center gap-1 leading-none">
        <span className={scoreClassName}>{formatNumber(score)}</span>
        <div className="h-[24px] w-full flex items-center justify-end">
          {prizeTier ? (
            <PrizeBadge tier={prizeTier} />
          ) : (
            <span className="inline-block h-[24px] min-w-[56px] opacity-0 select-none" aria-hidden="true">.</span>
          )}
        </div>
      </div>
    ) : (
      <div className="flex h-[45px] w-[110px] items-center justify-end leading-none">
        <span className={scoreClassName}>{formatNumber(score)}</span>
      </div>
    )}
  </div>
));
ScoreRewardStack.displayName = 'ScoreRewardStack';

// Live mode must define boardType. Coming-soon mode must not trigger leaderboard requests.
const LEADERBOARD_MODES: readonly LeaderboardModeConfig[] = [
  {
    id: 'arcade',
    label: 'Arcade',
    icon: '🕹',
    state: 'live',
    // Current Arcade tab is backed by global progression until Battle gets its own leaderboard.
    boardType: 'global',
  },
  {
    id: 'campaign',
    label: 'Battle',
    icon: '⚔️',
    state: 'coming_soon',
  },
] as const;

const LEADERBOARD_MODE_BY_ID: Record<LeaderboardModeId, LeaderboardModeConfig> = {
  arcade: LEADERBOARD_MODES[0],
  campaign: LEADERBOARD_MODES[1],
};

const normalizeUsername = (rawUsername: unknown): string | null => {
  if (typeof rawUsername !== 'string') return null;
  const normalized = rawUsername.trim().replace(/^@+/, '');
  return normalized.length > 0 ? normalized : null;
};

const normalizeDisplayName = (rawDisplayName: unknown, rawUsername?: unknown, fallback = getDefaultPlayerName()): string => {
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

/** Маппинг API данных → Player для UI */
function mapApiToPlayers(entries: { rank: number; userId: number; username: string | null; firstName: string | null; score: number; photoUrl?: string | null }[]): Player[] {
  return entries.map((entry) => {
    const normalizedUsername = normalizeUsername(entry.username);
    return {
      rank: entry.rank,
      displayName: normalizeDisplayName(entry.firstName, entry.username, getDefaultPlayerName()),
      username: normalizedUsername,
      score: entry.score,
      avatarSeed: entry.userId,
      photoUrl: entry.photoUrl,
      userId: entry.userId,
    };
  });
}

const DEV_LEADERBOARD_MIN_RANK = 50;

function ensureDevLeaderboardHasTopTen(players: Player[]): Player[] {
  if (!import.meta.env.DEV) return players;

  const existingByRank = new Map<number, Player>();
  for (const player of players) {
    if (player.rank >= 1 && player.rank <= DEV_LEADERBOARD_MIN_RANK) {
      existingByRank.set(player.rank, player);
    }
  }

  if (existingByRank.size >= DEV_LEADERBOARD_MIN_RANK) {
    return players;
  }

  const seededTop: Player[] = [];
  const firstKnownScore = players.find((p) => Number.isFinite(p.score))?.score ?? 1000;
  let fallbackScore = Math.max(0, firstKnownScore - 30);

  for (let rank = 1; rank <= DEV_LEADERBOARD_MIN_RANK; rank += 1) {
    const existing = existingByRank.get(rank);
    if (existing) {
      seededTop.push(existing);
      fallbackScore = Math.max(0, existing.score - 30);
      continue;
    }

    seededTop.push({
      rank,
      displayName: `Dev Rank ${rank}`,
      username: `dev_rank_${rank}`,
      score: fallbackScore,
      avatarSeed: 900000 + rank,
      userId: -(900000 + rank),
    });
    fallbackScore = Math.max(0, fallbackScore - 30);
  }

  const tail = players
    .filter((player) => player.rank > DEV_LEADERBOARD_MIN_RANK || player.rank < 1)
    .sort((a, b) => a.rank - b.rank);

  return [...seededTop, ...tail];
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
  await Promise.allSettled(visiblePlayers.map((player) => preloadImage(player.photoUrl || getAvatarUrl(player.avatarSeed))));
  await waitFrame();
  await waitFrame();
}

// --- КОМПОНЕНТ: ИНФО О СЕЗОНЕ (СВАЙП-МОДАЛКА) ---
const SeasonInfoModal = memo(({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
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
            onDragEnd={(_e, info) => {
              if (info.offset.y > 100 || info.velocity.y > 500) {
                onClose();
              }
            }}
            className="fixed bottom-0 left-0 right-0 z-[2001] bg-[#1a1a24] rounded-t-[32px] border-t border-[#ca8a04]/30 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] flex flex-col"
            style={{ maxHeight: '85vh', paddingBottom: 'var(--app-safe-bottom)' }}
          >
            {/* Ползунок для свайпа */}
            <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mt-4 mb-3 shrink-0" />

            {/* Заголовок — фиксированный */}
            <div className="text-center px-6 pb-4 shrink-0">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-yellow-500/10 border border-yellow-500/20 mb-3">
                <Gift className="text-yellow-400 w-7 h-7" />
              </div>
              <h3 className="text-2xl font-black text-white uppercase tracking-wide drop-shadow-md">
                {translate('leaderboard:seasonRewardsTitle')}
              </h3>
            </div>

            {/* Скроллящийся контент */}
            <div className="overflow-y-auto overscroll-contain px-6 pb-6 flex-1 min-h-0">
              <div className="space-y-3">

                {/* ТОП 6 — карточки подарков */}
                <div className="space-y-2">
                  {SEASON_GIFT_ROWS.map((row) => (
                    <div
                      key={row.rank}
                      className={`flex items-center gap-3 bg-gradient-to-r ${row.gradientClass} rounded-2xl border ${row.borderClass} ${row.rank <= 3 ? 'px-3 py-3' : 'px-3 py-2'}`}
                    >
                      <div className="w-8 shrink-0 flex items-center justify-center">
                        {row.medal
                          ? <span className={row.rank <= 3 ? 'text-2xl drop-shadow-md' : 'text-xl'}>{row.medal}</span>
                          : <span className="text-white/40 font-black text-base">{row.rank}</span>
                        }
                      </div>
                      <span className={row.rank <= 3 ? 'text-2xl' : 'text-xl'}>🎁</span>
                      <span className={`font-black flex-1 ${row.rank <= 3 ? 'text-base' : 'text-sm'} ${row.nameClass}`}>
                        {row.giftName}
                      </span>
                      <span className="text-white/40 text-xs font-semibold shrink-0">{row.prizeValue}</span>
                    </div>
                  ))}
                </div>

                {/* Секция USDt */}
                <div className="rounded-2xl border border-green-500/25 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-green-500/10 border-b border-green-500/20">
                    <span className="text-base">💵</span>
                    <span className="text-green-400 font-black text-xs uppercase tracking-widest">USDt</span>
                  </div>
                  {SEASON_USDT_GROUPS.map((group, i) => (
                    <div
                      key={group.rankLabel}
                      className={`flex items-center justify-between px-3 py-2.5 ${i > 0 ? 'border-t border-white/5' : ''}`}
                    >
                      <span className="text-white/55 text-sm font-semibold">#{group.rankLabel}</span>
                      <span className="text-green-300 font-black text-sm">{group.reward}</span>
                    </div>
                  ))}
                </div>

                {/* Секция Stars */}
                <div className="rounded-2xl border border-yellow-500/25 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-yellow-500/10 border-b border-yellow-500/20">
                    <span className="text-base">⭐</span>
                    <span className="text-yellow-400 font-black text-xs uppercase tracking-widest">Stars</span>
                  </div>
                  {SEASON_STARS_GROUPS.map((group, i) => (
                    <div
                      key={group.rankLabel}
                      className={`flex items-center justify-between px-3 py-2.5 ${i > 0 ? 'border-t border-white/5' : ''}`}
                    >
                      <span className="text-white/55 text-sm font-semibold">#{group.rankLabel}</span>
                      <span className="text-yellow-300 font-black text-sm">{group.reward}</span>
                    </div>
                  ))}
                </div>

                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <p className="text-white/90 font-medium text-sm leading-relaxed">
                    {translate('leaderboard:seasonRewardsSummary')}
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
SeasonInfoModal.displayName = 'SeasonInfoModal';


// --- КОМПОНЕНТ: ASYNC AVATAR ---
const AsyncAvatar = memo(({ seed, rank, photoUrl }: { seed: number, rank?: number, photoUrl?: string }) => {
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
  badge?: ReactNode;
}

const PlayerIdentityText = memo(({ displayName, username, nameClassName, usernameClassName, badge }: PlayerIdentityTextProps) => {
  const formattedUsername = formatUsernameForUi(username);
  const showMetaRow = Boolean(formattedUsername) || Boolean(badge);

  return (
    <>
      <div className={nameClassName ?? 'text-white text-[15px] font-bold leading-tight truncate'}>{displayName}</div>
      {showMetaRow && (
        <div className="flex items-center gap-2 mt-0.5">
          {formattedUsername && (
            <div className={usernameClassName ?? 'text-[11px] leading-tight text-white/55 truncate'}>{formattedUsername}</div>
          )}
          {badge}
        </div>
      )}
    </>
  );
});
PlayerIdentityText.displayName = 'PlayerIdentityText';

// --- КОМПОНЕНТ: ЭЛЕМЕНТ ТОП-3 ---
const TopLeaderboardItem = memo(({ player, index, animateEntry }: { player: Player, index: number, animateEntry: boolean }) => {
  const styles = RANK_STYLES[player.rank];
  const prizeTier = getPrizeTierByRank(player.rank);
  const [isAnimationDone, setIsAnimationDone] = useState(!animateEntry);
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

  const handleAnimationComplete = useCallback(() => {
    if (!animateEntry) return; 
    setIsAnimationDone(true);
    // Хаптики удалены
  }, [animateEntry]);

  // Свайп-появление: первый справа, второй слева, третий справа
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
        {styles.icon ? (
          <span className="text-xl drop-shadow-md">{styles.icon}</span>
        ) : (
          <span className={`font-bold text-lg ${styles.rankClass}`}>{player.rank}</span>
        )}
      </div>
      <div className="relative z-20 mr-3">
        <AsyncAvatar seed={player.avatarSeed} rank={player.rank} photoUrl={player.photoUrl || undefined} />
      </div>
      <div className="flex-1 min-w-0 relative z-20 py-1">
        <PlayerIdentityText
          displayName={player.displayName}
          username={player.username}
        />
      </div>
      <ScoreRewardStack
        score={player.score}
        prizeTier={prizeTier}
        wrapperClassName="relative z-20"
        reservePrizeRow={Boolean(prizeTier)}
        scoreClassName="font-mono text-base font-black text-yellow-400 drop-shadow-md text-right tabular-nums"
      />
    </motion.div>
  );
});
TopLeaderboardItem.displayName = 'TopLeaderboardItem';

// --- КОМПОНЕНТ: ОБЫЧНЫЙ ЭЛЕМЕНТ ТОП-4+ ---
const RegularLeaderboardItem = memo(({ player, isCurrentUser }: { player: Player; isCurrentUser?: boolean }) => {
  const styles = DEFAULT_RANK_STYLE;
  const prizeTier = getPrizeTierByRank(player.rank);
  const isMinorPrize = player.rank >= 7 && player.rank <= 20;
  const minorPrizeClass = isMinorPrize && !isCurrentUser
    ? 'bg-yellow-500/6 border-yellow-500/20 shadow-[0_0_10px_rgba(250,204,21,0.08)]'
    : `${styles.bg} ${styles.border}`;
  return (
    <div className={`flex items-center px-3 py-2 rounded-2xl border relative overflow-hidden h-[72px] mb-3 ${isCurrentUser ? 'bg-blue-500/8 border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.15)]' : minorPrizeClass}`}>
      <div className="flex items-center justify-center w-8 mr-2 relative z-10 shrink-0">
        <span className={`font-bold text-lg ${isCurrentUser ? 'text-blue-300' : styles.rankClass}`}>{player.rank}</span>
      </div>
      <div className="relative z-10 mr-3">
        <AsyncAvatar seed={player.avatarSeed} rank={player.rank} photoUrl={player.photoUrl || undefined} />
      </div>
      <div className="flex-1 min-w-0 relative z-10 py-0.5">
        <PlayerIdentityText
          displayName={player.displayName}
          username={player.username}
          usernameClassName="text-[11px] leading-tight text-white/50 truncate"
        />
      </div>
      <ScoreRewardStack
        score={player.score}
        prizeTier={prizeTier}
        wrapperClassName="relative z-10"
        reservePrizeRow={Boolean(prizeTier)}
        scoreClassName="font-mono text-base font-black text-yellow-400/80 text-right tabular-nums"
      />
    </div>
  );
});
RegularLeaderboardItem.displayName = 'RegularLeaderboardItem';

const SkeletonLeaderboardItem = memo(({ rank }: { rank: number }) => {
  const isTop = rank <= 6;
  const topStyles = RANK_STYLES[rank];
  const cardClass = isTop && topStyles
    ? `${topStyles.bg} ${topStyles.border} shadow-lg`
    : `${DEFAULT_RANK_STYLE.bg} ${DEFAULT_RANK_STYLE.border}`;

  return (
    <div className={`flex items-center px-3 py-2 rounded-2xl border relative overflow-hidden mb-3 ${cardClass} h-[72px]`}>
      <div className="flex items-center justify-center w-8 mr-2 relative z-10 shrink-0">
        {isTop && topStyles ? (
          topStyles.icon
            ? <span className="text-xl opacity-35">{topStyles.icon}</span>
            : <div className="h-4 w-5 rounded bg-yellow-500/15 animate-pulse" />
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

const CurrentUserFooter = memo(({ user, isDocked, pulseTrigger, myPosition, myScore }: { user: any, isDocked: boolean, pulseTrigger?: number, myPosition: number | null, myScore: number | null }) => {
  const currentUserRank = useMemo(() => {
    const normalizedUsername = normalizeUsername(user?.username);
    const displayName = normalizeDisplayName(user?.firstName ?? user?.first_name, normalizedUsername, getDefaultPlayerName());

    return {
      rank: myPosition ?? 0,
      displayName,
      username: normalizedUsername,
      score: myScore ?? 0,
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
         <span className="text-white/40 font-bold text-[10px] uppercase mb-1">{translate('leaderboard:place')}</span>
         <span className={`font-black tracking-tighter transition-colors ${isDocked ? 'text-blue-200 text-sm' : 'text-cyan-300 text-sm drop-shadow-md'}`}>
           {currentUserRank.rank > 0 ? `#${formatNumber(currentUserRank.rank)}` : '—'}
         </span>
      </div>

      <div className="relative z-10 mr-3">
        <AsyncAvatar seed={currentUserRank.avatarSeed} photoUrl={currentUserRank.photoUrl} />
      </div>

      <div className="flex-1 min-w-0 relative z-10 py-0.5">
        <PlayerIdentityText displayName={currentUserRank.displayName} username={currentUserRank.username} />
      </div>

      <ScoreRewardStack
        score={currentUserRank.score}
        prizeTier={null}
        wrapperClassName="relative z-10"
        reservePrizeRow={false}
        scoreClassName={`font-mono text-xl font-black drop-shadow-md text-right tabular-nums transition-colors ${isDocked ? 'text-blue-200' : 'text-cyan-300'}`}
      />
    </motion.div>
  );
});
CurrentUserFooter.displayName = 'CurrentUserFooter';

// --- КОМПОНЕНТ: РАЗДЕЛИТЕЛЬ СЕКЦИЙ ---
const SectionDivider = memo(({ type }: { type: 'usdt' | 'stars' }) => {
  const isUsdt = type === 'usdt';
  return (
    <div className={`flex items-center gap-2 py-2 mb-2 mt-1`}>
      <div className={`flex-1 h-[1px] ${isUsdt ? 'bg-green-500/15' : 'bg-yellow-500/15'}`} />
      <span className={`text-[11px] font-black uppercase tracking-widest ${isUsdt ? 'text-green-400/60' : 'text-yellow-400/60'}`}>
        {isUsdt ? '💵 USDt' : '⭐ Stars'}
      </span>
      <div className={`flex-1 h-[1px] ${isUsdt ? 'bg-green-500/15' : 'bg-yellow-500/15'}`} />
    </div>
  );
});
SectionDivider.displayName = 'SectionDivider';

// --- ОСНОВНОЙ ЭКРАН ---
export function LeaderboardScreen() {
  const [activeModeId, setActiveModeId] = useState<LeaderboardModeId>('arcade');
  const [displayModeId, setDisplayModeId] = useState<LeaderboardModeId>('arcade');
  const [isSwitchingTab, setIsSwitchingTab] = useState(false);
  const [listRenderVersion, setListRenderVersion] = useState(0);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [isDocked, setIsDocked] = useState(false);
  const [dockPulseKey, setDockPulseKey] = useState(0);
  const [bottomNavHeight, setBottomNavHeight] = useState(96);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // API data
  const [leaderboard, setLeaderboard] = useState<Player[]>([]);
  const [myPosition, setMyPosition] = useState<number | null>(null);
  const [myScore, setMyScore] = useState<number | null>(null);
  const [myInTop, setMyInTop] = useState(false);
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [seasonEndsAt, setSeasonEndsAt] = useState<string | null>(null);
  
  const { user, screen } = useAppStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentUserRowRef = useRef<HTMLDivElement>(null);
  const visibleCountRef = useRef(INITIAL_VISIBLE_COUNT);
  const switchRequestIdRef = useRef(0);

  const displayMode = LEADERBOARD_MODE_BY_ID[displayModeId];
  const isCurrentModeComingSoon = displayMode.state === 'coming_soon';
  const isCurrentModeLive = displayMode.state === 'live';
  const stickyBottomPx = bottomNavHeight + CARD_GAP_PX;
  const shouldAnimateListEnter = listRenderVersion > 0;

  // Подключаем таймер (по умолчанию будет 1 мая 2026 03:00 МСК, пока бэк не отдаст реальное)
  const { days, hours, minutes, isFinished } = useCountdown(seasonEndsAt);

  const applyLeaderboardMeta = useCallback((data: Awaited<ReturnType<typeof socialApi.getLeaderboard>>) => {
    setMyPosition(data.myPosition);
    setMyScore(data.myScore);
    setMyInTop(data.myInTop);
    setTotalParticipants(data.totalParticipants);
    // Берем с бэкенда или используем фоллбэк дату
    setSeasonEndsAt((data as any).seasonEndsAt || '2026-05-01T00:00:00Z');
  }, []);

  const resetLeaderboardMeta = useCallback(() => {
    setMyPosition(null);
    setMyScore(null);
    setMyInTop(false);
    setTotalParticipants(0);
    setSeasonEndsAt(null);
  }, []);

  // --- API FETCHING ---
  const fetchLeaderboardData = useCallback(async (mode: LeaderboardModeConfig): Promise<Player[]> => {
    if (mode.state !== 'live' || !mode.boardType) {
      resetLeaderboardMeta();
      return [];
    }

    try {
      const data = await socialApi.getLeaderboard(mode.boardType, 100);
      applyLeaderboardMeta(data);
      return ensureDevLeaderboardHasTopTen(mapApiToPlayers(data.leaders));
    } catch (error) {
      console.error('Leaderboard fetch error:', error);
      resetLeaderboardMeta();
      return [];
    }
  }, [applyLeaderboardMeta, resetLeaderboardMeta]);

  // Initial load
  const initialLoadDone = useRef(false);
  useEffect(() => {
    void (async () => {
      const players = await fetchLeaderboardData(LEADERBOARD_MODE_BY_ID.arcade);
      setLeaderboard(players);
      if (players.length > 0) {
        await prepareLeaderboardForDisplay(players);
      }
      setIsLoading(false);
      setListRenderVersion(1);
      initialLoadDone.current = true;
    })();
  }, [fetchLeaderboardData]);

  // Refresh when navigating back to leaderboard screen
  useEffect(() => {
    if (screen !== 'leaderboard') return;
    if (!initialLoadDone.current) return;
    if (displayMode.state !== 'live') return;

    void (async () => {
      const players = await fetchLeaderboardData(displayMode);
      setLeaderboard(players);
    })();
  }, [screen, displayMode, fetchLeaderboardData]);

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
    if (isCurrentModeComingSoon || myInTop) {
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
  }, [visibleCount, leaderboard.length, displayModeId, isCurrentModeComingSoon, myInTop]);

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

  useEffect(() => () => {
    switchRequestIdRef.current += 1;
  }, []);

  const handleTabChange = useCallback((modeId: LeaderboardModeId) => {
    if (modeId === activeModeId && !isSwitchingTab) return;

    const requestId = switchRequestIdRef.current + 1;
    switchRequestIdRef.current = requestId;
    triggerHaptic('selection');
    setActiveModeId(modeId);
    setIsSwitchingTab(true);
    setIsDocked(false);
    setVisibleCount(INITIAL_VISIBLE_COUNT);
    visibleCountRef.current = INITIAL_VISIBLE_COUNT;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    const nextMode = LEADERBOARD_MODE_BY_ID[modeId];

    if (nextMode.state !== 'live' || !nextMode.boardType) {
      resetLeaderboardMeta();
      setDisplayModeId(modeId);
      setLeaderboard([]);
      setListRenderVersion((prev) => prev + 1);
      setIsSwitchingTab(false);
      return;
    }

    const startedAt = performance.now();

    void (async () => {
      try {
        const players = await fetchLeaderboardData(nextMode);
        
        if (players.length > 0) {
          await prepareLeaderboardForDisplay(players);
        }
        
        const elapsed = performance.now() - startedAt;
        if (elapsed < SKELETON_MIN_VISIBLE_MS) {
          await waitMs(SKELETON_MIN_VISIBLE_MS - elapsed);
        }

        if (switchRequestIdRef.current !== requestId) return;

        setLeaderboard(players);
        setDisplayModeId(modeId);
        setListRenderVersion((prev) => prev + 1);
      } finally {
        if (switchRequestIdRef.current === requestId) {
          setIsSwitchingTab(false);
        }
      }
    })();
  }, [activeModeId, isSwitchingTab, fetchLeaderboardData, resetLeaderboardMeta]);

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
    <div className="px-4 h-full flex flex-col pt-6 relative overflow-hidden">
      <AdaptiveParticles
        variant="bg"
        tone="blue"
        baseCount={18}
        baseSpeed={0.09}
        className="z-0 opacity-35"
      />
      
      {/* Tabs */}
      <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-1 mt-2 mb-6 flex relative border border-white/10 shrink-0">
        <motion.div
          className="absolute top-1 bottom-1 bg-white/10 rounded-xl shadow-sm"
          initial={false}
          animate={{
            left: activeModeId === 'arcade' ? '4px' : '50%',
            width: 'calc(50% - 6px)',
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
        {LEADERBOARD_MODES.map((mode) => (
          <button
            key={mode.id}
            onClick={() => handleTabChange(mode.id)}
            className={`flex-1 py-3 text-sm font-bold z-10 transition-colors ${activeModeId === mode.id ? 'text-white' : 'text-white/50'}`}
          >
            <span className="inline mr-1 mb-1" aria-hidden="true">{mode.icon}</span> {mode.label}
          </button>
        ))}
      </div>

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
        
        {/* Кнопка информации (ровно там где ты указал на скрине) */}
        <button 
          onClick={() => { triggerHaptic('light'); setIsInfoModalOpen(true); }}
          aria-label={translate('leaderboard:seasonInfoLabel')}
          className="absolute top-3.5 right-3.5 z-20 w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 border border-white/20 text-white/75 hover:text-white hover:bg-white/15 active:scale-95 transition-all backdrop-blur-sm shadow-[0_4px_14px_rgba(0,0,0,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/50"
        >
          <Info size={21} />
        </button>

        <Trophy size={56} className="mx-auto text-yellow-400 mb-2 drop-shadow-glow relative z-10" />
        <h2 className="text-3xl font-black text-white uppercase tracking-wide drop-shadow-md relative z-10">{translate('leaderboard:seasonTitle')}</h2>
        
        {/* ДИНАМИЧЕСКИЙ ТАЙМЕР */}
        {seasonEndsAt && (
          <div className="inline-flex items-center gap-2 mt-2 bg-black/40 backdrop-blur-md px-4 py-1.5 rounded-full border border-yellow-500/20 relative z-10 shadow-inner">
            {!isFinished ? (
              <>
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]"></div>
                <p className="text-yellow-200/90 text-sm font-mono font-medium tracking-wide">
                  {formatCompactCountdown(days, hours, minutes)}
                </p>
              </>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]"></div>
                <p className="text-red-300/90 text-sm font-mono font-medium tracking-wide">{translate('leaderboard:seasonEnded')}</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* List Container */}
      <div className="flex-1 overflow-hidden relative rounded-t-2xl">
        <div 
          ref={scrollRef} 
          onScroll={isSwitchingTab || isCurrentModeComingSoon || isLoading ? undefined : handleScroll}
          style={{ paddingBottom: stickyBottomPx }}
          className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar px-1"
        >
          {isSwitchingTab || isLoading ? (
            <LeaderboardSkeleton />
          ) : isCurrentModeComingSoon ? (
            <motion.div
              key={`${displayMode.id}-coming-soon`}
              initial={shouldAnimateListEnter ? { opacity: 0, y: 10, filter: 'blur(4px)' } : false}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={shouldAnimateListEnter ? { duration: 0.28, ease: 'easeOut' } : { duration: 0 }}
              className="h-full flex items-center justify-center px-2"
            >
              <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 backdrop-blur-lg p-6 text-center relative overflow-hidden">
                <AdaptiveParticles
                  variant="accent"
                  tone="neutral"
                  baseCount={12}
                  baseSpeed={0.14}
                  className="z-0 opacity-55"
                />
                <span className="text-4xl mb-3 block relative z-10" aria-hidden="true">{displayMode.icon}</span>
                <h3 className="text-white text-xl font-bold mb-2 relative z-10">{displayMode.label}</h3>
                <p className="text-white/60 text-sm relative z-10">{translate('leaderboard:comingSoon')}</p>
              </div>
            </motion.div>
          ) : leaderboard.length === 0 ? (
            <motion.div
              key={`${displayMode.id}-empty-state`}
              initial={shouldAnimateListEnter ? { opacity: 0, y: 10, filter: 'blur(4px)' } : false}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={shouldAnimateListEnter ? { duration: 0.28, ease: 'easeOut' } : { duration: 0 }}
              className="h-full flex items-center justify-center px-2"
            >
              <div className="text-center py-16">
                <div className="text-5xl mb-4">🏆</div>
                <p className="text-white/60 text-base font-medium">{translate('leaderboard:emptyTitle')}</p>
                <p className="text-white/35 text-sm mt-2">{translate('leaderboard:emptySubtitle')}</p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={`${displayMode.id}-${listRenderVersion}`}
              initial={shouldAnimateListEnter ? { opacity: 0, y: 10, filter: 'blur(4px)' } : false}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={shouldAnimateListEnter ? { duration: 0.28, ease: 'easeOut' } : { duration: 0 }}
            >
              {leaderboard.slice(0, visibleCount).flatMap((player, i) => {
                const isMe = player.userId === user?.id;
                const elements: React.ReactNode[] = [];

                if (player.rank === 7) {
                  elements.push(<SectionDivider key={`section-usdt-${displayMode.id}`} type="usdt" />);
                } else if (player.rank === 21) {
                  elements.push(<SectionDivider key={`section-stars-${displayMode.id}`} type="stars" />);
                }

                if (player.rank <= 6) {
                  elements.push(
                    <div key={`top-${displayMode.id}-${player.rank}`} className={isMe ? 'rounded-2xl ring-2 ring-blue-500/40 shadow-[0_0_12px_rgba(59,130,246,0.15)]' : ''}>
                      <TopLeaderboardItem player={player} index={i} animateEntry={true} />
                    </div>
                  );
                } else {
                  elements.push(<RegularLeaderboardItem key={`reg-${displayMode.id}-${player.rank}`} player={player} isCurrentUser={isMe} />);
                }

                return elements;
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
                      {totalParticipants > leaderboard.length
                        ? translate('leaderboard:topOfTotal', {
                            top: formatNumber(leaderboard.length),
                            total: formatNumber(totalParticipants),
                          })
                        : formatParticipantsLabel(leaderboard.length)
                      }
                    </p>
                  </div>

                  {/* Docked current user footer (only when NOT in top) */}
                  {!myInTop && (
                    <div
                      ref={currentUserRowRef}
                      className={isDocked ? 'visible' : 'invisible pointer-events-none'}
                      aria-hidden={!isDocked}
                    >
                      <CurrentUserFooter user={user} isDocked pulseTrigger={dockPulseKey} myPosition={myPosition} myScore={myScore} />
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}
        </div>

        {!isSwitchingTab && !isLoading && isCurrentModeLive && !isDocked && !myInTop && leaderboard.length > 0 && (
          <div className="absolute left-1 right-1 z-50 pointer-events-none" style={{ bottom: stickyBottomPx }}>
            <CurrentUserFooter user={user} isDocked={false} myPosition={myPosition} myScore={myScore} />
          </div>
        )}
      </div>
      
      {/* Модалка с информацией */}
      <SeasonInfoModal isOpen={isInfoModalOpen} onClose={() => setIsInfoModalOpen(false)} />
    </div>
  );
}
