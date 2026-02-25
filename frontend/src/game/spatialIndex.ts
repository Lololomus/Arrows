/**
 * Arrow Puzzle - Spatial Index (OPTIMIZED)
 *
 * Оптимизации:
 * 1. Numeric keys (y * MAX_W + x) вместо строковых `${x},${y}`
 *    → Ноль аллокаций строк при lookup, ноль GC pressure
 * 2. Кэш путей без изменений (уже оптимален)
 * 3. getNewlyFreedArrows — инкрементальный пересчёт DAG
 */

import type { Arrow, Cell, Grid } from './types';
import { DIRECTIONS } from '../config/constants';

// ============================================
// CONSTANTS
// ============================================

/**
 * Максимальная ширина грида для numeric key encoding.
 * key = y * MAX_W + x. Поддерживает гриды до 2048 ячеек в ширину.
 */
const MAX_W = 2048;

/** Encode cell → numeric key. Zero-alloc. */
function cellKey(x: number, y: number): number {
  return y * MAX_W + x;
}

// [Unused] Decode numeric key → cell. Kept for debugging.
// function decodeKey(key: number): { x: number; y: number } {
//   return { x: key % MAX_W, y: (key / MAX_W) | 0 };
// }

// ============================================
// SPATIAL INDEX
// ============================================

export class SpatialIndex {
  /** numericKey → arrowId */
  private cellToArrow: Map<number, string> = new Map();

  /** arrowId → Arrow */
  private arrowById: Map<string, Arrow> = new Map();

  /** arrowId → Set<numericKey> (для быстрого удаления) */
  private arrowCells: Map<string, Set<number>> = new Map();

  // ============================================
  // BUILD / UPDATE
  // ============================================

  build(arrows: Arrow[]): void {
    this.cellToArrow.clear();
    this.arrowById.clear();
    this.arrowCells.clear();

    for (const arrow of arrows) {
      this.arrowById.set(arrow.id, arrow);
      const cells = new Set<number>();

      for (const cell of arrow.cells) {
        const key = cellKey(cell.x, cell.y);
        this.cellToArrow.set(key, arrow.id);
        cells.add(key);
      }

      this.arrowCells.set(arrow.id, cells);
    }
  }

  remove(arrowId: string): void {
    const cells = this.arrowCells.get(arrowId);
    if (cells) {
      for (const key of cells) {
        this.cellToArrow.delete(key);
      }
    }
    this.arrowCells.delete(arrowId);
    this.arrowById.delete(arrowId);
  }

  removeBatch(arrowIds: string[]): void {
    for (const id of arrowIds) {
      this.remove(id);
    }
  }

  // ============================================
  // QUERIES — O(1)
  // ============================================

  getArrowAt(x: number, y: number): string | null {
    return this.cellToArrow.get(cellKey(x, y)) ?? null;
  }

  getArrow(id: string): Arrow | null {
    return this.arrowById.get(id) ?? null;
  }

  isOccupied(x: number, y: number): boolean {
    return this.cellToArrow.has(cellKey(x, y));
  }

  get size(): number {
    return this.arrowById.size;
  }

  getAllArrows(): Arrow[] {
    return Array.from(this.arrowById.values());
  }

  // ============================================
  // PATH-BASED QUERIES
  // ============================================

  getBlockersOnPath(path: Cell[], excludeArrowId: string): Set<string> {
    const blockers = new Set<string>();

    for (const cell of path) {
      const id = this.cellToArrow.get(cellKey(cell.x, cell.y));
      if (id && id !== excludeArrowId) {
        blockers.add(id);
      }
    }

    return blockers;
  }

  isBlocked(arrow: Arrow, grid: Grid): boolean {
    const path = getPathFast(arrow, grid);

    for (const cell of path) {
      const id = this.cellToArrow.get(cellKey(cell.x, cell.y));
      if (id && id !== arrow.id) {
        return true;
      }
    }

    return false;
  }

  findFirstOnPath(arrow: Arrow, grid: Grid): Arrow | null {
    const path = getPathFast(arrow, grid);

    for (const cell of path) {
      const id = this.cellToArrow.get(cellKey(cell.x, cell.y));
      if (id && id !== arrow.id) {
        return this.arrowById.get(id) ?? null;
      }
    }

    return null;
  }

  getFreeArrows(grid: Grid): Arrow[] {
    const result: Arrow[] = [];

    for (const arrow of this.arrowById.values()) {
      if (!this.isBlocked(arrow, grid)) {
        result.push(arrow);
      }
    }

    return result;
  }

  // [Legacy] getNeighborArrows — для бомбы
  getNeighborArrows(arrowId: string, radius: number = 1): Arrow[] {
    const arrow = this.arrowById.get(arrowId);
    if (!arrow) return [];

    const neighborIds = new Set<string>();

    for (const cell of arrow.cells) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (dx === 0 && dy === 0) continue;
          if (Math.abs(dx) + Math.abs(dy) > radius) continue;

          const id = this.cellToArrow.get(cellKey(cell.x + dx, cell.y + dy));
          if (id && id !== arrowId) {
            neighborIds.add(id);
          }
        }
      }
    }

    return Array.from(neighborIds)
      .map(id => this.arrowById.get(id)!)
      .filter(Boolean);
  }
}

// ============================================
// PATH CACHE
// ============================================

const pathCache = new Map<string, Cell[]>();

function pathCacheKey(arrowId: string, gridW: number, gridH: number): string {
  return `${arrowId}:${gridW}:${gridH}`;
}

export function getPathCached(arrow: Arrow, grid: Grid): Cell[] {
  const key = pathCacheKey(arrow.id, grid.width, grid.height);

  let path = pathCache.get(key);
  if (path) return path;

  path = getPathFast(arrow, grid);
  pathCache.set(key, path);
  return path;
}

export function clearPathCache(): void {
  pathCache.clear();
}

// ============================================
// FAST PATH
// ============================================

function getPathFast(arrow: Arrow, grid: Grid): Cell[] {
  const head = arrow.cells[0];
  const { dx, dy } = DIRECTIONS[arrow.direction];
  const path: Cell[] = [];

  let x = head.x + dx;
  let y = head.y + dy;

  while (x >= 0 && x < grid.width && y >= 0 && y < grid.height) {
    path.push({ x, y });
    x += dx;
    y += dy;
  }

  return path;
}

// ============================================
// INCREMENTAL DAG
// ============================================

export function getNewlyFreedArrows(
  removedArrow: Arrow,
  index: SpatialIndex,
  grid: Grid,
  prevFreeIds: Set<string>
): Arrow[] {
  const newlyFreed: Arrow[] = [];
  const candidateIds = new Set<string>();

  for (const cell of removedArrow.cells) {
    for (const dir of ['right', 'left', 'up', 'down'] as const) {
      const { dx, dy } = DIRECTIONS[dir];
      let x = cell.x - dx;
      let y = cell.y - dy;

      while (x >= 0 && x < grid.width && y >= 0 && y < grid.height) {
        const id = index.getArrowAt(x, y);
        if (id) {
          const arrow = index.getArrow(id);
          if (arrow && arrow.direction === dir && !prevFreeIds.has(id)) {
            candidateIds.add(id);
          }
          break;
        }
        x -= dx;
        y -= dy;
      }
    }
  }

  for (const id of candidateIds) {
    const arrow = index.getArrow(id);
    if (arrow && !index.isBlocked(arrow, grid)) {
      newlyFreed.push(arrow);
    }
  }

  return newlyFreed;
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const globalIndex = new SpatialIndex();

export function rebuildIndex(arrows: Arrow[]): void {
  globalIndex.build(arrows);
  clearPathCache();
  console.log(`🔍 [SpatialIndex] Rebuilt: ${arrows.length} arrows, ${globalIndex.size} indexed`);
}

export function removeFromIndex(arrowId: string): void {
  globalIndex.remove(arrowId);
}

export function removeFromIndexBatch(arrowIds: string[]): void {
  globalIndex.removeBatch(arrowIds);
}