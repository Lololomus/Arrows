/**
 * SpinScreen — ежедневная рулетка.
 * Сервер определяет результат, клиент анимирует колесо на нужный сектор.
 * v5: roll → (retry?) → collect flow. Приз начисляется только при нажатии "Забрать".
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, animate, useAnimation, AnimatePresence } from 'framer-motion';
import { Info, RotateCcw } from 'lucide-react';
import { useAppStore } from '../stores/store';
import { spinApi, type SpinRollResponse, ApiError } from '../api/client';
import { ADSGRAM_BLOCK_IDS } from '../config/constants';
import { exists, formatNumber, formatTimeUntil, getAppLocale, translate } from '../i18n';
import { runRewardedFlow, getRewardedFlowMessage } from '../services/rewardedAds';
import { clearPendingRewardIntent, rememberPendingRewardIntent } from '../services/rewardReconciler';

// ============================================
// TELEGRAM HAPTICS
// ============================================
const triggerHaptic = (style: 'light' | 'medium' | 'heavy' | 'success') => {
  const tg = (window as any).Telegram?.WebApp;
  if (!tg?.HapticFeedback) return;

  if (style === 'success') {
    tg.HapticFeedback.notificationOccurred('success');
  } else {
    tg.HapticFeedback.impactOccurred(style);
  }
};

// ============================================
// КОНФИГУРАЦИЯ РЕДКОСТИ И СЕКТОРОВ
// ============================================

type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

interface Sector {
  label: string;
  wheelLabel: string;
  icon: string;
  color: string;
  rarity: Rarity;
  prizeType: 'coins' | 'hints' | 'revive';
  prizeAmount: number;
}

interface ExtendedSpinResult extends SpinRollResponse, Omit<Sector, 'prizeType' | 'prizeAmount'> {}

const RARITY_CONFIG: Record<Rarity, { color: string; bg: string; glow: string; labelKey: string; particles: string[] }> = {
  common: {
    color: 'text-emerald-400',
    bg: 'from-emerald-500 to-teal-400',
    glow: 'rgba(16,185,129,0.4)',
    labelKey: 'game:spin.rarity.common',
    particles: ['#34d399', '#10b981', '#059669', '#ffffff']
  },
  uncommon: {
    color: 'text-blue-400',
    bg: 'from-blue-500 to-cyan-400',
    glow: 'rgba(59,130,246,0.4)',
    labelKey: 'game:spin.rarity.uncommon',
    particles: ['#60a5fa', '#3b82f6', '#2563eb', '#ffffff']
  },
  rare: {
    color: 'text-purple-400',
    bg: 'from-purple-500 to-fuchsia-400',
    glow: 'rgba(168,85,247,0.5)',
    labelKey: 'game:spin.rarity.rare',
    particles: ['#c084fc', '#a855f7', '#9333ea', '#f0abfc']
  },
  epic: {
    color: 'text-amber-400',
    bg: 'from-amber-500 to-orange-400',
    glow: 'rgba(245,158,11,0.6)',
    labelKey: 'game:spin.rarity.epic',
    particles: ['#fbbf24', '#f59e0b', '#d97706', '#fcd34d', '#ffffff']
  },
  legendary: {
    color: 'text-rose-400',
    bg: 'from-rose-500 to-red-500',
    glow: 'rgba(225,29,72,0.7)',
    labelKey: 'game:spin.rarity.legendary',
    particles: ['#fb7185', '#e11d48', '#be123c', '#fda4af', '#ffffff']
  },
};

// Порядок секторов на колесе
const COIN_SECTOR_COLOR = '#f59e0b';
const HINT_SECTOR_COLOR = '#06b6d4';
const REVIVE_SECTOR_COLOR = '#f43f5e';

const SECTORS: Sector[] = [
  { label: '10 coins',      wheelLabel: '🪙 10',  icon: '🪙', color: COIN_SECTOR_COLOR,   rarity: 'common',    prizeType: 'coins',  prizeAmount: 10  },
  { label: '25 coins',      wheelLabel: '🪙 25',  icon: '🪙', color: COIN_SECTOR_COLOR,   rarity: 'common',    prizeType: 'coins',  prizeAmount: 25  },
  { label: '1 hint',        wheelLabel: '💡 1',   icon: '💡', color: HINT_SECTOR_COLOR,   rarity: 'uncommon',  prizeType: 'hints',  prizeAmount: 1   },
  { label: '50 coins',      wheelLabel: '🪙 50',  icon: '🪙', color: COIN_SECTOR_COLOR,   rarity: 'uncommon',  prizeType: 'coins',  prizeAmount: 50  },
  { label: '100 coins',     wheelLabel: '🪙 100', icon: '🪙', color: COIN_SECTOR_COLOR,   rarity: 'rare',      prizeType: 'coins',  prizeAmount: 100 },
  { label: '3 hints',       wheelLabel: '💡 3',   icon: '💡', color: HINT_SECTOR_COLOR,   rarity: 'rare',      prizeType: 'hints',  prizeAmount: 3   },
  { label: '250 coins',     wheelLabel: '🪙 250', icon: '🪙', color: COIN_SECTOR_COLOR,   rarity: 'epic',      prizeType: 'coins',  prizeAmount: 250 },
  { label: '1 revive',      wheelLabel: '❤️ 1',  icon: '❤️', color: REVIVE_SECTOR_COLOR, rarity: 'legendary', prizeType: 'revive', prizeAmount: 1   },
];

const SECTOR_COUNT = SECTORS.length;
const SECTOR_ANGLE = 360 / SECTOR_COUNT;

function formatTimeLeft(targetIso: string | null, nowTs: number): string | null {
  return formatTimeUntil(targetIso, nowTs);
}

function getPluralSuffix(count: number): 'one' | 'few' | 'many' | 'other' {
  const locale = getAppLocale();
  if (locale === 'ru') {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return 'one';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
    return 'many';
  }
  return count === 1 ? 'one' : 'other';
}

function getRarityLabel(rarity: Rarity): string {
  return translate(RARITY_CONFIG[rarity].labelKey);
}

function formatSpinPrizeLabel(prizeType: Sector['prizeType'], prizeAmount: number): string {
  const count = formatNumber(prizeAmount);
  const suffix = getPluralSuffix(prizeAmount);

  switch (prizeType) {
    case 'coins':
      return translate(`game:spin.prizeLabel.coins_${suffix}`, { count });
    case 'hints':
      return translate(`game:spin.prizeLabel.hints_${suffix}`, { count });
    case 'revive':
      return translate(`game:spin.prizeLabel.revive_${suffix}`, { count });
    default:
      return `${count}`;
  }
}

function formatTierBadge(tier: number): string {
  return translate('game:spin.tierBadge', { count: tier });
}

// ============================================
// УТИЛИТЫ ДЛЯ SVG
// ============================================

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function sectorPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const s = polarToCartesian(cx, cy, r, startAngle);
  const e = polarToCartesian(cx, cy, r, endAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`;
}

function getSectorFill(sector: Sector): string {
  if (sector.prizeType === 'coins') {
    if (sector.prizeAmount >= 250) return '#fbbf24';
    if (sector.prizeAmount >= 100 || sector.prizeAmount === 10) return '#d97706';
    return '#f59e0b';
  }

  if (sector.prizeType === 'hints') {
    return sector.prizeAmount >= 3 ? '#0891b2' : '#06b6d4';
  }

  return '#f43f5e';
}

function getSectorAmountFontSize(amount: number): number {
  if (amount >= 100) return 18;
  if (amount >= 10) return 22;
  return 24;
}

// ============================================
// ИНФО МОДАЛКА (ОПИСАНИЕ ТИРОВ)
// ============================================

function SpinInfoModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm z-[100]"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(e, info) => {
              if (info.offset.y > 60 || info.velocity.y > 500) onClose();
            }}
            className="absolute bottom-0 left-0 right-0 z-[101] bg-[#14162a] rounded-t-[32px] border-t border-white/10 p-6 shadow-[0_-10px_50px_rgba(0,0,0,0.6)] flex flex-col"
            style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 20px))' }}
          >
            <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-6 shrink-0" />
            <h3 className="text-2xl font-black text-white uppercase tracking-wide mb-6 text-center drop-shadow-md">
              {translate('game:spin.tiersTitle')}
            </h3>

            <div className="space-y-3 overflow-y-auto custom-scrollbar">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-emerald-400 font-black text-sm uppercase tracking-widest drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]">{formatTierBadge(1)}</span>
                  <span className="text-white/50 text-[11px] font-bold bg-white/5 px-2 py-1 rounded-md">0-5</span>
                </div>
                <h4 className="text-white font-bold mb-1 text-base">{translate('game:spin.tier1Label')}</h4>
                <p className="text-white/50 text-xs leading-relaxed">{translate('game:spin.tier1Desc')}</p>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-blue-400 font-black text-sm uppercase tracking-widest drop-shadow-[0_0_8px_rgba(96,165,250,0.3)]">{formatTierBadge(2)}</span>
                  <span className="text-blue-200/50 text-[11px] font-bold bg-blue-500/10 px-2 py-1 rounded-md">6-13</span>
                </div>
                <h4 className="text-white font-bold mb-1 text-base">{translate('game:spin.tier2Label')}</h4>
                <p className="text-blue-100/60 text-xs leading-relaxed">{translate('game:spin.tier2Desc')}</p>
              </div>

              <div className="bg-gradient-to-br from-yellow-500/20 to-orange-500/10 border border-yellow-500/30 rounded-2xl p-4 relative overflow-hidden">
                <div className="flex justify-between items-center mb-2 relative z-10">
                  <span className="text-yellow-400 font-black text-sm uppercase tracking-widest drop-shadow-[0_0_12px_rgba(250,204,21,0.5)]">{formatTierBadge(3)}</span>
                  <span className="text-yellow-200/60 text-[11px] font-bold bg-yellow-500/10 px-2 py-1 rounded-md">14+</span>
                </div>
                <h4 className="text-white font-bold mb-1 text-base relative z-10">{translate('game:spin.tier3Label')}</h4>
                <p className="text-yellow-100/70 text-xs leading-relaxed relative z-10">{translate('game:spin.tier3Desc')}</p>
              </div>
            </div>

            <button onClick={onClose} className="mt-6 w-full py-3.5 bg-white/10 hover:bg-white/15 rounded-xl text-white font-bold text-sm transition-colors">
              {translate('game:spin.tiersClose')}
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ============================================
// КОМПОНЕНТЫ РУЛЕТКИ
// ============================================

function Confetti({ rarity }: { rarity: Rarity }) {
  const config = RARITY_CONFIG[rarity];
  const isHighTier = rarity === 'epic' || rarity === 'legendary';
  const particles = Array.from({ length: isHighTier ? 50 : 25 });

  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-50 overflow-visible">
      {particles.map((_, i) => {
        const angle = (i / particles.length) * 360;
        const distance = 60 + Math.random() * 200;
        const size = 4 + Math.random() * 8;
        const color = config.particles[Math.floor(Math.random() * config.particles.length)];

        return (
          <motion.div
            key={i}
            initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
            animate={{
              x: Math.cos((angle * Math.PI) / 180) * distance,
              y: Math.sin((angle * Math.PI) / 180) * distance + (Math.random() * 80),
              scale: [0, 1, 0.5],
              opacity: [1, 1, 0],
              rotate: Math.random() * 360 + 180
            }}
            transition={{ duration: (isHighTier ? 1.5 : 1) + Math.random() * 0.5, ease: "easeOut" }}
            style={{
              position: 'absolute',
              width: size,
              height: size,
              backgroundColor: color,
              borderRadius: i % 3 === 0 ? '50%' : '2px',
              boxShadow: isHighTier ? `0 0 8px ${color}` : 'none'
            }}
          />
        );
      })}
    </div>
  );
}

function SpinWheel({
  rotation,
  size,
  pointerControls,
  activeIndex,
  isSpinning
}: {
  rotation: number;
  size: number;
  pointerControls: any;
  activeIndex: number;
  isSpinning: boolean;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = Math.max(90, size / 2 - 20);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Статичный слой с тяжелыми фильтрами (ОПТИМИЗАЦИЯ ДЛЯ WEBVIEW) */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 pointer-events-none drop-shadow-2xl overflow-visible">
        <defs>
          <linearGradient id="wheelOuter" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#c084fc" stopOpacity="0.16" />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r + 12} fill="url(#wheelOuter)" filter="blur(6px)" opacity={isSpinning ? 0.42 : 0.24} className="transition-opacity duration-300" />
        <circle cx={cx} cy={cy} r={r + 6} fill="#0a0c1a" stroke="url(#wheelOuter)" strokeWidth={3} />
      </svg>

      {/* Динамический вращающийся слой с will-change-transform */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 pointer-events-none overflow-visible">
        <defs>
          <linearGradient id="activeGlow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#f8fafc" stopOpacity="0.06" />
          </linearGradient>
        </defs>

        <g style={{ transformOrigin: `${cx}px ${cy}px`, transform: `rotate(${rotation}deg)`, willChange: 'transform' }}>
          {SECTORS.map((s, i) => {
            const start = i * SECTOR_ANGLE;
            const end = start + SECTOR_ANGLE;
            const mid = start + SECTOR_ANGLE / 2;
            const iconPt = polarToCartesian(cx, cy, r * 0.5, mid);
            const amountPt = polarToCartesian(cx, cy, r * 0.68, mid);
            const fill = getSectorFill(s);
            const amountFontSize = getSectorAmountFontSize(s.prizeAmount);

            const isActive = i === activeIndex;
            const sectorOpacity = isSpinning && !isActive ? 0.6 : 1;

            return (
              <g key={i} style={{ opacity: sectorOpacity, transition: 'opacity 0.1s' }}>
                <path
                  d={sectorPath(cx, cy, r, start, end)}
                  fill={fill}
                  stroke={isActive && isSpinning ? "#f8fafc" : "#181629"}
                  strokeWidth={isActive && isSpinning ? 3 : 2.5}
                />
                {isActive && isSpinning && (
                  <path d={sectorPath(cx, cy, r, start, end)} fill="url(#activeGlow)" />
                )}

                <text
                  x={iconPt.x}
                  y={iconPt.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={18}
                  fill="#ffffff"
                  style={{ transform: `rotate(${mid}deg)`, transformOrigin: `${iconPt.x}px ${iconPt.y}px` }}
                >
                  {s.icon}
                </text>
                <text
                  x={amountPt.x}
                  y={amountPt.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={amountFontSize}
                  fill="#ffffff"
                  fontWeight="900"
                  stroke="rgba(10,12,26,0.28)"
                  strokeWidth={2}
                  paintOrder="stroke fill"
                  style={{ transform: `rotate(${mid}deg)`, transformOrigin: `${amountPt.x}px ${amountPt.y}px` }}
                >
                  {s.prizeAmount}
                </text>
              </g>
            );
          })}
        </g>

        {/* Центральная заглушка ПОВЕРХ секторов */}
        <circle cx={cx} cy={cy} r={24} fill="#0a0c1a" stroke="#d8b4fe" strokeWidth={3} />
        <circle cx={cx} cy={cy} r={6} fill="#ec4899" />
      </svg>

      {/* Язычок рулетки */}
      <motion.div
        className="absolute top-0 left-1/2 z-20 drop-shadow-[0_4px_8px_rgba(0,0,0,0.6)]"
        style={{ x: '-50%', y: -16, transformOrigin: '12px 10px' }}
        animate={pointerControls}
      >
        <svg width="24" height="34" viewBox="0 0 24 34" fill="none">
          <path d="M12 34L2 14C2 8.477 6.477 4 12 4C17.523 4 22 8.477 22 14L12 34Z" fill="url(#pointerGrad)" stroke="#ffffff" strokeWidth="2.5" strokeLinejoin="round"/>
          <circle cx="12" cy="10" r="3.5" fill="#1e1b4b" />
          <circle cx="12" cy="10" r="1.5" fill="#ffffff" />
          <defs>
            <linearGradient id="pointerGrad" x1="12" y1="4" x2="12" y2="34" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fbcfe8" />
              <stop offset="1" stopColor="#ec4899" />
            </linearGradient>
          </defs>
        </svg>
      </motion.div>
    </div>
  );
}

function SleekStreakTimeline({ streak, onInfoClick }: { streak: number; onInfoClick: () => void }) {
  const displayStreak = Math.max(streak, 1);
  const startDay = Math.max(1, displayStreak - 3);
  const days = Array.from({ length: 7 }, (_, i) => startDay + i);

  let tierInfo = {
    name: formatTierBadge(1), color: 'text-emerald-400', progressColor: 'bg-emerald-500',
    trackColor: 'bg-emerald-500/20', pastDot: 'bg-emerald-500/20 text-emerald-400',
    currentDot: 'bg-emerald-500 text-white ring-4 ring-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.5)]'
  };
  if (displayStreak >= 14) {
    tierInfo = {
      name: formatTierBadge(3), color: 'text-yellow-400', progressColor: 'bg-yellow-400',
      trackColor: 'bg-yellow-400/20', pastDot: 'bg-yellow-400/20 text-yellow-300',
      currentDot: 'bg-yellow-400 text-slate-900 ring-4 ring-yellow-400/30 shadow-[0_0_15px_rgba(250,204,21,0.5)]'
    };
  } else if (displayStreak >= 6) {
    tierInfo = {
      name: formatTierBadge(2), color: 'text-blue-400', progressColor: 'bg-blue-500',
      trackColor: 'bg-blue-500/20', pastDot: 'bg-blue-500/20 text-blue-400',
      currentDot: 'bg-blue-500 text-white ring-4 ring-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.5)]'
    };
  }

  const currentIndex = displayStreak - startDay;
  const progressPercent = (currentIndex / 6) * 100;

  return (
    <div className="w-full flex flex-col items-center">
      <button
        onClick={onInfoClick}
        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 transition-colors border border-white/10 px-4 py-1.5 rounded-full mb-3 active:scale-95"
      >
        <span className={`text-[13px] font-black uppercase tracking-widest ${tierInfo.color} drop-shadow-sm`}>
          {tierInfo.name}
        </span>
        <Info size={16} className="text-white/40" />
      </button>

      <h2 className="text-3xl font-black text-white drop-shadow-md mb-6 tracking-tight">
        {translate('game:spin.day', { count: displayStreak })}
      </h2>
      <div className="relative w-full max-w-[280px]">
        <div className="absolute top-1/2 left-[14px] right-[14px] h-1.5 -translate-y-1/2 rounded-full overflow-hidden bg-white/5">
          <div className={`absolute inset-0 ${tierInfo.trackColor}`} />
          <div className={`absolute top-0 bottom-0 left-0 ${tierInfo.progressColor} transition-all duration-1000`} style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="flex items-center justify-between relative z-10">
          {days.map((day) => {
            const isPast = day < streak;
            const isCurrent = day === streak;
            const isFuture = day > streak;
            return (
              <div key={day} className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all duration-300 ${isPast ? tierInfo.pastDot : ''} ${isCurrent ? tierInfo.currentDot + ' scale-110' : ''} ${isFuture ? 'bg-[#1e1b4b] text-white/40 border border-white/5' : ''}`}>
                {day}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================
// PRIZE RESULT
// ============================================

function PrizeResult({
  result,
  retryAvailable,
  isRetryingAd,
  adStatusMessage,
  isCollecting,
  onRetry,
  onCollect,
  onSkip,
}: {
  result: ExtendedSpinResult;
  retryAvailable: boolean;
  isRetryingAd: boolean;
  adStatusMessage: string | null;
  isCollecting: boolean;
  onRetry: () => void;
  onCollect: () => void;
  onSkip?: () => void;
}) {
  const config = RARITY_CONFIG[result.rarity];
  const isHighTier = result.rarity === 'epic' || result.rarity === 'legendary';

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0, y: 20 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      className="text-center flex flex-col items-center justify-center h-full relative w-full"
    >
      <Confetti rarity={result.rarity} />

      {isHighTier && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="absolute inset-0 blur-3xl rounded-full z-0 pointer-events-none"
          style={{ backgroundColor: config.glow }}
        />
      )}

      <motion.div
        animate={isHighTier ? { scale: [1, 1.15, 1], rotate: [0, -5, 5, 0] } : { y: [0, -8, 0] }}
        transition={{ repeat: Infinity, duration: isHighTier ? 1.5 : 2.5, ease: "easeInOut" }}
        className="text-[100px] relative drop-shadow-2xl z-10"
      >
        {result.icon}
      </motion.div>

      <div className="mt-4 z-10 w-full px-4 flex flex-col items-center">
        <h3 className={`text-4xl font-black text-transparent bg-clip-text drop-shadow-lg bg-gradient-to-b ${config.bg}`}>
          {formatSpinPrizeLabel(result.prizeType, result.prizeAmount)}
        </h3>

        <motion.div
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`font-black uppercase tracking-[0.15em] text-xs mt-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-md ${config.color} drop-shadow-md`}
        >
          {getRarityLabel(result.rarity)}
        </motion.div>

        <div className="mt-8 flex flex-col gap-3 w-full">
          {retryAvailable && (
            <button
              onClick={onRetry}
              disabled={isRetryingAd}
              className={`relative w-full py-4 rounded-2xl text-white font-black text-[16px] transition-all overflow-hidden flex items-center justify-center gap-2 bg-white/10 border border-white/15 active:scale-95 ${
                isRetryingAd ? 'opacity-60 cursor-not-allowed' : 'hover:bg-white/15'
              }`}
            >
              <RotateCcw size={18} />
              {isRetryingAd ? (adStatusMessage ?? translate('game:spin.loadingAd')) : translate('game:spin.retryAd').toUpperCase()}
              <motion.div
                className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-12"
                initial={{ x: '-200%' }} animate={{ x: '300%' }}
                transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
              />
            </button>
          )}

          <button
            onClick={onCollect}
            disabled={isCollecting || isRetryingAd}
            className={`relative w-full py-4 rounded-2xl text-white font-black text-[16px] transition-all overflow-hidden shadow-lg flex items-center justify-center gap-2
              ${isCollecting
                ? 'bg-slate-800 text-slate-400 scale-95'
                : `bg-gradient-to-r ${config.bg} hover:brightness-110 active:scale-95`}`}
            style={isCollecting ? undefined : { boxShadow: `0 0 20px ${config.glow}` }}
          >
            {isCollecting ? translate('game:spin.collecting').toUpperCase() : translate('game:spin.collect').toUpperCase()}
            {!isCollecting && (
              <motion.div
                className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12"
                initial={{ x: '-200%' }} animate={{ x: '300%' }}
                transition={{ repeat: Infinity, duration: 2.5, ease: "linear" }}
              />
            )}
          </button>

          {retryAvailable && onSkip && (
            <button
              onClick={onSkip}
              disabled={isCollecting || isRetryingAd}
              className="w-full py-2.5 text-white/50 hover:text-white font-semibold text-[15px] transition-colors"
            >
              {translate('game:spin.closeLater')}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export function SpinScreen({ onClose }: { onClose: () => void }) {
  const {
    setSpinStatus,
    loginStreak,
    updateUser,
    spinPendingPrize,
    spinRetryAvailable,
    spinAvailable,
    spinNextAvailableAt,
  } = useAppStore();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const SHOW_DEV_TOOLS = import.meta.env.DEV;

  // Начальный угол: -SECTOR_ANGLE / 2 (то есть 337.5 град), чтобы центр нулевого сектора был ровно под указателем
  const [rotation, setRotation] = useState(360 - SECTOR_ANGLE / 2);
  const [spinning, setSpinning] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [result, setResult] = useState<ExtendedSpinResult | null>(null);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [isRetryingAd, setIsRetryingAd] = useState(false);
  const [adStatusMessage, setAdStatusMessage] = useState<string | null>(null);
  const [isCollecting, setIsCollecting] = useState(false);
  const [wheelSize, setWheelSize] = useState(() => Math.min(320, Math.max(260, window.innerWidth - 40)));
  const [activeIndex, setActiveIndex] = useState(0);
  const [isSlowMo, setIsSlowMo] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeNow, setTimeNow] = useState(() => Date.now());

  const pointerControls = useAnimation();
  const screenControls = useAnimation();
  const lastTickRef = useRef(0);
  const spinAnimationRef = useRef<ReturnType<typeof animate> | null>(null);
  const isMountedRef = useRef(true);

  // Если есть незабранный приз — показать его сразу
  useEffect(() => {
    if (!spinPendingPrize) return;
    if (result || spinning || isPreparing) return;
    const { prizeType, prizeAmount } = spinPendingPrize;
    const targetIdx = SECTORS.findIndex(s => s.prizeType === prizeType && s.prizeAmount === prizeAmount);
    const sector = SECTORS[targetIdx >= 0 ? targetIdx : 0];
    setRetryAvailable(spinRetryAvailable);
    setResult({ prizeType, prizeAmount, streak: loginStreak, tier: 0, retryAvailable: spinRetryAvailable, label: sector.label, icon: sector.icon, color: sector.color, rarity: sector.rarity });
  }, [spinPendingPrize, spinRetryAvailable, loginStreak, result, spinning, isPreparing]);

  // Race condition fix: HomeScreen fetches getStatus() async; if SpinScreen mounted first,
  // spinRetryAvailable may arrive after result is already set. Sync it here.
  useEffect(() => {
    if (result && !retryAvailable && spinRetryAvailable) {
      setRetryAvailable(true);
    }
  }, [result, spinRetryAvailable, retryAvailable]);

  useEffect(() => {
    const timer = window.setInterval(() => setTimeNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncSpinStatus = async () => {
      try {
        const s = await spinApi.getStatus();
        if (cancelled) return;
        setSpinStatus(s.available, s.streak, s.retryAvailable, s.pendingPrize, s.nextAvailableAt);
        if (!result) {
          setRetryAvailable(s.retryAvailable);
        }
      } catch {
        // ignore background sync errors
      }
    };

    const onFocus = () => { void syncSpinStatus(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void syncSpinStatus();
      }
    };

    void syncSpinStatus();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    let cooldownWakeTimer: number | null = null;
    if (!spinAvailable && spinNextAvailableAt) {
      const wakeInMs = Date.parse(spinNextAvailableAt) - Date.now();
      if (Number.isFinite(wakeInMs) && wakeInMs > 0) {
        cooldownWakeTimer = window.setTimeout(() => {
          void syncSpinStatus();
        }, wakeInMs + 250);
      }
    }

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      if (cooldownWakeTimer !== null) {
        window.clearTimeout(cooldownWakeTimer);
      }
    };
  }, [result, setSpinStatus, spinAvailable, spinNextAvailableAt]);

  // Progressive status messages while the ad is loading/playing.
  useEffect(() => {
    if (!isRetryingAd) {
      setAdStatusMessage(null);
      return;
    }
    const t1 = setTimeout(() => setAdStatusMessage(translate('game:spin.loadingAd')), 100);
    const t2 = setTimeout(() => setAdStatusMessage(translate('game:spin.almostReady')), 6_000);
    const t3 = setTimeout(() => setAdStatusMessage(translate('game:spin.slowConnection')), 16_000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [isRetryingAd]);

  useEffect(() => {
    isMountedRef.current = true;
    const handleResize = () => {
      setWheelSize(Math.min(320, Math.max(260, window.innerWidth - 40)));
    };
    window.addEventListener('resize', handleResize);
    return () => {
      isMountedRef.current = false;
      window.removeEventListener('resize', handleResize);
      spinAnimationRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    let target = document.getElementById('spin-portal-root');
    if (!target) {
      target = document.createElement('div');
      target.id = 'spin-portal-root';
      document.body.appendChild(target);
    }
    setPortalTarget(target);
    return () => {
      if (target && target.childNodes.length === 0) {
        target.remove();
      }
    };
  }, []);

  const runWheelAnimation = (
    currentRotation: number,
    targetPrizeType: string,
    targetPrizeAmount: number,
    onComplete: () => void,
  ) => {
    const targetIdx = SECTORS.findIndex(
      s => s.prizeType === targetPrizeType && s.prizeAmount === targetPrizeAmount
    );
    const safeTargetIdx = targetIdx >= 0 ? targetIdx : 0;
    const sector = SECTORS[safeTargetIdx];

    const isSmallPrize = sector.rarity === 'common';
    const isNearMiss = isSmallPrize && Math.random() > 0.3;
    const offsetAngle = isNearMiss ? 2 : SECTOR_ANGLE / 2;

    const targetAngle = 360 - (safeTargetIdx * SECTOR_ANGLE + offsetAngle);
    const fullSpins = 8 * 360;
    const finalRotation = currentRotation + fullSpins + targetAngle - (currentRotation % 360);

    const isHighTier = sector.rarity === 'epic' || sector.rarity === 'legendary';

    spinAnimationRef.current = animate(currentRotation, finalRotation, {
      duration: 6.5,
      ease: [0.1, 0.9, 0.15, 1],
      onUpdate: (v) => {
        setRotation(v);

        const normalizedRot = ((360 - (v % 360)) % 360);
        setActiveIndex(Math.floor(normalizedRot / SECTOR_ANGLE));

        const currentTick = Math.floor(v / SECTOR_ANGLE);
        if (currentTick !== lastTickRef.current) {
          lastTickRef.current = currentTick;
          const progress = (v - currentRotation) / (finalRotation - currentRotation);
          if (progress > 0.9) {
            triggerHaptic('heavy');
            setIsSlowMo(true);
          } else if (progress > 0.6) {
            triggerHaptic('medium');
          } else {
            triggerHaptic('light');
          }
          pointerControls.start({
            rotate: [20, 0],
            transition: { type: 'spring', stiffness: 800, damping: 12 }
          });
        }
      },
      onComplete: () => {
        if (!isMountedRef.current) return;
        if (isHighTier) {
          triggerHaptic('success');
          screenControls.start({
            x: [-4, 4, -4, 4, -2, 2, 0],
            y: [-2, 2, -4, 4, -2, 2, 0],
            transition: { duration: 0.4 }
          });
        } else {
          triggerHaptic('medium');
        }
        onComplete();
      },
    });

    return safeTargetIdx;
  };

  const handleSpin = async () => {
    if (spinning || result || isPreparing) return;
    setError(null);
    setIsPreparing(true);
    setSpinning(true);
    setIsSlowMo(false);
    triggerHaptic('medium');

    try {
      const res = await Promise.race([
        spinApi.roll(),
        new Promise<SpinRollResponse>((_, reject) => {
          window.setTimeout(() => reject(new Error('SPIN_TIMEOUT')), 15000);
        }),
      ]);
      await new Promise(r => setTimeout(r, 650));
      if (!isMountedRef.current) return;
      setIsPreparing(false);

      const targetIdx = SECTORS.findIndex(
        s => s.prizeType === res.prizeType && s.prizeAmount === res.prizeAmount
      );
      const sector = SECTORS[targetIdx >= 0 ? targetIdx : 0];
      const extendedResult: ExtendedSpinResult = { ...res, label: sector.label, icon: sector.icon, color: sector.color, rarity: sector.rarity };

      const nextAvailableAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      setSpinStatus(
        false,
        res.streak,
        res.retryAvailable,
        { prizeType: res.prizeType, prizeAmount: res.prizeAmount },
        nextAvailableAt,
      );
      setRetryAvailable(res.retryAvailable);

      const currentRot = rotation;
      runWheelAnimation(currentRot, res.prizeType, res.prizeAmount, () => {
        if (!isMountedRef.current) return;
        setResult(extendedResult);
        setSpinning(false);
        setIsSlowMo(false);
      });
    } catch (err) {
      if (isMountedRef.current) {
        setSpinning(false);
        setIsPreparing(false);
        if (err instanceof ApiError) {
          if (err.code && exists(`errors:codes.${err.code}`)) {
            setError(translate(`errors:codes.${err.code}`));
          } else {
            setError(err.message);
          }
        } else if (err instanceof Error && err.message === 'SPIN_TIMEOUT') {
          setError(translate('errors:generic.server'));
        } else {
          setError(translate('errors:generic.server'));
        }
      }
    }
  };

  const handleRetry = async () => {
    if (spinning || isPreparing || isRetryingAd) return;
    setError(null);
    setIsRetryingAd(true);

    const previousResult = result;
    try {
      const rewardResult = await runRewardedFlow(
        ADSGRAM_BLOCK_IDS.rewardSpinRetry,
        { placement: 'reward_spin_retry' },
        { optimistic: true },
      );

      // Optimistic path: ad completed, clientComplete fires in background.
      if (rewardResult.outcome === 'completed') {
        if (rewardResult.intentId) {
          rememberPendingRewardIntent({ intentId: rewardResult.intentId, placement: 'reward_spin_retry' });
        }
        setResult(null);
        setSpinning(true);
        setIsSlowMo(false);
        triggerHaptic('medium');

        // spinApi.retry() requires the server to know the ad was watched.
        // clientComplete runs in background, so retry a few times to handle the race window.
        let res: SpinRollResponse | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
            res = await spinApi.retry();
            break;
          } catch (err) {
            if (!(err instanceof ApiError) || err.code !== 'SPIN_RETRY_AD_REQUIRED') {
              break;
            }
          }
        }

        if (!res) {
          if (isMountedRef.current) {
            setSpinning(false);
            if (previousResult) setResult(previousResult);
            setError(translate('errors:generic.server'));
          }
          return;
        }

        await new Promise(r => setTimeout(r, 650));
        if (!isMountedRef.current) return;

        const targetIdx = SECTORS.findIndex(s => s.prizeType === res!.prizeType && s.prizeAmount === res!.prizeAmount);
        const sector = SECTORS[targetIdx >= 0 ? targetIdx : 0];
        const extendedResult: ExtendedSpinResult = { ...res!, label: sector.label, icon: sector.icon, color: sector.color, rarity: sector.rarity };

        setSpinStatus(
          false,
          res!.streak,
          false,
          { prizeType: res!.prizeType, prizeAmount: res!.prizeAmount },
          spinNextAvailableAt,
        );
        setRetryAvailable(false);

        const currentRot = rotation;
        runWheelAnimation(currentRot, res!.prizeType, res!.prizeAmount, () => {
          if (!isMountedRef.current) return;
          setResult(extendedResult);
          setSpinning(false);
          setIsSlowMo(false);
        });
        return;
      }

      if (rewardResult.outcome === 'timeout' || (rewardResult.outcome === 'provider_error' && rewardResult.intentId)) {
        if (rewardResult.intentId) {
          rememberPendingRewardIntent({ intentId: rewardResult.intentId, placement: 'reward_spin_retry' });
        }
        if (isMountedRef.current) {
          setError(getRewardedFlowMessage('reward_spin_retry', rewardResult));
        }
        return;
      }
      if (rewardResult.outcome === 'unavailable' || rewardResult.outcome === 'not_completed') {
        if (isMountedRef.current) {
          setError(getRewardedFlowMessage('reward_spin_retry', rewardResult));
        }
        return;
      }
      if (rewardResult.outcome === 'error') {
        if (rewardResult.intentId) {
          rememberPendingRewardIntent({ intentId: rewardResult.intentId, placement: 'reward_spin_retry' });
        }
        if (isMountedRef.current) {
          setError(getRewardedFlowMessage('reward_spin_retry', rewardResult));
        }
        return;
      }
      if (rewardResult.outcome === 'rejected') {
        clearPendingRewardIntent('reward_spin_retry', rewardResult.intentId ?? undefined);
        if (rewardResult.failureCode !== 'SPIN_RETRY_ALREADY_GRANTED') {
          if (isMountedRef.current) {
            setError(getRewardedFlowMessage('reward_spin_retry', rewardResult));
          }
          return;
        }
      } else {
        clearPendingRewardIntent('reward_spin_retry', rewardResult.intentId ?? undefined);
      }

      // Fallback for 'granted' or 'SPIN_RETRY_ALREADY_GRANTED'.
      setResult(null);
      setSpinning(true);
      setIsSlowMo(false);
      triggerHaptic('medium');

      const res = await spinApi.retry();
      await new Promise(r => setTimeout(r, 650));
      if (!isMountedRef.current) return;

      const targetIdx = SECTORS.findIndex(
        s => s.prizeType === res.prizeType && s.prizeAmount === res.prizeAmount
      );
      const sector = SECTORS[targetIdx >= 0 ? targetIdx : 0];
      const extendedResult: ExtendedSpinResult = { ...res, label: sector.label, icon: sector.icon, color: sector.color, rarity: sector.rarity };

      setSpinStatus(
        false,
        res.streak,
        false,
        { prizeType: res.prizeType, prizeAmount: res.prizeAmount },
        spinNextAvailableAt,
      );
      setRetryAvailable(false);

      const currentRot = rotation;
      runWheelAnimation(currentRot, res.prizeType, res.prizeAmount, () => {
        if (!isMountedRef.current) return;
        setResult(extendedResult);
        setSpinning(false);
        setIsSlowMo(false);
      });
    } catch (err) {
      if (isMountedRef.current) {
        setSpinning(false);
        if (previousResult) {
          setResult(previousResult);
        }
        if (err instanceof ApiError && err.code === 'SPIN_RETRY_AD_REQUIRED') {
          setError(translate('errors:codes.SPIN_RETRY_AD_REQUIRED'));
        } else {
          setError(translate('errors:generic.network'));
        }
      }
    } finally {
      if (isMountedRef.current) {
        setIsRetryingAd(false);
      }
    }
  };

  const handleCollect = async () => {
    if (isCollecting || !result) return;
    setIsCollecting(true);
    try {
      const collected = await spinApi.collect();
      const latestUser = useAppStore.getState().user;
      if (latestUser) {
        if (collected.prizeType === 'coins') {
          updateUser({ coins: (latestUser.coins ?? 0) + collected.prizeAmount });
        } else if (collected.prizeType === 'hints') {
          updateUser({ hintBalance: (latestUser.hintBalance ?? 0) + collected.prizeAmount });
        } else if (collected.prizeType === 'revive') {
          updateUser({ reviveBalance: (latestUser.reviveBalance ?? 0) + collected.prizeAmount });
        }
      }
      // Reset pending in store
      setSpinStatus(false, result.streak, false, null, spinNextAvailableAt);
      onClose();
    } catch {
      if (isMountedRef.current) {
        setIsCollecting(false);
        setError(translate('errors:generic.server'));
      }
    }
  };
  const spinCooldownLabel = !spinAvailable
    ? formatTimeLeft(spinNextAvailableAt, timeNow)
    : null;

  if (typeof document === 'undefined' || !portalTarget) return null;

  return createPortal(
    <motion.div
      animate={screenControls}
      className="fixed inset-0 z-[2000] flex flex-col items-center bg-[#0a0c1a] overflow-hidden"
    >
      {/* Фон саспенса (Slow-mo эффект) */}
      <motion.div
        className="absolute inset-0 z-0 pointer-events-none transition-colors duration-1000"
        style={{
          backgroundColor: 'rgba(10,12,26,0.95)',
          backdropFilter: 'blur(24px)'
        }}
      />

      {/* Верхний бар (Закрыть) */}
      <div className="w-full pt-8 z-10 relative" />

      {/* Основной контент */}
      <div className="w-full flex-1 flex flex-col items-center justify-center gap-8 shrink-0 z-10 px-5">
        {!result && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="w-full">
            <SleekStreakTimeline streak={loginStreak} onInfoClick={() => setIsInfoOpen(true)} />
          </motion.div>
        )}

        <div className="relative flex items-center justify-center h-[340px] w-full shrink-0">
          {result ? (
            <PrizeResult
              result={result}
              retryAvailable={retryAvailable}
              isRetryingAd={isRetryingAd}
              adStatusMessage={adStatusMessage}
              isCollecting={isCollecting}
              onRetry={handleRetry}
              onCollect={handleCollect}
              onSkip={onClose}
            />
          ) : (
            <SpinWheel
              rotation={rotation}
              size={wheelSize}
              pointerControls={pointerControls}
              activeIndex={activeIndex}
              isSpinning={spinning}
            />
          )}
        </div>
      </div>

      {/* Нижний блок действий */}
      <div className="w-full flex flex-col gap-3 mt-auto pt-6 px-5 pb-8 z-10">
        {error && (
          <p className="text-center text-red-400 text-sm font-medium">{error}</p>
        )}
        {SHOW_DEV_TOOLS && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 flex flex-col gap-2">
            <div className="text-[11px] uppercase tracking-widest text-white/40 font-bold">DEV</div>
            <button
              onClick={async () => {
                setError(null);
                setSpinning(false);
                setIsPreparing(false);
                setIsSlowMo(false);
                spinAnimationRef.current?.stop();
                setRotation(360 - SECTOR_ANGLE / 2);
                setActiveIndex(0);
                setResult(null);
                setRetryAvailable(false);
                setSpinStatus(true, 0, false, null, null);
                try {
                  await spinApi.devReset();
                  const s = await spinApi.getStatus();
                  setSpinStatus(s.available, s.streak, s.retryAvailable, s.pendingPrize, s.nextAvailableAt);
                  setRetryAvailable(s.retryAvailable);
                } catch {
                  setError('Dev reset failed');
                }
              }}
              className="w-full py-2.5 rounded-xl bg-white/10 text-white/80 font-semibold text-sm hover:bg-white/15 active:scale-95 transition-all"
            >
              Сбросить спин
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  setError(null);
                  try {
                    await spinApi.devSetStreak(5);
                    const s = await spinApi.getStatus();
                    setSpinStatus(s.available, s.streak, s.retryAvailable, s.pendingPrize, s.nextAvailableAt);
                    setRetryAvailable(s.retryAvailable);
                    setResult(null);
                  } catch {
                    setError('Dev set streak failed');
                  }
                }}
                className="py-2.5 rounded-xl bg-white/10 text-white/80 font-semibold text-xs hover:bg-white/15 active:scale-95 transition-all"
              >
                Tier2 на следующем
              </button>
              <button
                onClick={async () => {
                  setError(null);
                  try {
                    await spinApi.devSetStreak(13);
                    const s = await spinApi.getStatus();
                    setSpinStatus(s.available, s.streak, s.retryAvailable, s.pendingPrize, s.nextAvailableAt);
                    setRetryAvailable(s.retryAvailable);
                    setResult(null);
                  } catch {
                    setError('Dev set streak failed');
                  }
                }}
                className="py-2.5 rounded-xl bg-white/10 text-white/80 font-semibold text-xs hover:bg-white/15 active:scale-95 transition-all"
              >
                Tier3 на следующем
              </button>
            </div>
          </div>
        )}
        {!result && (
          <>
            <button
              onClick={handleSpin}
              disabled={spinning || !spinAvailable}
              className={`relative w-full py-4 rounded-2xl text-white font-black text-[17px] transition-all overflow-hidden shadow-lg
                ${(spinning || !spinAvailable) ? 'bg-slate-800 text-slate-500 scale-95'
                           : 'bg-gradient-to-r from-purple-600 to-pink-600 shadow-[0_8px_30px_rgba(236,72,153,0.4)] active:scale-95'}`}
            >
              {isPreparing
                ? translate('game:spin.preparing').toUpperCase()
                : spinning
                  ? translate('game:spin.spinning').toUpperCase()
                  : spinAvailable
                    ? translate('game:spin.title').toUpperCase()
                    : translate('game:spin.unavailable').toUpperCase()}
              {spinAvailable && !spinning && (
                <motion.div
                  className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12"
                  initial={{ x: '-200%' }} animate={{ x: '300%' }} transition={{ repeat: Infinity, duration: 2.5, ease: "linear" }}
                />
              )}
            </button>
            {!spinAvailable && spinCooldownLabel && (
              <p className="text-center text-white/60 text-sm -mt-1">
                {translate('game:spin.availableIn', { time: spinCooldownLabel })}
              </p>
            )}

            <button onClick={onClose} className="w-full py-2.5 text-white/50 hover:text-white font-semibold text-[15px] transition-colors">
              {translate('common:later')}
            </button>
          </>
        )}
      </div>

      {/* Модалка с информацией о тирах */}
      <SpinInfoModal isOpen={isInfoOpen} onClose={() => setIsInfoOpen(false)} />
    </motion.div>,
    portalTarget
  );
}
