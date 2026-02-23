import { motion } from 'framer-motion';

interface LevelTransitionLoaderProps {
  level?: number;
  className?: string;
}

export function LevelTransitionLoader({ level, className = '' }: LevelTransitionLoaderProps) {
  return (
    <div className={`flex h-full items-center justify-center px-6 ${className}`}>
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="w-full max-w-sm rounded-3xl border border-cyan-400/25 bg-slate-900/70 backdrop-blur-xl p-5 shadow-[0_0_40px_rgba(34,211,238,0.15)]"
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-cyan-200/80 text-xs uppercase tracking-[0.2em]">Level Loading</span>
          {typeof level === 'number' && (
            <span className="text-white/90 text-sm font-bold">#{level}</span>
          )}
        </div>

        <div className="relative h-2 rounded-full bg-white/10 overflow-hidden">
          <motion.div
            className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-cyan-300 to-transparent"
            animate={{ x: ['-120%', '320%'] }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
        </div>

        <div className="mt-4 flex items-center gap-2">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="h-2.5 w-2.5 rounded-full bg-cyan-300/80"
              animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
              transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
            />
          ))}
          <span className="text-white/70 text-sm ml-2">Preparing board...</span>
        </div>
      </motion.div>
    </div>
  );
}

