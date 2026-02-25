import { useCallback } from 'react';
import type { MotionValue } from 'framer-motion';
import { ANIMATIONS } from '../../config/constants';
import { processMove, getFreeArrows } from '../../game/engine';
import { emitFlyFX } from '../../game/fxBridge';
import { getSkin } from '../../game/skins';
import { wakeFXOverlay } from '../../components/FXOverlay';
import { useGameStore } from '../../stores/store';
import { globalIndex } from '../../game/spatialIndex';

interface UseArrowActionsParams {
  isIntroAnimating: boolean;
  baseCellSize: number;
  cameraScale: MotionValue<number>;
  focusHintArrow: (arrowId: string, force?: boolean) => boolean;
  setShakingArrow: (arrowId: string | null) => void;
  blockArrow: (arrowId: string) => void;
  unblockArrows: (arrowIds: string[]) => void;
  failMove: (arrowId: string) => void;
  removeArrow: (arrowId: string) => void;
  removeArrows: (arrowIds: string[]) => void;
  showHint: (arrowId: string) => void;
}

export function useArrowActions({
  isIntroAnimating,
  baseCellSize,
  cameraScale,
  focusHintArrow,
  setShakingArrow,
  blockArrow,
  unblockArrows,
  failMove,
  removeArrow,
  removeArrows,
  showHint,
}: UseArrowActionsParams) {
  const handleArrowClick = useCallback((arrowId: string) => {
    if (isIntroAnimating) return;

    const currentState = useGameStore.getState();
    const { status: currentStatus, gridSize: currentGrid } = currentState;

    if (currentStatus !== 'playing') return;

    // ⚡ O(1) через globalIndex вместо O(n) .find()
    const arrow = globalIndex.getArrow(arrowId);
    if (!arrow) return;

    const grid = { width: currentGrid.width, height: currentGrid.height };
    const result = processMove(arrow, currentState.arrows, grid);

    // [Legacy] result.defrosted — ледяные стрелки
    // if (result.defrosted) return;

    if (result.collision) {
      setShakingArrow(arrowId);
      blockArrow(arrowId);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
      setTimeout(() => {
        setShakingArrow(null);
        failMove(arrowId);
      }, ANIMATIONS.arrowError);
    } else {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');

      const idsToRemove: string[] = [arrowId];

      // [Legacy] Бомба и электро стрелки
      // if (result.bombExplosion?.length) {
      //   for (const exploded of result.bombExplosion) idsToRemove.push(exploded.id);
      //   window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('heavy');
      // }
      // if (result.electricTarget) idsToRemove.push(result.electricTarget.id);

      // ⚡ Собираем стрелки через globalIndex.getArrow() — O(1) каждая
      const arrowsToFly = idsToRemove
        .map((id) => globalIndex.getArrow(id))
        .filter((a): a is NonNullable<typeof a> => !!a);

      const activeSkin = getSkin(currentState.activeSkinId);
      emitFlyFX(arrowsToFly, baseCellSize, cameraScale.get(), activeSkin);
      wakeFXOverlay();

      if (idsToRemove.length === 1) removeArrow(arrowId);
      else removeArrows(idsToRemove);

      // ⚡ Auto-unblock через globalIndex — O(1) getArrow + O(pathLen) isBlocked
      requestAnimationFrame(() => {
        const state = useGameStore.getState();
        const blocked = state.blockedArrowIds;
        if (blocked.length === 0) return;
        const currentGrid2 = { width: state.gridSize.width, height: state.gridSize.height };
        const toUnblock = blocked.filter((id) => {
          // ⚡ O(1) вместо O(n) .find()
          const a = globalIndex.getArrow(id);
          if (!a) return true; // стрелка удалена — разблокировать
          return !globalIndex.isBlocked(a, currentGrid2);
        });
        if (toUnblock.length > 0) unblockArrows(toUnblock);
      });
    }
  }, [
    setShakingArrow,
    blockArrow,
    unblockArrows,
    failMove,
    removeArrow,
    removeArrows,
    isIntroAnimating,
    baseCellSize,
    cameraScale,
  ]);

  const handleHint = useCallback(() => {
    if (isIntroAnimating) return;
    const {
      arrows: currentArrows,
      gridSize: currentGrid,
      hintsRemaining: hints,
      hintedArrowId: currentHinted,
    } = useGameStore.getState();
    if (hints <= 0) return;
    if (currentHinted && currentArrows.some((a) => a.id === currentHinted)) {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
      focusHintArrow(currentHinted, true);
      return;
    }
    const free = getFreeArrows(currentArrows, { width: currentGrid.width, height: currentGrid.height });
    if (free.length > 0) showHint(free[0].id);
  }, [showHint, isIntroAnimating, focusHintArrow]);

  return { handleArrowClick, handleHint };
}