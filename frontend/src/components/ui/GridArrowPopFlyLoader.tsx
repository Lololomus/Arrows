import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ARROW_COLORS } from '../../config/constants';
import { useParticleRuntimeProfile } from './particleRuntimeProfile';

interface GridArrowPopFlyLoaderProps {
  size?: number;
  className?: string;
  ariaLabel?: string;
  showText?: boolean;
  text?: string;
  cycleMs?: number;
  colorPalette?: string[];
  withBackdrop?: boolean;
}

const DEFAULT_CYCLE_MS = 2400;
const FALLBACK_PALETTE = ['#00FF66', '#00C3FF', '#FF3366', '#FFCC00', '#9933FF', '#FF6600'];

function normalizePalette(input?: string[]): string[] {
  const base = input && input.length > 0 ? input : ARROW_COLORS;
  const unique = Array.from(new Set(base.filter(Boolean)));
  if (unique.length >= 4) return unique;
  return Array.from(new Set([...unique, ...FALLBACK_PALETTE]));
}

function randomFour(palette: string[], prev?: [string, string, string, string]): [string, string, string, string] {
  const shuffled = [...palette].sort(() => Math.random() - 0.5);
  const next: [string, string, string, string] = [
    shuffled[0] ?? FALLBACK_PALETTE[0],
    shuffled[1] ?? shuffled[0] ?? FALLBACK_PALETTE[1],
    shuffled[2] ?? shuffled[1] ?? FALLBACK_PALETTE[2],
    shuffled[3] ?? shuffled[2] ?? FALLBACK_PALETTE[3],
  ];
  if (prev && next.every((v, i) => v === prev[i])) {
    return [next[1], next[2], next[3], next[0]];
  }
  return next;
}

export function GridArrowPopFlyLoader({
  size = 84,
  className = '',
  ariaLabel = 'Loading',
  showText = false,
  text = 'Загрузка',
  cycleMs = DEFAULT_CYCLE_MS,
  colorPalette,
  withBackdrop = true,
}: GridArrowPopFlyLoaderProps) {
  const scope = `pop-fly-${useId().replace(/:/g, '')}`;
  const { isReducedMotion, isLowEnd, isPageVisible } = useParticleRuntimeProfile();
  const palette = useMemo(() => normalizePalette(colorPalette), [colorPalette]);
  const safeCycleMs = Math.max(1200, Math.round(cycleMs));
  const [colors, setColors] = useState<[string, string, string, string]>(() => randomFour(palette));
  const lastTickRef = useRef<number>(performance.now());

  const randomizeColors = useCallback(() => {
    if (!isPageVisible) return;
    setColors((prev) => randomFour(palette, prev));
    lastTickRef.current = performance.now();
  }, [isPageVisible, palette]);

  useEffect(() => {
    setColors((prev) => randomFour(palette, prev));
  }, [palette]);

  useEffect(() => {
    randomizeColors();
  }, [randomizeColors]);

  useEffect(() => {
    const fallbackTimer = window.setInterval(() => {
      if (!isPageVisible) return;
      const elapsed = performance.now() - lastTickRef.current;
      if (elapsed >= safeCycleMs * 1.35) {
        randomizeColors();
      }
    }, Math.max(300, Math.round(safeCycleMs * 0.6)));
    return () => window.clearInterval(fallbackTimer);
  }, [isPageVisible, safeCycleMs, randomizeColors]);

  const handleIteration = useCallback(() => {
    randomizeColors();
  }, [randomizeColors]);

  const vars = {
    ['--c1' as any]: colors[0],
    ['--c2' as any]: colors[1],
    ['--c3' as any]: colors[2],
    ['--c4' as any]: colors[3],
    ['--cycle' as any]: `${safeCycleMs}ms`,
  } as CSSProperties;

  const rootClass = [
    scope,
    'inline-flex items-center justify-center pointer-events-none',
    isReducedMotion ? 'reduced' : '',
    isLowEnd ? 'low-end' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      className={rootClass}
      style={vars}
      role="img"
      aria-label={ariaLabel}
    >
      <style>{`
        .${scope} .loader-container { display:flex; flex-direction:column; align-items:center; gap:30px; }
        .${scope} .grid-wrapper { width:${size}px; height:${size}px; position:relative; }
        .${scope} .grid-underlay {
          position:absolute;
          inset:-10%;
          border-radius:18px;
          background: rgba(15, 23, 42, 0.4);
          backdrop-filter: blur(3px);
          box-shadow: 0 6px 26px rgba(0,0,0,0.22);
          z-index:0;
        }
        .${scope} .loading-text {
          font-size: 15px;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: #6a7491;
          font-weight: 700;
          animation: pulse 1.5s ease-in-out infinite;
        }
        .${scope} .pop-svg {
          width:100%;
          height:100%;
          overflow:visible;
          position:relative;
          z-index:1;
          animation-play-state:${isPageVisible ? 'running' : 'paused'};
        }
        .${scope} .arrow { stroke-width:${isLowEnd ? 6 : 8}; stroke-linecap:round; stroke-linejoin:round; fill:none; }
        .${scope} .a1 { stroke: var(--c1); filter: drop-shadow(0 0 ${isLowEnd ? 2 : 6}px var(--c1)); transform-origin:80px 35px; animation: pop-fly-a1 var(--cycle) infinite ease-in-out; }
        .${scope} .a2 { stroke: var(--c2); filter: drop-shadow(0 0 ${isLowEnd ? 2 : 6}px var(--c2)); transform-origin:35px 20px; animation: pop-fly-a2 var(--cycle) infinite ease-in-out; }
        .${scope} .a3 { stroke: var(--c3); filter: drop-shadow(0 0 ${isLowEnd ? 2 : 6}px var(--c3)); transform-origin:20px 65px; animation: pop-fly-a3 var(--cycle) infinite ease-in-out; }
        .${scope} .a4 { stroke: var(--c4); filter: drop-shadow(0 0 ${isLowEnd ? 2 : 6}px var(--c4)); transform-origin:65px 80px; animation: pop-fly-a4 var(--cycle) infinite ease-in-out; }
        .${scope}.low-end .a1, .${scope}.low-end .a2, .${scope}.low-end .a3, .${scope}.low-end .a4 { filter:none; }
        .${scope}.reduced .a1, .${scope}.reduced .a2, .${scope}.reduced .a3, .${scope}.reduced .a4 { animation: soft-pulse var(--cycle) infinite ease-in-out; }
        .${scope}.reduced .a2 { animation-delay: calc(var(--cycle) * -0.12); }
        .${scope}.reduced .a3 { animation-delay: calc(var(--cycle) * -0.24); }
        .${scope}.reduced .a4 { animation-delay: calc(var(--cycle) * -0.36); }
        .${scope} .color-trigger { animation: sync-timer var(--cycle) infinite; animation-play-state:${isPageVisible ? 'running' : 'paused'}; }
        @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
        @keyframes sync-timer { from { opacity: 1; } to { opacity: 1; } }
        @keyframes pop-fly-a1 {
          0%        { transform: scale(0) translate(0, 0); opacity: 0; }
          7%        { transform: scale(1.3) translate(0, 0); opacity: 1; }
          15%, 20%  { transform: scale(1) translate(0, 0); opacity: 1; }
          27%       { transform: scale(1) translate(0, 8px); opacity: 1; }
          40%, 100% { transform: scale(1) translate(0, -150px); opacity: 0; }
        }
        @keyframes pop-fly-a2 {
          0%        { transform: scale(0) translate(0, 0); opacity: 0; }
          7%        { transform: scale(1.3) translate(0, 0); opacity: 1; }
          15%, 28%  { transform: scale(1) translate(0, 0); opacity: 1; }
          35%       { transform: scale(1) translate(-8px, 0); opacity: 1; }
          48%, 100% { transform: scale(1) translate(150px, 0); opacity: 0; }
        }
        @keyframes pop-fly-a3 {
          0%        { transform: scale(0) translate(0, 0); opacity: 0; }
          7%        { transform: scale(1.3) translate(0, 0); opacity: 1; }
          15%, 36%  { transform: scale(1) translate(0, 0); opacity: 1; }
          43%       { transform: scale(1) translate(0, 8px); opacity: 1; }
          56%, 100% { transform: scale(1) translate(0, -150px); opacity: 0; }
        }
        @keyframes pop-fly-a4 {
          0%        { transform: scale(0) translate(0, 0); opacity: 0; }
          7%        { transform: scale(1.3) translate(0, 0); opacity: 1; }
          15%, 44%  { transform: scale(1) translate(0, 0); opacity: 1; }
          51%       { transform: scale(1) translate(8px, 0); opacity: 1; }
          64%, 100% { transform: scale(1) translate(-150px, 0); opacity: 0; }
        }
        @keyframes soft-pulse {
          0%, 100% { opacity: 0.25; transform: scale(0.88) translate(0, 0); }
          50% { opacity: 0.95; transform: scale(1) translate(0, 0); }
        }
      `}</style>

      <div className="loader-container">
        <div className="grid-wrapper">
          {withBackdrop && <div aria-hidden="true" className="grid-underlay" />}
          <svg
            viewBox="0 0 100 100"
            className="pop-svg color-trigger"
            onAnimationIteration={handleIteration}
            aria-hidden="true"
            focusable="false"
          >
            <g fill="rgba(255,255,255,0.1)">
              <circle cx="20" cy="20" r="2.4" />
              <circle cx="50" cy="20" r="2.4" />
              <circle cx="80" cy="20" r="2.4" />
              <circle cx="20" cy="50" r="2.4" />
              <circle cx="50" cy="50" r="2.4" />
              <circle cx="80" cy="50" r="2.4" />
              <circle cx="20" cy="80" r="2.4" />
              <circle cx="50" cy="80" r="2.4" />
              <circle cx="80" cy="80" r="2.4" />
            </g>

            <g className="arrow a1">
              <path d="M 80 50 L 80 20" />
              <path d="M 72 28 L 80 20 L 88 28" />
            </g>
            <g className="arrow a2">
              <path d="M 20 20 L 50 20" />
              <path d="M 42 12 L 50 20 L 42 28" />
            </g>
            <g className="arrow a3">
              <path d="M 20 80 L 20 50" />
              <path d="M 12 58 L 20 50 L 28 58" />
            </g>
            <g className="arrow a4">
              <path d="M 80 80 L 50 80" />
              <path d="M 58 72 L 50 80 L 58 88" />
            </g>
          </svg>
        </div>

        {showText && <div className="loading-text">{text}</div>}
      </div>
    </div>
  );
}
