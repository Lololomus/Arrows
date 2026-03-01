/**
 * Arrow Puzzle — Game Result Modal (OPTIMIZED)
 *
 * Изменения:
 * 1. Прокидывает nextButtonState и nextButtonError в VictoryScreen
 * 2. Прокидывает onRetry для retry при ошибке
 */

import { AnimatePresence } from 'framer-motion';
import { VictoryScreen, type NextButtonState, type PendingVictoryAction } from './VictoryScreen';
import { DefeatScreen } from './DefeatScreen';
import type { DifficultyValue } from './difficultyConfig';

interface GameResultModalProps {
  status: 'victory' | 'defeat' | 'playing' | 'loading';
  difficulty: DifficultyValue;
  currentLevel: number;
  timeSeconds: number;
  coinsEarned?: number;
  totalCoins?: number;
  noMoreLevels: boolean;
  /** Состояние кнопки «Следующий» */
  nextButtonState?: NextButtonState;
  pendingAction?: PendingVictoryAction;
  /** Текст ошибки */
  nextButtonError?: string | null;
  /** Revive */
  reviveAvailable?: boolean;
  reviveLoading?: boolean;
  reviveMessage?: string | null;
  revivePending?: boolean;
  reviveRemaining?: number | null;
  reviveLimit?: number | null;
  onRevive?: () => void;
  onNextLevel: () => void;
  onVictoryRetry: () => void;
  onDefeatRetry: () => void;
  onVictoryMenu: () => void;
  onDefeatMenu: () => void;
}

export function GameResultModal({
  status,
  difficulty,
  currentLevel,
  timeSeconds,
  coinsEarned,
  totalCoins,
  noMoreLevels,
  nextButtonState,
  pendingAction,
  nextButtonError,
  reviveAvailable = false,
  reviveLoading = false,
  reviveMessage = null,
  revivePending = false,
  reviveRemaining = null,
  reviveLimit = null,
  onRevive,
  onNextLevel,
  onVictoryRetry,
  onDefeatRetry,
  onVictoryMenu,
  onDefeatMenu,
}: GameResultModalProps) {
  const showVictory = status === 'victory' && !noMoreLevels;
  const showDefeat = status === 'defeat';

  return (
    <AnimatePresence>
      {showVictory && (
        <VictoryScreen
          level={currentLevel}
          difficulty={difficulty}
          timeSeconds={timeSeconds}
          coinsEarned={coinsEarned}
          totalCoins={totalCoins}
          nextButtonState={nextButtonState}
          pendingAction={pendingAction}
          nextButtonError={nextButtonError}
          onNextLevel={onNextLevel}
          onRetry={onVictoryRetry}
          onMenu={onVictoryMenu}
        />
      )}
      {showDefeat && (
        <DefeatScreen
          level={currentLevel}
          reviveAvailable={reviveAvailable}
          reviveLoading={reviveLoading}
          reviveMessage={reviveMessage}
          revivePending={revivePending}
          reviveRemaining={reviveRemaining}
          reviveLimit={reviveLimit}
          onRevive={onRevive ?? onDefeatRetry}
          onRetry={onDefeatRetry}
          onMenu={onDefeatMenu}
        />
      )}
    </AnimatePresence>
  );
}
