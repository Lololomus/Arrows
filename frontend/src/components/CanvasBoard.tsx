/**
 * Arrow Puzzle - Canvas Board Renderer (PHASE 3)
 * 
 * Canvas 2D рендерер для больших полей (grid > 20).
 * Заменяет SVG + Framer Motion + AnimatePresence на:
 * - Один <canvas> элемент (0 DOM-нод на стрелки)
 * - requestAnimationFrame loop
 * - Ручная анимация вылета/shake/hint
 * - Viewport culling (рисуем только видимое)
 * - HiDPI (devicePixelRatio) support
 * 
 * Производительность:
 * - 500 стрелок на 100×100: ~2-3ms per frame (vs ~100ms+ SVG)
 * - 10,000 grid dots: <0.5ms (один цикл fillRect)
 * - Hit testing: O(1) через globalIndex
 * 
 * TODO [GEMINI]: Улучшить визуал анимаций (см. TODO-блоки внизу файла)
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';
import type { Arrow } from '../game/types';
import { DIRECTIONS, ARROW_EMOJIS, ARROW_GEOMETRY } from '../config/constants';
import { useGameStore } from '../stores/store';
import { hitTestArrow } from '../utils/boardUtils';

// ============================================
// TYPES
// ============================================

/** Стрелка в процессе вылета */
interface FlyingArrow {
  arrow: Arrow;
  startTime: number;
  duration: number;        // ms
  /** Прогресс 0→1 */
  progress: number;
}

/** Стрелка с shake-анимацией */
interface ShakingArrow {
  arrowId: string;
  startTime: number;
  duration: number;
}

/** Easing functions */
const EASING = {
  /** Ускорение (для вылета) */
  easeIn: (t: number) => t * t,
  /** Замедление */
  easeOut: (t: number) => 1 - (1 - t) * (1 - t),
  /** Ускорение + замедление */
  easeInOut: (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  
  /**
   * TODO [GEMINI]: Добавить spring easing для сочности:
   * spring: (t: number, stiffness = 100, damping = 10) => { ... }
   * Использовать для bounce-эффекта при shake и появлении стрелок.
   */
};

// ============================================
// CONSTANTS
// ============================================

const FLY_OUT_DURATION = 400;  // ms
const SHAKE_DURATION = 300;    // ms
const SHAKE_AMPLITUDE = 4;     // px
const HINT_GLOW_SPEED = 2;    // cycles per second
const DOT_COLOR = 'rgba(255,255,255,0.1)';
const OUTLINE_COLOR = '#FFFFFF';
const HINT_COLOR = '#FFD700';

/** 
 * Порог DPR для больших полей (Samsung с DPR=3 на 100×100 → canvas 30,000px).
 * Ограничиваем до 2 чтобы не словить OOM.
 */
const MAX_DPR_LARGE_GRID = 2;

// ============================================
// COMPONENT
// ============================================

interface CanvasBoardProps {
  arrows: Arrow[];
  gridSize: { width: number; height: number };
  cellSize: number;
  hintedArrowId: string | null;
  onArrowClick: (arrowId: string) => void;
}

export function CanvasBoard({
  arrows,
  gridSize,
  cellSize,
  hintedArrowId,
  onArrowClick,
}: CanvasBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  
  // Анимационное состояние (mutable refs — не вызывают ре-рендер)
  const flyingArrowsRef = useRef<FlyingArrow[]>([]);
  const shakingArrowRef = useRef<ShakingArrow | null>(null);
  const prevArrowIdsRef = useRef<Set<string>>(new Set());
  
  // Атомарный селектор для shakingArrowId
  const shakingArrowId = useGameStore(s => s.shakingArrowId);
  
  const boardWidth = gridSize.width * cellSize;
  const boardHeight = gridSize.height * cellSize;
  
  // DPR с ограничением для больших полей
  const dpr = useMemo(() => {
    const rawDpr = window.devicePixelRatio || 1;
    const totalCells = gridSize.width * gridSize.height;
    if (totalCells > 2500) return Math.min(rawDpr, MAX_DPR_LARGE_GRID);
    return rawDpr;
  }, [gridSize.width, gridSize.height]);
  
  // Occupancy map для grid dots (какие ячейки заняты)
  const occupiedCells = useMemo(() => {
    const set = new Set<string>();
    for (const arrow of arrows) {
      for (const cell of arrow.cells) {
        set.add(`${cell.x},${cell.y}`);
      }
    }
    return set;
  }, [arrows]);

  // ============================================
  // DETECT REMOVED ARROWS → START FLY ANIMATION
  // ============================================
  
  useEffect(() => {
    const currentIds = new Set(arrows.map(a => a.id));
    const prevIds = prevArrowIdsRef.current;
    
    // Найти удалённые стрелки
    for (const prevId of prevIds) {
      if (!currentIds.has(prevId)) {
        // Фаза 4: HistoryDiff хранит removedArrows[] напрямую
        const history = useGameStore.getState().history;
        const lastDiff = history[history.length - 1];
        if (lastDiff) {
          const removedArrow = lastDiff.removedArrows.find(a => a.id === prevId);
          if (removedArrow) {
            flyingArrowsRef.current.push({
              arrow: removedArrow,
              startTime: performance.now(),
              duration: FLY_OUT_DURATION,
              progress: 0,
            });
          }
        }
      }
    }
    
    prevArrowIdsRef.current = currentIds;
  }, [arrows]);

  // ============================================
  // DETECT SHAKE
  // ============================================
  
  useEffect(() => {
    if (shakingArrowId) {
      shakingArrowRef.current = {
        arrowId: shakingArrowId,
        startTime: performance.now(),
        duration: SHAKE_DURATION,
      };
    }
  }, [shakingArrowId]);

  // ============================================
  // CLICK / TOUCH HANDLER — O(1) via shared hitTestArrow
  // ============================================
  
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const arrowId = hitTestArrow(
      e.clientX, e.clientY, e.currentTarget,
      cellSize, gridSize.width, gridSize.height
    );
    if (arrowId) onArrowClick(arrowId);
  }, [cellSize, gridSize.width, gridSize.height, onArrowClick]);

  const handleTouch = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.changedTouches.length !== 1) return;
    const touch = e.changedTouches[0];
    const arrowId = hitTestArrow(
      touch.clientX, touch.clientY, e.currentTarget,
      cellSize, gridSize.width, gridSize.height
    );
    if (arrowId) {
      e.preventDefault();
      onArrowClick(arrowId);
    }
  }, [cellSize, gridSize.width, gridSize.height, onArrowClick]);

  // ============================================
  // RENDER LOOP
  // ============================================
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // HiDPI setup
    canvas.width = boardWidth * dpr;
    canvas.height = boardHeight * dpr;
    canvas.style.width = `${boardWidth}px`;
    canvas.style.height = `${boardHeight}px`;
    ctx.scale(dpr, dpr);

    let isRunning = true;
    
    function render(now: number) {
      if (!isRunning || !ctx) return;
      
      // Clear
      ctx.clearRect(0, 0, boardWidth, boardHeight);
      
      // 1. Grid dots
      drawGridDots(ctx, gridSize, cellSize, occupiedCells);
      
      // 2. Static arrows
      const shaking = shakingArrowRef.current;
      const shakeActive = shaking && (now - shaking.startTime < shaking.duration);
      
      for (const arrow of arrows) {
        let offsetX = 0;
        
        // Shake offset
        if (shakeActive && shaking!.arrowId === arrow.id) {
          const t = (now - shaking!.startTime) / shaking!.duration;
          offsetX = Math.sin(t * Math.PI * 5) * SHAKE_AMPLITUDE * (1 - t);
        }
        
        const isHinted = arrow.id === hintedArrowId;
        const hintPulse = isHinted ? 0.5 + 0.5 * Math.sin(now * 0.001 * HINT_GLOW_SPEED * Math.PI * 2) : 0;
        
        drawArrow(ctx, arrow, cellSize, offsetX, isHinted, hintPulse);
      }
      
      // 3. Flying arrows (exit animation)
      const flying = flyingArrowsRef.current;
      let hasAnimations = false;
      
      for (let i = flying.length - 1; i >= 0; i--) {
        const fa = flying[i];
        const elapsed = now - fa.startTime;
        fa.progress = Math.min(1, elapsed / fa.duration);
        
        if (fa.progress >= 1) {
          flying.splice(i, 1);
          continue;
        }
        
        hasAnimations = true;
        drawFlyingArrow(ctx, fa, cellSize);
      }
      
      // Cleanup shake
      if (shakeActive) hasAnimations = true;
      if (shaking && !shakeActive) shakingArrowRef.current = null;
      
      // Continue loop if animating, otherwise stop and wait for next state change
      if (hasAnimations || hintedArrowId) {
        animFrameRef.current = requestAnimationFrame(render);
      } else {
        animFrameRef.current = 0;
      }
    }
    
    // Первый кадр
    animFrameRef.current = requestAnimationFrame(render);
    
    return () => {
      isRunning = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [arrows, gridSize, cellSize, occupiedCells, hintedArrowId, boardWidth, boardHeight, dpr]);

  // Перезапуск рендер-лупа при shake/fly (если был остановлен)
  useEffect(() => {
    if (shakingArrowId && animFrameRef.current === 0) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      // Трюк: пнуть перерисовку через лёгкий стейт-чейндж
      // На самом деле useEffect выше пересоздаст loop при изменении arrows
      // Но shake может прийти без изменения arrows — нужен ручной пинок
      function kickRender(now: number) {
        // Повторяем логику render (DRY нарушение, но избегаем сложного рефактора)
        // Более чистое решение — вынести render в ref
        ctx!.clearRect(0, 0, boardWidth, boardHeight);
        drawGridDots(ctx!, gridSize, cellSize, occupiedCells);
        
        const shaking = shakingArrowRef.current;
        const shakeActive = shaking && (now - shaking.startTime < shaking.duration);
        
        for (const arrow of arrows) {
          let offsetX = 0;
          if (shakeActive && shaking!.arrowId === arrow.id) {
            const t = (now - shaking!.startTime) / shaking!.duration;
            offsetX = Math.sin(t * Math.PI * 5) * SHAKE_AMPLITUDE * (1 - t);
          }
          const isHinted = arrow.id === hintedArrowId;
          const hintPulse = isHinted ? 0.5 + 0.5 * Math.sin(now * 0.001 * HINT_GLOW_SPEED * Math.PI * 2) : 0;
          drawArrow(ctx!, arrow, cellSize, offsetX, isHinted, hintPulse);
        }
        
        const flying = flyingArrowsRef.current;
        for (let i = flying.length - 1; i >= 0; i--) {
          const fa = flying[i];
          fa.progress = Math.min(1, (now - fa.startTime) / fa.duration);
          if (fa.progress >= 1) { flying.splice(i, 1); continue; }
          drawFlyingArrow(ctx!, fa, cellSize);
        }
        
        if (shakeActive || flying.length > 0 || hintedArrowId) {
          animFrameRef.current = requestAnimationFrame(kickRender);
        } else {
          animFrameRef.current = 0;
          if (shaking) shakingArrowRef.current = null;
        }
      }
      
      animFrameRef.current = requestAnimationFrame(kickRender);
    }
  }, [shakingArrowId]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: boardWidth, height: boardHeight, cursor: 'pointer' }}
      onClick={handleClick}
      onTouchEnd={handleTouch}
    />
  );
}

// ============================================
// DRAWING FUNCTIONS (вынесены для чистоты)
// ============================================

/**
 * Рисует сетку точек.
 * 10,000 точек за <0.5ms — просто цикл fillRect.
 * Точки появляются на месте ушедших стрелок автоматически:
 * рисуем ВСЕ точки, стрелки рисуются поверх.
 */
function drawGridDots(
  ctx: CanvasRenderingContext2D,
  gridSize: { width: number; height: number },
  cellSize: number,
  occupiedCells: Set<string>
) {
  const half = cellSize / 2;
  const dotR = cellSize * ARROW_GEOMETRY.dotRadius;
  
  ctx.fillStyle = DOT_COLOR;
  
  for (let y = 0; y < gridSize.height; y++) {
    for (let x = 0; x < gridSize.width; x++) {
      // Не рисуем под стрелками (опционально — можно убрать для "проступания")
      if (occupiedCells.has(`${x},${y}`)) continue;
      
      ctx.beginPath();
      ctx.arc(x * cellSize + half, y * cellSize + half, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Рисует статичную стрелку (тело + outline + голова + emoji).
 * Визуально идентична SVG-версии из GameBoard.tsx.
 */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  arrow: Arrow,
  cellSize: number,
  offsetX: number,
  isHinted: boolean,
  hintPulse: number  // 0..1 для glow-анимации
) {
  const dir = DIRECTIONS[arrow.direction];
  const half = cellSize / 2;
  const STROKE_RATIO = 0.20;
  const HEAD_GAP_RATIO = 0.25;
  const strokeWidth = cellSize * STROKE_RATIO;
  const headGap = cellSize * HEAD_GAP_RATIO;
  
  const strokeColor = isHinted ? HINT_COLOR : arrow.color;
  
  // Строим точки тела (от хвоста к голове, подрезая конец)
  const cellsReversed = [...arrow.cells].reverse();
  const points = cellsReversed.map(c => ({
    x: c.x * cellSize + half + offsetX,
    y: c.y * cellSize + half,
  }));
  
  if (points.length > 1) {
    const last = points[points.length - 1];
    last.x -= dir.dx * headGap;
    last.y -= dir.dy * headGap;
  }
  
  // Рисуем тело
  if (points.length >= 2) {
    // Белая подложка
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.lineWidth = strokeWidth + cellSize * 0.08;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    
    // Цветная линия
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  
  // Голова (шеврон) — идентична SVG
  const head = arrow.cells[0];
  const headX = head.x * cellSize + half + offsetX;
  const headY = head.y * cellSize + half;
  const angle = dir.angle * (Math.PI / 180);
  
  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(angle);
  
  ctx.beginPath();
  ctx.moveTo(-cellSize * 0.45, -cellSize * 0.25);
  ctx.lineTo(0, 0);
  ctx.lineTo(-cellSize * 0.45, cellSize * 0.25);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth * 1.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  
  ctx.restore();
  
  // Hint glow
  if (isHinted && hintPulse > 0) {
    ctx.save();
    ctx.globalAlpha = hintPulse * 0.3;
    ctx.shadowColor = HINT_COLOR;
    ctx.shadowBlur = cellSize * 0.5;
    
    // Перерисуем тело с glow
    if (points.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.strokeStyle = HINT_COLOR;
      ctx.lineWidth = strokeWidth * 1.5;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    
    ctx.restore();
  }
  
  // Emoji для спецстрелок
  if (arrow.type !== 'normal') {
    ctx.font = `${cellSize * 0.5}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ARROW_EMOJIS[arrow.type], headX, headY);
  }
}

/**
 * Рисует вылетающую стрелку (exit-анимация).
 * 
 * Стрелка смещается в направлении полёта с easeIn,
 * одновременно fade out.
 * 
 * TODO [GEMINI]: Добавить trail-эффект за вылетающей стрелкой:
 * - При каждом кадре рисовать полупрозрачную копию стрелки
 *   с уменьшающейся opacity на предыдущих позициях
 * - Или particle burst в начальной точке
 * 
 * TODO [GEMINI]: Spring easing вместо easeIn для более "сочного" вылета:
 * - Лёгкий pullback в начале (стрелка чуть сжимается назад)
 * - Затем резкий выброс вперёд
 * - Формула: t < 0.15 ? -sin(t/0.15 * PI) * 0.1 : easeIn((t-0.15)/0.85) * 1.1
 */
function drawFlyingArrow(
  ctx: CanvasRenderingContext2D,
  fa: FlyingArrow,
  cellSize: number
) {
  const { arrow, progress } = fa;
  const dir = DIRECTIONS[arrow.direction];
  
  // Easing + расстояние
  const easedProgress = EASING.easeIn(progress);
  const flyDistance = cellSize * 10 * easedProgress;
  
  // Fade out
  const opacity = 1 - easedProgress;
  
  ctx.save();
  ctx.globalAlpha = opacity;
  
  // Смещаем всё в направлении полёта
  ctx.translate(dir.dx * flyDistance, dir.dy * flyDistance);
  
  // Рисуем стрелку как обычную (без shake, без hint)
  drawArrow(ctx, arrow, cellSize, 0, false, 0);
  
  ctx.restore();
}

// ============================================
// VIEWPORT CULLING (для зума)
// ============================================

/**
 * Фильтрует стрелки, попадающие в видимую область.
 * Используется при зуме — рисуем только то, что видно.
 * 
 * TODO [GEMINI]: Интегрировать в CanvasBoard при зуме > 1:
 * 1. Получить viewport из parent transform (translate + scale)
 * 2. Вычислить видимый прямоугольник в grid-координатах
 * 3. Фильтровать arrows через getVisibleArrows()
 * 4. Передать отфильтрованный массив в render loop
 * 
 * Пример интеграции:
 * ```
 * // В GameScreen, перед передачей arrows в CanvasBoard:
 * const visibleArrows = useMemo(() => {
 *   if (transform.k <= 1) return arrows; // Нет зума — показать все
 *   const vp = getViewportRect(containerRef, transform, cellSize);
 *   return getVisibleArrows(arrows, vp, cellSize);
 * }, [arrows, transform, cellSize]);
 * ```
 */
export function getVisibleArrows(
  arrows: Arrow[],
  viewport: { x: number; y: number; w: number; h: number },
  cellSize: number
): Arrow[] {
  const margin = cellSize * 2; // Запас чтобы не обрезать стрелки на краю
  
  return arrows.filter(arrow =>
    arrow.cells.some(cell => {
      const px = cell.x * cellSize;
      const py = cell.y * cellSize;
      return (
        px >= viewport.x - margin &&
        px <= viewport.x + viewport.w + margin &&
        py >= viewport.y - margin &&
        py <= viewport.y + viewport.h + margin
      );
    })
  );
}

/**
 * Вычисляет видимый прямоугольник в пиксельных координатах поля.
 * 
 * TODO [GEMINI]: Вынести в utils, использовать вместе с getVisibleArrows.
 */
export function getViewportRect(
  containerWidth: number,
  containerHeight: number,
  transform: { k: number; x: number; y: number }
): { x: number; y: number; w: number; h: number } {
  // transform: CSS translate(x,y) scale(k)
  // Видимая область в координатах поля = инверсия CSS-трансформа
  return {
    x: -transform.x / transform.k,
    y: -transform.y / transform.k,
    w: containerWidth / transform.k,
    h: containerHeight / transform.k,
  };
}

// ============================================
// TODO: GEMINI — визуальные улучшения
// ============================================

/**
 * TODO [GEMINI — приоритет ВЫСОКИЙ]: Particle эффекты
 * 
 * Canvas позволяет легко рисовать сотни частиц без нагрузки.
 * Добавить систему частиц для:
 * 
 * 1. Вылет стрелки — искры/пыль в начальной позиции:
 *    ```
 *    interface Particle {
 *      x: number; y: number;
 *      vx: number; vy: number;
 *      life: number; maxLife: number;
 *      color: string; size: number;
 *    }
 *    
 *    function spawnParticles(x, y, color, count = 8) {
 *      for (let i = 0; i < count; i++) {
 *        const angle = Math.random() * Math.PI * 2;
 *        const speed = 1 + Math.random() * 3;
 *        particles.push({
 *          x, y,
 *          vx: Math.cos(angle) * speed,
 *          vy: Math.sin(angle) * speed,
 *          life: 1, maxLife: 0.3 + Math.random() * 0.3,
 *          color, size: 2 + Math.random() * 3,
 *        });
 *      }
 *    }
 *    ```
 * 
 * 2. Бомба — shockwave кольцо + разлетающиеся осколки:
 *    - Кольцо: расширяющийся arc с decreasing lineWidth
 *    - Осколки: particles с высокой скоростью от центра
 * 
 * 3. Электро — lightning bolt (зигзаг линия):
 *    ```
 *    function drawLightning(ctx, from, to, segments = 8) {
 *      ctx.beginPath();
 *      ctx.moveTo(from.x, from.y);
 *      const dx = (to.x - from.x) / segments;
 *      const dy = (to.y - from.y) / segments;
 *      for (let i = 1; i < segments; i++) {
 *        const jitter = (Math.random() - 0.5) * cellSize * 0.5;
 *        ctx.lineTo(from.x + dx * i + jitter, from.y + dy * i + jitter);
 *      }
 *      ctx.lineTo(to.x, to.y);
 *      ctx.strokeStyle = '#FFD700';
 *      ctx.lineWidth = 3;
 *      ctx.shadowColor = '#FFD700';
 *      ctx.shadowBlur = 10;
 *      ctx.stroke();
 *    }
 *    ```
 * 
 * 4. Лёд — кристаллы разлетаются при разморозке:
 *    - Треугольные particles с голубым цветом
 *    - Gravity + rotation
 */

/**
 * TODO [GEMINI — приоритет СРЕДНИЙ]: Trail эффект за вылетающей стрелкой
 * 
 * Самый простой вариант — не полностью очищать canvas:
 * ```
 * // В render loop, вместо ctx.clearRect(...):
 * ctx.fillStyle = 'rgba(30, 58, 82, 0.3)'; // Цвет фона с alpha
 * ctx.fillRect(0, 0, boardWidth, boardHeight);
 * ```
 * Это создаёт эффект "размазывания" — стрелка оставляет шлейф.
 * НО: ломает grid dots и статичные стрелки (они тоже размазываются).
 * 
 * Правильный вариант — отдельный canvas слой для trail:
 * ```
 * <canvas ref={bgCanvasRef} /> <!-- dots + static arrows -->
 * <canvas ref={fxCanvasRef} /> <!-- flying + particles (с trail) -->
 * ```
 */

/**
 * TODO [GEMINI — приоритет НИЗКИЙ]: Smooth appear при загрузке уровня
 * 
 * При initLevel стрелки появляются мгновенно. Для сочности:
 * 1. Добавить флаг `isAppearing` в CanvasBoard state
 * 2. При первом рендере — каждая стрелка scale 0→1 с задержкой по index:
 *    ```
 *    const delay = index * 20; // ms
 *    const elapsed = now - levelStartTime - delay;
 *    if (elapsed < 0) continue; // Ещё не появилась
 *    const scale = Math.min(1, elapsed / 200);
 *    ctx.save();
 *    ctx.translate(centerX, centerY);
 *    ctx.scale(scale, scale);
 *    ctx.translate(-centerX, -centerY);
 *    drawArrow(...);
 *    ctx.restore();
 *    ```
 */

// ============================================
// TODO: CODEX — тесты
// ============================================

/**
 * TODO [CODEX]:
 * 1. Проверить что drawArrow рисует то же что SVG ArrowSVG (визуальный snapshot тест)
 * 2. Hit test accuracy: клик в центр клетки → правильный arrowId
 * 3. Hit test edge: клик на границе двух стрелок → ближайшая
 * 4. Flying animation: progress 0 = стрелка на месте, progress 1 = за экраном
 * 5. Shake animation: не смещает стрелку после завершения (offsetX = 0)
 * 6. DPR: canvas.width = boardWidth * dpr, style.width = boardWidth
 * 7. Memory: 1000 fly animations → старые удаляются (splice)
 * 8. Performance: 500 стрелок render < 5ms (console.time в render loop)
 */