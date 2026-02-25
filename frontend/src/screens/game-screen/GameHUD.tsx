import { useMemo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Lightbulb, RotateCcw, Heart, Trash2, ZoomIn, ZoomOut, Maximize } from 'lucide-react';

interface GameHUDProps {
  currentLevel: number;
  lives: number;
  gridSize: { width: number; height: number };
  noMoreLevels: boolean;
  hintsRemaining: number;
  canUndo: boolean;
  onMenuClick: () => void;
  onRestartClick: () => void;
  onHintClick: () => void;
  onUndoClick: () => void;
  onPrevLevel: () => void;
  onJumpLevel: (lvl: number) => void;
  onNextLevelClick: () => void;
  onDevReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  children: ReactNode;
}

export function GameHUD({
  currentLevel,
  lives,
  gridSize,
  noMoreLevels,
  hintsRemaining,
  canUndo,
  onMenuClick,
  onRestartClick,
  onHintClick,
  onUndoClick,
  onPrevLevel,
  onJumpLevel,
  onNextLevelClick,
  onDevReset,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  children,
}: GameHUDProps) {
  const livesUI = useMemo(() => (
    <div className="flex gap-1.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <motion.div key={i} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.1 }}>
          <Heart size={24} fill={i < lives ? '#ef4444' : 'transparent'} stroke={i < lives ? '#ef4444' : 'rgba(255,255,255,0.3)'} strokeWidth={2} />
        </motion.div>
      ))}
    </div>
  ), [lives]);

  return (
    <div className="relative z-10 flex flex-col h-full mx-auto pointer-events-none">
      <div className="flex justify-center items-center p-4 pt-6 safe-area-top gap-4 pointer-events-auto">
        <div className="bg-slate-800/80 backdrop-blur-md px-6 py-2 rounded-2xl border border-white/10 shadow-lg flex items-center gap-2">
          <span className="text-white/60 text-xs font-medium uppercase tracking-wider">Level</span>
          <span className="text-white font-bold text-xl">{currentLevel}</span>
        </div>
        <div className="bg-slate-800/80 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10 shadow-lg">
          {livesUI}
        </div>
        <div className="bg-slate-800/60 px-3 py-1 rounded-xl border border-white/5">
          <span className="text-white/40 text-[10px] font-mono">🖼 Canvas {gridSize.width}×{gridSize.height}</span>
        </div>
      </div>

      <div className="flex-1 relative">
        {children}
        <div className="absolute top-4 right-4 flex flex-col gap-2 z-20 pointer-events-auto">
          <button onClick={onZoomIn} className="p-2 bg-black/40 rounded-full text-white/70 hover:text-white"><ZoomIn size={20} /></button>
          <button onClick={onZoomOut} className="p-2 bg-black/40 rounded-full text-white/70 hover:text-white"><ZoomOut size={20} /></button>
          <button onClick={onZoomReset} className="p-2 bg-black/40 rounded-full text-white/70 hover:text-white"><Maximize size={20} /></button>
        </div>
      </div>

      <div className="flex flex-col items-center px-4 pb-8 safe-bottom pointer-events-auto bg-gradient-to-t from-slate-900/80 to-transparent pt-6">
        {!noMoreLevels && (
          <div className="flex justify-center items-center gap-3 w-full max-w-sm">
            <motion.button whileTap={{ scale: 0.9 }} onClick={onMenuClick} className="bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-lg"><span className="text-white font-bold text-xs">MENU</span></motion.button>
            <motion.button whileTap={{ scale: 0.9 }} onClick={onRestartClick} className="bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-lg"><RefreshCw size={24} className="text-white" /></motion.button>
            <motion.button whileTap={{ scale: 0.9 }} onClick={onHintClick} disabled={hintsRemaining === 0} className="flex-1 bg-gradient-to-br from-amber-600/90 to-orange-600/90 backdrop-blur-md p-4 rounded-2xl border border-amber-500/30 flex items-center justify-center gap-3 shadow-lg"><Lightbulb size={24} className={hintsRemaining > 0 ? 'text-yellow-100' : 'text-white/30'} /><span className="text-white font-bold text-lg">{hintsRemaining}</span></motion.button>
            <motion.button whileTap={{ scale: 0.9 }} onClick={onUndoClick} disabled={!canUndo} className="bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-lg"><RotateCcw size={24} className="text-white" /></motion.button>
          </div>
        )}

        <div className="flex flex-col items-center gap-2 mt-4 opacity-90 transition-opacity w-full">
          <div className="flex items-center gap-2 text-white/50 text-xs uppercase tracking-widest mb-1">Навигация</div>
          <div className="flex items-center gap-3 bg-slate-900/50 p-2 rounded-xl border border-white/10">
            <button onClick={onPrevLevel} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white disabled:opacity-30" disabled={currentLevel <= 1}>←</button>
            {[1, 30, 70, 100, 150].map((lvl) => (
              <button key={lvl} onClick={() => onJumpLevel(lvl)} className={`px-3 py-1 text-xs rounded-lg font-bold ${currentLevel === lvl ? 'bg-blue-500 text-white' : 'bg-white/5 text-white/60'}`}>{lvl}</button>
            ))}
            <button onClick={onNextLevelClick} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white">→</button>
            <div className="w-px h-6 bg-white/10 mx-1" />
            <button onClick={onDevReset} className="p-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20"><Trash2 size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
