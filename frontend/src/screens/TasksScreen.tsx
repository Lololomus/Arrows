import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckCircle2,
  ClipboardList,
  Coins,
  Heart,
  Lock,
  Play,
  Puzzle,
  RefreshCcw,
  Send,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';

import { adsApi, authApi, handleApiError, tasksApi } from '../api/client';
import FragmentsTab from './FragmentsTab';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';
import type { TaskDto } from '../game/types';
import { ADS_ENABLED, ADS_FIRST_ELIGIBLE_LEVEL, ADSGRAM_BLOCK_IDS } from '../config/constants';
import { formatNumber, formatTimeUntil, translate } from '../i18n';
import { isValidRewardedBlockId, isValidTaskBlockId } from '../services/adsgram';
import { clearPendingRewardIntent, rememberPendingRewardIntent } from '../services/rewardReconciler';
import { getRewardedFlowMessage, runRewardedFlow } from '../services/rewardedAds';
import { useAppStore } from '../stores/store';
import { useRewardStore } from '../stores/rewardStore';

type TaskScreenTab = 'tasks' | 'fragments';
type TaskUiConfig = { icon: typeof Send; iconColor: string; iconBg: string };
type FlyingCoin = {
  id: string; startX: number; startY: number;
  midX: number; midY: number; endX: number; endY: number;
  rotation: number; delay: number;
};
type TaskDevState = {
  arcadeLevels: number;
  dailyLevels: number;
  friendsConfirmed: number;
  officialChannel: boolean;
  partnerChannel: boolean;
  partnerZarub: boolean;
  partnerVpnRu: boolean;
};

const STAGGER = 0.07;
const DEV_TASKS_ENABLED = import.meta.env.DEV || (
  import.meta.env.MODE !== 'production'
  && ['1', 'true', 'yes', 'on'].includes(String(import.meta.env.VITE_ENABLE_DEV_AUTH || '').toLowerCase())
);

const TASK_UI: Record<TaskDto['id'], TaskUiConfig> = {
  official_channel: { icon: Send,   iconColor: 'text-green-400',  iconBg: 'bg-green-500/20'  },
  partner_channel:  { icon: Send,   iconColor: 'text-cyan-400',   iconBg: 'bg-cyan-500/20'   },
  partner_zarub:    { icon: Send,   iconColor: 'text-orange-400', iconBg: 'bg-orange-500/20' },
  partner_vpn_ru:   { icon: Send,   iconColor: 'text-violet-400', iconBg: 'bg-violet-500/20' },
  daily_levels:     { icon: Trophy, iconColor: 'text-amber-400',  iconBg: 'bg-amber-500/20'  },
  arcade_levels:    { icon: Trophy, iconColor: 'text-blue-400',   iconBg: 'bg-blue-500/20'   },
  friends_confirmed:{ icon: Users,  iconColor: 'text-purple-400', iconBg: 'bg-purple-500/20' },
};

const isDailyTask = (task: TaskDto) => task.id.startsWith('daily_');
const isPartnerTask = (task: TaskDto) => task.id.startsWith('partner_');
const OPENED_TASKS_STORAGE_KEY = 'arrows_opened_tasks';

type TelegramWebAppLinkApi = {
  version?: string;
  openLink?: (url: string) => void;
  openTelegramLink?: (url: string) => void;
};

function getOpenedTasksStorageKeys(userId: number | null | undefined): string[] {
  const scopedKey = userId != null ? `${OPENED_TASKS_STORAGE_KEY}:${userId}` : OPENED_TASKS_STORAGE_KEY;
  return scopedKey === OPENED_TASKS_STORAGE_KEY ? [scopedKey] : [scopedKey, OPENED_TASKS_STORAGE_KEY];
}

function getBrowserStorage(name: 'localStorage' | 'sessionStorage'): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window[name] ?? null;
  } catch {
    return null;
  }
}

function parseOpenedTaskIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function readOpenedTaskIds(userId: number | null | undefined): Set<string> {
  const ids = new Set<string>();
  const keys = getOpenedTasksStorageKeys(userId);
  for (const storageName of ['localStorage', 'sessionStorage'] as const) {
    const storage = getBrowserStorage(storageName);
    if (!storage) continue;
    for (const key of keys) {
      let raw: string | null = null;
      try {
        raw = storage.getItem(key);
      } catch {
        continue;
      }
      for (const id of parseOpenedTaskIds(raw)) ids.add(id);
    }
  }
  return ids;
}

function persistOpenedTaskIds(userId: number | null | undefined, ids: Set<string>): void {
  const [scopedKey, legacyKey] = getOpenedTasksStorageKeys(userId);
  const encoded = JSON.stringify([...ids]);
  for (const storageName of ['localStorage', 'sessionStorage'] as const) {
    const storage = getBrowserStorage(storageName);
    if (!storage) continue;
    try {
      storage.setItem(scopedKey, encoded);
      if (legacyKey) storage.removeItem(legacyKey);
    } catch {
      // Storage can be blocked in some mobile WebViews.
    }
  }
}

function clearOpenedTaskIds(userId: number | null | undefined): void {
  const keys = getOpenedTasksStorageKeys(userId);
  for (const storageName of ['localStorage', 'sessionStorage'] as const) {
    const storage = getBrowserStorage(storageName);
    if (!storage) continue;
    for (const key of keys) {
      try {
        storage.removeItem(key);
      } catch {
        // Storage can be blocked in some mobile WebViews.
      }
    }
  }
}

function formatTaskRewardLabel(rewardCoins: number, rewardHints = 0, rewardRevives = 0): string {
  const parts: string[] = [];
  if (rewardCoins > 0) parts.push(`+${rewardCoins}`);
  if (rewardHints > 0) parts.push(`+💡${rewardHints}`);
  if (rewardRevives > 0) parts.push(`+❤️${rewardRevives}`);
  return parts.join(' ') || '+0';
}

// ─── Section divider ─────────────────────────────────────────────────────────

function SectionDivider({
  label, icon, lineClass = 'via-white/12', delay = 0,
}: {
  label: string; icon?: React.ReactNode; lineClass?: string; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22, delay, ease: 'easeOut' }}
      className="flex items-center gap-3 py-2"
    >
      <div className={`h-px flex-1 bg-gradient-to-r from-transparent ${lineClass}`} />
      <div className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">{label}</span>
      </div>
      <div className={`h-px flex-1 bg-gradient-to-l from-transparent ${lineClass}`} />
    </motion.div>
  );
}

// ─── Green "done" badge ───────────────────────────────────────────────────────

function DoneBadge({ label = translate('common:done'), size = 'md' }: { label?: string; size?: 'sm' | 'md' }) {
  const cls = size === 'sm'
    ? 'px-2.5 py-1.5 text-[10px] gap-1'
    : 'px-3 py-2 text-[10px] gap-1';
  return (
    <div className={`shrink-0 flex items-center rounded-xl border border-green-500/25 bg-green-500/10 font-bold text-green-400 ${cls}`}>
      <CheckCircle2 size={11} />
      {label}
    </div>
  );
}

// ─── Ad task helper ───────────────────────────────────────────────────────────

function formatResetTime(resetsAt: string, now: number): string {
  return formatTimeUntil(resetsAt, now) ?? translate('common:later');
}

// ─── DailyAdTaskCard ──────────────────────────────────────────────────────────

interface DailyAdTaskCardProps {
  currentLevel: number;
  animDelay?: number;
  onReward: (amount: number, el: HTMLElement) => void;
  onEligible?: (v: boolean) => void;
  devPreview?: boolean;
}

function DailyAdTaskCard({ currentLevel, animDelay = 0, onReward, onEligible, devPreview = false }: DailyAdTaskCardProps) {
  const { updateUser, setUser } = useAppStore();
  const trackedIntent  = useRewardStore((s) => s.activeIntents.reward_daily_coins ?? null);
  const resolvedIntent = useRewardStore((s) => s.lastResolved.reward_daily_coins ?? null);
  const clearResolved  = useRewardStore((s) => s.clearResolved);

  const [eligible,     setEligible]     = useState(false);
  const [used,         setUsed]         = useState(0);
  const [limit,        setLimit]        = useState(5);
  const [resetsAt,     setResetsAt]     = useState('');
  const [loading,      setLoading]      = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [now,          setNow]          = useState(() => Date.now());
  const [pendingId,    setPendingId]    = useState<string | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [infoMsg,      setInfoMsg]      = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await adsApi.getStatus();
      setEligible(s.eligible);
      setUsed(s.dailyCoins.used);
      setLimit(s.dailyCoins.limit);
      setResetsAt(s.dailyCoins.resetsAt);
      setStatusLoaded(true);
    } catch { setStatusLoaded(false); }
  }, []);

  const syncCoins = useCallback(async () => {
    try { setUser(await authApi.getMe()); } catch { void 0; }
  }, [setUser]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void loadStatus(); };
    const onFocus = () => void loadStatus();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onFocus); };
  }, [loadStatus]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Сообщаем родителю об eligible статусе
  useEffect(() => {
    if (devPreview) { onEligible?.(true); return; }
    if (statusLoaded && eligible && currentLevel >= ADS_FIRST_ELIGIBLE_LEVEL) {
      onEligible?.(true);
    }
  }, [devPreview, statusLoaded, eligible, currentLevel, onEligible]);

  useEffect(() => {
    if (!trackedIntent) return;
    if (pendingId !== trackedIntent.intentId) setPendingId(trackedIntent.intentId);
    setError(null); setInfoMsg(translate('tasks:dailyCoins.checking'));
  }, [pendingId, trackedIntent]);

  useEffect(() => {
    if (!resolvedIntent) return;
    const apply = async () => {
      if (resolvedIntent.status === 'granted') {
        setPendingId(null); setInfoMsg(null); setError(null);
        setUsed(resolvedIntent.usedToday ?? used);
        setLimit(resolvedIntent.limitToday ?? limit);
        if (resolvedIntent.resetsAt) setResetsAt(resolvedIntent.resetsAt);
        if (resolvedIntent.coins != null) updateUser({ coins: resolvedIntent.coins });
        else await syncCoins();
        await loadStatus();
      } else if (resolvedIntent.status === 'rejected' || resolvedIntent.status === 'expired') {
        setPendingId(null); setInfoMsg(null);
        setError(getRewardedFlowMessage('reward_daily_coins', { outcome: 'rejected', failureCode: resolvedIntent.failureCode }));
        await loadStatus();
      }
      clearResolved('reward_daily_coins', resolvedIntent.intentId);
    };
    void apply();
  }, [clearResolved, limit, loadStatus, resolvedIntent, syncCoins, updateUser, used]);

  const handleWatch = useCallback(async (triggerEl: HTMLElement) => {
    if (loading || pendingId || used >= limit) return;
    setLoading(true); setError(null); setInfoMsg(null);
    try {
      const result = await runRewardedFlow(
        ADSGRAM_BLOCK_IDS.rewardDailyCoins,
        { placement: 'reward_daily_coins' },
        { optimistic: true },
      );

      // Ad completed — apply reward immediately, confirm in background.
      // No setPendingId: button stays unlocked so user can watch the next slot right away.
      if (result.outcome === 'completed') {
        const currentCoins = useAppStore.getState().user?.coins ?? 0;
        updateUser({ coins: currentCoins + 20 });
        setUsed(used + 1);
        onReward(20, triggerEl);
        // Reconciler will retry clientComplete until server confirms.
        rememberPendingRewardIntent({ intentId: result.intentId!, placement: 'reward_daily_coins', adCompleted: true });
        return;
      }

      if (result.outcome === 'timeout' || (result.outcome === 'provider_error' && result.intentId)) {
        setPendingId(result.intentId!);
        rememberPendingRewardIntent({ intentId: result.intentId!, placement: 'reward_daily_coins' });
        setInfoMsg(getRewardedFlowMessage('reward_daily_coins', result));
        return;
      }
      if (result.outcome === 'unavailable' || result.outcome === 'not_completed') {
        setPendingId(null); setError(getRewardedFlowMessage('reward_daily_coins', result)); return;
      }
      if (result.outcome === 'error') {
        if (result.intentId) {
          setPendingId(result.intentId);
          rememberPendingRewardIntent({ intentId: result.intentId, placement: 'reward_daily_coins' });
          setInfoMsg(translate('tasks:dailyCoins.checking'));
        } else { setError(getRewardedFlowMessage('reward_daily_coins', result)); }
        return;
      }
      if (result.outcome === 'rejected') {
        setPendingId(null);
        clearPendingRewardIntent('reward_daily_coins', result.intentId ?? undefined);
        setError(getRewardedFlowMessage('reward_daily_coins', result));
        await loadStatus(); return;
      }

      // 'granted' — non-optimistic fallback, shouldn't reach with optimistic: true.
      setPendingId(null);
      clearPendingRewardIntent('reward_daily_coins', result.intentId ?? undefined);
      setUsed(result.status?.usedToday ?? used + 1);
      setLimit(result.status?.limitToday ?? limit);
      if (result.status?.resetsAt) setResetsAt(result.status.resetsAt);
      if (result.status?.coins != null) updateUser({ coins: result.status.coins });
      else await syncCoins();
      onReward(20, triggerEl);
    } catch { setError(translate('errors:generic.network')); }
    finally { setLoading(false); }
  }, [limit, loadStatus, loading, onReward, pendingId, syncCoins, updateUser, used]);

  if (!devPreview && (!ADS_ENABLED || !isValidRewardedBlockId(ADSGRAM_BLOCK_IDS.rewardDailyCoins))) return null;
  if (!devPreview && (!statusLoaded || !eligible || currentLevel < ADS_FIRST_ELIGIBLE_LEVEL)) return null;

  const displayUsed  = devPreview && !statusLoaded ? 0 : used;
  const displayLimit = devPreview && !statusLoaded ? 5 : limit;
  const remaining    = Math.max(0, displayLimit - displayUsed);
  const limitReached = displayUsed >= displayLimit;
  const waiting      = pendingId !== null;
  const isDisabled   = loading || waiting || limitReached;
  const resetHint = displayUsed > 0 && resetsAt
    ? ` | ${translate('tasks:dailyCoins.resetOnly', { time: formatResetTime(resetsAt, now) }).replace(/^.*? /, '')}`
    : '';

  const subtitle = limitReached
    ? translate('tasks:dailyCoins.resetOnly', { time: formatResetTime(resetsAt, now) })
    : waiting ? (infoMsg ?? translate('tasks:dailyCoins.checking'))
    : (error ?? translate('tasks:dailyCoins.available', {
      remaining: formatNumber(remaining),
      limit: formatNumber(displayLimit),
      reset: resetHint,
    }));

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: animDelay, ease: [0.25, 0.1, 0.25, 1] as const }}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400">
          <Play size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[14px] font-bold text-white">{translate('tasks:dailyCoins.title')}</h3>
            {limitReached
              ? <DoneBadge label={translate('common:done')} />
              : (
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  disabled={isDisabled}
                  onClick={(e) => void handleWatch(e.currentTarget as HTMLElement)}
                  className="shrink-0 flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-white shadow-[0_4px_15px_rgba(245,158,11,0.3)] disabled:opacity-70"
                >
                  <Play size={13} />
                  {loading ? '...' : waiting ? translate('common:checking') : translate('common:watch')}
                </motion.button>
              )
            }
          </div>
          <p className={`text-[11px] leading-tight line-clamp-1 ${waiting ? 'text-amber-300' : 'text-white/50'}`}>
            {subtitle}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// ─── AdsGramTaskCard ─────────────────────────────────────────────────────────

function AdsGramTaskCard({ animDelay = 0 }: { animDelay?: number }) {
  const { setUser } = useAppStore();

  const [statusLoaded, setStatusLoaded] = useState(false);
  const [taskUsed,     setTaskUsed]     = useState(false);
  const [resetsAt,     setResetsAt]     = useState('');
  const [elementReady, setElementReady] = useState(false);
  const [notFound,     setNotFound]     = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [tooLongSession, setTooLongSession] = useState(false);
  const [now,          setNow]          = useState(() => Date.now());

  const taskRef    = useRef<HTMLElement | null>(null);
  const grantingRef = useRef(false);

  const loadStatus = useCallback(async () => {
    try {
      const s = await adsApi.getStatus();
      setTaskUsed(s.taskRevive.used >= s.taskRevive.limit);
      setResetsAt(s.taskRevive.resetsAt);
      setStatusLoaded(true);
    } catch { setStatusLoaded(false); }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void loadStatus(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [loadStatus]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Wait for the <adsgram-task> custom element to be registered.
  useEffect(() => {
    if (typeof customElements === 'undefined') return;
    if (customElements.get('adsgram-task') !== undefined) {
      setElementReady(true);
      return;
    }
    customElements.whenDefined('adsgram-task')
      .then(() => setElementReady(true))
      .catch(() => { /* element never registered — card stays hidden */ });
  }, []);

  // Attach DOM event listeners to the web component.
  // Depends on elementReady + statusLoaded + taskUsed so the effect re-runs
  // whenever the element appears or disappears from the DOM.
  useEffect(() => {
    const el = taskRef.current;
    if (!el || !elementReady || !statusLoaded || taskUsed) return;

    const onReward = async () => {
      if (grantingRef.current) return;
      grantingRef.current = true;
      setError(null);
      let intentId: string | null = null;
      try {
        const intent = await adsApi.createRewardIntent({ placement: 'reward_task' });
        intentId = intent.intentId;
        const status = await adsApi.clientCompleteRewardIntent(intent.intentId);
        if (status.status === 'granted') {
          setTaskUsed(true);
          if (status.resetsAt) setResetsAt(status.resetsAt);
          try { setUser(await authApi.getMe()); } catch { void 0; }
        } else {
          setError(translate('tasks:adsgramTask.error'));
        }
      } catch {
        if (intentId) {
          // Intent created but complete failed — reconciler retries in background.
          rememberPendingRewardIntent({ intentId, placement: 'reward_task', adCompleted: true });
        } else {
          setError(translate('tasks:adsgramTask.error'));
        }
      } finally {
        grantingRef.current = false;
      }
    };

    const onBannerNotFound  = () => setNotFound(true);
    const onError           = () => setError(translate('tasks:adsgramTask.error'));
    const onTooLongSession  = () => setTooLongSession(true);

    el.addEventListener('reward',            onReward);
    el.addEventListener('onBannerNotFound',  onBannerNotFound);
    el.addEventListener('onError',           onError);
    el.addEventListener('onTooLongSession',  onTooLongSession);

    return () => {
      el.removeEventListener('reward',            onReward);
      el.removeEventListener('onBannerNotFound',  onBannerNotFound);
      el.removeEventListener('onError',           onError);
      el.removeEventListener('onTooLongSession',  onTooLongSession);
    };
  }, [elementReady, statusLoaded, taskUsed, setUser]);

  const isDev = import.meta.env.DEV;

  if (notFound || (!statusLoaded && !isDev)) return null;

  const blockId = ADSGRAM_BLOCK_IDS.task || (isDev ? 'task-0' : '');
  const resetHint = resetsAt ? formatResetTime(resetsAt, now) : translate('common:later');

  // ── Done state ──────────────────────────────────────────────────────────────
  const rewardLabel = formatTaskRewardLabel(0, 0, 1);
  const iconEl = (
    <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-500/20 text-red-400">
      <Heart size={22} />
    </div>
  );

  if (taskUsed) {
    return (
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25, delay: animDelay, ease: [0.25, 0.1, 0.25, 1] as const }}
        className="relative overflow-hidden rounded-2xl border border-white/5 bg-white/5 p-4 opacity-70"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-green-500/10 text-green-400">
            <CheckCircle2 size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-[14px] font-bold text-white/60">
                {translate('tasks:adsgramTask.title')}
              </h3>
              <DoneBadge label={translate('common:done')} />
            </div>
            <p className="text-[11px] leading-tight text-white/35">
              {translate('tasks:adsgramTask.resetOnly', { time: resetHint })}
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  // ── Active state — render web component ─────────────────────────────────────
  if (!elementReady && !isDev) return null;

  const slotBtnStyle: React.CSSProperties = {
    display: 'flex',
    width: '100%',
    boxSizing: 'border-box',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    minWidth: 0,
    whiteSpace: 'nowrap',
    borderRadius: '12px',
    padding: '8px 16px',
    fontSize: '12px',
    fontWeight: 700,
    color: '#ffffff',
    background: 'linear-gradient(to right, #ef4444, #ec4899)',
    boxShadow: '0 4px 15px rgba(239,68,68,0.3)',
    border: 'none',
    cursor: 'pointer',
  };
  const taskHostStyle = {
    display: 'block',
    width: '100%',
    marginTop: '10px',
    minHeight: '40px',
    overflow: 'hidden',
    color: 'rgba(255,255,255,0.85)',
    fontSize: '12px',
    '--adsgram-task-button-width': '112px',
  } as React.CSSProperties;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: animDelay, ease: [0.25, 0.1, 0.25, 1] as const }}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4"
    >
      {/* Top row: icon + title + reward */}
      <div className="flex items-start gap-3">
        {iconEl}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[14px] font-bold text-white">
              {translate('tasks:adsgramTask.title')}
            </h3>
            <div className="shrink-0 flex flex-col items-end">
              <span className="text-[15px] font-bold leading-none text-amber-400">{rewardLabel}</span>
              <span className="text-[9px] font-bold uppercase tracking-widest text-amber-400/60">
                {translate('tasks:rewardCaption.reward')}
              </span>
            </div>
          </div>
          <p className="text-[11px] leading-tight text-white/50">
            {tooLongSession
              ? translate('tasks:adsgramTask.tooLongSession')
              : (error ?? translate('tasks:adsgramTask.description'))}
          </p>
        </div>
      </div>

      {/* Bottom row: let AdsGram layout itself and size the button column via CSS vars */}
      <adsgram-task
        ref={taskRef}
        data-block-id={blockId}
        {...(isDev ? { 'data-debug': 'true' } : {})}
        data-debug-console="false"
        style={taskHostStyle}
      >
          <div slot="button" style={slotBtnStyle}>{translate('tasks:adsgramTask.buttonSlot')}</div>
          <div slot="claim"  style={slotBtnStyle}>{translate('tasks:adsgramTask.claimSlot')}</div>
          <span slot="reward" style={{ display: 'none' }} />
          <div slot="done" style={{ ...slotBtnStyle, background: 'transparent', border: '1px solid rgba(74,222,128,0.25)', color: 'rgba(74,222,128,1)', boxShadow: 'none', fontSize: '10px', gap: '4px', padding: '6px 10px' }}>
            <CheckCircle2 size={11} />{translate('common:done')}
          </div>
      </adsgram-task>
    </motion.div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TASKS_PLACEHOLDER_ENABLED = false;
const DEFAULT_TASK_DEV_STATE: TaskDevState = {
  arcadeLevels: 0,
  dailyLevels: 0,
  friendsConfirmed: 0,
  officialChannel: false,
  partnerChannel: false,
  partnerZarub: false,
  partnerVpnRu: false,
};

function DevPresetButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/70 transition hover:bg-white/10 hover:text-white"
    >
      {label}
    </button>
  );
}

function TaskDevPanel({
  value,
  loading,
  error,
  onChange,
  onApply,
  onReset,
}: {
  value: TaskDevState;
  loading: boolean;
  error: string | null;
  onChange: (patch: Partial<TaskDevState>) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/10 p-4 shadow-[0_10px_24px_rgba(0,0,0,0.22)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-fuchsia-200/80">Dev Only</div>
          <div className="mt-1 text-sm font-bold text-white">Накрутка заданий</div>
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/80 transition hover:bg-white/10 disabled:opacity-60"
        >
          <RefreshCcw size={12} />
          Reset
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3">
        <div className="rounded-xl border border-white/8 bg-black/15 p-3">
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs font-bold text-white">Arcade уровни</label>
            <input
              type="number"
              min="0"
              value={value.arcadeLevels}
              onChange={(e) => onChange({ arcadeLevels: Math.max(0, Number(e.target.value) || 0) })}
              className="w-24 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-right text-sm font-bold text-white outline-none"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {[0, 5, 10, 25, 50, 75, 100].map((preset) => (
              <DevPresetButton key={`arcade-${preset}`} label={String(preset)} onClick={() => onChange({ arcadeLevels: preset })} />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-black/15 p-3">
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs font-bold text-white">Daily уровни</label>
            <input
              type="number"
              min="0"
              value={value.dailyLevels}
              onChange={(e) => onChange({ dailyLevels: Math.max(0, Number(e.target.value) || 0) })}
              className="w-24 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-right text-sm font-bold text-white outline-none"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {[0, 10].map((preset) => (
              <DevPresetButton key={`daily-${preset}`} label={String(preset)} onClick={() => onChange({ dailyLevels: preset })} />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-black/15 p-3">
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs font-bold text-white">Подтвержденные друзья</label>
            <input
              type="number"
              min="0"
              value={value.friendsConfirmed}
              onChange={(e) => onChange({ friendsConfirmed: Math.max(0, Number(e.target.value) || 0) })}
              className="w-24 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-right text-sm font-bold text-white outline-none"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {[0, 3, 6, 9, 12].map((preset) => (
              <DevPresetButton key={`friends-${preset}`} label={String(preset)} onClick={() => onChange({ friendsConfirmed: preset })} />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-black/15 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-white">Official channel</div>
              <div className="mt-1 text-[11px] text-white/55">Делает задачу claimable без открытия канала</div>
            </div>
            <button
              type="button"
              onClick={() => onChange({ officialChannel: !value.officialChannel })}
              className={`rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] transition ${
                value.officialChannel
                  ? 'bg-green-500/20 text-green-300'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
              }`}
            >
              {value.officialChannel ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-black/15 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-white">Partner channel</div>
              <div className="mt-1 text-[11px] text-white/55">Makes the partner task claimable without opening the channel</div>
            </div>
            <button
              type="button"
              onClick={() => onChange({ partnerChannel: !value.partnerChannel })}
              className={`rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] transition ${
                value.partnerChannel
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
              }`}
            >
              {value.partnerChannel ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-black/15 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-white">ZARUB link</div>
              <div className="mt-1 text-[11px] text-white/55">Makes the link task claimable without opening the link</div>
            </div>
            <button
              type="button"
              onClick={() => onChange({ partnerZarub: !value.partnerZarub })}
              className={`rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] transition ${
                value.partnerZarub
                  ? 'bg-orange-500/20 text-orange-300'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
              }`}
            >
              {value.partnerZarub ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-black/15 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-white">BlackTemple VPN</div>
              <div className="mt-1 text-[11px] text-white/55">Makes the link task claimable without opening the link</div>
            </div>
            <button
              type="button"
              onClick={() => onChange({ partnerVpnRu: !value.partnerVpnRu })}
              className={`rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] transition ${
                value.partnerVpnRu
                  ? 'bg-violet-500/20 text-violet-300'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
              }`}
            >
              {value.partnerVpnRu ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="min-h-[16px] text-[11px] text-red-300/85">{error ?? ''}</p>
        <button
          type="button"
          onClick={onApply}
          disabled={loading}
          className="shrink-0 rounded-xl bg-gradient-to-r from-fuchsia-500 to-pink-500 px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.16em] text-white shadow-[0_8px_18px_rgba(217,70,239,0.28)] transition hover:brightness-110 disabled:opacity-60"
        >
          {loading ? 'Applying...' : 'Apply'}
        </button>
      </div>
    </div>
  );
}

const triggerHaptic = (style: 'light' | 'medium' | 'heavy' | 'selection' | 'success') => {
  const tg = (window as Window & { Telegram?: any }).Telegram?.WebApp;
  if (!tg?.HapticFeedback) return;
  if (style === 'selection') tg.HapticFeedback.selectionChanged();
  else if (style === 'success') tg.HapticFeedback.notificationOccurred('success');
  else tg.HapticFeedback.impactOccurred(style);
};

function BottomCoinStash({ balance, isPulsing }: { balance: number; isPulsing: boolean }) {
  return (
    <motion.div
      animate={isPulsing ? { scale: [1, 1.02, 1], y: [0, 4, 0] } : { scale: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="relative flex h-[80px] w-full items-center overflow-hidden rounded-3xl border border-yellow-300/30 bg-[#14162a]/95 shadow-[0_16px_40px_rgba(0,0,0,0.8)] backdrop-blur-xl pointer-events-auto"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 via-yellow-300/10 to-amber-500/10" />
      <motion.div
        animate={isPulsing ? { opacity: [0, 0.15, 0] } : { opacity: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="absolute inset-0 rounded-3xl bg-white pointer-events-none"
      />
      <div className="relative flex w-full items-center justify-between px-5">
        <div className="flex items-center gap-4">
          <motion.div
            animate={isPulsing ? { rotate: [0, -15, 10, 0], scale: [1, 1.1, 1] } : { rotate: 0, scale: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-yellow-200/40 bg-gradient-to-br from-yellow-300/20 to-amber-500/10 text-yellow-300 shadow-[0_0_20px_rgba(250,204,21,0.3)]"
          >
            <Coins size={24} strokeWidth={2.5} className="drop-shadow-lg" />
          </motion.div>
          <div className="leading-tight">
            <p className="mb-0.5 text-[12px] font-bold uppercase tracking-[0.25em] text-yellow-200/60">{translate('common:coinStash')}</p>
            <motion.p
              key={balance}
              initial={{ scale: 1.3, color: '#ffffff' }}
              animate={{ scale: 1, color: '#fef08a' }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="origin-left text-3xl font-black tracking-tight text-yellow-300 drop-shadow-[0_0_12px_rgba(250,204,21,0.4)] tabular-nums"
            >
              {formatNumber(balance)}
            </motion.p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function TaskScreenLoader() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-2 border-white/20 border-t-white animate-spin" />
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function TasksScreen() {
  const { user, updateUser } = useAppStore();
  const currentLevel = (user as (typeof user & { current_level?: number }) | null)?.currentLevel
    ?? (user as (typeof user & { current_level?: number }) | null)?.current_level
    ?? 1;

  const containerRef       = useRef<HTMLDivElement>(null);
  const coinTargetAnchorRef = useRef<HTMLDivElement>(null);
  const stashHideTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedTasksUserId = user?.id ?? null;

  const [activeTab,          setActiveTab]          = useState<TaskScreenTab>('tasks');
  const [tasks,              setTasks]              = useState<TaskDto[]>([]);
  const [loading,            setLoading]            = useState(true);
  const [screenError,        setScreenError]        = useState<string | null>(null);
  const [taskErrors,         setTaskErrors]         = useState<Record<string, string>>({});
  const [loadingTaskIds,     setLoadingTaskIds]     = useState<Set<string>>(new Set());
  const [openedChannelIds,   setOpenedChannelIds]   = useState<Set<string>>(() => readOpenedTaskIds(openedTasksUserId));
  const [flyingCoins,        setFlyingCoins]        = useState<FlyingCoin[]>([]);
  const [isStashVisible,     setIsStashVisible]     = useState(false);
  const [isStashPulsing,     setIsStashPulsing]     = useState(false);
  const [adEligible,         setAdEligible]         = useState(false);
  const [isTaskDevOpen,      setIsTaskDevOpen]      = useState(false);
  const [taskDevState,       setTaskDevState]       = useState<TaskDevState>(DEFAULT_TASK_DEV_STATE);
  const [taskDevLoading,     setTaskDevLoading]     = useState(false);
  const [taskDevError,       setTaskDevError]       = useState<string | null>(null);
  const [taskDevLoaded,      setTaskDevLoaded]      = useState(false);

  const userCoins = user?.coins ?? 0;

  const fetchTasks = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const data = await tasksApi.getTasks();
      setTasks(data.tasks);
      setScreenError(null);
    } catch (err) { setScreenError(handleApiError(err)); }
    finally { if (showLoader) setLoading(false); }
  }, []);

  useEffect(() => { void fetchTasks(true); }, [fetchTasks]);
  useEffect(() => () => { if (stashHideTimerRef.current) clearTimeout(stashHideTimerRef.current); }, []);
  useEffect(() => {
    setOpenedChannelIds(readOpenedTaskIds(openedTasksUserId));
  }, [openedTasksUserId]);

  useEffect(() => {
    if (!DEV_TASKS_ENABLED || !isTaskDevOpen || taskDevLoaded) return;
    let cancelled = false;
    const loadDevState = async () => {
      setTaskDevLoading(true);
      setTaskDevError(null);
      try {
        const state = await tasksApi.getDevState();
        if (cancelled) return;
        setTaskDevState({
          arcadeLevels: state.arcadeLevels ?? 0,
          dailyLevels: state.dailyLevels ?? 0,
          friendsConfirmed: state.friendsConfirmed ?? 0,
          officialChannel: state.officialChannel ?? false,
          partnerChannel: state.partnerChannel ?? false,
          partnerZarub: state.partnerZarub ?? false,
          partnerVpnRu: state.partnerVpnRu ?? false,
        });
        setTaskDevLoaded(true);
      } catch {
        if (!cancelled) {
          setTaskDevError('Не удалось загрузить dev state');
        }
      } finally {
        if (!cancelled) {
          setTaskDevLoading(false);
        }
      }
    };
    void loadDevState();
    return () => {
      cancelled = true;
    };
  }, [isTaskDevOpen, taskDevLoaded]);

  const showStashWithTimer = useCallback(() => {
    setIsStashVisible(true);
    if (stashHideTimerRef.current) clearTimeout(stashHideTimerRef.current);
    stashHideTimerRef.current = setTimeout(() => setIsStashVisible(false), 3500);
  }, []);

  const triggerStashPulse = useCallback(() => {
    setIsStashPulsing(true);
    setTimeout(() => setIsStashPulsing(false), 300);
  }, []);

  const runRewardAnimation = useCallback((rewardAmount: number, triggerElement: HTMLElement) => {
    const cRect = containerRef.current?.getBoundingClientRect();
    const bRect = triggerElement.getBoundingClientRect();
    if (!cRect) return;

    const sx = bRect.left - cRect.left + bRect.width / 2;
    const sy = bRect.top  - cRect.top  + bRect.height / 2;
    const tRect = coinTargetAnchorRef.current?.getBoundingClientRect();
    const tx = tRect ? tRect.left - cRect.left : cRect.width / 2;
    const ty = tRect ? tRect.top  - cRect.top  : cRect.height - 130;

    const count = Math.min(10, Math.max(5, Math.floor(rewardAmount / 15)));
    const coins = Array.from({ length: count }).map((_, i) => ({
      id: `${Date.now()}-${i}`,
      startX: sx, startY: sy,
      midX: sx + (Math.random() - 0.5) * 80,
      midY: sy - (Math.random() * 50 + 20),
      endX: tx + (Math.random() - 0.5) * 20,
      endY: ty + (Math.random() - 0.5) * 10,
      rotation: Math.random() > 0.5 ? 360 : -360,
      delay: i * 0.05,
    }));

    showStashWithTimer();
    setFlyingCoins((p) => [...p, ...coins]);
    coins.forEach((c) => setTimeout(() => { triggerHaptic('light'); triggerStashPulse(); }, 800 + c.delay * 1000));
    setTimeout(() => { triggerHaptic('success'); showStashWithTimer(); }, 850);
    setTimeout(() => setFlyingCoins((p) => p.filter((c) => !coins.some((x) => x.id === c.id))), 1800);
  }, [showStashWithTimer, triggerStashPulse]);

  const setTaskLoading = useCallback((id: string, v: boolean) => {
    setLoadingTaskIds((p) => { const n = new Set(p); v ? n.add(id) : n.delete(id); return n; });
  }, []);

  const clearTaskError = useCallback((id: string) => {
    setTaskErrors((p) => { if (!(id in p)) return p; const n = { ...p }; delete n[id]; return n; });
  }, []);

  const rememberOpenedTask = useCallback((id: string) => {
    setOpenedChannelIds((p) => {
      const next = new Set(p).add(id);
      persistOpenedTaskIds(openedTasksUserId, next);
      return next;
    });
  }, [openedTasksUserId]);

  const handleOpenChannel = useCallback((task: TaskDto) => {
    const url = task.linkUrl ?? task.channel?.url ?? (task.channel?.username ? `https://t.me/${task.channel.username}` : null);
    if (!url) { setTaskErrors((p) => ({ ...p, [task.id]: translate('tasks:channelNotConfigured') })); return; }
    triggerHaptic('light');
    clearTaskError(task.id);
    rememberOpenedTask(task.id);
    const tg = (window as Window & { Telegram?: { WebApp?: TelegramWebAppLinkApi } }).Telegram?.WebApp;
    const isTelegramUrl = /^https?:\/\/t\.me\//i.test(url) || /^tg:\/\//i.test(url);
    const canOpenInBrowser = /^https?:\/\//i.test(url);
    try {
      if (isTelegramUrl) {
        if (tg?.openTelegramLink) {
          tg.openTelegramLink(url);
          return;
        }
      }
      if (tg?.openLink && canOpenInBrowser) {
        tg.openLink(url);
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      window.location.href = url;
    }
  }, [clearTaskError, rememberOpenedTask]);

  const handleClaim = useCallback(async (task: TaskDto, el: HTMLElement) => {
    const tier = task.nextTierIndex != null ? task.tiers[task.nextTierIndex] : null;
    if (!tier) return;
    setTaskLoading(task.id, true);
    clearTaskError(task.id);
    triggerHaptic('heavy');
    try {
      const result = await tasksApi.claimTask(tier.claimId);
      updateUser({
        coins: result.coins,
        ...(result.hintBalance != null ? { hintBalance: result.hintBalance } : {}),
        ...(result.reviveBalance != null ? { reviveBalance: result.reviveBalance } : {}),
      });
      if (result.rewardCoins > 0) runRewardAnimation(result.rewardCoins, el);
      await fetchTasks(false);
    } catch (err) { setTaskErrors((p) => ({ ...p, [task.id]: handleApiError(err) })); }
    finally { setTaskLoading(task.id, false); }
  }, [clearTaskError, fetchTasks, runRewardAnimation, setTaskLoading, updateUser]);

  const handleTaskAction = useCallback(async (task: TaskDto, event?: MouseEvent<HTMLElement>) => {
    const el = event?.currentTarget as HTMLElement | undefined;
    if (task.kind === 'single' || task.kind === 'link') {
      if (task.status === 'completed') return;
      if (task.status === 'claimable' && el) {
        await handleClaim(task, el);
        return;
      }
      if (!openedChannelIds.has(task.id)) { handleOpenChannel(task); return; }
      if (el) await handleClaim(task, el);
      return;
    }
    if (task.status !== 'claimable' || !el) return;
    await handleClaim(task, el);
  }, [handleClaim, handleOpenChannel, openedChannelIds]);

  // ─── Task card ───────────────────────────────────────────────────────────────

  const TASK_UI_FALLBACK: TaskUiConfig = { icon: Send, iconColor: 'text-white/60', iconBg: 'bg-white/10' };

  const renderTaskCard = (task: TaskDto, delay = 0) => {
    const ui       = TASK_UI[task.id] ?? TASK_UI_FALLBACK;
    const nextTier = task.nextTierIndex != null ? task.tiers[task.nextTierIndex] : null;
    const lastTier = task.tiers.length > 0 ? task.tiers[task.tiers.length - 1] : null;
    const target   = nextTier?.target ?? 1;
    const rewardCoins = nextTier?.rewardCoins ?? lastTier?.rewardCoins ?? 0;
    const rewardHints = nextTier?.rewardHints ?? lastTier?.rewardHints ?? 0;
    const rewardRevives = nextTier?.rewardRevives ?? lastTier?.rewardRevives ?? 0;
    const rewardLabel = formatTaskRewardLabel(rewardCoins, rewardHints, rewardRevives);
    const rewardCaption = rewardHints > 0 || rewardRevives > 0
      ? translate('tasks:rewardCaption.reward')
      : translate('tasks:rewardCaption.coins');
    const progress = task.kind === 'stepped' ? task.progress : task.status === 'completed' ? 1 : 0;
    const pct      = Math.min(100, (progress / target) * 100);
    const isLoadingTask = loadingTaskIds.has(task.id);
    const isCompleted   = task.status === 'completed';
    const hasAction     = !isCompleted && (task.kind === 'single' || task.kind === 'link' || task.status === 'claimable');
    const displayTitle  = nextTier?.title ?? task.baseTitle;
    const taskError     = taskErrors[task.id];

    let actionLabel = '';
    if (task.kind === 'single') {
      actionLabel = isLoadingTask ? '...' : task.status === 'claimable' ? rewardLabel : openedChannelIds.has(task.id) ? translate('tasks:action.check') : translate('tasks:action.subscribe');
    } else if (task.kind === 'link') {
      actionLabel = isLoadingTask
        ? '...'
        : (task.status === 'claimable' || openedChannelIds.has(task.id))
          ? `${translate('tasks:action.claim')} ${rewardLabel}`
          : translate('tasks:action.go');
    } else if (task.status === 'claimable') {
      actionLabel = isLoadingTask ? '...' : rewardLabel;
    }

    return (
      <motion.div
        key={task.id}
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25, delay, ease: [0.25, 0.1, 0.25, 1] as const }}
        className={`relative overflow-hidden rounded-2xl border p-4 ${
          isCompleted ? 'border-white/5 bg-white/5 opacity-70' : 'border-white/10 bg-white/5'
        }`}
      >
        <div className="flex items-start gap-3">
          {/* Иконка */}
          <div className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
            isCompleted ? 'bg-green-500/10 text-green-400' : `${ui.iconBg} ${ui.iconColor}`
          }`}>
            {isCompleted ? <CheckCircle2 size={22} /> : <ui.icon size={22} />}
          </div>

          {/* Контент */}
          <div className="min-w-0 flex-1">
            {/* Заголовок + награда/кнопка */}
            <div className="mb-1 flex items-start gap-2">
              <h3 className={`min-w-0 flex-1 text-[14px] font-bold leading-tight ${
                isCompleted ? 'text-white/60' : 'text-white'
              } ${task.kind === 'link' ? 'line-clamp-2' : 'truncate'}`}>
                {displayTitle}
              </h3>

              {isCompleted ? (
                <DoneBadge label={translate('common:done')} size="sm" />
              ) : hasAction ? (
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  disabled={isLoadingTask}
                  onClick={(e) => void handleTaskAction(task, e)}
                  className={`shrink-0 flex items-center gap-1 rounded-xl px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-white disabled:opacity-70 ${
                    (task.kind === 'single' || task.kind === 'link') && task.status !== 'claimable' && !openedChannelIds.has(task.id)
                      ? 'bg-white/10 active:bg-white/20'
                      : 'bg-gradient-to-r from-amber-500 to-orange-500 shadow-[0_4px_15px_rgba(245,158,11,0.3)]'
                  }`}
                >
                  <Send size={13} />
                  {actionLabel}
                </motion.button>
              ) : (
                <div className="shrink-0 flex flex-col items-end">
                  <span className="text-[15px] font-bold leading-none text-amber-400">{rewardLabel}</span>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-amber-400/60">{rewardCaption}</span>
                </div>
              )}
            </div>

            {/* Описание */}
            {isCompleted ? (
              <p className="text-[11px] leading-tight text-white/35">{translate('tasks:taskCompleted')}</p>
            ) : (
              <>
                <p className={`text-[11px] leading-tight text-white/50 ${task.kind === 'link' ? 'line-clamp-2' : 'line-clamp-1'}`}>
                  {taskError ?? task.baseDescription}
                </p>
                {task.kind === 'stepped' && (
                  <div className="mt-2">
                    <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-white/40">
                      <span>{Math.min(progress, target)}/{target}</span>
                    </div>
                    <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/10">
                      <motion.div
                        className={`absolute inset-y-0 left-0 rounded-full ${
                          task.status === 'claimable' ? 'bg-amber-400' : 'bg-yellow-400'
                        }`}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  // ─── Build the task list: daily → active → completed ────────────────────────

  const renderTaskList = () => {
    const dailyTasks    = tasks.filter(isDailyTask);
    const partnerTasks = tasks.filter(isPartnerTask);
    const otherTasks = tasks.filter((t) => !isDailyTask(t) && !isPartnerTask(t));
    const active    = otherTasks.filter((t) => t.status !== 'completed');
    const dailyActive    = dailyTasks.filter((t) => t.status !== 'completed');
    const dailyCompleted = dailyTasks.filter((t) => t.status === 'completed');
    const partnerActive = partnerTasks.filter((t) => t.status !== 'completed');
    const partnerCompleted = partnerTasks.filter((t) => t.status === 'completed');
    const completed = [...dailyCompleted, ...partnerCompleted, ...otherTasks.filter((t) => t.status === 'completed')];
    const DEV_ADS_PREVIEW  = import.meta.env.DEV;
    const showAds          = DEV_ADS_PREVIEW || (ADS_ENABLED && isValidRewardedBlockId(ADSGRAM_BLOCK_IDS.rewardDailyCoins));
    const showAdsGramTask  = DEV_ADS_PREVIEW || (ADS_ENABLED && isValidTaskBlockId(ADSGRAM_BLOCK_IDS.task));

    const nodes: React.ReactNode[] = [];
    let i = 0;

    // 1. Daily section
    const hasDailySection = dailyActive.length > 0 || adEligible || showAdsGramTask;

    // 2. Divider → ежедневные
    if (hasDailySection) {
      nodes.push(
        <SectionDivider key="d-daily" label={translate('tasks:sections.daily')}
          icon={<Coins size={10} className="text-amber-400" />}
          lineClass="via-amber-400/20" delay={i++ * STAGGER}
        />
      );
    }

    // 3. Ежедневные задания
    for (const task of dailyActive) {
      nodes.push(renderTaskCard(task, i++ * STAGGER));
    }

    // 4. Ежедневная реклама
    if (showAds) {
      nodes.push(
        <DailyAdTaskCard key="daily-ad"
          currentLevel={currentLevel}
          onReward={runRewardAnimation}
          onEligible={setAdEligible}
          animDelay={adEligible ? i * STAGGER : 0}
          devPreview={DEV_ADS_PREVIEW}
        />
      );
      if (adEligible) i++;
    }

    // 4b. AdsGram task (8h revive cooldown, visible from level 1)
    if (showAdsGramTask) {
      nodes.push(
        <AdsGramTaskCard key="adsgram-task" animDelay={i++ * STAGGER} />
      );
    }

    // 5. Divider → активные (если что-то есть выше)
    if (partnerActive.length > 0) {
      nodes.push(
        <SectionDivider key="d-partner" label={translate('tasks:sections.partner')}
          icon={<Send size={10} className="text-cyan-400" />}
          lineClass="via-cyan-400/20" delay={i++ * STAGGER}
        />
      );
      for (const task of partnerActive) nodes.push(renderTaskCard(task, i++ * STAGGER));
    }

    const anythingAbove = hasDailySection || partnerActive.length > 0;
    if (anythingAbove && active.length > 0) {
      nodes.push(
        <SectionDivider key="d-active" label={translate('tasks:sections.tasks')}
          icon={<Sparkles size={10} className="text-blue-400" />}
          lineClass="via-blue-400/20" delay={i++ * STAGGER}
        />
      );
    }

    // 6. Активные задания
    for (const task of active) nodes.push(renderTaskCard(task, i++ * STAGGER));

    if (completed.length > 0) {
      nodes.push(
        <SectionDivider key="d-completed" label={translate('tasks:sections.completed')}
          icon={<CheckCircle2 size={10} className="text-green-400" />}
          lineClass="via-green-400/20" delay={i++ * STAGGER}
        />
      );
      for (const task of completed) nodes.push(renderTaskCard(task, i++ * STAGGER));
    }

    return nodes;
  };

  const applyTaskDevState = useCallback(async () => {
    if (!DEV_TASKS_ENABLED) return;
    setTaskDevLoading(true);
    setTaskDevError(null);
    try {
      const next = await tasksApi.setDevState(taskDevState);
      setTaskDevState({
        arcadeLevels: next.arcadeLevels ?? 0,
        dailyLevels: next.dailyLevels ?? 0,
        friendsConfirmed: next.friendsConfirmed ?? 0,
        officialChannel: next.officialChannel ?? false,
        partnerChannel: next.partnerChannel ?? false,
        partnerZarub: next.partnerZarub ?? false,
        partnerVpnRu: next.partnerVpnRu ?? false,
      });
      setTaskDevLoaded(true);
      setOpenedChannelIds(new Set());
      clearOpenedTaskIds(openedTasksUserId);
      await fetchTasks(false);
    } catch (err) {
      setTaskDevError(handleApiError(err));
    } finally {
      setTaskDevLoading(false);
    }
  }, [fetchTasks, openedTasksUserId, taskDevState]);

  const resetTaskDevState = useCallback(async () => {
    if (!DEV_TASKS_ENABLED) return;
    setTaskDevLoading(true);
    setTaskDevError(null);
    try {
      await tasksApi.resetDevState();
      setTaskDevState(DEFAULT_TASK_DEV_STATE);
      setTaskDevLoaded(true);
      setOpenedChannelIds(new Set());
      clearOpenedTaskIds(openedTasksUserId);
      await fetchTasks(false);
    } catch (err) {
      setTaskDevError(handleApiError(err));
    } finally {
      setTaskDevLoading(false);
    }
  }, [fetchTasks, openedTasksUserId]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="relative flex h-full flex-col overflow-hidden px-4 pb-nav pt-6">
      <AdaptiveParticles variant="bg" tone="neutral" baseCount={16} baseSpeed={0.09} className="z-0 opacity-30" />

      {/* Летящие монеты */}
      <div className="pointer-events-none absolute inset-0 z-[150] overflow-hidden">
        <AnimatePresence>
          {flyingCoins.map((coin) => (
            <motion.div
              key={coin.id}
              initial={{ x: coin.startX, y: coin.startY, scale: 0, opacity: 0 }}
              animate={{
                x: [coin.startX, coin.midX, coin.endX],
                y: [coin.startY, coin.midY, coin.endY],
                scale: [0, 1.2, 0.5], opacity: [0, 1, 1, 0],
                rotate: [0, coin.rotation, coin.rotation * 1.5],
              }}
              transition={{ duration: 0.8, delay: coin.delay, times: [0, 0.45, 1], ease: ['easeOut', 'easeIn'] }}
              className="absolute -ml-3 -mt-3 text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.8)]"
            >
              <Coins size={28} fill="#f59e0b" className="text-amber-200" />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Переключатель вкладок */}
      <div className="relative mt-2 mb-6 flex shrink-0 rounded-2xl border border-white/10 bg-white/5 p-1 backdrop-blur-lg">
        <motion.div
          className="absolute top-1 bottom-1 rounded-xl bg-white/10 shadow-sm"
          initial={false}
          animate={{ left: activeTab === 'tasks' ? '4px' : '50%', width: 'calc(50% - 6px)' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
        <button onClick={() => setActiveTab('tasks')}
          className={`z-10 flex-1 py-3 text-sm font-bold transition-colors ${activeTab === 'tasks' ? 'text-white' : 'text-white/50'}`}>
          <ClipboardList size={16} className="mr-1 mb-1 inline" /> {translate('tasks:tabs.tasks')}
        </button>
        <button onClick={() => setActiveTab('fragments')}
          className={`z-10 flex-1 py-3 text-sm font-bold transition-colors ${activeTab === 'fragments' ? 'text-white' : 'text-white/50'}`}>
          <Puzzle size={16} className="mr-1 mb-1 inline" /> {translate('tasks:tabs.fragments')}
        </button>
      </div>

      {/* Контент — AnimatePresence с быстрым exit, чтобы карточки анимировались при каждом входе */}
      <div className="relative flex-1 overflow-y-auto custom-scrollbar pb-32">
        <AnimatePresence mode="wait">
          {activeTab === 'tasks' && (
            <motion.div
              key="tasks-panel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.12 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              className="space-y-3 pb-2"
            >
              {DEV_TASKS_ENABLED && (
                <>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setTaskDevError(null);
                        setIsTaskDevOpen((prev) => !prev);
                      }}
                      className="rounded-xl border border-fuchsia-400/20 bg-fuchsia-500/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-fuchsia-100/85 transition hover:bg-fuchsia-500/15"
                    >
                      {isTaskDevOpen ? 'Скрыть Dev' : 'Dev: Накрутка'}
                    </button>
                  </div>

                  <AnimatePresence initial={false}>
                    {isTaskDevOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0, y: -6 }}
                        animate={{ opacity: 1, height: 'auto', y: 0 }}
                        exit={{ opacity: 0, height: 0, y: -6 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="overflow-hidden"
                      >
                        <TaskDevPanel
                          value={taskDevState}
                          loading={taskDevLoading}
                          error={taskDevError}
                          onChange={(patch) => {
                            setTaskDevError(null);
                            setTaskDevState((prev) => ({ ...prev, ...patch }));
                          }}
                          onApply={() => void applyTaskDevState()}
                          onReset={() => void resetTaskDevState()}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}

              {screenError ? (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                  <div className="font-bold">{translate('tasks:loadFailedTitle')}</div>
                  <div className="mt-1 text-red-200/80">{screenError}</div>
                  <button onClick={() => void fetchTasks(true)}
                    className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white">
                    {translate('common:retry')}
                  </button>
                </div>
              ) : loading ? (
                <TaskScreenLoader />
              ) : (
                renderTaskList()
              )}
            </motion.div>
          )}

          {activeTab === 'fragments' && (
            <motion.div
              key="fragments-panel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.15 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              className="w-full"
            >
              <FragmentsTab />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Якорь монет */}
      <div className="pointer-events-none absolute bottom-[130px] left-4 right-4 z-0 flex h-[80px] items-center">
        <div ref={coinTargetAnchorRef} className="absolute left-[44px]" />
      </div>

      {/* Стэш монет */}
      <div className="pointer-events-none absolute bottom-[130px] left-4 right-4 z-[120] flex justify-center">
        <AnimatePresence>
          {isStashVisible && (
            <motion.div
              initial={{ y: 100, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 100, opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              className="relative w-full pointer-events-auto"
            >
              <BottomCoinStash balance={userCoins} isPulsing={isStashPulsing} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {TASKS_PLACEHOLDER_ENABLED && (
        <div className="absolute inset-0 z-[220] flex items-center justify-center bg-[#080b16]/72 px-6 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-3xl border border-white/12 bg-[#14192b]/92 p-6 text-center shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/25 bg-amber-500/10 text-amber-300">
              <Lock size={28} />
            </div>
            <h2 className="mt-4 text-xl font-black text-white">{translate('common:comingSoon')}</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              {translate('tasks:placeholderDescription')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
