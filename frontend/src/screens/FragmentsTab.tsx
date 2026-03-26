import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Flame, Gem, Info, Loader2, AlertTriangle } from 'lucide-react';

import { fragmentsApi, handleApiError } from '../api/client';
import type { FragmentDrop } from '../game/types';

// ─── Mock data (DEV only) ─────────────────────────────────────────────────────

const MOCK_DROPS: FragmentDrop[] = [
  {
    id: '1',
    emoji: '💎',
    title: 'Telegram Подарок',
    subtitle: 'Алмаз (100 ⭐️)',
    description: 'Условие выполнено! Забирай дроп, пока есть в наличии.',
    status: 'claimable',
    totalStock: 5,
    remainingStock: 2,
  },
  {
    id: '2',
    emoji: '🌹',
    title: 'Telegram Подарок',
    subtitle: 'Розочка (25 ⭐️)',
    description: 'Пройди 100 уровней в Arcade, чтобы получить эксклюзив.',
    status: 'in_progress',
    totalStock: 10,
    remainingStock: 8,
    progressCurrent: 45,
    progressTarget: 100,
  },
  {
    id: '3',
    emoji: '🎁',
    title: 'Telegram Подарок',
    subtitle: 'Коробка (50 ⭐️)',
    description: 'Подарок успешно отправлен в твой Telegram.',
    status: 'completed',
    totalStock: 20,
    remainingStock: 0,
  },
  {
    id: '4',
    emoji: '🍺',
    title: 'Telegram Подарок',
    subtitle: 'Пиво (15 ⭐️)',
    description: 'Пригласи 10 друзей по реферальной ссылке.',
    status: 'sold_out',
    totalStock: 20,
    remainingStock: 0,
  },
];

const CONDITION_LABELS: Record<string, string> = {
  arcade_levels: 'уровней в Arcade',
  friends_confirmed: 'друзей',
};

function mapApiStatus(status: string): FragmentDrop['status'] {
  if (status === 'delivered') return 'completed';
  if (status === 'claiming') return 'claiming';
  if (status === 'failed') return 'failed';
  if (status === 'out_of_stock') return 'sold_out';
  if (status === 'claimable' || status === 'in_progress' || status === 'completed' || status === 'sold_out') {
    return status;
  }
  return 'sold_out';
}

async function fetchFragmentDrops(): Promise<FragmentDrop[]> {
  if (import.meta.env.DEV) return MOCK_DROPS;

  const apiDrops = await fragmentsApi.getDrops();
  return apiDrops.map((d) => {
    const condLabel = CONDITION_LABELS[d.conditionType] ?? '';
    return {
      id: String(d.id),
      emoji: d.emoji,
      title: d.title,
      subtitle: `${d.title} (${d.giftStarCost} ⭐️)`,
      description: d.description ?? `Достигни ${d.conditionTarget} ${condLabel}`,
      status: mapApiStatus(d.status),
      totalStock: d.totalStock,
      remainingStock: d.remainingStock,
      progressCurrent: d.status === 'in_progress' ? d.progress : undefined,
      progressTarget: d.status === 'in_progress' ? d.conditionTarget : undefined,
    };
  });
}

// ─── Section divider ──────────────────────────────────────────────────────────

function SectionDivider({
  label,
  icon,
  lineClass = 'via-white/12',
  delay = 0,
}: {
  label: string;
  icon?: React.ReactNode;
  lineClass?: string;
  delay?: number;
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

// ─── Info bottom-sheet modal ──────────────────────────────────────────────────

const FragmentsInfoModal = memo(({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
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
              if (info.offset.y > 100 || info.velocity.y > 500) onClose();
            }}
            className="fixed bottom-0 left-0 right-0 z-[2001] bg-[#1a1a24] rounded-t-[32px] border-t border-cyan-500/30 p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
            style={{ paddingBottom: 'calc(3rem + var(--app-safe-bottom, 0px))' }}
          >
            <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-6" />

            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/20 mb-4">
                <Gem className="text-cyan-400 w-8 h-8" />
              </div>
              <h3 className="text-2xl font-black text-white uppercase tracking-wide mb-6 drop-shadow-md">
                Как это работает?
              </h3>

              <div className="space-y-4 text-left">
                <div className="bg-gradient-to-br from-cyan-900/40 to-blue-900/20 rounded-2xl p-4 border border-cyan-500/30 shadow-lg">
                  <p className="text-white/90 font-medium text-sm leading-relaxed text-center">
                    Собирай фрагменты подарков за выполнение заданий и выводи их себе прямо в Telegram!
                  </p>
                </div>
                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <p className="text-white/80 font-medium text-xs leading-relaxed text-center">
                    Количество наград строго ограничено. Успей забрать свой эксклюзивный дроп первым.
                  </p>
                </div>
              </div>

              <button
                onClick={onClose}
                className="mt-6 w-full py-3.5 bg-white/10 hover:bg-white/15 rounded-xl text-white font-bold text-sm transition-colors active:scale-95"
              >
                Понятно
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
});
FragmentsInfoModal.displayName = 'FragmentsInfoModal';

// ─── Cards ────────────────────────────────────────────────────────────────────

function ClaimableCard({ drop, onClaim, claiming = false }: { drop: FragmentDrop; onClaim: (id: string) => void; claiming?: boolean }) {
  return (
    <motion.div
      className="rounded-2xl border border-cyan-500/50 bg-cyan-500/5 p-4 relative overflow-hidden backdrop-blur-[10px]"
      animate={{
        boxShadow: [
          '0 0 0 0 rgba(0,210,255,0.4)',
          '0 0 0 10px rgba(0,210,255,0)',
          '0 0 0 0 rgba(0,210,255,0)',
        ],
      }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
    >
      <div className="flex items-start gap-4">
        <div className="relative w-16 h-16 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/50 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(0,210,255,0.4)]">
          <span className="text-3xl relative z-10">{drop.emoji}</span>
          <div className="absolute inset-0 bg-cyan-400/20 rounded-xl blur-md" />
        </div>

        <div className="flex-1">
          <div className="flex justify-between items-start mb-1">
            <div>
              <h3 className="font-bold text-base leading-tight text-white">{drop.title}</h3>
              <p className="text-cyan-400 text-xs font-bold mt-0.5">{drop.subtitle}</p>
            </div>
            <div className="bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 text-[10px] font-bold px-2 py-1 rounded-md shrink-0">
              {drop.remainingStock}/{drop.totalStock} шт.
            </div>
          </div>

          <p className="text-white/70 text-xs mt-1 mb-3">{drop.description}</p>

          <button
            onClick={() => onClaim(drop.id)}
            disabled={claiming}
            className="relative w-full py-2.5 text-sm font-bold uppercase tracking-wider text-white rounded-[0.8rem] overflow-hidden flex items-center justify-center gap-2 disabled:opacity-60"
            style={{
              background: 'linear-gradient(90deg, #00d2ff 0%, #009dff 100%)',
              boxShadow: '0 0 15px rgba(0,210,255,0.4)',
            }}
          >
            <span className="relative z-10 flex items-center gap-2">
              {claiming ? 'Отправляем...' : '🎁 Забрать'}
            </span>
            <motion.span
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-[-25deg]"
              animate={{ x: ['-150%', '250%'] }}
              transition={{ duration: 3, repeat: Infinity, repeatDelay: 1.5, ease: 'linear' }}
            />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function InProgressCard({ drop }: { drop: FragmentDrop }) {
  const pct =
    drop.progressCurrent != null && drop.progressTarget
      ? Math.round((drop.progressCurrent / drop.progressTarget) * 100)
      : 0;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 relative overflow-hidden backdrop-blur-[10px]">
      <div className="absolute top-0 left-1/4 w-1/2 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-pink-500/10 to-purple-500/10 border border-pink-500/20 flex items-center justify-center shrink-0">
          <span className="text-3xl">{drop.emoji}</span>
        </div>

        <div className="flex-1">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-bold text-base leading-tight text-white">{drop.title}</h3>
              <p className="text-pink-400 text-xs font-bold mt-0.5">{drop.subtitle}</p>
            </div>
            <div className="bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 text-[10px] font-bold px-2 py-1 rounded-md flex items-center gap-1 shrink-0">
              {drop.remainingStock}/{drop.totalStock} шт.
            </div>
          </div>

          <p className="text-white/60 text-xs mt-2 mb-2 leading-tight">{drop.description}</p>

          {drop.progressCurrent != null && drop.progressTarget != null && (
            <div className="mt-3">
              <div className="flex justify-between items-end mb-1.5">
                <span className="text-[10px] text-white/50 font-bold uppercase tracking-wide">Прогресс</span>
                <span className="text-sm font-black text-white">
                  {drop.progressCurrent}
                  <span className="text-white/40 text-xs font-bold">/{drop.progressTarget}</span>
                </span>
              </div>
              <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
                <div
                  className="h-full bg-gradient-to-r from-pink-500 to-yellow-400 rounded-full shadow-[0_0_10px_rgba(236,72,153,0.5)]"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CompletedCard({ drop }: { drop: FragmentDrop }) {
  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-900/10 p-4 backdrop-blur-[10px]">
      <div className="flex items-start gap-4">
        <div className="relative w-16 h-16 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
          <span className="text-3xl grayscale opacity-80">{drop.emoji}</span>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-[#0a0c27]">
            <CheckCircle2 size={12} className="text-white" />
          </div>
        </div>

        <div className="flex-1">
          <h3 className="font-bold text-base leading-tight text-emerald-400">Дроп получен</h3>
          <p className="text-white/50 text-xs mt-0.5 line-through">{drop.subtitle}</p>
          <p className="text-white/40 text-xs mt-2">{drop.description}</p>
        </div>
      </div>
    </div>
  );
}

function SoldOutCard({ drop }: { drop: FragmentDrop }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 opacity-40 grayscale backdrop-blur-[10px]">
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
          <span className="text-3xl">{drop.emoji}</span>
        </div>

        <div className="flex-1">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-bold text-base leading-tight text-white">{drop.title}</h3>
              <p className="text-white/40 text-xs font-bold mt-0.5">{drop.subtitle}</p>
            </div>
            <div className="bg-white/5 border border-white/10 text-white/40 text-[10px] font-bold px-2 py-1 rounded-md shrink-0">
              0/{drop.totalStock} шт.
            </div>
          </div>

          <p className="text-white/40 text-xs mt-2 mb-2">{drop.description}</p>

          <div className="mt-2 w-full py-1.5 bg-black/20 rounded-lg text-center text-[10px] font-bold text-white/40 uppercase tracking-widest border border-white/5">
            Все разобрали 😔
          </div>
        </div>
      </div>
    </div>
  );
}

function ClaimingCard({ drop }: { drop: FragmentDrop }) {
  return (
    <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-4 relative overflow-hidden backdrop-blur-[10px]">
      <div className="flex items-start gap-4">
        <div className="relative w-16 h-16 rounded-xl bg-gradient-to-br from-yellow-500/15 to-orange-500/15 border border-yellow-500/30 flex items-center justify-center shrink-0">
          <span className="text-3xl">{drop.emoji}</span>
        </div>

        <div className="flex-1">
          <h3 className="font-bold text-base leading-tight text-white">{drop.title}</h3>
          <p className="text-yellow-400 text-xs font-bold mt-0.5">{drop.subtitle}</p>
          <p className="text-white/60 text-xs mt-2 mb-3">Подарок отправляется в твой Telegram...</p>

          <div className="w-full py-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-[0.8rem] flex items-center justify-center gap-2">
            <Loader2 size={14} className="text-yellow-400 animate-spin" />
            <span className="text-yellow-400 text-sm font-bold">Отправляем...</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FailedCard({ drop, onRetry }: { drop: FragmentDrop; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 relative overflow-hidden backdrop-blur-[10px]">
      <div className="flex items-start gap-4">
        <div className="relative w-16 h-16 rounded-xl bg-gradient-to-br from-red-500/15 to-orange-500/15 border border-red-500/30 flex items-center justify-center shrink-0">
          <span className="text-3xl">{drop.emoji}</span>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center border-2 border-[#0a0c27]">
            <AlertTriangle size={12} className="text-white" />
          </div>
        </div>

        <div className="flex-1">
          <h3 className="font-bold text-base leading-tight text-red-400">Ошибка доставки</h3>
          <p className="text-white/50 text-xs mt-0.5">{drop.subtitle}</p>
          <p className="text-white/50 text-xs mt-2 mb-3">Убедись, что бот не заблокирован, и попробуй снова.</p>

          <button
            onClick={onRetry}
            className="w-full py-2.5 text-sm font-bold uppercase tracking-wider text-white rounded-[0.8rem] bg-red-500/20 border border-red-500/30 hover:bg-red-500/30 active:scale-95 transition-all"
          >
            Повторить
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FragmentsTab() {
  const [drops, setDrops] = useState<FragmentDrop[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const pollingRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  useEffect(() => {
    fetchFragmentDrops().then((fetched) => {
      setDrops(fetched);
      // Start polling for any already-claiming drops
      fetched.filter((d) => d.status === 'claiming').forEach((d) => startPolling(d.id));
    }).catch(() => {});
    return () => {
      Object.values(pollingRef.current).forEach(clearInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPolling = useCallback((id: string) => {
    if (pollingRef.current[id]) return;
    let polls = 0;
    const MAX_POLLS = 100; // ~10 min at 6s intervals
    pollingRef.current[id] = setInterval(async () => {
      polls++;
      try {
        const status = await fragmentsApi.getClaimStatus(Number(id));
        if (status.claimStatus === 'delivered') {
          clearInterval(pollingRef.current[id]);
          delete pollingRef.current[id];
          setDrops((prev) =>
            prev.map((d) => (d.id === id ? { ...d, status: 'completed' as const } : d)),
          );
        } else if (status.claimStatus === 'failed') {
          clearInterval(pollingRef.current[id]);
          delete pollingRef.current[id];
          setDrops((prev) =>
            prev.map((d) => (d.id === id ? { ...d, status: 'failed' as const } : d)),
          );
        } else if (polls >= MAX_POLLS) {
          // Polling exhausted — refetch and restart polling if still claiming
          clearInterval(pollingRef.current[id]);
          delete pollingRef.current[id];
          fetchFragmentDrops().then((fetched) => {
            setDrops(fetched);
            const still = fetched.find((d) => d.id === id && d.status === 'claiming');
            if (still) startPolling(still.id);
          }).catch(() => {});
        }
      } catch {
        // Ignore poll errors
      }
    }, 6000);
  }, []);

  const handleClaim = useCallback(async (id: string) => {
    if (claimingId) return;
    setClaimingId(id);
    setClaimError(null);

    if (import.meta.env.DEV) {
      // DEV: optimistic mock
      setDrops((prev) =>
        prev.map((d) => (d.id === id ? { ...d, status: 'completed' as const } : d)),
      );
      setClaimingId(null);
      return;
    }

    try {
      const result = await fragmentsApi.claimDrop(Number(id));
      if (result.claimStatus === 'delivered') {
        setDrops((prev) =>
          prev.map((d) => (d.id === id ? { ...d, status: 'completed' as const } : d)),
        );
      } else {
        // sending/pending — show as claiming, start polling
        setDrops((prev) =>
          prev.map((d) => (d.id === id ? { ...d, status: 'claiming' as const } : d)),
        );
        startPolling(id);
      }
    } catch (err) {
      setClaimError(handleApiError(err));
      fetchFragmentDrops().then(setDrops).catch(() => {});
    } finally {
      setClaimingId(null);
    }
  }, [claimingId, startPolling]);

  const claimable = drops.filter((d) => d.status === 'claimable');
  const claiming = drops.filter((d) => d.status === 'claiming');
  const failed = drops.filter((d) => d.status === 'failed');
  const inProgress = drops.filter((d) => d.status === 'in_progress');
  const completed = drops.filter((d) => d.status === 'completed');
  const soldOut = drops.filter((d) => d.status === 'sold_out');

  const hasDone = completed.length > 0 || soldOut.length > 0;

  return (
    <div className="pb-6 space-y-4 pt-1">
      {/* Banner */}
      <div className="bg-gradient-to-b from-cyan-500/20 to-transparent p-6 rounded-3xl border border-cyan-500/30 text-center relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 bg-cyan-500/20 blur-3xl pointer-events-none" />

        <button
          onClick={() => setInfoOpen(true)}
          className="absolute top-3.5 right-3.5 z-20 w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 border border-white/20 text-white/75 hover:text-white hover:bg-white/15 active:scale-95 transition-all backdrop-blur-sm shadow-[0_4px_14px_rgba(0,0,0,0.28)]"
          aria-label="Информация"
        >
          <Info size={18} />
        </button>

        <Gem
          size={48}
          className="text-cyan-400 mx-auto mb-2 relative z-10 drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]"
        />
        <h1 className="text-[26px] leading-tight font-black text-white uppercase tracking-wide drop-shadow-md relative z-10">
          ЛИМИТИРОВАННЫЕ ДРОПЫ
        </h1>
        <p className="text-white/60 text-xs mt-1.5 relative z-10">Выполняй хардкорные задания</p>
      </div>

      {/* Error toast */}
      {claimError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
          {claimError}
        </div>
      )}

      {/* Claimable cards (no preceding divider — most important) */}
      {claimable.map((drop) => (
        <ClaimableCard key={drop.id} drop={drop} onClaim={handleClaim} claiming={claimingId === drop.id} />
      ))}

      {/* Claiming (delivery in progress) */}
      {claiming.map((drop) => (
        <ClaimingCard key={drop.id} drop={drop} />
      ))}

      {/* Failed (can retry) */}
      {failed.map((drop) => (
        <FailedCard key={drop.id} drop={drop} onRetry={() => handleClaim(drop.id)} />
      ))}

      {/* In-progress section */}
      {inProgress.length > 0 && (
        <>
          <SectionDivider
            label="В ПРОЦЕССЕ"
            lineClass="via-yellow-400/20"
            icon={<Flame size={10} className="text-yellow-400" />}
            delay={0.05}
          />
          {inProgress.map((drop) => (
            <InProgressCard key={drop.id} drop={drop} />
          ))}
        </>
      )}

      {/* Completed / sold-out section */}
      {hasDone && (
        <>
          <SectionDivider
            label="ЗАВЕРШЕННЫЕ"
            lineClass="via-green-400/20"
            icon={<CheckCircle2 size={10} className="text-green-400" />}
            delay={0.08}
          />
          {completed.map((drop) => (
            <CompletedCard key={drop.id} drop={drop} />
          ))}
          {soldOut.map((drop) => (
            <SoldOutCard key={drop.id} drop={drop} />
          ))}
        </>
      )}

      <FragmentsInfoModal isOpen={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  );
}
