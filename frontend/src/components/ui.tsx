/**
 * Arrow Puzzle - UI Components
 * 
 * Переиспользуемые UI компоненты.
 */

import React, { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ============================================
// HEADER
// ============================================

interface HeaderProps {
  title?: string;
  coins?: number;
  energy?: number;
  maxEnergy?: number;
  onBack?: () => void;
  rightAction?: ReactNode;
}

export function Header({
  title,
  coins,
  energy,
  maxEnergy = 5,
  onBack,
  rightAction,
}: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-900/50 to-blue-900/50 backdrop-blur-md">
      {/* Left */}
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        {title && (
          <h1 className="text-xl font-bold text-white">{title}</h1>
        )}
      </div>
      
      {/* Center - Stats */}
      <div className="flex items-center gap-4">
        {coins !== undefined && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-yellow-500/20">
            <span className="text-lg">🪙</span>
            <span className="font-semibold text-yellow-400">{coins.toLocaleString()}</span>
          </div>
        )}
        {energy !== undefined && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/20">
            <span className="text-lg">⚡</span>
            <span className="font-semibold text-blue-400">{energy}/{maxEnergy}</span>
          </div>
        )}
      </div>
      
      {/* Right */}
      <div className="flex items-center">
        {rightAction}
      </div>
    </header>
  );
}

// ============================================
// GAME CONTROLS
// ============================================

interface GameControlsProps {
  lives: number;
  maxLives: number;
  level: number;
  onUndo: () => void;
  onHint: () => void;
  onRestart: () => void;
  canUndo: boolean;
  hintsLeft?: number;
}

export function GameControls({
  lives,
  maxLives,
  level,
  onUndo,
  onHint,
  onRestart,
  canUndo,
  hintsLeft = 3,
}: GameControlsProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      {/* Lives */}
      <div className="flex items-center gap-1">
        {Array.from({ length: maxLives }).map((_, i) => (
          <motion.span
            key={i}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className={`text-2xl ${i < lives ? '' : 'opacity-30 grayscale'}`}
          >
            ❤️
          </motion.span>
        ))}
      </div>
      
      {/* Level */}
      <div className="flex flex-col items-center">
        <span className="text-sm text-white/60">Уровень</span>
        <span className="text-2xl font-bold text-white">{level}</span>
      </div>
      
      {/* Actions */}
      <div className="flex items-center gap-2">
        <ControlButton
          icon="↩️"
          onClick={onUndo}
          disabled={!canUndo}
          tooltip="Отмена"
        />
        <ControlButton
          icon="💡"
          onClick={onHint}
          badge={hintsLeft > 0 ? hintsLeft : undefined}
          tooltip="Подсказка"
        />
        <ControlButton
          icon="🔄"
          onClick={onRestart}
          tooltip="Рестарт"
        />
      </div>
    </div>
  );
}

interface ControlButtonProps {
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  badge?: number;
  tooltip?: string;
}

function ControlButton({ icon, onClick, disabled, badge, tooltip }: ControlButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={`
        relative w-12 h-12 flex items-center justify-center rounded-xl
        bg-white/10 hover:bg-white/20 active:scale-95
        transition-all duration-150
        ${disabled ? 'opacity-40 pointer-events-none' : ''}
      `}
    >
      <span className="text-xl">{icon}</span>
      {badge !== undefined && (
        <span className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center rounded-full bg-purple-500 text-xs font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

// ============================================
// MODAL
// ============================================

interface ModalProps {
  isOpen: boolean;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
}

export function Modal({ isOpen, onClose, children, className = '' }: ModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
          />
          
          {/* Content */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className={`relative bg-gradient-to-br from-purple-900 to-blue-900 rounded-2xl shadow-2xl ${className}`}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ============================================
// VICTORY MODAL
// ============================================

interface VictoryModalProps {
  isOpen: boolean;
  level: number;
  stars: number;
  coins: number;
  onNext: () => void;
  onReplay: () => void;
  onHome: () => void;
  onDouble?: () => void;
}

export function VictoryModal({
  isOpen,
  level,
  stars,
  coins,
  onNext,
  onReplay,
  onHome,
  onDouble,
}: VictoryModalProps) {
  return (
    <Modal isOpen={isOpen} className="w-full max-w-sm p-6">
      <div className="text-center">
        {/* Title */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-4xl font-bold text-white mb-2"
        >
          🎉 Победа!
        </motion.div>
        
        {/* Level */}
        <p className="text-white/60 mb-6">Уровень {level} пройден</p>
        
        {/* Stars */}
        <div className="flex justify-center gap-2 mb-6">
          {[1, 2, 3].map((i) => (
            <motion.span
              key={i}
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: i * 0.2 }}
              className={`text-5xl ${i <= stars ? '' : 'grayscale opacity-30'}`}
            >
              ⭐
            </motion.span>
          ))}
        </div>
        
        {/* Reward */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.6 }}
          className="flex items-center justify-center gap-2 mb-6"
        >
          <span className="text-2xl">🪙</span>
          <span className="text-3xl font-bold text-yellow-400">+{coins}</span>
        </motion.div>
        
        {/* Double reward */}
        {onDouble && (
          <button
            onClick={onDouble}
            className="w-full mb-4 py-3 rounded-xl bg-gradient-to-r from-yellow-500 to-orange-500 text-white font-bold flex items-center justify-center gap-2 hover:brightness-110 transition-all"
          >
            <span>📺</span>
            <span>Удвоить за рекламу</span>
          </button>
        )}
        
        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onHome}
            className="flex-1 py-3 rounded-xl bg-white/10 text-white font-semibold hover:bg-white/20 transition-colors"
          >
            🏠 Меню
          </button>
          <button
            onClick={onReplay}
            className="flex-1 py-3 rounded-xl bg-white/10 text-white font-semibold hover:bg-white/20 transition-colors"
          >
            🔄 Ещё раз
          </button>
          <button
            onClick={onNext}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold hover:brightness-110 transition-all"
          >
            Далее ➡️
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================
// GAME OVER MODAL
// ============================================

interface GameOverModalProps {
  isOpen: boolean;
  level: number;
  onRetry: () => void;
  onHome: () => void;
  onExtraLife?: () => void;
}

export function GameOverModal({
  isOpen,
  level,
  onRetry,
  onHome,
  onExtraLife,
}: GameOverModalProps) {
  return (
    <Modal isOpen={isOpen} className="w-full max-w-sm p-6">
      <div className="text-center">
        {/* Title */}
        <motion.div
          initial={{ scale: 1.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-4xl font-bold text-red-400 mb-2"
        >
          💔 Поражение
        </motion.div>
        
        <p className="text-white/60 mb-6">Уровень {level}</p>
        
        {/* Animation */}
        <motion.div
          animate={{ rotate: [0, -10, 10, -10, 0] }}
          transition={{ duration: 0.5 }}
          className="text-6xl mb-6"
        >
          😢
        </motion.div>
        
        {/* Extra life */}
        {onExtraLife && (
          <button
            onClick={onExtraLife}
            className="w-full mb-4 py-3 rounded-xl bg-gradient-to-r from-red-500 to-pink-500 text-white font-bold flex items-center justify-center gap-2 hover:brightness-110 transition-all"
          >
            <span>📺</span>
            <span>+1 жизнь за рекламу</span>
          </button>
        )}
        
        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onHome}
            className="flex-1 py-3 rounded-xl bg-white/10 text-white font-semibold hover:bg-white/20 transition-colors"
          >
            🏠 Меню
          </button>
          <button
            onClick={onRetry}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold hover:brightness-110 transition-all"
          >
            🔄 Попробовать снова
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================
// NO ENERGY MODAL
// ============================================

interface NoEnergyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onWatchAd: () => void;
  onBuy: () => void;
  secondsToNext: number;
}

export function NoEnergyModal({
  isOpen,
  onClose,
  onWatchAd,
  onBuy,
  secondsToNext,
}: NoEnergyModalProps) {
  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} className="w-full max-w-sm p-6">
      <div className="text-center">
        <div className="text-5xl mb-4">⚡</div>
        <h2 className="text-2xl font-bold text-white mb-2">Нет энергии</h2>
        <p className="text-white/60 mb-4">
          Следующая через {formatTime(secondsToNext)}
        </p>
        
        <div className="space-y-3">
          <button
            onClick={onWatchAd}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold flex items-center justify-center gap-2"
          >
            <span>📺</span>
            <span>Смотреть рекламу</span>
          </button>
          
          <button
            onClick={onBuy}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold flex items-center justify-center gap-2"
          >
            <span>⭐</span>
            <span>Купить энергию</span>
          </button>
          
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-white/10 text-white font-semibold"
          >
            Подождать
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================
// BUTTON
// ============================================

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  className?: string;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  icon,
  className = '',
}: ButtonProps) {
  const variants = {
    primary: 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:brightness-110',
    secondary: 'bg-white/10 text-white hover:bg-white/20',
    ghost: 'bg-transparent text-white hover:bg-white/10',
  };
  
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5',
    lg: 'px-6 py-3 text-lg',
  };
  
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        flex items-center justify-center gap-2 rounded-xl font-semibold
        transition-all duration-150 active:scale-95
        ${variants[variant]}
        ${sizes[size]}
        ${disabled ? 'opacity-50 pointer-events-none' : ''}
        ${className}
      `}
    >
      {loading ? (
        <span className="animate-spin">⏳</span>
      ) : icon ? (
        <span>{icon}</span>
      ) : null}
      {children}
    </button>
  );
}

// ============================================
// LOADER
// ============================================

export function Loader({ text = 'Загрузка...' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        className="text-5xl mb-4"
      >
        🎯
      </motion.div>
      <p className="text-white/60">{text}</p>
    </div>
  );
}

// ============================================
// STAT CARD
// ============================================

interface StatCardProps {
  icon: string;
  value: string | number;
  label: string;
  color?: string;
}

export function StatCard({ icon, value, label, color = 'purple' }: StatCardProps) {
  const colors = {
    purple: 'from-purple-500/20 to-purple-600/20 border-purple-500/30',
    blue: 'from-blue-500/20 to-blue-600/20 border-blue-500/30',
    green: 'from-green-500/20 to-green-600/20 border-green-500/30',
    yellow: 'from-yellow-500/20 to-yellow-600/20 border-yellow-500/30',
  };
  
  return (
    <div className={`p-4 rounded-xl bg-gradient-to-br border ${colors[color as keyof typeof colors]}`}>
      <div className="flex items-center gap-3">
        <span className="text-3xl">{icon}</span>
        <div>
          <div className="text-2xl font-bold text-white">{value}</div>
          <div className="text-sm text-white/60">{label}</div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// PROGRESS BAR
// ============================================

interface ProgressBarProps {
  value: number;
  max: number;
  color?: string;
  showLabel?: boolean;
}

export function ProgressBar({ value, max, color = 'purple', showLabel = true }: ProgressBarProps) {
  const percentage = Math.min((value / max) * 100, 100);
  
  const colors = {
    purple: 'from-purple-500 to-pink-500',
    blue: 'from-blue-500 to-cyan-500',
    green: 'from-green-500 to-emerald-500',
    yellow: 'from-yellow-500 to-orange-500',
  };
  
  return (
    <div className="w-full">
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          className={`h-full bg-gradient-to-r ${colors[color as keyof typeof colors]} rounded-full`}
        />
      </div>
      {showLabel && (
        <div className="flex justify-between mt-1 text-xs text-white/60">
          <span>{value}</span>
          <span>{max}</span>
        </div>
      )}
    </div>
  );
}
