/**
 * PurchaseSuccessOverlay
 *
 * Полноэкранный оверлей после успешной покупки подсказок / ревайвов / набора.
 * Анимация:
 *  1. Тёмный радиальный фон fade-in
 *  2. Главная иконка прилетает снизу + bounce (spring)
 *  3. 6 иконок-частиц разлетаются по кругу (burst)
 *  4. Текст "+N подсказок / ревайвов" fade+slide
 *  5. Через 1.6 с — fade-out → onDone()
 *
 * Только transform + opacity → GPU-ускорение на мобильных.
 */

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, Heart } from 'lucide-react';
import { translate } from '../../i18n';

export type PurchaseSuccessType = 'hints' | 'revives' | 'bundle';

export interface PurchaseSuccessData {
  type: PurchaseSuccessType;
  hintsCount?: number;
  revivesCount?: number;
}

interface PurchaseSuccessOverlayProps extends PurchaseSuccessData {
  visible: boolean;
  onDone: () => void;
}

const BURST_ANGLES = [0, 60, 120, 180, 240, 300];
const BURST_R = 88;

function angle2xy(deg: number, r: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [Math.cos(rad) * r, Math.sin(rad) * r];
}

export function PurchaseSuccessOverlay({
  type,
  hintsCount = 0,
  revivesCount = 0,
  visible,
  onDone,
}: PurchaseSuccessOverlayProps) {
  useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(onDone, 1650);
    return () => window.clearTimeout(id);
  }, [visible, onDone]);

  const isHints  = type === 'hints';
  const isBundle = type === 'bundle';

  const primaryColor = isHints ? '#22d3ee' : type === 'revives' ? '#fb7185' : '#c084fc';
  const glowBg = isHints
    ? 'rgba(6,182,212,0.15)'
    : type === 'revives'
      ? 'rgba(251,113,133,0.15)'
      : 'rgba(192,132,252,0.15)';

  const MainIcon    = (isHints || isBundle) && hintsCount > 0 ? Lightbulb : Heart;
  const iconClass   = isHints ? 'text-cyan-300' : type === 'revives' ? 'text-rose-400' : 'text-purple-300';
  const iconFill    = type === 'revives' || (isBundle && revivesCount > 0 && hintsCount === 0) ? '#fb7185' : 'none';
  // For bundle leading icon — prefer hint icon if bundle has hints
  const BundleAltIcon = Heart;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="pso"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none"
        >
          {/* Radial backdrop */}
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(ellipse 70% 55% at 50% 50%, ${glowBg} 0%, rgba(4,4,12,0.86) 70%)`,
            }}
          />

          {/* Burst particles */}
          {BURST_ANGLES.map((deg, i) => {
            const [tx, ty] = angle2xy(deg, BURST_R);
            const ParticleIcon = i % 2 === 0 ? (isHints ? Lightbulb : Heart) : (isBundle ? Lightbulb : (isHints ? Lightbulb : Heart));
            const pFill = ParticleIcon === Heart ? '#fb7185' : 'none';
            return (
              <motion.div
                key={deg}
                initial={{ opacity: 0, x: 0, y: 0, scale: 0, rotate: 0 }}
                animate={{
                  opacity:  [0, 0.9, 0.85, 0],
                  x:        [0, tx * 0.55, tx],
                  y:        [0, ty * 0.55, ty],
                  scale:    [0, 1.3, 0.75],
                  rotate:   [0, deg % 2 === 0 ? 30 : -30],
                }}
                transition={{
                  duration: 0.85,
                  delay: 0.12 + i * 0.045,
                  ease: 'easeOut',
                  opacity: { times: [0, 0.18, 0.65, 1] },
                }}
                className="absolute"
              >
                <ParticleIcon
                  size={18}
                  fill={pFill}
                  className={
                    ParticleIcon === Lightbulb ? 'text-cyan-300' : 'text-rose-400'
                  }
                  style={{ filter: `drop-shadow(0 0 5px ${primaryColor})` }}
                />
              </motion.div>
            );
          })}

          {/* Main card */}
          <motion.div
            initial={{ scale: 0.3, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.7, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22, delay: 0.05 }}
            className="relative z-10 flex flex-col items-center gap-3 px-8"
          >
            {/* Icon with pulse ring */}
            <motion.div
              className="relative flex items-center justify-center mb-1"
              animate={{ scale: [1, 1.1, 1, 1.06, 1] }}
              transition={{ duration: 0.75, delay: 0.22, ease: 'easeInOut' }}
            >
              {/* Pulse ring */}
              <motion.div
                initial={{ scale: 0.6, opacity: 0.6 }}
                animate={{ scale: 2.2, opacity: 0 }}
                transition={{ duration: 0.9, delay: 0.18, ease: 'easeOut' }}
                className="absolute rounded-full"
                style={{
                  width: 72,
                  height: 72,
                  background: `radial-gradient(circle, ${primaryColor}60 0%, transparent 70%)`,
                }}
              />
              {/* Steady glow */}
              <div
                className="absolute rounded-full pointer-events-none"
                style={{
                  inset: -20,
                  background: `radial-gradient(circle, ${primaryColor}35 0%, transparent 70%)`,
                }}
              />
              <MainIcon
                size={72}
                fill={iconFill}
                className={iconClass}
                style={{ filter: `drop-shadow(0 0 22px ${primaryColor})` }}
              />
            </motion.div>

            {/* "ПОЛУЧЕНО!" */}
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28 }}
              className="font-black text-2xl uppercase tracking-widest text-white"
              style={{ textShadow: `0 0 24px ${primaryColor}90` }}
            >
              {translate('shop:purchaseSuccess.title')}
            </motion.p>

            {/* Counts */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.38 }}
              className="flex flex-col items-center gap-1.5"
            >
              {(isHints || isBundle) && hintsCount > 0 && (
                <div className="flex items-center gap-2">
                  <Lightbulb size={20} className="text-cyan-300" style={{ filter: 'drop-shadow(0 0 6px #22d3ee)' }} />
                  <span className="text-lg font-bold text-cyan-100">
                    {translate('shop:purchaseSuccess.hints', { count: hintsCount })}
                  </span>
                </div>
              )}
              {(type === 'revives' || isBundle) && revivesCount > 0 && (
                <div className="flex items-center gap-2">
                  <Heart size={20} fill="#fb7185" className="text-rose-400" style={{ filter: 'drop-shadow(0 0 6px #fb7185)' }} />
                  <span className="text-lg font-bold text-rose-200">
                    {translate('shop:purchaseSuccess.revives', { count: revivesCount })}
                  </span>
                </div>
              )}
              {isBundle && hintsCount === 0 && revivesCount === 0 && (
                <span className="text-base font-bold text-purple-200">{translate('shop:purchaseSuccess.bundleAdded')}</span>
              )}
            </motion.div>

            {/* Optional: second icon row for bundles */}
            {isBundle && hintsCount > 0 && revivesCount > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                transition={{ delay: 0.55 }}
                className="flex gap-3 mt-1"
              >
                {Array.from({ length: Math.min(hintsCount, 4) }).map((_, i) => (
                  <Lightbulb key={i} size={14} className="text-cyan-400 opacity-70" />
                ))}
                {Array.from({ length: Math.min(revivesCount, 4) }).map((_, i) => (
                  <Heart key={i} size={14} fill="#fb7185" className="text-rose-400 opacity-70" />
                ))}
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
