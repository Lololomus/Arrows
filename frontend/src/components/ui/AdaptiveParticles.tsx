import { useMemo } from 'react';
import { StarParticles } from './StarParticles';
import { useParticleRuntimeProfile } from './particleRuntimeProfile';

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

export function AdaptiveParticles({
  variant,
  tone = 'neutral',
  className = '',
  enabled = true,
  baseCount,
  baseSpeed,
}: AdaptiveParticlesProps) {
  const { isReducedMotion, isLowEnd, isPageVisible } = useParticleRuntimeProfile();

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
      running={isPageVisible}
      className={className}
    />
  );
}
