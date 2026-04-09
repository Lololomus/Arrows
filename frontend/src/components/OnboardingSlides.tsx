import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { onboardingApi } from '../api/client';

interface OnboardingSlidesProps {
  /** true = new user (Play → navigate to game); false = existing user (Play → just close) */
  isNewUser: boolean;
  onComplete: (navigateToGame: boolean) => void;
}

const SLIDE_COUNT = 3;

export function OnboardingSlides({ isNewUser, onComplete }: OnboardingSlidesProps) {
  const { t } = useTranslation();
  const [slide, setSlide] = useState(0);
  const [direction, setDirection] = useState(1);

  const slides = [
    {
      icon: t('game:onboarding.slide1.icon'),
      title: t('game:onboarding.slide1.title'),
      body: t('game:onboarding.slide1.body'),
      bodyHighlight: t('game:onboarding.slide1.bodyHighlight'),
    },
    {
      icon: t('game:onboarding.slide2.icon'),
      title: t('game:onboarding.slide2.title'),
      body: t('game:onboarding.slide2.body'),
    },
    {
      icon: t('game:onboarding.slide3.icon'),
      title: t('game:onboarding.slide3.title'),
      body: t('game:onboarding.slide3.body'),
    },
  ];

  const isLast = slide === SLIDE_COUNT - 1;

  const handleNext = () => {
    if (isLast) {
      void onboardingApi.complete().then(() => {
        localStorage.removeItem('arrowPendingNewUser');
      }).catch(() => undefined);
      onComplete(isNewUser);
    } else {
      setDirection(1);
      setSlide((s) => s + 1);
    }
  };

  const variants = {
    enter: (dir: number) => ({ x: dir > 0 ? 48 : -48, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -48 : 48, opacity: 0 }),
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end justify-center">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <motion.div
        className="relative z-10 w-full max-w-md"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
      >
        <div className="bg-[#0f1124] border border-white/10 rounded-t-3xl px-6 pt-6 pb-10">
          {/* dots */}
          <div className="flex justify-center gap-2 mb-8">
            {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === slide ? 'w-6 bg-purple-400' : 'w-1.5 bg-white/20'
                }`}
              />
            ))}
          </div>

          {/* slide content */}
          <div className="overflow-hidden min-h-[180px] flex items-center">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={slide}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="w-full text-center"
              >
                <div className="text-6xl mb-5">{slides[slide].icon}</div>
                <h2 className="text-xl font-bold text-white mb-3">{slides[slide].title}</h2>
                <p className="text-white/60 text-sm leading-relaxed px-2">
                  {slides[slide].body}
                  {slides[slide].bodyHighlight && (
                    <> <span className="font-bold text-white">{slides[slide].bodyHighlight}</span></>
                  )}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* button */}
          <motion.button
            className="mt-8 w-full py-3 rounded-xl bg-purple-600 text-white text-sm font-bold"
            whileTap={{ scale: 0.97 }}
            onClick={handleNext}
          >
            {isLast
              ? (isNewUser ? t('game:onboarding.play') : t('game:onboarding.close'))
              : `${t('game:onboarding.continue')} →`}
          </motion.button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
