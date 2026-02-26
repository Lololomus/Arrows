import { motion } from 'framer-motion';
import { Coins } from 'lucide-react';

interface CoinStashCardProps {
  balance: number;
  className?: string;
  animated?: boolean;
  delay?: number;
  label?: string;
  badge?: string;
}

export function CoinStashCard({
  balance,
  className = '',
  animated = true,
  delay = 0.2,
  label = 'Coin stash',
  badge = 'Wallet',
}: CoinStashCardProps) {
  const animationProps = animated
    ? {
        initial: { opacity: 0, y: 12, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { duration: 0.35, ease: 'easeOut', delay },
      }
    : {};

  return (
    <motion.div
      {...animationProps}
      className={`relative overflow-hidden rounded-2xl border border-yellow-300/20 bg-[#14162a]/65 backdrop-blur-xl shadow-[0_8px_28px_rgba(0,0,0,0.45)] ${className}`}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 via-yellow-300/10 to-amber-500/10" />
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-yellow-300/20 blur-2xl" />
      <div className="relative flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-yellow-200/25 bg-yellow-300/10 text-yellow-300">
            <Coins size={20} strokeWidth={2.2} />
          </div>
          <div className="leading-tight">
            <p className="text-[11px] uppercase tracking-[0.22em] text-yellow-100/70">{label}</p>
            <p className="text-2xl font-black text-yellow-200 drop-shadow-[0_0_12px_rgba(250,204,21,0.35)]">
              {balance.toLocaleString()}
            </p>
          </div>
        </div>
        <span className="rounded-full border border-yellow-300/30 bg-yellow-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-yellow-100/75">
          {badge}
        </span>
      </div>
    </motion.div>
  );
}
