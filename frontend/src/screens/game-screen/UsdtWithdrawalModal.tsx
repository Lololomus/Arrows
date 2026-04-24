import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import usdtLogoUrl from '../../assets/usdt-logo-circle.svg';

const MIN_WITHDRAWAL = 3;

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function UsdtWithdrawalModal({ isOpen, onClose }: Props) {
  const { t } = useTranslation();
  const wasOpenRef = useRef(false);
  const [amount, setAmount] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setAmount('');
      setSubmitted(false);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  const parsedAmount = parseFloat(amount);
  const isAmountValid = !isNaN(parsedAmount) && parsedAmount >= MIN_WITHDRAWAL;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="usdt-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/55 backdrop-blur-[2px] z-[2000]"
          />

          <motion.div
            key="usdt-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(_e, info) => {
              if (info.offset.y > 100 || info.velocity.y > 500) onClose();
            }}
            className="fixed bottom-0 left-0 right-0 z-[2001] bg-[#1a1a24] rounded-t-[32px] border-t border-[#26a17b]/20 p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
            style={{ paddingBottom: 'calc(3rem + var(--app-safe-bottom, 0px))' }}
          >
            <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-6" />

            <AnimatePresence mode="wait">

              {/* ── SUCCESS / COMING SOON ── */}
              {submitted && (
                <motion.div
                  key="usdt-coming-soon"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-4 text-center"
                >
                  <div
                    className="w-20 h-20 rounded-3xl flex items-center justify-center overflow-hidden"
                    style={{ background: 'rgba(38,161,123,0.15)', border: '1px solid rgba(38,161,123,0.25)' }}
                  >
                    <img src={usdtLogoUrl} alt="USDT" className="w-12 h-12 object-contain" />
                  </div>
                  <div>
                    <p className="text-white font-bold text-xl">{t('shop:withdrawal.usdtSoonTitle')}</p>
                    <p className="text-[#26a17b]/80 text-sm mt-1 leading-snug">{t('shop:withdrawal.usdtSoonDesc')}</p>
                  </div>
                  <button
                    onClick={onClose}
                    className="mt-2 w-full py-3.5 bg-white/10 hover:bg-white/15 rounded-xl text-white font-bold text-sm transition-colors"
                  >
                    {t('common:close')}
                  </button>
                </motion.div>
              )}

              {/* ── FORM ── */}
              {!submitted && (
                <motion.div
                  key="usdt-form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {/* Header */}
                  <div className="flex items-center gap-3 mb-6">
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden"
                      style={{ background: 'rgba(38,161,123,0.15)', border: '1px solid rgba(38,161,123,0.2)' }}
                    >
                      <img src={usdtLogoUrl} alt="USDT" className="w-9 h-9 object-contain" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-white uppercase tracking-wide drop-shadow-md">
                        {t('shop:withdrawal.usdtTitle')}
                      </h3>
                      <p className="text-sm mt-0.5" style={{ color: 'rgba(38,161,123,0.85)' }}>
                        {t('shop:withdrawal.usdtBalance', { count: '0.00' })}
                      </p>
                    </div>
                  </div>

                  {/* Amount input */}
                  <div className="mb-4">
                    <label className="block text-xs font-medium text-white/40 mb-2 uppercase tracking-wider">
                      {t('shop:withdrawal.amountLabel')}
                    </label>
                    <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                      <img src={usdtLogoUrl} alt="USDT" className="w-6 h-6 object-contain shrink-0" />
                      <input
                        type="number"
                        inputMode="decimal"
                        min={MIN_WITHDRAWAL}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="flex-1 bg-transparent text-white text-xl font-bold focus:outline-none min-w-0"
                        placeholder={String(MIN_WITHDRAWAL)}
                      />
                    </div>

                    <div className="mt-2 min-h-[18px]">
                      {amount !== '' && !isNaN(parsedAmount) && parsedAmount < MIN_WITHDRAWAL && (
                        <p className="text-xs text-red-400">
                          {t('shop:withdrawal.amountHintUsdt', { min: MIN_WITHDRAWAL })}
                        </p>
                      )}
                      {(amount === '' || isAmountValid) && (
                        <p className="text-xs text-white/30">
                          {t('shop:withdrawal.amountHintUsdt', { min: MIN_WITHDRAWAL })}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Info note */}
                  <div className="rounded-2xl p-4 border border-white/5 bg-white/5 mb-5">
                    <p className="text-xs text-white/50 leading-relaxed">{t('shop:withdrawal.usdtNote')}</p>
                  </div>

                  {/* Submit */}
                  <button
                    onClick={() => isAmountValid && setSubmitted(true)}
                    disabled={!isAmountValid}
                    className="w-full py-3.5 rounded-xl font-bold text-sm transition-all"
                    style={{
                      background: isAmountValid
                        ? 'linear-gradient(135deg, #26a17b, #1a7a5e)'
                        : 'rgba(255,255,255,0.08)',
                      color: isAmountValid ? '#fff' : 'rgba(255,255,255,0.25)',
                    }}
                  >
                    {isAmountValid
                      ? `${t('shop:cases.withdrawLink')} ${parsedAmount} USDT`
                      : t('shop:cases.withdrawLink')}
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
