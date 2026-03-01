import { motion } from 'framer-motion';

interface AuthExpiredScreenProps {
  message: string;
  onRetry: () => void;
}

export function AuthExpiredScreen({ message, onRetry }: AuthExpiredScreenProps) {
  const handleReopen = () => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.close) {
      tg.close();
      return;
    }
    window.location.reload();
  };

  return (
    <div className="relative w-full app-viewport overflow-hidden bg-slate-950 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.16),transparent_36%),radial-gradient(circle_at_bottom,rgba(14,165,233,0.16),transparent_42%),linear-gradient(180deg,#020617_0%,#0f172a_100%)]" />
      <div className="relative z-10 flex h-full items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl backdrop-blur-xl"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300/80">
            Session expired
          </p>
          <h1 className="mt-3 text-3xl font-black leading-tight text-white">
            Нужно переоткрыть Mini App
          </h1>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            {message}
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={handleReopen}
              className="rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-300"
            >
              Открыть заново
            </button>
            <button
              onClick={onRetry}
              className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Повторить
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
