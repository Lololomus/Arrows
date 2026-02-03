import { Trophy, Gift } from 'lucide-react';

export function LeaderboardScreen() {
  const leaderboard = [
    { rank: 1, username: 'Player_9901', score: 9877, prize: '🐸 Эксклюзивный Пепе' },
    { rank: 2, username: 'Player_9902', score: 9754, prize: '⭐ Telegram Premium (год)' },
    { rank: 3, username: 'Player_9903', score: 9631, prize: '✨ 1000 звёзд' },
    { rank: 4, username: 'Player_9904', score: 9508 },
    { rank: 5, username: 'Player_9905', score: 9385 },
    { rank: 6, username: 'Player_9906', score: 9262 },
    { rank: 7, username: 'Player_9907', score: 9139 },
  ];

  const getRankStyles = (rank: number) => {
    switch(rank) {
      case 1:
        return {
          bg: 'bg-gradient-to-r from-yellow-500/25 via-amber-500/20 to-yellow-600/25',
          border: 'border-yellow-400/50',
          rank: 'text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.6)]',
          glow: 'shadow-[0_0_20px_rgba(250,204,21,0.3)]',
          icon: '👑'
        };
      case 2:
        return {
          bg: 'bg-gradient-to-r from-gray-300/20 via-slate-400/15 to-gray-300/20',
          border: 'border-gray-300/40',
          rank: 'text-gray-300 drop-shadow-[0_0_8px_rgba(203,213,225,0.5)]',
          glow: 'shadow-[0_0_15px_rgba(203,213,225,0.25)]',
          icon: '🥈'
        };
      case 3:
        return {
          bg: 'bg-gradient-to-r from-orange-600/25 via-amber-700/20 to-orange-500/25',
          border: 'border-orange-400/40',
          rank: 'text-orange-400 drop-shadow-[0_0_8px_rgba(251,146,60,0.5)]',
          glow: 'shadow-[0_0_15px_rgba(251,146,60,0.25)]',
          icon: '🥉'
        };
      default:
        return {
          bg: 'bg-transparent',
          border: 'border-transparent',
          rank: 'text-white/40',
          glow: '',
          icon: ''
        };
    }
  };

  return (
    <div className="px-4 pb-24 h-full flex flex-col">
      {/* Season Banner */}
      <div className="bg-gradient-to-b from-yellow-500/20 to-transparent p-6 rounded-3xl border border-yellow-500/30 mb-4 text-center">
        <Trophy size={48} className="mx-auto text-yellow-400 mb-2 drop-shadow-glow" />
        <h2 className="text-2xl font-bold text-white">Сезон #1</h2>
        <p className="text-yellow-200/60 text-sm">Заканчивается через 14д 8ч</p>
      </div>

      {/* Leaderboard List */}
      <div className="space-y-3 overflow-y-auto flex-1 custom-scrollbar">
        {leaderboard.map((player) => {
          const styles = getRankStyles(player.rank);
          
          return (
            <div 
              key={player.rank} 
              className={`flex items-center p-4 rounded-2xl border transition-all hover:scale-[1.02] ${styles.bg} ${styles.border} ${styles.glow}`}
            >
              {/* Rank with Icon */}
              <div className="flex items-center gap-1 w-12">
                {styles.icon && <span className="text-xl">{styles.icon}</span>}
                <div className={`font-bold text-xl ${styles.rank}`}>
                  {player.rank}
                </div>
              </div>

              {/* Avatar */}
              <div className={`w-12 h-12 rounded-full bg-gray-700 mx-3 overflow-hidden ring-2 ${
                player.rank <= 3 ? 'ring-white/30' : 'ring-transparent'
              }`}>
                <img 
                  src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${player.rank}`} 
                  alt="avatar" 
                />
              </div>

              {/* Username & Prize */}
              <div className="flex-1">
                <div className="text-white text-base font-semibold">{player.username}</div>
                {player.prize && (
                  <div className="flex items-center gap-1 mt-1">
                    <Gift size={14} className="text-purple-400" />
                    <span className="text-xs font-medium bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                      {player.prize}
                    </span>
                  </div>
                )}
              </div>

              {/* Score */}
              <div className={`font-mono text-base font-bold ${
                player.rank <= 3 ? 'text-white' : 'text-white/70'
              }`}>
                {player.score.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}