import { useCallback, useEffect, useRef } from 'react';

export type StarSizeTier = 'small' | 'medium' | 'large';
export interface StarSizeProfile {
  small: number;
  medium: number;
  large: number;
}

interface StarParticlesProps {
  colorRGB?: string;
  count?: number;
  speed?: number;
  className?: string;
  running?: boolean;
  sizeProfile?: StarSizeProfile;
}

const spriteCache: Record<string, HTMLCanvasElement> = {};
const DEFAULT_SIZE_PROFILE: StarSizeProfile = { small: 0.6, medium: 0.32, large: 0.08 };

function normalizeSizeProfile(profile?: StarSizeProfile): StarSizeProfile {
  const source = profile ?? DEFAULT_SIZE_PROFILE;
  const small = Math.max(0, source.small);
  const medium = Math.max(0, source.medium);
  const large = Math.max(0, source.large);
  const total = small + medium + large;

  if (total <= 0) return DEFAULT_SIZE_PROFILE;

  return {
    small: small / total,
    medium: medium / total,
    large: large / total,
  };
}

function buildTierSequence(count: number, profile?: StarSizeProfile): StarSizeTier[] {
  const normalized = normalizeSizeProfile(profile);
  const tierWeights: Array<{ tier: StarSizeTier; weight: number }> = [
    { tier: 'small', weight: normalized.small },
    { tier: 'medium', weight: normalized.medium },
    { tier: 'large', weight: normalized.large },
  ];

  const rawCounts = tierWeights.map((item) => item.weight * count);
  const floorCounts = rawCounts.map((value) => Math.floor(value));
  let assigned = floorCounts[0] + floorCounts[1] + floorCounts[2];
  let remainder = Math.max(0, count - assigned);

  if (remainder > 0) {
    const rankedByFraction = rawCounts
      .map((value, index) => ({ index, fraction: value - floorCounts[index] }))
      .sort((a, b) => b.fraction - a.fraction);

    let pointer = 0;
    while (remainder > 0) {
      floorCounts[rankedByFraction[pointer].index] += 1;
      remainder -= 1;
      pointer = (pointer + 1) % rankedByFraction.length;
    }
  }

  const tiers: StarSizeTier[] = [];
  for (let i = 0; i < floorCounts[0]; i++) tiers.push('small');
  for (let i = 0; i < floorCounts[1]; i++) tiers.push('medium');
  for (let i = 0; i < floorCounts[2]; i++) tiers.push('large');

  for (let i = tiers.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiers[i], tiers[j]] = [tiers[j], tiers[i]];
  }

  return tiers;
}

function getOrCreateStarSprite(colorRGB: string): HTMLCanvasElement {
  if (spriteCache[colorRGB]) {
    return spriteCache[colorRGB];
  }

  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (!ctx) return canvas;

  const center = size / 2;
  ctx.beginPath();
  ctx.moveTo(center, 0);
  ctx.quadraticCurveTo(center, center, size, center);
  ctx.quadraticCurveTo(center, center, center, size);
  ctx.quadraticCurveTo(center, center, 0, center);
  ctx.quadraticCurveTo(center, center, center, 0);

  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.3, `rgba(${colorRGB}, 0.8)`);
  gradient.addColorStop(1, `rgba(${colorRGB}, 0)`);

  ctx.fillStyle = gradient;
  ctx.fill();

  spriteCache[colorRGB] = canvas;
  return canvas;
}

class StarParticle {
  width: number;
  height: number;
  sprite: HTMLCanvasElement;
  baseSpeed: number;
  sizeTier: StarSizeTier;

  x!: number;
  y!: number;
  size!: number;
  speed!: number;
  pulsePhase!: number;
  pulseSpeed!: number;
  baseOpacity!: number;

  constructor(width: number, height: number, sprite: HTMLCanvasElement, baseSpeed: number, sizeTier: StarSizeTier) {
    this.width = width;
    this.height = height;
    this.sprite = sprite;
    this.baseSpeed = baseSpeed;
    this.sizeTier = sizeTier;
    this.reset(true);
  }

  reset(initial = false) {
    this.x = Math.random() * this.width;
    this.y = initial ? Math.random() * this.height : this.height + Math.random() * 20;

    if (this.sizeTier === 'large') {
      this.size = Math.random() * 20 + 16;
      this.speed = this.baseSpeed * 1.8 + Math.random() * 0.5;
      this.baseOpacity = 0.6 + Math.random() * 0.4;
    } else if (this.sizeTier === 'medium') {
      this.size = Math.random() * 10 + 6;
      this.speed = this.baseSpeed * 1.2 + Math.random() * 0.3;
      this.baseOpacity = 0.4 + Math.random() * 0.4;
    } else {
      this.size = Math.random() * 3 + 2;
      this.speed = this.baseSpeed * 0.5 + Math.random() * 0.2;
      this.baseOpacity = 0.15 + Math.random() * 0.3;
    }

    this.pulsePhase = Math.random() * Math.PI * 2;
    this.pulseSpeed = 0.01 + Math.random() * 0.03;
  }

  update(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.y -= this.speed;
    this.x += Math.sin(this.y * 0.02) * 0.2;
    this.pulsePhase += this.pulseSpeed;

    if (this.y < -40) this.reset();
  }

  draw(ctx: CanvasRenderingContext2D) {
    const currentOpacity = this.baseOpacity * (0.5 + 0.5 * Math.sin(this.pulsePhase));
    ctx.globalAlpha = Math.max(0.05, currentOpacity);
    ctx.drawImage(this.sprite, this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
    ctx.globalAlpha = 1.0;
  }
}

class CanvasSystem {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  particles: StarParticle[] = [];
  sprite: HTMLCanvasElement;
  logicalWidth = 0;
  logicalHeight = 0;
  dpr = 1;

  constructor(canvas: HTMLCanvasElement, count: number, colorRGB: string, speed: number, sizeProfile?: StarSizeProfile) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.sprite = getOrCreateStarSprite(colorRGB);

    this.resize();
    const tiers = buildTierSequence(count, sizeProfile);
    for (let i = 0; i < count; i++) {
      this.particles.push(new StarParticle(this.logicalWidth, this.logicalHeight, this.sprite, speed, tiers[i] ?? 'small'));
    }
  }

  resize() {
    if (!this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    this.logicalWidth = rect.width;
    this.logicalHeight = rect.height;
    this.dpr = window.devicePixelRatio || 1;

    this.canvas.width = Math.max(1, Math.round(this.logicalWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.logicalHeight * this.dpr));

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);
  }

  render() {
    if (!this.ctx || this.logicalWidth <= 0 || this.logicalHeight <= 0) return;

    this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
    for (const particle of this.particles) {
      particle.update(this.logicalWidth, this.logicalHeight);
      particle.draw(this.ctx);
    }
  }
}

export function StarParticles({
  colorRGB = '255, 255, 255',
  count = 40,
  speed = 0.2,
  className = '',
  running = true,
  sizeProfile,
}: StarParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const systemRef = useRef<CanvasSystem | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const loopRef = useRef<() => void>(() => {});

  const stopLoop = useCallback(() => {
    if (animationFrameIdRef.current !== null) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
  }, []);

  const startLoop = useCallback(() => {
    if (animationFrameIdRef.current !== null || !systemRef.current) return;
    animationFrameIdRef.current = requestAnimationFrame(loopRef.current);
  }, []);

  loopRef.current = () => {
    if (!systemRef.current) {
      animationFrameIdRef.current = null;
      return;
    }

    systemRef.current.render();
    animationFrameIdRef.current = requestAnimationFrame(loopRef.current);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const system = new CanvasSystem(canvas, count, colorRGB, speed, sizeProfile);
    systemRef.current = system;

    let resizeObserver: ResizeObserver | null = null;
    const handleWindowResize = () => system.resize();

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        system.resize();
      });
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener('resize', handleWindowResize);
    }

    if (running) {
      startLoop();
    }

    return () => {
      stopLoop();
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', handleWindowResize);
      }
      systemRef.current = null;
    };
  }, [colorRGB, count, speed, sizeProfile, startLoop, stopLoop]);

  useEffect(() => {
    if (running) {
      startLoop();
    } else {
      stopLoop();
    }
  }, [running, startLoop, stopLoop]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
      style={{ mixBlendMode: 'screen' }}
    />
  );
}
