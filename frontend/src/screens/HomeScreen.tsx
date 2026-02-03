import { motion } from 'framer-motion';
import { Zap, Target } from 'lucide-react';
import { useAppStore } from '../stores/store';

export function HomeScreen() {
  const { setScreen, user } = useAppStore();

  const handlePlayCampaign = () => {
    setScreen('game');
  };

  return (
    <div className="flex flex-col h-full px-6 pt-10 pb-24 justify-center gap-8">
      
      {/* Campaign Mode */}
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", duration: 0.5 }}
        className="relative group cursor-pointer"
        onClick={handlePlayCampaign}
      >
        <div className="absolute inset-0 bg-cyan-500 rounded-3xl blur-xl opacity-40 group-hover:opacity-60 transition-opacity animate-pulse"></div>
        <div className="relative bg-white/10 backdrop-blur-xl border border-white/20 p-8 rounded-3xl text-center shadow-2xl overflow-hidden hover:scale-[1.02] transition-transform duration-300">
          <div className="absolute top-0 right-0 p-4 opacity-20"><Target size={100} /></div>
          <h2 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-300 italic tracking-tighter uppercase mb-2">
            Campaign
          </h2>
          <p className="text-blue-100/70 text-sm font-medium">
            Уровень {user?.currentLevel || 1}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <div className="text-yellow-400 text-2xl font-bold">{user?.coins || 0}</div>
            <div className="text-yellow-400 text-sm">монет</div>
          </div>
        </div>
      </motion.div>

      {/* Arcade Mode (Coming Soon) */}
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", duration: 0.5, delay: 0.1 }}
        className="relative group cursor-not-allowed opacity-60"
      >
        <div className="absolute inset-0 bg-purple-500 rounded-3xl blur-xl opacity-20"></div>
        <div className="relative bg-white/10 backdrop-blur-xl border border-white/20 p-8 rounded-3xl text-center shadow-2xl overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-20"><Zap size={100} /></div>
          <h2 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-300 to-pink-300 italic tracking-tighter uppercase mb-2">
            Arcade
          </h2>
          <p className="text-purple-100/70 text-sm font-medium">Скоро</p>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="mt-8 text-center space-y-2">
        <div className="inline-flex items-center gap-2 bg-black/30 px-4 py-2 rounded-full border border-white/10">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
          <span className="text-xs text-white/60 font-mono">ЭНЕРГИЯ: {user?.energy || 5}/5</span>
        </div>
        
        <div className="text-white/40 text-xs">
          Всего звёзд: <span className="text-white font-bold">{user?.totalStars || 0}</span>
        </div>
      </div>
    </div>
  );
}