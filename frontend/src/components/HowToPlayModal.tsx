import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

interface HowToPlayModalProps {
  open: boolean;
  onClose: () => void;
}

const SLIDE_KEYS = ['tap', 'blocked', 'hold', 'pinch'] as const;

const SLIDE_ICONS: Record<typeof SLIDE_KEYS[number], string> = {
  tap: '👆',
  blocked: '🚫',
  hold: '👁️',
  pinch: '🤏',
};

export function HowToPlayModal({ open, onClose }: HowToPlayModalProps) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);

  const total = SLIDE_KEYS.length;
  const key = SLIDE_KEYS[index];

  const goTo = (next: number, direction: number) => {
    setDir(direction);
    setIndex(next);
  };

  const handleClose = () => {
    setIndex(0);
    onClose();
  };

  const slideVariants = {
    enter: (d: number) => ({ x: d > 0 ? 48 : -48, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? -48 : 48, opacity: 0 }),
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="htp-backdrop"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <motion.div
            key="htp-sheet"
            className="w-full max-w-md bg-[#0f1124] border border-white/10 rounded-t-3xl px-6 pt-6 pb-10 shadow-2xl overflow-hidden"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-white">{t('game:howToPlay.title')}</h2>
              <button
                onClick={handleClose}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 text-white/60 hover:bg-white/20 transition-colors"
                aria-label={t('common:close')}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>
            </div>

            {/* Slide */}
            <div className="relative overflow-hidden min-h-[160px]">
              <AnimatePresence mode="wait" custom={dir}>
                <motion.div
                  key={index}
                  custom={dir}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className="flex flex-col items-center text-center gap-4"
                >
                  <div className="w-16 h-16 rounded-2xl bg-purple-500/15 border border-purple-500/25 flex items-center justify-center text-4xl">
                    {SLIDE_ICONS[key]}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white mb-2">
                      {t(`game:howToPlay.slides.${key}.title`)}
                    </h3>
                    <p className="text-sm text-white/60 leading-relaxed">
                      {t(`game:howToPlay.slides.${key}.body`)}
                    </p>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Dots */}
            <div className="flex items-center justify-center gap-2 mt-6 mb-5">
              {SLIDE_KEYS.map((_, i) => (
                <motion.button
                  key={i}
                  layout
                  onClick={() => goTo(i, i > index ? 1 : -1)}
                  className={`h-2 rounded-full transition-colors duration-200 ${
                    i === index ? 'w-5 bg-purple-400' : 'w-2 bg-white/25'
                  }`}
                />
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              {index > 0 && (
                <button
                  onClick={() => goTo(index - 1, -1)}
                  className="flex-1 py-3 rounded-xl bg-white/8 text-white/70 text-sm font-medium"
                >
                  ←
                </button>
              )}
              {index < total - 1 ? (
                <button
                  onClick={() => goTo(index + 1, 1)}
                  className="flex-1 py-3 rounded-xl bg-purple-600 text-white text-sm font-bold"
                >
                  {t('game:ui.next')} →
                </button>
              ) : (
                <button
                  onClick={handleClose}
                  className="flex-1 py-3 rounded-xl bg-purple-600 text-white text-sm font-bold"
                >
                  {t('game:howToPlay.gotIt')}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
