import { motion } from 'framer-motion';
import { Trophy, UserPlus } from 'lucide-react';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';

interface ReferralPlayer {
  id: number;
  name: string;
  referrals: number;
}

const referralLeaderboard: ReferralPlayer[] = [
  { id: 1, name: 'Alexey_K', referrals: 37 },
  { id: 2, name: 'CryptoLord', referrals: 29 },
  { id: 3, name: 'Masha_Win', referrals: 24 },
  { id: 4, name: 'Dmitry_Pro', referrals: 20 },
  { id: 5, name: 'Anna_Top', referrals: 17 },
];

export function FriendsLeaderboardScreen() {
  return (
    <div className="space-y-4 pb-4">
      <div className="bg-white/5 rounded-2xl border border-white/10 p-4">
        <div className="flex items-center gap-2 text-white font-bold">
          <Trophy size={18} className="text-yellow-400" />
          Friends Leaderboard
        </div>
        <p className="text-xs text-white/60 mt-2">
          This leaderboard will be based on invited referrals.
        </p>
      </div>

      <div className="relative rounded-2xl overflow-hidden">
        <AdaptiveParticles
          variant="accent"
          tone="blue"
          baseCount={16}
          baseSpeed={0.14}
          className="z-0 opacity-45"
        />
        <div className="relative z-10 space-y-3 p-1">
          {referralLeaderboard.map((player, index) => (
            <motion.div
              key={player.id}
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05, duration: 0.25 }}
              className="flex items-center justify-between bg-white/5 border border-white/5 rounded-2xl p-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-7 text-center text-sm font-bold text-white/50">{index + 1}</div>
                <div className="text-sm font-semibold text-white">{player.name}</div>
              </div>
              <div className="inline-flex items-center gap-2 rounded-xl bg-blue-500/15 text-blue-300 px-3 py-1.5 text-xs font-semibold">
                <UserPlus size={14} />
                {player.referrals}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
