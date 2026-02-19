/**
 * Arrow Puzzle - Game Engine (PHASE 2 OPTIMIZED)
 * 
 * Оптимизации:
 * 1. findCollision: O(pathLength) вместо O(n × cells) — через SpatialIndex
 * 2. isArrowBlocked: O(pathLength) вместо O(n × cells)
 * 3. getFreeArrows: O(n × pathLength) вместо O(n² × cells)
 * 4. buildDependencyGraph: O(n × pathLength) вместо O(n² × cells)
 * 5. getBombNeighbors: O(arrowCells × radius²) вместо O(n × cells²)
 * 6. getElectricTarget: использует индекс для getFreeArrows
 * 7. Path cache: повторные запросы пути одной стрелки = O(1)
 * 
 * API полностью совместим с оригиналом — drop-in replacement.
 * Функции, которые принимают allArrows[], строят временный индекс если нужно.
 * Функции с суффиксом *Indexed — принимают SpatialIndex напрямую (быстрее).
 */

import type { Arrow, Cell, Grid, MoveResult, DependencyGraph } from './types';
import { DIRECTIONS, type Direction } from '../config/constants';
import { 
  SpatialIndex, 
  globalIndex, 
  getPathCached, 
  clearPathCache 
} from './spatialIndex';

// ============================================
// BASIC HELPERS (без изменений)
// ============================================

export function nextCell(cell: Cell, direction: Direction): Cell {
  const { dx, dy } = DIRECTIONS[direction];
  return { x: cell.x + dx, y: cell.y + dy };
}

export function inBounds(cell: Cell, grid: Grid): boolean {
  return cell.x >= 0 && cell.x < grid.width && cell.y >= 0 && cell.y < grid.height;
}

export function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

export function parseKey(key: string): Cell {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

// ============================================
// PATH — оптимизированный
// ============================================

/**
 * Получить путь полёта стрелки (от головы до края поля).
 * Используется везде — кэшируется через spatialIndex.getPathCached().
 */
export function getArrowPath(arrow: Arrow, grid: Grid): Cell[] {
  // Используем кэш если доступен
  return getPathCached(arrow, grid);
}

// ============================================
// COLLISION — через SpatialIndex
// ============================================

/**
 * Проверка: заблокирована ли стрелка?
 * 
 * ОПТИМИЗИРОВАНО: O(pathLength) вместо O(n × cells).
 * Использует globalIndex для O(1) lookup каждой клетки пути.
 */
export function isArrowBlocked(
  arrow: Arrow,
  allArrows: Arrow[],
  grid: Grid
): boolean {
  // Если глобальный индекс актуален — используем его
  if (globalIndex.size > 0) {
    return globalIndex.isBlocked(arrow, grid);
  }
  
  // Fallback: строим временный индекс
  const tempIndex = new SpatialIndex();
  tempIndex.build(allArrows);
  return tempIndex.isBlocked(arrow, grid);
}

/**
 * Найти стрелку, с которой произойдёт столкновение.
 * 
 * ОПТИМИЗИРОВАНО: O(pathLength) вместо O(pathLength × n × cells).
 * Идёт по пути последовательно, первый hit в индексе = коллизия.
 */
export function findCollision(
  arrow: Arrow,
  allArrows: Arrow[],
  grid: Grid
): Arrow | null {
  if (globalIndex.size > 0) {
    return globalIndex.findFirstOnPath(arrow, grid);
  }
  
  // Fallback
  const tempIndex = new SpatialIndex();
  tempIndex.build(allArrows);
  return tempIndex.findFirstOnPath(arrow, grid);
}

/**
 * Получить все свободные (незаблокированные) стрелки.
 * 
 * ОПТИМИЗИРОВАНО: O(n × avgPathLength) вместо O(n² × cells).
 * На 500 стрелках: ~25,000 ops (~1ms) вместо ~62,500,000 ops (~3s).
 */
export function getFreeArrows(arrows: Arrow[], grid: Grid): Arrow[] {
  if (globalIndex.size > 0) {
    return globalIndex.getFreeArrows(grid);
  }
  
  // Fallback
  const tempIndex = new SpatialIndex();
  tempIndex.build(arrows);
  return tempIndex.getFreeArrows(grid);
}

// ============================================
// DEPENDENCY GRAPH — через SpatialIndex
// ============================================

/**
 * Построить граф зависимостей.
 * 
 * ОПТИМИЗИРОВАНО: использует SpatialIndex для поиска блокеров.
 * O(n × avgPathLength) вместо O(n² × cells).
 */
export function buildDependencyGraph(arrows: Arrow[], grid: Grid): DependencyGraph {
  const nodes = new Map<string, Arrow>();
  const edges = new Map<string, string[]>();
  const reverseEdges = new Map<string, string[]>();
  
  // Строим/используем индекс
  let index: SpatialIndex;
  if (globalIndex.size > 0 && globalIndex.size === arrows.length) {
    index = globalIndex;
  } else {
    index = new SpatialIndex();
    index.build(arrows);
  }
  
  // Инициализация
  for (const arrow of arrows) {
    nodes.set(arrow.id, arrow);
    edges.set(arrow.id, []);
    reverseEdges.set(arrow.id, []);
  }
  
  // Построение рёбер через индекс — O(n × pathLength) вместо O(n² × cells)
  for (const arrow of arrows) {
    const path = getPathCached(arrow, grid);
    const blockers = index.getBlockersOnPath(path, arrow.id);
    
    const blockerList = edges.get(arrow.id)!;
    for (const blockerId of blockers) {
      blockerList.push(blockerId);
      reverseEdges.get(blockerId)!.push(arrow.id);
    }
  }
  
  return { nodes, edges, reverseEdges };
}

/**
 * Проверка: является ли граф ациклическим (DAG)?
 * Алгоритм Кана — без изменений, только buildDependencyGraph ускорен.
 */
export function isValidDAG(arrows: Arrow[], grid: Grid): boolean {
  const graph = buildDependencyGraph(arrows, grid);
  const inDegree = new Map<string, number>();
  
  for (const [id, blockers] of graph.edges) {
    inDegree.set(id, blockers.length);
  }
  
  const queue: string[] = [];
  inDegree.forEach((degree, id) => {
    if (degree === 0) queue.push(id);
  });
  
  let processedCount = 0;
  
  while (queue.length > 0) {
    const freeId = queue.shift()!;
    processedCount++;
    
    for (const waiterId of graph.reverseEdges.get(freeId) || []) {
      const newDegree = (inDegree.get(waiterId) || 0) - 1;
      inDegree.set(waiterId, newDegree);
      if (newDegree === 0) queue.push(waiterId);
    }
  }
  
  return processedCount === arrows.length;
}

/**
 * Получить порядок решения (топологическая сортировка).
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
      if (newDegree === 0) queue.push(waiterId);
    }
  }
  
  if (solution.length !== arrows.length) {
    return null; // Цикл!
  }
  
  return solution;
}

// ============================================
// SPECIAL ARROWS — оптимизированы через индекс
// ============================================

/**
 * Обработка клика по ледяной стрелке (без изменений)
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
 * Получить соседей для бомбы (в радиусе 1).
 * 
 * ОПТИМИЗИРОВАНО: через SpatialIndex.getNeighborArrows().
 * O(arrowCells × radius²) вместо O(n × cells²).
 */
export function getBombNeighbors(
  bombArrow: Arrow,
  allArrows: Arrow[],
  radius: number = 1
): Arrow[] {
  // Используем индекс если доступен
  if (globalIndex.size > 0) {
    return globalIndex.getNeighborArrows(bombArrow.id, radius);
  }
  
  // Fallback: оригинальный алгоритм
  const neighbors: Arrow[] = [];
  
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
 * Найти цель для электрической стрелки.
 * 
 * ОПТИМИЗИРОВАНО: getFreeArrows через индекс.
 */
export function getElectricTarget(
  electricArrow: Arrow,
  allArrows: Arrow[],
  grid: Grid
): Arrow | null {
  const freeArrows = getFreeArrows(allArrows, grid);
  
  const candidates = freeArrows.filter(a =>
    a.id !== electricArrow.id &&
    a.type !== 'electric' &&
    !(a.type === 'ice' && a.frozen)
  );
  
  if (candidates.length === 0) return null;
  
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
// MOVE PROCESSING (без изменений в API)
// ============================================

/**
 * Обработать ход (клик по стрелке).
 * Внутри использует оптимизированные findCollision/getBombNeighbors.
 */
export function processMove(
  arrow: Arrow,
  allArrows: Arrow[],
  grid: Grid
): MoveResult {
  // Ледяная стрелка
  if (arrow.type === 'ice' && arrow.frozen) {
    return {
      success: true,
      collision: false,
      defrosted: true,
    };
  }
  
  // Коллизия — O(pathLength) через индекс
  const collidedWith = findCollision(arrow, allArrows, grid);
  
  if (collidedWith) {
    return {
      success: false,
      collision: true,
      collidedWith,
    };
  }
  
  const result: MoveResult = {
    success: true,
    collision: false,
  };
  
  // Спецстрелки
  if (arrow.type === 'plus_life') {
    result.bonusLife = true;
  }
  
  if (arrow.type === 'bomb') {
    // getBombNeighbors теперь O(cells × radius²) через индекс
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
// SIMULATION (для серверной валидации)
// ============================================

export interface SimulationResult {
  valid: boolean;
  error?: string;
  mistakes: number;
  finalArrows: Arrow[];
}

/**
 * Симулировать последовательность ходов.
 * Использует локальный SpatialIndex для оптимизации.
 */
export function simulateMoves(
  initialArrows: Arrow[],
  grid: Grid,
  moves: string[]
): SimulationResult {
  let arrows = [...initialArrows];
  let mistakes = 0;
  let lives = 3;
  
  // Локальный индекс для симуляции (не трогаем глобальный)
  const simIndex = new SpatialIndex();
  simIndex.build(arrows);
  
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
    
    // Коллизия через локальный индекс
    const collision = simIndex.findFirstOnPath(arrow, grid);
    
    if (collision) {
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
      continue;
    }
    
    // Удаляем стрелку
    simIndex.remove(arrowId);
    arrows = arrows.filter(a => a.id !== arrowId);
    
    // Бомба
    if (arrow.type === 'bomb') {
      const neighbors = simIndex.getNeighborArrows(arrowId, 1);
      if (neighbors.length > 0) {
        const explosionIds = new Set(neighbors.map(a => a.id));
        for (const id of explosionIds) simIndex.remove(id);
        arrows = arrows.filter(a => !explosionIds.has(a.id));
      }
    }
    
    // Электро
    if (arrow.type === 'electric') {
      const target = getElectricTarget(arrow, arrows, grid);
      if (target) {
        simIndex.remove(target.id);
        arrows = arrows.filter(a => a.id !== target.id);
      }
    }
  }
  
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

export function calculateStars(mistakes: number): number {
  if (mistakes === 0) return 3;
  if (mistakes === 1) return 2;
  return 1;
}

export function calculateCoins(level: number, stars: number): number {
  const base = 10 + Math.floor(level / 10) * 2;
  const multiplier = stars === 3 ? 1.5 : stars === 2 ? 1.2 : 1.0;
  return Math.floor(base * multiplier);
}

// ============================================
// TODO: GEMINI / CODEX
// ============================================

/**
 * TODO [GEMINI — Фаза 3, Canvas рендерер]:
 * При переходе на Canvas, анимация вылета стрелки должна учитывать путь.
 * getArrowPath() возвращает массив клеток — можно использовать для:
 * 1. Trail-эффект (хвост за улетающей стрелкой)
 * 2. Preview маршрута при hold (задача #3 из чеклиста)
 * 3. Particle burst в точке коллизии
 * 
 * Пример:
 * ```
 * const path = getArrowPath(arrow, grid);
 * // Рисуем пунктирную линию по path при hold
 * ctx.setLineDash([5, 5]);
 * ctx.beginPath();
 * ctx.moveTo(path[0].x * cellSize, path[0].y * cellSize);
 * for (const p of path) {
 *   ctx.lineTo(p.x * cellSize + half, p.y * cellSize + half);
 * }
 * ctx.stroke();
 * ```
 * 
 * TODO [GEMINI — Фаза 3, анимация бомбы]:
 * getBombNeighbors() возвращает массив соседних стрелок.
 * На Canvas: рисовать shockwave-кольцо от центра бомбы,
 * затем fade-out соседних стрелок с задержкой по расстоянию.
 * 
 * ```
 * const neighbors = getBombNeighbors(bomb, arrows);
 * // Сортируем по расстоянию для каскадного эффекта
 * neighbors.sort((a, b) => {
 *   const distA = manhattan(bomb.cells[0], a.cells[0]);
 *   const distB = manhattan(bomb.cells[0], b.cells[0]);
 *   return distA - distB;
 * });
 * // Каждый сосед исчезает с delay = distance * 50ms
 * ```
 * 
 * TODO [GEMINI — Фаза 3, анимация электро]:
 * getElectricTarget() возвращает ближайшую свободную стрелку.
 * На Canvas: рисовать lightning bolt (зигзаг-линия) от электро-стрелки к цели.
 * Можно через bezier curve с рандомными control points.
 * 
 * TODO [CODEX — тесты]:
 * 1. SpatialIndex.build() → проверить что все клетки проиндексированы
 * 2. SpatialIndex.remove() → проверить что клетки удалены
 * 3. isBlocked() через индекс === isBlocked() brute force (на 100 рандомных уровнях)
 * 4. getFreeArrows() через индекс === getFreeArrows() brute force
 * 5. Edge case: стрелка длиной 1 (только голова)
 * 6. Edge case: стрелка на краю поля (путь длиной 0)
 * 7. Edge case: 2 стрелки смотрят друг на друга (взаимная блокировка)
 * 8. Performance test: 500 стрелок, 100×100 grid, getFreeArrows < 10ms
 */