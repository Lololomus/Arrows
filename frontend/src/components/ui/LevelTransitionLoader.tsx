import { GridArrowPopFlyLoader } from './GridArrowPopFlyLoader';

interface LevelTransitionLoaderProps {
  level?: number;
  className?: string;
}

export function LevelTransitionLoader({ level, className = '' }: LevelTransitionLoaderProps) {
  return (
    <div className={`flex h-full items-center justify-center px-6 ${className}`}>
      <GridArrowPopFlyLoader
        size={90}
        ariaLabel={typeof level === 'number' ? `Loading level ${level}` : 'Loading level'}
        showText={false}
        withBackdrop
      />
    </div>
  );
}
