/**
 * Arrow Puzzle — Victory Screen (OPTIMIZED)
 *
 * Изменения:
 * 1. Кнопка «Следующий» имеет 4 состояния: idle / saving / loading / error
 * 2. При ошибке — inline retry, victory-экран НЕ пропадает
 * 3. Loader с задержкой 150ms (не мелькает на быстрых ответах)
 * 4. Подпись «Проверяем решение...» после 1 сек ожидания
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Coins, Timer, Loader2, AlertCircle, RotateCcw } from 'lucide-react';

import { VictoryFX } from './VictoryFX';
import { AnimatedRewardCounter } from './AnimatedRewardCounter';
import {
  DIFFICULTY_CONFIG,
  getDifficultyTier,
  formatTime,
  type DifficultyTier,
  type DifficultyValue,
} from './difficultyConfig';

export type NextButtonState = 'idle' | 'saving' | 'loading' | 'error';
export type PendingVictoryAction = 'next' | 'menu' | null;

interface VictoryScreenProps {
  level: number;
  difficulty: DifficultyValue;
  timeSeconds: number;
  coinsEarned?: number;
  totalCoins?: number;
  /** Состояние кнопки «Следующий» (управляется из GameScreen) */
  nextButtonState?: NextButtonState;
  pendingAction?: PendingVictoryAction;
  /** Текст ошибки (если nextButtonState === 'error') */
  nextButtonError?: string | null;
  onNextLevel: () => void;
  onRetry?: () => void;
  onMenu: () => void;
}

/** Текст кнопки по состоянию */
function getButtonLabel(state: NextButtonState, elapsed: number): string {
  switch (state) {
    case 'saving':
      return elapsed > 1000 ? 'Проверяем решение...' : 'Сохраняем...';
    case 'loading':
      return 'Открываем уровень...';
    case 'error':
      return 'Повторить';
    default:
      return 'Следующий';
  }
}

function getHelperText(state: NextButtonState, pendingAction: PendingVictoryAction): string | null {
  if (state === 'saving' && pendingAction === 'next') return 'Откроем следующий уровень после сохранения';
  if (state === 'saving' && pendingAction === 'menu') return 'Вернёмся в меню после сохранения';
  if (state === 'saving') return 'Сохраняем прогресс...';
  return null;
}

export function VictoryScreen({
  level,
  difficulty,
  timeSeconds,
  coinsEarned,
  totalCoins,
  nextButtonState = 'idle',
  pendingAction = null,
  nextButtonError = null,
  onNextLevel,
  onRetry,
  onMenu,
}: VictoryScreenProps) {
  const [showTotal, setShowTotal] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);
  const [stateElapsed, setStateElapsed] = useState(0);
  const stateStartRef = useRef(Date.now());

  const tier: DifficultyTier = getDifficultyTier(difficulty);
  const cfg = DIFFICULTY_CONFIG[tier];
  const reward = coinsEarned ?? cfg.reward;
  const IconComponent = cfg.victoryIcon;

  const isBusy = nextButtonState === 'saving' || nextButtonState === 'loading';
  const isError = nextButtonState === 'error';
  const helperText = getHelperText(nextButtonState, pendingAction);

  // Задержка спиннера 150ms — не мелькает на быстрых ответах
  useEffect(() => {
    if (!isBusy) {
      setShowSpinner(false);
      setStateElapsed(0);
      return;
    }
    stateStartRef.current = Date.now();

    const spinnerTimer = setTimeout(() => setShowSpinner(true), 150);
    const elapsed_interval = setInterval(() => {
      setStateElapsed(Date.now() - stateStartRef.current);
    }, 300);

    return () => {
      clearTimeout(spinnerTimer);
      clearInterval(elapsed_interval);
    };
  }, [isBusy]);

  const handleClick = () => {
    if (isBusy) return; // prevent double-tap
    if (isError && onRetry) {
      onRetry();
    } else {
      onNextLevel();
    }
  };

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
          transition={{ type: 'spring', bounce: cfg.bounce, duration: 0.8 }}
          className="relative w-32 h-32 flex items-center justify-center mb-8"
        >
          <div
            className="absolute w-[250px] h-[250px] opacity-40 pointer-events-none"
            style={{ background: `radial-gradient(circle, ${cfg.primary} 0%, transparent 60%)` }}
          />
          <div
            className="absolute w-[150px] h-[150px] opacity-70 pointer-events-none"
            style={{ background: `radial-gradient(circle, ${cfg.secondary} 0%, transparent 60%)` }}
          />
          <motion.div
            animate={{ y: [-4, 4, -4] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
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
            className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-yellow-100/10 to-transparent skew-x-12 pointer-events-none"
            initial={{ left: '-100%' }}
            animate={{ left: '200%' }}
            transition={{ duration: 1.5, ease: 'easeInOut', delay: 1.5, repeat: Infinity, repeatDelay: 3 }}
          />
          <div className="w-10 h-10 shrink-0 bg-gradient-to-br from-yellow-500/20 to-amber-600/20 border border-yellow-500/30 rounded-xl flex items-center justify-center relative z-10 shadow-inner">
            <Coins size={22} className="text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]" />
          </div>
          <div className="flex flex-col relative z-10 min-w-[110px]">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest leading-none mb-1.5">
                Получено монет
              </span>
              <span className="text-2xl font-black text-yellow-300 leading-none drop-shadow-[0_0_10px_rgba(250,204,21,0.4)] flex items-end">
                <span className="text-yellow-500 text-xl mr-0.5">+</span>
                <AnimatedRewardCounter reward={reward} delaySec={0.6} onDone={() => setShowTotal(true)} />
              </span>
            </div>
            <AnimatePresence>
              {showTotal && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  transition={{ duration: 0.4, type: 'spring', bounce: 0.3 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 pt-2 border-t border-yellow-500/20 flex flex-col gap-1">
                    <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest leading-none">
                      Текущий баланс
                    </span>
                    <span className="text-sm font-black text-yellow-500 flex items-center gap-1.5 leading-none">
                      {totalCoins?.toLocaleString('ru-RU') ?? '---'} <Coins size={12} className="opacity-80" />
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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
          {helperText && (
            <div className="w-full px-3 text-center text-[11px] font-semibold tracking-wide text-white/65">
              {helperText}
            </div>
          )}
          {/* === ОШИБКА (inline, НЕ пропадает victory) === */}
          <AnimatePresence>
            {isError && nextButtonError && (
              <motion.div
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -8, height: 0 }}
                className="w-full flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-950/60 border border-red-500/30 backdrop-blur-xl overflow-hidden"
              >
                <AlertCircle size={16} className="text-red-400 shrink-0" />
                <span className="text-red-200 text-xs font-medium leading-tight">
                  {nextButtonError}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* === ГЛАВНАЯ КНОПКА === */}
          <motion.button
            whileTap={isBusy ? undefined : { scale: 0.96 }}
            onClick={handleClick}
            disabled={isBusy}
            className={`
              w-full py-5 rounded-[20px] text-white font-black text-xl uppercase tracking-widest
              transition-all border border-white/20 shadow-xl
              flex items-center justify-center gap-3
              ${isBusy
                ? 'bg-white/10 cursor-wait'
                : isError
                  ? 'bg-gradient-to-b from-red-600 to-red-700 hover:brightness-110'
                  : `${cfg.victoryButton} hover:brightness-110`
              }
            `}
          >
            {/* Спиннер (с задержкой 150ms) */}
            <AnimatePresence mode="wait">
              {isBusy && showSpinner && (
                <motion.span
                  key="spinner"
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                >
                  <Loader2 size={22} className="animate-spin" />
                </motion.span>
              )}
              {isError && (
                <motion.span
                  key="retry-icon"
                  initial={{ opacity: 0, rotate: -90 }}
                  animate={{ opacity: 1, rotate: 0 }}
                >
                  <RotateCcw size={20} />
                </motion.span>
              )}
            </AnimatePresence>

            {/* Текст */}
            <span className={isBusy ? 'text-lg' : ''}>
              {getButtonLabel(nextButtonState, stateElapsed)}
            </span>
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
