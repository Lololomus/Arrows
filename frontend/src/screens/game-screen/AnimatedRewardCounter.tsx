/**
 * Arrow Puzzle — Animated Reward Counter
 *
 * Анимированный счётчик монет на экране победы.
 * rAF-based, easeOut(t⁴), с финальным pulse через framer-motion.
 * (ДОБАВЛЕНО: onDone callback для синхронизации с итоговым балансом)
 */

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface AnimatedRewardCounterProps {
  reward: number;
  /** Задержка перед началом счёта (секунды) */
  delaySec?: number;
  /** Коллбэк, вызываемый по завершении анимации накрутки */
  onDone?: () => void;
}

export function AnimatedRewardCounter({
  reward,
  delaySec = 0.6,
  onDone,
}: AnimatedRewardCounterProps) {
  const [count, setCount] = useState(0);
  const [isDone, setIsDone] = useState(false);
  const onDoneRef = useRef(onDone);

  // Обновляем реф без перезапуска эффекта
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let start: number | null = null;
    let frameId: number;
    const durationSec = 1.2;

    const animate = (timestamp: number) => {
      if (!start) start = timestamp;
      const progressSec = (timestamp - start) / 1000;

      if (progressSec < delaySec) {
        frameId = requestAnimationFrame(animate);
        return;
      }

      const activeProgress = Math.min((progressSec - delaySec) / durationSec, 1);
      const easeOut = 1 - Math.pow(1 - activeProgress, 4);

      setCount(Math.floor(easeOut * reward));

      if (activeProgress < 1) {
        frameId = requestAnimationFrame(animate);
      } else {
        setIsDone(true);
        // Сигнализируем об окончании счета
        onDoneRef.current?.();
      }
    };

    setIsDone(false);
    setCount(0);
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [reward, delaySec]);

  return (
    <motion.span
      animate={
        isDone
          ? {
              scale: [1, 1.25, 1],
              textShadow: [
                '0 0 0px rgba(250,204,21,0)',
                '0 0 25px rgba(250,204,21,1)',
                '0 0 5px rgba(250,204,21,0.5)',
              ],
            }
          : {}
      }
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="inline-block origin-left"
    >
      {count}
    </motion.span>
  );
}