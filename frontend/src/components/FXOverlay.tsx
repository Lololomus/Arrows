// ===== 📄 ФАЙЛ: src/components/FXOverlay.tsx =====
/**
 * Arrow Puzzle - Screen-Space FX Canvas (VIEWPORT CANVAS SYNC)
 *
 * ИЗМЕНЕНИЯ:
 * - Координатная математика упрощена: та же формула камеры что и CanvasBoard.
 *   Раньше: getBoundingClientRect() + сложная реконструкция позиции motion.div.
 *   Теперь: containerRef.center + camPan, scale, translate к grid origin.
 * - Всё остальное без изменений (отлов удалённых стрелок, fly-анимация).
 */

import { useEffect, useRef } from 'react';
import { MotionValue } from 'framer-motion';
import { useGameStore } from '../stores/store';
import { useActiveSkin, type GameSkin } from '../game/skins';
import { DIRECTIONS, ARROW_EMOJIS } from '../config/constants';
import type { Arrow } from '../game/types';

// ============================================
// TYPES
// ============================================

interface CapturedArrow {
  arrow: Arrow;
  startTime: number;
  duration: number;
  progress: number;
}

interface FXOverlayProps {
  containerRef: React.RefObject<HTMLDivElement>;
  gridSize: { width: number; height: number };
  cellSize: number;
  springX: MotionValue<number>;
  springY: MotionValue<number>;
  springScale: MotionValue<number>;
  active: boolean;
}

/** Padding ячеек (должен совпадать с CanvasBoard) */
const GRID_PADDING_CELLS = 0.4;

// ============================================
// COMPONENT
// ============================================

export function FXOverlay({ containerRef, gridSize, cellSize, springX, springY, springScale, active }: FXOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  const arrows = useGameStore(s => s.arrows);
  const skin = useActiveSkin();

  const flyingArrowsRef = useRef<CapturedArrow[]>([]);
  const prevArrowsRef = useRef<Set<string>>(new Set());

  // Отлов удалённых стрелок (без изменений)
  useEffect(() => {
    if (!active) return;

    const currentIds = new Set(arrows.map(a => a.id));
    const prevIds = prevArrowsRef.current;

    if (prevIds.size === 0) {
      flyingArrowsRef.current = [];
    } else if (currentIds.size < prevIds.size) {
      const history = useGameStore.getState().history;
      const lastDiff = history[history.length - 1];

      if (lastDiff) {
        for (const prevId of prevIds) {
          if (!currentIds.has(prevId)) {
            const removedArrow = lastDiff.removedArrows.find(a => a.id === prevId);
            if (removedArrow) {
              flyingArrowsRef.current.push({
                arrow: removedArrow,
                startTime: performance.now(),
                duration: skin.animation.flyDuration,
                progress: 0,
              });
            }
          }
        }
      }
    }
    prevArrowsRef.current = currentIds;
  }, [arrows, active, skin.animation.flyDuration]);

  // ============================================
  // RENDER LOOP
  // ============================================

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Размеры доски в world-координатах (совпадает с CanvasBoard)
    const totalBoardW = (gridSize.width + GRID_PADDING_CELLS) * cellSize;
    const totalBoardH = (gridSize.height + GRID_PADDING_CELLS) * cellSize;
    const boardPadding = cellSize * (GRID_PADDING_CELLS / 2);

    function render(now: number) {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const flying = flyingArrowsRef.current;
      if (flying.length === 0) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // Позиция контейнера на экране
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // Камера из spring'ов
      const camX = springX.get();
      const camY = springY.get();
      const camScale = springScale.get();

      // Центр контейнера на экране
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      ctx.save();
      ctx.scale(dpr, dpr);

      for (let i = flying.length - 1; i >= 0; i--) {
        const fa = flying[i];
        fa.progress = Math.min(1, (now - fa.startTime) / fa.duration);

        if (fa.progress >= 1) {
          flying.splice(i, 1);
          continue;
        }

        ctx.save();

        // === ТА ЖЕ ФОРМУЛА КАМЕРЫ ЧТО И В CANVASBOARD ===
        // Translate к центру контейнера + pan, scale, сдвиг к grid origin
        ctx.translate(cx + camX, cy + camY);
        ctx.scale(camScale, camScale);
        ctx.translate(-totalBoardW / 2 + boardPadding, -totalBoardH / 2 + boardPadding);
        // Теперь (0,0) = grid cell (0,0) — идентично CanvasBoard

        drawFlyingArrow(ctx, fa, cellSize, skin);

        ctx.restore();
      }

      ctx.restore();

      animFrameRef.current = requestAnimationFrame(render);
    }

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [active, cellSize, gridSize.width, gridSize.height, skin, springScale, springX, springY, containerRef]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none z-50"
    />
  );
}

// ============================================
// DRAWING UTILS (без изменений)
// ============================================

function drawFlyingArrow(ctx: CanvasRenderingContext2D, fa: CapturedArrow, cellSize: number, skin: GameSkin) {
  const { arrow, progress } = fa;
  const easedProgress = skin.animation.flyEasing(progress);
  const flyDistance = cellSize * skin.animation.flyDistanceMultiplier * easedProgress;
  const opacity = 1 - easedProgress;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  drawArrow(ctx, arrow, cellSize, 0, skin, { isFlying: true, flyDistance });
  ctx.restore();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  arrow: Arrow,
  cellSize: number,
  offsetX: number,
  skin: GameSkin,
  flyState: { isFlying: boolean; flyDistance: number },
) {
  const dir = DIRECTIONS[arrow.direction];
  const half = cellSize / 2;
  const strokeWidth = cellSize * skin.geometry.bodyStrokeRatio;
  const headGap = cellSize * skin.geometry.headGapRatio;
  const isFlying = flyState.isFlying;
  const flyDistance = flyState.flyDistance;

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

  const geometricLength = Math.max(0, (arrow.cells.length - 1) * cellSize - headGap);

  if (points.length >= 2) {
    const buildPath = () => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      if (isFlying) {
        ctx.lineTo(
          points[points.length - 1].x + dir.dx * cellSize * 15,
          points[points.length - 1].y + dir.dy * cellSize * 15,
        );
      }
    };

    buildPath();
    if (isFlying) {
      ctx.setLineDash([geometricLength, 20000]);
      ctx.lineDashOffset = -flyDistance;
    }

    ctx.strokeStyle = skin.colors.outlineColor;
    ctx.lineWidth = strokeWidth + cellSize * skin.geometry.outlineExtraRatio;
    ctx.lineCap = skin.geometry.lineCap;
    ctx.lineJoin = skin.geometry.lineJoin;
    ctx.stroke();

    buildPath();
    ctx.strokeStyle = arrow.color;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const head = arrow.cells[0];
  let headX = head.x * cellSize + half + offsetX;
  let headY = head.y * cellSize + half;

  if (isFlying) {
    headX += dir.dx * flyDistance;
    headY += dir.dy * flyDistance;
  }

  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(dir.angle * (Math.PI / 180));

  ctx.beginPath();
  ctx.moveTo(-cellSize * skin.geometry.chevronLengthRatio, -cellSize * skin.geometry.chevronSpreadRatio);
  ctx.lineTo(0, 0);
  ctx.lineTo(-cellSize * skin.geometry.chevronLengthRatio, cellSize * skin.geometry.chevronSpreadRatio);
  ctx.strokeStyle = arrow.color;
  ctx.lineWidth = strokeWidth * skin.geometry.chevronStrokeMultiplier;
  ctx.lineCap = skin.geometry.lineCap;
  ctx.lineJoin = skin.geometry.lineJoin;
  ctx.stroke();
  ctx.restore();

  if (arrow.type !== 'normal') {
    ctx.font = `${cellSize * 0.5}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ARROW_EMOJIS[arrow.type], headX, headY);
  }
}