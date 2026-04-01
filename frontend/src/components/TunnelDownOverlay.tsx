import { useAppStore } from '../stores/store';
import { translate } from '../i18n';

export function TunnelDownOverlay() {
  const serverUnavailable = useAppStore((s) => s.serverUnavailable);
  if (!serverUnavailable) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm px-6">
      <div className="flex flex-col items-center gap-5 max-w-xs text-center">
        <div className="text-4xl animate-spin-slow">⏳</div>
        <p className="text-white text-lg font-semibold leading-snug">
          {translate('errors:tunnelDown.title')}
        </p>
        <p className="text-white/60 text-sm leading-relaxed">
          {translate('errors:tunnelDown.subtitle')}
        </p>
        <div className="flex gap-1.5 mt-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full bg-white/40 animate-pulse"
              style={{ animationDelay: `${i * 0.3}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
