import { useEffect } from 'react';
import { motion, useAnimation } from 'framer-motion';
import { useGameStore } from '../../stores/store';

export function ErrorVignette() {
  const shakingArrowId = useGameStore(s => s.shakingArrowId);
  const controls = useAnimation();

  useEffect(() => {
    if (shakingArrowId) {
      // Запускаем одноразовый всплеск
      controls.start({
        opacity: [0, 1, 0], // Старт с 0, резкий прыжок в 1, плавный спад в 0
        transition: { 
          duration: 0.6, 
          times: [0, 0.15, 1], // Пик яркости достигается на 15% времени анимации
          ease: 'easeOut' 
        }
      });
    }
  }, [shakingArrowId, controls]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={controls}
      className="fixed inset-0 z-50 pointer-events-none"
      style={{
        boxShadow: 'inset 0 0 150px rgba(255, 59, 48, 0.5)',
        backgroundColor: 'rgba(255, 59, 48, 0.15)',
        mixBlendMode: 'multiply'
      }}
    />
  );
}