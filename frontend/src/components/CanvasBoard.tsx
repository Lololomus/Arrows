/**
 * Arrow Puzzle - Canvas Board Renderer (VIEWPORT CANVAS)
 *
 * АРХИТЕКТУРА:
 *   Canvas = размер viewport (контейнера), НЕ размер поля.
 *   Камера (pan/zoom) работает через ctx.setTransform() внутри render loop.
 *   Никакого <motion.div> сверху → никакого мыла при зуме.
 *
 * ОТЛИЧИЯ ОТ ПРЕДЫДУЩЕЙ ВЕРСИИ:
 *   - Canvas.width/height = контейнер × DPR (фиксированный, не dynamic)
 *   - Камера: springX/Y/Scale читаются через .get() в каждом кадре
 *   - Hit testing: инверсия камеры (screen → world → grid)
 *   - Viewport culling: по реальной видимой области камеры
 *   - DPR = window.devicePixelRatio (простой, без Dynamic DPR hack)
 *   - ResizeObserver для отслеживания размера контейнера
 *
 * Сохранено:
 *   - LOD (упрощённая отрисовка при отдалении)
 *   - Cinematic sweep intro
 *   - Shake-анимация
 *   - Hint glow пульсация
 *   - Скин-система (все значения из skin)
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';
import type { Arrow } from '../game/types';
import { DIRECTIONS, ARROW_EMOJIS } from '../config/constants';
import { useGameStore } from '../stores/store';
import { useActiveSkin, type GameSkin } from '../game/skins';
import type { MotionValue } from 'framer-motion';
import { globalIndex } from '../game/spatialIndex';

// ============================================
// TYPES
// ============================================

interface ShakingArrow {
  arrowId: string;
  startTime: number;
  duration: number;
}

export interface CanvasBoardProps {
  arrows: Arrow[];
  gridSize: { width: number; height: number };
  cellSize: number;
  hintedArrowId: string | null;
  onArrowClick: (arrowId: string) => void;
  /** Камера — Framer Motion spring MotionValues */
  springX: MotionValue<number>;
  springY: MotionValue<number>;
  springScale: MotionValue<number>;
}

// ============================================
// CONSTANTS
// ============================================

/** Ниже этого порога (cellSize × zoom, px) включается LOD */
const LOD_THRESHOLD = 12;

/** Отступ padding-ячеек вокруг сетки (в долях cellSize, как было в GameScreen) */
const GRID_PADDING_CELLS = 0.4;

// ============================================
// COMPONENT
// ============================================

export function CanvasBoard({
  arrows,
  gridSize,
  cellSize,
  hintedArrowId,
  onArrowClick,
  springX,
  springY,
  springScale,
}: CanvasBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const skin = useActiveSkin();
  const animFrameRef = useRef<number>(0);

  const shakingArrowRef = useRef<ShakingArrow | null>(null);
  const levelStartTimeRef = useRef<number>(performance.now());
  const shakingArrowId = useGameStore(s => s.shakingArrowId);

  // Размер контейнера (обновляется через ResizeObserver)
  const containerSizeRef = useRef({ w: window.innerWidth, h: window.innerHeight });

  const dpr = window.devicePixelRatio || 1;

  // Размеры поля в world-координатах (включая padding)
  const totalBoardW = (gridSize.width + GRID_PADDING_CELLS) * cellSize;
  const totalBoardH = (gridSize.height + GRID_PADDING_CELLS) * cellSize;
  const boardPadding = cellSize * (GRID_PADDING_CELLS / 2); // 0.2 * cellSize

  // Set ТЕКУЩИХ занятых ячеек (пересчитывается при удалении стрелки)
  const currentOccupied = useMemo(() => {
    const set = new Set<string>();
    for (const arrow of arrows) {
      for (const cell of arrow.cells) {
        set.add(`${cell.x},${cell.y}`);
      }
    }
    return set;
  }, [arrows]);

  // Set НАЧАЛЬНЫХ ячеек уровня — фиксируется при монтировании.
  // Компонент ремонтируется через key={canvas-${level}}, поэтому ref = снимок при старте.
  // Подложка и контур поля рисуются по этому set (никогда не сжимаются).
  // Точки рисуются на initialCells минус currentOccupied (освободившиеся места).
  const initialCellsRef = useRef<Set<string>>(currentOccupied);
  // Обновляем только если initialCells пустой (первый рендер до arrows) → подхватим при появлении
  if (initialCellsRef.current.size === 0 && currentOccupied.size > 0) {
    initialCellsRef.current = currentOccupied;
  }

  // levelStartTimeRef сбрасывается автоматически при ремаунте (key={canvas-${level}})
  // НЕ привязываем к arrows.length — иначе sweep перезапускается при удалении стрелки

  // Shake tracking
  useEffect(() => {
    if (shakingArrowId) {
      shakingArrowRef.current = {
        arrowId: shakingArrowId,
        startTime: performance.now(),
        duration: skin.animation.shakeDuration,
      };
    }
  }, [shakingArrowId, skin.animation.shakeDuration]);

  // ============================================
  // HIT TESTING (инверсия камеры: screen → grid)
  // ============================================

  const screenToGrid = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const camX = springX.get();
    const camY = springY.get();
    const camScale = springScale.get();

    // Инверсия камеры: screen → world (центрированные координаты)
    const worldX = (localX - cx - camX) / camScale;
    const worldY = (localY - cy - camY) / camScale;

    // World → grid (world (0,0) = центр доски)
    const gridLocalX = worldX + totalBoardW / 2 - boardPadding;
    const gridLocalY = worldY + totalBoardH / 2 - boardPadding;

    const gx = Math.floor(gridLocalX / cellSize);
    const gy = Math.floor(gridLocalY / cellSize);

    if (gx < 0 || gx >= gridSize.width || gy < 0 || gy >= gridSize.height) return null;
    return { x: gx, y: gy };
  }, [springX, springY, springScale, cellSize, gridSize.width, gridSize.height, totalBoardW, totalBoardH, boardPadding]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const cell = screenToGrid(e.clientX, e.clientY);
    if (!cell) return;
    const arrowId = globalIndex.getArrowAt(cell.x, cell.y);
    if (arrowId) onArrowClick(arrowId);
  }, [screenToGrid, onArrowClick]);

  const handleTouch = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.changedTouches.length !== 1) return;
    const touch = e.changedTouches[0];
    const cell = screenToGrid(touch.clientX, touch.clientY);
    if (!cell) return;
    const arrowId = globalIndex.getArrowAt(cell.x, cell.y);
    if (arrowId) {
      e.preventDefault();
      onArrowClick(arrowId);
    }
  }, [screenToGrid, onArrowClick]);

  // ============================================
  // RESIZE OBSERVER — следим за размером контейнера
  // ============================================

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerSizeRef.current = {
          w: entry.contentRect.width,
          h: entry.contentRect.height,
        };
        // Будим Canvas если спит — нужно перерисовать в новом размере
        if (animFrameRef.current === 0) {
          animFrameRef.current = requestAnimationFrame(() => {});
        }
      }
    });
    observer.observe(wrapper);

    // Начальный замер
    containerSizeRef.current = { w: wrapper.clientWidth, h: wrapper.clientHeight };

    return () => observer.disconnect();
  }, []);

  // ============================================
  // RENDER LOOP
  // ============================================

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isRunning = true;

    function render(now: number) {
      if (!isRunning || !ctx || !canvas) return;

      // --- Размеры контейнера (логические px) ---
      const { w: cw, h: ch } = containerSizeRef.current;
      if (cw === 0 || ch === 0) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // --- Ресайз физического буфера если нужно ---
      const targetW = Math.round(cw * dpr);
      const targetH = Math.round(ch * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;
      }

      // --- Читаем камеру из spring'ов ---
      const camX = springX.get();
      const camY = springY.get();
      const camScale = springScale.get();

      // --- Clear (в физических пикселях) ---
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // --- Камера: DPR → translate to center + pan → scale ---
      // После этого (0,0) = центр viewport + pan offset, масштаб = camScale
      ctx.setTransform(
        dpr, 0, 0, dpr, 0, 0
      );
      ctx.translate(cw / 2 + camX, ch / 2 + camY);
      ctx.scale(camScale, camScale);
      // Сдвиг к началу сетки: world (0,0) = центр доски → grid origin
      ctx.translate(-totalBoardW / 2 + boardPadding, -totalBoardH / 2 + boardPadding);
      // Теперь (0,0) = ячейка (0,0) сетки. Рисуем как раньше.

      // --- Intro sweep ---
      const elapsedSinceStart = now - levelStartTimeRef.current;
      const introDuration = 1000;
      let progress = Math.max(0, Math.min(1, elapsedSinceStart / introDuration));
      const isIntro = skin.effects.enableAppearAnimation && progress < 1;

      // LOD: отключаем обводки если ячейка < 12px на экране
      const isLOD = (cellSize * camScale) < LOD_THRESHOLD;

      ctx.save();

      // Sweep mask (в координатах сетки)
      if (isIntro) {
        const ease = 1 - Math.pow(1 - progress, 3);
        const bw = gridSize.width * cellSize;
        const bh = gridSize.height * cellSize;
        const maxRadius = Math.max(0.1, Math.hypot(bw, bh));

        ctx.beginPath();
        ctx.arc(bw / 2, bh / 2, maxRadius * ease, 0, Math.PI * 2);
        ctx.clip();
      }

      // --- Viewport culling ---
      const visibleArrows = getVisibleArrowsFromCamera(
        arrows, cw, ch, camX, camY, camScale,
        totalBoardW, totalBoardH, boardPadding, cellSize
      );

      // 0. Подложка — blob вокруг НАЧАЛЬНЫХ ячеек (не сжимается при удалении)
      drawBoardBackground(ctx, gridSize, cellSize, initialCellsRef.current);

      // 1. Grid dots — только на освободившихся ячейках (были стрелки → удалены)
      drawGridDots(ctx, cellSize, initialCellsRef.current, currentOccupied, skin);

      // 2. Стрелки
      let hasAnimations = isIntro;
      const shaking = shakingArrowRef.current;
      const shakeActive = shaking && (now - shaking.startTime < shaking.duration);
      if (shakeActive) hasAnimations = true;

      for (let i = 0; i < visibleArrows.length; i++) {
        const arrow = visibleArrows[i];

        let offsetX = 0;
        if (shakeActive && shaking!.arrowId === arrow.id) {
          const t = (now - shaking!.startTime) / shaking!.duration;
          offsetX = Math.sin(t * Math.PI * skin.animation.shakeFrequency) * skin.animation.shakeAmplitude * (1 - t);
        }

        const isHinted = arrow.id === hintedArrowId;
        const hintPulse = isHinted
          ? 0.5 + 0.5 * Math.sin(now * 0.001 * skin.animation.hintGlowSpeed * Math.PI * 2)
          : 0;

        drawArrow(ctx, arrow, cellSize, offsetX, isHinted, hintPulse, skin, isLOD);
      }

      ctx.restore(); // Снимаем sweep clip

      if (shaking && !shakeActive) shakingArrowRef.current = null;

      // --- Scheduling ---
      if (hasAnimations || hintedArrowId) {
        animFrameRef.current = requestAnimationFrame(render);
      } else {
        animFrameRef.current = 0; // Засыпаем 😴
      }
    }

    // Первый кадр
    animFrameRef.current = requestAnimationFrame(render);

    // === Wake-up подписки: будим Canvas если пружины двигаются ===
    const wakeUp = () => {
      if (animFrameRef.current === 0 && isRunning) {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };
    const unsubX = springX.on('change', wakeUp);
    const unsubY = springY.on('change', wakeUp);
    const unsubScale = springScale.on('change', wakeUp);

    return () => {
      isRunning = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      unsubX();
      unsubY();
      unsubScale();
    };
  }, [
    arrows, gridSize, cellSize, currentOccupied, hintedArrowId,
    totalBoardW, totalBoardH, boardPadding, dpr, skin,
    springX, springY, springScale,
  ]);

  // Пинок render loop для shake (если спит)
  useEffect(() => {
    if (shakingArrowId && animFrameRef.current === 0) {
      shakingArrowRef.current = {
        arrowId: shakingArrowId,
        startTime: performance.now(),
        duration: skin.animation.shakeDuration,
      };
      // Запускаем loop
      const canvas = canvasRef.current;
      if (canvas) {
        animFrameRef.current = requestAnimationFrame(() => {});
      }
    }
  }, [shakingArrowId, skin.animation.shakeDuration]);

  // ============================================
  // RENDER — canvas заполняет весь контейнер
  // ============================================

  return (
    <div
      ref={wrapperRef}
      style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: 'pointer' }}
        onClick={handleClick}
        onTouchEnd={handleTouch}
      />
    </div>
  );
}

// ============================================
// VIEWPORT CULLING (камера-aware)
// ============================================

/**
 * Фильтрует стрелки по видимой области камеры.
 * Работает в world-координатах (до grid transform).
 */
function getVisibleArrowsFromCamera(
  arrows: Arrow[],
  containerW: number,
  containerH: number,
  camX: number,
  camY: number,
  camScale: number,
  totalBoardW: number,
  totalBoardH: number,
  boardPadding: number,
  cellSize: number,
): Arrow[] {
  // Если масштаб показывает всё поле — пропускаем culling
  if (camScale <= 1) return arrows;

  // Viewport bounds в grid-координатах
  const halfVpW = containerW / 2 / camScale;
  const halfVpH = containerH / 2 / camScale;

  // Центр viewport в world = (-camX/camScale, -camY/camScale)
  // Grid offset: world(0,0) = центр доски, grid(0,0) = world(-totalBoardW/2+padding, ...)
  const vpCenterInGridX = -camX / camScale + totalBoardW / 2 - boardPadding;
  const vpCenterInGridY = -camY / camScale + totalBoardH / 2 - boardPadding;

  const vpLeft = vpCenterInGridX - halfVpW;
  const vpRight = vpCenterInGridX + halfVpW;
  const vpTop = vpCenterInGridY - halfVpH;
  const vpBottom = vpCenterInGridY + halfVpH;

  const margin = cellSize * 2; // Запас чтобы стрелки не "обрезались" на краю

  return arrows.filter(arrow =>
    arrow.cells.some(cell => {
      const px = cell.x * cellSize;
      const py = cell.y * cellSize;
      return (
        px >= vpLeft - margin &&
        px <= vpRight + margin &&
        py >= vpTop - margin &&
        py <= vpBottom + margin
      );
    })
  );
}

// ============================================
// DRAWING FUNCTIONS
// ============================================

/**
 * Подложка поля — тёмный blob который плотно обвивает области со стрелками.
 * 
 * Алгоритм:
 * 1. Берём occupiedCells напрямую (без dilation — плотно по контуру)
 * 2. Каждая ячейка = roundRect с маленьким pad и радиусом
 * 3. Overlap между соседними ячейками скрывает внутренние скругления
 * 4. Только настоящие внешние углы (без соседей) показывают мягкое закругление
 */
function drawBoardBackground(
  ctx: CanvasRenderingContext2D,
  _gridSize: { width: number; height: number },
  cellSize: number,
  occupiedCells: Set<string>,
) {
  if (occupiedCells.size === 0) return;

  // pad: небольшой перехлёст для бесшовного слияния соседних ячеек
  // radius: маленький — скрыт в overlap, виден только на внешних углах
  const pad = cellSize * 0.15;
  const radius = cellSize * 0.22;

  ctx.save();
  ctx.beginPath();
  for (const key of occupiedCells) {
    const [x, y] = key.split(',').map(Number);
    ctx.roundRect(
      x * cellSize - pad,
      y * cellSize - pad,
      cellSize + pad * 2,
      cellSize + pad * 2,
      radius,
    );
  }
  ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
  ctx.fill();
  ctx.restore();
}

/**
 * Точки сетки — рисуются ТОЛЬКО на освободившихся ячейках.
 * 
 * initialCells: ячейки при загрузке уровня (полный контур).
 * currentOccupied: ячейки где стрелки ещё стоят.
 * 
 * Точка появляется когда: ячейка есть в initialCells, но нет в currentOccupied.
 * Ячейки за пределами initialCells — всегда пустота (ни точек, ни подложки).
 */
function drawGridDots(
  ctx: CanvasRenderingContext2D,
  cellSize: number,
  initialCells: Set<string>,
  currentOccupied: Set<string>,
  skin: GameSkin,
) {
  const half = cellSize / 2;
  const dotR = cellSize * skin.geometry.gridDotRadius;

  ctx.fillStyle = skin.colors.gridDotColor;
  for (const key of initialCells) {
    // Рисуем точку только если ячейка освободилась
    if (currentOccupied.has(key)) continue;
    const [x, y] = key.split(',').map(Number);
    ctx.beginPath();
    ctx.arc(x * cellSize + half, y * cellSize + half, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Рендер одной стрелки. LOD = упрощённый режим (без обводки/шеврона).
 */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  arrow: Arrow,
  cellSize: number,
  offsetX: number,
  isHinted: boolean,
  hintPulse: number,
  skin: GameSkin,
  isLOD: boolean,
) {
  const dir = DIRECTIONS[arrow.direction];
  const half = cellSize / 2;
  const strokeWidth = cellSize * skin.geometry.bodyStrokeRatio;
  const headGap = cellSize * skin.geometry.headGapRatio;
  const strokeColor = isHinted ? skin.colors.hintColor : arrow.color;

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

  const buildPath = () => {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
  };

  // === LOD: дешёвая отрисовка при сильном отдалении ===
  // Линия + мини-шеврон (направление видно даже при 5000 стрелках)
  if (isLOD) {
    if (points.length >= 2) {
      buildPath();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth * 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // Мини-шеврон: маленький треугольник на голове стрелки
    const head = arrow.cells[0];
    const hx = head.x * cellSize + half + offsetX;
    const hy = head.y * cellSize + half;
    const sz = cellSize * 0.3; // Размер треугольника (меньше чем полный шеврон)

    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(dir.angle * (Math.PI / 180));
    ctx.beginPath();
    ctx.moveTo(sz * 0.4, 0);           // Кончик
    ctx.lineTo(-sz * 0.4, -sz * 0.4);  // Верхний ус
    ctx.lineTo(-sz * 0.4, sz * 0.4);   // Нижний ус
    ctx.closePath();
    ctx.fillStyle = strokeColor;
    ctx.fill();
    ctx.restore();

    return;
  }

  // === ВЫСОКАЯ ДЕТАЛИЗАЦИЯ ===
  if (points.length >= 2) {
    // Белая подложка
    buildPath();
    ctx.strokeStyle = skin.colors.outlineColor;
    ctx.lineWidth = strokeWidth + cellSize * skin.geometry.outlineExtraRatio;
    ctx.lineCap = skin.geometry.lineCap;
    ctx.lineJoin = skin.geometry.lineJoin;
    ctx.stroke();

    // Цветная линия
    buildPath();
    ctx.strokeStyle = isHinted && hintPulse > 0 ? skin.colors.hintColor : strokeColor;
    ctx.lineWidth = isHinted && hintPulse > 0 ? strokeWidth * skin.animation.hintGlowStrokeMultiplier : strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (isHinted && hintPulse > 0) {
      ctx.save();
      ctx.globalAlpha = hintPulse * skin.animation.hintGlowAlpha;
      ctx.shadowColor = skin.colors.hintColor;
      ctx.shadowBlur = cellSize * skin.animation.hintGlowBlurRatio;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.stroke();
    }
  }

  // Голова (шеврон)
  const head = arrow.cells[0];
  const headX = head.x * cellSize + half + offsetX;
  const headY = head.y * cellSize + half;
  const angle = dir.angle * (Math.PI / 180);

  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(angle);

  ctx.beginPath();
  ctx.moveTo(-cellSize * skin.geometry.chevronLengthRatio, -cellSize * skin.geometry.chevronSpreadRatio);
  ctx.lineTo(0, 0);
  ctx.lineTo(-cellSize * skin.geometry.chevronLengthRatio, cellSize * skin.geometry.chevronSpreadRatio);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth * skin.geometry.chevronStrokeMultiplier;
  ctx.lineCap = skin.geometry.lineCap;
  ctx.lineJoin = skin.geometry.lineJoin;
  ctx.stroke();

  ctx.restore();

  // Спец-символы (bomb, ice, etc.)
  if (arrow.type !== 'normal') {
    ctx.font = `${cellSize * 0.5}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ARROW_EMOJIS[arrow.type], headX, headY);
  }
}