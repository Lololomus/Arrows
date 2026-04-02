export function IceOverlay({ isSmall = false }: { isSmall?: boolean }) {
  return (
    <div className="absolute inset-0 pointer-events-none z-30 flex items-center justify-center">
      <div
        className={`absolute inset-0 rounded-full overflow-hidden transition-all duration-1000 ${
          isSmall
            ? 'backdrop-blur-[4px] shadow-[inset_0_0_12px_rgba(255,255,255,0.9),inset_0_0_20px_rgba(165,243,252,0.5)] border-2 border-white/60'
            : 'backdrop-blur-[8px] shadow-[inset_0_0_40px_rgba(255,255,255,0.9),inset_0_0_80px_rgba(103,232,249,0.4)] border-[3px] border-white/50'
        }`}
        style={{
          background:
            'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.05) 50%, rgba(165,243,252,0.15) 80%, rgba(255,255,255,0.6) 100%)',
        }}
      >
        {!isSmall && (
          <div
            className="absolute inset-0 opacity-70 mix-blend-overlay"
            style={{
              background:
                'radial-gradient(circle at 15% 85%, rgba(255,255,255,0.9) 0%, transparent 45%), radial-gradient(circle at 85% 15%, rgba(255,255,255,0.8) 0%, transparent 50%), radial-gradient(circle at 50% 50%, rgba(255,255,255,0.3) 0%, transparent 65%)',
            }}
          />
        )}
      </div>

      <div
        className={`absolute rounded-full backdrop-blur-xl bg-white/40 border-[2px] border-white/70 flex items-center justify-center ${
          isSmall ? 'w-5 h-5' : 'w-16 h-16'
        }`}
        style={{ boxShadow: 'inset 0 0 12px rgba(255,255,255,1), 0 0 20px rgba(255,255,255,0.4)' }}
      >
        <div className={`rounded-full bg-cyan-100/60 ${isSmall ? 'w-2 h-2' : 'w-6 h-6'}`} />
      </div>
    </div>
  );
}
