import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckCircle2,
  ClipboardList,
  Coins,
  Lock,
  Puzzle,
  Send,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';

import { handleApiError, tasksApi } from '../api/client';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';
import type { TaskDto } from '../game/types';
import { useAppStore } from '../stores/store';

type TaskScreenTab = 'tasks' | 'fragments';
type TaskUiConfig = {
  icon: typeof Send;
  iconColor: string;
  iconBg: string;
};
type FlyingCoin = {
  id: string;
  startX: number;
  startY: number;
  midX: number;
  midY: number;
  endX: number;
  endY: number;
  rotation: number;
  delay: number;
};

const TASK_UI: Record<TaskDto['id'], TaskUiConfig> = {
  official_channel: {
    icon: Send,
    iconColor: 'text-green-400',
    iconBg: 'bg-green-500/20',
  },
  arcade_levels: {
    icon: Trophy,
    iconColor: 'text-blue-400',
    iconBg: 'bg-blue-500/20',
  },
  friends_confirmed: {
    icon: Users,
    iconColor: 'text-purple-400',
    iconBg: 'bg-purple-500/20',
  },
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, x: -30 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.35, ease: 'easeOut' },
  },
};

const TASKS_PLACEHOLDER_ENABLED = false;

const triggerHaptic = (style: 'light' | 'medium' | 'heavy' | 'selection' | 'success') => {
  const tg = (window as Window & { Telegram?: any }).Telegram?.WebApp;
  if (!tg?.HapticFeedback) return;

  if (style === 'selection') {
    tg.HapticFeedback.selectionChanged();
  } else if (style === 'success') {
    tg.HapticFeedback.notificationOccurred('success');
  } else {
    tg.HapticFeedback.impactOccurred(style);
  }
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
            <p className="mb-0.5 text-[12px] font-bold uppercase tracking-[0.25em] text-yellow-200/60">Баланс</p>
            <motion.p
              key={balance}
              initial={{ scale: 1.3, color: '#ffffff' }}
              animate={{ scale: 1, color: '#fef08a' }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="origin-left text-3xl font-black tracking-tight text-yellow-300 drop-shadow-[0_0_12px_rgba(250,204,21,0.4)] tabular-nums"
            >
              {balance.toLocaleString()}
            </motion.p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className="rounded-full border border-yellow-300/40 bg-yellow-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-yellow-100/90 shadow-inner">
            Wallet
          </span>
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

export function TasksScreen() {
  const { user, updateUser } = useAppStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const coinTargetAnchorRef = useRef<HTMLDivElement>(null);
  const stashHideTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [activeTab, setActiveTab] = useState<TaskScreenTab>('tasks');
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});
  const [loadingTaskIds, setLoadingTaskIds] = useState<Set<string>>(new Set());
  const [openedChannelTaskIds, setOpenedChannelTaskIds] = useState<Set<string>>(new Set());
  const [flyingCoins, setFlyingCoins] = useState<FlyingCoin[]>([]);
  const [isStashVisible, setIsStashVisible] = useState(false);
  const [isStashPulsing, setIsStashPulsing] = useState(false);

  const userCoins = user?.coins ?? 0;

  const fetchTasks = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);

    try {
      const data = await tasksApi.getTasks();
      setTasks(data.tasks);
      setScreenError(null);
    } catch (error) {
      setScreenError(handleApiError(error));
    } finally {
      if (showLoader) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks(true);
  }, [fetchTasks]);

  useEffect(() => () => {
    if (stashHideTimerRef.current) clearTimeout(stashHideTimerRef.current);
  }, []);

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
    const containerRect = containerRef.current?.getBoundingClientRect();
    const buttonRect = triggerElement.getBoundingClientRect();
    if (!containerRect) return;

    const startX = buttonRect.left - containerRect.left + buttonRect.width / 2;
    const startY = buttonRect.top - containerRect.top + buttonRect.height / 2;

    const targetRect = coinTargetAnchorRef.current?.getBoundingClientRect();
    const targetCenterX = targetRect ? targetRect.left - containerRect.left : containerRect.width / 2;
    const targetCenterY = targetRect ? targetRect.top - containerRect.top : containerRect.height - 130;

    const coinsToSpawn = Math.min(10, Math.max(5, Math.floor(rewardAmount / 15)));
    const spawnedCoins = Array.from({ length: coinsToSpawn }).map((_, index) => ({
      id: `${Date.now()}-${index}`,
      startX,
      startY,
      midX: startX + (Math.random() - 0.5) * 80,
      midY: startY - (Math.random() * 50 + 20),
      endX: targetCenterX + (Math.random() - 0.5) * 20,
      endY: targetCenterY + (Math.random() - 0.5) * 10,
      rotation: Math.random() > 0.5 ? 360 : -360,
      delay: index * 0.05,
    }));

    showStashWithTimer();
    setFlyingCoins((prev) => [...prev, ...spawnedCoins]);

    spawnedCoins.forEach((coin) => {
      const hitTime = 800 + coin.delay * 1000;
      setTimeout(() => {
        triggerHaptic('light');
        triggerStashPulse();
      }, hitTime);
    });

    setTimeout(() => {
      triggerHaptic('success');
      showStashWithTimer();
    }, 850);

    setTimeout(() => {
      setFlyingCoins((prev) => prev.filter((coin) => !spawnedCoins.some((item) => item.id === coin.id)));
    }, 1800);
  }, [showStashWithTimer, triggerStashPulse]);

  const setTaskLoading = useCallback((taskId: string, isLoading: boolean) => {
    setLoadingTaskIds((prev) => {
      const next = new Set(prev);
      if (isLoading) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  }, []);

  const clearTaskError = useCallback((taskId: string) => {
    setTaskErrors((prev) => {
      if (!(taskId in prev)) return prev;
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  }, []);

  const handleOpenChannel = useCallback((task: TaskDto) => {
    const url = task.channel?.url ?? (task.channel?.username ? `https://t.me/${task.channel.username}` : null);
    if (!url) {
      setTaskErrors((prev) => ({ ...prev, [task.id]: 'Канал пока не настроен на сервере' }));
      return;
    }

    triggerHaptic('light');
    clearTaskError(task.id);

    const tg = (window as Window & { Telegram?: any }).Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }

    setOpenedChannelTaskIds((prev) => new Set(prev).add(task.id));
  }, [clearTaskError]);

  const handleClaim = useCallback(async (task: TaskDto, triggerElement: HTMLElement) => {
    const tierIndex = task.nextTierIndex;
    const tier = tierIndex != null ? task.tiers[tierIndex] : null;
    if (!tier) return;

    setTaskLoading(task.id, true);
    clearTaskError(task.id);
    triggerHaptic('heavy');

    try {
      const result = await tasksApi.claimTask(tier.claimId);
      updateUser({ coins: result.coins });
      runRewardAnimation(result.rewardCoins, triggerElement);
      await fetchTasks(false);
    } catch (error) {
      setTaskErrors((prev) => ({ ...prev, [task.id]: handleApiError(error) }));
    } finally {
      setTaskLoading(task.id, false);
    }
  }, [clearTaskError, fetchTasks, runRewardAnimation, setTaskLoading, updateUser]);

  const handleTaskAction = useCallback(async (task: TaskDto, event?: MouseEvent<HTMLElement>) => {
    const triggerElement = event?.currentTarget as HTMLElement | undefined;

    if (task.kind === 'single') {
      if (task.status === 'completed') return;
      if (!openedChannelTaskIds.has(task.id)) {
        handleOpenChannel(task);
        return;
      }
      if (triggerElement) {
        await handleClaim(task, triggerElement);
      }
      return;
    }

    if (task.status !== 'claimable' || !triggerElement) return;
    await handleClaim(task, triggerElement);
  }, [handleClaim, handleOpenChannel, openedChannelTaskIds]);

  const renderTaskCard = (task: TaskDto) => {
    const ui = TASK_UI[task.id];
    const nextTier = task.nextTierIndex != null ? task.tiers[task.nextTierIndex] : null;
    const lastTier = task.tiers.length > 0 ? task.tiers[task.tiers.length - 1] : null;
    const target = nextTier?.target ?? 1;
    const reward = nextTier?.rewardCoins ?? lastTier?.rewardCoins ?? 0;
    const progress = task.kind === 'stepped' ? task.progress : task.status === 'completed' ? 1 : 0;
    const progressPercent = Math.min(100, (progress / target) * 100);
    const isLoadingTask = loadingTaskIds.has(task.id);
    const isCompleted = task.status === 'completed';
    const displayTitle = nextTier?.title ?? task.baseTitle;
    const taskError = taskErrors[task.id];

    let actionLabel = '';
    if (task.kind === 'single') {
      actionLabel = isLoadingTask ? 'Проверяем...' : openedChannelTaskIds.has(task.id) ? 'Проверить' : 'Подписаться';
    } else if (task.status === 'claimable') {
      actionLabel = isLoadingTask ? 'Загрузка...' : `ЗАБРАТЬ ${reward}`;
    }

    return (
      <motion.div
        key={task.id}
        variants={itemVariants}
        className={`
          relative overflow-hidden rounded-2xl border p-4
          ${isCompleted ? 'border-white/5 bg-white/5 opacity-60' : 'border-white/10 bg-white/5'}
        `}
      >
        <div className="relative z-10 flex items-center gap-4">
          <div
            className={`
              flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl
              ${isCompleted ? 'bg-white/10 text-white/50' : `${ui.iconBg} ${ui.iconColor}`}
            `}
          >
            {isCompleted ? <CheckCircle2 size={24} /> : <ui.icon size={24} />}
          </div>

          <div className="min-w-0 flex-1">
            <h3 className={`mb-0.5 truncate text-[15px] font-bold ${isCompleted ? 'text-white/60' : 'text-white'}`}>
              {displayTitle}
            </h3>

            {isCompleted ? (
              <p className="truncate text-[11px] text-white/40">Задание выполнено</p>
            ) : (
              <>
                <p className="pr-2 text-[11px] leading-tight text-white/50 line-clamp-2">
                  {taskError ?? task.baseDescription}
                </p>
                {task.kind === 'stepped' ? (
                  <div className="mt-2">
                    <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-white/45">
                      <span>{Math.min(progress, target)}/{target}</span>
                      <span>+{reward}</span>
                    </div>
                    <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/10">
                      <motion.div
                        className={`absolute inset-y-0 left-0 rounded-full ${task.status === 'claimable' ? 'bg-amber-400' : 'bg-yellow-400'}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${progressPercent}%` }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                      />
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end justify-center pl-1">
            {isCompleted ? (
              <div className="rounded-xl bg-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white/50">
                ВЫПОЛНЕНО
              </div>
            ) : task.kind === 'single' || task.status === 'claimable' ? (
              <motion.button
                whileTap={{ scale: 0.92 }}
                disabled={isLoadingTask}
                onClick={(event) => void handleTaskAction(task, event)}
                className={`
                  flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white
                  ${task.kind === 'single'
                    ? 'bg-white/10 active:bg-white/20'
                    : 'bg-gradient-to-r from-amber-500 to-orange-500 shadow-[0_4px_15px_rgba(245,158,11,0.3)]'}
                  ${isLoadingTask ? 'opacity-70' : ''}
                `}
              >
                {task.kind === 'single' ? <Send size={14} /> : <Sparkles size={14} />}
                {actionLabel}
              </motion.button>
            ) : (
              <div className="flex flex-col items-end">
                <div className="text-[16px] font-bold leading-none text-amber-400">+{reward}</div>
                <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-amber-400/60">монет</div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div ref={containerRef} className="relative flex h-full flex-col overflow-hidden px-4 pb-nav pt-6">
      <AdaptiveParticles
        variant="bg"
        tone="neutral"
        baseCount={16}
        baseSpeed={0.09}
        className="z-0 opacity-30"
      />

      <div className="pointer-events-none absolute inset-0 z-[150] overflow-hidden">
        <AnimatePresence>
          {flyingCoins.map((coin) => (
            <motion.div
              key={coin.id}
              initial={{ x: coin.startX, y: coin.startY, scale: 0, opacity: 0 }}
              animate={{
                x: [coin.startX, coin.midX, coin.endX],
                y: [coin.startY, coin.midY, coin.endY],
                scale: [0, 1.2, 0.5],
                opacity: [0, 1, 1, 0],
                rotate: [0, coin.rotation, coin.rotation * 1.5],
              }}
              transition={{
                duration: 0.8,
                delay: coin.delay,
                times: [0, 0.45, 1],
                ease: ['easeOut', 'easeIn'],
              }}
              className="absolute -ml-3 -mt-3 text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.8)]"
            >
              <Coins size={28} fill="#f59e0b" className="text-amber-200" />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="relative mt-2 mb-6 flex shrink-0 rounded-2xl border border-white/10 bg-white/5 p-1 backdrop-blur-lg">
        <motion.div
          className="absolute top-1 bottom-1 rounded-xl bg-white/10 shadow-sm"
          initial={false}
          animate={{
            left: activeTab === 'tasks' ? '4px' : '50%',
            width: 'calc(50% - 6px)',
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
        <button
          onClick={() => setActiveTab('tasks')}
          className={`z-10 flex-1 py-3 text-sm font-bold transition-colors ${activeTab === 'tasks' ? 'text-white' : 'text-white/50'}`}
        >
          <ClipboardList size={16} className="mr-1 mb-1 inline" /> Задания
        </button>
        <button
          onClick={() => setActiveTab('fragments')}
          className={`z-10 flex-1 py-3 text-sm font-bold transition-colors ${activeTab === 'fragments' ? 'text-white' : 'text-white/50'}`}
        >
          <Puzzle size={16} className="mr-1 mb-1 inline" /> Фрагменты
        </button>
      </div>

      <div className="relative flex-1 overflow-y-auto custom-scrollbar pb-32">
        <AnimatePresence mode="wait">
          {activeTab === 'tasks' ? (
            <motion.div
              key="tasks"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-3 pb-2"
            >
              {screenError ? (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                  <div className="font-bold">Не удалось загрузить задания</div>
                  <div className="mt-1 text-red-200/80">{screenError}</div>
                  <button
                    onClick={() => void fetchTasks(true)}
                    className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white"
                  >
                    Повторить
                  </button>
                </div>
              ) : loading ? (
                <TaskScreenLoader />
              ) : (
                tasks.map((task) => renderTaskCard(task))
              )}
            </motion.div>
          ) : (
            <motion.div
              key="fragments"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-full items-center justify-center px-2"
            >
              <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
                <AdaptiveParticles
                  variant="accent"
                  tone="neutral"
                  baseCount={12}
                  baseSpeed={0.14}
                  className="z-0 opacity-55"
                />
                <Puzzle size={42} className="relative z-10 mx-auto mb-3 text-white/50" />
                <h3 className="relative z-10 mb-2 text-xl font-bold text-white">Фрагменты</h3>
                <p className="relative z-10 text-sm text-white/60">Скоро появится</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="pointer-events-none absolute bottom-[130px] left-4 right-4 z-0 flex h-[80px] items-center">
        <div ref={coinTargetAnchorRef} className="absolute left-[44px]" />
      </div>

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
            <h2 className="mt-4 text-xl font-black text-white">Задания скоро откроются</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              Этот раздел еще в работе. Пока награды и задания временно недоступны.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
