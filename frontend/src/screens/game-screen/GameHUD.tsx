/**
 * Arrow Puzzle — Game HUD (v6 - Centered Top & Balanced Bottom)
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
// LIVES DISPLAY (Status only, non-clickable)
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
    <div className="flex items-center gap-2">
      <motion.div
        initial={false}
        animate={
          isHit
            ? { x: [0, -4, 4, -3, 3, 0], scale: [1, 1.4, 0.9, 1.2, 1] }
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
          size={18}
          fill="#ef4444"
          stroke="none"
          className="drop-shadow-[0_0_6px_rgba(239,68,68,0.7)]"
        />
      </motion.div>

      <motion.span
        initial={false}
        animate={isHit ? { scale: [1, 1.25, 1] } : { scale: 1 }}
        transition={isHit ? { duration: 0.35, ease: 'easeOut' } : { duration: 0.15 }}
        className={`text-base font-bold tabular-nums leading-none ${numberColor}`}
      >
        ×{lives}
      </motion.span>
    </div>
  );
}

// ============================================
// TOP BAR — Level & Difficulty (Centered Stack)
// ============================================

function TopBar({
  currentLevel,
  difficulty,
}: {
  currentLevel: number;
  difficulty: DifficultyValue;
}) {
  const cfg = getDifficultyConfig(difficulty);

  return (
    <div className="relative z-20 w-full">
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-slate-950/70 to-transparent pointer-events-none -z-10" />

      <div 
        className="flex flex-col items-center gap-2 pointer-events-auto"
        // ПРИПОДНЯЛИ ВЕРХ: уменьшили базовый отступ с 48px до 16px
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 16px) + 8px)' }} 
      >
        {/* Блок Уровня — СДЕЛАЛИ БОЛЬШЕ */}
        <motion.div
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          className="bg-slate-900/90 backdrop-blur-md rounded-full px-6 py-2.5 border border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.6)] flex items-center gap-3"
        >
          <span className="text-white/50 text-xs font-bold uppercase tracking-widest leading-none mt-0.5">
            LVL
          </span>
          <span className="text-white font-black text-2xl leading-none tabular-nums">
            {currentLevel}
          </span>
        </motion.div>

        {/* Блок Сложности — СДЕЛАЛИ КРУПНЕЕ */}
        <motion.div
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.05 }}
          className="bg-slate-900/70 backdrop-blur-md rounded-full px-4 py-1.5 border border-white/10 flex items-center gap-2"
        >
          <div className={`w-2 h-2 rounded-full ${cfg.hudDotColor} shadow-[0_0_8px_currentColor]`} />
          <span className={`text-xs font-bold uppercase tracking-wider leading-none mt-px ${cfg.hudBadgeColor}`}>
            {cfg.label}
          </span>
        </motion.div>
      </div>
    </div>
  );
}

// ============================================
// BOTTOM BAR — Menu + Lives + Hints
// ============================================

function BottomBar({
  hintsRemaining,
  lives,
  currentLevel,
  lifeHitTick,
  onHintClick,
  onMenuClick,
}: {
  hintsRemaining: number;
  lives: number;
  currentLevel: number;
  lifeHitTick: number;
  onHintClick: () => void;
  onMenuClick: () => void;
}) {
  const disabled = hintsRemaining <= 0;

  return (
    <div className="relative z-20 w-full mt-auto">
      <div className="absolute bottom-0 left-0 right-0 h-56 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent pointer-events-none -z-10" />

      <motion.div 
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        className="flex items-stretch justify-between gap-3 px-4 pointer-events-auto max-w-md mx-auto"
        style={{ paddingBottom: 'calc(max(env(safe-area-inset-bottom), 16px) + 24px)' }} 
      >
        {/* 1. Кнопка Меню */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onMenuClick}
          className="bg-slate-800/90 backdrop-blur-md px-5 py-4 rounded-2xl border border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.4)] shrink-0 flex items-center justify-center"
        >
          <span className="text-white/90 font-bold text-xs tracking-wider">MENU</span>
        </motion.button>

        {/* 2. Статус Жизней — ТЕПЕРЬ ПЛОТНЫЙ ФОН КАК У МЕНЮ */}
        <div className="bg-slate-800/90 backdrop-blur-md rounded-2xl border border-white/10 shrink-0 px-6 flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.2)]">
          <LivesDisplay lives={lives} currentLevel={currentLevel} lifeHitTick={lifeHitTick} />
        </div>

        {/* 3. Кнопка Подсказки */}
        <motion.button
          whileTap={{ scale: 0.93 }}
          onClick={onHintClick}
          disabled={disabled}
          className={`
            flex-1 flex items-center justify-center gap-2.5
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
            size={22}
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
  // Достаем тик попадания по жизням для анимации
  const lifeHitTick = useGameStore(s => s.lifeHitTick);
  
  return (
    <div className="relative z-10 flex flex-col h-full mx-auto pointer-events-none overflow-hidden">
      <TopBar
        currentLevel={currentLevel}
        difficulty={difficulty}
      />

      <div className="flex-1 relative min-h-0 pointer-events-auto">
        {children}
      </div>

      <BottomBar
        hintsRemaining={hintsRemaining}
        lives={lives}
        currentLevel={currentLevel}
        lifeHitTick={lifeHitTick}
        onHintClick={onHintClick}
        onMenuClick={onMenuClick}
      />
    </div>
  );
}