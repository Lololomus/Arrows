import { motion } from 'framer-motion';
import { Coins } from 'lucide-react';
import { useAppStore } from '../stores/store';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';

const HOME_BG_STAR_SIZE_PROFILE = { small: 0.8, medium: 0.16, large: 0.04 } as const;

const titleContainer = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.08,
    },
  },
};

const titleLine = {
  hidden: { opacity: 0, y: -16, scale: 0.96, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: { duration: 0.36, ease: 'easeOut' },
  },
};

export function HomeScreen() {
  const { setScreen, user } = useAppStore();
  const displayTitleFont = { fontFamily: '"Bungee Inline", cursive' } as const;
  const coinBalance = user?.coins ?? 1250;

  const handlePlayArcade = () => {
    setScreen('game');
  };

  return (
    <div className="relative flex flex-col h-full w-full">
      <AdaptiveParticles
        variant="bg"
        tone="neutral"
        baseCount={84}
        baseSpeed={0.12}
        sizeProfile={HOME_BG_STAR_SIZE_PROFILE}
        className="z-0 opacity-60"
      />

      <div className="relative z-10 flex flex-col h-full px-6">

        {/* Title — абсолютно позиционирован, не влияет на поток */}
        <motion.div
          className="absolute top-[14%] left-6 right-6 text-center z-10"
          variants={titleContainer}
          initial="hidden"
          animate="visible"
        >
          <h1
            style={displayTitleFont}
            className="text-5xl leading-[0.9] text-white tracking-wider drop-shadow-[0_0_18px_rgba(255,255,255,0.3)]"
          >
            <motion.span variants={titleLine} className="block">
              ARROW
            </motion.span>
            <motion.span variants={titleLine} className="block">
              REWARD
            </motion.span>
          </h1>
        </motion.div>

        {/* Кнопки — центрируются на всю высоту экрана */}
        <div className="flex-1 flex flex-col justify-center space-y-3 pb-8">
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.35, ease: 'easeOut', delay: 0.2 }}
            className="relative overflow-hidden rounded-2xl border border-yellow-300/20 bg-[#14162a]/65 backdrop-blur-xl shadow-[0_8px_28px_rgba(0,0,0,0.45)]"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 via-yellow-300/10 to-amber-500/10" />
            <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-yellow-300/20 blur-2xl" />
            <div className="relative flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-yellow-200/25 bg-yellow-300/10 text-yellow-300">
                  <Coins size={20} strokeWidth={2.2} />
                </div>
                <div className="leading-tight">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-yellow-100/70">Coin stash</p>
                  <p className="text-2xl font-black text-yellow-200 drop-shadow-[0_0_12px_rgba(250,204,21,0.35)]">
                    {coinBalance.toLocaleString()}
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-yellow-300/30 bg-yellow-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-yellow-100/75">
                Wallet
              </span>
            </div>
          </motion.div>

          <motion.button
            type="button"
            aria-label="Start Arcade"
            initial={false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0 }}
            className="relative w-full group cursor-pointer text-left"
            onClick={handlePlayArcade}
          >
            <div className="absolute inset-0 bg-purple-500 rounded-3xl blur-xl opacity-40 group-hover:opacity-60 transition-opacity animate-pulse" />

            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
              className="relative bg-[#16192d]/60 backdrop-blur-xl border border-white/10 border-t-white/20 p-8 rounded-3xl text-center shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden hover:scale-[1.02] transition-transform duration-300"
            >
              <AdaptiveParticles
                variant="accent"
                tone="violet"
                baseCount={24}
                baseSpeed={0.22}
                className="z-0 opacity-80"
              />

              <div className="absolute top-0 right-0 p-4 opacity-20 z-10">
                <span className="text-7xl leading-none">🕹️</span>
              </div>

              <h2
                style={displayTitleFont}
                className="relative z-10 text-4xl text-transparent bg-clip-text bg-gradient-to-r from-purple-300 to-pink-300 tracking-wider uppercase mb-2 drop-shadow-md"
              >
                Arcade
              </h2>
              <p className="relative z-10 text-purple-100/80 text-sm font-medium">
                Уровень {user?.currentLevel || 1}
              </p>
            </motion.div>
          </motion.button>

          <motion.div
            initial={false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0 }}
            className="relative w-full group cursor-not-allowed opacity-60"
          >
            <div className="absolute inset-0 bg-cyan-500 rounded-3xl blur-xl opacity-20" />
            <div className="relative bg-[#0c0e1c]/60 backdrop-blur-xl border border-white/10 border-t-white/20 p-8 rounded-3xl text-center shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-20">
                <span className="text-7xl leading-none">⚡️</span>
              </div>
              <h2
                style={displayTitleFont}
                className="relative z-10 text-4xl text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-300 tracking-wider uppercase mb-2"
              >
                Adventure
              </h2>
              <p className="relative z-10 text-blue-100/70 text-sm font-medium">Скоро</p>
            </div>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
