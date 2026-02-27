/**
 * Arrow Puzzle — Game Result Modal (Orchestrator)
 *
 * Оркестрирует отображение VictoryScreen или DefeatScreen
 * на основе текущего status. Заменяет старую простую модалку.
 *
 * Props:
 * - status: текущий статус игры
 * - difficulty: сложность из level.meta.difficulty (строка из JSON или legacy-число)
 * - currentLevel: номер уровня
 * - timeSeconds: время прохождения
 * - coinsEarned: монеты (опционально, fallback на конфиг)
 * - noMoreLevels: флаг «уровни закончились»
 * - onNextLevel / onRetry / onMenu: callbacks
 */

import { AnimatePresence } from 'framer-motion';
import { VictoryScreen } from './VictoryScreen';
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
  onNextLevel: () => void;
  onRetry: () => void;
  onMenu: () => void;
}

export function GameResultModal({
  status,
  difficulty,
  currentLevel,
  timeSeconds,
  coinsEarned,
  totalCoins,
  noMoreLevels,
  onNextLevel,
  onRetry,
  onMenu,
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
          onNextLevel={onNextLevel}
          onMenu={onMenu}
        />
      )}
      {showDefeat && (
        <DefeatScreen
          level={currentLevel}
          onRetry={onRetry}
          onMenu={onMenu}
        />
      )}
    </AnimatePresence>
  );
}
