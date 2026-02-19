/**
 * Arrow Puzzle — Classic Skin
 * 
 * Базовый скин. Точное воспроизведение всех текущих захардкоженных значений.
 * Строгий стиль: чистые линии, без частиц и trail, простой easeIn.
 * 
 * Бесплатный, разблокирован по умолчанию у всех.
 */

import type { GameSkin } from './types';

// ============================================
// EASING FUNCTIONS
// ============================================

/** Квадратичное ускорение (t²). Текущий стандарт для вылета. */
const easeIn = (t: number) => t * t;

// ============================================
// CLASSIC SKIN
// ============================================

export const ClassicSkin: GameSkin = {
  id: 'classic',
  name: 'Классический',
  description: 'Строгий минимализм. Чистые линии, без лишних эффектов.',
  price: 0,
  icon: '🎯',

  geometry: {
    bodyStrokeRatio: 0.20,
    outlineExtraRatio: 0.08,
    headGapRatio: 0.25,
    chevronLengthRatio: 0.45,
    chevronSpreadRatio: 0.25,
    chevronStrokeMultiplier: 1.2,
    lineCap: 'round',
    lineJoin: 'round',
    gridDotRadius: 0.08,
  },

  colors: {
    arrowColors: [
      '#FF3B30', // Красный
      '#FF9500', // Оранжевый
      '#FFCC00', // Жёлтый
      '#34C759', // Зелёный
      '#007AFF', // Синий
      '#AF52DE', // Фиолетовый
      '#FF2D55', // Розовый
      '#5856D6', // Индиго
      '#00C7BE', // Бирюзовый
    ],
    outlineColor: '#FFFFFF',
    hintColor: '#FFD700',
    gridDotColor: 'rgba(255,255,255,0.1)',
  },

  animation: {
    flyEasing: easeIn,
    flyDuration: 400,
    flyDistanceMultiplier: 10,
    shakeDuration: 300,
    shakeAmplitude: 4,
    shakeFrequency: 5,
    hintGlowSpeed: 2,
    hintGlowAlpha: 0.3,
    hintGlowBlurRatio: 0.5,
    hintGlowStrokeMultiplier: 1.5,
  },

  effects: {
    enableTrail: false,
    enableFlyParticles: false,
    flyParticleCount: 0,
    enableAppearParticles: false,
    enableAppearAnimation: false,
    appearStaggerDelay: 20,
    appearDuration: 200,
  },
};