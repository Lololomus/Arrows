/**
 * Arrow Puzzle - Game Engine (OPTIMIZED)
 *
 * Оптимизации:
 * 1. Все функции используют globalIndex напрямую — нет fallback на temp index
 * 2. processMove упрощён (только normal стрелки; special = Legacy)
 * 3. Нет .find() — только globalIndex.getArrow() O(1)
 */

import type { Arrow, Cell, Grid, MoveResult, DependencyGraph } from './types';
import { DIRECTIONS, type Direction } from '../config/constants';
import {
  SpatialIndex,
  globalIndex,
  getPathCached,
} from './spatialIndex';

// ============================================
// BASIC HELPERS
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
// PATH
// ============================================

export function getArrowPath(arrow: Arrow, grid: Grid): Cell[] {
  return getPathCached(arrow, grid);
}

// ============================================
// COLLISION — через globalIndex (всегда)
// ============================================

export function isArrowBlocked(
  arrow: Arrow,
  _allArrows: Arrow[],
  grid: Grid
): boolean {
  return globalIndex.isBlocked(arrow, grid);
}

export function findCollision(
  arrow: Arrow,
  _allArrows: Arrow[],
  grid: Grid
): Arrow | null {
  return globalIndex.findFirstOnPath(arrow, grid);
}

export function getFreeArrows(_arrows: Arrow[], grid: Grid): Arrow[] {
  return globalIndex.getFreeArrows(grid);
}

// ============================================
// DEPENDENCY GRAPH
// ============================================

export function buildDependencyGraph(arrows: Arrow[], grid: Grid): DependencyGraph {
  const nodes = new Map<string, Arrow>();
  const edges = new Map<string, string[]>();
  const reverseEdges = new Map<string, string[]>();

  // Используем globalIndex или строим временный
  let index: SpatialIndex;
  if (globalIndex.size > 0 && globalIndex.size === arrows.length) {
    index = globalIndex;
  } else {
    index = new SpatialIndex();
    index.build(arrows);
  }

  for (const arrow of arrows) {
    nodes.set(arrow.id, arrow);
    edges.set(arrow.id, []);
    reverseEdges.set(arrow.id, []);
  }

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

  if (solution.length !== arrows.length) return null;
  return solution;
}

// ============================================
// [Legacy] SPECIAL ARROWS
// ============================================

// export function handleIceArrowClick(arrow: Arrow) { ... }
// export function getBombNeighbors(bombArrow: Arrow, allArrows: Arrow[], radius?: number) { ... }
// export function getElectricTarget(electricArrow: Arrow, allArrows: Arrow[], grid: Grid) { ... }

// ============================================
// MOVE PROCESSING (simplified — normal arrows only)
// ============================================

export function processMove(
  arrow: Arrow,
  _allArrows: Arrow[],
  grid: Grid
): MoveResult {
  // [Legacy] Ледяная стрелка
  // if (arrow.type === 'ice' && arrow.frozen) {
  //   return { success: true, collision: false, defrosted: true };
  // }

  // Коллизия — O(pathLength) через globalIndex
  const collidedWith = globalIndex.findFirstOnPath(arrow, grid);

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

  // [Legacy] Спецстрелки
  // if (arrow.type === 'plus_life') result.bonusLife = true;
  // if (arrow.type === 'bomb') { ... }
  // if (arrow.type === 'electric') { ... }

  return result;
}

// ============================================
// SIMULATION
// ============================================

export interface SimulationResult {
  valid: boolean;
  error?: string;
  mistakes: number;
  finalArrows: Arrow[];
}

export function simulateMoves(
  initialArrows: Arrow[],
  grid: Grid,
  moves: string[]
): SimulationResult {
  let arrows = [...initialArrows];
  let mistakes = 0;
  let lives = 3;

  const simIndex = new SpatialIndex();
  simIndex.build(arrows);

  for (let i = 0; i < moves.length; i++) {
    const arrowId = moves[i];
    const arrow = simIndex.getArrow(arrowId);

    if (!arrow) {
      return {
        valid: false,
        error: `Arrow ${arrowId} not found at move ${i}`,
        mistakes,
        finalArrows: arrows,
      };
    }

    const collision = simIndex.findFirstOnPath(arrow, grid);

    if (collision) {
      mistakes++;
      lives--;
      if (lives <= 0) {
        return { valid: false, error: 'No lives left', mistakes, finalArrows: arrows };
      }
      continue;
    }

    simIndex.remove(arrowId);
    arrows = arrows.filter(a => a.id !== arrowId);
  }

  if (arrows.length > 0) {
    return { valid: false, error: `${arrows.length} arrows remaining`, mistakes, finalArrows: arrows };
  }

  return { valid: true, mistakes, finalArrows: [] };
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