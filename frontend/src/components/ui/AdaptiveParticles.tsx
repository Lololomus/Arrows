import { useEffect, useMemo, useState } from 'react';
import { StarParticles } from './StarParticles';

export type ParticleVariant = 'bg' | 'accent' | 'hero';
export type ParticleTone = 'neutral' | 'blue' | 'violet' | 'gold' | 'cyan' | 'green';

interface AdaptiveParticlesProps {
  variant: ParticleVariant;
  tone?: ParticleTone;
  className?: string;
  enabled?: boolean;
  baseCount?: number;
  baseSpeed?: number;
}

const VARIANT_DEFAULTS: Record<ParticleVariant, { count: number; speed: number }> = {
  bg: { count: 18, speed: 0.09 },
  accent: { count: 14, speed: 0.16 },
  hero: { count: 12, speed: 0.14 },
};

const TONE_RGB: Record<ParticleTone, string> = {
  neutral: '255, 255, 255',
  blue: '96, 165, 250',
  violet: '196, 181, 253',
  gold: '250, 204, 21',
  cyan: '34, 211, 238',
  green: '74, 222, 128',
};

function useReducedMotion() {
  const [isReduced, setIsReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setIsReduced(mediaQuery.matches);
    sync();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', sync);
      return () => mediaQuery.removeEventListener('change', sync);
    }

    if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(sync);
      return () => mediaQuery.removeListener(sync);
    }
  }, []);

  return isReduced;
}

function useLowEndProfile() {
  const [isLowEnd, setIsLowEnd] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const sync = () => {
      const hardwareConcurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 8 : 8;
      const dpr = window.devicePixelRatio || 1;
      setIsLowEnd(hardwareConcurrency <= 4 || dpr > 2.5);
    };

    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  return isLowEnd;
}

export function AdaptiveParticles({
  variant,
  tone = 'neutral',
  className = '',
  enabled = true,
  baseCount,
  baseSpeed,
}: AdaptiveParticlesProps) {
  const isReducedMotion = useReducedMotion();
  const isLowEnd = useLowEndProfile();

  const shouldRender = enabled && (!isReducedMotion || variant === 'bg');

  const { count, speed } = useMemo(() => {
    const defaults = VARIANT_DEFAULTS[variant];
    const rawCount = baseCount ?? defaults.count;
    const rawSpeed = baseSpeed ?? defaults.speed;

    if (isReducedMotion && variant === 'bg') {
      return {
        count: Math.min(rawCount, 8),
        speed: Math.min(rawSpeed, 0.06),
      };
    }

    if (isLowEnd) {
      return {
        count: Math.max(6, Math.round(rawCount * 0.55)),
        speed: Number((rawSpeed * 0.85).toFixed(3)),
      };
    }

    return { count: rawCount, speed: rawSpeed };
  }, [variant, baseCount, baseSpeed, isReducedMotion, isLowEnd]);

  if (!shouldRender) return null;

  return (
    <StarParticles
      colorRGB={TONE_RGB[tone]}
      count={count}
      speed={speed}
      className={className}
    />
  );
}
