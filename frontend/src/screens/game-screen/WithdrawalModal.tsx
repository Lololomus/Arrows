import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { caseApi } from '../../api/client';
import { useAppStore } from '../../stores/store';

const MIN_WITHDRAWAL = 50;

type Phase = 'idle' | 'submitting' | 'success' | 'error';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function WithdrawalModal({ isOpen, onClose }: Props) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const updateUser = useAppStore((s) => s.updateUser);
  const wasOpenRef = useRef(false);

  const balance = user?.starsBalance ?? 0;
  const [amount, setAmount] = useState(String(balance));
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setAmount(String(balance));
      setPhase('idle');
      setErrorMsg('');
    }
    wasOpenRef.current = isOpen;
  }, [balance, isOpen]);

  const parsedAmount = parseInt(amount, 10);
  const isAmountValid = !isNaN(parsedAmount) && parsedAmount >= MIN_WITHDRAWAL && parsedAmount <= balance;

  const handleClose = () => {
    if (phase === 'submitting') return;
    onClose();
  };

  const handleSubmit = async () => {
    if (!isAmountValid || phase === 'submitting') return;
    setPhase('submitting');
    setErrorMsg('');

    try {
      await caseApi.withdrawStars(parsedAmount);
      updateUser({ starsBalance: balance - parsedAmount });
      setPhase('success');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'WITHDRAWAL_TOO_SMALL') {
        setErrorMsg(t('shop:withdrawal.errorMin', { min: MIN_WITHDRAWAL }));
      } else if (code === 'INSUFFICIENT_STARS') {
        setErrorMsg(t('shop:withdrawal.errorBalance'));
      } else {
        setErrorMsg(t('shop:withdrawal.errorGeneric'));
      }
      setPhase('error');
    }
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="withdrawal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/55 backdrop-blur-[2px] z-[2000]"
          />

          {/* Sheet */}
          <motion.div
            key="withdrawal-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            drag={phase !== 'submitting' ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(_e, info) => {
              if (phase !== 'submitting' && (info.offset.y > 100 || info.velocity.y > 500)) onClose();
            }}
            className="fixed bottom-0 left-0 right-0 z-[2001] bg-[#1a1a24] rounded-t-[32px] border-t border-yellow-500/20 p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
            style={{ paddingBottom: 'calc(3rem + var(--app-safe-bottom, 0px))' }}
          >
            {/* Handle */}
            <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-6" />

            <AnimatePresence mode="wait">

              {/* ── SUCCESS ── */}
              {phase === 'success' && (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-4 text-center"
                >
                  <div
                    className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl"
                    style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.25)' }}
                  >
                    ⭐
                  </div>
                  <div>
                    <p className="text-white font-bold text-xl">{t('shop:withdrawal.successTitle')}</p>
                    <p className="text-yellow-400/70 text-sm mt-1 leading-snug">{t('shop:withdrawal.successDesc')}</p>
                  </div>
                  <button
                    onClick={handleClose}
                    className="mt-2 w-full py-3.5 bg-white/10 hover:bg-white/15 rounded-xl text-white font-bold text-sm transition-colors"
                  >
                    {t('common:close')}
                  </button>
                </motion.div>
              )}

              {/* ── FORM ── */}
              {phase !== 'success' && (
                <motion.div
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {/* Header */}
                  <div className="flex items-center gap-3 mb-6">
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                      style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.2)' }}
                    >
                      ⭐
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-white uppercase tracking-wide drop-shadow-md">
                        {t('shop:withdrawal.title')}
                      </h3>
                      <p className="text-sm text-yellow-400/80 mt-0.5">
                        {t('shop:withdrawal.balance', { count: balance })}
                      </p>
                    </div>
                  </div>

                  {/* Amount input */}
                  <div className="mb-4">
                    <label className="block text-xs font-medium text-white/40 mb-2 uppercase tracking-wider">
                      {t('shop:withdrawal.amountLabel')}
                    </label>
                    <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                      <span className="text-xl shrink-0">⭐</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={MIN_WITHDRAWAL}
                        max={balance}
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          if (phase === 'error') setPhase('idle');
                        }}
                        disabled={phase === 'submitting'}
                        className="flex-1 bg-transparent text-white text-xl font-bold focus:outline-none disabled:opacity-50 min-w-0"
                        placeholder={String(MIN_WITHDRAWAL)}
                      />
                      <button
                        onClick={() => setAmount(String(balance))}
                        disabled={phase === 'submitting'}
                        className="shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg bg-yellow-500/15 text-yellow-400/90 border border-yellow-500/20 hover:bg-yellow-500/25 transition-colors"
                      >
                        MAX
                      </button>
                    </div>

                    <div className="mt-2 min-h-[18px]">
                      {amount !== '' && !isNaN(parsedAmount) && parsedAmount < MIN_WITHDRAWAL && (
                        <p className="text-xs text-red-400">{t('shop:withdrawal.errorMin', { min: MIN_WITHDRAWAL })}</p>
                      )}
                      {amount !== '' && !isNaN(parsedAmount) && parsedAmount > balance && (
                        <p className="text-xs text-red-400">{t('shop:withdrawal.errorBalance')}</p>
                      )}
                      {(amount === '' || isAmountValid) && (
                        <p className="text-xs text-white/30">{t('shop:withdrawal.amountHint', { min: MIN_WITHDRAWAL })}</p>
                      )}
                    </div>
                  </div>

                  {/* API error */}
                  {phase === 'error' && errorMsg && (
                    <div className="mb-4 rounded-xl px-4 py-2.5 bg-red-500/10 border border-red-500/20">
                      <p className="text-sm text-red-400">{errorMsg}</p>
                    </div>
                  )}

                  {/* Info note */}
                  <div className="rounded-2xl p-4 border border-white/5 bg-white/5 mb-5">
                    <p className="text-xs text-white/50 leading-relaxed">{t('shop:withdrawal.note')}</p>
                  </div>

                  {/* Submit */}
                  <button
                    onClick={handleSubmit}
                    disabled={!isAmountValid || phase === 'submitting'}
                    className="w-full py-3.5 rounded-xl font-bold text-sm transition-all"
                    style={{
                      background: isAmountValid
                        ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                        : 'rgba(255,255,255,0.08)',
                      color: isAmountValid ? '#000' : 'rgba(255,255,255,0.25)',
                    }}
                  >
                    {phase === 'submitting' ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin inline-block" />
                        {t('shop:withdrawal.submitting')}
                      </span>
                    ) : (
                      isAmountValid
                        ? `${t('shop:withdrawal.submit')} ${parsedAmount} ⭐`
                        : t('shop:withdrawal.submit')
                    )}
                  </button>
                </motion.div>
              )}

            </AnimatePresence>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
