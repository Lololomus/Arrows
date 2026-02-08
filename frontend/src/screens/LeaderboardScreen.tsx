import { useState, useMemo, useRef, useEffect, forwardRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Gift, User, Gamepad2, Target } from 'lucide-react';
import { useAppStore } from '../stores/store';

// --- ТИПЫ И ДАННЫЕ ---
interface Player {
  rank: number;
  username: string;
  score: number;
  prize?: string;
  avatarSeed: number;
}

const generateLeaderboard = (count: number): Player[] => {
  return Array.from({ length: count }).map((_, i) => ({
    rank: i + 1,
    username: `Player_${9900 - i}`,
    score: Math.max(1000, 10000 - i * 50 - Math.floor(Math.random() * 30)),
    prize: i === 0 ? '🐸 Эксклюзивный Пепе' : i === 1 ? '⭐ Telegram Premium' : i === 2 ? '✨ 1000 звёзд' : undefined,
    avatarSeed: i + 1
  }));
};

// --- КОМПОНЕНТ: ASYNC AVATAR ---
const AsyncAvatar = ({ seed, rank }: { seed: number, rank: number }) => {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={`w-12 h-12 rounded-full overflow-hidden shrink-0 ring-2 relative ${rank <= 3 ? 'ring-white/20' : 'ring-transparent'}`}>
      <div className={`absolute inset-0 bg-white/10 ${!loaded ? 'animate-pulse' : ''}`} />
      <img 
        src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`} 
        alt="avatar"
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`w-full h-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
};

// --- КОМПОНЕНТ: СТРОКА ИГРОКА ---
const LeaderboardItem = forwardRef<HTMLDivElement, { player: Player, index: number, styles: any }>(
  ({ player, index, styles }, ref) => {
    return (
      <motion.div
        ref={ref}
        layout
        initial={{ opacity: 0, x: -20, scale: 0.95 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
        transition={{ 
          delay: (index % 12) * 0.05, 
          duration: 0.4,
          type: "spring",
          stiffness: 400,
          damping: 30
        }}
        // ДОБАВЛЕНО: mb-3 для увеличения пространства между юзерами
        className={`
          flex items-center p-4 rounded-2xl border relative overflow-hidden h-[82px] mb-3 last:mb-0
          ${styles.bg} ${styles.border}
        `}
      >
        {styles.glow && (
          <div className={`absolute inset-0 pointer-events-none ${styles.glow} opacity-50`} />
        )}

        <div className="flex items-center justify-center w-8 mr-2 relative z-10 shrink-0">
          {styles.icon ? (
            <span className="text-2xl drop-shadow-md">{styles.icon}</span>
          ) : (
            <span className={`font-bold text-lg ${styles.rank}`}>{player.rank}</span>
          )}
        </div>

        <div className="relative z-10 mr-3">
          <AsyncAvatar seed={player.avatarSeed} rank={player.rank} />
        </div>

        <div className="flex-1 min-w-0 relative z-10 py-1">
          <div className="text-white text-base font-bold truncate">{player.username}</div>
          {player.prize && (
            <div className="flex items-center gap-1 mt-0.5">
              <Gift size={12} className="text-purple-400" />
              <span className="text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                {player.prize}
              </span>
            </div>
          )}
        </div>

        <div className={`font-mono text-base font-black relative z-10 ${player.rank <= 3 ? 'text-yellow-400' : 'text-white/60'}`}>
          {player.score.toLocaleString()}
        </div>
      </motion.div>
    );
  }
);

LeaderboardItem.displayName = 'LeaderboardItem';

// --- ОСНОВНОЙ ЭКРАН ---
export function LeaderboardScreen() {
  const [activeTab, setActiveTab] = useState<'arcade' | 'campaign'>('arcade');
  const [visibleCount, setVisibleCount] = useState(15);
  const { user } = useAppStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const leaderboard = useMemo(() => generateLeaderboard(100), []);

  useEffect(() => {
    const t = setTimeout(() => {
      setVisibleCount(15);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, 150);
    return () => clearTimeout(t);
  }, [activeTab]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (scrollHeight - scrollTop <= clientHeight + 200) {
      setVisibleCount(prev => Math.min(prev + 10, leaderboard.length));
    }
  };

  const currentUserRank = {
    rank: 1249785,
    username: user?.username || 'Вы',
    score: 150,
    avatarSeed: 999
  };

  const getRankStyles = (rank: number) => {
    switch(rank) {
      case 1: return { bg: 'bg-gradient-to-r from-yellow-500/25 via-amber-500/20 to-yellow-600/25', border: 'border-yellow-400/50', rank: 'text-yellow-400 drop-shadow-glow', glow: 'shadow-[0_0_20px_rgba(250,204,21,0.3)]', icon: '👑' };
      case 2: return { bg: 'bg-gradient-to-r from-gray-300/20 via-slate-400/15 to-gray-300/20', border: 'border-gray-300/40', rank: 'text-gray-300', glow: 'shadow-[0_0_15px_rgba(203,213,225,0.25)]', icon: '🥈' };
      case 3: return { bg: 'bg-gradient-to-r from-orange-600/25 via-amber-700/20 to-orange-500/25', border: 'border-orange-400/40', rank: 'text-orange-400', glow: 'shadow-[0_0_15px_rgba(251,146,60,0.25)]', icon: '🥉' };
      default: return { bg: 'bg-white/5', border: 'border-white/5', rank: 'text-white/40', glow: '', icon: '' };
    }
  };

  return (
    <div className="px-4 pb-24 h-full flex flex-col pt-4">
      
      {/* Banner */}
      <div className="bg-gradient-to-b from-yellow-500/20 to-transparent p-6 rounded-3xl border border-yellow-500/30 mb-6 text-center relative overflow-hidden shrink-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 bg-yellow-500/20 blur-3xl -z-10"></div>
        <Trophy size={56} className="mx-auto text-yellow-400 mb-2 drop-shadow-glow" />
        <h2 className="text-3xl font-black text-white uppercase tracking-wide drop-shadow-md">Сезон #1</h2>
        <div className="inline-flex items-center gap-2 mt-2 bg-black/30 px-3 py-1 rounded-full border border-white/10">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <p className="text-yellow-200/80 text-xs font-mono">14д 08ч 15м</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-1 mb-6 flex relative border border-white/10 shrink-0">
        <motion.div 
          className="absolute top-1 bottom-1 bg-white/10 rounded-xl shadow-sm"
          initial={false}
          animate={{ 
            left: activeTab === 'arcade' ? '4px' : '50%', 
            width: 'calc(50% - 6px)' 
          }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />
        <button onClick={() => setActiveTab('arcade')} className={`flex-1 py-3 text-sm font-bold z-10 transition-colors flex items-center justify-center gap-2 ${activeTab === 'arcade' ? 'text-white' : 'text-white/50'}`}>
          <Gamepad2 size={16} /> Arcade
        </button>
        <button onClick={() => setActiveTab('campaign')} className={`flex-1 py-3 text-sm font-bold z-10 transition-colors flex items-center justify-center gap-2 ${activeTab === 'campaign' ? 'text-white' : 'text-white/50'}`}>
          <Target size={16} /> Campaign
        </button>
      </div>

      {/* List Container */}
      <div className="flex-1 overflow-hidden relative rounded-t-2xl">
        <div 
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto custom-scrollbar pb-36 px-1" // Увеличили нижний паддинг, чтобы футер не перекрывал
        >
          {/* ИСПРАВЛЕНО: Убрали initial={false}, теперь анимация работает и при первой загрузке */}
          <AnimatePresence mode="popLayout">
            {leaderboard.slice(0, visibleCount).map((player, i) => {
               const itemKey = `${activeTab}-${player.rank}`;
               return (
                <LeaderboardItem 
                  key={itemKey}
                  ref={null} 
                  player={player} 
                  index={i} 
                  styles={getRankStyles(player.rank)} 
                />
               );
            })}
          </AnimatePresence>

          {visibleCount < leaderboard.length && (
            <div className="py-4 flex justify-center opacity-50">
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            </div>
          )}
        </div>

        {/* Sticky Footer (ИСПРАВЛЕННЫЙ) */}
        {/* z-50 поднимает его над списком. bg-slate-900 делает непрозрачным */}
        <div className="absolute bottom-0 left-0 right-0 p-4 pt-4 bg-transparent z-50">
          <div className="relative overflow-hidden rounded-2xl bg-slate-900 border-2 border-white/20 shadow-[0_0_50px_rgba(0,0,0,0.8)] p-4 flex items-center">
            
            {/* Оставили легкий градиент внутри для стиля, но база непрозрачная */}
            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-blue-500/5 via-white/5 to-transparent skew-x-12 opacity-50"></div>

            <div className="flex flex-col items-center justify-center w-12 mr-2 leading-none relative z-10">
               <span className="text-white/40 font-bold text-[10px] uppercase mb-1">Место</span>
               <span className="text-white font-black text-sm tracking-tighter">#{currentUserRank.rank.toLocaleString()}</span>
            </div>

            <div className="w-12 h-12 rounded-full bg-blue-600/20 mr-3 overflow-hidden shrink-0 border-2 border-blue-400/50 flex items-center justify-center shadow-lg relative z-10">
               <User size={24} className="text-blue-200" />
            </div>

            <div className="flex-1 relative z-10">
              <div className="text-white text-base font-black">Вы</div>
              <div className="text-blue-300/60 text-xs font-bold uppercase tracking-wider">Топ 85%</div>
            </div>

            <div className="font-mono text-xl font-black text-yellow-400 drop-shadow-md relative z-10">
              {currentUserRank.score.toLocaleString()}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}