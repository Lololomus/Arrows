/**
 * Arrow Puzzle - Level Generator (Client-side)
 * 
 * Генератор уровней для клиента.
 * Используется для режима оффлайн и тестирования.
 * Серверная версия в backend.
 */

import type { Arrow, Cell, Grid, Level, LevelMeta } from './types';
import type { Direction, ArrowType, ShapeType } from '../config/constants';
import {
  DIRECTIONS,
  ARROW_COLORS,
  SPECIAL_ARROW_COLORS,
  ARROW_TYPE_UNLOCK_LEVELS,
  getGridSize,
  getArrowParams,
} from '../config/constants';
import { cellKey, parseKey, isArrowBlocked, getSolution } from './engine';

// ============================================
// SEEDED RANDOM
// ============================================

class SeededRandom {
  private seed: number;
  
  constructor(seed: number) {
    this.seed = seed;
  }
  
  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
  
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  
  choice<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  
  shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

// ============================================
// HELPERS
// ============================================

function getNeighbors(cell: Cell): Cell[] {
  return [
    { x: cell.x + 1, y: cell.y },
    { x: cell.x - 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 },
    { x: cell.x, y: cell.y - 1 },
  ];
}

function isConnected(cells: Set<string>): boolean {
  if (cells.size === 0) return true;
  
  const start = parseKey(cells.values().next().value);
  const visited = new Set<string>();
  const queue: Cell[] = [start];
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = cellKey(current);
    
    if (visited.has(key)) continue;
    if (!cells.has(key)) continue;
    
    visited.add(key);
    
    for (const neighbor of getNeighbors(current)) {
      const nKey = cellKey(neighbor);
      if (cells.has(nKey) && !visited.has(nKey)) {
        queue.push(neighbor);
      }
    }
  }
  
  return visited.size === cells.size;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function getOpposite(direction: Direction): Direction {
  const opposites: Record<Direction, Direction> = {
    right: 'left',
    left: 'right',
    up: 'down',
    down: 'up',
  };
  return opposites[direction];
}

// ============================================
// SHAPE GENERATION
// ============================================

function canBeHead(
  cell: Cell,
  shape: Set<string>,
  direction: Direction,
  grid: Grid
): boolean {
  const { dx, dy } = DIRECTIONS[direction];
  
  // Проверяем что есть шея
  const neck = { x: cell.x - dx, y: cell.y - dy };
  if (!shape.has(cellKey(neck))) return false;
  
  // Проверяем non-self-blocking
  let current = { x: cell.x + dx, y: cell.y + dy };
  while (
    current.x >= 0 &&
    current.x < grid.width &&
    current.y >= 0 &&
    current.y < grid.height
  ) {
    if (shape.has(cellKey(current))) return false;
    current = { x: current.x + dx, y: current.y + dy };
  }
  
  return true;
}

function orderCellsFromHead(shape: Set<string>, head: Cell): Cell[] {
  const result: Cell[] = [head];
  const visited = new Set<string>([cellKey(head)]);
  const queue: Cell[] = [head];
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    
    for (const neighbor of getNeighbors(current)) {
      const key = cellKey(neighbor);
      if (shape.has(key) && !visited.has(key)) {
        result.push(neighbor);
        visited.add(key);
        queue.push(neighbor);
      }
    }
  }
  
  return result;
}

function growShape(
  start: Cell,
  remaining: Set<string>,
  minSize: number,
  maxSize: number,
  rng: SeededRandom,
  grid: Grid
): Set<string> | null {
  const shape = new Set<string>([cellKey(start)]);
  const targetSize = rng.nextInt(minSize, Math.min(maxSize, remaining.size));
  
  let attempts = 0;
  const maxAttempts = 100;
  
  while (shape.size < targetSize && attempts < maxAttempts) {
    attempts++;
    
    // Находим frontier - соседи shape в remaining
    const frontier: Cell[] = [];
    for (const key of shape) {
      const cell = parseKey(key);
      for (const neighbor of getNeighbors(cell)) {
        const nKey = cellKey(neighbor);
        if (remaining.has(nKey) && !shape.has(nKey)) {
          frontier.push(neighbor);
        }
      }
    }
    
    if (frontier.length === 0) break;
    
    // Выбираем случайную клетку
    const next = rng.choice(frontier);
    shape.add(cellKey(next));
  }
  
  if (shape.size < minSize) return null;
  
  return shape;
}

// ============================================
// LEVEL GENERATOR
// ============================================

export function generateLevel(levelNumber: number, seed?: number): Level {
  const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);
  const rng = new SeededRandom(actualSeed);
  
  // Параметры сложности
  const { width, height } = getGridSize(levelNumber);
  const { minSize, maxSize } = getArrowParams(levelNumber);
  
  const grid: Grid = { width, height };
  
  // Фаза 1: Разбиение на фигуры
  const shapes = tileField(grid, minSize, maxSize, rng);
  
  // Фаза 2: Назначение направлений
  const arrows = assignDirections(shapes, grid, rng, levelNumber);
  
  // Фаза 3: Назначение цветов и типов
  assignColorsAndTypes(arrows, levelNumber, rng);
  
  // Фаза 4: Генерация решения
  const solution = getSolution(arrows, grid);
  
  // Метаданные
  const meta: LevelMeta = {
    difficulty: calculateDifficulty(levelNumber, arrows, grid),
    arrowCount: arrows.length,
    specialArrowCount: arrows.filter(a => a.type !== 'normal').length,
    dagDepth: calculateDagDepth(arrows, grid),
  };
  
  return {
    levelNumber,
    seed: actualSeed,
    grid,
    arrows,
    solution: solution || undefined,
    meta,
  };
}

function tileField(
  grid: Grid,
  minSize: number,
  maxSize: number,
  rng: SeededRandom
): Set<string>[] {
  // Все клетки поля
  const remaining = new Set<string>();
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      remaining.add(cellKey({ x, y }));
    }
  }
  
  const shapes: Set<string>[] = [];
  let attempts = 0;
  const maxAttempts = 1000;
  
  while (remaining.size > 0 && attempts < maxAttempts) {
    attempts++;
    
    // Выбираем стартовую клетку (предпочитаем углы/края)
    const remainingCells = Array.from(remaining).map(parseKey);
    
    // Фильтруем по приоритету
    const corners = remainingCells.filter(c =>
      (c.x === 0 || c.x === grid.width - 1) &&
      (c.y === 0 || c.y === grid.height - 1)
    );
    
    const edges = remainingCells.filter(c =>
      c.x === 0 || c.x === grid.width - 1 ||
      c.y === 0 || c.y === grid.height - 1
    );
    
    let start: Cell;
    if (corners.length > 0) {
      start = rng.choice(corners);
    } else if (edges.length > 0) {
      start = rng.choice(edges);
    } else {
      start = rng.choice(remainingCells);
    }
    
    // Выращиваем фигуру
    const shape = growShape(start, remaining, minSize, maxSize, rng, grid);
    
    if (shape && shape.size >= minSize) {
      shapes.push(shape);
      for (const key of shape) {
        remaining.delete(key);
      }
    }
    
    // Если остаток слишком маленький - пробуем присоединить
    if (remaining.size > 0 && remaining.size < minSize && shapes.length > 0) {
      const lastShape = shapes[shapes.length - 1];
      let merged = false;
      
      for (const key of remaining) {
        const cell = parseKey(key);
        for (const neighbor of getNeighbors(cell)) {
          if (lastShape.has(cellKey(neighbor))) {
            lastShape.add(key);
            merged = true;
            break;
          }
        }
        if (merged) break;
      }
      
      if (merged) {
        for (const key of remaining) {
          if (lastShape.has(key)) continue;
          // Пробуем добавить остальные
          for (const neighbor of getNeighbors(parseKey(key))) {
            if (lastShape.has(cellKey(neighbor))) {
              lastShape.add(key);
              break;
            }
          }
        }
        remaining.clear();
      }
    }
  }
  
  if (remaining.size > 0) {
    console.warn(`[Generator] Could not tile field completely: ${remaining.size} cells left`);
  }
  
  return shapes;
}

function assignDirections(
  shapes: Set<string>[],
  grid: Grid,
  rng: SeededRandom,
  levelNumber: number
): Arrow[] {
  const arrows: Arrow[] = [];
  const shuffledShapes = rng.shuffle(shapes);
  
  for (const shape of shuffledShapes) {
    const arrow = createArrowWithValidDirection(shape, arrows, grid, rng);
    if (arrow) {
      arrows.push(arrow);
    } else {
      console.warn('[Generator] Could not assign valid direction to shape');
    }
  }
  
  return arrows;
}

function createArrowWithValidDirection(
  shape: Set<string>,
  existingArrows: Arrow[],
  grid: Grid,
  rng: SeededRandom
): Arrow | null {
  // Находим все возможные (cell, direction) пары
  const candidates: { cell: Cell; direction: Direction }[] = [];
  
  for (const key of shape) {
    const cell = parseKey(key);
    for (const direction of ['right', 'left', 'up', 'down'] as Direction[]) {
      if (canBeHead(cell, shape, direction, grid)) {
        candidates.push({ cell, direction });
      }
    }
  }
  
  if (candidates.length === 0) return null;
  
  // Перемешиваем
  const shuffled = rng.shuffle(candidates);
  
  for (const { cell, direction } of shuffled) {
    const cells = orderCellsFromHead(shape, cell);
    
    const arrow: Arrow = {
      id: generateId(),
      cells,
      direction,
      type: 'normal',
      color: '#007AFF',
    };
    
    // Проверяем что не создаём цикл
    const allArrows = [...existingArrows, arrow];
    const solution = getSolution(allArrows, grid);
    
    if (solution) {
      return arrow;
    }
  }
  
  // Если ничего не подошло - берём первый вариант (может создать проблемы)
  const fallback = shuffled[0];
  const cells = orderCellsFromHead(shape, fallback.cell);
  
  return {
    id: generateId(),
    cells,
    direction: fallback.direction,
    type: 'normal',
    color: '#007AFF',
  };
}

function assignColorsAndTypes(
  arrows: Arrow[],
  levelNumber: number,
  rng: SeededRandom
): void {
  // Назначаем цвета
  for (let i = 0; i < arrows.length; i++) {
    arrows[i].color = ARROW_COLORS[i % ARROW_COLORS.length];
  }
  
  // Назначаем спецтипы
  const availableTypes: { type: ArrowType; prob: number }[] = [];
  
  if (levelNumber >= ARROW_TYPE_UNLOCK_LEVELS.plus_life) {
    availableTypes.push({ type: 'plus_life', prob: 0.08 });
  }
  if (levelNumber >= ARROW_TYPE_UNLOCK_LEVELS.ice) {
    availableTypes.push({ type: 'ice', prob: 0.10 });
  }
  if (levelNumber >= ARROW_TYPE_UNLOCK_LEVELS.minus_life) {
    availableTypes.push({ type: 'minus_life', prob: 0.06 });
  }
  if (levelNumber >= ARROW_TYPE_UNLOCK_LEVELS.bomb) {
    availableTypes.push({ type: 'bomb', prob: 0.04 });
  }
  if (levelNumber >= ARROW_TYPE_UNLOCK_LEVELS.electric) {
    availableTypes.push({ type: 'electric', prob: 0.03 });
  }
  
  // Максимум 20% спецстрелок
  const maxSpecial = Math.max(1, Math.floor(arrows.length * 0.2));
  let specialCount = 0;
  
  for (const arrow of arrows) {
    if (specialCount >= maxSpecial) break;
    
    for (const { type, prob } of availableTypes) {
      if (rng.next() < prob) {
        arrow.type = type;
        
        // Специальные цвета
        if (SPECIAL_ARROW_COLORS[type]) {
          arrow.color = SPECIAL_ARROW_COLORS[type]!;
        }
        
        // Для льда - устанавливаем frozen
        if (type === 'ice') {
          arrow.frozen = true;
        }
        
        specialCount++;
        break;
      }
    }
  }
}

function calculateDifficulty(level: number, arrows: Arrow[], grid: Grid): number {
  const size = grid.width * grid.height;
  const arrowCount = arrows.length;
  const depth = calculateDagDepth(arrows, grid);
  const density = arrowCount / size;
  const avgLength = arrows.reduce((sum, a) => sum + a.cells.length, 0) / arrowCount;
  
  return Math.round(
    size * 1.0 +
    arrowCount * 0.5 +
    depth * 2.0 +
    density * 10 +
    avgLength * 0.2
  );
}

function calculateDagDepth(arrows: Arrow[], grid: Grid): number {
  if (arrows.length === 0) return 0;
  
  // Находим in-degree каждой стрелки
  const inDegree = new Map<string, number>();
  const blocks = new Map<string, string[]>();
  
  for (const arrow of arrows) {
    inDegree.set(arrow.id, 0);
    blocks.set(arrow.id, []);
  }
  
  for (const arrow of arrows) {
    if (isArrowBlocked(arrow, arrows, grid)) {
      // Считаем кто её блокирует
      for (const other of arrows) {
        if (other.id === arrow.id) continue;
        // Упрощённая проверка
        const path = [];
        const { dx, dy } = DIRECTIONS[arrow.direction];
        let current = { x: arrow.cells[0].x + dx, y: arrow.cells[0].y + dy };
        while (current.x >= 0 && current.x < grid.width && current.y >= 0 && current.y < grid.height) {
          path.push(cellKey(current));
          current = { x: current.x + dx, y: current.y + dy };
        }
        
        const pathSet = new Set(path);
        const otherCells = new Set(other.cells.map(cellKey));
        
        let intersects = false;
        for (const key of otherCells) {
          if (pathSet.has(key)) {
            intersects = true;
            break;
          }
        }
        
        if (intersects) {
          inDegree.set(arrow.id, (inDegree.get(arrow.id) || 0) + 1);
          blocks.get(other.id)!.push(arrow.id);
        }
      }
    }
  }
  
  // BFS по слоям
  let layer = 0;
  const queue: string[] = [];
  const depths = new Map<string, number>();
  
  inDegree.forEach((deg, id) => {
    if (deg === 0) {
      queue.push(id);
      depths.set(id, 0);
    }
  });
  
  while (queue.length > 0) {
    const id = queue.shift()!;
    const currentDepth = depths.get(id) || 0;
    layer = Math.max(layer, currentDepth);
    
    for (const blockedId of blocks.get(id) || []) {
      const newDegree = (inDegree.get(blockedId) || 1) - 1;
      inDegree.set(blockedId, newDegree);
      
      if (newDegree === 0) {
        queue.push(blockedId);
        depths.set(blockedId, currentDepth + 1);
      }
    }
  }
  
  return layer + 1;
}

// ============================================
// EXPORTS
// ============================================

export { SeededRandom };