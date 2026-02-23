import React from 'react';
import { motion } from 'framer-motion';
import { Zap, Target } from 'lucide-react';
import { useAppStore } from '../stores/store';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';

export function HomeScreen() {
  const { setScreen, user } = useAppStore();

  const handlePlayArcade = () => {
    setScreen('game');
  };

  return (
    // Обертка экрана с глобальным фоном (вайб глубокого космоса)
    // ИСПРАВЛЕНИЕ: вернули h-full вместо h-screen и убрали жесткий overflow-hidden, 
    // чтобы не ломать родительский layout и не перекрывать нижнюю навигацию
    <div className="relative flex flex-col h-full w-full bg-[#050511]">
      
      <AdaptiveParticles
        variant="bg"
        tone="neutral"
        baseCount={40}
        baseSpeed={0.12}
        className="z-0 opacity-60"
      />

      {/* Основной контент */}
      <div className="relative z-10 flex flex-col h-full px-6 pt-4 pb-24 justify-center gap-8">
        
        {/* КАРТОЧКА ARCADE */}
        <motion.button
          type="button"
          aria-label="Start Arcade"
          initial={false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0 }}
          className="relative group cursor-pointer text-left"
          onClick={handlePlayArcade}
        >
          {/* Пульсирующее свечение под карточкой */}
          <div className="absolute inset-0 bg-purple-500 rounded-3xl blur-xl opacity-40 group-hover:opacity-60 transition-opacity animate-pulse" />
          
          {/* Стеклянная карточка с эффектом дыхания */}
          <motion.div 
            animate={{ y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
            className="relative bg-[#16192d]/60 backdrop-blur-xl border border-white/10 border-t-white/20 p-8 rounded-3xl text-center shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden hover:scale-[1.02] transition-transform duration-300"
          >
            {/* Густые магические искры ВНУТРИ кнопки */}
            <AdaptiveParticles
              variant="accent"
              tone="violet"
              baseCount={24}
              baseSpeed={0.22}
              className="z-0 opacity-80"
            />
            
            <div className="absolute top-0 right-0 p-4 opacity-20 z-10">
              <Zap size={100} color="white" />
            </div>
            
            <h2 className="relative z-10 text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-300 to-pink-300 italic tracking-tighter uppercase mb-2 drop-shadow-md">
              Arcade
            </h2>
            <p className="relative z-10 text-purple-100/80 text-sm font-medium">
              Уровень {user?.currentLevel || 1}
            </p>
          </motion.div>
        </motion.button>

        {/* КАРТОЧКА CAMPAIGN */}
        <motion.div
          initial={false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0 }}
          className="relative group cursor-not-allowed opacity-60"
        >
          <div className="absolute inset-0 bg-cyan-500 rounded-3xl blur-xl opacity-20" />
          <div className="relative bg-[#0c0e1c]/60 backdrop-blur-xl border border-white/10 border-t-white/20 p-8 rounded-3xl text-center shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-20">
              <Target size={100} color="white" />
            </div>
            <h2 className="relative z-10 text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-300 italic tracking-tighter uppercase mb-2">
              Campaign
            </h2>
            <p className="relative z-10 text-blue-100/70 text-sm font-medium">Скоро</p>
          </div>
        </motion.div>

      </div>
    </div>
  );
}
