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
  balanceReviveAvailable?: boolean;
  balanceReviveCount?: number;
  adReviveAvailable?: boolean;
  reviveLoading?: boolean;
  reviveMessage?: string | null;
  revivePending?: boolean;
  onBalanceRevive?: () => void;
  onAdRevive?: () => void;
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
  balanceReviveAvailable = false,
  balanceReviveCount = 0,
  adReviveAvailable = false,
  reviveLoading = false,
  reviveMessage = null,
  revivePending = false,
  onBalanceRevive,
  onAdRevive,
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
          balanceReviveAvailable={balanceReviveAvailable}
          balanceReviveCount={balanceReviveCount}
          adReviveAvailable={adReviveAvailable}
          reviveLoading={reviveLoading}
          reviveMessage={reviveMessage}
          revivePending={revivePending}
          onBalanceRevive={onBalanceRevive ?? onDefeatRetry}
          onAdRevive={onAdRevive ?? onDefeatRetry}
          onRetry={onDefeatRetry}
          onMenu={onDefeatMenu}
        />
      )}
    </AnimatePresence>
  );
}
