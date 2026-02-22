import React, { useEffect, useRef } from 'react';

interface StarParticlesProps {
  colorRGB?: string;
  count?: number;
  speed?: number;
  className?: string;
}

// ПРОДАКШЕН ОПТИМИЗАЦИЯ: Кэширование спрайтов по цвету.
// Чтобы не перерисовывать базовую звезду для каждого канваса на экране.
const spriteCache: Record<string, HTMLCanvasElement> = {};

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
  
  x!: number;
  y!: number;
  size!: number;
  speed!: number;
  pulsePhase!: number;
  pulseSpeed!: number;
  baseOpacity!: number;

  constructor(width: number, height: number, sprite: HTMLCanvasElement, baseSpeed: number) {
    this.width = width;
    this.height = height;
    this.sprite = sprite;
    this.baseSpeed = baseSpeed;
    this.reset(true);
  }

  reset(initial = false) {
    this.x = Math.random() * this.width;
    this.y = initial ? Math.random() * this.height : this.height + Math.random() * 20;
    
    const sizeRandomizer = Math.random();
    if (sizeRandomizer > 0.92) {
      this.size = Math.random() * 20 + 16;
      this.speed = this.baseSpeed * 1.8 + Math.random() * 0.5;
      this.baseOpacity = 0.6 + Math.random() * 0.4;
    } else if (sizeRandomizer > 0.6) {
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
  ctx: CanvasRenderingContext2D;
  particles: StarParticle[] = [];
  sprite: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, count: number, colorRGB: string, speed: number) {
    this.canvas = canvas;
    // Обязательно указываем alpha: true для прозрачного фона
    this.ctx = canvas.getContext('2d', { alpha: true }) as CanvasRenderingContext2D;
    this.sprite = getOrCreateStarSprite(colorRGB);
    
    this.resize();
    for (let i = 0; i < count; i++) {
      this.particles.push(new StarParticle(this.canvas.width, this.canvas.height, this.sprite, speed));
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    // Учитываем devicePixelRatio для четкости на Retina дисплеях
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
  }

  render() {
    // Используем размеры элемента, а не канваса, так как мы сделали scale(dpr)
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
    for (let p of this.particles) {
      p.update(rect.width, rect.height);
      p.draw(this.ctx);
    }
  }
}

export function StarParticles({ 
  colorRGB = '255, 255, 255', 
  count = 40, 
  speed = 0.2, 
  className = '' 
}: StarParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const system = new CanvasSystem(canvasRef.current, count, colorRGB, speed);
    let animationFrameId: number;
    let isVisible = !document.hidden;

    const renderLoop = () => {
      if (isVisible) {
        system.render();
      }
      animationFrameId = requestAnimationFrame(renderLoop);
    };
    renderLoop();

    const handleResize = () => system.resize();
    const handleVisibilityChange = () => {
      isVisible = !document.hidden;
    };
    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [colorRGB, count, speed]);

  return (
    <canvas 
      ref={canvasRef} 
      className={`absolute inset-0 w-full h-full pointer-events-none ${className}`} 
      style={{ mixBlendMode: 'screen' }}
    />
  );
}
