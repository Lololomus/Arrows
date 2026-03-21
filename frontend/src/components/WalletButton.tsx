import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Wallet } from 'lucide-react';
import { useTonAddress, useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { walletApi } from '../api/client';
import { useAppStore } from '../stores/store';

type ConnectionState = 'idle' | 'loading' | 'confirming';

function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

interface WalletButtonProps {
  className?: string;
  animated?: boolean;
  delay?: number;
}

export function WalletButton({
  className = '',
  animated = true,
  delay = 0.3,
}: WalletButtonProps) {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const userFriendlyAddress = useTonAddress(true);
  const { user, setUser } = useAppStore();

  const [state, setState] = useState<ConnectionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showDisconnect, setShowDisconnect] = useState(false);

  const isConnected = !!wallet && !!user?.walletAddress;

  const prepareProofPayload = useCallback(async () => {
    const { payload } = await walletApi.getProofPayload();
    tonConnectUI.setConnectRequestParameters({
      state: 'ready',
      value: { tonProof: payload },
    });
  }, [tonConnectUI]);

  useEffect(() => {
    const unsubscribe = tonConnectUI.onStatusChange(async (nextWallet) => {
      if (!nextWallet) {
        setState('idle');
        return;
      }

      const proof = nextWallet.connectItems?.tonProof;
      if (!proof || !('proof' in proof)) {
        console.warn('[Wallet] No tonProof in connect result');
        setState('idle');
        return;
      }

      setState('confirming');
      setError(null);

      try {
        const result = await walletApi.connect(nextWallet.account.address, {
          ...proof.proof,
          state_init: nextWallet.account.walletStateInit,
        });

        if (result.success && result.wallet_address) {
          if (user) {
            setUser({ ...user, walletAddress: result.wallet_address });
          }
          setState('idle');
          return;
        }

        setError(result.error || 'Не удалось подтвердить кошелек');
        await tonConnectUI.disconnect();
        setState('idle');
      } catch (e) {
        console.error('[Wallet] Backend verification failed:', e);
        setError('Ошибка подтверждения');
        await tonConnectUI.disconnect();
        setState('idle');
      }
    });

    return () => unsubscribe();
  }, [tonConnectUI, user, setUser]);

  useEffect(() => {
    const unsubscribe = tonConnectUI.onModalStateChange((modalState) => {
      if (
        modalState.status === 'closed' &&
        modalState.closeReason === 'action-cancelled'
      ) {
        setState('idle');
      }
    });

    return () => unsubscribe();
  }, [tonConnectUI]);

  const handleConnect = useCallback(async () => {
    setError(null);
    setState('loading');

    try {
      await prepareProofPayload();
      await tonConnectUI.openModal();
    } catch (e) {
      console.error('[Wallet] Failed to start connection:', e);
      setError('Не удалось подготовить подключение');
      setState('idle');
    }
  }, [tonConnectUI, prepareProofPayload]);

  const handleDisconnect = useCallback(async () => {
    try {
      await tonConnectUI.disconnect();
      await walletApi.disconnect();
      if (user) {
        setUser({ ...user, walletAddress: null });
      }
      setState('idle');
      setError(null);
    } catch (e) {
      console.error('[Wallet] Disconnect failed:', e);
    }
    setShowDisconnect(false);
  }, [tonConnectUI, user, setUser]);

  const animationProps = animated
    ? {
        initial: { opacity: 0, y: 12, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { duration: 0.35, ease: 'easeOut', delay },
      }
    : {};

  if (isConnected && user) {
    return (
      <motion.div {...animationProps} className={`relative ${className}`}>
        <motion.button
          type="button"
          onClick={() => setShowDisconnect((prev) => !prev)}
          className="relative w-full overflow-hidden rounded-2xl border border-emerald-400/20 bg-[#14162a]/65 backdrop-blur-xl shadow-[0_8px_28px_rgba(0,0,0,0.45)]"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 via-teal-400/10 to-emerald-500/10" />
          <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-400/20 blur-2xl" />
          <div className="relative flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-300/25 bg-emerald-400/10 text-emerald-300">
                <Wallet size={20} strokeWidth={2.2} />
              </div>
              <div className="leading-tight">
                <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-100/70">
                  TON Wallet
                </p>
                <p className="text-lg font-bold text-emerald-200 drop-shadow-[0_0_12px_rgba(52,211,153,0.35)]">
                  {truncateAddress(userFriendlyAddress || user.walletAddress || '')}
                </p>
              </div>
            </div>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-200/75">
              Connected
            </span>
          </div>
        </motion.button>

        {showDisconnect && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute left-0 right-0 top-full z-20 mt-1"
          >
            <button
              type="button"
              onClick={handleDisconnect}
              className="w-full rounded-xl border border-red-400/20 bg-[#1a1c30]/90 px-4 py-2.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10"
            >
              Отключить кошелек
            </button>
          </motion.div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div {...animationProps} className={`relative ${className}`}>
      <motion.button
        type="button"
        onClick={handleConnect}
        disabled={state !== 'idle'}
        whileTap={{ scale: 0.98 }}
        className="relative w-full overflow-hidden rounded-2xl border border-blue-400/20 bg-[#14162a]/65 backdrop-blur-xl shadow-[0_8px_28px_rgba(0,0,0,0.45)] disabled:opacity-60"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-violet-400/10 to-blue-500/10" />
        <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-blue-400/20 blur-2xl" />
        <div className="relative flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-300/25 bg-blue-400/10 text-blue-300">
              <Wallet size={20} strokeWidth={2.2} />
            </div>
            <div className="leading-tight">
              <p className="text-[11px] uppercase tracking-[0.22em] text-blue-100/70">
                TON Wallet
              </p>
              <p className="text-lg font-bold text-blue-200">
                {state === 'loading'
                  ? 'Подключение...'
                  : state === 'confirming'
                    ? 'Подтверждение...'
                    : 'Connect Wallet'}
              </p>
            </div>
          </div>
          <span className="rounded-full border border-blue-400/30 bg-blue-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-blue-200/75">
            TON
          </span>
        </div>
      </motion.button>

      {error && (
        <p className="mt-1 px-1 text-[11px] text-red-400/80">{error}</p>
      )}
    </motion.div>
  );
}
