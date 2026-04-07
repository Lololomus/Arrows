/**
 * CaseOpenModal — animated loot case opening experience.
 *
 * Phases:
 *  idle → chest_idle (show chest + pay buttons)
 *    Stars path: create_invoice → polling_stars → opening → revealing → result
 *    TON path:   awaiting_ton → opening → revealing → result
 *    Any path:   error
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useTonConnectUI } from '@tonconnect/ui-react';
import { Coins, Heart, Lightbulb, Star } from 'lucide-react';
import { AdaptiveParticles } from '../../components/ui/AdaptiveParticles';
import { caseApi } from '../../api/client';
import type { CaseInfo, CaseOpenResult, CaseRarity } from '../../game/types';

// ============================================================
// CONSTANTS & HELPERS
// ============================================================

const CASE_TON_TX_KEY = 'case_ton_pending_tx';
const CASE_TON_TX_TTL_MS = 24 * 60 * 60 * 1000;

function readPendingCaseTxId(): number | null {
  try {
    const raw = localStorage.getItem(CASE_TON_TX_KEY);
    if (!raw) return null;
    const { txId, ts } = JSON.parse(raw) as { txId: number; ts: number };
    if (Date.now() - ts > CASE_TON_TX_TTL_MS) {
      localStorage.removeItem(CASE_TON_TX_KEY);
      return null;
    }
    return txId;
  } catch {
    return null;
  }
}

function savePendingCaseTxId(txId: number) {
  localStorage.setItem(CASE_TON_TX_KEY, JSON.stringify({ txId, ts: Date.now() }));
}

function clearPendingCaseTxId() {
  localStorage.removeItem(CASE_TON_TX_KEY);
}

function buildCommentPayload(comment: string): string {
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(comment);
  const dataBytes = new Uint8Array(4 + textBytes.length);
  dataBytes.set(textBytes, 4);
  const dataBits = dataBytes.length * 8;
  const cellDescriptor2 = Math.ceil(dataBits / 8) * 2 + (dataBits % 8 !== 0 ? 1 : 0);
  const bocMagic = new Uint8Array([0xb5, 0xee, 0x9c, 0x72]);
  const totalCellSize = 2 + dataBytes.length;
  const boc = new Uint8Array(4 + 1 + 5 + 2 + 1 + dataBytes.length);
  let offset = 0;
  boc.set(bocMagic, offset); offset += 4;
  boc[offset++] = 0x01;
  boc[offset++] = 1;
  boc[offset++] = 1;
  boc[offset++] = 1;
  boc[offset++] = 0;
  boc[offset++] = totalCellSize;
  boc[offset++] = 0;
  boc[offset++] = 0x00;
  boc[offset++] = cellDescriptor2;
  boc.set(dataBytes, offset);
  let binary = '';
  for (let i = 0; i < boc.length; i++) binary += String.fromCharCode(boc[i]);
  return btoa(binary);
}

function triggerHaptic(style: 'light' | 'medium' | 'heavy' | 'success' | 'error') {
  const tg = (window as Window & { Telegram?: { WebApp?: { HapticFeedback?: { impactOccurred: (s: string) => void; notificationOccurred: (s: string) => void } } } }).Telegram?.WebApp;
  if (!tg?.HapticFeedback) return;
  if (style === 'success') tg.HapticFeedback.notificationOccurred('success');
  else if (style === 'error') tg.HapticFeedback.notificationOccurred('error');
  else tg.HapticFeedback.impactOccurred(style);
}

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ============================================================
// RARITY THEME
// ============================================================

type RarityTheme = {
  glow: string;
  glowRgb: string;
  bg: string;
  badgeClass: string;
  chestEmoji: string;
  particleTone: 'neutral' | 'violet' | 'gold';
  particleCount: number;
};

const RARITY_THEME: Record<CaseRarity, RarityTheme> = {
  common: {
    glow: '#9CA3AF',
    glowRgb: '156,163,175',
    bg: 'from-gray-900/80 to-slate-900/80',
    badgeClass: 'bg-gray-500/20 text-gray-300 border border-gray-500/30',
    chestEmoji: '📦',
    particleTone: 'neutral',
    particleCount: 0,
  },
  rare: {
    glow: '#8B5CF6',
    glowRgb: '139,92,246',
    bg: 'from-violet-950/80 to-blue-950/80',
    badgeClass: 'bg-violet-500/20 text-violet-200 border border-violet-500/40',
    chestEmoji: '💜',
    particleTone: 'violet',
    particleCount: 15,
  },
  epic: {
    glow: '#F59E0B',
    glowRgb: '245,158,11',
    bg: 'from-amber-950/80 to-orange-950/80',
    badgeClass: 'bg-amber-500/20 text-amber-200 border border-amber-500/40',
    chestEmoji: '🏆',
    particleTone: 'gold',
    particleCount: 25,
  },
  epic_stars: {
    glow: '#F59E0B',
    glowRgb: '245,158,11',
    bg: 'from-amber-950/80 to-yellow-950/80',
    badgeClass: 'bg-yellow-500/20 text-yellow-200 border border-yellow-400/50',
    chestEmoji: '🌟',
    particleTone: 'gold',
    particleCount: 40,
  },
};

// ============================================================
// REWARD ICON
// ============================================================

function RewardIcon({ type }: { type: string }) {
  const cls = 'w-5 h-5';
  if (type === 'hints') return <Lightbulb className={`${cls} text-cyan-400`} />;
  if (type === 'revives') return <Heart className={`${cls} text-rose-400`} />;
  if (type === 'coins') return <Coins className={`${cls} text-yellow-400`} />;
  if (type === 'stars') return <Star className={`${cls} text-yellow-300`} />;
  return null;
}

// ============================================================
// PHASE STATE MACHINE
// ============================================================

type Phase =
  | 'chest_idle'
  | 'create_invoice'
  | 'polling_stars'
  | 'awaiting_ton'
  | 'opening'
  | 'revealing'
  | 'result'
  | 'error';

// ============================================================
// MAIN COMPONENT
// ============================================================

export interface CaseOpenModalProps {
  isOpen: boolean;
  currency: 'stars' | 'ton';
  caseInfo: CaseInfo;
  onClose: () => void;
  onOpenMore: (currency: 'stars' | 'ton') => void;
  onRewardGranted?: (result: CaseOpenResult) => void;
}

export function CaseOpenModal({
  isOpen,
  currency,
  caseInfo,
  onClose,
  onOpenMore,
  onRewardGranted,
}: CaseOpenModalProps) {
  const { t } = useTranslation();
  const [tonConnectUI] = useTonConnectUI();

  const [phase, setPhase] = useState<Phase>('chest_idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState<CaseOpenResult | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [isBurst, setIsBurst] = useState(false);
  const [revealedCount, setRevealedCount] = useState(0);
  const pendingResultRef = useRef<CaseOpenResult | null>(null);
  const pollCancelRef = useRef(false);

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setPhase('chest_idle');
      setErrorMsg('');
      setResult(null);
      setIsShaking(false);
      setIsBurst(false);
      setRevealedCount(0);
      pendingResultRef.current = null;
      pollCancelRef.current = false;
    }
    return () => { pollCancelRef.current = true; };
  }, [isOpen]);

  // ── Stars flow ──────────────────────────────────────────
  const handleStarsOpen = useCallback(async () => {
    setPhase('create_invoice');
    try {
      const { invoiceUrl } = await caseApi.createStarsInvoice();
      const tgWebApp = (window as Window & { Telegram?: { WebApp?: { openInvoice?: (url: string, cb: (status: string) => void) => void } } }).Telegram?.WebApp;
      if (!tgWebApp?.openInvoice) {
        setErrorMsg(t('shop:cases.error.timeout'));
        setPhase('error');
        return;
      }

      tgWebApp.openInvoice(invoiceUrl, async (status) => {
        if (status !== 'paid') {
          setPhase('chest_idle');
          return;
        }
        setPhase('polling_stars');
        pollCancelRef.current = false;

        for (let i = 0; i < 20; i++) {
          if (pollCancelRef.current) return;
          await sleep(1500);
          try {
            const res = await caseApi.pollResult();
            if (res) {
              pendingResultRef.current = res;
              startOpenAnimation();
              return;
            }
          } catch {
            // keep polling
          }
        }
        setErrorMsg(t('shop:cases.error.timeout'));
        setPhase('error');
      });
    } catch {
      setErrorMsg(t('shop:cases.error.timeout'));
      setPhase('error');
    }
  }, [startOpenAnimation, t]);

  // ── TON flow ────────────────────────────────────────────
  const handleTonOpen = useCallback(async () => {
    if (!tonConnectUI.connected) {
      setErrorMsg(t('shop:cases.error.connectWallet'));
      setPhase('error');
      return;
    }

    setPhase('awaiting_ton');
    try {
      const pendingTxId = readPendingCaseTxId();
      if (pendingTxId != null) {
        try {
          const recovered = await caseApi.confirmTon(pendingTxId);
          if (recovered.status === 'completed' && recovered.caseResult) {
            clearPendingCaseTxId();
            pendingResultRef.current = recovered.caseResult;
            startOpenAnimation();
            return;
          }
        } catch {
          // TX expired/failed on backend — clear stale entry and create fresh TX
          clearPendingCaseTxId();
        }
      }

      const info = await caseApi.openTon();
      const alreadySent = readPendingCaseTxId() === info.transactionId;

      if (!alreadySent) {
        await tonConnectUI.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 600,
          messages: [{
            address: info.address,
            amount: info.amountNano,
            payload: buildCommentPayload(info.comment),
          }],
        });
        savePendingCaseTxId(info.transactionId);
      }

      const completed = await pollTonConfirmation(info.transactionId, 20);
      if (completed) return;

      setErrorMsg(t('shop:cases.error.tonPending'));
      setPhase('error');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (!msg.toLowerCase().includes('cancel') && !msg.toLowerCase().includes('reject') && !msg.toLowerCase().includes('interrupt')) {
        setErrorMsg(t('shop:cases.error.tonPending'));
        setPhase('error');
      } else {
        setPhase('chest_idle');
      }
    }
  }, [pollTonConfirmation, startOpenAnimation, t, tonConnectUI]);

  // ── Opening animation ───────────────────────────────────
  function startOpenAnimation() {
    triggerHaptic('medium');
    setIsShaking(true);
    setTimeout(() => {
      setIsShaking(false);
      setIsBurst(true);
      setPhase('opening');
      setTimeout(() => {
        setIsBurst(false);
        setPhase('revealing');
        const res = pendingResultRef.current!;
        // Stagger reveal items
        res.rewards.forEach((_, idx) => {
          setTimeout(() => setRevealedCount(idx + 1), idx * 200 + 100);
        });
        // Move to result after all items
        setTimeout(() => {
          setResult(res);
          setPhase('result');
          const rarity = res.rarity;
          onRewardGranted?.(res);
          if (rarity === 'epic' || rarity === 'epic_stars') {
            triggerHaptic('success');
          } else if (rarity === 'rare') {
            triggerHaptic('light');
          }
        }, res.rewards.length * 200 + 600);
      }, 800);
    }, 550);
  }

  async function pollTonConfirmation(txId: number, attempts: number): Promise<boolean> {
    pollCancelRef.current = false;
    for (let i = 0; i < attempts; i++) {
      if (pollCancelRef.current) return false;
      if (i > 0) await sleep(2000);
      try {
        const confirmation = await caseApi.confirmTon(txId);
        if (confirmation.status === 'completed' && confirmation.caseResult) {
          clearPendingCaseTxId();
          pendingResultRef.current = confirmation.caseResult;
          startOpenAnimation();
          return true;
        }
        if (confirmation.status !== 'pending') {
          break;
        }
      } catch {
        // keep polling on transient errors
      }
    }
    return false;
  }

  // ── Retry Stars poll ────────────────────────────────────
  const retryPoll = useCallback(async () => {
    setErrorMsg('');
    if (currency === 'ton') {
      const txId = readPendingCaseTxId();
      if (txId == null) {
        setErrorMsg(t('shop:cases.error.tonPending'));
        setPhase('error');
        return;
      }
      setPhase('awaiting_ton');
      const completed = await pollTonConfirmation(txId, 10);
      if (completed) return;
      setErrorMsg(t('shop:cases.error.tonPending'));
      setPhase('error');
      return;
    }

    setPhase('polling_stars');
    pollCancelRef.current = false;
    for (let i = 0; i < 10; i++) {
      if (pollCancelRef.current) return;
      await sleep(1500);
      try {
        const res = await caseApi.pollResult();
        if (res) {
          pendingResultRef.current = res;
          startOpenAnimation();
          return;
        }
      } catch {
        // keep
      }
    }
    setErrorMsg(t('shop:cases.error.timeout'));
    setPhase('error');
  }, [currency, pollTonConfirmation, startOpenAnimation, t]);

  const handleDevOpen = useCallback(async () => {
    setPhase('polling_stars'); // reuse polling phase as "loading"
    try {
      const res = await caseApi.openDev();
      pendingResultRef.current = res;
      startOpenAnimation();
    } catch {
      setErrorMsg(t('shop:cases.error.devFailed'));
      setPhase('error');
    }
  }, [startOpenAnimation, t]);

  const handleOpen = useCallback(() => {
    if (import.meta.env.DEV) { void handleDevOpen(); return; }
    if (currency === 'stars') handleStarsOpen();
    else handleTonOpen();
  }, [currency, handleDevOpen, handleStarsOpen, handleTonOpen]);

  const handleOpenMore = useCallback(() => {
    onOpenMore(currency);
  }, [currency, onOpenMore]);

  // ============================================================
  // RENDER
  // ============================================================

  if (!isOpen) return null;

  const rarity = result?.rarity ?? 'common';
  const theme = RARITY_THEME[rarity];
  const isResultPhase = phase === 'result';
  const rarityLabel = t(`shop:cases.rarity.${rarity}`);

  const canDismiss = phase === 'chest_idle' || phase === 'result' || phase === 'error';

  const modal = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="case-modal-overlay"
          className="fixed inset-0 z-[2000] flex flex-col items-center justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/75 backdrop-blur-[2px]"
            onClick={canDismiss ? onClose : undefined}
          />

          {/* Sheet */}
          <motion.div
            key="case-modal-sheet"
            className={`relative w-full rounded-t-[32px] bg-gradient-to-b ${isResultPhase ? theme.bg : 'from-gray-900 to-slate-900'} overflow-hidden shadow-[0_-10px_40px_rgba(0,0,0,0.5)]`}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            drag={canDismiss ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(_e: never, info: { offset: { y: number }; velocity: { y: number } }) => {
              if (canDismiss && (info.offset.y > 100 || info.velocity.y > 500)) onClose();
            }}
            style={{
              maxHeight: '90dvh',
              paddingBottom: 'calc(1.5rem + var(--app-safe-bottom, 0px))',
            }}
          >
            {/* Epic/Rare particles */}
            {isResultPhase && theme.particleCount > 0 && (
              <div className="absolute inset-0 pointer-events-none">
                <AdaptiveParticles
                  variant="hero"
                  tone={theme.particleTone}
                  baseCount={theme.particleCount}
                  enabled
                />
              </div>
            )}

            {/* Drag handle */}
            <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mt-3 mb-1" />

            <div className="px-6 pb-8 pt-2 flex flex-col items-center gap-5">

              {/* ── Chest + status phases ── */}
              {(phase === 'chest_idle' || phase === 'create_invoice' || phase === 'polling_stars' || phase === 'awaiting_ton' || phase === 'opening') && (
                <>
                  {/* Chest graphic */}
                  <div className="relative flex items-center justify-center w-36 h-36">
                    {/* Glow ring */}
                    <motion.div
                      className="absolute inset-0 rounded-full"
                      animate={phase === 'chest_idle' ? {
                        boxShadow: [
                          '0 0 20px 4px rgba(250,204,21,0.15)',
                          '0 0 40px 10px rgba(250,204,21,0.30)',
                          '0 0 20px 4px rgba(250,204,21,0.15)',
                        ],
                      } : {}}
                      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                    />

                    {/* Chest emoji / icon */}
                    <motion.div
                      className="text-7xl select-none"
                      animate={phase === 'chest_idle' ? {
                        scale: [1, 1.04, 1],
                      } : isShaking ? {
                        x: [0, -10, 10, -8, 8, -5, 5, 0],
                      } : isBurst ? {
                        scale: [1, 1.3, 0],
                        opacity: [1, 1, 0],
                      } : {}}
                      transition={phase === 'chest_idle' ? {
                        duration: 2,
                        repeat: Infinity,
                        ease: 'easeInOut',
                      } : isShaking ? {
                        duration: 0.55,
                        ease: 'easeInOut',
                      } : {
                        duration: 0.4,
                      }}
                    >
                      🎁
                    </motion.div>

                    {/* Light burst */}
                    {isBurst && (
                      <motion.div
                        className="absolute inset-0 rounded-full"
                        style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.9) 0%, transparent 70%)' }}
                        initial={{ scale: 0, opacity: 0.9 }}
                        animate={{ scale: 5, opacity: 0 }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                      />
                    )}
                  </div>

                  {/* Status text */}
                  <div className="text-center">
                    {phase === 'chest_idle' && (
                      <>
                        <p className="text-white font-semibold text-lg">{t('shop:cases.name')}</p>
                        <p className="text-gray-400 text-sm mt-1">{t('shop:cases.description')}</p>
                      </>
                    )}
                    {phase === 'create_invoice' && (
                      <p className="text-gray-300 text-sm animate-pulse">{t('shop:ton.createTx')}</p>
                    )}
                    {phase === 'polling_stars' && (
                      <p className="text-gray-300 text-sm animate-pulse">{t('shop:cases.phase.polling')}</p>
                    )}
                    {phase === 'awaiting_ton' && (
                      <p className="text-gray-300 text-sm animate-pulse">{t('shop:cases.phase.awaitingTon')}</p>
                    )}
                  </div>

                  {/* Pity bar */}
                  {phase === 'chest_idle' && (
                    <div className="w-full">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>
                          {caseInfo.pityCounter >= caseInfo.pityThreshold - 1
                            ? t('shop:cases.pityMaxLabel')
                            : t('shop:cases.pityLabel', { count: caseInfo.pityThreshold - caseInfo.pityCounter })}
                        </span>
                        <span>{caseInfo.pityCounter}/{caseInfo.pityThreshold}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                        <motion.div
                          className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-400"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, (caseInfo.pityCounter / caseInfo.pityThreshold) * 100)}%` }}
                          transition={{ duration: 0.6, ease: 'easeOut' }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Open button — only shown in idle */}
                  {phase === 'chest_idle' && (
                    <motion.button
                      onClick={handleOpen}
                      className="w-full py-3.5 rounded-2xl font-semibold text-base transition-all active:scale-95"
                      style={{
                        background: currency === 'stars'
                          ? 'linear-gradient(135deg, #7C3AED, #4F46E5)'
                          : 'linear-gradient(135deg, #0EA5E9, #2563EB)',
                      }}
                      whileTap={{ scale: 0.97 }}
                    >
                      {currency === 'stars'
                        ? `✨ ${t('shop:cases.openButton')} · ${caseInfo.priceStars} ⭐`
                        : `💎 ${t('shop:cases.openButton')} · ${caseInfo.priceTon} TON`}
                    </motion.button>
                  )}

                  {/* Spinner for processing phases */}
                  {(phase === 'create_invoice' || phase === 'polling_stars' || phase === 'awaiting_ton') && (
                    <div className="flex gap-1.5">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          className="w-2 h-2 rounded-full bg-gray-400"
                          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
                          transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* ── Revealing phase ── */}
              {(phase === 'revealing') && (
                <div className="flex flex-col items-center gap-5 w-full">
                  <div className="text-5xl">✨</div>
                  <div className="flex flex-wrap gap-3 justify-center">
                    {(pendingResultRef.current?.rewards ?? []).map((item, idx) => (
                      <AnimatePresence key={item.type}>
                        {idx < revealedCount && (
                          <motion.div
                            initial={{ y: 30, opacity: 0, scale: 0.7 }}
                            animate={{ y: 0, opacity: 1, scale: 1 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                            className="flex flex-col items-center gap-1 bg-white/10 rounded-2xl px-4 py-3"
                          >
                            <RewardIcon type={item.type} />
                            <span className="text-white font-bold text-lg">+{item.amount}</span>
                            <span className="text-gray-400 text-xs">
                              {t(`shop:cases.rewards.${item.type}`)}
                            </span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Result phase ── */}
              {phase === 'result' && result && (
                <motion.div
                  className="flex flex-col items-center gap-5 w-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4 }}
                >
                  {/* Rarity badge */}
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 0.1 }}
                    className={`px-4 py-1.5 rounded-full font-bold text-sm uppercase tracking-wider ${theme.badgeClass}`}
                    style={{ boxShadow: `0 0 18px 2px rgba(${theme.glowRgb}, 0.4)` }}
                  >
                    {rarityLabel}
                  </motion.div>

                  {/* Stars shimmer for epic_stars */}
                  {rarity === 'epic_stars' && (
                    <motion.div
                      className="text-4xl font-black text-yellow-300"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: [0, 1.2, 1], opacity: 1 }}
                      transition={{ duration: 0.5, delay: 0.2 }}
                      style={{ textShadow: '0 0 20px rgba(250,204,21,0.8)' }}
                    >
                      +250 ⭐
                    </motion.div>
                  )}

                  {/* Reward grid */}
                  <div className="flex flex-wrap gap-3 justify-center w-full">
                    {result.rewards.map((item, idx) => (
                      <motion.div
                        key={item.type}
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.15 + idx * 0.08, type: 'spring', stiffness: 350, damping: 25 }}
                        className="flex flex-col items-center gap-1.5 bg-white/10 rounded-2xl px-4 py-3 min-w-[72px]"
                        style={{
                          boxShadow: item.type === 'stars' && rarity === 'epic_stars'
                            ? `0 0 12px 2px rgba(${theme.glowRgb}, 0.5)`
                            : undefined,
                        }}
                      >
                        <RewardIcon type={item.type} />
                        <span className="text-white font-bold text-lg">+{item.amount}</span>
                        <span className="text-gray-400 text-xs">{t(`shop:cases.rewards.${item.type}`)}</span>
                      </motion.div>
                    ))}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-3 w-full">
                    <motion.button
                      onClick={handleOpenMore}
                      className="flex-1 py-3.5 rounded-2xl font-semibold text-sm transition-all"
                      style={{
                        background: currency === 'stars'
                          ? 'linear-gradient(135deg, #7C3AED, #4F46E5)'
                          : 'linear-gradient(135deg, #0EA5E9, #2563EB)',
                      }}
                      whileTap={{ scale: 0.97 }}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 }}
                    >
                      {t('shop:cases.openMore')}
                    </motion.button>
                    <motion.button
                      onClick={onClose}
                      className="flex-1 py-3.5 rounded-2xl font-semibold text-sm bg-white/10 text-gray-300 transition-all"
                      whileTap={{ scale: 0.97 }}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 }}
                    >
                      {t('common:close')}
                    </motion.button>
                  </div>
                </motion.div>
              )}

              {/* ── Error phase ── */}
              {phase === 'error' && (
                <motion.div
                  className="flex flex-col items-center gap-4 w-full text-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <div className="text-4xl">⚠️</div>
                  <p className="text-gray-300 text-sm leading-relaxed">{errorMsg}</p>
                  <div className="flex gap-3 w-full">
                    <button
                      onClick={retryPoll}
                      className="flex-1 py-3 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold text-sm"
                    >
                      {t('shop:cases.error.retry')}
                    </button>
                    <button
                      onClick={onClose}
                      className="flex-1 py-3 rounded-2xl bg-white/10 text-gray-300 font-semibold text-sm"
                    >
                      {t('common:close')}
                    </button>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(modal, document.body);
}
