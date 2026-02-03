/**
 * Arrow Puzzle - Game Board Component
 * 
 * SVG-рендеринг игрового поля со стрелками.
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
    if (gridSize.width > 15) return []; // Не рисуем точки на больших полях
    
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
      className="relative game-board"
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
      
      {/* Clickable overlays */}
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
// ARROW SVG COMPONENT (THIN LINE STYLE)
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
  
  // Строим path через центры клеток
  const buildBodyPath = (cells: Array<{ x: number; y: number }>) => {
    if (!cells || cells.length === 0) return '';
    const half = cellSize / 2;
    const points = cells.map(c => ({ 
      x: c.x * cellSize + half, 
      y: c.y * cellSize + half 
    }));
    
    if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
    
    return `M ${points[0].x},${points[0].y}` + 
           points.slice(1).map(p => ` L ${p.x},${p.y}`).join('');
  };
  
  const headX = head.x * cellSize + cellSize / 2;
  const headY = head.y * cellSize + cellSize / 2;
  const angle = dir.angle;
  
  // Толщина линии (адаптивная для маленьких клеток)
  const thicknessScale = cellSize < 25 ? 0.2 : ARROW_GEOMETRY.bodyThickness;
  const strokeWidth = cellSize * thicknessScale;
  
  // Размеры острия стрелки
  const headLength = cellSize * ARROW_GEOMETRY.headLength;
  const headWidth = cellSize * ARROW_GEOMETRY.headWidth;
  
  // Path для острия (V-образная форма)
  const headPathD = `M -${headLength} -${headWidth/2} L 0 0 L -${headLength} ${headWidth/2}`;
  
  // Цвет (error / hint / normal)
  const strokeColor = isHinted ? '#FFD700' : arrow.color;
  
  // Анимация вылета
  const flyDistance = cellSize * 10;
  
  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{
        opacity: 1,
        scale: 1,
        filter: isHinted ? 'drop-shadow(0 0 8px gold)' : 'none',
        x: isShaking ? [0, -4, 4, -4, 4, 0] : 0,
      }}
      exit={{
        opacity: 0,
        x: dir.dx * flyDistance,
        y: dir.dy * flyDistance,
        transition: { duration: 0.3, ease: 'easeOut' },
      }}
      transition={{
        x: isShaking ? { duration: 0.3 } : undefined,
      }}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      {/* Белый контур для контраста */}
      <path
        d={buildBodyPath(arrow.cells)}
        stroke="#FFFFFF"
        strokeWidth={strokeWidth + cellSize * 0.08}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      
      {/* Основная цветная линия */}
      <path
        d={buildBodyPath(arrow.cells)}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        className="transition-colors duration-200"
      />
      
      {/* Острие стрелки (белый контур) */}
      <path
        d={headPathD}
        stroke="#FFFFFF"
        strokeWidth={strokeWidth + cellSize * 0.08}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        transform={`translate(${headX}, ${headY}) rotate(${angle})`}
      />
      
      {/* Острие стрелки (цветное) */}
      <path
        d={headPathD}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        transform={`translate(${headX}, ${headY}) rotate(${angle})`}
        className="transition-colors duration-200"
      />
      
      {/* Эмодзи на голове стрелки */}
      {arrow.type !== 'normal' && (
        <text
          x={headX}
          y={headY + cellSize * 0.05}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={cellSize * 0.5}
          style={{ pointerEvents: 'none' }}
        >
          {ARROW_EMOJIS[arrow.type]}
        </text>
      )}
      
      {/* Ice overlay (полупрозрачные кружки на клетках) */}
      {arrow.type === 'ice' && arrow.frozen && (
        arrow.cells.map((cell, i) => (
          <circle
            key={`ice-${i}`}
            cx={cell.x * cellSize + cellSize / 2}
            cy={cell.y * cellSize + cellSize / 2}
            r={cellSize * 0.3}
            fill="rgba(135, 206, 235, 0.4)"
            className="pointer-events-none"
          />
        ))
      )}
      
      {/* Hint highlight (пульсирующий круг на голове) */}
      {isHinted && (
        <motion.circle
          cx={headX}
          cy={headY}
          r={cellSize * 0.4}
          fill="none"
          stroke="gold"
          strokeWidth={3}
          animate={{ opacity: [0.5, 1, 0.5], r: [cellSize * 0.3, cellSize * 0.5, cellSize * 0.3] }}
          transition={{ duration: 1, repeat: Infinity }}
        />
      )}
    </motion.g>
  );
}