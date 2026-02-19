/**
 * Arrow Puzzle - Board Utils
 * 
 * Общие утилиты для GameBoard (SVG) и CanvasBoard (Canvas).
 * DRY: hit testing, coordinate conversion — используются в обоих рендерерах.
 */

import { globalIndex } from '../game/spatialIndex';

// ============================================
// HIT TESTING
// ============================================

/**
 * Конвертирует координаты клика/тача в grid-координаты.
 * 
 * Учитывает CSS transform (scale) — getBoundingClientRect() возвращает
 * размеры ПОСЛЕ transform, а cellSize — оригинальный.
 * Без коррекции при zoom=2 координаты сдвигаются в 2 раза.
 */
export function clientToGrid(
  clientX: number,
  clientY: number,
  element: Element,
  cellSize: number,
  gridWidth: number,
  gridHeight: number
): { x: number; y: number } | null {
  const rect = element.getBoundingClientRect();
  
  // rect.width/height уже масштабированы CSS transform
  // Реальный размер поля = gridWidth * cellSize (без масштаба)
  // Масштаб = rect.width / реальный размер
  const realWidth = gridWidth * cellSize;
  const realHeight = gridHeight * cellSize;
  const scaleX = rect.width / realWidth;
  const scaleY = rect.height / realHeight;
  
  const x = Math.floor((clientX - rect.left) / (cellSize * scaleX));
  const y = Math.floor((clientY - rect.top) / (cellSize * scaleY));
  
  // Bounds check
  if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) {
    return null;
  }
  
  return { x, y };
}

/**
 * Обработчик клика — возвращает arrowId или null.
 * Используется и в SVG, и в Canvas борде.
 */
export function hitTestArrow(
  clientX: number,
  clientY: number,
  element: Element,
  cellSize: number,
  gridWidth: number,
  gridHeight: number,
  /** Fallback occupancy map (для SVG борда, где globalIndex может быть не синхронизирован) */
  occupancyMap?: Map<string, string>
): string | null {
  const cell = clientToGrid(clientX, clientY, element, cellSize, gridWidth, gridHeight);
  if (!cell) return null;
  
  // Приоритет: occupancyMap (если передан), иначе globalIndex
  if (occupancyMap) {
    return occupancyMap.get(`${cell.x},${cell.y}`) ?? null;
  }
  
  return globalIndex.getArrowAt(cell.x, cell.y);
}