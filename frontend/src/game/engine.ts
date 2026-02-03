/**
 * Arrow Puzzle - Game Engine
 * 
 * Логика проверки столкновений, валидации ходов,
 * обработки спецстрелок.
 */

import type { Arrow, Cell, Grid, MoveResult, DependencyGraph } from './types';
import { DIRECTIONS, type Direction } from '../config/constants';

// ============================================
// BASIC HELPERS
// ============================================

/**
 * Следующая клетка в направлении
 */
export function nextCell(cell: Cell, direction: Direction): Cell {
  const { dx, dy } = DIRECTIONS[direction];
  return { x: cell.x + dx, y: cell.y + dy };
}

/**
 * Проверка что клетка в границах поля
 */
export function inBounds(cell: Cell, grid: Grid): boolean {
  return cell.x >= 0 && cell.x < grid.width && cell.y >= 0 && cell.y < grid.height;
}

/**
 * Ключ клетки для Map/Set
 */
export function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

/**
 * Парсинг ключа клетки
 */
export function parseKey(key: string): Cell {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

// ============================================
// PATH & COLLISION
// ============================================

/**
 * Получить путь полёта стрелки (от головы до края поля)
 */
export function getArrowPath(arrow: Arrow, grid: Grid): Cell[] {
  const head = arrow.cells[0];
  const { dx, dy } = DIRECTIONS[arrow.direction];
  const path: Cell[] = [];
  
  let current: Cell = { x: head.x + dx, y: head.y + dy };
  
  while (inBounds(current, grid)) {
    path.push({ ...current });
    current = { x: current.x + dx, y: current.y + dy };
  }
  
  return path;
}

/**
 * Проверка: заблокирована ли стрелка?
 */
export function isArrowBlocked(
  arrow: Arrow,
  allArrows: Arrow[],
  grid: Grid
): boolean {
  const path = getArrowPath(arrow, grid);
  const pathSet = new Set(path.map(cellKey));
  
  for (const other of allArrows) {
    if (other.id === arrow.id) continue;
    
    for (const cell of other.cells) {
      if (pathSet.has(cellKey(cell))) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Найти стрелку, с которой произойдёт столкновение
 */
export function findCollision(
  arrow: Arrow,
  allArrows: Arrow[],
  grid: Grid
): Arrow | null {
  const path = getArrowPath(arrow, grid);
  
  for (const pathCell of path) {
    for (const other of allArrows) {
      if (other.id === arrow.id) continue;
      
      for (const otherCell of other.cells) {
        if (pathCell.x === otherCell.x && pathCell.y === otherCell.y) {
          return other;
        }
      }
    }
  }
  
  return null;
}

/**
 * Получить все свободные (незаблокированные) стрелки
 */
export function getFreeArrows(arrows: Arrow[], grid: Grid): Arrow[] {
  return arrows.filter(arrow => !isArrowBlocked(arrow, arrows, grid));
}

// ============================================
// DEPENDENCY GRAPH (DAG)
// ============================================

/**
 * Построить граф зависимостей
 * 
 * edges[A] = [B, C] означает: A заблокирована стрелками B и C
 */
export function buildDependencyGraph(arrows: Arrow[], grid: Grid): DependencyGraph {
  const nodes = new Map<string, Arrow>();
  const edges = new Map<string, string[]>();
  const reverseEdges = new Map<string, string[]>();
  
  // Инициализация
  for (const arrow of arrows) {
    nodes.set(arrow.id, arrow);
    edges.set(arrow.id, []);
    reverseEdges.set(arrow.id, []);
  }
  
  // Построение рёбер
  for (const arrow of arrows) {
    const path = getArrowPath(arrow, grid);
    const pathSet = new Set(path.map(cellKey));
    
    for (const other of arrows) {
      if (other.id === arrow.id) continue;
      
      // Проверяем: блокирует ли other стрелку arrow?
      const blocks = other.cells.some(cell => pathSet.has(cellKey(cell)));
      
      if (blocks) {
        edges.get(arrow.id)!.push(other.id);
        reverseEdges.get(other.id)!.push(arrow.id);
      }
    }
  }
  
  return { nodes, edges, reverseEdges };
}

/**
 * Проверка: является ли граф ациклическим (DAG)?
 * Использует алгоритм Кана (топологическая сортировка)
 */
export function isValidDAG(arrows: Arrow[], grid: Grid): boolean {
  const graph = buildDependencyGraph(arrows, grid);
  const inDegree = new Map<string, number>();
  
  // Считаем входящие степени
  for (const [id, blockers] of graph.edges) {
    inDegree.set(id, blockers.length);
  }
  
  // Очередь свободных вершин
  const queue: string[] = [];
  inDegree.forEach((degree, id) => {
    if (degree === 0) queue.push(id);
  });
  
  let processedCount = 0;
  
  while (queue.length > 0) {
    const freeId = queue.shift()!;
    processedCount++;
    
    // Уменьшаем степени тех, кто ждёт эту вершину
    for (const waiterId of graph.reverseEdges.get(freeId) || []) {
      const newDegree = (inDegree.get(waiterId) || 0) - 1;
      inDegree.set(waiterId, newDegree);
      
      if (newDegree === 0) {
        queue.push(waiterId);
      }
    }
  }
  
  return processedCount === arrows.length;
}

/**
 * Получить порядок решения (топологическая сортировка)
 */
export function getSolution(arrows: Arrow[], grid: Grid): string[] | null {
  const graph = buildDependencyGraph(arrows, grid);
  const inDegree = new Map<string, number>();
  
  for (const [id, blockers] of graph.edges) {
    inDegree.set(id, blockers.length);
  }
  
  const queue: string[] = [];
  inDegree.forEach((degree, id) => {
    if (degree === 0) queue.push(id);
  });
  
  const solution: string[] = [];
  
  while (queue.length > 0) {
    const freeId = queue.shift()!;
    solution.push(freeId);
    
    for (const waiterId of graph.reverseEdges.get(freeId) || []) {
      const newDegree = (inDegree.get(waiterId) || 0) - 1;
      inDegree.set(waiterId, newDegree);
      
      if (newDegree === 0) {
        queue.push(waiterId);
      }
    }
  }
  
  if (solution.length !== arrows.length) {
    return null; // Цикл!
  }
  
  return solution;
}

// ============================================
// SPECIAL ARROWS
// ============================================

/**
 * Обработка клика по ледяной стрелке
 */
export function handleIceArrowClick(arrow: Arrow): {
  action: 'defrost' | 'fly';
  arrow: Arrow;
} {
  if (arrow.type !== 'ice') {
    return { action: 'fly', arrow };
  }
  
  if (arrow.frozen) {
    return {
      action: 'defrost',
      arrow: { ...arrow, frozen: false },
    };
  }
  
  return { action: 'fly', arrow };
}

/**
 * Получить соседей для бомбы (в радиусе 1)
 */
export function getBombNeighbors(
  bombArrow: Arrow,
  allArrows: Arrow[],
  radius: number = 1
): Arrow[] {
  const neighbors: Arrow[] = [];
  
  // Собираем все клетки бомбы
  const bombCells = new Set(bombArrow.cells.map(cellKey));
  
  for (const arrow of allArrows) {
    if (arrow.id === bombArrow.id) continue;
    
    let isNeighbor = false;
    
    for (const arrowCell of arrow.cells) {
      for (const bombCell of bombArrow.cells) {
        const distance = Math.abs(arrowCell.x - bombCell.x) + Math.abs(arrowCell.y - bombCell.y);
        if (distance <= radius) {
          isNeighbor = true;
          break;
        }
      }
      if (isNeighbor) break;
    }
    
    if (isNeighbor) {
      neighbors.push(arrow);
    }
  }
  
  return neighbors;
}

/**
 * Найти цель для электрической стрелки
 * (ближайшая свободная стрелка)
 */
export function getElectricTarget(
  electricArrow: Arrow,
  allArrows: Arrow[],
  grid: Grid
): Arrow | null {
  // Находим свободные стрелки (кроме электро и замороженных)
  const candidates = allArrows.filter(a =>
    a.id !== electricArrow.id &&
    a.type !== 'electric' &&
    !(a.type === 'ice' && a.frozen) &&
    !isArrowBlocked(a, allArrows, grid)
  );
  
  if (candidates.length === 0) return null;
  
  // Находим ближайшую к голове электро-стрелки
  const head = electricArrow.cells[0];
  
  let closest = candidates[0];
  let closestDist = Infinity;
  
  for (const arrow of candidates) {
    const arrowHead = arrow.cells[0];
    const dist = Math.abs(arrowHead.x - head.x) + Math.abs(arrowHead.y - head.y);
    
    if (dist < closestDist) {
      closestDist = dist;
      closest = arrow;
    }
  }
  
  return closest;
}

// ============================================
// MOVE PROCESSING
// ============================================

/**
 * Обработать ход (клик по стрелке)
 */
export function processMove(
  arrow: Arrow,
  allArrows: Arrow[],
  grid: Grid
): MoveResult {
  // Проверяем ледяную стрелку
  if (arrow.type === 'ice' && arrow.frozen) {
    return {
      success: true,
      collision: false,
      defrosted: true,
    };
  }
  
  // Проверяем столкновение
  const collidedWith = findCollision(arrow, allArrows, grid);
  
  if (collidedWith) {
    return {
      success: false,
      collision: true,
      collidedWith,
    };
  }
  
  // Успешное удаление
  const result: MoveResult = {
    success: true,
    collision: false,
  };
  
  // Обрабатываем спецстрелки
  if (arrow.type === 'plus_life') {
    result.bonusLife = true;
  }
  
  if (arrow.type === 'bomb') {
    const remaining = allArrows.filter(a => a.id !== arrow.id);
    result.bombExplosion = getBombNeighbors(arrow, remaining);
  }
  
  if (arrow.type === 'electric') {
    const remaining = allArrows.filter(a => a.id !== arrow.id);
    result.electricTarget = getElectricTarget(arrow, remaining, grid) || undefined;
  }
  
  return result;
}

// ============================================
// SIMULATION (for server validation)
// ============================================

export interface SimulationResult {
  valid: boolean;
  error?: string;
  mistakes: number;
  finalArrows: Arrow[];
}

/**
 * Симулировать последовательность ходов
 */
export function simulateMoves(
  initialArrows: Arrow[],
  grid: Grid,
  moves: string[]
): SimulationResult {
  let arrows = [...initialArrows];
  let mistakes = 0;
  let lives = 3;
  
  for (let i = 0; i < moves.length; i++) {
    const arrowId = moves[i];
    const arrow = arrows.find(a => a.id === arrowId);
    
    if (!arrow) {
      return {
        valid: false,
        error: `Arrow ${arrowId} not found at move ${i}`,
        mistakes,
        finalArrows: arrows,
      };
    }
    
    // Обрабатываем ход
    const result = processMove(arrow, arrows, grid);
    
    if (result.collision) {
      mistakes++;
      lives--;
      
      if (lives <= 0) {
        return {
          valid: false,
          error: 'No lives left',
          mistakes,
          finalArrows: arrows,
        };
      }
      // Стрелка остаётся
      continue;
    }
    
    // Удаляем стрелку
    arrows = arrows.filter(a => a.id !== arrowId);
    
    // Обрабатываем бомбу
    if (result.bombExplosion && result.bombExplosion.length > 0) {
      const explosionIds = new Set(result.bombExplosion.map(a => a.id));
      arrows = arrows.filter(a => !explosionIds.has(a.id));
    }
    
    // Обрабатываем электро
    if (result.electricTarget) {
      arrows = arrows.filter(a => a.id !== result.electricTarget!.id);
    }
  }
  
  // Проверяем что все стрелки убраны
  if (arrows.length > 0) {
    return {
      valid: false,
      error: `${arrows.length} arrows remaining`,
      mistakes,
      finalArrows: arrows,
    };
  }
  
  return {
    valid: true,
    mistakes,
    finalArrows: [],
  };
}

/**
 * Подсчёт звёзд
 */
export function calculateStars(mistakes: number): number {
  if (mistakes === 0) return 3;
  if (mistakes === 1) return 2;
  return 1;
}

/**
 * Подсчёт монет
 */
export function calculateCoins(level: number, stars: number): number {
  const base = 10 + Math.floor(level / 10) * 2;
  const multiplier = stars === 3 ? 1.5 : stars === 2 ? 1.2 : 1.0;
  return Math.floor(base * multiplier);
}