/**
 * Arrow Puzzle — Defeat Visual Effects
 *
 * Тяжёлое медленное красное дыхание + vignette + падающий пепел.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';

interface DefeatFXProps {
  primary: string;
  secondary: string;
}

export function DefeatFX({ primary }: DefeatFXProps) {
  const ashes = useMemo(
    () =>
      Array.from({ length: 25 }).map(() => ({
        x: (Math.random() - 0.5) * 300,
        delay: Math.random() * 3,
        duration: 3 + Math.random() * 4,
        size: Math.random() * 4 + 2,
        isGray: Math.random() > 0.5,
      })),
    [],
  );

  return (
    <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
      {/* Тяжёлое красное дыхание */}
      <motion.div
        className="absolute w-[450px] h-[450px] rounded-full"
        style={{
          background: `radial-gradient(circle, ${primary}40 0%, transparent 60%)`,
        }}
        animate={{ scale: [1, 0.95, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Мрачная vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.8)_100%)]" />

      {/* Падающий пепел */}
      {ashes.map((ash, i) => (
        <motion.div
          key={`ash-${i}`}
          className="absolute rounded-full blur-[1px]"
          style={{
            backgroundColor: ash.isGray ? '#9ca3af' : primary,
            width: ash.size,
            height: ash.size,
            opacity: 0.6,
          }}
          initial={{ x: ash.x, y: -200, opacity: 0 }}
          animate={{
            y: 300,
            opacity: [0, 0.6, 0],
            x: ash.x + (ash.isGray ? 30 : -30),
          }}
          transition={{
            duration: ash.duration,
            repeat: Infinity,
            delay: ash.delay,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}