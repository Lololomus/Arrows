import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { shopApi, type WelcomeOfferData } from '../api/client';
import { authApi } from '../api/client';
import { useAppStore } from '../stores/store';

interface WelcomeOfferModalProps {
  offer: WelcomeOfferData;
  onClose: () => void;
  onPurchased: () => void;
}

function useCountdown(expiresAt: string | null): { display: string; expired: boolean } {
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
      if (diff <= 0) {
        setDisplay('00:00:00');
        setExpired(true);
        return;
      }
      setExpired(false);
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setDisplay(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
      );
    };

    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  return { display, expired };
}

export function WelcomeOfferModal({ offer, onClose, onPurchased }: WelcomeOfferModalProps) {
  const { t } = useTranslation();
  const updateUser = useAppStore((s) => s.updateUser);
  const { display: countdown, expired: timerExpired } = useCountdown(offer.discounted ? offer.expiresAt : null);
  // Once the countdown hits 0, treat as non-discounted so UI matches server price
  const showAsDiscounted = offer.discounted && !timerExpired;
  const buttonPriceStars = showAsDiscounted ? offer.priceStars : 50;
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closedByPurchase = useRef(false);

  const handleBuy = async () => {
    if (buying) return;
    setBuying(true);
    setError(null);
    try {
      const { invoiceUrl } = await shopApi.purchaseWelcomeOffer();
      const tg = (window as Window & { Telegram?: { WebApp?: { openInvoice?: (url: string, cb: (status: string) => void) => void } } }).Telegram?.WebApp;
      if (!tg?.openInvoice) {
        setError('Telegram WebApp not available');
        setBuying(false);
        return;
      }
      // Keep buying=true until invoice is fully closed — prevents second tap
      tg.openInvoice(invoiceUrl, async (status) => {
        setBuying(false);
        if (status === 'paid') {
          closedByPurchase.current = true;
          try {
            const freshUser = await authApi.getMe();
            updateUser({
              hintBalance: freshUser.hintBalance,
              reviveBalance: freshUser.reviveBalance,
              welcomeOfferPurchased: freshUser.welcomeOfferPurchased,
            });
          } catch {
            // non-critical
          }
          onPurchased();
          onClose();
        }
      });
      // intentionally no finally — buying resets in the invoice callback
    } catch {
      setError(t('errors:generic.server'));
      setBuying(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center px-4">
      {/* backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      <motion.div
        className="relative z-10 w-full max-w-sm"
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 16 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      >
        <div className="rounded-3xl border border-white/10 bg-[#0f1225] px-6 py-6 shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
          {/* close button */}
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/40 hover:text-white/80 transition-colors"
          >
            ✕
          </button>

          {showAsDiscounted && (
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-300">
              {t('shop:welcomeOffer.limitedBadge')}
            </div>
          )}

          <h2 className="text-xl font-bold text-white mb-1">{t('shop:welcomeOffer.title')}</h2>
          <p className="text-white/60 text-sm mb-4">{t('shop:welcomeOffer.description')}</p>

          {/* Timer */}
          {showAsDiscounted && countdown && (
            <div className="mb-4 rounded-2xl bg-white/5 px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-white/50">{t('shop:welcomeOffer.timerLabel')}</span>
              <span className="font-mono text-sm font-bold text-amber-300">{countdown}</span>
            </div>
          )}

          {/* Price */}
          <div className="mb-4 flex items-end gap-2">
            {showAsDiscounted && (
              <span className="text-xs text-white/35 line-through mb-1">{t('shop:welcomeOffer.fullPrice')}</span>
            )}
            <span className="text-2xl font-black text-white">
              {showAsDiscounted ? t('shop:welcomeOffer.discountedPrice') : t('shop:welcomeOffer.fullPrice')}
            </span>
          </div>

          {error && (
            <p className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {error}
            </p>
          )}

          <motion.button
            type="button"
            onClick={() => void handleBuy()}
            disabled={buying}
            className="w-full py-4 rounded-2xl font-bold text-base text-white bg-gradient-to-r from-purple-600 to-pink-600 disabled:opacity-60"
            whileTap={{ scale: 0.97 }}
          >
            {buying
              ? t('shop:welcomeOffer.buying')
              : t('shop:welcomeOffer.buyButton', { price: buttonPriceStars })}
          </motion.button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
