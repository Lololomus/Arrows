import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useTonConnectUI } from '@tonconnect/ui-react';
import { Coins, Diamond, Heart, Lightbulb, Minus, Plus, RefreshCcw, ShoppingBag } from 'lucide-react';
import { authApi, caseApi, handleApiError, shopApi, type WelcomeOfferData } from '../api/client';
import { WelcomeOfferModal } from '../components/WelcomeOfferModal';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';
import { HeaderBar } from '../components/ui/HeaderBar';
import type { CaseInfo, CaseOpenResult, ShopDiscountTier, ShopItem } from '../game/types';
import { getErrorCodeMessage } from '../i18n/content';
import { formatNumber, translate } from '../i18n';
import { useWalletConnectionController } from '../hooks/useWalletConnectionController';
import { useAppStore } from '../stores/store';
import { CaseOpenModal } from './game-screen/CaseOpenModal';
import { WithdrawalModal } from './game-screen/WithdrawalModal';
import { PurchaseSuccessOverlay, type PurchaseSuccessData } from '../components/ui/PurchaseSuccessOverlay';

const CASE_ENABLED = import.meta.env.DEV;

function buildCommentPayload(comment: string): string {
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(comment);
  const dataBytes = new Uint8Array(4 + textBytes.length);
  dataBytes.set(textBytes, 4);

  const dataBits = dataBytes.length * 8;
  const cellDescriptor1 = 0x00;
  const cellDescriptor2 = Math.ceil(dataBits / 8) * 2 + (dataBits % 8 !== 0 ? 1 : 0);

  const bocMagic = new Uint8Array([0xb5, 0xee, 0x9c, 0x72]);
  const flags = 0x01;
  const sizeBytes = 1;
  const cellCount = 1;
  const rootCount = 1;
  const absentCount = 0;
  const totalCellSize = 2 + dataBytes.length;

  const boc = new Uint8Array(4 + 1 + 5 + 2 + 1 + dataBytes.length);
  let offset = 0;

  boc.set(bocMagic, offset); offset += 4;
  boc[offset++] = flags;
  boc[offset++] = sizeBytes;
  boc[offset++] = cellCount;
  boc[offset++] = rootCount;
  boc[offset++] = absentCount;
  boc[offset++] = totalCellSize;
  boc[offset++] = 0;
  boc[offset++] = cellDescriptor1;
  boc[offset++] = cellDescriptor2;
  boc.set(dataBytes, offset);

  let binary = '';
  for (let i = 0; i < boc.length; i++) {
    binary += String.fromCharCode(boc[i]);
  }
  return btoa(binary);
}

type BoostId = 'hints_1' | 'revive_1';
type QuantityState = Record<BoostId, number>;

const BOOST_IDS: BoostId[] = ['hints_1', 'revive_1'];
const MAX_BOOST_QUANTITY = 10;

const TON_SENT_TX_KEY = 'ton_pending_tx_id';
const TON_SENT_TX_TTL_MS = 24 * 60 * 60 * 1000;

function readPendingTxId(): number | null {
  try {
    const raw = localStorage.getItem(TON_SENT_TX_KEY);
    if (!raw) return null;
    const { txId, ts } = JSON.parse(raw) as { txId: number; ts: number };
    if (Date.now() - ts > TON_SENT_TX_TTL_MS) {
      localStorage.removeItem(TON_SENT_TX_KEY);
      return null;
    }
    return txId;
  } catch {
    return null;
  }
}

function savePendingTxId(txId: number): void {
  localStorage.setItem(TON_SENT_TX_KEY, JSON.stringify({ txId, ts: Date.now() }));
}

function clearPendingTxId(): void {
  localStorage.removeItem(TON_SENT_TX_KEY);
}

const BOOST_UI: Record<BoostId, {
  priceFallback: number;
  discountTiersFallback: ShopDiscountTier[];
  iconWrapClass: string;
  iconClass: string;
  buttonClass: string;
}> = {
  hints_1: {
    priceFallback: 100,
    discountTiersFallback: [{ minQuantity: 3, percent: 5 }, { minQuantity: 5, percent: 10 }],
    iconWrapClass: 'border-cyan-500/20 bg-cyan-500/10',
    iconClass: 'text-cyan-400',
    buttonClass: 'bg-cyan-500 hover:bg-cyan-400',
  },
  revive_1: {
    priceFallback: 500,
    discountTiersFallback: [{ minQuantity: 3, percent: 5 }, { minQuantity: 5, percent: 10 }],
    iconWrapClass: 'border-rose-500/20 bg-rose-500/10',
    iconClass: 'text-rose-400',
    buttonClass: 'bg-rose-500 hover:bg-rose-400',
  },
};

function clampBoostQuantity(value: number): number {
  return Math.min(MAX_BOOST_QUANTITY, Math.max(1, Math.floor(value)));
}

function normalizeBoosts(items: ShopItem[]): Array<ShopItem & { id: BoostId }> {
  return items.filter((item): item is ShopItem & { id: BoostId } =>
    BOOST_IDS.includes(item.id as BoostId),
  );
}

function getBoostDiscountTiers(item: ShopItem & { id: BoostId }): ShopDiscountTier[] {
  return item.discountTiers?.length
    ? item.discountTiers
    : BOOST_UI[item.id].discountTiersFallback;
}

function getBoostDiscountPercent(item: ShopItem & { id: BoostId }, quantity: number): number {
  return getBoostDiscountTiers(item).reduce((currentDiscount, tier) => (
    quantity >= tier.minQuantity && tier.percent > currentDiscount
      ? tier.percent
      : currentDiscount
  ), 0);
}

function calculateBoostTotalPrice(item: ShopItem & { id: BoostId }, quantity: number): number {
  const unitPrice = item.priceCoins ?? BOOST_UI[item.id].priceFallback;
  const subtotal = unitPrice * quantity;
  const discountPercent = getBoostDiscountPercent(item, quantity);
  if (discountPercent <= 0) {
    return subtotal;
  }

  return Math.floor(subtotal * (100 - discountPercent) / 100);
}

function isWalletRejection(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('interrupted')
    || normalized.includes('cancel')
    || normalized.includes('reject');
}

function BoostCard({
  boostId,
  item,
  quantity,
  coinBalance,
  isPurchasing,
  onChangeQuantity,
  onPurchase,
}: {
  boostId: BoostId;
  item: ShopItem & { id: BoostId };
  quantity: number;
  coinBalance: number;
  isPurchasing: boolean;
  onChangeQuantity: (value: number) => void;
  onPurchase: () => void;
}) {
  const { t } = useTranslation();
  const config = BOOST_UI[boostId];
  const unitPrice = item.priceCoins ?? config.priceFallback;
  const discountTiers = getBoostDiscountTiers(item);
  const baseTotalPrice = unitPrice * quantity;
  const discountPercent = getBoostDiscountPercent(item, quantity);
  const totalPrice = calculateBoostTotalPrice(item, quantity);
  const insufficientCoins = totalPrice > coinBalance;
  const Icon = boostId === 'hints_1' ? Lightbulb : Heart;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-[24px] border border-white/5 bg-[#18181b]/60 p-5 backdrop-blur-md"
    >
      <div className="flex items-start gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${config.iconWrapClass}`}>
          <Icon size={24} className={config.iconClass} strokeWidth={2.5} />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-[#f7f8fb]">{item.name}</h2>
          <p className="mt-1 text-sm leading-relaxed text-[#a7abb8]">{item.description}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold text-[#8d93a3]">
        <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1">
          {t('shop:pricing.perUnit', { price: formatNumber(unitPrice) })}
        </span>
        {discountTiers.map((tier) => (
          <span
            key={`${boostId}-${tier.minQuantity}-${tier.percent}`}
            className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-amber-100"
          >
            {t('shop:pricing.discountTier', { quantity: formatNumber(tier.minQuantity), percent: tier.percent })}
          </span>
        ))}
        {discountPercent > 0 && (
          <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
            {t('shop:pricing.discountApplied', { percent: discountPercent })}
          </span>
        )}
      </div>

      <div className="mt-6 flex items-center gap-4">
        <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-black/20 p-1">
          <button
            type="button"
            onClick={() => onChangeQuantity(quantity - 1)}
            disabled={quantity <= 1}
            aria-label={t('common:decreaseQty')}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-[#9fa5b5] transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <Minus size={18} />
          </button>
          <span className="w-6 text-center text-lg font-bold text-[#f7f8fb]">{formatNumber(quantity)}</span>
          <button
            type="button"
            onClick={() => onChangeQuantity(quantity + 1)}
            disabled={quantity >= MAX_BOOST_QUANTITY}
            aria-label={t('common:increaseQty')}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-[#9fa5b5] transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <Plus size={18} />
          </button>
        </div>

        <button
          type="button"
          onClick={onPurchase}
          disabled={insufficientCoins || isPurchasing}
          className={`relative flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl font-bold text-white transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-50 ${config.buttonClass}`}
        >
          {isPurchasing ? (
            <span className="animate-pulse">{t('common:processing')}</span>
          ) : (
            <>
              <span>{t('common:buy')}</span>
              <div className="mx-1 h-4 w-px bg-black/20" />
              <div className="flex items-center gap-1.5">
                <Coins size={16} className="text-amber-300 drop-shadow-sm" />
                {discountPercent > 0 && (
                  <span className="text-xs text-white/70 line-through">{formatNumber(baseTotalPrice)}</span>
                )}
                <span>{formatNumber(totalPrice)}</span>
              </div>
            </>
          )}
        </button>
      </div>
    </motion.section>
  );
}

const SHOW_DEV_TOOLS = import.meta.env.DEV;

type BundleIconProps = {
  size?: number;
  className?: string;
  strokeWidth?: number;
};

function StarterBundleIcon({ size = 28, className, strokeWidth = 1.75 }: BundleIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M7.5 13.5h17v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11Z"
        fill="currentColor"
        opacity="0.16"
      />
      <path
        d="M5.5 10.5h21v4h-21v-4ZM16 10.5v16M7.5 14.5v10a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-10"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.4 10.5c-2.3-3.3-5.8-2.8-5.8-.7 0 1.8 2.5 2.4 5.8.7ZM18.6 10.5c2.3-3.3 5.8-2.8 5.8-.7 0 1.8-2.5 2.4-5.8.7Z"
        fill="currentColor"
        opacity="0.28"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.2 20.8c0-1.1.8-1.9 1.8-1.9.7 0 1.3.4 1.6 1 .3-.6.9-1 1.6-1 1 0 1.8.8 1.8 1.9 0 1.8-3.4 3.9-3.4 3.9s-3.4-2.1-3.4-3.9Z"
        fill="currentColor"
      />
    </svg>
  );
}

function StandardBundleIcon({ size = 28, className, strokeWidth = 1.75 }: BundleIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M6.5 11.2 16 6l9.5 5.2v10.6L16 27l-9.5-5.2V11.2Z"
        fill="currentColor"
        opacity="0.14"
      />
      <path
        d="M6.5 11.2 16 16.4l9.5-5.2M16 16.4V27M6.5 11.2 16 6l9.5 5.2v10.6L16 27l-9.5-5.2V11.2Z"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m10.5 8.8 9.2 5.3M21.5 8.8l-9.2 5.3"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        opacity="0.45"
      />
      <path d="M10.5 19.5h3.2M18.3 19.5h3.2" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
      <circle cx="12.1" cy="22.5" r="1.4" fill="currentColor" />
      <circle cx="19.9" cy="22.5" r="1.4" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

function AdvancedBundleIcon({ size = 28, className, strokeWidth = 1.75 }: BundleIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M16 5.5 25 11v10l-9 5.5L7 21V11l9-5.5Z"
        fill="currentColor"
        opacity="0.14"
      />
      <path
        d="M16 5.5 25 11v10l-9 5.5L7 21V11l9-5.5Z"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <path
        d="M17.6 8.8 12.4 17h4.2l-2.2 6.2 5.6-8.5h-4.1l1.7-5.9Z"
        fill="currentColor"
      />
      <path
        d="M8.8 16H5.6M26.4 16h-3.2M16 4.6V2.8M16 29.2v-1.8"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        opacity="0.6"
      />
      <path d="M10.2 11.7 16 8.2l5.8 3.5" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" opacity="0.35" />
    </svg>
  );
}

function UltraBundleIcon({ size = 28, className, strokeWidth = 1.75 }: BundleIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M9.5 9.5h13l3 5.2L16 27 6.5 14.7l3-5.2Z"
        fill="currentColor"
        opacity="0.16"
      />
      <path
        d="M9.5 9.5h13l3 5.2L16 27 6.5 14.7l3-5.2Z"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.8 14.7h18.4M12.2 9.5l-1.8 5.2L16 27M19.8 9.5l1.8 5.2L16 27"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path
        d="M12.4 5.7c0-.9.7-1.6 1.5-1.6.6 0 1.1.3 1.4.8.3-.5.8-.8 1.4-.8.8 0 1.5.7 1.5 1.6 0 1.5-2.9 3.1-2.9 3.1s-2.9-1.6-2.9-3.1Z"
        fill="currentColor"
      />
      <path
        d="M22.3 23.7c0-.8.6-1.4 1.4-1.4.5 0 1 .3 1.2.7.2-.4.7-.7 1.2-.7.8 0 1.4.6 1.4 1.4 0 1.3-2.6 2.8-2.6 2.8s-2.6-1.5-2.6-2.8Z"
        fill="currentColor"
        opacity="0.75"
      />
    </svg>
  );
}

// ── Bundle tiers config ──────────────────────────────────────────────────────

type BundleId = 'starter' | 'standard' | 'advanced' | 'ultra';
type ExtraBundleId = Exclude<BundleId, 'starter'>;
type BundleConfig = {
  bundleId: BundleId;
  hints: number;
  revives: number;
  extraLives?: number;
  priceStars: number;
};

const BUNDLE_THEME: Record<BundleId, {
  iconBorder: string;
  iconBg: string;
  iconColor: string;
  btnFrom: string;
  btnTo: string;
  badgeBg: string;
  badgeText: string;
  Icon: React.FC<BundleIconProps>;
}> = {
  starter: {
    iconBorder: 'border-purple-500/30',
    iconBg: 'bg-purple-500/10',
    iconColor: 'text-purple-400',
    btnFrom: 'from-purple-600',
    btnTo: 'to-pink-600',
    badgeBg: 'bg-amber-500/15 border-amber-500/20',
    badgeText: 'text-amber-300',
    Icon: StarterBundleIcon,
  },
  standard: {
    iconBorder: 'border-blue-500/30',
    iconBg: 'bg-blue-500/10',
    iconColor: 'text-blue-400',
    btnFrom: 'from-blue-600',
    btnTo: 'to-cyan-500',
    badgeBg: '',
    badgeText: '',
    Icon: StandardBundleIcon,
  },
  advanced: {
    iconBorder: 'border-amber-500/30',
    iconBg: 'bg-amber-500/10',
    iconColor: 'text-amber-400',
    btnFrom: 'from-amber-500',
    btnTo: 'to-orange-500',
    badgeBg: '',
    badgeText: '',
    Icon: AdvancedBundleIcon,
  },
  ultra: {
    iconBorder: 'border-rose-500/30',
    iconBg: 'bg-rose-500/10',
    iconColor: 'text-rose-400',
    btnFrom: 'from-rose-600',
    btnTo: 'to-pink-500',
    badgeBg: '',
    badgeText: '',
    Icon: UltraBundleIcon,
  },
};

const EXTRA_BUNDLE_CONFIGS: Array<BundleConfig & { bundleId: ExtraBundleId }> = [
  { bundleId: 'standard', hints: 50, revives: 25, priceStars: 150 },
  { bundleId: 'advanced', hints: 150, revives: 100, priceStars: 500 },
  { bundleId: 'ultra', hints: 300, revives: 150, extraLives: 2, priceStars: 1000 },
];

function useBundleCountdown(expiresAt: string | null): { display: string; expired: boolean } {
  const [display, setDisplay] = useState('');
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!expiresAt) {
      setDisplay('');
      setExpired(false);
      return;
    }
    const tick = () => {
      const diff = Date.parse(expiresAt) - Date.now();
      if (diff <= 0) { setDisplay('00:00:00'); setExpired(true); return; }
      setExpired(false);
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setDisplay(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  return { display, expired };
}

function BundleCard({
  bundleId,
  hints,
  revives,
  extraLives,
  priceStars,
  discounted,
  discountedPrice,
  expiresAt,
  eligible,
  isPurchasing,
  onBuy,
}: {
  bundleId: BundleId;
  hints: number;
  revives: number;
  extraLives?: number;
  priceStars: number;
  discounted?: boolean;
  discountedPrice?: number;
  expiresAt?: string | null;
  eligible?: boolean;
  isPurchasing: boolean;
  onBuy: () => void;
}) {
  const { t } = useTranslation();
  const theme = BUNDLE_THEME[bundleId];
  const { display: countdown, expired: timerExpired } = useBundleCountdown(
    discounted && expiresAt ? expiresAt : null,
  );
  const showDiscount = discounted && !timerExpired;
  const effectivePrice = showDiscount && discountedPrice ? discountedPrice : priceStars;
  const isStarter = bundleId === 'starter';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-[24px] border border-white/5 bg-[#18181b]/60 overflow-hidden backdrop-blur-md"
    >
      {/* Limited / new-user banner */}
      {isStarter && showDiscount && countdown && (
        <div className={`flex items-center justify-between px-4 py-2 border-b ${theme.badgeBg}`}>
          <span className={`text-[11px] font-bold uppercase tracking-widest ${theme.badgeText}`}>
            ⏰ {t('shop:bundles.limitedBadge')}
          </span>
          <span className={`font-mono text-sm font-bold ${theme.badgeText}`}>{countdown}</span>
        </div>
      )}
      {isStarter && !showDiscount && eligible && (
        <div className="flex items-center px-4 py-2 border-b border-purple-500/20 bg-purple-500/10">
          <span className="text-[11px] font-bold uppercase tracking-widest text-purple-300">
            {t('shop:bundles.newUserBadge')}
          </span>
        </div>
      )}

      <div className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border ${theme.iconBorder} ${theme.iconBg}`}>
            <theme.Icon size={44} className={theme.iconColor} strokeWidth={1.85} />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#f7f8fb]">{t(`shop:bundles.${bundleId}.title`)}</h3>
            <p className="text-xs text-[#8d93a3] mt-0.5">{t(`shop:bundles.${bundleId}.subtitle`)}</p>
          </div>
        </div>

        {/* Contents */}
        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-2.5 text-sm text-[#d2d7e5]">
            <Heart size={18} className="text-rose-400 shrink-0" />
            <span className="font-medium">{t('shop:bundles.revives', { count: revives })}</span>
          </div>
          <div className="flex items-center gap-2.5 text-sm text-[#d2d7e5]">
            <Lightbulb size={18} className="text-cyan-400 shrink-0" />
            <span className="font-medium">{t('shop:bundles.hints', { count: hints })}</span>
          </div>
          {!!extraLives && (
            <div className="flex items-center gap-2.5 text-sm text-rose-300">
              <Heart size={18} className="text-rose-300 shrink-0" strokeWidth={1.5} />
              <span className="font-medium">{t('shop:bundles.extraLives', { count: extraLives })}</span>
            </div>
          )}
        </div>

        {/* Price + button */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-end gap-1.5">
            {showDiscount && (
              <span className="text-xs text-white/35 line-through mb-0.5">{priceStars} ⭐</span>
            )}
            <span className="text-2xl font-black text-white">{effectivePrice} ⭐</span>
          </div>
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={onBuy}
            disabled={isPurchasing || (isStarter && eligible === false)}
            className={`flex-1 max-w-[160px] py-3 rounded-2xl font-bold text-sm text-white bg-gradient-to-r ${theme.btnFrom} ${theme.btnTo} transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-50`}
          >
            {isPurchasing
              ? t('shop:bundles.buying')
              : isStarter && eligible === false
                ? '✓'
                : t('shop:bundles.buyButton', { price: effectivePrice })}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

function BundlePurchaseModal({
  bundle,
  isPurchasing,
  onBuy,
  onClose,
}: {
  bundle: BundleConfig & { bundleId: ExtraBundleId };
  isPurchasing: boolean;
  onBuy: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = BUNDLE_THEME[bundle.bundleId];
  const Icon = theme.Icon;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center px-4">
      <motion.div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={isPurchasing ? undefined : onClose}
      />

      <motion.div
        className="relative z-10 w-full max-w-sm"
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 16 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      >
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0f1225] px-6 py-6 shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
          <button
            type="button"
            onClick={onClose}
            disabled={isPurchasing}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/40 transition-colors hover:text-white/80 disabled:opacity-40"
          >
            x
          </button>

          <div className={`mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border ${theme.iconBorder} ${theme.iconBg}`}>
            <Icon size={50} className={theme.iconColor} strokeWidth={1.85} />
          </div>

          <h2 className="text-xl font-bold text-white">{t(`shop:bundles.${bundle.bundleId}.title`)}</h2>
          <p className="mt-1 text-sm text-white/60">{t(`shop:bundles.${bundle.bundleId}.subtitle`)}</p>

          <div className="my-5 space-y-2.5">
            <div className="flex items-center gap-2.5 text-sm text-[#d2d7e5]">
              <Heart size={18} className="shrink-0 text-rose-400" />
              <span className="font-medium">{t('shop:bundles.revives', { count: bundle.revives })}</span>
            </div>
            <div className="flex items-center gap-2.5 text-sm text-[#d2d7e5]">
              <Lightbulb size={18} className="shrink-0 text-cyan-400" />
              <span className="font-medium">{t('shop:bundles.hints', { count: bundle.hints })}</span>
            </div>
            {!!bundle.extraLives && (
              <div className="flex items-center gap-2.5 text-sm text-rose-300">
                <Heart size={18} className="shrink-0 text-rose-300" strokeWidth={1.5} />
                <span className="font-medium">{t('shop:bundles.extraLives', { count: bundle.extraLives })}</span>
              </div>
            )}
          </div>

          <div className="mb-5 flex items-end gap-1.5">
            <span className="text-2xl font-black text-white">{bundle.priceStars} ⭐</span>
          </div>

          <motion.button
            type="button"
            onClick={onBuy}
            disabled={isPurchasing}
            className={`w-full py-4 rounded-2xl font-bold text-base text-white bg-gradient-to-r ${theme.btnFrom} ${theme.btnTo} disabled:opacity-60`}
            whileTap={{ scale: 0.97 }}
          >
            {isPurchasing
              ? t('shop:bundles.buying')
              : t('shop:bundles.buyButton', { price: bundle.priceStars })}
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}

export function ShopScreen() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const updateUser = useAppStore((s) => s.updateUser);
  const [tonConnectUI] = useTonConnectUI();
  const walletController = useWalletConnectionController();

  const [items, setItems] = useState<Array<ShopItem & { id: BoostId }>>([]);
  const [tonItems, setTonItems] = useState<ShopItem[]>([]);
  const [upgrades, setUpgrades] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [purchasingBundle, setPurchasingBundle] = useState<string | null>(null);
  const [tonStatus, setTonStatus] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<QuantityState>({ hints_1: 1, revive_1: 1 });

  // Case system
  const [caseInfo, setCaseInfo] = useState<CaseInfo | null>(null);
  const [caseModalOpen, setCaseModalOpen] = useState(false);
  const [caseCurrency, setCaseCurrency] = useState<'stars' | 'ton'>('stars');
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);

  // Welcome offer
  const [welcomeOffer, setWelcomeOffer] = useState<WelcomeOfferData | null>(null);
  const [showWelcomePopup, setShowWelcomePopup] = useState(false);
  const [confirmBundle, setConfirmBundle] = useState<(BundleConfig & { bundleId: ExtraBundleId }) | null>(null);
  const [offerTimerExpired, setOfferTimerExpired] = useState(false);

  // Purchase success overlay
  const [purchaseSuccess, setPurchaseSuccess] = useState<(PurchaseSuccessData & { visible: boolean }) | null>(null);
  const showPurchaseSuccess = useCallback((data: PurchaseSuccessData) => {
    setPurchaseSuccess({ ...data, visible: true });
  }, []);
  const hidePurchaseSuccess = useCallback(() => {
    setPurchaseSuccess(null);
  }, []);

  useEffect(() => {
    if (!welcomeOffer?.expiresAt) {
      setOfferTimerExpired(false);
      return;
    }
    const tick = () => {
      if (Date.parse(welcomeOffer.expiresAt!) - Date.now() <= 0) {
        setOfferTimerExpired(true);
      } else {
        setOfferTimerExpired(false);
      }
    };
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [welcomeOffer?.expiresAt]);

  const offerDiscounted = (welcomeOffer?.discounted ?? false) && !offerTimerExpired;

  const coinBalance = user?.coins ?? 0;
  const hintBalance = user?.hintBalance ?? 0;
  const reviveBalance = user?.reviveBalance ?? 0;

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [catalog, info] = await Promise.allSettled([
        shopApi.getCatalog(),
        CASE_ENABLED ? caseApi.getInfo() : Promise.reject(new Error('disabled')),
      ]);

      if (catalog.status === 'fulfilled') {
        setItems(normalizeBoosts(catalog.value.boosts));
        setTonItems([...catalog.value.arrowSkins, ...catalog.value.themes].filter((item) => item.priceTon != null));
        setUpgrades(catalog.value.upgrades ?? []);
      } else {
        throw catalog.reason;
      }

      if (info.status === 'fulfilled') {
        setCaseInfo(info.value);
      }
    } catch (catalogError) {
      setError(handleApiError(catalogError));
      setItems([]);
      setTonItems([]);
      setUpgrades([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    shopApi.getWelcomeOffer().then((data) => {
      setWelcomeOffer(data);
      if (data.eligible && data.discounted) {
        setShowWelcomePopup(true);
      }
    }).catch(() => undefined);
  }, []);

  const boostMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const setQuantity = useCallback((boostId: BoostId, nextValue: number) => {
    setQuantities((prev) => ({
      ...prev,
      [boostId]: clampBoostQuantity(nextValue),
    }));
  }, []);

  const handlePurchase = useCallback(async (item: ShopItem & { id: BoostId }, quantity: number) => {
    if (purchasingId || calculateBoostTotalPrice(item, quantity) > coinBalance) return;

    setPurchasingId(item.id);
    setPurchaseError(null);

    try {
      const result = await shopApi.purchaseCoins('boosts', item.id, quantity);
      if (!result.success) {
        setPurchaseError(getErrorCodeMessage(result.error, translate('errors:generic.server')));
        return;
      }

      updateUser({
        coins: result.coins,
        hintBalance: result.hintBalance ?? hintBalance,
        reviveBalance: result.reviveBalance ?? reviveBalance,
      });

      setQuantities((prev) => ({ ...prev, [item.id]: 1 }));

      const purchasedHints   = item.id === 'hints_1'  ? quantity : 0;
      const purchasedRevives = item.id === 'revive_1' ? quantity : 0;
      showPurchaseSuccess({
        type:         item.id === 'hints_1' ? 'hints' : 'revives',
        hintsCount:   purchasedHints,
        revivesCount: purchasedRevives,
      });
    } catch (purchaseErr) {
      setPurchaseError(handleApiError(purchaseErr));
    } finally {
      setPurchasingId(null);
    }
  }, [coinBalance, hintBalance, purchasingId, reviveBalance, updateUser]);

  const handleBundlePurchase = useCallback(async (bundleId: BundleId) => {
    if (purchasingBundle) return;
    setPurchasingBundle(bundleId);
    setPurchaseError(null);

    try {
      const { invoiceUrl } = bundleId === 'starter'
        ? await shopApi.purchaseWelcomeOffer()
        : await shopApi.purchaseBundle(bundleId);

      const tg = (window as Window & { Telegram?: { WebApp?: { openInvoice?: (url: string, cb: (status: string) => void) => void } } }).Telegram?.WebApp;
      if (!tg?.openInvoice) {
        setPurchaseError('Telegram WebApp not available');
        setPurchasingBundle(null);
        return;
      }

      tg.openInvoice(invoiceUrl, async (status) => {
        if (status === 'paid') {
          try {
            const freshUser = await authApi.getMe();
            const addedHints   = Math.max(0, (freshUser.hintBalance   ?? 0) - (user?.hintBalance   ?? 0));
            const addedRevives = Math.max(0, (freshUser.reviveBalance ?? 0) - (user?.reviveBalance ?? 0));
            updateUser({
              hintBalance: freshUser.hintBalance,
              reviveBalance: freshUser.reviveBalance,
              extraLives: freshUser.extraLives,
              ...(bundleId === 'starter' ? { welcomeOfferPurchased: freshUser.welcomeOfferPurchased } : {}),
            });
            if (bundleId === 'starter') {
              setWelcomeOffer((prev) => prev ? { ...prev, eligible: false } : prev);
            } else {
              setConfirmBundle(null);
            }
            showPurchaseSuccess({
              type: 'bundle',
              hintsCount:   addedHints,
              revivesCount: addedRevives,
            });
          } catch {
            // non-critical
          }
        }
        setPurchasingBundle(null);
      });
    } catch (err) {
      setPurchaseError(handleApiError(err));
      setPurchasingBundle(null);
    }
  }, [purchasingBundle, updateUser]);

  const handleTonPurchase = useCallback(async (item: ShopItem) => {
    if (purchasingId) return;

    if (!user?.walletAddress) {
      setPurchaseError(t('shop:ton.connectWalletFirst'));
      return;
    }

    const itemType = item.id === 'extra_life' ? 'boosts'
      : item.id.startsWith('vip') ? 'boosts'
      : ['diamond', 'cyber', 'rainbow', 'neon', 'fire', 'ice', 'gold', 'default'].includes(item.id) ? 'arrow_skins'
      : 'themes';

    setPurchasingId(item.id);
    setPurchaseError(null);
    setTonStatus(t('shop:ton.createTx'));

    try {
      const paymentInfo = await shopApi.purchaseTon(itemType, item.id);

      const alreadySent = readPendingTxId() === paymentInfo.transaction_id;

      if (!alreadySent) {
        setTonStatus(t('shop:ton.confirmWallet'));

        const amountNano = paymentInfo.amount_nano ?? String(Math.round(paymentInfo.amount * 1e9));
        const commentPayload = buildCommentPayload(paymentInfo.comment);

        await tonConnectUI.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 600,
          messages: [
            {
              address: paymentInfo.address,
              amount: amountNano,
              payload: commentPayload,
            },
          ],
        });

        savePendingTxId(paymentInfo.transaction_id);
      }

      setTonStatus(t('shop:ton.awaitingConfirmation'));

      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          const result = await shopApi.confirmTransaction(paymentInfo.transaction_id);
          if (result.status === 'completed') {
            clearPendingTxId();
            setTonStatus(null);
            setPurchaseError(null);
            if (item.id === 'extra_life' && result.extra_lives != null) {
              updateUser({ extraLives: result.extra_lives });
            }
            void loadCatalog();
            return;
          }
        } catch {
          // Keep polling until timeout.
        }
      }

      setTonStatus(null);
      void loadCatalog();
      setPurchaseError(t('shop:ton.pendingConfirmation'));
    } catch (errorValue) {
      console.error('[TON purchase error]', errorValue);
      const message = errorValue instanceof Error
        ? errorValue.message
        : typeof errorValue === 'string'
          ? errorValue
          : JSON.stringify(errorValue);

      setTonStatus(null);
      if (isWalletRejection(message)) {
        return;
      }

      setPurchaseError(handleApiError(errorValue));
    } finally {
      setPurchasingId(null);
    }
  }, [loadCatalog, purchasingId, t, tonConnectUI, updateUser, user?.walletAddress]);

  const hasStoreContent = items.length > 0 || tonItems.length > 0 || upgrades.length > 0;

  return (
    <>
    {purchaseSuccess && (
      <PurchaseSuccessOverlay
        type={purchaseSuccess.type}
        hintsCount={purchaseSuccess.hintsCount}
        revivesCount={purchaseSuccess.revivesCount}
        visible={purchaseSuccess.visible}
        onDone={hidePurchaseSuccess}
      />
    )}
    <div className="custom-scrollbar relative h-full overflow-y-auto px-4 pb-nav pt-6">
      <AdaptiveParticles
        variant="bg"
        tone="neutral"
        baseCount={16}
        baseSpeed={0.08}
        className="z-0 opacity-22"
      />

      <div className="relative z-10">
        <HeaderBar
          balance={coinBalance}
          walletMode={walletController.walletMode}
          walletDisplay={walletController.walletDisplay}
          walletError={walletController.walletError}
          showDisconnectAction={walletController.showDisconnectAction}
          onWalletClick={walletController.onWalletClick}
          onDisconnect={walletController.onDisconnect}
          animated={false}
          className="mt-2 mb-3 shrink-0"
        />

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-3 rounded-[28px] border border-white/10 bg-[#14182b]/80 px-4 py-4 shadow-[0_14px_36px_rgba(0,0,0,0.22)] backdrop-blur-xl"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white/60">
            <ShoppingBag size={13} />
            {t('shop:badge')}
          </div>

          <p className="mt-3 text-[15px] leading-7 text-[#d2d7e5]">
            {t('shop:intro')}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.05] px-3 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8bb8cb]">{t('shop:balances.hints')}</div>
              <div className="mt-1 flex items-center gap-2 text-xl font-black text-[#f7f8fb]">
                <Lightbulb size={15} className="text-cyan-300" />
                {formatNumber(hintBalance)}
              </div>
            </div>
            <div className="rounded-2xl border border-rose-500/15 bg-rose-500/[0.05] px-3 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#d2a1b1]">{t('shop:balances.revives')}</div>
              <div className="mt-1 flex items-center gap-2 text-xl font-black text-[#f7f8fb]">
                <Heart size={15} className="text-rose-300" />
                {formatNumber(reviveBalance)}
              </div>
            </div>
          </div>
        </motion.div>

        {purchaseError && (
          <div className="mb-3 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {purchaseError}
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="rounded-3xl border border-white/10 bg-[#111526]/75 px-6 py-5 text-white/70 backdrop-blur-xl">
              {t('shop:loading')}
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#111526]/75 p-6 text-center backdrop-blur-xl">
              <p className="text-lg font-bold text-white">{error}</p>
              <button
                type="button"
                onClick={() => void loadCatalog()}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 font-bold text-white transition hover:bg-white/15"
              >
                <RefreshCcw size={16} />
                {t('common:retry')}
              </button>
            </div>
          </div>
        ) : !hasStoreContent ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#111526]/75 p-6 text-center backdrop-blur-xl">
              <p className="text-lg font-bold text-white">{t('shop:unavailable')}</p>
              <p className="mt-2 text-sm text-white/60">{t('shop:unavailableDescription')}</p>
            </div>
          </div>
        ) : (
          <div className="pb-6">
            {tonStatus && (
              <div className="mb-3 rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
                {tonStatus}
              </div>
            )}

            {/* ── Case section ── */}
            {CASE_ENABLED && caseInfo && (
              <section className="mb-5">
                <div className="pl-1 mb-3 text-sm font-bold uppercase tracking-[0.18em] text-[#677086]">
                  {t('shop:cases.sectionTitle')}
                </div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-[24px] border border-white/5 bg-[#18181b]/60 p-5 backdrop-blur-md"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-amber-500/25 bg-amber-500/10 text-3xl">
                      🎁
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-bold text-[#f7f8fb]">{t('shop:cases.name')}</h2>
                      <p className="mt-0.5 text-sm text-[#a7abb8]">{t('shop:cases.description')}</p>
                      {(user?.starsBalance ?? 0) > 0 && (
                        <div className="mt-1 flex items-center gap-2">
                          <p className="text-xs text-yellow-400/80">
                            ⭐ {t('shop:cases.starsBalance', { count: user?.starsBalance ?? 0 })}
                          </p>
                          {(user?.starsBalance ?? 0) >= 50 && (
                            <button
                              onClick={() => setWithdrawalOpen(true)}
                              className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold transition-opacity hover:opacity-80 active:opacity-60"
                              style={{
                                background: 'linear-gradient(135deg,rgba(251,191,36,0.22),rgba(245,158,11,0.14))',
                                border: '1px solid rgba(251,191,36,0.35)',
                                color: 'rgba(251,191,36,0.95)',
                              }}
                            >
                              ↑ {t('shop:cases.withdrawLink')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Pity progress */}
                  <div className="mt-4">
                    <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                      <span>
                        {caseInfo.pityCounter >= caseInfo.pityThreshold - 1
                          ? t('shop:cases.pityMaxLabel')
                          : t('shop:cases.pityLabel', { count: caseInfo.pityThreshold - caseInfo.pityCounter })}
                      </span>
                      <span className="text-gray-600">{caseInfo.pityCounter}/{caseInfo.pityThreshold}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-white/8 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-400"
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, (caseInfo.pityCounter / caseInfo.pityThreshold) * 100)}%` }}
                        transition={{ duration: 0.7, ease: 'easeOut', delay: 0.2 }}
                      />
                    </div>
                  </div>

                  {/* Payment buttons */}
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={() => { setCaseCurrency('stars'); setCaseModalOpen(true); }}
                      className="flex-1 py-3 rounded-2xl font-bold text-sm text-white transition-all active:scale-95"
                      style={{ background: 'linear-gradient(135deg, #7C3AED, #4F46E5)' }}
                    >
                      ✨ {caseInfo.priceStars} ⭐
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCaseCurrency('ton'); setCaseModalOpen(true); }}
                      className="flex-1 py-3 rounded-2xl font-bold text-sm text-white transition-all active:scale-95"
                      style={{ background: 'linear-gradient(135deg, #0EA5E9, #2563EB)' }}
                    >
                      💎 {caseInfo.priceTon} TON
                    </button>
                  </div>
                </motion.div>
              </section>
            )}

            {/* ── DEV: reset welcome offer ── */}
            {SHOW_DEV_TOOLS && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await shopApi.devResetWelcomeOffer();
                    const data = await shopApi.getWelcomeOffer();
                    setWelcomeOffer(data);
                    setOfferTimerExpired(false);
                    if (data.eligible && data.discounted) setShowWelcomePopup(true);
                  } catch { /* ignore */ }
                }}
                className="mb-3 w-full py-2 rounded-xl text-xs font-semibold bg-white/10 text-white/60 hover:bg-white/15 active:scale-95 transition-all"
              >
                🎁 DEV: Reset Welcome Offer
              </button>
            )}

            {/* ── Bundles section ── */}
            {welcomeOffer !== null && (
              <section className="mb-5 space-y-3">
                <div className="pl-1 text-sm font-bold uppercase tracking-[0.18em] text-[#677086]">
                  {t('shop:bundles.sectionTitle')}
                </div>

                {/* Starter — only while eligible (new user offer) */}
                {welcomeOffer.eligible && (
                  <BundleCard
                    bundleId="starter"
                    hints={welcomeOffer.hints}
                    revives={welcomeOffer.revives}
                    priceStars={50}
                    discounted={offerDiscounted}
                    discountedPrice={15}
                    expiresAt={welcomeOffer.expiresAt}
                    eligible={welcomeOffer.eligible}
                    isPurchasing={purchasingBundle === 'starter'}
                    onBuy={() => setShowWelcomePopup(true)}
                  />
                )}

                {EXTRA_BUNDLE_CONFIGS.map((bundle) => (
                  <BundleCard
                    key={bundle.bundleId}
                    bundleId={bundle.bundleId}
                    hints={bundle.hints}
                    revives={bundle.revives}
                    extraLives={bundle.extraLives}
                    priceStars={bundle.priceStars}
                    isPurchasing={purchasingBundle === bundle.bundleId}
                    onBuy={() => setConfirmBundle(bundle)}
                  />
                ))}
              </section>
            )}

            <section className="space-y-4">
              <div className="pl-1 text-sm font-bold uppercase tracking-[0.18em] text-[#677086]">{t('shop:consumables')}</div>

              {BOOST_IDS.map((boostId) => {
                const item = boostMap.get(boostId);
                if (!item) return null;

                return (
                  <BoostCard
                    key={boostId}
                    boostId={boostId}
                    item={item}
                    quantity={quantities[boostId]}
                    coinBalance={coinBalance}
                    isPurchasing={purchasingId === boostId}
                    onChangeQuantity={(value) => setQuantity(boostId, value)}
                    onPurchase={() => void handlePurchase(item, quantities[boostId])}
                  />
                );
              })}
            </section>

            {upgrades.length > 0 && (
              <section className="mt-5 space-y-4">
                <div className="pl-1 text-sm font-bold uppercase tracking-[0.18em] text-[#677086]">{t('shop:upgrades')}</div>

                {upgrades.map((item) => {
                  const purchased = item.purchasedCount ?? 0;
                  const maxP = item.maxPurchases ?? 2;
                  const isMaxed = purchased >= maxP;
                  const noWallet = !user?.walletAddress;

                  return (
                    <motion.section
                      key={item.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-[24px] border border-white/5 bg-[#18181b]/60 p-5 backdrop-blur-md"
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-pink-500/20 bg-pink-500/10">
                          <Heart size={24} className="text-pink-400" strokeWidth={2.5} />
                        </div>
                        <div className="min-w-0">
                          <h2 className="text-xl font-bold text-[#f7f8fb]">{item.name}</h2>
                          <p className="mt-1 text-sm leading-relaxed text-[#a7abb8]">
                            {item.description || t('shop:items.extra_life.description')}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex gap-1">
                              {Array.from({ length: maxP }, (_, i) => (
                                <div
                                  key={i}
                                  className={`h-1.5 w-8 rounded-full ${i < purchased ? 'bg-pink-400' : 'bg-white/10'}`}
                                />
                              ))}
                            </div>
                            <span className="text-xs text-[#677086]">{formatNumber(purchased)}/{formatNumber(maxP)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-6 flex items-center">
                        <button
                          type="button"
                          onClick={() => void handleTonPurchase(item)}
                          disabled={!!purchasingId || isMaxed || noWallet}
                          className="relative flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-pink-500 font-bold text-white transition-all hover:bg-pink-400 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                        >
                          {purchasingId === item.id ? (
                            <span className="animate-pulse">{t('common:processing')}</span>
                          ) : isMaxed ? (
                            <span>{t('common:max')}</span>
                          ) : noWallet ? (
                            <span>{t('common:connectWallet')}</span>
                          ) : (
                            <>
                              <span>{t('common:buy')}</span>
                              <div className="mx-1 h-4 w-px bg-black/20" />
                              <span>{formatNumber(item.priceTon ?? 0)} TON</span>
                            </>
                          )}
                        </button>
                      </div>
                    </motion.section>
                  );
                })}
              </section>
            )}

            {tonItems.length > 0 && (
              <div className="mt-5">
                <div className="mb-3 flex items-center gap-2">
                  <Diamond size={16} className="text-violet-400" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-300/80">{t('shop:premium')}</span>
                </div>

                <div className="space-y-3">
                  {tonItems.map((item, index) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.06 * index }}
                      className="rounded-[24px] border border-white/5 bg-[#18181b]/60 p-5 backdrop-blur-md"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-400/10 text-2xl text-violet-200">
                          {item.preview || '💎'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-base font-bold text-white">{item.name}</h3>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleTonPurchase(item)}
                          disabled={!!purchasingId || item.owned === true}
                          className="shrink-0 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-600 px-4 py-2.5 text-sm font-black text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {item.owned
                            ? t('common:owned')
                            : purchasingId === item.id
                              ? '...'
                              : `${formatNumber(item.priceTon ?? 0)} TON`}
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Case opening modal */}
      {CASE_ENABLED && caseInfo && (
        <CaseOpenModal
          isOpen={caseModalOpen}
          currency={caseCurrency}
          caseInfo={caseInfo}
          onClose={() => setCaseModalOpen(false)}
          onOpenMore={(cur) => {
            setCaseCurrency(cur);
            setCaseModalOpen(false);
            // Brief delay so the old modal fully exits before re-opening
            setTimeout(() => setCaseModalOpen(true), 300);
          }}
          onRewardGranted={(result: CaseOpenResult) => {
            updateUser({
              hintBalance: result.hintBalance,
              reviveBalance: result.reviveBalance,
              coins: result.coins,
              starsBalance: result.starsBalance,
              casePityCounter: result.casePityCounter,
            });
            // Refresh pity counter on the case card
            setCaseInfo((prev) => prev
              ? { ...prev, pityCounter: result.casePityCounter }
              : prev
            );
          }}
        />
      )}

      {/* Stars withdrawal modal */}
      {CASE_ENABLED && (
        <WithdrawalModal
          isOpen={withdrawalOpen}
          onClose={() => setWithdrawalOpen(false)}
        />
      )}

      {/* Welcome offer popup */}
      {showWelcomePopup && welcomeOffer && (
        <WelcomeOfferModal
          offer={welcomeOffer}
          onClose={() => setShowWelcomePopup(false)}
          onPurchased={() => {
            setWelcomeOffer((prev) => prev ? { ...prev, eligible: false } : prev);
          }}
        />
      )}

      {confirmBundle && (
        <BundlePurchaseModal
          bundle={confirmBundle}
          isPurchasing={purchasingBundle === confirmBundle.bundleId}
          onClose={() => {
            if (!purchasingBundle) setConfirmBundle(null);
          }}
          onBuy={() => void handleBundlePurchase(confirmBundle.bundleId)}
        />
      )}
    </div>
    </>
  );
}
