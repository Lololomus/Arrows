/**
 * Arrow Puzzle — Victory Screen
 *
 * Полноэкранный оверлей победы с:
 * - Difficulty-based FX (easy/normal/hard)
 * - Иконка с glow + float-анимацией (ОПТИМИЗИРОВАНО: радиальные градиенты без blur)
 * - Плашка уровня + difficulty badge
 * - Анимированный счётчик монет с shimmer
 * - Время прохождения
 * - CTA «Следующий» + ghost «В меню»
 */

import { motion } from 'framer-motion';
import { Zap, Coins, Timer } from 'lucide-react';

import { VictoryFX } from './VictoryFX';
import { AnimatedRewardCounter } from './AnimatedRewardCounter';
import {
  DIFFICULTY_CONFIG,
  getDifficultyTier,
  formatTime,
  type DifficultyTier,
  type DifficultyValue,
} from './difficultyConfig';

interface VictoryScreenProps {
  level: number;
  difficulty: DifficultyValue;
  timeSeconds: number;
  coinsEarned?: number;
  onNextLevel: () => void;
  onMenu: () => void;
}

export function VictoryScreen({
  level,
  difficulty,
  timeSeconds,
  coinsEarned,
  onNextLevel,
  onMenu,
}: VictoryScreenProps) {
  const tier: DifficultyTier = getDifficultyTier(difficulty);
  const cfg = DIFFICULTY_CONFIG[tier];
  const reward = coinsEarned ?? cfg.reward;
  const IconComponent = cfg.victoryIcon;

  return (
    <motion.div
      key={`victory-${tier}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex flex-col items-center justify-center p-6 bg-[#050B14]/70 backdrop-blur-lg overflow-hidden"
    >
      {/* Background FX */}
      <VictoryFX tier={tier} primary={cfg.primary} secondary={cfg.secondary} />

      <div className="flex flex-col items-center w-full relative z-10 mt-6">
        {/* ===== ИКОНКА ===== */}
        <motion.div
          initial={{ scale: 0, y: 50 }}
          animate={{ scale: cfg.scale, y: 0 }}
          transition={{
            type: 'spring',
            bounce: cfg.bounce,
            duration: 0.8,
          }}
          className="relative w-32 h-32 flex items-center justify-center mb-8"
        >
          {/* Big outer glow (ОПТИМИЗИРОВАНО: радиальный градиент вместо blur) */}
          <div
            className="absolute w-[250px] h-[250px] opacity-40 pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${cfg.primary} 0%, transparent 60%)`,
            }}
          />
          {/* Intense inner glow (ОПТИМИЗИРОВАНО) */}
          <div
            className="absolute w-[150px] h-[150px] opacity-70 pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${cfg.secondary} 0%, transparent 60%)`,
            }}
          />
          <motion.div
            animate={{ y: [-4, 4, -4] }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="relative z-10"
          >
            <IconComponent
              size={80}
              className={`${cfg.victoryIconColor} drop-shadow-[0_0_30px_rgba(255,255,255,0.7)]`}
            />
          </motion.div>
        </motion.div>

        {/* ===== ЗАГОЛОВОК ===== */}
        <motion.h2
          initial={{ y: 20, opacity: 0, scale: 0.8 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', bounce: 0.4 }}
          className={`text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b ${cfg.victoryTextGradient} mb-6 tracking-tighter uppercase text-center`}
          style={{ filter: 'drop-shadow(0px 4px 15px rgba(0,0,0,0.8))' }}
        >
          {cfg.victoryTitle}
        </motion.h2>

        {/* ===== ПЛАШКА УРОВНЯ + BADGE ===== */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex items-center gap-3 mb-5 bg-[#0a0f1d]/95 pl-5 pr-2 py-1.5 rounded-full border border-white/20 shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-xl"
        >
          <span className="text-white font-bold uppercase tracking-widest text-sm">
            Уровень {level}
          </span>
          <div className="w-px h-5 bg-white/20" />
          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full border ${cfg.badgeStyle} bg-opacity-30`}
          >
            <Zap size={12} fill="currentColor" />
            <span className="text-[10px] font-black uppercase tracking-widest text-white drop-shadow-md">
              {cfg.label}
            </span>
          </div>
        </motion.div>

        {/* ===== МОНЕТЫ ===== */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ delay: 0.5, type: 'spring' }}
          className="flex items-center gap-4 mb-6 bg-[#1a1b26]/95 border border-yellow-500/30 pl-2 pr-6 py-2.5 rounded-[20px] shadow-[0_0_20px_rgba(250,204,21,0.2)] relative overflow-hidden backdrop-blur-xl"
        >
          {/* Shimmer */}
          <motion.div
            className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-yellow-100/10 to-transparent skew-x-12"
            initial={{ left: '-100%' }}
            animate={{ left: '200%' }}
            transition={{
              duration: 1.5,
              ease: 'easeInOut',
              delay: 1.5,
              repeat: Infinity,
              repeatDelay: 3,
            }}
          />
          <div className="w-10 h-10 bg-gradient-to-br from-yellow-500/20 to-amber-600/20 border border-yellow-500/30 rounded-xl flex items-center justify-center relative z-10 shadow-inner">
            <Coins
              size={22}
              className="text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]"
            />
          </div>
          <div className="flex flex-col relative z-10">
            <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest leading-none mb-1.5">
              Получено монет
            </span>
            <span className="text-2xl font-black text-yellow-300 leading-none drop-shadow-[0_0_10px_rgba(250,204,21,0.4)] flex items-end">
              <span className="text-yellow-500 text-xl mr-0.5">+</span>
              <AnimatedRewardCounter reward={reward} delaySec={0.6} />
            </span>
          </div>
        </motion.div>

        {/* ===== ВРЕМЯ ===== */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="flex items-center gap-2 mb-10 text-white/80 bg-[#0a0f1d]/95 border border-white/20 shadow-[0_4px_20px_rgba(0,0,0,0.5)] px-4 py-2 rounded-xl backdrop-blur-xl"
        >
          <Timer size={16} className={cfg.headerColor} />
          <span className="text-sm tracking-wide">
            Время:{' '}
            <span className="font-mono text-white font-bold ml-1 text-base tracking-wider">
              {formatTime(timeSeconds)}
            </span>
          </span>
        </motion.div>

        {/* ===== КНОПКИ ===== */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2, duration: 0.5 }}
          className="w-full flex flex-col items-center gap-4 px-2 mt-2"
        >
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={onNextLevel}
            className={`w-full py-5 rounded-[20px] ${cfg.victoryButton} text-white font-black text-xl uppercase tracking-widest hover:brightness-110 transition-all border border-white/20 shadow-xl`}
          >
            Следующий
          </motion.button>

          <button
            onClick={onMenu}
            className="text-white/40 font-bold text-xs tracking-widest uppercase hover:text-white/80 transition-colors py-2 px-6"
          >
            Вернуться в меню
          </button>
        </motion.div>
      </div>
    </motion.div>
  );
}