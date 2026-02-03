import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore, useGameStore } from '../stores/store';
import { GameBoard } from '../components/GameBoard';
import { gameApi } from '../api/client';
import { generateLevel } from '../game/generator';
import { processMove, getFreeArrows } from '../game/engine';
import { Heart, RefreshCw, Lightbulb, RotateCcw, X, Home } from 'lucide-react';
import { ANIMATIONS, MAX_CELL_SIZE, MIN_CELL_SIZE } from '../config/constants';

import gameBgImage from '../assets/game-bg.jpg?url';

export function GameScreen() {
  const { user, setScreen } = useAppStore();
  const {
    gridSize,
    arrows,
    lives,
    status,
    hintsRemaining,
    hintedArrowId,
    history,
    initLevel,
    removeArrow,
    failMove,
    undo,
    showHint,
    clearHint,
    setStatus,
    setShakingArrow,
  } = useGameStore();
  
  const [currentLevel, setCurrentLevel] = useState(user?.currentLevel || 1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState(40);
  
  useEffect(() => {
    loadLevel(currentLevel);
  }, [currentLevel]);
  
  useEffect(() => {
    const updateCellSize = () => {
      if (!containerRef.current) return;
      
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;
      
      const maxWidth = containerWidth / gridSize.width;
      const maxHeight = containerHeight / gridSize.height;
      
      const newSize = Math.min(maxWidth, maxHeight, MAX_CELL_SIZE);
      setCellSize(Math.max(newSize, MIN_CELL_SIZE));
    };
    
    updateCellSize();
    window.addEventListener('resize', updateCellSize);
    return () => window.removeEventListener('resize', updateCellSize);
  }, [gridSize]);
  
  const loadLevel = useCallback(async (levelNum: number) => {
    setStatus('loading');
    
    try {
      const levelData = await gameApi.getLevel(levelNum);
      
      if (!levelData?.grid?.width || !levelData?.grid?.height || !Array.isArray(levelData.arrows)) {
        throw new Error(`Invalid level data`);
      }
      
      initLevel(levelNum, levelData.seed, levelData.grid, levelData.arrows);
      setStatus('playing');
      
    } catch (error) {
      console.error('Server error:', error);
      
      setTimeout(() => {
        try {
          const levelData = generateLevel(levelNum);
          initLevel(levelNum, levelData.seed, levelData.grid, levelData.arrows);
          setStatus('playing');
        } catch (fallbackError) {
          console.error('Fallback error:', fallbackError);
          setStatus('defeat');
        }
      }, 300);
    }
  }, [initLevel, setStatus]);
  
  const handleArrowClick = useCallback((arrowId: string) => {
    if (status !== 'playing') return;
    
    const arrow = arrows.find(a => a.id === arrowId);
    if (!arrow) return;
    
    if (hintedArrowId) clearHint();
    
    const grid = { width: gridSize.width, height: gridSize.height };
    const result = processMove(arrow, arrows, grid);
    
    if (result.defrosted) return;
    
    if (result.collision) {
      setShakingArrow(arrowId);
      (window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
      
      setTimeout(() => {
        setShakingArrow(null);
        failMove(arrowId);
      }, ANIMATIONS.arrowError);
    } else {
      (window as any).Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
      
      removeArrow(arrowId);
      
      if (result.bombExplosion?.length > 0) {
        result.bombExplosion.forEach(e => removeArrow(e.id));
      }
      
      if (result.electricTarget) {
        removeArrow(result.electricTarget.id);
      }
    }
  }, [arrows, status, gridSize, hintedArrowId, clearHint, setShakingArrow, failMove, removeArrow]);
  
  const handleHint = useCallback(() => {
    if (hintsRemaining <= 0) return;
    
    const grid = { width: gridSize.width, height: gridSize.height };
    const freeArrows = getFreeArrows(arrows, grid);
    
    if (freeArrows.length > 0) {
      (window as any).Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium');
      showHint(freeArrows[0].id);
    }
  }, [arrows, gridSize, hintsRemaining, showHint]);
  
  const handleRestart = useCallback(() => loadLevel(currentLevel), [currentLevel, loadLevel]);
  const handleNextLevel = useCallback(() => setCurrentLevel(prev => prev + 1), []);
  const handleBackToMenu = useCallback(() => setScreen('home'), [setScreen]);
  
  const livesUI = useMemo(() => (
    <div className="flex gap-1.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <motion.div key={i} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.1, type: 'spring' }}>
          <Heart
            size={24}
            fill={i < lives ? '#ef4444' : 'transparent'}
            stroke={i < lives ? '#ef4444' : 'rgba(255,255,255,0.3)'}
            strokeWidth={2}
            className="drop-shadow-lg"
          />
        </motion.div>
      ))}
    </div>
  ), [lives]);
  
  const boardWidth = cellSize * gridSize.width;
  const boardHeight = cellSize * gridSize.height;
  
  return (
    <div 
      className="relative w-full h-screen overflow-hidden font-sans select-none"
      style={{
        backgroundImage: `url(${gameBgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: '#1e3a52',
      }}
    >
      <div className="relative z-10 flex flex-col h-full max-w-md mx-auto">
        
        <div className="flex justify-between items-center p-4 pt-6 safe-area-top">
          <button onClick={handleBackToMenu} className="bg-slate-800/80 backdrop-blur-md p-2.5 rounded-2xl hover:bg-slate-700/80 transition-colors border border-white/10 shadow-lg">
            <X size={20} className="text-white" />
          </button>
          
          <div className="flex items-center gap-4">
            <div className="bg-slate-800/80 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10 shadow-lg">
              <div className="flex items-center gap-2">
                <span className="text-white/60 text-xs font-medium">Level</span>
                <span className="text-white font-bold text-lg">{currentLevel}</span>
              </div>
            </div>
            
            <div className="bg-slate-800/80 backdrop-blur-md px-3 py-2 rounded-2xl border border-white/10 shadow-lg">
              {livesUI}
            </div>
          </div>
          
          <button onClick={handleBackToMenu} className="bg-slate-800/80 backdrop-blur-md p-2.5 rounded-2xl hover:bg-slate-700/80 transition-colors border border-white/10 shadow-lg">
            <Home size={20} className="text-white" />
          </button>
        </div>
        
        <div ref={containerRef} className="flex-1 flex items-center justify-center p-4">
          {status === 'loading' ? (
            <div className="flex flex-col items-center justify-center">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-16 h-16 border-4 border-white/20 border-t-white rounded-full mb-4" />
              <span className="text-white/70 text-sm font-medium uppercase tracking-wider">Загрузка...</span>
            </div>
          ) : (
            <div 
              className="relative rounded-lg overflow-hidden"
              style={{ 
                width: boardWidth, 
                height: boardHeight,
                border: '1px solid rgba(255, 255, 255, 0.3)',
                backgroundColor: 'rgba(15, 30, 60, 0.25)',
                backdropFilter: 'blur(4px)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
              }}
            >
              <GameBoard arrows={arrows} gridSize={gridSize} cellSize={cellSize} hintedArrowId={hintedArrowId} onArrowClick={handleArrowClick} />
            </div>
          )}
        </div>
        
        <div className="flex flex-col items-center px-4 pb-8 safe-bottom">
          <div className="flex justify-center items-center gap-6">
            <motion.button whileTap={{ scale: 0.9 }} onClick={handleRestart} className="bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl hover:bg-slate-700/80 transition-colors border border-white/10 shadow-lg">
              <RefreshCw size={24} className="text-white" strokeWidth={2} />
            </motion.button>
            
            <motion.button whileTap={{ scale: 0.9 }} onClick={handleHint} disabled={hintsRemaining === 0} className="relative bg-gradient-to-br from-amber-600/80 to-orange-600/80 backdrop-blur-md p-5 rounded-2xl hover:from-amber-500/80 hover:to-orange-500/80 transition-all border border-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20">
              <Lightbulb size={32} className={hintsRemaining > 0 ? 'text-yellow-100' : 'text-white/30'} strokeWidth={2} />
              {hintsRemaining > 0 && (
                <span className="absolute -top-2 -right-2 bg-yellow-400 text-slate-900 text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full shadow-lg">{hintsRemaining}</span>
              )}
            </motion.button>
            
            <motion.button whileTap={{ scale: 0.9 }} onClick={undo} disabled={history.length === 0} className="bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl hover:bg-slate-700/80 transition-colors border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg">
              <RotateCcw size={24} className="text-white" strokeWidth={2} />
            </motion.button>
          </div>
          
          {import.meta.env.DEV && (
            <div className="flex gap-2 mt-4 opacity-40 hover:opacity-100 transition-opacity">
              <span className="text-[10px] uppercase tracking-wider text-white/60 mr-1">Jump:</span>
              {[1, 10, 50, 100].map(lvl => (
                <button key={lvl} onClick={() => setCurrentLevel(lvl)} className="px-2 py-1 text-[10px] bg-white/10 text-white border border-white/20 rounded-lg hover:bg-white/20 transition-colors font-medium">L{lvl}</button>
              ))}
            </div>
          )}
        </div>
        
      </div>
      
      <AnimatePresence>
        {(status === 'victory' || status === 'defeat') && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.8, opacity: 0, y: 50 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.8, opacity: 0, y: 50 }} transition={{ type: 'spring', damping: 20 }} className="w-full max-w-sm bg-gradient-to-br from-slate-900/95 to-blue-900/95 backdrop-blur-xl rounded-3xl border border-white/20 shadow-2xl p-8 text-center">
              <motion.div initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.2, type: 'spring' }} className="text-8xl mb-6">
                {status === 'victory' ? '🏆' : '💀'}
              </motion.div>
              
              <h2 className="text-4xl font-black text-white mb-2 uppercase tracking-wider">{status === 'victory' ? 'Victory!' : 'Game Over'}</h2>
              <p className="text-white/60 text-sm mb-6">{status === 'victory' ? `Уровень ${currentLevel} пройден!` : 'Попробуй ещё раз'}</p>
              
              {status === 'victory' && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mb-6">
                  <div className="flex justify-center gap-3 mb-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <motion.span key={i} initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.4 + i * 0.1, type: 'spring' }} className="text-5xl">
                        {i < 3 - (3 - lives) ? '⭐' : '☆'}
                      </motion.span>
                    ))}
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-yellow-400 text-2xl font-bold">+{10 + Math.floor(currentLevel / 10) * 2}</span>
                    <span className="text-yellow-400/70 text-sm">монет</span>
                  </div>
                </motion.div>
              )}
              
              <div className="space-y-3">
                <motion.button whileTap={{ scale: 0.95 }} onClick={status === 'victory' ? handleNextLevel : handleRestart} className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold py-4 rounded-2xl transition-all shadow-lg">
                  {status === 'victory' ? 'Следующий уровень' : 'Попробовать снова'}
                </motion.button>
                
                <motion.button whileTap={{ scale: 0.95 }} onClick={handleBackToMenu} className="w-full bg-white/10 hover:bg-white/20 text-white font-medium py-3 rounded-2xl transition-all border border-white/10">
                  Вернуться в меню
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}