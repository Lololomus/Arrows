import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';

interface GameMenuModalProps {
  action: 'restart' | 'menu' | 'unsaved_menu' | null;
  onCancel: () => void;
  onConfirmRestart: () => void;
  onConfirmMenu: () => void;
  onConfirmRetrySave?: () => void;
  onConfirmExitUnsaved?: () => void;
}

export function GameMenuModal({
  action,
  onCancel,
  onConfirmRestart,
  onConfirmMenu,
  onConfirmRetrySave,
  onConfirmExitUnsaved,
}: GameMenuModalProps) {
  const isRestart = action === 'restart';
  const isUnsavedMenu = action === 'unsaved_menu';
  const title = isRestart
    ? 'Начать заново?'
    : isUnsavedMenu
      ? 'Прогресс ещё не сохранён'
      : 'Выйти в меню?';

  return (
    <AnimatePresence>
      {action && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 safe-fixed z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm pointer-events-auto"
        >
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            className="w-full max-w-xs bg-slate-900 border border-white/10 rounded-3xl p-6 text-center shadow-2xl"
          >
            <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={32} className="text-yellow-500" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">{title}</h3>

            {isUnsavedMenu && (
              <p className="text-sm leading-relaxed text-white/65">
                Победа уже показана, но сервер ещё не подтвердил сохранение. Можно повторить сохранение или выйти без него.
              </p>
            )}

            <div className={`mt-6 ${isUnsavedMenu ? 'flex flex-col gap-3' : 'flex gap-3'}`}>
              <button onClick={onCancel} className="flex-1 py-3 bg-white/5 rounded-xl text-white">
                Отмена
              </button>

              {isUnsavedMenu ? (
                <>
                  <button
                    onClick={onConfirmRetrySave}
                    className="flex-1 py-3 bg-emerald-600 rounded-xl text-white font-bold"
                  >
                    Повторить
                  </button>
                  <button
                    onClick={onConfirmExitUnsaved}
                    className="flex-1 py-3 bg-red-500 rounded-xl text-white font-bold"
                  >
                    Выйти без сохранения
                  </button>
                </>
              ) : (
                <button
                  onClick={isRestart ? onConfirmRestart : onConfirmMenu}
                  className="flex-1 py-3 bg-red-500 rounded-xl text-white font-bold"
                >
                  {isRestart ? 'Рестарт' : 'Выйти'}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
