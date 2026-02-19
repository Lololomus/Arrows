/**
 * Arrow Puzzle — Skin System Types
 * 
 * Единственный источник правды для ВСЕЙ визуальной конфигурации.
 * Рендереры (GameBoard/CanvasBoard) читают скин и не содержат
 * ни одного захардкоженного визуального значения.
 * 
 * SCOPE: Только normal стрелки. Спецстрелки (bomb/ice/electric) 
 * будут добавлены позже через расширение интерфейсов.
 */

// ============================================
// GEOMETRY — пропорции стрелки (доля от cellSize)
// ============================================

export interface ArrowGeometry {
  /** Толщина тела стрелки. Classic: 0.20 */
  bodyStrokeRatio: number;

  /** Толщина обводки = bodyStroke + cellSize * outlineExtra. Classic: 0.08 */
  outlineExtraRatio: number;

  /** Отступ тела от головы (чтобы линия не залезала под шеврон). Classic: 0.25 */
  headGapRatio: number;

  /** Шеврон: длина усов назад от кончика. Classic: 0.45 */
  chevronLengthRatio: number;

  /** Шеврон: ширина раскрытия (от центра вверх/вниз). Classic: 0.25 */
  chevronSpreadRatio: number;

  /** Множитель толщины линии шеврона относительно bodyStroke. Classic: 1.2 */
  chevronStrokeMultiplier: number;

  /** LineCap: 'round' | 'butt' | 'square'. Classic: 'round' */
  lineCap: CanvasLineCap;

  /** LineJoin: 'round' | 'bevel' | 'miter'. Classic: 'round' */
  lineJoin: CanvasLineJoin;

  /** Радиус точки сетки (доля от cellSize). Classic: 0.08 */
  gridDotRadius: number;
}

// ============================================
// COLORS — палитра
// ============================================

export interface SkinColorPalette {
  /** Пул цветов стрелок (назначаются при генерации уровня). Classic: 9 цветов iOS */
  arrowColors: string[];

  /** Цвет белой обводки. Classic: '#FFFFFF' */
  outlineColor: string;

  /** Цвет подсветки хинта. Classic: '#FFD700' */
  hintColor: string;

  /** Цвет точек сетки (пустых ячеек). Classic: 'rgba(255,255,255,0.1)' */
  gridDotColor: string;
}

// ============================================
// ANIMATIONS — тайминги и функции
// ============================================

/** Тип easing-функции: принимает t (0→1), возвращает прогресс */
export type EasingFn = (t: number) => number;

export interface AnimationConfig {
  /** Easing вылета стрелки. Classic: easeIn (t² ) */
  flyEasing: EasingFn;

  /** Длительность вылета (ms). Classic: 400 */
  flyDuration: number;

  /** Расстояние вылета (множитель cellSize). Classic: 10 */
  flyDistanceMultiplier: number;

  /** Длительность shake при ошибке (ms). Classic: 300 */
  shakeDuration: number;

  /** Амплитуда shake (px). Classic: 4 */
  shakeAmplitude: number;

  /** Частота shake (количество полных колебаний за shakeDuration). Classic: 5 */
  shakeFrequency: number;

  /** Скорость пульсации хинта (cycles per second). Classic: 2 */
  hintGlowSpeed: number;

  /** Максимальная alpha хинт-glow. Classic: 0.3 */
  hintGlowAlpha: number;

  /** Blur хинт-glow (множитель cellSize). Classic: 0.5 */
  hintGlowBlurRatio: number;

  /** Толщина хинт-glow линии (множитель bodyStroke). Classic: 1.5 */
  hintGlowStrokeMultiplier: number;
}

// ============================================
// EFFECTS — флаги визуальных эффектов
// ============================================

export interface EffectsConfig {
  /** Показывать trail (шлейф) за вылетающей стрелкой */
  enableTrail: boolean;

  /** Показывать particles при вылете */
  enableFlyParticles: boolean;

  /** Количество частиц при вылете. Default: 0 (disabled) */
  flyParticleCount: number;

  /** Показывать particles при появлении стрелки (загрузка уровня) */
  enableAppearParticles: boolean;

  /** Каскадное появление стрелок при загрузке (scale 0→1 с delay) */
  enableAppearAnimation: boolean;

  /** Задержка между появлением стрелок (ms). Default: 20 */
  appearStaggerDelay: number;

  /** Длительность анимации появления (ms). Default: 200 */
  appearDuration: number;
}

// ============================================
// GAME SKIN — главный интерфейс
// ============================================

export interface GameSkin {
  /** Уникальный ID скина (для store/shop). Пример: 'classic', 'neon', 'pastel' */
  id: string;

  /** Отображаемое название. Пример: 'Классический' */
  name: string;

  /** Краткое описание для магазина */
  description: string;

  /** Цена в монетах (0 = бесплатный) */
  price: number;

  /** Иконка/превью (URL или emoji) */
  icon: string;

  geometry: ArrowGeometry;
  colors: SkinColorPalette;
  animation: AnimationConfig;
  effects: EffectsConfig;
}

// ============================================
// SKIN REGISTRY — реестр всех скинов
// ============================================

/** Карта всех зарегистрированных скинов */
export type SkinRegistry = Record<string, GameSkin>;