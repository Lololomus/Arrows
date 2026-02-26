/**
 * Arrow Puzzle — Victory Visual Effects
 *
 * Три уровня абстрактных эффектов для экрана победы:
 * - EasyFX:   мягкое radial дыхание + поднимающиеся пылинки
 * - NormalFX: вращающийся conic-gradient + искры-взрыв
 * - HardFX:   шоквейв-кольцо, гиперлучи, plasma morph-блобы
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { DifficultyTier } from './difficultyConfig';

// ============================================
// SHARED PROPS
// ============================================

interface FXProps {
  primary: string;
  secondary: string;
}

// ============================================
// EASY — дыхание + пылинки
// ============================================

function EasyFX({ primary, secondary }: FXProps) {
  return (
    <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
      <motion.div
        className="absolute w-[400px] h-[400px] rounded-full"
        style={{
          background: `radial-gradient(circle, ${primary}40 0%, transparent 60%)`,
        }}
        animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />
      {Array.from({ length: 10 }).map((_, i) => (
        <motion.div
          key={`dust-${i}`}
          className="absolute rounded-full blur-[1px]"
          style={{
            backgroundColor: secondary,
            width: Math.random() * 4 + 2,
            height: Math.random() * 4 + 2,
          }}
          initial={{ y: 50, x: (Math.random() - 0.5) * 200, opacity: 0 }}
          animate={{ y: -150, opacity: [0, 0.8, 0] }}
          transition={{
            duration: 3 + Math.random() * 2,
            repeat: Infinity,
            delay: Math.random() * 3,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

// ============================================
// NORMAL — conic вращение + искры
// ============================================

function MediumFX({ primary, secondary }: FXProps) {
  const sparks = useMemo(
    () =>
      Array.from({ length: 20 }).map(() => ({
        angle: Math.random() * Math.PI * 2,
        distance: 100 + Math.random() * 150,
        size: Math.random() * 4 + 3,
        delay: Math.random() * 0.3,
      })),
    [],
  );

  return (
    <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
        className="absolute w-[400px] h-[400px] rounded-full"
        style={{
          background: `repeating-conic-gradient(from 0deg, transparent 0deg 15deg, ${primary}40 15deg 30deg)`,
          WebkitMaskImage:
            'radial-gradient(circle, black 20%, transparent 70%)',
          maskImage: 'radial-gradient(circle, black 20%, transparent 70%)',
        }}
      />
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
        className="absolute w-[250px] h-[250px] rounded-full blur-md"
        style={{
          background: `repeating-conic-gradient(from 10deg, transparent 0deg 20deg, ${secondary}60 20deg 40deg)`,
          WebkitMaskImage:
            'radial-gradient(circle, black 10%, transparent 60%)',
          maskImage: 'radial-gradient(circle, black 10%, transparent 60%)',
        }}
      />
      {sparks.map((spark, i) => (
        <motion.div
          key={`mid-spark-${i}`}
          className="absolute rounded-full"
          style={{
            backgroundColor: secondary,
            width: spark.size,
            height: spark.size,
            boxShadow: `0 0 10px ${primary}`,
          }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0 }}
          animate={{
            x: Math.cos(spark.angle) * spark.distance,
            y: Math.sin(spark.angle) * spark.distance,
            opacity: 0,
            scale: 1,
          }}
          transition={{
            duration: 1.5,
            delay: spark.delay,
            ease: 'easeOut',
          }}
        />
      ))}
    </div>
  );
}

// ============================================
// HARD — шоквейв + лучи + plasma blobs
// ============================================

function HardFX({ primary, secondary }: FXProps) {
  const hyperRays = useMemo(
    () =>
      Array.from({ length: 24 }).map(() => ({
        angle: Math.random() * 360,
        length: 60 + Math.random() * 120,
        delay: Math.random() * 0.15,
      })),
    [],
  );

  const plasmaEmbers = useMemo(
    () =>
      Array.from({ length: 30 }).map(() => ({
        angle: Math.random() * Math.PI * 2,
        distance: 150 + Math.random() * 200,
        size: Math.random() * 6 + 2,
        duration: 3 + Math.random() * 4,
        delay: Math.random() * 5,
      })),
    [],
  );

  void plasmaEmbers; // reserved for future particle layer

  return (
    <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
      {/* Expanding shockwave ring */}
      <motion.div
        className="absolute rounded-full border-[6px]"
        style={{
          borderColor: secondary,
          boxShadow: `0 0 40px ${primary}, inset 0 0 40px ${primary}`,
        }}
        initial={{ width: 0, height: 0, opacity: 1 }}
        animate={{ width: 800, height: 800, opacity: 0, borderWidth: 0 }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />

      {/* Hyper rays */}
      {hyperRays.map((ray, i) => (
        <div
          key={`ray-${i}`}
          className="absolute"
          style={{ transform: `rotate(${ray.angle}deg)` }}
        >
          <motion.div
            className="absolute rounded-full opacity-80"
            style={{
              backgroundColor: i % 2 === 0 ? primary : secondary,
              width: ray.length,
              height: 4,
              boxShadow: `0 0 12px ${primary}`,
            }}
            initial={{ x: 0, opacity: 0 }}
            animate={{ x: 500, opacity: [0, 1, 0] }}
            transition={{ duration: 0.7, delay: ray.delay, ease: 'easeOut' }}
          />
        </div>
      ))}

      {/* Outer glow pulse */}
      <motion.div
        className="absolute w-[500px] h-[500px] rounded-full mix-blend-screen"
        style={{
          background: `radial-gradient(circle, ${primary}50 0%, transparent 65%)`,
        }}
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{
          opacity: [0.6, 0.9, 0.6],
          scale: [0.9, 1.1, 0.9],
        }}
        transition={{
          scale: { duration: 5, repeat: Infinity, ease: 'easeInOut' },
          opacity: {
            duration: 4,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: 1,
          },
        }}
      />

      {/* Primary plasma blob */}
      <motion.div
        className="absolute w-[350px] h-[350px] blur-[50px] mix-blend-screen"
        style={{ backgroundColor: primary, opacity: 0.7 }}
        initial={{ opacity: 0 }}
        animate={{
          opacity: 0.7,
          rotate: [0, 360],
          borderRadius: [
            '40% 60% 70% 30% / 40% 50% 60% 50%',
            '60% 40% 30% 70% / 50% 60% 40% 50%',
            '40% 60% 70% 30% / 40% 50% 60% 50%',
          ],
          scale: [1, 1.1, 1],
        }}
        transition={{
          opacity: { duration: 1 },
          rotate: { duration: 20, repeat: Infinity, ease: 'linear' },
          borderRadius: { duration: 12, repeat: Infinity, ease: 'easeInOut' },
          scale: { duration: 7, repeat: Infinity, ease: 'easeInOut' },
        }}
      />

      {/* Secondary plasma blob */}
      <motion.div
        className="absolute w-[280px] h-[280px] blur-[40px] mix-blend-screen"
        style={{ backgroundColor: secondary, opacity: 0.6 }}
        initial={{ opacity: 0 }}
        animate={{
          opacity: 0.6,
          rotate: [360, 0],
          borderRadius: [
            '50% 50% 60% 40% / 60% 40% 50% 50%',
            '40% 60% 50% 50% / 40% 60% 50% 50%',
            '50% 50% 60% 40% / 60% 40% 50% 50%',
          ],
          scale: [1.1, 0.9, 1.1],
        }}
        transition={{
          opacity: { duration: 1.5 },
          rotate: { duration: 15, repeat: Infinity, ease: 'linear' },
          borderRadius: { duration: 9, repeat: Infinity, ease: 'easeInOut' },
          scale: { duration: 5, repeat: Infinity, ease: 'easeInOut' },
        }}
      />
    </div>
  );
}

// ============================================
// EXPORT — фабрика по tier
// ============================================

export function VictoryFX({
  tier,
  primary,
  secondary,
}: FXProps & { tier: DifficultyTier }) {
  switch (tier) {
    case 'easy':
      return <EasyFX primary={primary} secondary={secondary} />;
    case 'normal':
      return <MediumFX primary={primary} secondary={secondary} />;
    case 'hard':
      return <HardFX primary={primary} secondary={secondary} />;
    case 'extreme':
      return <HardFX primary={primary} secondary={secondary} />;
  }
}
