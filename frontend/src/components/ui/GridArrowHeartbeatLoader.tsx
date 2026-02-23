import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ARROW_COLORS } from '../../config/constants';

interface GridArrowHeartbeatLoaderProps {
  size?: number;
  className?: string;
  ariaLabel?: string;
}

const CYCLE_DURATION_SECONDS = 1.9;

const STATES = [
  { x: 65, y: 65, rotate: -90 }, // 1: bottom-right, up
  { x: 65, y: 31, rotate: 180 }, // 2: top-right, left
  { x: 31, y: 31, rotate: 90 },  // 3: top-left, down
  { x: 31, y: 65, rotate: 0 },   // 4: bottom-left, right
] as const;

function pickRandomArrowColor(current?: string): string {
  if (ARROW_COLORS.length <= 1) return ARROW_COLORS[0] ?? '#34C759';
  let next = current ?? '';
  while (next === current) {
    next = ARROW_COLORS[Math.floor(Math.random() * ARROW_COLORS.length)];
  }
  return next;
}

export function GridArrowHeartbeatLoader({
  size = 84,
  className = '',
  ariaLabel = 'Loading',
}: GridArrowHeartbeatLoaderProps) {
  const [arrowColor, setArrowColor] = useState<string>(() => pickRandomArrowColor());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setArrowColor(prev => pickRandomArrowColor(prev));
    }, CYCLE_DURATION_SECONDS * 1000);
    return () => window.clearInterval(interval);
  }, []);

  const keyframes = useMemo(() => {
    const looped = [...STATES, STATES[0]];
    return {
      x: [
        looped[0].x, looped[0].x,
        looped[1].x, looped[1].x,
        looped[2].x, looped[2].x,
        looped[3].x, looped[3].x,
        looped[4].x,
      ],
      y: [
        looped[0].y, looped[0].y,
        looped[1].y, looped[1].y,
        looped[2].y, looped[2].y,
        looped[3].y, looped[3].y,
        looped[4].y,
      ],
      rotate: [
        looped[0].rotate, looped[0].rotate,
        looped[1].rotate, looped[1].rotate,
        looped[2].rotate, looped[2].rotate,
        looped[3].rotate, looped[3].rotate,
        looped[4].rotate,
      ],
    };
  }, []);

  return (
    <div
      className={`inline-flex items-center justify-center ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      <motion.svg
        width={size}
        height={size}
        viewBox="0 0 96 96"
        initial={false}
      >
        <rect
          x="14"
          y="14"
          width="68"
          height="68"
          rx="10"
          fill="rgba(15, 23, 42, 0.7)"
          stroke="rgba(255, 255, 255, 0.18)"
          strokeWidth="2"
        />
        <line
          x1="48"
          y1="14"
          x2="48"
          y2="82"
          stroke="rgba(255, 255, 255, 0.16)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="14"
          y1="48"
          x2="82"
          y2="48"
          stroke="rgba(255, 255, 255, 0.16)"
          strokeWidth="2"
          strokeLinecap="round"
        />

        <motion.g
          initial={{ x: STATES[0].x, y: STATES[0].y, rotate: STATES[0].rotate }}
          animate={keyframes}
          transition={{
            duration: CYCLE_DURATION_SECONDS,
            repeat: Infinity,
            times: [0, 0.12, 0.26, 0.38, 0.52, 0.64, 0.78, 0.9, 1],
            ease: [
              'linear',
              [0.22, 1, 0.36, 1],
              'linear',
              [0.22, 1, 0.36, 1],
              'linear',
              [0.22, 1, 0.36, 1],
              'linear',
              [0.22, 1, 0.36, 1],
            ],
          }}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        >
          <circle cx="0" cy="0" r="12" fill={arrowColor} fillOpacity="0.16" />
          <path
            d="M -11 0 L 8 0 M 8 0 L 2 -6 M 8 0 L 2 6"
            stroke="rgba(255,255,255,0.95)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M -11 0 L 8 0 M 8 0 L 2 -6 M 8 0 L 2 6"
            stroke={arrowColor}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.g>
      </motion.svg>
    </div>
  );
}
