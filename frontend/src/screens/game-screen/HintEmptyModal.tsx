/**
 * HintEmptyModal - shown when user clicks Hint with hintBalance=0.
 * Options: watch ad for hint reward or close.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lightbulb, Play, CheckCircle2 } from 'lucide-react';
import { adsApi, authApi } from '../../api/client';
import { ADSGRAM_BLOCK_IDS } from '../../config/constants';
import { translate } from '../../i18n';
import { useAppStore } from '../../stores/store';
import { useRewardStore } from '../../stores/rewardStore';
import { clearPendingRewardIntent, rememberPendingRewardIntent } from '../../services/rewardReconciler';
import {
  getRewardedFlowMessage,
  runRewardedFlow,
} from '../../services/rewardedAds';

interface HintEmptyModalProps {
  open: boolean;
  onClose: () => void;
  onHintEarned: () => void;
  adAllowed: boolean;
  hintRewardAmount?: number;
}

export function HintEmptyModal({
  open,
  onClose,
  onHintEarned,
  adAllowed,
  hintRewardAmount = 3,
}: HintEmptyModalProps) {
  const trackedIntent = useRewardStore((s) => s.activeIntents.reward_hint ?? null);
  const resolvedIntent = useRewardStore((s) => s.lastResolved.reward_hint ?? null);
  const clearResolved = useRewardStore((s) => s.clearResolved);
  const [loading, setLoading] = useState(false);
  const [adStatusMessage, setAdStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [pendingIntentId, setPendingIntentId] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const hintConsumedRef = useRef(false);

  const consumeHintOnce = useCallback(() => {
    if (hintConsumedRef.current) return;
    hintConsumedRef.current = true;
    // Show success flash first, then fire the real callback after animation
    setSucceeded(true);
  }, []);

  // Auto-close after success flash
  useEffect(() => {
    if (!succeeded) return;
    const t = window.setTimeout(() => {
      setSucceeded(false);
      onHintEarned();
      onClose();
    }, 1300);
    return () => window.clearTimeout(t);
  }, [succeeded, onHintEarned, onClose]);

  // Progressive status messages while the ad is loading/playing.
  useEffect(() => {
    if (!loading) {
      setAdStatusMessage(null);
      return;
    }
    const t1 = setTimeout(() => setAdStatusMessage(translate('game:spin.loadingAd')), 100);
    const t2 = setTimeout(() => setAdStatusMessage(translate('game:spin.almostReady')), 6_000);
    const t3 = setTimeout(() => setAdStatusMessage(translate('game:spin.slowConnection')), 16_000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [loading]);

  const syncHintBalance = useCallback(async () => {
    try {
      const me = await authApi.getMe();
      useAppStore.getState().setUser(me);
      return;
    } catch {
      const currentHintBalance = useAppStore.getState().user?.hintBalance ?? 0;
      useAppStore.getState().updateUser({ hintBalance: Math.max(currentHintBalance, hintRewardAmount) });
    }
  }, [hintRewardAmount]);

  useEffect(() => {
    if (open) {
      hintConsumedRef.current = false;
      setSucceeded(false);
    }
  }, [open]);

  // Clear stale resolved state from a previous session when the modal opens fresh,
  // so it never auto-closes or fires onHintEarned unexpectedly.
  useEffect(() => {
    if (!open) return;
    const stale = useRewardStore.getState().lastResolved.reward_hint;
    if (stale && !pendingIntentId) {
      clearResolved('reward_hint', stale.intentId);
    }
  }, [open, clearResolved, pendingIntentId]);

  useEffect(() => {
    if (!trackedIntent) {
      return;
    }
    if (pendingIntentId !== trackedIntent.intentId) {
      setPendingIntentId(trackedIntent.intentId);
    }
    setError(null);
    setInfoMessage(translate('game:hintsEmpty.checkingView'));
  }, [pendingIntentId, trackedIntent]);

  useEffect(() => {
    if (!resolvedIntent) {
      return;
    }

    const applyResolved = async () => {
      if (resolvedIntent.status === 'granted') {
        await syncHintBalance();
        setPendingIntentId(null);
        setInfoMessage(null);
        setError(null);
        if (open) {
          consumeHintOnce();
        }
      } else if (resolvedIntent.status === 'rejected' || resolvedIntent.status === 'expired') {
        setPendingIntentId(null);
        setInfoMessage(null);
        setError(getRewardedFlowMessage('reward_hint', {
          outcome: 'rejected',
          failureCode: resolvedIntent.failureCode,
        }));
      }

      clearResolved('reward_hint', resolvedIntent.intentId);
    };

    void applyResolved();
  }, [clearResolved, consumeHintOnce, open, resolvedIntent, syncHintBalance]);

  // Auto-timeout: if pending hint intent lives longer than 60s, cancel and unblock
  useEffect(() => {
    if (!pendingIntentId) return;
    const timer = setTimeout(() => {
      void adsApi.cancelRewardIntent(pendingIntentId).catch(() => {});
      clearPendingRewardIntent('reward_hint', pendingIntentId);
      setPendingIntentId(null);
      setInfoMessage(null);
      setError(translate('game:hintsEmpty.pendingConfirmation'));
    }, 60_000);
    return () => clearTimeout(timer);
  }, [pendingIntentId]);

  const handleWatchAd = async () => {
    if (loading) return;

    // Pending intent exists — check its status instead of starting new ad
    if (pendingIntentId) {
      setLoading(true);
      setError(null);
      setInfoMessage(null);
      try {
        const status = await adsApi.getRewardIntentStatus(pendingIntentId);
        if (status.status === 'granted') {
          if (status.hintBalance != null) {
            useAppStore.getState().updateUser({ hintBalance: status.hintBalance });
          } else {
            await syncHintBalance();
          }
          clearPendingRewardIntent('reward_hint', pendingIntentId);
          setPendingIntentId(null);
          consumeHintOnce();
          return;
        }
        if (status.status !== 'pending') {
          clearPendingRewardIntent('reward_hint', pendingIntentId);
        } else {
          void adsApi.cancelRewardIntent(pendingIntentId).catch(() => {});
          clearPendingRewardIntent('reward_hint', pendingIntentId);
        }
        setPendingIntentId(null);
        setInfoMessage(null);
        setError(translate('game:hintsEmpty.pendingConfirmation'));
      } catch {
        clearPendingRewardIntent('reward_hint', pendingIntentId);
        setPendingIntentId(null);
        setInfoMessage(null);
        setError(translate('game:hintsEmpty.pendingConfirmation'));
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    setError(null);
    setInfoMessage(null);

    try {
      const result = await runRewardedFlow(
        ADSGRAM_BLOCK_IDS.rewardHint,
        { placement: 'reward_hint' },
        { optimistic: true },
      );

      // Ad completed — apply reward immediately without waiting for server.
      if (result.outcome === 'completed') {
        if (result.intentId) {
          rememberPendingRewardIntent({ intentId: result.intentId, placement: 'reward_hint', adCompleted: true });
        }
        const currentBalance = useAppStore.getState().user?.hintBalance ?? 0;
        useAppStore.getState().updateUser({ hintBalance: currentBalance + hintRewardAmount });
        consumeHintOnce();
        return;
      }

      // Background-confirmation cases: track and let reconciler finish the job.
      if (result.outcome === 'timeout' || result.outcome === 'provider_error') {
        if (result.intentId) {
          setPendingIntentId(result.intentId);
          rememberPendingRewardIntent({ intentId: result.intentId, placement: 'reward_hint' });
          setInfoMessage(getRewardedFlowMessage('reward_hint', result));
        } else {
          setError(getRewardedFlowMessage('reward_hint', result));
        }
        return;
      }

      if (result.outcome === 'error') {
        if (result.intentId) {
          setPendingIntentId(result.intentId);
          rememberPendingRewardIntent({ intentId: result.intentId, placement: 'reward_hint' });
          setInfoMessage(translate('game:hintsEmpty.autoChecking'));
        } else {
          setError(getRewardedFlowMessage('reward_hint', result));
        }
        return;
      }

      if (result.outcome === 'unavailable' || result.outcome === 'not_completed') {
        setError(getRewardedFlowMessage('reward_hint', result));
        return;
      }

      if (result.outcome === 'rejected') {
        if (result.failureCode === 'HINT_BALANCE_NOT_ZERO') {
          await syncHintBalance();
          consumeHintOnce();
          return;
        }
        clearPendingRewardIntent('reward_hint', result.intentId ?? undefined);
        setError(getRewardedFlowMessage('reward_hint', result));
        return;
      }

      // 'granted' — non-optimistic fallback (shouldn't reach here with optimistic: true).
      if (result.status?.hintBalance != null) {
        useAppStore.getState().updateUser({ hintBalance: result.status.hintBalance });
      } else {
        await syncHintBalance();
      }
      clearPendingRewardIntent('reward_hint', result.intentId ?? undefined);
      consumeHintOnce();
    } catch {
      setError(translate('errors:generic.network'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 safe-fixed z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm pointer-events-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.9 }}
            className="w-full max-w-xs bg-slate-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <AnimatePresence mode="wait">
              {succeeded ? (
                /* ── SUCCESS VIEW ── */
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                  className="p-8 flex flex-col items-center text-center"
                >
                  {/* Icon + rings (без filter — избегаем квадратов на мобилке) */}
                  <div className="relative flex items-center justify-center mb-5">
                    {/* Expanding pulse ring */}
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0.65 }}
                      animate={{ scale: 2.6, opacity: 0 }}
                      transition={{ duration: 0.85, ease: 'easeOut' }}
                      className="absolute rounded-full"
                      style={{ width: 64, height: 64, backgroundColor: 'rgba(250,204,21,0.35)' }}
                    />
                    {/* Static glow circle */}
                    <div
                      className="absolute rounded-full"
                      style={{ width: 88, height: 88, top: -12, left: -12, backgroundColor: 'rgba(250,204,21,0.12)' }}
                    />
                    {/* Floating particles */}
                    {[0, 72, 144, 216, 288].map((deg, i) => {
                      const rad = (deg * Math.PI) / 180;
                      const tx = Math.cos(rad) * 52;
                      const ty = Math.sin(rad) * 52;
                      return (
                        <motion.div
                          key={deg}
                          initial={{ opacity: 0, x: 0, y: 0, scale: 0 }}
                          animate={{ opacity: [0, 1, 0], x: tx, y: ty, scale: [0, 1.1, 0.6] }}
                          transition={{ duration: 0.7, delay: 0.08 + i * 0.06, ease: 'easeOut' }}
                          className="absolute flex items-center justify-center"
                          style={{ width: 16, height: 16 }}
                        >
                          <Lightbulb size={12} className="text-yellow-300" />
                        </motion.div>
                      );
                    })}
                    <motion.div
                      animate={{ scale: [1, 1.15, 1, 1.08, 1] }}
                      transition={{ duration: 0.7, delay: 0.1, ease: 'easeInOut' }}
                      className="relative z-10 flex items-center justify-center"
                    >
                      <Lightbulb size={64} className="text-yellow-300" />
                    </motion.div>
                  </div>

                  <motion.p
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="font-black text-xl uppercase tracking-widest text-white mb-2"
                  >
                    {translate('shop:purchaseSuccess.title')}
                  </motion.p>
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="flex items-center gap-2 text-yellow-200 text-base font-bold"
                  >
                    <CheckCircle2 size={18} className="text-emerald-400" />
                    <span>{translate('shop:purchaseSuccess.hintAdded', { count: hintRewardAmount })}</span>
                  </motion.div>
                </motion.div>
              ) : (
                /* ── NORMAL VIEW ── */
                <motion.div
                  key="normal"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="p-6 text-center"
                >
                  <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Lightbulb size={32} className="text-amber-400" />
                  </div>

                  <h3 className="text-xl font-bold text-white mb-2">
                    {translate('game:hintsEmpty.title')}
                  </h3>
                  <p className="text-sm text-white/60 mb-5">
                    {translate('game:hintsEmpty.description', { count: hintRewardAmount })}
                  </p>

                  {infoMessage && <p className="text-sm text-amber-300 mb-3">{infoMessage}</p>}
                  {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

                  <div className="flex flex-col gap-3">
                    {adAllowed && (
                      <button
                        onClick={handleWatchAd}
                        disabled={loading}
                        className="w-full py-3.5 bg-gradient-to-b from-amber-500 to-orange-600 rounded-xl text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <Play size={18} />
                        {loading
                          ? (adStatusMessage ?? translate('common:loading'))
                          : pendingIntentId
                            ? translate('game:hintsEmpty.checkReward')
                            : translate('game:hintsEmpty.watchAd')}
                      </button>
                    )}

                    <button
                      onClick={onClose}
                      className="w-full py-2.5 text-white/50 text-sm"
                    >
                      {translate('game:hintsEmpty.close')}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
