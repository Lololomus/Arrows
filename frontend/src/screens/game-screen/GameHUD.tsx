/**
 * Arrow Puzzle — Game HUD (v5 - Spring Animations & SE Safe Area)
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Heart, Lightbulb } from 'lucide-react';
import { useGameStore } from '../../stores/store';
import {
  getDifficultyConfig,
  type DifficultyValue,
} from './difficultyConfig';

// ============================================
// PROPS
// ============================================

interface GameHUDProps {
  currentLevel: number;
  lives: number;
  difficulty: DifficultyValue;
  hintsRemaining: number;
  onHintClick: () => void;
  onMenuClick: () => void;
  children: ReactNode;
}

// ============================================
// LIVES DISPLAY
// ============================================

function LivesDisplay({
  lives,
  currentLevel,
  lifeHitTick,
}: {
  lives: number;
  currentLevel: number;
  lifeHitTick: number;
}) {
  const prevLivesRef = useRef(lives);
  const prevLevelRef = useRef(currentLevel);
  const prevLifeHitTickRef = useRef(lifeHitTick);
  const [isHit, setIsHit] = useState(false);

  useEffect(() => {
    if (currentLevel !== prevLevelRef.current) {
      prevLevelRef.current = currentLevel;
      prevLivesRef.current = lives;
      prevLifeHitTickRef.current = lifeHitTick;
      setIsHit(false);
      return;
    }

    if (lifeHitTick !== prevLifeHitTickRef.current) {
      prevLifeHitTickRef.current = lifeHitTick;
      setIsHit(true);
      const timer = setTimeout(() => setIsHit(false), 600);
      prevLivesRef.current = lives;
      return () => clearTimeout(timer);
    }

    prevLivesRef.current = lives;
  }, [currentLevel, lifeHitTick, lives]);

  const isCritical = lives <= 1;

  const numberColor = isHit
    ? 'text-red-400'
    : isCritical
      ? 'text-red-500'
      : 'text-white';

  return (
    <div className="flex items-center gap-1.5">
      <motion.div
        initial={false}
        animate={
          isHit
            ? { x: [0, -3, 3, -2, 2, 0], scale: [1, 1.3, 0.9, 1.1, 1] }
            : { x: 0, scale: 1 }
        }
        transition={
          isHit
            ? { duration: 0.5, ease: 'easeOut' }
            : { duration: 0.15 }
        }
        className="flex items-center"
      >
        <Heart
          size={16}
          fill="#ef4444"
          stroke="none"
          className="drop-shadow-[0_0_4px_rgba(239,68,68,0.6)]"
        />
      </motion.div>

      <motion.span
        initial={false}
        animate={isHit ? { scale: [1, 1.18, 1] } : { scale: 1 }}
        transition={isHit ? { duration: 0.35, ease: 'easeOut' } : { duration: 0.15 }}
        className={`text-sm font-bold tabular-nums leading-none ${numberColor}`}
      >
        ×{lives}
      </motion.span>
    </div>
  );
}

// ============================================
// TOP BAR — Slide down with spring
// ============================================

function TopBar({
  currentLevel,
  lives,
  difficulty,
  lifeHitTick,
}: {
  currentLevel: number;
  lives: number;
  difficulty: DifficultyValue;
  lifeHitTick: number;
}) {
  const cfg = getDifficultyConfig(difficulty);

  return (
    <div className="relative z-20 w-full">
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-slate-950/70 to-transparent pointer-events-none -z-10" />

      <div 
        className="flex justify-center px-4 pointer-events-auto"
        // Защита для iPhone SE: если env(safe-area-inset-top) = 0, берем минимум 48px для кнопок TG
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 48px) + 12px)' }} 
      >
        <motion.div
          // Выезд сверху
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          // Физика пружины: damping гасит колебания, stiffness отвечает за скорость
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          className="flex items-center bg-slate-900/80 backdrop-blur-md rounded-full border border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.6)] overflow-hidden"
        >
          {/* Level */}
          <div className="flex items-center gap-2 pl-4 pr-3 py-2.5">
            <span className="text-white/40 text-[10px] font-semibold uppercase tracking-widest leading-none">
              LVL
            </span>
            <span className="text-white font-bold text-base leading-none tabular-nums">
              {currentLevel}
            </span>
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-white/10" />

          {/* Difficulty */}
          <div className="flex items-center gap-1.5 px-3 py-2.5">
            <div className={`w-1.5 h-1.5 rounded-full ${cfg.hudDotColor} shadow-[0_0_6px_currentColor]`} />
            <span className={`text-xs font-bold uppercase tracking-wider leading-none ${cfg.hudBadgeColor}`}>
              {cfg.label}
            </span>
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-white/10" />

          {/* Lives */}
          <div className="pl-3 pr-4 py-2.5">
            <LivesDisplay lives={lives} currentLevel={currentLevel} lifeHitTick={lifeHitTick} />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ============================================
// BOTTOM BAR — Slide up synchronously & Smooth Gradient
// ============================================

function BottomBar({
  hintsRemaining,
  onHintClick,
  onMenuClick,
}: {
  hintsRemaining: number;
  onHintClick: () => void;
  onMenuClick: () => void;
}) {
  const disabled = hintsRemaining <= 0;

  return (
    // ВАЖНО: Убрали overflow-hidden, чтобы градиент мог "вытекать" наверх
    <div className="relative z-20 w-full mt-auto">
      {/* Сделали градиент выше (h-56) и добавили via-slate-950/40 
        для максимально плавного растворения в фон 
      */}
      <div className="absolute bottom-0 left-0 right-0 h-56 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent pointer-events-none -z-10" />

      {/* Анимируем ВЕСЬ контейнер с кнопками снизу вверх */}
      <motion.div 
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        className="flex justify-center items-center gap-4 px-6 pointer-events-auto"
        // Защита снизу для старых устройств
        style={{ paddingBottom: 'calc(max(env(safe-area-inset-bottom), 16px) + 24px)' }} 
      >
        {/* Menu button */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onMenuClick}
          className="bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.4)] shrink-0"
        >
          <span className="text-white/80 font-bold text-xs tracking-wider">MENU</span>
        </motion.button>

        {/* Hint button */}
        <motion.button
          whileTap={{ scale: 0.93 }}
          onClick={onHintClick}
          disabled={disabled}
          className={`
            flex-1 flex items-center justify-center gap-3
            py-4 rounded-2xl
            border 
            transition-all duration-200
            ${disabled
              ? 'bg-slate-800/50 border-white/5 opacity-50 shadow-none'
              : 'bg-gradient-to-b from-amber-500 to-orange-600 border-orange-400/30 shadow-[0_8px_24px_rgba(245,158,11,0.3)]'
            }
          `}
        >
          <Lightbulb
            size={24}
            className={disabled ? 'text-white/30' : 'text-yellow-100'}
          />
          <span
            className={`font-bold text-xl tabular-nums leading-none ${
              disabled ? 'text-white/30' : 'text-white'
            }`}
          >
            {hintsRemaining}
          </span>
        </motion.button>
      </motion.div>
    </div>
  );
}

// ============================================
// MAIN HUD LAYOUT
// ============================================

export function GameHUD({
  currentLevel,
  lives,
  difficulty,
  hintsRemaining,
  onHintClick,
  onMenuClick,
  children,
}: GameHUDProps) {
  const lifeHitTick = useGameStore(s => s.lifeHitTick);
  return (
    <div className="relative z-10 flex flex-col h-full mx-auto pointer-events-none overflow-hidden">
      <TopBar
        currentLevel={currentLevel}
        lives={lives}
        difficulty={difficulty}
        lifeHitTick={lifeHitTick}
      />

      <div className="flex-1 relative min-h-0 pointer-events-auto">
        {children}
      </div>

      <BottomBar
        hintsRemaining={hintsRemaining}
        onHintClick={onHintClick}
        onMenuClick={onMenuClick}
      />
    </div>
  );
}
