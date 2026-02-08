import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Gift, Share2, Copy, Trophy } from 'lucide-react';
import { useAppStore } from '../stores/store';

export function FriendsScreen() {
  const [activeTab, setActiveTab] = useState<'friends' | 'leaderboard'>('friends');
  const { user } = useAppStore();

  const friends = [
    { id: 1, name: "Alexey_K", status: "online", avatar: "👨‍💻" },
    { id: 2, name: "CryptoLord", status: "offline", avatar: "🦸" },
    { id: 3, name: "Masha_Win", status: "playing", avatar: "👩‍🎨" },
    { id: 4, name: "Dmitry_Pro", status: "online", avatar: "🧑‍🚀" },
    { id: 5, name: "Anna_Top", status: "offline", avatar: "👩‍🔬" },
  ];

  const leaderboard = [
    { rank: 1, username: 'Player_9901', score: 9877, prize: '🐸 Эксклюзивный Пепе' },
    { rank: 2, username: 'Player_9902', score: 9754, prize: '⭐ Telegram Premium (год)' },
    { rank: 3, username: 'Player_9903', score: 9631, prize: '✨ 1000 звёзд' },
    { rank: 4, username: 'Player_9904', score: 9508 },
    { rank: 5, username: 'Player_9905', score: 9385 },
    { rank: 6, username: 'Player_9906', score: 9262 },
    { rank: 7, username: 'Player_9907', score: 9139 },
  ];

  const handleCopyReferral = () => {
    const referralLink = `https://t.me/arrowpuzzle_bot?start=${user?.id || '123'}`;
    navigator.clipboard.writeText(referralLink);
  };

  const handleShare = () => {
    const tg = (window as any).Telegram?.WebApp;
    const referralLink = `https://t.me/arrowpuzzle_bot?start=${user?.id || '123'}`;
    tg?.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=Сыграй со мной в Arrow Puzzle!`);
  };

  const getRankStyles = (rank: number) => {
    switch(rank) {
      case 1: return { bg: 'bg-gradient-to-r from-yellow-500/25 via-amber-500/20 to-yellow-600/25', border: 'border-yellow-400/50', rank: 'text-yellow-400 drop-shadow-glow', glow: 'shadow-[0_0_20px_rgba(250,204,21,0.3)]', icon: '👑' };
      case 2: return { bg: 'bg-gradient-to-r from-gray-300/20 via-slate-400/15 to-gray-300/20', border: 'border-gray-300/40', rank: 'text-gray-300', glow: 'shadow-[0_0_15px_rgba(203,213,225,0.25)]', icon: '🥈' };
      case 3: return { bg: 'bg-gradient-to-r from-orange-600/25 via-amber-700/20 to-orange-500/25', border: 'border-orange-400/40', rank: 'text-orange-400', glow: 'shadow-[0_0_15px_rgba(251,146,60,0.25)]', icon: '🥉' };
      // ИСПРАВЛЕНО: Добавлено свойство glow: ''
      default: return { bg: 'bg-white/5', border: 'border-white/5', rank: 'text-white/40', glow: '', icon: '' };
    }
  };

  // --- АНИМАЦИИ (ISOLATED ITEMS) ---

  const tabTransition = {
    initial: { opacity: 0, x: -10 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 10 },
    transition: { duration: 0.2 }
  };

  const itemVariant = {
    hidden: { opacity: 0, x: -20 },
    visible: (i: number) => ({
      opacity: 1,
      x: 0,
      transition: {
        delay: i * 0.06,
        duration: 0.3,
        type: "spring",
        stiffness: 350,
        damping: 25
      }
    })
  };

  return (
    <div className="px-4 pb-24 h-full flex flex-col pt-4">
      
      {/* Tabs */}
      <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-1 mb-6 flex relative border border-white/10 shrink-0">
        <motion.div 
          className="absolute top-1 bottom-1 bg-white/10 rounded-xl shadow-sm"
          initial={false}
          animate={{ 
            left: activeTab === 'friends' ? '4px' : '50%', 
            width: 'calc(50% - 6px)' 
          }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />
        <button onClick={() => setActiveTab('friends')} className={`flex-1 py-3 text-sm font-bold z-10 transition-colors ${activeTab === 'friends' ? 'text-white' : 'text-white/50'}`}>
          <Users size={16} className="inline mr-1 mb-1" /> Мои друзья
        </button>
        <button onClick={() => setActiveTab('leaderboard')} className={`flex-1 py-3 text-sm font-bold z-10 transition-colors ${activeTab === 'leaderboard' ? 'text-white' : 'text-white/50'}`}>
          <Trophy size={16} className="inline mr-1 mb-1" /> Leaderboard
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar relative">
        <AnimatePresence mode="popLayout">
          
          {activeTab === 'friends' ? (
            <motion.div
              key="friends"
              {...tabTransition}
              className="space-y-6"
            >
              {/* Static Blocks */}
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gradient-to-br from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 rounded-2xl p-4 text-center">
                    <div className="text-3xl mb-2">💰</div>
                    <div className="text-yellow-400 font-bold text-lg">+200</div>
                    <div className="text-yellow-200/60 text-xs">монет тебе</div>
                  </div>
                  <div className="bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/30 rounded-2xl p-4 text-center">
                    <div className="text-3xl mb-2">🎁</div>
                    <div className="text-cyan-400 font-bold text-lg">+100</div>
                    <div className="text-cyan-200/60 text-xs">монет другу</div>
                  </div>
                </div>

                <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                  <div className="text-white/70 text-xs mb-2 font-medium">Твоя реферальная ссылка:</div>
                  <div className="flex gap-2">
                    <div className="flex-1 bg-black/30 rounded-xl px-3 py-2 text-white/50 text-xs font-mono truncate">
                      t.me/arrowpuzzle_bot?start={user?.id || '123'}
                    </div>
                    <button onClick={handleCopyReferral} className="bg-white/10 hover:bg-white/20 px-3 rounded-xl transition-colors">
                      <Copy size={16} className="text-white" />
                    </button>
                  </div>
                </div>

                <button onClick={handleShare} className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-blue-500/20">
                  <Share2 size={20} className="inline mr-2 mb-1" /> Пригласить друга
                </button>
              </motion.div>

              {/* Friends List */}
              <div>
                <div className="p-4 border-b border-white/5 mb-2">
                  <h3 className="text-white text-lg font-bold text-center">Список друзей</h3>
                  <p className="text-white/50 text-xs text-center mt-1">Всего: {friends.length}</p>
                </div>
                
                <div className="space-y-3 pb-4">
                  {friends.map((friend, i) => (
                    <motion.div 
                      key={friend.id}
                      custom={i}
                      variants={itemVariant}
                      initial="hidden"
                      animate="visible"
                      className="flex items-center justify-between bg-white/5 hover:bg-white/10 p-4 rounded-2xl border border-white/5"
                    >
                      <div className="flex items-center gap-4">
                        <div className="text-white/30 font-bold text-lg w-6 text-center">{i + 1}</div>
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-2xl">
                          {friend.avatar}
                        </div>
                        <div className="text-white font-medium text-sm">{friend.name}</div>
                      </div>
                      <div className={`text-xs px-3 py-1.5 rounded-lg font-medium ${
                        friend.status === 'online' ? 'bg-green-500/20 text-green-300' :
                        friend.status === 'playing' ? 'bg-purple-500/20 text-purple-300' : 
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {friend.status === 'online' ? '🟢 Онлайн' : friend.status === 'playing' ? '🎮 Играет' : '⚫ Оффлайн'}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          ) : (
            
            /* Leaderboard Tab */
            <motion.div
              key="leaderboard"
              {...tabTransition}
              className="space-y-4 pb-4"
            >
              <div className="bg-gradient-to-b from-yellow-500/20 to-transparent p-6 rounded-3xl border border-yellow-500/30 mb-4 text-center">
                <Trophy size={48} className="mx-auto text-yellow-400 mb-2 drop-shadow-glow" />
                <h2 className="text-2xl font-bold text-white">Сезон #1</h2>
                <p className="text-yellow-200/60 text-sm">Заканчивается через 14д 8ч</p>
              </div>

              <div className="space-y-3">
                {leaderboard.map((player, i) => {
                  const styles = getRankStyles(player.rank);
                  return (
                    <motion.div 
                      key={player.rank} 
                      custom={i}
                      variants={itemVariant}
                      initial="hidden"
                      animate="visible"
                      className={`flex items-center p-4 rounded-2xl border ${styles.bg} ${styles.border} ${styles.glow}`}
                    >
                      <div className="flex items-center gap-1 w-12">
                        {styles.icon && <span className="text-xl">{styles.icon}</span>}
                        <div className={`font-bold text-xl ${styles.rank}`}>{player.rank}</div>
                      </div>
                      <div className={`w-12 h-12 rounded-full bg-gray-700 mx-3 overflow-hidden ring-2 ${player.rank <= 3 ? 'ring-white/30' : 'ring-transparent'}`}>
                        <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${player.rank}`} alt="avatar" />
                      </div>
                      <div className="flex-1">
                        <div className="text-white text-base font-semibold">{player.username}</div>
                        {player.prize && (
                          <div className="flex items-center gap-1 mt-1">
                            <Gift size={14} className="text-purple-400" />
                            <span className="text-xs font-medium bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">{player.prize}</span>
                          </div>
                        )}
                      </div>
                      <div className={`font-mono text-base font-bold ${player.rank <= 3 ? 'text-white' : 'text-white/70'}`}>
                        {player.score.toLocaleString()}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}