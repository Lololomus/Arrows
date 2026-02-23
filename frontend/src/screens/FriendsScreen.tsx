import { motion } from 'framer-motion';
import { Users, Share2, Copy, Trophy } from 'lucide-react';
import { useAppStore } from '../stores/store';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';

interface FriendsScreenProps {
  onOpenLeaderboard?: () => void;
}

export function FriendsScreen({ onOpenLeaderboard }: FriendsScreenProps) {
  const { user } = useAppStore();

  const friends = [
    { id: 1, name: 'Alexey_K', status: 'online', avatar: '👨‍💻' },
    { id: 2, name: 'CryptoLord', status: 'offline', avatar: '🦸' },
    { id: 3, name: 'Masha_Win', status: 'playing', avatar: '👩‍🎨' },
    { id: 4, name: 'Dmitry_Pro', status: 'online', avatar: '🧑‍🚀' },
    { id: 5, name: 'Anna_Top', status: 'offline', avatar: '👩‍🔬' },
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

  const itemVariant = {
    hidden: { opacity: 0, x: -20 },
    visible: (i: number) => ({
      opacity: 1,
      x: 0,
      transition: {
        delay: i * 0.06,
        duration: 0.3,
        type: 'spring',
        stiffness: 350,
        damping: 25,
      },
    }),
  };

  return (
    <div className="px-4 pb-24 h-full flex flex-col pt-4 relative overflow-hidden">
      <AdaptiveParticles
        variant="bg"
        tone="neutral"
        baseCount={18}
        baseSpeed={0.1}
        className="z-0 opacity-30"
      />

      <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-1 mb-6 flex relative border border-white/10 shrink-0">
        <div className="absolute top-1 bottom-1 left-1 right-1 flex">
          <div className="flex-1">
            <div className="h-full bg-white/10 rounded-xl shadow-sm" />
          </div>
          <div className="flex-1" />
        </div>
        <button className="flex-1 py-3 text-sm font-bold z-10 text-white">
          <Users size={16} className="inline mr-1 mb-1" /> Мои друзья
        </button>
        <button
          onClick={onOpenLeaderboard}
          className="flex-1 py-3 text-sm font-bold z-10 transition-colors text-white/50 hover:text-white"
        >
          <Trophy size={16} className="inline mr-1 mb-1" /> Leaderboard
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar relative">
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className="space-y-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="relative rounded-2xl overflow-hidden">
                <AdaptiveParticles
                  variant="accent"
                  tone="gold"
                  baseCount={18}
                  baseSpeed={0.2}
                  className="z-0 opacity-75"
                />
                <div className="relative z-10 bg-gradient-to-br from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 rounded-2xl p-4 text-center">
                  <div className="text-3xl mb-2">💰</div>
                  <div className="text-yellow-400 font-bold text-lg">+200</div>
                  <div className="text-yellow-200/60 text-xs">монет тебе</div>
                </div>
              </div>
              <div className="relative rounded-2xl overflow-hidden">
                <AdaptiveParticles
                  variant="accent"
                  tone="cyan"
                  baseCount={18}
                  baseSpeed={0.2}
                  className="z-0 opacity-75"
                />
                <div className="relative z-10 bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/30 rounded-2xl p-4 text-center">
                  <div className="text-3xl mb-2">🎁</div>
                  <div className="text-cyan-400 font-bold text-lg">+100</div>
                  <div className="text-cyan-200/60 text-xs">монет другу</div>
                </div>
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

            <button
              onClick={handleShare}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-blue-500/20 relative overflow-hidden"
            >
              <AdaptiveParticles
                variant="accent"
                tone="neutral"
                baseCount={16}
                baseSpeed={0.18}
                className="z-0 opacity-60"
              />
              <span className="relative z-10">
                <Share2 size={20} className="inline mr-2 mb-1" /> Пригласить друга
              </span>
            </button>
          </motion.div>

          <div>
            <div className="p-4 border-b border-white/5 mb-2">
              <h3 className="text-white text-lg font-bold text-center">Список друзей</h3>
              <p className="text-white/50 text-xs text-center mt-1">Всего: {friends.length}</p>
            </div>

            <div className="relative">
              <AdaptiveParticles
                variant="accent"
                tone="blue"
                baseCount={16}
                baseSpeed={0.15}
                className="z-0 opacity-45"
              />
              <div className="relative z-10 space-y-3 pb-4">
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
                    <div
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium ${
                        friend.status === 'online'
                          ? 'bg-green-500/20 text-green-300'
                          : friend.status === 'playing'
                            ? 'bg-purple-500/20 text-purple-300'
                            : 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {friend.status === 'online' ? '🟢 Онлайн' : friend.status === 'playing' ? '🎮 Играет' : '⚫ Оффлайн'}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
