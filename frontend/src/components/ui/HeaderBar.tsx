import { motion } from 'framer-motion';
import { Coins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WalletMode } from '../../hooks/useWalletConnectionController';
import { formatNumber } from '../../i18n';

function CubeIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function getWalletLabel(walletMode: WalletMode, t: (key: string) => string): string {
  switch (walletMode) {
    case 'reconnect_required':
      return t('common:reconnectWallet');
    case 'loading':
      return t('common:connectWallet');
    case 'confirming':
      return t('common:confirming');
    default:
      return t('common:connectWallet');
  }
}

interface HeaderBarProps {
  balance: number;
  walletMode: WalletMode;
  walletDisplay?: string;
  walletError?: string | null;
  showDisconnectAction?: boolean;
  onWalletClick: () => void;
  onDisconnect?: () => void;
  className?: string;
  animated?: boolean;
  delay?: number;
}

export function HeaderBar({
  balance,
  walletMode,
  walletDisplay,
  walletError = null,
  showDisconnectAction = false,
  onWalletClick,
  onDisconnect,
  className = '',
  animated = true,
  delay = 0.2,
}: HeaderBarProps) {
  const { t } = useTranslation();

  const animationProps = animated
    ? {
        initial: { opacity: 0, y: 12, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { duration: 0.35, ease: 'easeOut', delay },
      }
    : {};

  const isConnected = walletMode === 'connected';
  const isBusy = walletMode === 'loading' || walletMode === 'confirming';
  const walletButtonClass = isConnected
    ? 'border border-emerald-400/20 bg-[#14162a]/82 text-emerald-200 shadow-[0_8px_24px_rgba(0,0,0,0.38)] hover:bg-[#1a1e36]/88'
    : 'bg-[#0098EA] text-white shadow-[0_10px_22px_rgba(0,152,234,0.28)] hover:bg-[#0a8adb]';

  return (
    <motion.div {...animationProps} className={`relative ${className}`}>
      <div className="relative rounded-[24px] border border-yellow-300/30 bg-[#14162a]/95 p-2 pl-3 pr-3 shadow-[0_16px_40px_rgba(0,0,0,0.8)] backdrop-blur-xl">
        <div className="absolute inset-0 rounded-[24px] bg-gradient-to-r from-amber-500/10 via-yellow-300/10 to-amber-500/10" />

        <div className="relative flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-yellow-200/40 bg-gradient-to-br from-yellow-300/20 to-amber-500/10 text-yellow-300 shadow-[0_0_20px_rgba(250,204,21,0.3)]">
              <Coins size={24} strokeWidth={2.5} className="drop-shadow-lg" />
            </div>

            <div className="min-w-0">
              <span className="block text-[12px] font-bold uppercase leading-tight tracking-[0.25em] text-yellow-200/60">
                {t('common:coinStash')}
              </span>
              <span className="mt-[2px] block truncate text-3xl font-black leading-none tracking-tight text-yellow-300 drop-shadow-[0_0_12px_rgba(250,204,21,0.4)] tabular-nums">
                {formatNumber(balance)}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onWalletClick}
            disabled={isBusy}
            className={`relative flex h-[38px] shrink-0 items-center justify-center rounded-full px-4 text-[13px] font-bold tracking-wide transition-colors duration-200 disabled:cursor-default disabled:opacity-75 ${walletButtonClass}`}
          >
            {isConnected ? (
              <div className="flex items-center gap-2">
                <CubeIcon />
                <span>{walletDisplay || '...'}</span>
              </div>
            ) : (
              <span>{getWalletLabel(walletMode, t)}</span>
            )}
          </button>
        </div>
      </div>

      {showDisconnectAction && isConnected && onDisconnect && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute left-0 right-0 top-full z-20 mt-1"
        >
          <button
            type="button"
            onClick={onDisconnect}
            className="w-full rounded-xl border border-red-400/20 bg-[#1a1c30]/90 px-4 py-2.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10"
          >
            {t('common:disconnectWallet')}
          </button>
        </motion.div>
      )}

      {walletError && (
        <p className={`px-1 text-[11px] text-red-400/80 ${showDisconnectAction && isConnected ? 'mt-12' : 'mt-1'}`}>
          {walletError}
        </p>
      )}
    </motion.div>
  );
}
