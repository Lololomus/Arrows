import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Users, Share2, Copy, Trophy, CheckCircle, UserPlus } from 'lucide-react';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';
import { FriendsLeaderboardScreen } from './FriendsLeaderboardScreen';
import { useReferral } from '../hooks/hooks';
import type { ReferralInfo } from '../game/types';

type FriendsTab = 'friends' | 'leaderboard';

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

// --- КОМПОНЕНТ: ПРОГРЕСС-БАР РЕФЕРАЛА ---
function ReferralProgressBar({
  currentLevel,
  confirmLevel,
}: {
  currentLevel: number;
  confirmLevel: number | null;
}) {
  if (!confirmLevel || confirmLevel <= 0) {
    return null;
  }

  const progress = Math.min(100, Math.round((currentLevel / confirmLevel) * 100));
  const remaining = Math.max(0, confirmLevel - currentLevel);

  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between text-[10px] mb-1">
        <span className="text-yellow-300/70">⏳ Ещё {remaining} ур. до бонуса</span>
        <span className="text-white/40">{progress}%</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="h-full bg-gradient-to-r from-yellow-500 to-orange-400 rounded-full"
        />
      </div>
    </div>
  );
}

// --- КОМПОНЕНТ: КАРТОЧКА РЕФЕРАЛА ---
function ReferralCard({
  referral,
  index,
  confirmLevel,
}: {
  referral: ReferralInfo;
  index: number;
  confirmLevel: number | null;
}) {
  const isConfirmed = referral.status === 'confirmed';
  const displayName = referral.first_name || referral.username || 'Игрок';

  return (
    <motion.div
      custom={index}
      variants={itemVariant}
      initial="hidden"
      animate="visible"
      className="flex items-center justify-between bg-white/5 hover:bg-white/10 p-4 rounded-2xl border border-white/5"
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="text-white/30 font-bold text-lg w-6 text-center shrink-0">{index + 1}</div>
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-xl shrink-0 overflow-hidden">
          {referral.photo_url ? (
            <img src={referral.photo_url} alt="" className="w-full h-full rounded-full object-cover" />
          ) : (
            isConfirmed ? '✅' : '⏳'
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white font-medium text-sm truncate">{displayName}</div>
          {referral.username && (
            <div className="text-white/40 text-[11px] truncate">@{referral.username}</div>
          )}
          {!isConfirmed && (
            <ReferralProgressBar
              currentLevel={referral.current_level}
              confirmLevel={confirmLevel}
            />
          )}
        </div>
      </div>

      <div className="shrink-0 ml-3">
        {isConfirmed ? (
          <div className="flex items-center gap-1.5 bg-green-500/15 text-green-300 text-xs px-3 py-1.5 rounded-xl font-medium">
            <CheckCircle size={14} /> Активен
          </div>
        ) : (
          <div className="text-center">
            <div className="text-white/60 text-xs font-bold">Ур. {referral.current_level}</div>
            <div className="text-white/30 text-[10px]">/ {confirmLevel ?? '...'}</div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// --- КОМПОНЕНТ: ПУСТОЙ СПИСОК ---
function EmptyReferralList({ onShare }: { onShare: () => void }) {
  return (
    <div className="text-center py-10">
      <div className="text-5xl mb-4">👥</div>
      <p className="text-white/60 text-sm mb-1">Пока никого нет</p>
      <p className="text-white/40 text-xs mb-5">Пригласи друга и получи 200 монет!</p>
      <button
        onClick={onShare}
        className="bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold py-3 px-6 rounded-2xl text-sm"
      >
        <UserPlus size={16} className="inline mr-1.5 mb-0.5" /> Пригласить
      </button>
    </div>
  );
}

// --- ОСНОВНОЙ КОНТЕНТ ВКЛАДКИ «МОИ ДРУЗЬЯ» ---
function FriendsListContent({
  code,
  link,
  stats,
  confirmLevel,
  referrals,
  loading,
  onCopyReferral,
  onShare,
}: {
  code: string;
  link: string;
  stats: { count: number; pending: number; earned: number };
  confirmLevel: number | null;
  referrals: ReferralInfo[];
  loading: boolean;
  onCopyReferral: () => void;
  onShare: () => void;
}) {
  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="space-y-5"
      >
        {/* Блоки наград */}
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

        {/* Статистика */}
        <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-white font-black text-xl">{stats.count}</div>
                <div className="text-white/40 text-[10px]">подтв.</div>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="text-center">
                <div className="text-yellow-300 font-black text-xl">{stats.pending}</div>
                <div className="text-white/40 text-[10px]">ожидают</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-green-400 font-bold text-lg">+{stats.earned}</div>
              <div className="text-white/40 text-[10px]">заработано</div>
            </div>
          </div>
        </div>

        {/* Реферальная ссылка */}
        <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
          <div className="text-white/70 text-xs mb-2 font-medium">Твоя реферальная ссылка:</div>
          <div className="flex gap-2">
            <div className="flex-1 bg-black/30 rounded-xl px-3 py-2 text-white/50 text-xs font-mono truncate">
              {link || `t.me/arrowpuzzle_bot?start=ref_${code || '...'}`}
            </div>
            <button onClick={onCopyReferral} className="bg-white/10 hover:bg-white/20 px-3 rounded-xl transition-colors">
              <Copy size={16} className="text-white" />
            </button>
          </div>
        </div>

        {/* Кнопка «Пригласить друга» */}
        <button
          onClick={onShare}
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

      {/* Список приглашённых */}
      <div>
        <div className="p-4 border-b border-white/5 mb-2">
          <h3 className="text-white text-lg font-bold text-center">Приглашённые друзья</h3>
          <p className="text-white/50 text-xs text-center mt-1">
            {referrals.length > 0 ? `Всего: ${referrals.length}` : 'Пока пусто'}
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : referrals.length === 0 ? (
          <EmptyReferralList onShare={onShare} />
        ) : (
          <div className="relative">
            <AdaptiveParticles
              variant="accent"
              tone="blue"
              baseCount={16}
              baseSpeed={0.15}
              className="z-0 opacity-45"
            />
            <div className="relative z-10 space-y-3 pb-4">
              {referrals.map((ref, i) => (
                <ReferralCard
                  key={ref.id}
                  referral={ref}
                  index={i}
                  confirmLevel={confirmLevel}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- ГЛАВНЫЙ ЭКРАН ---
export function FriendsScreen() {
  const [activeTab, setActiveTab] = useState<FriendsTab>('friends');
  const {
    code, link, stats, confirmLevel, referrals, loading,
    fetchReferralCode, fetchReferralStats, fetchMyReferrals, shareReferral,
  } = useReferral();

  useEffect(() => {
    fetchReferralCode();
    fetchReferralStats();
    fetchMyReferrals();
  }, [fetchReferralCode, fetchReferralStats, fetchMyReferrals]);

  const handleCopyReferral = () => {
    const referralLink = link || `https://t.me/arrowpuzzle_bot?start=ref_${code}`;
    navigator.clipboard.writeText(referralLink);
    const tg = (window as any).Telegram?.WebApp;
    tg?.HapticFeedback?.notificationOccurred?.('success');
  };

  return (
    <div className={`px-4 h-full flex flex-col pt-6 relative overflow-hidden ${activeTab === 'friends' ? 'pb-nav' : ''}`}>
      <AdaptiveParticles
        variant="bg"
        tone="neutral"
        baseCount={18}
        baseSpeed={0.1}
        className="z-0 opacity-30"
      />

      <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-1 mt-2 mb-6 flex relative border border-white/10 shrink-0">
        <motion.div
          className="absolute top-1 bottom-1 bg-white/10 rounded-xl shadow-sm"
          initial={false}
          animate={{
            left: activeTab === 'friends' ? '4px' : '50%',
            width: 'calc(50% - 6px)',
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
        <button
          onClick={() => setActiveTab('friends')}
          className={`flex-1 py-3 text-sm font-bold z-10 transition-colors ${activeTab === 'friends' ? 'text-white' : 'text-white/50'}`}
        >
          <Users size={16} className="inline mr-1 mb-1" /> Мои друзья
        </button>
        <button
          onClick={() => setActiveTab('leaderboard')}
          className={`flex-1 py-3 text-sm font-bold z-10 transition-colors ${activeTab === 'leaderboard' ? 'text-white' : 'text-white/50'}`}
        >
          <Trophy size={16} className="inline mr-1 mb-1" /> Leaderboard
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait" initial={false}>
          {activeTab === 'friends' ? (
            <motion.div
              key="friends-tab"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
              className="h-full overflow-y-auto custom-scrollbar"
            >
              <FriendsListContent
                code={code}
                link={link}
                stats={stats}
                confirmLevel={confirmLevel}
                referrals={referrals}
                loading={loading}
                onCopyReferral={handleCopyReferral}
                onShare={shareReferral}
              />
            </motion.div>
          ) : (
            <motion.div
              key="friends-leaderboard-tab"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              <FriendsLeaderboardScreen embedded />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
