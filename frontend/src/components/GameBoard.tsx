/**
 * Arrow Puzzle - Game Board Component (PHASE 1 OPTIMIZED)
 * 
 * Оптимизации:
 * 1. ArrowSVG обёрнут в React.memo с кастомным comparator
 * 2. Overlay div'ы убиты → occupancy map + один SVG click handler
 * 3. Grid dots: SVG pattern для больших полей вместо тысяч <circle>
 * 4. onArrowClick стабилизирован через occupancy map (O(1) lookup)
 */

import { useMemo, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Arrow } from '../game/types';
import { DIRECTIONS, ARROW_EMOJIS, ARROW_GEOMETRY } from '../config/constants';
import { useGameStore } from '../stores/store';
import { hitTestArrow } from '../utils/boardUtils';
import { useActiveSkin, type GameSkin } from '../game/skins';

// ============================================
// OCCUPANCY MAP — O(1) hit testing
// ============================================

/** Строит карту: "x,y" → arrowId для мгновенного поиска стрелки по клику */
function buildOccupancyMap(arrows: Arrow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const arrow of arrows) {
    for (const cell of arrow.cells) {
      map.set(`${cell.x},${cell.y}`, arrow.id);
    }
  }
  return map;
}

// ============================================
// GRID DOTS — адаптивный рендеринг
// ============================================

/** 
 * Grid ≤ 20: SVG circles (качественно, немного нод)
 * Grid > 20: SVG <pattern> + <rect> (1 элемент вместо сотен/тысяч)
 */
function GridDots({ 
  gridSize, 
  cellSize, 
  occupiedCells,
  skin
}: { 
  gridSize: { width: number; height: number }; 
  cellSize: number; 
  occupiedCells: Set<string>;
  skin: GameSkin;
}) {
  const totalCells = gridSize.width * gridSize.height;
  const dotR = cellSize * skin.geometry.gridDotRadius;
  const half = cellSize / 2;

  // Большие поля → паттерн (1 DOM-нода вместо тысяч)
  if (totalCells > 400) {
    const patternId = 'grid-dot-pattern';
    return (
      <g>
        <defs>
          <pattern
            id={patternId}
            width={cellSize}
            height={cellSize}
            patternUnits="userSpaceOnUse"
          >
            <circle
              cx={half}
              cy={half}
              r={dotR}
              fill={skin.colors.gridDotColor}
            />
          </pattern>
        </defs>
        {/* Фоновый слой точек — покрывает всё поле */}
        <rect
          width={gridSize.width * cellSize}
          height={gridSize.height * cellSize}
          fill={`url(#${patternId})`}
        />
        {/* Маскируем занятые ячейки — рисуем тёмные rect поверх точек */}
        {Array.from(occupiedCells).map(key => {
          const [x, y] = key.split(',').map(Number);
          return (
            <rect
              key={`mask-${key}`}
              x={x * cellSize}
              y={y * cellSize}
              width={cellSize}
              height={cellSize}
              fill="transparent"
            />
          );
        })}
      </g>
    );
  }

  // Маленькие поля → индивидуальные circles (лучше контроль)
  const dots: JSX.Element[] = [];
  for (let y = 0; y < gridSize.height; y++) {
    for (let x = 0; x < gridSize.width; x++) {
      if (!occupiedCells.has(`${x},${y}`)) {
        dots.push(
          <circle
            key={`dot-${x}-${y}`}
            cx={x * cellSize + half}
            cy={y * cellSize + half}
            r={dotR}
            fill={skin.colors.gridDotColor}
          />
        );
      }
    }
  }

  return <g>{dots}</g>;
}

// ============================================
// MAIN BOARD COMPONENT
// ============================================

interface GameBoardProps {
  arrows: Arrow[];
  gridSize: { width: number; height: number };
  cellSize: number;
  hintedArrowId: string | null;
  onArrowClick: (arrowId: string) => void;
}

export function GameBoard({
  arrows,
  gridSize,
  cellSize,
  hintedArrowId,
  onArrowClick,
}: GameBoardProps) {
  // Атомарный селектор — ре-рендер ТОЛЬКО при смене shakingArrowId
  const shakingArrowId = useGameStore(s => s.shakingArrowId);
  const skin = useActiveSkin();
  const boardWidth = gridSize.width * cellSize;
  const boardHeight = gridSize.height * cellSize;
  
  // Occupancy map — пересчитывается только при изменении arrows
  const occupancyMap = useMemo(() => buildOccupancyMap(arrows), [arrows]);
  
  // Set занятых ячеек для grid dots
  const occupiedCells = useMemo(() => {
    const set = new Set<string>();
    for (const arrow of arrows) {
      for (const cell of arrow.cells) {
        set.add(`${cell.x},${cell.y}`);
      }
    }
    return set;
  }, [arrows]);

  // Единый SVG click handler — O(1) через occupancy map + scale-aware
  const handleSVGClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const arrowId = hitTestArrow(
      e.clientX, e.clientY, e.currentTarget,
      cellSize, gridSize.width, gridSize.height, occupancyMap
    );
    if (arrowId) onArrowClick(arrowId);
  }, [cellSize, gridSize.width, gridSize.height, occupancyMap, onArrowClick]);

  // Touch handler (для мобилок — touchend как клик)
  const handleSVGTouch = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length !== 1) return;
    const touch = e.changedTouches[0];
    const arrowId = hitTestArrow(
      touch.clientX, touch.clientY, e.currentTarget,
      cellSize, gridSize.width, gridSize.height, occupancyMap
    );
    if (arrowId) {
      e.preventDefault();
      onArrowClick(arrowId);
    }
  }, [cellSize, gridSize.width, gridSize.height, occupancyMap, onArrowClick]);
  
  return (
    <div
      className="relative game-board origin-center"
      style={{ width: boardWidth, height: boardHeight }}
    >
      <svg
        width={boardWidth}
        height={boardHeight}
        viewBox={`0 0 ${boardWidth} ${boardHeight}`}
        className="absolute inset-0"
        style={{ overflow: 'visible', cursor: 'pointer' }}
        onClick={handleSVGClick}
        onTouchEnd={handleSVGTouch}
      >
        {/* Grid dots — адаптивный рендеринг */}
        <GridDots 
          gridSize={gridSize} 
          cellSize={cellSize} 
          occupiedCells={occupiedCells}
          skin={skin}
        />
        
        {/* Arrows — AnimatePresence для exit-анимаций */}
        <AnimatePresence>
          {arrows.map(arrow => (
            <ArrowSVG
              key={arrow.id}
              arrow={arrow}
              cellSize={cellSize}
              isHinted={arrow.id === hintedArrowId}
              isShaking={arrow.id === shakingArrowId}
              skin={skin}
            />
          ))}
        </AnimatePresence>
      </svg>
      
      {/* 
        УБИТО: overlay div'ы (было ~2500 абсолютных div для кликов)
        ЗАМЕНЕНО: единый SVG onClick + occupancy map (O(1) lookup)
      */}
    </div>
  );
}

// ============================================
// ARROW SVG COMPONENT — MEMOIZED
// ============================================

interface ArrowSVGProps {
  arrow: Arrow;
  cellSize: number;
  isHinted: boolean;
  isShaking: boolean;
  skin: GameSkin;
}

/**
 * React.memo с кастомным comparator:
 * - Сравниваем arrow.id (не весь объект — ссылка стабильна после filter())
 * - Сравниваем примитивы cellSize, isHinted, isShaking
 * 
 * Результат: при удалении 1 стрелки из 500 → рендерится только 1 (exit),
 * остальные 499 пропускают рендер полностью.
 */
const ArrowSVG = memo(function ArrowSVG({ 
  arrow, 
  cellSize, 
  isHinted, 
  isShaking,
  skin,
}: ArrowSVGProps) {
  const dir = DIRECTIONS[arrow.direction];
  const head = arrow.cells[0];
  const half = cellSize / 2;

  const strokeWidth = cellSize * skin.geometry.bodyStrokeRatio;
  const headGap = cellSize * skin.geometry.headGapRatio;

  // Путь змейки — memo по arrow.id + cellSize (стабильные deps)
  const pathD = useMemo(() => {
    const cellsReversed = [...arrow.cells].reverse();
    const points = cellsReversed.map(c => ({ 
      x: c.x * cellSize + half, 
      y: c.y * cellSize + half 
    }));
    
    if (points.length > 1) {
      const lastPoint = points[points.length - 1];
      lastPoint.x -= dir.dx * headGap;
      lastPoint.y -= dir.dy * headGap;
    }

    let path = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x},${points[i].y}`;
    }

    const flyDistance = cellSize * 15; 
    const lastP = points[points.length - 1];
    path += ` L ${lastP.x + dir.dx * flyDistance},${lastP.y + dir.dy * flyDistance}`;

    return path;
  }, [arrow.id, arrow.cells.length, cellSize, arrow.direction]);
  
  const geometricLength = ((arrow.cells.length - 1) * cellSize) - headGap;
  const bodyLength = Math.max(0, geometricLength);
  const flyOutDistance = cellSize * 10;

  const headX = head.x * cellSize + half;
  const headY = head.y * cellSize + half;
  const strokeColor = isHinted ? skin.colors.hintColor : arrow.color;

  const exitTransition = { duration: skin.animation.flyDuration / 1000, ease: "easeIn" as const };

  return (
    <motion.g
      style={{ cursor: 'pointer' }}
      animate={{ x: isShaking ? [0, -skin.animation.shakeAmplitude, skin.animation.shakeAmplitude, -skin.animation.shakeAmplitude, skin.animation.shakeAmplitude, 0] : 0 }}
      transition={{ duration: skin.animation.shakeDuration / 1000 }}
    >
      {/* Белая подложка */}
      <motion.path
        d={pathD}
        stroke={skin.colors.outlineColor}
        strokeWidth={strokeWidth + cellSize * skin.geometry.outlineExtraRatio}
        strokeLinecap={skin.geometry.lineCap as any}
        strokeLinejoin={skin.geometry.lineJoin as any}
        fill="none"
        initial={{ strokeDasharray: `${bodyLength} 20000`, strokeDashoffset: 0, opacity: 1 }}
        animate={{ strokeDashoffset: 0, opacity: 1 }}
        exit={{ strokeDashoffset: -flyOutDistance, opacity: 0 }}
        transition={exitTransition}
      />

      {/* Цветная линия */}
      <motion.path
        d={pathD}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap={skin.geometry.lineCap as any}
        strokeLinejoin={skin.geometry.lineJoin as any}
        fill="none"
        initial={{ strokeDasharray: `${bodyLength} 20000`, strokeDashoffset: 0, opacity: 1 }}
        animate={{ strokeDashoffset: 0, opacity: 1 }}
        exit={{ strokeDashoffset: -flyOutDistance, opacity: 0 }}
        transition={exitTransition}
      />

      {/* Голова */}
      <motion.g
        initial={{ x: 0, y: 0, opacity: 1 }}
        animate={{ x: 0, y: 0, opacity: 1 }}
        exit={{ x: dir.dx * flyOutDistance, y: dir.dy * flyOutDistance, opacity: 0 }}
        transition={exitTransition}
      >
        <path
          d={`M -${cellSize * skin.geometry.chevronLengthRatio} -${cellSize * skin.geometry.chevronSpreadRatio} L 0 0 L -${cellSize * skin.geometry.chevronLengthRatio} ${cellSize * skin.geometry.chevronSpreadRatio}`}
          stroke={strokeColor}
          strokeWidth={strokeWidth * skin.geometry.chevronStrokeMultiplier} 
          strokeLinecap={skin.geometry.lineCap as any}
          strokeLinejoin={skin.geometry.lineJoin as any}
          fill="none"
          transform={`translate(${headX}, ${headY}) rotate(${dir.angle})`}
        />
        
        {arrow.type !== 'normal' && (
          <text
            x={headX} y={headY} dy=".35em" textAnchor="middle" fontSize={cellSize * 0.5}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {ARROW_EMOJIS[arrow.type]}
          </text>
        )}
      </motion.g>
    </motion.g>
  );
}, (prev, next) => {
  // Кастомный comparator для React.memo
  // Возвращает true если props НЕ изменились (пропустить рендер)
  return (
    prev.arrow.id === next.arrow.id &&
    prev.arrow.cells.length === next.arrow.cells.length &&
    prev.arrow.color === next.arrow.color &&
    prev.arrow.direction === next.arrow.direction &&
    prev.arrow.type === next.arrow.type &&
    prev.arrow.frozen === next.arrow.frozen &&
    prev.cellSize === next.cellSize &&
    prev.isHinted === next.isHinted &&
    prev.isShaking === next.isShaking &&
    prev.skin.id === next.skin.id
  );
});