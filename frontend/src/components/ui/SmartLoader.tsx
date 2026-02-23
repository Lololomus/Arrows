import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface SmartLoaderProps {
  text?: string;
  delayMs?: number;
  className?: string;
}

export function SmartLoader({
  text = 'Загрузка...',
  delayMs = 180,
  className = '',
}: SmartLoaderProps) {
  const [visible, setVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true);
      return;
    }

    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  if (!visible) {
    return <div className={`h-full w-full ${className}`} aria-hidden="true" />;
  }

  return (
    <div className={`h-full w-full flex items-center justify-center px-6 ${className}`}>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="w-full max-w-xs"
      >
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-4">
          <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <motion.div
              className="h-full w-1/3 bg-gradient-to-r from-transparent via-cyan-300/90 to-transparent"
              animate={{ x: ['-120%', '320%'] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
            />
          </div>
          <div className="mt-3 space-y-2">
            <div className="h-3 rounded bg-white/10 overflow-hidden">
              <motion.div
                className="h-full w-1/2 bg-gradient-to-r from-transparent via-white/35 to-transparent"
                animate={{ x: ['-120%', '260%'] }}
                transition={{ duration: 1.3, repeat: Infinity, ease: 'linear' }}
              />
            </div>
            <div className="h-3 rounded bg-white/10 overflow-hidden">
              <motion.div
                className="h-full w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent"
                animate={{ x: ['-140%', '300%'] }}
                transition={{ duration: 1.35, repeat: Infinity, ease: 'linear', delay: 0.15 }}
              />
            </div>
          </div>
          <div className="mt-3 text-center text-white/65 text-sm">{text}</div>
        </div>
      </motion.div>
    </div>
  );
}

