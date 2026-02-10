/**
 * Arrow Puzzle - Game Board Component
 * * SVG-рендеринг игрового поля со стрелками.
 */

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Arrow } from '../game/types';
import { DIRECTIONS, ARROW_EMOJIS, ARROW_GEOMETRY } from '../config/constants';
import { useGameStore } from '../stores/store';

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
  const { shakingArrowId } = useGameStore();
  
  const boardWidth = gridSize.width * cellSize;
  const boardHeight = gridSize.height * cellSize;
  
  // Сетка точек
  const gridDots = useMemo(() => {
    if (gridSize.width > 15) return [];
    
    const dots: { x: number; y: number; occupied: boolean }[] = [];
    const occupiedCells = new Set<string>();
    
    for (const arrow of arrows) {
      for (const cell of arrow.cells) {
        occupiedCells.add(`${cell.x},${cell.y}`);
      }
    }
    
    for (let y = 0; y < gridSize.height; y++) {
      for (let x = 0; x < gridSize.width; x++) {
        dots.push({
          x,
          y,
          occupied: occupiedCells.has(`${x},${y}`),
        });
      }
    }
    
    return dots;
  }, [arrows, gridSize]);
  
  return (
    <div
      className="relative game-board origin-center" // Важно для зума
      style={{ width: boardWidth, height: boardHeight }}
    >
      <svg
        width={boardWidth}
        height={boardHeight}
        viewBox={`0 0 ${boardWidth} ${boardHeight}`}
        className="absolute inset-0"
        style={{ overflow: 'visible' }}
      >
        {/* Grid dots */}
        <g>
          {gridDots.map(dot => (
            !dot.occupied && (
              <circle
                key={`dot-${dot.x}-${dot.y}`}
                cx={dot.x * cellSize + cellSize / 2}
                cy={dot.y * cellSize + cellSize / 2}
                r={cellSize * ARROW_GEOMETRY.dotRadius}
                className="grid-dot"
                fill="rgba(255,255,255,0.1)" // Добавил цвет, если CSS не подгрузится
              />
            )
          ))}
        </g>
        
        {/* Arrows */}
        <AnimatePresence>
          {arrows.map(arrow => (
            <ArrowSVG
              key={arrow.id}
              arrow={arrow}
              cellSize={cellSize}
              isHinted={arrow.id === hintedArrowId}
              isShaking={arrow.id === shakingArrowId}
              onClick={() => onArrowClick(arrow.id)}
            />
          ))}
        </AnimatePresence>
      </svg>
      
      {/* Clickable overlays (для удобства клика) */}
      <div className="absolute inset-0">
        {arrows.map(arrow => (
          arrow.cells.map((cell, idx) => (
            <div
              key={`click-${arrow.id}-${idx}`}
              onClick={() => onArrowClick(arrow.id)}
              className="absolute cursor-pointer"
              style={{
                left: cell.x * cellSize,
                top: cell.y * cellSize,
                width: cellSize,
                height: cellSize,
                zIndex: 10,
              }}
            />
          ))
        ))}
      </div>
    </div>
  );
}

// ============================================
// ARROW SVG COMPONENT (SNAKE ANIMATION)
// ============================================

interface ArrowSVGProps {
  arrow: Arrow;
  cellSize: number;
  isHinted: boolean;
  isShaking: boolean;
  onClick: () => void;
}

function ArrowSVG({ arrow, cellSize, isHinted, isShaking, onClick }: ArrowSVGProps) {
  const dir = DIRECTIONS[arrow.direction];
  const head = arrow.cells[0];
  const half = cellSize / 2;

  // === СТАНДАРТ 3: ГЕОМЕТРИЯ ===
  const STROKE_RATIO = 0.20; // Толщина линии = 20% клетки
  const HEAD_GAP_RATIO = 0.25; // Разрыв перед головой = 25% клетки
  
  const strokeWidth = cellSize * STROKE_RATIO;
  const headGap = cellSize * HEAD_GAP_RATIO;

  // 1. Строим путь
  const buildSnakePath = () => {
    const cellsReversed = [...arrow.cells].reverse();
    const points = cellsReversed.map(c => ({ 
      x: c.x * cellSize + half, 
      y: c.y * cellSize + half 
    }));
    
    // Подрезаем конец линии строго по стандарту
    if (points.length > 1) {
      const lastPoint = points[points.length - 1];
      lastPoint.x -= dir.dx * headGap;
      lastPoint.y -= dir.dy * headGap;
    }

    let path = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x},${points[i].y}`;
    }

    // Линия вылета
    const flyDistance = cellSize * 15; 
    const lastP = points[points.length - 1];
    const exitX = lastP.x + dir.dx * flyDistance;
    const exitY = lastP.y + dir.dy * flyDistance;
    
    path += ` L ${exitX},${exitY}`;

    return path;
  };

  const pathD = useMemo(() => buildSnakePath(), [arrow, cellSize]);
  
  // Длина тела строго по геометрии
  const geometricLength = ((arrow.cells.length - 1) * cellSize) - headGap;
  const bodyLength = Math.max(0, geometricLength);
  const flyOutDistance = cellSize * 10;

  // Координаты головы
  const headX = head.x * cellSize + half;
  const headY = head.y * cellSize + half;
  const angle = dir.angle;
  const strokeColor = isHinted ? '#FFD700' : arrow.color;

  const exitTransition = { duration: 0.4, ease: "easeIn" };

  return (
    <motion.g
      onClick={onClick}
      style={{ cursor: 'pointer' }}
      animate={{ x: isShaking ? [0, -4, 4, -4, 4, 0] : 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Белая подложка */}
      <motion.path
        d={pathD}
        stroke="#FFFFFF"
        strokeWidth={strokeWidth + cellSize * 0.08}
        strokeLinecap="round"
        strokeLinejoin="round"
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
        strokeLinecap="round"
        strokeLinejoin="round"
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
          d={`M -${cellSize * 0.45} -${cellSize * 0.25} L 0 0 L -${cellSize * 0.45} ${cellSize * 0.25}`}
          stroke={strokeColor}
          strokeWidth={strokeWidth * 1.2} 
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          transform={`translate(${headX}, ${headY}) rotate(${angle})`}
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
}