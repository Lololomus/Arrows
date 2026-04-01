import { GridArrowPopFlyLoader } from './GridArrowPopFlyLoader';
import { translate } from '../../i18n';

interface LevelTransitionLoaderProps {
  level?: number;
  className?: string;
}

export function LevelTransitionLoader({ level, className = '' }: LevelTransitionLoaderProps) {
  const ariaLabel = typeof level === 'number'
    ? translate('game:loadingLevelWithNumber', { level })
    : translate('game:loadingLevel');

  return (
    <div className={`flex h-full items-center justify-center px-6 ${className}`}>
      <GridArrowPopFlyLoader
        size={90}
        ariaLabel={ariaLabel}
        showText={false}
        withBackdrop
      />
    </div>
  );
}
