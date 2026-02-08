import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, ClipboardList, Gamepad2, Trophy, ShoppingBag } from 'lucide-react';
import { useAppStore } from './stores/store';
import { ParticleBackground } from './components/ParticleBackground';
import { HomeScreen } from './screens/HomeScreen';
import { GameScreen } from './screens/GameScreen';
import { ShopScreen } from './screens/ShopScreen';
import { FriendsScreen } from './screens/FriendsScreen';
import { TasksScreen } from './screens/TasksScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';

type TabId = 'friends' | 'tasks' | 'play' | 'leaderboard' | 'shop';

export default function App() {
  const { screen } = useAppStore();
  const [activeTab, setActiveTab] = useState<TabId>('play');

  // Если в игре - показываем GameScreen без табов
  if (screen === 'game') {
    return (
      <div className="relative w-full h-screen overflow-hidden bg-slate-900 font-sans select-none">
        <ParticleBackground />
        <div className="relative z-10 h-full">
          <GameScreen />
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'friends' as TabId, label: 'Друзья', icon: Users },
    { id: 'tasks' as TabId, label: 'Задания', icon: ClipboardList },
    { id: 'play' as TabId, label: 'Играть', icon: Gamepad2, isMain: true },
    { id: 'leaderboard' as TabId, label: 'Топ', icon: Trophy },
    { id: 'shop' as TabId, label: 'Магазин', icon: ShoppingBag },
  ];

  const getActiveComponent = () => {
    switch (activeTab) {
      case 'friends':
        return <FriendsScreen />;
      case 'tasks':
        return <TasksScreen />;
      case 'play':
        return <HomeScreen />;
      case 'leaderboard':
        return <LeaderboardScreen />;
      case 'shop':
        return <ShopScreen />;
      default:
        return <HomeScreen />;
    }
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-900 font-sans select-none">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&display=swap');
        .font-sans { font-family: 'Inter', sans-serif; }
        .drop-shadow-glow { filter: drop-shadow(0 0 10px rgba(250, 204, 21, 0.5)); }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
      `}</style>

      {/* Background */}
      <ParticleBackground />

      {/* Main Container */}
      <div className="relative z-10 flex flex-col h-full max-w-md mx-auto shadow-2xl bg-black/20">

        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative pt-6 safe-area-top">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
              transition={{ duration: 0.3 }}
              className="h-full w-full"
            >
              {getActiveComponent()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Bottom Navigation */}
        <div className="absolute bottom-0 left-0 w-full bg-black/40 backdrop-blur-xl border-t border-white/10 pb-6 pt-2 px-2 rounded-t-3xl safe-bottom">
          <div className="flex justify-around items-end">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex flex-col items-center justify-center p-2 transition-all duration-300 ${tab.isMain ? '-mt-8' : ''}`}
                >
                  {/* Active Indicator Background */}
                  {isActive && !tab.isMain && (
                    <motion.div
                      layoutId="nav-pill"
                      className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent rounded-2xl -z-10"
                      initial={false}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  )}

                  {/* Icon Wrapper */}
                  <motion.div
                    animate={{
                      y: isActive ? -4 : 0,
                      scale: isActive ? 1.1 : 1,
                    }}
                    className={`
                      ${tab.isMain 
                        ? 'w-16 h-16 bg-gradient-to-tr from-blue-600 to-cyan-500 rounded-full flex items-center justify-center shadow-lg shadow-cyan-500/30 border-4 border-slate-900' 
                        : 'w-10 h-10 flex items-center justify-center'
                      }
                    `}
                  >
                    <tab.icon 
                      size={tab.isMain ? 32 : 24} 
                      className={isActive ? 'text-white' : 'text-slate-400'}
                      strokeWidth={isActive ? 2.5 : 2}
                    />
                  </motion.div>

                  {/* Label */}
                  {!tab.isMain && (
                    <motion.span
                      animate={{ 
                        opacity: isActive ? 1 : 0.6, 
                        scale: isActive ? 1 : 0.9,
                        color: isActive ? '#ffffff' : '#94a3b8'
                      }}
                      className="text-[10px] font-medium mt-1"
                    >
                      {tab.label}
                    </motion.span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}