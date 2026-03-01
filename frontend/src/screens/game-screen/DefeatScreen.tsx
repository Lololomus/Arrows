/**
 * Arrow Puzzle — Defeat Screen
 *
 * Полноэкранный оверлей поражения с:
 * - DefeatFX (красное дыхание + пепел + vignette)
 * - HeartCrack иконка с glow (ОПТИМИЗИРОВАНО: радиальный градиент вместо blur)
 * - Плашка «Уровень N — ПРОВАЛЕН»
 * - CTA «Revive» (через рекламу) + «Повторить» + ghost «В меню»
 */

import { motion } from 'framer-motion';
import { RefreshCcw, Play, Heart } from 'lucide-react';

import { DefeatFX } from './DefeatFX';
import { DEFEAT_CONFIG } from './difficultyConfig';

interface DefeatScreenProps {
  level: number;
  reviveAvailable: boolean;
  reviveLoading?: boolean;
  reviveMessage?: string | null;
  revivePending?: boolean;
  reviveRemaining?: number | null;
  reviveLimit?: number | null;
  onRevive: () => void;
  onRetry: () => void;
  onMenu: () => void;
}

export function DefeatScreen({
  level,
  reviveAvailable,
  reviveLoading,
  reviveMessage,
  revivePending,
  reviveRemaining,
  reviveLimit,
  onRevive,
  onRetry,
  onMenu,
}: DefeatScreenProps) {
  const cfg = DEFEAT_CONFIG;
  const IconComponent = cfg.icon;

  return (
    <motion.div
      key="defeat-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex flex-col items-center justify-center p-6 bg-[#050101]/80 backdrop-blur-lg overflow-hidden"
    >
      {/* Background FX */}
      <DefeatFX primary={cfg.primary} secondary={cfg.secondary} />

      <div className="flex flex-col items-center w-full relative z-10 mt-6">
        {/* ===== ИКОНКА ===== */}
        <motion.div
          initial={{ scale: 0, y: 50 }}
          animate={{ scale: 1.1, y: 0 }}
          transition={{ type: 'spring', bounce: 0.3, duration: 0.8 }}
          className="relative w-32 h-32 flex items-center justify-center mb-8"
        >
          {/* Glow (ОПТИМИЗИРОВАНО: радиальный градиент вместо blur) */}
          <div
            className="absolute w-[250px] h-[250px] opacity-30 pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${cfg.primary} 0%, transparent 60%)`,
            }}
          />
          <motion.div
            animate={{ y: [-3, 3, -3] }}
            transition={{
              duration: 5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="relative z-10"
          >
            <IconComponent
              size={80}
              className={`${cfg.iconColor} drop-shadow-[0_0_30px_rgba(220,38,38,0.5)]`}
            />
          </motion.div>
        </motion.div>

        {/* ===== ЗАГОЛОВОК ===== */}
        <motion.h2
          initial={{ y: 20, opacity: 0, scale: 0.8 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', bounce: 0.4 }}
          className={`text-4xl font-black text-transparent bg-clip-text bg-gradient-to-b ${cfg.textGradient} mb-6 tracking-tighter uppercase text-center leading-tight`}
          style={{ filter: 'drop-shadow(0px 4px 15px rgba(0,0,0,0.8))' }}
        >
          {cfg.title}
        </motion.h2>

        {/* ===== ПЛАШКА УРОВНЯ ===== */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex items-center gap-3 mb-10 bg-[#1a0505]/95 pl-5 pr-2 py-1.5 rounded-full border border-red-500/20 shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-xl"
        >
          <span className="text-white font-bold uppercase tracking-widest text-sm">
            Уровень {level}
          </span>
          <div className="w-px h-5 bg-red-500/20" />
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full border bg-red-500/10 border-red-500/30 text-red-400">
            <span className="text-[10px] font-black uppercase tracking-widest drop-shadow-md">
              ПРОВАЛЕН
            </span>
          </div>
        </motion.div>

        {/* ===== КНОПКИ ===== */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="w-full flex flex-col items-center gap-4 px-2 mt-8"
        >
          {reviveLimit != null && reviveRemaining != null && (
            <p className="text-sm font-semibold text-white/65">
              Осталось воскрешений: {reviveRemaining}/{reviveLimit}
            </p>
          )}

          {/* Revive через рекламу */}
          {reviveAvailable && (
            <>
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={onRevive}
                disabled={reviveLoading}
                className="w-full py-5 rounded-[20px] bg-gradient-to-b from-emerald-500 to-emerald-700 text-white font-black text-xl uppercase tracking-widest hover:brightness-110 transition-all border border-emerald-400/30 shadow-xl flex items-center justify-center gap-3 disabled:opacity-50"
              >
                <Heart size={22} fill="currentColor" />
                {reviveLoading ? 'Загрузка...' : revivePending ? 'Проверить награду' : 'Продолжить'}
                {!reviveLoading && <Play size={16} className="opacity-70" />}
              </motion.button>
              {reviveMessage && (
                <p className="text-center text-sm font-medium text-white/75">{reviveMessage}</p>
              )}
            </>
          )}

          {!reviveAvailable && reviveMessage && (
            <p className="text-center text-sm font-medium text-white/75">{reviveMessage}</p>
          )}

          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={onRetry}
            className={`w-full py-5 rounded-[20px] ${cfg.button} text-white font-black text-xl uppercase tracking-widest hover:brightness-110 transition-all border border-red-400/30 shadow-xl flex items-center justify-center gap-3`}
          >
            <RefreshCcw size={24} className="opacity-80" strokeWidth={3} />
            Повторить
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
