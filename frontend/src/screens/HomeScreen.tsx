import { motion } from 'framer-motion';
import { Zap, Target } from 'lucide-react';
import { useAppStore } from '../stores/store';

export function HomeScreen() {
  const { setScreen, user } = useAppStore();

  const handlePlayArcade = () => {
    setScreen('game');
  };

  return (
    <div className="flex flex-col h-full px-6 pt-4 pb-24 justify-center gap-8">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', duration: 0.5 }}
        className="relative group cursor-pointer"
        onClick={handlePlayArcade}
      >
        <div className="absolute inset-0 bg-purple-500 rounded-3xl blur-xl opacity-40 group-hover:opacity-60 transition-opacity animate-pulse" />
        <div className="relative bg-white/10 backdrop-blur-xl border border-white/20 p-8 rounded-3xl text-center shadow-2xl overflow-hidden hover:scale-[1.02] transition-transform duration-300">
          <div className="absolute top-0 right-0 p-4 opacity-20"><Zap size={100} /></div>
          <h2 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-300 to-pink-300 italic tracking-tighter uppercase mb-2">
            Arcade
          </h2>
          <p className="text-purple-100/70 text-sm font-medium">
            {'\u0423\u0440\u043E\u0432\u0435\u043D\u044C'} {user?.currentLevel || 1}
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', duration: 0.5, delay: 0.1 }}
        className="relative group cursor-not-allowed opacity-60"
      >
        <div className="absolute inset-0 bg-cyan-500 rounded-3xl blur-xl opacity-20" />
        <div className="relative bg-white/10 backdrop-blur-xl border border-white/20 p-8 rounded-3xl text-center shadow-2xl overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-20"><Target size={100} /></div>
          <h2 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-300 italic tracking-tighter uppercase mb-2">
            Campaign
          </h2>
          <p className="text-blue-100/70 text-sm font-medium">{'\u0421\u043A\u043E\u0440\u043E'}</p>
        </div>
      </motion.div>
    </div>
  );
}
