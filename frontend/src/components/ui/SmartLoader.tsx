import { useEffect, useState } from 'react';
import { GridArrowPopFlyLoader } from './GridArrowPopFlyLoader';
import { translate } from '../../i18n';

interface SmartLoaderProps {
  delayMs?: number;
  className?: string;
  text?: string;
}

export function SmartLoader({
  delayMs = 180,
  className = '',
  text,
}: SmartLoaderProps) {
  const [visible, setVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true);
      return;
    }

    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  if (!visible) {
    return <div className={`h-full w-full ${className}`} aria-hidden="true" />;
  }

  return (
    <div className={`h-full w-full flex flex-col items-center justify-center gap-4 px-6 ${className}`}>
      <GridArrowPopFlyLoader
        size={78}
        ariaLabel={text ?? translate('common:loading')}
        showText={false}
        withBackdrop
      />
      {text ? (
        <p className="text-center text-sm font-medium text-white/70">{text}</p>
      ) : null}
    </div>
  );
}
