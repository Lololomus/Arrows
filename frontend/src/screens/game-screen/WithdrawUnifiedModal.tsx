import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { caseApi } from '../../api/client';
import { useAppStore } from '../../stores/store';
import usdtLogoUrl from '../../assets/usdt-logo-circle.svg';

const MIN_STARS = 100;
const MIN_USDT = 3;

type Currency = 'stars' | 'usdt';
type Phase = 'idle' | 'submitting' | 'success' | 'error';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function WithdrawUnifiedModal({ isOpen, onClose }: Props) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const updateUser = useAppStore((s) => s.updateUser);
  const wasOpenRef = useRef(false);

  const starsBalance = user?.starsBalance ?? 0;

  const [currency, setCurrency] = useState<Currency>('stars');
  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setCurrency('stars');
      setAmount('');
      setPhase('idle');
      setErrorMsg('');
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    setAmount('');
    setPhase('idle');
    setErrorMsg('');
  }, [currency]);

  const handleClose = () => {
    if (phase === 'submitting') return;
    onClose();
  };

  const parsedStars = parseInt(amount, 10);
  const parsedUsdt = parseFloat(amount);

  const isValid = currency === 'stars'
    ? !isNaN(parsedStars) && parsedStars >= MIN_STARS && parsedStars <= starsBalance
    : !isNaN(parsedUsdt) && parsedUsdt >= MIN_USDT;

  const handleSubmit = async () => {
    if (!isValid || phase === 'submitting') return;

    if (currency === 'usdt') {
      setPhase('success');
      return;
    }

    setPhase('submitting');
    setErrorMsg('');
    try {
      await caseApi.withdrawStars(parsedStars);
      updateUser({ starsBalance: starsBalance - parsedStars });
      setPhase('success');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'WITHDRAWAL_TOO_SMALL') {
        setErrorMsg(t('shop:withdrawal.errorMin', { min: MIN_STARS }));
      } else if (code === 'INSUFFICIENT_STARS') {
        setErrorMsg(t('shop:withdrawal.errorBalance'));
      } else {
        setErrorMsg(t('shop:withdrawal.errorGeneric'));
      }
      setPhase('error');
    }
  };

  const isDone = phase === 'success';

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="uw-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/55 backdrop-blur-[2px] z-[2000]"
          />

          <motion.div
            key="uw-sheet"
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
            className="fixed bottom-0 left-0 right-0 z-[2001] bg-[#1a1a24] rounded-t-[32px] p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
            style={{
              paddingBottom: 'calc(3rem + var(--app-safe-bottom, 0px))',
              borderTop: currency === 'usdt' ? '1px solid rgba(38,161,123,0.25)' : '1px solid rgba(251,191,36,0.2)',
            }}
          >
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
                    className="w-20 h-20 rounded-3xl flex items-center justify-center overflow-hidden"
                    style={currency === 'stars'
                      ? { background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.25)' }
                      : { background: 'rgba(38,161,123,0.15)', border: '1px solid rgba(38,161,123,0.25)' }}
                  >
                    {currency === 'stars'
                      ? <span className="text-4xl">⭐</span>
                      : <img src={usdtLogoUrl} alt="USDT" className="w-12 h-12 object-contain" />}
                  </div>
                  <div>
                    <p className="text-white font-bold text-xl">{t('shop:withdrawal.successTitle')}</p>
                    <p className="text-sm mt-1 leading-snug" style={{ color: currency === 'stars' ? 'rgba(251,191,36,0.7)' : 'rgba(38,161,123,0.8)' }}>
                      {t('shop:withdrawal.successDesc')}
                    </p>
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
              {!isDone && (
                <motion.div
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {/* Title */}
                  <h3 className="text-xl font-black text-white uppercase tracking-wide mb-5">
                    {t('shop:withdrawal.sectionTitle')}
                  </h3>

                  {/* Currency tabs */}
                  <div className="flex gap-2 mb-5 p-1 rounded-2xl bg-white/5">
                    {/* Stars tab */}
                    <button
                      onClick={() => setCurrency('stars')}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all"
                      style={currency === 'stars' ? {
                        background: 'linear-gradient(135deg,rgba(251,191,36,0.2),rgba(245,158,11,0.12))',
                        border: '1px solid rgba(251,191,36,0.35)',
                        color: 'rgba(251,191,36,0.95)',
                      } : {
                        background: 'transparent',
                        border: '1px solid transparent',
                        color: 'rgba(255,255,255,0.35)',
                      }}
                    >
                      <span className="text-base leading-none">⭐</span>
                      Stars
                    </button>

                    {/* USDT tab */}
                    <button
                      onClick={() => setCurrency('usdt')}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all"
                      style={currency === 'usdt' ? {
                        background: 'linear-gradient(135deg,rgba(38,161,123,0.22),rgba(26,122,94,0.14))',
                        border: '1px solid rgba(38,161,123,0.35)',
                        color: 'rgba(38,161,123,0.95)',
                      } : {
                        background: 'transparent',
                        border: '1px solid transparent',
                        color: 'rgba(255,255,255,0.35)',
                      }}
                    >
                      <img src={usdtLogoUrl} alt="USDT" className="w-4 h-4 object-contain" />
                      USDT
                    </button>
                  </div>

                  {/* Balance */}
                  <p className="text-sm mb-4" style={{ color: currency === 'usdt' ? 'rgba(38,161,123,0.8)' : 'rgba(251,191,36,0.8)' }}>
                    {currency === 'stars'
                      ? t('shop:withdrawal.balance', { count: starsBalance })
                      : t('shop:withdrawal.usdtBalance', { count: '0.00' })}
                  </p>

                  {/* Amount input */}
                  <div className="mb-4">
                    <label className="block text-xs font-medium text-white/40 mb-2 uppercase tracking-wider">
                      {t('shop:withdrawal.amountLabel')}
                    </label>
                    <div
                      className="flex items-center gap-3 bg-white/5 rounded-2xl px-4 py-3"
                      style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      {currency === 'stars'
                        ? <span className="text-xl shrink-0">⭐</span>
                        : <img src={usdtLogoUrl} alt="USDT" className="w-6 h-6 object-contain shrink-0" />}
                      <input
                        type="number"
                        inputMode={currency === 'stars' ? 'numeric' : 'decimal'}
                        min={currency === 'stars' ? MIN_STARS : MIN_USDT}
                        max={currency === 'stars' ? starsBalance : undefined}
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          if (phase === 'error') setPhase('idle');
                        }}
                        disabled={phase === 'submitting'}
                        className="flex-1 bg-transparent text-white text-xl font-bold focus:outline-none disabled:opacity-50 min-w-0"
                        placeholder={String(currency === 'stars' ? MIN_STARS : MIN_USDT)}
                      />
                      {currency === 'stars' && (
                        <button
                          onClick={() => setAmount(String(starsBalance))}
                          disabled={phase === 'submitting'}
                          className="shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg transition-colors"
                          style={{ background: 'rgba(251,191,36,0.15)', color: 'rgba(251,191,36,0.9)', border: '1px solid rgba(251,191,36,0.2)' }}
                        >
                          MAX
                        </button>
                      )}
                    </div>

                    <div className="mt-2 min-h-[18px]">
                      {currency === 'stars' && amount !== '' && !isNaN(parsedStars) && parsedStars < MIN_STARS && (
                        <p className="text-xs text-red-400">{t('shop:withdrawal.errorMin', { min: MIN_STARS })}</p>
                      )}
                      {currency === 'stars' && amount !== '' && !isNaN(parsedStars) && parsedStars > starsBalance && (
                        <p className="text-xs text-red-400">{t('shop:withdrawal.errorBalance')}</p>
                      )}
                      {currency === 'usdt' && amount !== '' && !isNaN(parsedUsdt) && parsedUsdt < MIN_USDT && (
                        <p className="text-xs text-red-400">{t('shop:withdrawal.amountHintUsdt', { min: MIN_USDT })}</p>
                      )}
                      {(amount === '' || isValid) && (
                        <p className="text-xs text-white/30">
                          {currency === 'stars'
                            ? t('shop:withdrawal.amountHint', { min: MIN_STARS })
                            : t('shop:withdrawal.amountHintUsdt', { min: MIN_USDT })}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* API error */}
                  {phase === 'error' && errorMsg && (
                    <div className="mb-4 rounded-xl px-4 py-2.5 bg-red-500/10 border border-red-500/20">
                      <p className="text-sm text-red-400">{errorMsg}</p>
                    </div>
                  )}

                  {/* Note */}
                  <div className="rounded-2xl p-4 border border-white/5 bg-white/5 mb-5">
                    <p className="text-xs text-white/50 leading-relaxed">
                      {currency === 'stars' ? t('shop:withdrawal.note') : t('shop:withdrawal.usdtNote')}
                    </p>
                  </div>

                  {/* Submit */}
                  <button
                    onClick={handleSubmit}
                    disabled={!isValid || phase === 'submitting'}
                    className="w-full py-3.5 rounded-xl font-bold text-sm transition-all"
                    style={{
                      background: isValid
                        ? currency === 'stars'
                          ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                          : 'linear-gradient(135deg, #26a17b, #1a7a5e)'
                        : 'rgba(255,255,255,0.08)',
                      color: isValid ? (currency === 'stars' ? '#000' : '#fff') : 'rgba(255,255,255,0.25)',
                    }}
                  >
                    {phase === 'submitting' ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin inline-block" />
                        {t('shop:withdrawal.submitting')}
                      </span>
                    ) : isValid
                      ? `${t('shop:cases.withdrawLink')} ${amount} ${currency === 'stars' ? '⭐' : 'USDT'}`
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
