/**
 * Arrow Puzzle - Game Screen (FINAL: PHASE 1 + 2 + 3 + 4)
 * 
 * Фаза 1: статический import, атомарные селекторы, стабильный handleArrowClick
 * Фаза 2: engine использует SpatialIndex (прозрачно)
 * Фаза 3: свитчер SVG ↔ Canvas по размеру поля
 * Фаза 4: handleArrowClick использует removeArrows() для batch removal
 */

import { useEffect, useState, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore, useGameStore } from '../stores/store';
import { GameBoard } from '../components/GameBoard';
import { gameApi } from '../api/client';
import { RefreshCw, Lightbulb, RotateCcw, AlertTriangle, Heart, Trash2, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { ANIMATIONS, MAX_CELL_SIZE, MIN_CELL_SIZE } from '../config/constants';

import { processMove, getFreeArrows } from '../game/engine';

import gameBgImage from '../assets/game-bg.jpg?url';

// Grid > порога → Canvas
const CANVAS_THRESHOLD = 20;

const CanvasBoard = lazy(() => 
  import('../components/CanvasBoard').then(m => ({ default: m.CanvasBoard }))
);

export function GameScreen() {
  // === АТОМАРНЫЕ СЕЛЕКТОРЫ ===
  const user = useAppStore(s => s.user);
  const setScreen = useAppStore(s => s.setScreen);
  
  const gridSize = useGameStore(s => s.gridSize);
  const arrows = useGameStore(s => s.arrows);
  const lives = useGameStore(s => s.lives);
  const status = useGameStore(s => s.status);
  const hintsRemaining = useGameStore(s => s.hintsRemaining);
  const hintedArrowId = useGameStore(s => s.hintedArrowId);
  const history = useGameStore(s => s.history);
  
  const initLevel = useGameStore(s => s.initLevel);
  const removeArrow = useGameStore(s => s.removeArrow);
  const removeArrows = useGameStore(s => s.removeArrows);
  const failMove = useGameStore(s => s.failMove);
  const undo = useGameStore(s => s.undo);
  const showHint = useGameStore(s => s.showHint);
  const clearHint = useGameStore(s => s.clearHint);
  const setStatus = useGameStore(s => s.setStatus);
  const setShakingArrow = useGameStore(s => s.setShakingArrow);
  
  const [currentLevel, setCurrentLevel] = useState(user?.currentLevel || 1);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // === ZOOM & PAN ===
  const [transform, setTransform] = useState({ k: 1, x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const lastTransform = useRef({ x: 0, y: 0 });
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartScale = useRef(1);

  const [confirmAction, setConfirmAction] = useState<'restart' | 'menu' | null>(null);
  const [noMoreLevels, setNoMoreLevels] = useState(false);
  
  const useCanvas = gridSize.width > CANVAS_THRESHOLD || gridSize.height > CANVAS_THRESHOLD;
  
  useEffect(() => {
    loadLevel(currentLevel);
    setTransform({ k: 1, x: 0, y: 0 });
  }, [currentLevel]);
  
  const baseCellSize = useMemo(() => {
    if (!containerRef.current) return 40;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    if (w === 0 || h === 0) return 40;
    
    const SCREEN_PADDING = 32;
    const GRID_PADDING_CELLS = 0.4;
    const availableW = w - SCREEN_PADDING;
    const availableH = h - SCREEN_PADDING;
    const maxWidth = availableW / (gridSize.width + GRID_PADDING_CELLS);
    const maxHeight = availableH / (gridSize.height + GRID_PADDING_CELLS);
    const newSize = Math.min(maxWidth, maxHeight, MAX_CELL_SIZE);
    return Math.floor(Math.max(newSize, MIN_CELL_SIZE));
  }, [gridSize.width, gridSize.height]);
  
  useEffect(() => {
    const handleResize = () => setTransform(prev => ({ ...prev }));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // === ZOOM HANDLERS ===

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(prev => ({
      ...prev,
      k: Math.min(Math.max(0.5, prev.k * scaleFactor), 3)
    }));
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartDist.current = dist;
      pinchStartScale.current = transform.k;
    } else if (e.touches.length === 1) {
      setIsDragging(true);
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastTransform.current = { x: transform.x, y: transform.y };
    }
  }, [transform.k, transform.x, transform.y]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDist.current) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scale = pinchStartScale.current * (dist / pinchStartDist.current);
      setTransform(prev => ({ ...prev, k: Math.min(Math.max(0.5, scale), 3) }));
    } else if (e.touches.length === 1 && isDragging) {
      const dx = e.touches[0].clientX - dragStart.current.x;
      const dy = e.touches[0].clientY - dragStart.current.y;
      setTransform(prev => ({ 
        ...prev, 
        x: lastTransform.current.x + dx, 
        y: lastTransform.current.y + dy 
      }));
    }
  }, [isDragging]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    pinchStartDist.current = null;
  }, []);

  const resetZoom = useCallback(() => setTransform({ k: 1, x: 0, y: 0 }), []);
  
  // === ЗАГРУЗКА УРОВНЯ ===
  const loadLevel = useCallback(async (levelNum: number) => {
    setStatus('loading');
    setNoMoreLevels(false);
    try {
      const levelData = await gameApi.getLevel(levelNum);
      initLevel(levelNum, levelData.seed, levelData.grid, levelData.arrows);
      setStatus('playing');
    } catch (error: any) {
      console.error(error);
      if (error?.status === 404) { setNoMoreLevels(true); setStatus('victory'); }
      else if (error?.status === 403) { alert(`🔒 Уровень ${levelNum} закрыт!`); setScreen('home'); }
      else { alert(`❌ Ошибка загрузки уровня ${levelNum}`); setScreen('home'); }
    }
  }, [initLevel, setStatus, setScreen]);

  // === КЛИК ПО СТРЕЛКЕ (FINAL) ===
  // Фаза 1: getState() вместо замыкания, статический import
  // Фаза 4: removeArrows() для batch (бомба/электро = 1 ре-рендер)
  const handleArrowClick = useCallback((arrowId: string) => {
    const currentState = useGameStore.getState();
    const { arrows: currentArrows, status: currentStatus, gridSize: currentGrid, hintedArrowId: currentHint } = currentState;
    
    if (currentStatus !== 'playing') return;
    
    const arrow = currentArrows.find(a => a.id === arrowId);
    if (!arrow) return;
    
    if (currentHint) clearHint();
    
    const grid = { width: currentGrid.width, height: currentGrid.height };
    const result = processMove(arrow, currentArrows, grid);
    
    if (result.defrosted) return;
    
    if (result.collision) {
      setShakingArrow(arrowId);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
      setTimeout(() => {
        setShakingArrow(null);
        failMove(arrowId);
      }, ANIMATIONS.arrowError);
    } else {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
      
      // === ФАЗА 4: BATCH REMOVAL ===
      // Собираем ВСЕ ID для удаления в один массив → один вызов → один ре-рендер
      const idsToRemove: string[] = [arrowId];
      
      if (result.bombExplosion?.length) {
        for (const exploded of result.bombExplosion) {
          idsToRemove.push(exploded.id);
        }
        // Тяжёлый haptic для бомбы
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('heavy');
      }
      
      if (result.electricTarget) {
        idsToRemove.push(result.electricTarget.id);
      }
      
      // Один вызов — один set() — один ре-рендер — одна запись в history
      if (idsToRemove.length === 1) {
        removeArrow(arrowId);  // Обычная стрелка — простой путь
      } else {
        removeArrows(idsToRemove);  // Batch: бомба/электро
      }
    }
  }, [clearHint, setShakingArrow, failMove, removeArrow, removeArrows]);

  // === ПОДСКАЗКА ===
  const handleHint = useCallback(() => {
    const { arrows: currentArrows, gridSize: currentGrid, hintsRemaining: hints } = useGameStore.getState();
    if (hints <= 0) return;
    const free = getFreeArrows(currentArrows, { width: currentGrid.width, height: currentGrid.height });
    if (free.length > 0) showHint(free[0].id);
  }, [showHint]);

  // === UI HANDLERS ===
  const onRestartClick = useCallback(() => setConfirmAction('restart'), []);
  const onMenuClick = useCallback(() => setConfirmAction('menu'), []);
  const confirmRestart = useCallback(() => { setConfirmAction(null); loadLevel(currentLevel); }, [currentLevel, loadLevel]);
  const confirmMenu = useCallback(() => { setConfirmAction(null); setScreen('home'); }, [setScreen]);
  const handleNextLevel = useCallback(() => setCurrentLevel(prev => prev + 1), []);
  
  const handleDevReset = useCallback(async () => {
    if (!confirm('⚠️ СБРОС ПРОГРЕССА (DEV)\n\nВы вернетесь на Уровень 1.\n\nТочно?')) return;
    try { await gameApi.resetProgress(); setCurrentLevel(1); window.location.reload(); } 
    catch (e) { console.error(e); }
  }, []);

  const livesUI = useMemo(() => (
    <div className="flex gap-1.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <motion.div key={i} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.1 }}>
          <Heart size={24} fill={i < lives ? '#ef4444' : 'transparent'} stroke={i < lives ? '#ef4444' : 'rgba(255,255,255,0.3)'} strokeWidth={2} />
        </motion.div>
      ))}
    </div>
  ), [lives]);

  const renderModeLabel = useCanvas ? '🖼 Canvas' : '🎨 SVG';

  return (
    <div 
      className="relative w-full h-screen overflow-hidden font-sans select-none touch-none"
      style={{ backgroundImage: `url(${gameBgImage})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: '#1e3a52' }}
    >
      <div className="relative z-10 flex flex-col h-full mx-auto pointer-events-none">
        
        {/* HEADER */}
        <div className="flex justify-center items-center p-4 pt-6 safe-area-top gap-4 pointer-events-auto">
          <div className="bg-slate-800/80 backdrop-blur-md px-6 py-2 rounded-2xl border border-white/10 shadow-lg flex items-center gap-2">
            <span className="text-white/60 text-xs font-medium uppercase tracking-wider">Level</span>
            <span className="text-white font-bold text-xl">{currentLevel}</span>
          </div>
          <div className="bg-slate-800/80 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10 shadow-lg">
            {livesUI}
          </div>
          <div className="bg-slate-800/60 px-3 py-1 rounded-xl border border-white/5">
            <span className="text-white/40 text-[10px] font-mono">{renderModeLabel} {gridSize.width}×{gridSize.height}</span>
          </div>
        </div>
        
        {/* GAME AREA */}
        <div 
          ref={containerRef} 
          className="flex-1 overflow-hidden relative pointer-events-auto"
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {noMoreLevels ? (
            <div className="flex h-full items-center justify-center">
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center bg-slate-900/80 backdrop-blur-xl p-8 rounded-3xl border border-white/20 shadow-2xl max-w-xs">
                  <div className="text-5xl mb-4">🎉</div>
                  <h2 className="text-2xl font-bold text-white mb-2">Скоро новые уровни!</h2>
                  <button onClick={() => setScreen('home')} className="w-full py-3 bg-blue-600 rounded-xl text-white font-bold mt-4">В меню</button>
                </motion.div>
            </div>
          ) : status === 'loading' ? (
            <div className="flex h-full items-center justify-center flex-col">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-16 h-16 border-4 border-white/20 border-t-white rounded-full mb-4" />
              <span className="text-white/70 text-sm font-medium">Загрузка...</span>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
                <div
                    style={{
                        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
                        transition: isDragging ? 'none' : 'transform 0.2s ease-out',
                    }}
                >
                  <div 
                      className="game-field relative rounded-lg overflow-visible transition-all duration-300"
                      style={{ 
                          width: (gridSize.width + 0.4) * baseCellSize,
                          height: (gridSize.height + 0.4) * baseCellSize,
                          padding: (baseCellSize * 0.2),
                      }}
                  >
                    {useCanvas ? (
                      <Suspense fallback={
                        <div className="flex items-center justify-center" style={{ width: gridSize.width * baseCellSize, height: gridSize.height * baseCellSize }}>
                          <span className="text-white/50 text-sm">Загрузка Canvas...</span>
                        </div>
                      }>
                        <CanvasBoard
                          arrows={arrows}
                          gridSize={gridSize}
                          cellSize={baseCellSize}
                          hintedArrowId={hintedArrowId}
                          onArrowClick={handleArrowClick}
                        />
                      </Suspense>
                    ) : (
                      <GameBoard 
                        key={`level-${currentLevel}-${gridSize.width}x${gridSize.height}`}
                        arrows={arrows} 
                        gridSize={gridSize} 
                        cellSize={baseCellSize} 
                        hintedArrowId={hintedArrowId} 
                        onArrowClick={handleArrowClick} 
                      />
                    )}
                  </div>
                </div>
            </div>
          )}
          
          {/* Zoom Controls */}
          <div className="absolute top-4 right-4 flex flex-col gap-2">
             <button onClick={() => setTransform(p => ({...p, k: Math.min(3, p.k + 0.2)}))} className="p-2 bg-black/40 rounded-full text-white/70 hover:text-white"><ZoomIn size={20}/></button>
             <button onClick={() => setTransform(p => ({...p, k: Math.max(0.5, p.k - 0.2)}))} className="p-2 bg-black/40 rounded-full text-white/70 hover:text-white"><ZoomOut size={20}/></button>
             <button onClick={resetZoom} className="p-2 bg-black/40 rounded-full text-white/70 hover:text-white"><Maximize size={20}/></button>
          </div>
        </div>
        
        {/* FOOTER */}
        <div className="flex flex-col items-center px-4 pb-8 safe-bottom pointer-events-auto bg-gradient-to-t from-slate-900/80 to-transparent pt-4">
          {!noMoreLevels && (
            <div className="flex justify-center items-center gap-3 w-full max-w-sm">
              <motion.button whileTap={{ scale: 0.9 }} onClick={onMenuClick} className="bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-lg"><span className="text-white font-bold text-xs">MENU</span></motion.button>
              <motion.button whileTap={{ scale: 0.9 }} onClick={onRestartClick} className="bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-lg"><RefreshCw size={24} className="text-white" /></motion.button>
              <motion.button whileTap={{ scale: 0.9 }} onClick={handleHint} disabled={hintsRemaining === 0} className="flex-1 bg-gradient-to-br from-amber-600/90 to-orange-600/90 backdrop-blur-md p-4 rounded-2xl border border-amber-500/30 flex items-center justify-center gap-3 shadow-lg"><Lightbulb size={24} className={hintsRemaining > 0 ? 'text-yellow-100' : 'text-white/30'} /><span className="text-white font-bold text-lg">{hintsRemaining}</span></motion.button>
              <motion.button whileTap={{ scale: 0.9 }} onClick={undo} disabled={history.length === 0} className="bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-lg"><RotateCcw size={24} className="text-white" /></motion.button>
            </div>
          )}
          
          <div className="flex flex-col items-center gap-2 mt-4 opacity-90 transition-opacity w-full">
              <div className="flex items-center gap-2 text-white/50 text-xs uppercase tracking-widest mb-1">Навигация</div>
              <div className="flex items-center gap-3 bg-slate-900/50 p-2 rounded-xl border border-white/10">
                <button onClick={() => setCurrentLevel(l => Math.max(1, l - 1))} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white disabled:opacity-30" disabled={currentLevel <= 1}>←</button>
                {[1, 5, 10, 15, 20].map(lvl => (
                  <button key={lvl} onClick={() => setCurrentLevel(lvl)} className={`px-3 py-1 text-xs rounded-lg font-bold ${currentLevel === lvl ? 'bg-blue-500 text-white' : 'bg-white/5 text-white/60'}`}>{lvl}</button>
                ))}
                <button onClick={() => setCurrentLevel(l => l + 1)} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white">→</button>
                <div className="w-px h-6 bg-white/10 mx-1"></div>
                <button onClick={handleDevReset} className="p-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20"><Trash2 size={16} /></button>
              </div>
          </div>
        </div>
      </div>
      
      <AnimatePresence>
        {confirmAction && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm pointer-events-auto">
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="w-full max-w-xs bg-slate-900 border border-white/10 rounded-3xl p-6 text-center shadow-2xl">
              <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto mb-4"><AlertTriangle size={32} className="text-yellow-500" /></div>
              <h3 className="text-xl font-bold text-white mb-2">{confirmAction === 'restart' ? 'Начать заново?' : 'Выйти в меню?'}</h3>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setConfirmAction(null)} className="flex-1 py-3 bg-white/5 rounded-xl text-white">Отмена</button>
                <button onClick={confirmAction === 'restart' ? confirmRestart : confirmMenu} className="flex-1 py-3 bg-red-500 rounded-xl text-white font-bold">{confirmAction === 'restart' ? 'Рестарт' : 'Выйти'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      
      <AnimatePresence>
        {(status === 'victory' || status === 'defeat') && !noMoreLevels && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto">
             <motion.div initial={{ scale: 0.8, y: 50 }} animate={{ scale: 1, y: 0 }} className="w-full max-w-sm bg-gradient-to-br from-slate-900/95 to-blue-900/95 backdrop-blur-xl rounded-3xl border border-white/20 shadow-2xl p-8 text-center">
                <h2 className="text-4xl font-black text-white mb-2">{status === 'victory' ? 'Victory!' : 'Game Over'}</h2>
                <div className="space-y-3 mt-6">
                    <button onClick={status === 'victory' ? handleNextLevel : confirmRestart} className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl shadow-lg">{status === 'victory' ? 'Next Level' : 'Retry'}</button>
                    <button onClick={confirmMenu} className="w-full bg-white/10 text-white font-medium py-3 rounded-2xl">Menu</button>
                </div>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}