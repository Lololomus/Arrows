/**
 * PurchaseSuccessOverlay
 *
 * Полноэкранный оверлей после успешной покупки подсказок / ревайвов / набора.
 * Мобильная оптимизация: только transform + opacity, никаких CSS filter.
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
const BURST_R = 80;

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

  const glowColor = isHints ? 'rgba(6,182,212,0.18)' : type === 'revives' ? 'rgba(251,113,133,0.18)' : 'rgba(192,132,252,0.18)';
  const glowColorStrong = isHints ? 'rgba(6,182,212,0.32)' : type === 'revives' ? 'rgba(251,113,133,0.32)' : 'rgba(192,132,252,0.32)';

  const MainIcon  = (isHints || isBundle) && hintsCount > 0 ? Lightbulb : Heart;
  const iconClass = isHints ? 'text-cyan-300' : type === 'revives' ? 'text-rose-400' : 'text-purple-300';
  const iconFill  = type === 'revives' || (isBundle && revivesCount > 0 && hintsCount === 0) ? '#fb7185' : 'none';

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
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(ellipse 70% 55% at 50% 50%, ${glowColor} 0%, rgba(4,4,12,0.88) 70%)`,
            }}
          />

          {/* Burst particles — flex-обёртка чтобы не было inline-gap у SVG */}
          {BURST_ANGLES.map((deg, i) => {
            const [tx, ty] = angle2xy(deg, BURST_R);
            const PIcon = isHints ? Lightbulb : Heart;
            const pFill = PIcon === Heart ? '#fb7185' : 'none';
            return (
              <motion.div
                key={deg}
                initial={{ opacity: 0, x: 0, y: 0, scale: 0 }}
                animate={{
                  opacity: [0, 0.85, 0.75, 0],
                  x:       [0, tx * 0.5, tx],
                  y:       [0, ty * 0.5, ty],
                  scale:   [0, 1.2, 0.7],
                }}
                transition={{
                  duration: 0.82,
                  delay: 0.1 + i * 0.045,
                  ease: 'easeOut',
                  opacity: { times: [0, 0.2, 0.65, 1] },
                }}
                /* flex + shrink-0 убирает inline-gap и квадрат вокруг SVG */
                className="absolute flex items-center justify-center"
                style={{ width: 20, height: 20 }}
              >
                <PIcon size={16} fill={pFill} className={PIcon === Lightbulb ? 'text-cyan-300' : 'text-rose-400'} />
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
            {/* Icon + glow rings */}
            <motion.div
              className="relative flex items-center justify-center mb-1"
              animate={{ scale: [1, 1.1, 1, 1.06, 1] }}
              transition={{ duration: 0.75, delay: 0.22, ease: 'easeInOut' }}
            >
              {/* Expanding pulse ring — цветной круг, без filter */}
              <motion.div
                initial={{ scale: 0.5, opacity: 0.7 }}
                animate={{ scale: 2.6, opacity: 0 }}
                transition={{ duration: 0.9, delay: 0.16, ease: 'easeOut' }}
                className="absolute rounded-full"
                style={{ width: 72, height: 72, backgroundColor: glowColorStrong }}
              />
              {/* Static glow circle */}
              <div
                className="absolute rounded-full"
                style={{ width: 100, height: 100, top: -14, left: -14, backgroundColor: glowColor }}
              />
              <MainIcon
                size={72}
                fill={iconFill}
                className={`relative z-10 ${iconClass}`}
              />
            </motion.div>

            {/* "ПОЛУЧЕНО!" */}
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28 }}
              className="font-black text-2xl uppercase tracking-widest text-white"
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
                  <Lightbulb size={20} className="text-cyan-300 shrink-0" />
                  <span className="text-lg font-bold text-cyan-100">
                    {translate('shop:purchaseSuccess.hints', { count: hintsCount })}
                  </span>
                </div>
              )}
              {(type === 'revives' || isBundle) && revivesCount > 0 && (
                <div className="flex items-center gap-2">
                  <Heart size={20} fill="#fb7185" className="text-rose-400 shrink-0" />
                  <span className="text-lg font-bold text-rose-200">
                    {translate('shop:purchaseSuccess.revives', { count: revivesCount })}
                  </span>
                </div>
              )}
              {isBundle && hintsCount === 0 && revivesCount === 0 && (
                <span className="text-base font-bold text-purple-200">{translate('shop:purchaseSuccess.bundleAdded')}</span>
              )}
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
