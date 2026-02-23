import { useEffect, useState } from 'react';
import { GridArrowPopFlyLoader } from './GridArrowPopFlyLoader';

interface SmartLoaderProps {
  delayMs?: number;
  className?: string;
}

export function SmartLoader({
  delayMs = 180,
  className = '',
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
    <div className={`h-full w-full flex items-center justify-center px-6 ${className}`}>
      <GridArrowPopFlyLoader size={78} ariaLabel="Loading" showText={false} withBackdrop />
    </div>
  );
}
