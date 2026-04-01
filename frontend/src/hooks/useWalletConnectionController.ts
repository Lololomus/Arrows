import { useCallback, useEffect, useRef, useState } from 'react';
import { useTonAddress, useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { ApiError, walletApi } from '../api/client';
import { getErrorCodeMessage } from '../i18n/content';
import { translate } from '../i18n';
import { useAppStore } from '../stores/store';

type ConnectionState = 'idle' | 'loading' | 'confirming';

export type WalletMode =
  | 'disconnected'
  | 'reconnect_required'
  | 'loading'
  | 'confirming'
  | 'connected';

function formatSuffixAddress(address: string | null | undefined): string {
  if (!address) return '...';
  const normalized = address.trim();
  if (!normalized) return '...';
  return `...${normalized.slice(-4)}`;
}

function walletUiError(code?: string, fallback?: string): string {
  return getErrorCodeMessage(code, fallback ?? translate('errors:generic.server'));
}

export function useWalletConnectionController() {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const userFriendlyAddress = useTonAddress(true);
  const user = useAppStore((state) => state.user);
  const setUser = useAppStore((state) => state.setUser);

  const [state, setState] = useState<ConnectionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showDisconnectAction, setShowDisconnectAction] = useState(false);

  const userRef = useRef(user);
  const setUserRef = useRef(setUser);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    setUserRef.current = setUser;
  }, [setUser]);

  const resetDisconnectMenu = useCallback(() => {
    setShowDisconnectAction(false);
  }, []);

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
        resetDisconnectMenu();
        return;
      }

      const boundAddress = userRef.current?.walletAddress;
      if (boundAddress) {
        setState('idle');
        setError(null);
        return;
      }

      const proof = nextWallet.connectItems?.tonProof;
      if (!proof || !('proof' in proof)) {
        setError(walletUiError('INVALID_PROOF'));
        setState('idle');
        try {
          await tonConnectUI.disconnect();
        } catch (disconnectError) {
          console.error('[Wallet] Failed to clear partial SDK session:', disconnectError);
        }
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
          const currentUser = userRef.current;
          if (currentUser) {
            setUserRef.current({ ...currentUser, walletAddress: result.wallet_address });
          }
          setState('idle');
          return;
        }

        setError(walletUiError(result.error, result.error));
        await tonConnectUI.disconnect();
        setState('idle');
      } catch (connectError) {
        console.error('[Wallet] Backend verification failed:', connectError);
        if (connectError instanceof ApiError) {
          setError(walletUiError(connectError.code, connectError.message));
        } else {
          setError(translate('errors:generic.server'));
        }
        try {
          await tonConnectUI.disconnect();
        } catch (disconnectError) {
          console.error('[Wallet] Failed to disconnect after verification error:', disconnectError);
        }
        setState('idle');
      }
    });

    return () => unsubscribe();
  }, [resetDisconnectMenu, tonConnectUI]);

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
    resetDisconnectMenu();
    setError(null);
    setState('loading');

    try {
      await prepareProofPayload();
      await tonConnectUI.openModal();
    } catch (connectError) {
      console.error('[Wallet] Failed to start connection:', connectError);
      if (connectError instanceof ApiError) {
        setError(walletUiError(connectError.code, connectError.message));
      } else {
        setError(translate('errors:generic.server'));
      }
      setState('idle');
    }
  }, [prepareProofPayload, resetDisconnectMenu, tonConnectUI]);

  const handleDisconnect = useCallback(async () => {
    try {
      await tonConnectUI.disconnect();
      await walletApi.disconnect();
      const currentUser = userRef.current;
      if (currentUser) {
        setUserRef.current({ ...currentUser, walletAddress: null });
      }
      setState('idle');
      setError(null);
    } catch (disconnectError) {
      console.error('[Wallet] Disconnect failed:', disconnectError);
      if (disconnectError instanceof ApiError) {
        setError(walletUiError(disconnectError.code, disconnectError.message));
      } else {
        setError(translate('errors:generic.server'));
      }
    } finally {
      resetDisconnectMenu();
    }
  }, [resetDisconnectMenu, tonConnectUI]);

  const hasBoundWallet = Boolean(user?.walletAddress);
  const hasActiveSession = Boolean(wallet);

  let walletMode: WalletMode = 'disconnected';
  if (state === 'loading') {
    walletMode = 'loading';
  } else if (state === 'confirming' || (hasActiveSession && !hasBoundWallet)) {
    walletMode = 'confirming';
  } else if (hasBoundWallet && hasActiveSession) {
    walletMode = 'connected';
  } else if (hasBoundWallet) {
    walletMode = 'reconnect_required';
  }

  const onWalletClick = useCallback(() => {
    if (walletMode === 'connected') {
      setShowDisconnectAction((prev) => !prev);
      return;
    }

    if (walletMode === 'loading' || walletMode === 'confirming') {
      return;
    }

    void handleConnect();
  }, [handleConnect, walletMode]);

  useEffect(() => {
    if (walletMode !== 'connected') {
      resetDisconnectMenu();
    }
  }, [resetDisconnectMenu, walletMode]);

  return {
    walletMode,
    walletDisplay:
      walletMode === 'connected'
        ? formatSuffixAddress(userFriendlyAddress || user?.walletAddress)
        : undefined,
    walletError: error,
    showDisconnectAction,
    onWalletClick,
    onDisconnect: handleDisconnect,
  };
}
