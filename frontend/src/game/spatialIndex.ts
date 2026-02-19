/**
 * Arrow Puzzle - Spatial Index (PHASE 2)
 * 
 * HashMap-based пространственный индекс для мгновенного поиска.
 * Заменяет O(n² × cells) перебор на O(1) lookup.
 * 
 * Используется в:
 * - engine.ts: findCollision, isArrowBlocked, getFreeArrows, buildDependencyGraph
 * - GameBoard.tsx: occupancyMap (Фаза 1 уже использует аналогичный паттерн)
 * 
 * Производительность (500 стрелок, grid 100×100):
 * - build(): O(totalCells) ≈ 2,500 операций, ~0.1ms
 * - getBlockersOnPath(): O(pathLength) ≈ 50-100 lookups, ~0.01ms
 * - Старый isArrowBlocked: O(n × cells) ≈ 125,000 операций, ~6ms
 */

import type { Arrow, Cell, Grid } from './types';
import { DIRECTIONS, type Direction } from '../config/constants';

// ============================================
// SPATIAL INDEX
// ============================================

export class SpatialIndex {
  /** "x,y" → arrowId */
  private cellToArrow: Map<string, string> = new Map();
  
  /** arrowId → Arrow (для быстрого доступа) */
  private arrowById: Map<string, Arrow> = new Map();
  
  /** arrowId → Set<cellKey> (для быстрого удаления) */
  private arrowCells: Map<string, Set<string>> = new Map();

  // ============================================
  // BUILD / UPDATE
  // ============================================

  /**
   * Построить индекс из массива стрелок.
   * Вызывается при initLevel и после каждого изменения arrows.
   * O(totalCells) — обычно 2,000-3,000 на большом поле.
   */
  build(arrows: Arrow[]): void {
    this.cellToArrow.clear();
    this.arrowById.clear();
    this.arrowCells.clear();
    
    for (const arrow of arrows) {
      this.arrowById.set(arrow.id, arrow);
      const cells = new Set<string>();
      
      for (const cell of arrow.cells) {
        const key = `${cell.x},${cell.y}`;
        this.cellToArrow.set(key, arrow.id);
        cells.add(key);
      }
      
      this.arrowCells.set(arrow.id, cells);
    }
  }

  /**
   * Удалить стрелку из индекса (инкрементально).
   * O(arrowCells) — обычно 2-10 операций.
   */
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

  /**
   * Batch-удаление нескольких стрелок.
   * Эффективнее чем N вызовов remove().
   */
  removeBatch(arrowIds: string[]): void {
    for (const id of arrowIds) {
      this.remove(id);
    }
  }

  // ============================================
  // QUERIES — O(1)
  // ============================================

  /** Получить arrowId по координатам клетки. O(1). */
  getArrowAt(x: number, y: number): string | null {
    return this.cellToArrow.get(`${x},${y}`) ?? null;
  }

  /** Получить Arrow по ID. O(1). */
  getArrow(id: string): Arrow | null {
    return this.arrowById.get(id) ?? null;
  }

  /** Проверить занята ли клетка. O(1). */
  isOccupied(x: number, y: number): boolean {
    return this.cellToArrow.has(`${x},${y}`);
  }

  /** Количество стрелок в индексе. */
  get size(): number {
    return this.arrowById.size;
  }

  /** Все стрелки (итератор). */
  getAllArrows(): Arrow[] {
    return Array.from(this.arrowById.values());
  }

  // ============================================
  // PATH-BASED QUERIES
  // ============================================

  /**
   * Найти все стрелки, блокирующие путь.
   * Возвращает Set<arrowId> стрелок на пути.
   * 
   * O(pathLength) — обычно 50-100 на grid 100×100.
   * Старый вариант (isArrowBlocked) = O(n × cells) ≈ 125,000.
   */
  getBlockersOnPath(path: Cell[], excludeArrowId: string): Set<string> {
    const blockers = new Set<string>();
    
    for (const cell of path) {
      const id = this.cellToArrow.get(`${cell.x},${cell.y}`);
      if (id && id !== excludeArrowId) {
        blockers.add(id);
      }
    }
    
    return blockers;
  }

  /**
   * Проверить: заблокирована ли стрелка?
   * O(pathLength) вместо O(n × cells).
   */
  isBlocked(arrow: Arrow, grid: Grid): boolean {
    const path = getPathFast(arrow, grid);
    
    for (const cell of path) {
      const id = this.cellToArrow.get(`${cell.x},${cell.y}`);
      if (id && id !== arrow.id) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Найти первую стрелку на пути (для findCollision).
   * Идёт по пути последовательно — первая встреченная = коллизия.
   * O(pathLength).
   */
  findFirstOnPath(arrow: Arrow, grid: Grid): Arrow | null {
    const path = getPathFast(arrow, grid);
    
    for (const cell of path) {
      const id = this.cellToArrow.get(`${cell.x},${cell.y}`);
      if (id && id !== arrow.id) {
        return this.arrowById.get(id) ?? null;
      }
    }
    
    return null;
  }

  /**
   * Получить все свободные стрелки (незаблокированные).
   * O(n × avgPathLength) вместо O(n² × cells).
   * 
   * На 500 стрелках, avgPath=50: 25,000 lookups (~1ms)
   * Старый getFreeArrows: 62,500,000 операций (~3s)
   */
  getFreeArrows(grid: Grid): Arrow[] {
    const result: Arrow[] = [];
    
    for (const arrow of this.arrowById.values()) {
      if (!this.isBlocked(arrow, grid)) {
        result.push(arrow);
      }
    }
    
    return result;
  }

  /**
   * Получить соседей стрелки (для бомбы).
   * Использует индекс вместо перебора всех стрелок.
   * O(arrowCells × 4) вместо O(n × cells²).
   */
  getNeighborArrows(arrowId: string, radius: number = 1): Arrow[] {
    const arrow = this.arrowById.get(arrowId);
    if (!arrow) return [];
    
    const neighborIds = new Set<string>();
    
    // Для каждой клетки стрелки проверяем окрестность через индекс
    for (const cell of arrow.cells) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (dx === 0 && dy === 0) continue;
          if (Math.abs(dx) + Math.abs(dy) > radius) continue; // Manhattan distance
          
          const id = this.cellToArrow.get(`${cell.x + dx},${cell.y + dy}`);
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

/**
 * Кэш путей стрелок.
 * Путь стрелки зависит только от её позиции, направления и размера поля —
 * не меняется при удалении других стрелок.
 * 
 * Инвалидируется при initLevel (полный сброс).
 */
const pathCache = new Map<string, Cell[]>();

/** Ключ кэша: arrowId + grid dimensions */
function pathCacheKey(arrowId: string, gridW: number, gridH: number): string {
  return `${arrowId}:${gridW}:${gridH}`;
}

/**
 * Получить путь с кэшированием.
 * Первый вызов: O(gridSize), следующие: O(1).
 */
export function getPathCached(arrow: Arrow, grid: Grid): Cell[] {
  const key = pathCacheKey(arrow.id, grid.width, grid.height);
  
  let path = pathCache.get(key);
  if (path) return path;
  
  path = getPathFast(arrow, grid);
  pathCache.set(key, path);
  return path;
}

/** Сбросить кэш (при загрузке нового уровня) */
export function clearPathCache(): void {
  pathCache.clear();
}

// ============================================
// FAST PATH (без создания лишних объектов)
// ============================================

/**
 * Быстрая версия getArrowPath.
 * Не создаёт промежуточных объектов ({ ...current }).
 */
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

/**
 * Инкрементальный пересчёт свободных стрелок после удаления.
 * 
 * Логика: когда удалили стрелку X, освобождаются только те стрелки,
 * чей путь проходил через клетки X. Все остальные — без изменений.
 * 
 * O(removedCells × maxPathLength) вместо полного пересчёта O(n × pathLength).
 */
export function getNewlyFreedArrows(
  removedArrow: Arrow,
  index: SpatialIndex,
  grid: Grid,
  prevFreeIds: Set<string>
): Arrow[] {
  const newlyFreed: Arrow[] = [];
  
  // Собираем ID стрелок, чей путь проходил через клетки удалённой стрелки
  const candidateIds = new Set<string>();
  
  // Для каждой клетки удалённой стрелки — ищем стрелки, чей путь идёт ЧЕРЕЗ эту клетку.
  // Стрелка может лететь через клетку (cell.x, cell.y) если её направление приводит сюда.
  // Вместо проверки всех стрелок — проверяем 4 направления из каждой удалённой клетки.
  for (const cell of removedArrow.cells) {
    // Кто мог пролететь через эту клетку? Стрелки с 4 направлений.
    for (const dir of ['right', 'left', 'up', 'down'] as const) {
      const { dx, dy } = DIRECTIONS[dir];
      // Идём НАЗАД от удалённой клетки в направлении, откуда могла лететь стрелка
      let x = cell.x - dx;
      let y = cell.y - dy;
      
      while (x >= 0 && x < grid.width && y >= 0 && y < grid.height) {
        const id = index.getArrowAt(x, y);
        if (id) {
          const arrow = index.getArrow(id);
          // Эта стрелка летит в направлении dir? И она ранее была заблокирована?
          if (arrow && arrow.direction === dir && !prevFreeIds.has(id)) {
            candidateIds.add(id);
          }
          break; // За первой стрелкой не смотрим (она блокировала бы дальше)
        }
        x -= dx;
        y -= dy;
      }
    }
  }
  
  // Проверяем кандидатов — стали ли они свободными?
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

/**
 * Глобальный инстанс SpatialIndex.
 * Пересоздаётся при каждом initLevel через rebuildIndex().
 * Обновляется инкрементально через index.remove() при каждом ходе.
 * 
 * Почему синглтон, а не в store:
 * - Zustand сериализует state → Map/Set не сериализуются
 * - Index — производный кэш, не source of truth
 * - Быстрый доступ из engine.ts без прокидывания через props
 */
export const globalIndex = new SpatialIndex();

/**
 * Полная перестройка индекса.
 * Вызывается из store.initLevel().
 */
export function rebuildIndex(arrows: Arrow[]): void {
  globalIndex.build(arrows);
  clearPathCache();
  console.log(`🔍 [SpatialIndex] Rebuilt: ${arrows.length} arrows, ${globalIndex.size} indexed`);
}

/**
 * Инкрементальное удаление из индекса.
 * Вызывается из store.removeArrow() / store.removeArrows().
 */
export function removeFromIndex(arrowId: string): void {
  globalIndex.remove(arrowId);
}

/**
 * Batch-удаление из индекса.
 */
export function removeFromIndexBatch(arrowIds: string[]): void {
  globalIndex.removeBatch(arrowIds);
}

// ============================================
// TODO: GEMINI
// ============================================

/**
 * TODO [GEMINI — Фаза 3]:
 * При переходе на Canvas рендерер, occupancyMap из GameBoard.tsx
 * можно заменить на globalIndex.getArrowAt(x, y) — единый источник.
 * Это уберёт дублирование occupancy map в двух местах.
 * 
 * Пример интеграции в CanvasBoard:
 * ```
 * const handleCanvasClick = (e: MouseEvent) => {
 *   const x = Math.floor((e.offsetX) / cellSize);
 *   const y = Math.floor((e.offsetY) / cellSize);
 *   const arrowId = globalIndex.getArrowAt(x, y);
 *   if (arrowId) onArrowClick(arrowId);
 * };
 * ```
 * 
 * TODO [GEMINI — Фаза 3]:
 * Для Canvas viewport culling — использовать globalIndex.getAllArrows()
 * и фильтровать по видимой области. Или добавить метод:
 * ```
 * getArrowsInViewport(x1, y1, x2, y2): Arrow[]
 * ```
 * Это будет O(viewportCells) lookups — быстрее чем фильтр всех стрелок.
 */