/**
 * HintEmptyModal - shown when user clicks Hint with hintBalance=0.
 * Options: watch ad for +1 hint, go to shop, or close.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lightbulb, ShoppingBag, Play } from 'lucide-react';
import { authApi } from '../../api/client';
import { ADSGRAM_BLOCK_IDS } from '../../config/constants';
import { useAppStore } from '../../stores/store';
import {
  PENDING_RETRY_TIMEOUT_MS,
  getRewardedFlowMessage,
  pollRewardIntent,
  runRewardedFlow,
} from '../../services/rewardedAds';

interface HintEmptyModalProps {
  open: boolean;
  onClose: () => void;
  onHintEarned: () => void;
  onGoToShop: () => void;
  adAllowed: boolean;
}

export function HintEmptyModal({
  open,
  onClose,
  onHintEarned,
  onGoToShop,
  adAllowed,
}: HintEmptyModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [pendingIntentId, setPendingIntentId] = useState<string | null>(null);

  const syncHintBalance = async () => {
    try {
      const me = await authApi.getMe();
      useAppStore.getState().setUser(me);
      return;
    } catch {
      const currentHintBalance = useAppStore.getState().user?.hintBalance ?? 0;
      useAppStore.getState().updateUser({ hintBalance: Math.max(currentHintBalance, 1) });
    }
  };

  const handleWatchAd = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setInfoMessage(null);

    try {
      const result = pendingIntentId
        ? await pollRewardIntent(pendingIntentId, PENDING_RETRY_TIMEOUT_MS)
        : await runRewardedFlow(ADSGRAM_BLOCK_IDS.rewardHint, {
            placement: 'reward_hint',
          });

      if (result.outcome === 'timeout') {
        setPendingIntentId(result.intentId);
        setInfoMessage(getRewardedFlowMessage('reward_hint', result));
        return;
      }

      if (result.outcome === 'ad_failed') {
        setPendingIntentId(null);
        setError(getRewardedFlowMessage('reward_hint', result));
        return;
      }
      if (result.outcome === 'error') {
        setPendingIntentId(result.intentId);
        setError(getRewardedFlowMessage('reward_hint', result));
        return;
      }

      if (result.outcome === 'rejected') {
        if (result.failureCode === 'HINT_BALANCE_NOT_ZERO') {
          await syncHintBalance();
          setPendingIntentId(null);
          onClose();
          onHintEarned();
          return;
        }

        setPendingIntentId(null);
        setError(getRewardedFlowMessage('reward_hint', result));
        return;
      }

      if (result.status?.hintBalance != null) {
        useAppStore.getState().updateUser({ hintBalance: result.status.hintBalance });
      } else {
        await syncHintBalance();
      }

      setPendingIntentId(null);
      onClose();
      onHintEarned();
    } catch {
      setError('Не удалось связаться с сервером. Попробуйте еще раз.');
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
            className="w-full max-w-xs bg-slate-900 border border-white/10 rounded-3xl p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lightbulb size={32} className="text-amber-400" />
            </div>

            <h3 className="text-xl font-bold text-white mb-2">
              Подсказки закончились
            </h3>
            <p className="text-sm text-white/60 mb-5">
              Посмотрите рекламу или купите подсказки в магазине
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
                  {loading ? 'Загрузка...' : pendingIntentId ? 'Проверить награду' : 'Смотреть рекламу'}
                </button>
              )}

              <button
                onClick={() => { onClose(); onGoToShop(); }}
                className="w-full py-3.5 bg-white/5 rounded-xl text-white font-bold flex items-center justify-center gap-2"
              >
                <ShoppingBag size={18} />
                Магазин
              </button>

              <button
                onClick={onClose}
                className="w-full py-2.5 text-white/50 text-sm"
              >
                Закрыть
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
