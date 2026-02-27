import { useEffect, type RefObject } from 'react';

interface UseIOSGameFieldSelectionGuardOptions {
  targetRef: RefObject<HTMLElement>;
  enabled?: boolean;
  allowSelector?: string;
}

const DEFAULT_ALLOW_SELECTOR = '.allow-select, [data-allow-select="true"], input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]';

function isIOSPlatform(): boolean {
  if (typeof window === 'undefined') return false;

  const tgPlatform = (window as any).Telegram?.WebApp?.platform;
  if (typeof tgPlatform === 'string' && tgPlatform.toLowerCase() === 'ios') {
    return true;
  }

  const ua = window.navigator.userAgent || '';
  const isIPhoneFamily = /iPad|iPhone|iPod/.test(ua);
  const isIPadDesktopMode = window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
  return isIPhoneFamily || isIPadDesktopMode;
}

function toElement(target: EventTarget | null): Element | null {
  if (!(target instanceof Node)) return null;
  if (target.nodeType === Node.ELEMENT_NODE) return target as Element;
  return target.parentElement;
}

export function useIOSGameFieldSelectionGuard({
  targetRef,
  enabled = true,
  allowSelector = DEFAULT_ALLOW_SELECTOR,
}: UseIOSGameFieldSelectionGuardOptions): void {
  useEffect(() => {
    if (!enabled) return;
    if (!isIOSPlatform()) return;

    const target = targetRef.current;
    if (!target) return;

    const isAllowedTarget = (eventTarget: EventTarget | null): boolean => {
      const element = toElement(eventTarget);
      return !!element?.closest(allowSelector);
    };

    const clearSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      selection.removeAllRanges();
    };

    const handleTouchGuard = (event: TouchEvent) => {
      if (isAllowedTarget(event.target)) return;
      if (event.touches.length > 1) return;
      if (event.cancelable) event.preventDefault();
      clearSelection();
    };

    const handleUiBlock = (event: Event) => {
      if (isAllowedTarget(event.target)) return;
      if (event.cancelable) event.preventDefault();
      clearSelection();
    };

    target.addEventListener('touchstart', handleTouchGuard, { capture: true, passive: false });
    target.addEventListener('touchmove', handleTouchGuard, { capture: true, passive: false });
    target.addEventListener('touchend', handleTouchGuard, { capture: true, passive: false });
    target.addEventListener('touchcancel', handleTouchGuard, { capture: true, passive: false });
    target.addEventListener('selectstart', handleUiBlock, true);
    target.addEventListener('contextmenu', handleUiBlock, true);
    target.addEventListener('dragstart', handleUiBlock, true);

    return () => {
      target.removeEventListener('touchstart', handleTouchGuard, true);
      target.removeEventListener('touchmove', handleTouchGuard, true);
      target.removeEventListener('touchend', handleTouchGuard, true);
      target.removeEventListener('touchcancel', handleTouchGuard, true);
      target.removeEventListener('selectstart', handleUiBlock, true);
      target.removeEventListener('contextmenu', handleUiBlock, true);
      target.removeEventListener('dragstart', handleUiBlock, true);
    };
  }, [targetRef, enabled, allowSelector]);
}
