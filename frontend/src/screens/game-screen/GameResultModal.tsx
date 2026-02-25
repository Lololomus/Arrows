import { AnimatePresence, motion } from 'framer-motion';

interface GameResultModalProps {
  status: 'victory' | 'defeat' | 'playing' | 'loading';
  noMoreLevels: boolean;
  onNextLevel: () => void;
  onRetry: () => void;
  onMenu: () => void;
}

export function GameResultModal({
  status,
  noMoreLevels,
  onNextLevel,
  onRetry,
  onMenu,
}: GameResultModalProps) {
  const isOpen = (status === 'victory' || status === 'defeat') && !noMoreLevels;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 safe-fixed z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto">
          <motion.div initial={{ scale: 0.8, y: 50 }} animate={{ scale: 1, y: 0 }} transition={{ delay: 0.4 }} className="w-full max-w-sm bg-gradient-to-br from-slate-900/95 to-blue-900/95 backdrop-blur-xl rounded-3xl border border-white/20 shadow-2xl p-8 text-center">
            <h2 className="text-4xl font-black text-white mb-2">{status === 'victory' ? 'Victory!' : 'Game Over'}</h2>
            <div className="space-y-3 mt-6">
              <button
                onClick={status === 'victory' ? onNextLevel : onRetry}
                className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl shadow-lg"
              >
                {status === 'victory' ? 'Next Level' : 'Retry'}
              </button>
              <button onClick={onMenu} className="w-full bg-white/10 text-white font-medium py-3 rounded-2xl">Menu</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
