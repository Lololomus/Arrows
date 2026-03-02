import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRewardStore } from '../../stores/rewardStore';

const TONE_CLASSNAME: Record<'success' | 'info' | 'error', string> = {
  success: 'border-emerald-400/35 bg-emerald-500/15 text-emerald-100',
  info: 'border-sky-400/35 bg-sky-500/15 text-sky-100',
  error: 'border-rose-400/35 bg-rose-500/15 text-rose-100',
};

export function RewardToastHost() {
  const toasts = useRewardStore((s) => s.toasts);
  const dismissToast = useRewardStore((s) => s.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) {
      return undefined;
    }

    const timers = toasts.map((toast) => window.setTimeout(() => {
      dismissToast(toast.id);
    }, 4_000));

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [dismissToast, toasts]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[120] flex flex-col items-center gap-2 px-4">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={`pointer-events-auto max-w-sm rounded-2xl border px-4 py-3 text-sm font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-xl ${TONE_CLASSNAME[toast.tone]}`}
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
