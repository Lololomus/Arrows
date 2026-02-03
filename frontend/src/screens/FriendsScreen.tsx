import { useState } from 'react';
import { motion } from 'framer-motion';
import { Users, Gift, Share2, Copy } from 'lucide-react';
import { useAppStore } from '../stores/store';

export function FriendsScreen() {
  const [activeTab, setActiveTab] = useState<'list' | 'referral'>('list');
  const { user } = useAppStore();

  const friends = [
    { id: 1, name: "Alexey_K", score: "24,500", status: "online", avatar: "👨‍💻" },
    { id: 2, name: "CryptoLord", score: "12,100", status: "offline", avatar: "🦸" },
    { id: 3, name: "Masha_Win", score: "8,950", status: "playing", avatar: "👩‍🎨" },
    { id: 4, name: "Dmitry_Pro", score: "6,200", status: "online", avatar: "🧑‍🚀" },
    { id: 5, name: "Anna_Top", score: "4,800", status: "offline", avatar: "👩‍🔬" },
  ];

  const handleCopyReferral = () => {
    const referralLink = `https://t.me/arrowpuzzle_bot?start=${user?.id || '123'}`;
    navigator.clipboard.writeText(referralLink);
    // TODO: показать toast "Скопировано!"
  };

  const handleShare = () => {
    const tg = (window as any).Telegram?.WebApp;
    const referralLink = `https://t.me/arrowpuzzle_bot?start=${user?.id || '123'}`;
    tg?.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=Сыграй со мной в Arrow Puzzle!`);
  };

  return (
    <div className="px-4 pb-24 h-full flex flex-col">
      
      {/* Tabs */}
      <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-1 mb-6 flex relative border border-white/10">
        <motion.div 
          className="absolute top-1 bottom-1 bg-white/10 rounded-xl shadow-sm"
          initial={false}
          animate={{ 
            left: activeTab === 'list' ? '4px' : '50%', 
            width: 'calc(50% - 6px)' 
          }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />
        <button 
          onClick={() => setActiveTab('list')}
          className={`flex-1 py-3 text-sm font-bold z-10 transition-colors ${activeTab === 'list' ? 'text-white' : 'text-white/50'}`}
        >
          <Users size={16} className="inline mr-1 mb-1" />
          Мои друзья
        </button>
        <button 
          onClick={() => setActiveTab('referral')}
          className={`flex-1 py-3 text-sm font-bold z-10 transition-colors ${activeTab === 'referral' ? 'text-white' : 'text-white/50'}`}
        >
          <Gift size={16} className="inline mr-1 mb-1" />
          Рефералы
        </button>
      </div>

      {/* Content */}
      <div className="bg-white/5 backdrop-blur-md rounded-3xl border border-white/10 flex-1 overflow-hidden flex flex-col">
        
        {activeTab === 'list' ? (
          <>
            <div className="p-6 border-b border-white/5">
              <h3 className="text-white text-lg font-bold text-center">Список друзей</h3>
              <p className="text-white/50 text-xs text-center mt-1">Всего: {friends.length}</p>
            </div>
            
            <div className="overflow-y-auto flex-1 p-4 space-y-3 custom-scrollbar">
              {friends.map((friend, i) => (
                <motion.div 
                  key={friend.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1, type: 'spring' }}
                  className="flex items-center justify-between bg-white/5 hover:bg-white/10 p-4 rounded-2xl border border-white/5 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-2xl">
                      {friend.avatar}
                    </div>
                    <div>
                      <div className="text-white font-medium text-sm">{friend.name}</div>
                      <div className="text-white/40 text-xs">Очки: {friend.score}</div>
                    </div>
                  </div>
                  <div className={`text-xs px-3 py-1.5 rounded-lg font-medium ${
                    friend.status === 'online' ? 'bg-green-500/20 text-green-300' :
                    friend.status === 'playing' ? 'bg-purple-500/20 text-purple-300' : 
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    {friend.status === 'online' ? '🟢 Онлайн' : 
                     friend.status === 'playing' ? '🎮 Играет' : '⚫ Оффлайн'}
                  </div>
                </motion.div>
              ))}
              
              {/* Заглушки */}
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 rounded-2xl bg-white/5 animate-pulse opacity-20"></div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="p-6 border-b border-white/5">
              <h3 className="text-white text-lg font-bold text-center">Реферальная программа</h3>
            </div>
            
            <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
              {/* Rewards Info */}
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

              {/* Referral Link */}
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <div className="text-white/70 text-xs mb-2 font-medium">Твоя реферальная ссылка:</div>
                <div className="flex gap-2">
                  <div className="flex-1 bg-black/30 rounded-xl px-3 py-2 text-white/50 text-xs font-mono truncate">
                    t.me/arrowpuzzle_bot?start={user?.id || '123'}
                  </div>
                  <button 
                    onClick={handleCopyReferral}
                    className="bg-white/10 hover:bg-white/20 px-3 rounded-xl transition-colors"
                  >
                    <Copy size={16} className="text-white" />
                  </button>
                </div>
              </div>

              {/* Share Button */}
              <button 
                onClick={handleShare}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold py-4 rounded-2xl transition-all hover:scale-[1.02] shadow-lg shadow-blue-500/20"
              >
                <Share2 size={20} className="inline mr-2 mb-1" />
                Пригласить друга
              </button>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white/5 rounded-xl p-3 text-center border border-white/5">
                  <div className="text-white font-bold text-xl">0</div>
                  <div className="text-white/40 text-xs mt-1">Рефералов</div>
                </div>
                <div className="bg-white/5 rounded-xl p-3 text-center border border-white/5">
                  <div className="text-yellow-400 font-bold text-xl">0</div>
                  <div className="text-white/40 text-xs mt-1">Заработано</div>
                </div>
                <div className="bg-white/5 rounded-xl p-3 text-center border border-white/5">
                  <div className="text-purple-400 font-bold text-xl">0%</div>
                  <div className="text-white/40 text-xs mt-1">Конверсия</div>
                </div>
              </div>

              {/* Referral List (empty state) */}
              <div className="text-center py-8">
                <Gift size={48} className="mx-auto text-white/20 mb-3" />
                <p className="text-white/50 text-sm">
                  Пригласи друзей и получи бонусы!
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}