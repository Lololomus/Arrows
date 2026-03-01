import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardList, Trophy, Users, Share2, Youtube, Send, CheckCircle2, Lock, Puzzle, Coins, Sparkles } from 'lucide-react';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';

// ==========================================
// TELEGRAM HAPTICS HELPER
// ==========================================
const triggerHaptic = (style: 'light' | 'medium' | 'heavy' | 'selection' | 'success') => {
  const tg = (window as any).Telegram?.WebApp;
  if (!tg?.HapticFeedback) return;
  
  if (style === 'selection') {
    tg.HapticFeedback.selectionChanged();
  } else if (style === 'success') {
    tg.HapticFeedback.notificationOccurred('success');
  } else {
    tg.HapticFeedback.impactOccurred(style);
  }
};

// ==========================================
// COMPONENTS
// ==========================================

function BottomCoinStash({ balance, isPulsing }: { balance: number, isPulsing: boolean }) {
  return (
    <motion.div 
      animate={isPulsing ? { scale: [1, 1.02, 1], y: [0, 4, 0] } : { scale: 1, y: 0 }}
      transition={{ duration: 0.4, type: "spring", stiffness: 350, damping: 18 }}
      className="relative overflow-hidden rounded-3xl border border-yellow-300/30 bg-[#14162a]/80 backdrop-blur-2xl shadow-[0_16px_40px_rgba(0,0,0,0.8)] w-full pointer-events-auto"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 via-yellow-300/10 to-amber-500/10" />
      
      {/* Вспышка-удар при зачислении */}
      <motion.div 
        animate={isPulsing ? { opacity: [0, 0.6, 0], scale: [1, 1.1, 1] } : { opacity: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="absolute inset-0 bg-yellow-300/30 blur-xl mix-blend-overlay pointer-events-none" 
      />
      
      <div className="relative flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-4">
          <motion.div 
            animate={isPulsing ? { rotate: [0, -15, 10, 0], scale: [1, 1.1, 1] } : { rotate: 0, scale: 1 }}
            transition={{ duration: 0.6, type: "spring" }}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-yellow-200/40 bg-gradient-to-br from-yellow-300/20 to-amber-500/10 text-yellow-300 shadow-[0_0_20px_rgba(250,204,21,0.3)]"
          >
            <Coins size={24} strokeWidth={2.5} className="drop-shadow-lg" />
          </motion.div>
          <div className="leading-tight">
            <p className="text-[12px] font-bold uppercase tracking-[0.25em] text-yellow-200/60 mb-0.5">Баланс</p>
            {/* Сами цифры вспыхивают белым и увеличиваются */}
            <motion.p 
              key={balance}
              initial={{ scale: 1.4, color: '#ffffff', textShadow: '0 0 20px rgba(250,204,21,0.8)' }}
              animate={{ scale: 1, color: '#fef08a', textShadow: '0 0 0px rgba(250,204,21,0)' }}
              transition={{ type: 'spring', stiffness: 350, damping: 20 }}
              className="text-3xl font-black text-yellow-300 drop-shadow-[0_0_12px_rgba(250,204,21,0.4)] tabular-nums tracking-tight origin-left"
            >
              {balance.toLocaleString()}
            </motion.p>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <span className="rounded-full border border-yellow-300/40 bg-yellow-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-yellow-100/90 shadow-inner">
            Wallet
          </span>
        </div>
      </div>
    </motion.div>
  );
}

interface Task {
  id: number;
  title: string;
  description: string;
  reward: number;
  icon: any;
  completed: boolean;
  locked: boolean;
}

export function TasksScreen() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [activeTab, setActiveTab] = useState<'tasks' | 'fragments'>('tasks');
  const [tasks, setTasks] = useState<Task[]>([
    {
      id: 1,
      title: 'Подпишись на канал',
      description: 'Подпишись на наш Telegram канал',
      reward: 100,
      icon: Send,
      completed: true,
      locked: false,
    },
    {
      id: 2,
      title: 'Пригласи 3 друзей',
      description: 'Пригласи друзей по реферальной ссылке',
      reward: 500,
      icon: Users,
      completed: false,
      locked: false,
    },
    {
      id: 3,
      title: 'Пройди 10 уровней',
      description: 'Завершите первые 10 уровней',
      reward: 200,
      icon: Trophy,
      completed: false,
      locked: false,
    },
    {
      id: 4,
      title: 'Поделись игрой',
      description: 'Поделись игрой в своей истории',
      reward: 150,
      icon: Share2,
      completed: false,
      locked: false,
    },
    {
      id: 5,
      title: 'Посмотри видео',
      description: 'Посмотри наш обучающий ролик',
      reward: 50,
      icon: Youtube,
      completed: false,
      locked: false,
    },
    {
      id: 6,
      title: 'VIP задание',
      description: 'Доступно только для VIP',
      reward: 1000,
      icon: Lock,
      completed: false,
      locked: true,
    },
  ]);

  // Анимации и стейт для JIT Кошелька и Монет
  const [flyingCoins, setFlyingCoins] = useState<any[]>([]);
  const [isStashVisible, setIsStashVisible] = useState(false);
  const [isStashPulsing, setIsStashPulsing] = useState(false);
  const stashHideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const coinTargetAnchorRef = useRef<HTMLDivElement>(null);
  
  // Моковый баланс для демонстрации стэша (в проде забирай из стора)
  const [userCoins, setUserCoins] = useState(1250);

  const showStashWithTimer = useCallback(() => {
    setIsStashVisible(true);
    if (stashHideTimerRef.current) clearTimeout(stashHideTimerRef.current);
    stashHideTimerRef.current = setTimeout(() => setIsStashVisible(false), 3500);
  }, []);

  const triggerStashPulse = () => {
    setIsStashPulsing(true);
    setTimeout(() => setIsStashPulsing(false), 400);
  };

  const handleTaskClick = (task: Task, event: React.MouseEvent) => {
    if (task.locked || task.completed) return;

    // Мощный тактильный старт
    triggerHaptic('heavy');
    showStashWithTimer();

    // 1. Координаты старта (Центр кнопки)
    const containerRect = containerRef.current?.getBoundingClientRect();
    const buttonRect = event.currentTarget.getBoundingClientRect();
    
    if (!containerRect) return;

    const startX = buttonRect.left - containerRect.left + buttonRect.width / 2;
    const startY = buttonRect.top - containerRect.top + buttonRect.height / 2;

    // 2. Координаты финиша (Точно в якорь цифр)
    const targetRect = coinTargetAnchorRef.current?.getBoundingClientRect();
    const targetCenterX = targetRect ? targetRect.left - containerRect.left + targetRect.width / 2 : containerRect.width / 2;
    const targetCenterY = targetRect ? targetRect.top - containerRect.top + targetRect.height / 2 : containerRect.height - 80;

    // 3. Генерация частиц (монеток)
    const coinsToSpawn = Math.min(12, Math.max(6, Math.floor(task.reward / 10)));
    const newCoins = Array.from({ length: coinsToSpawn }).map((_, i) => {
      const jumpX = (Math.random() - 0.5) * 80;  
      const jumpY = -(Math.random() * 50 + 20);  
      
      const endSpreadX = (Math.random() - 0.5) * 30;
      const endSpreadY = (Math.random() - 0.5) * 15;

      return {
        id: Date.now() + '-' + i,
        startX, startY,
        midX: startX + jumpX,
        midY: startY + jumpY,
        endX: targetCenterX + endSpreadX,
        endY: targetCenterY + endSpreadY,
        rotation: Math.random() > 0.5 ? 360 : -360,
        delay: i * 0.04, 
      };
    });

    setFlyingCoins(prev => [...prev, ...newCoins]);

    // Обновляем статус задания
    setTasks(prev => prev.map(t =>
      t.id === task.id ? { ...t, completed: true } : t,
    ));

    // Haptic Rhythm
    newCoins.forEach((c) => {
      const hitTime = 800 + (c.delay * 1000);
      setTimeout(() => {
        triggerHaptic('light');
        triggerStashPulse();
      }, hitTime);
    });

    // Обновление баланса (Когда приземляется ПЕРВАЯ монетка)
    setTimeout(() => {
      setUserCoins(prev => prev + task.reward);
      triggerHaptic('success');
      showStashWithTimer();
    }, 900);

    // Очистка DOM
    setTimeout(() => {
      setFlyingCoins(prev => prev.filter(c => !newCoins.map(nc => nc.id).includes(c.id)));
    }, 1600);
  };

  const completedTasks = tasks.filter((task) => task.completed);
  const pendingTasks = tasks.filter((task) => !task.completed);

  const itemVariant = {
    hidden: { opacity: 0, x: -20 },
    visible: (i: number) => ({
      opacity: 1,
      x: 0,
      transition: {
        delay: i * 0.05,
        duration: 0.3,
        type: 'spring',
        stiffness: 350,
        damping: 25,
      },
    }),
  };

  const tabTransition = {
    initial: { opacity: 0, x: -10 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 10 },
    transition: { duration: 0.2 },
  };

  return (
    <div ref={containerRef} className="px-4 pb-nav pt-6 h-full flex flex-col relative overflow-hidden">
      <AdaptiveParticles
        variant="bg"
        tone="neutral"
        baseCount={16}
        baseSpeed={0.09}
        className="z-0 opacity-30"
      />

      {/* АНИМАЦИОННЫЙ СЛОЙ ФИЗИКИ МОНЕТ (GPU Accelerated) */}
      <div className="absolute inset-0 pointer-events-none z-[150] overflow-hidden">
        <AnimatePresence>
          {flyingCoins.map((coin) => (
            <motion.div
              key={coin.id}
              style={{ willChange: "transform" }}
              initial={{ x: coin.startX, y: coin.startY, scale: 0, opacity: 0, rotate: 0 }}
              animate={{ 
                x: [coin.startX, coin.midX, coin.endX], 
                y: [coin.startY, coin.midY, coin.endY], 
                scale: [0, 1.2, 0.5], 
                scaleY: [0, 1.2, 0.8], // Motion Stretch
                opacity: [0, 1, 1, 0],
                rotate: [0, coin.rotation, coin.rotation * 1.2]
              }}
              transition={{ 
                duration: 0.9, 
                delay: coin.delay, 
                times: [0, 0.45, 1], 
                ease: ["easeOut", "easeInOut"] 
              }}
              className="absolute -ml-4 -mt-4 text-amber-400 drop-shadow-[0_0_15px_rgba(245,158,11,0.8)]"
            >
              <Coins size={36} fill="#f59e0b" className="text-yellow-100" />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* TABS (Оригинал) */}
      <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-1 mt-2 mb-6 flex relative border border-white/10 shrink-0">
        <motion.div
          className="absolute top-1 bottom-1 bg-white/10 rounded-xl shadow-sm"
          initial={false}
          animate={{
            left: activeTab === 'tasks' ? '4px' : '50%',
            width: 'calc(50% - 6px)',
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
        <button
          onClick={() => setActiveTab('tasks')}
          className={`flex-1 py-3 text-sm font-bold z-10 transition-colors ${activeTab === 'tasks' ? 'text-white' : 'text-white/50'}`}
        >
          <ClipboardList size={16} className="inline mr-1 mb-1" /> Задания
        </button>
        <button
          onClick={() => setActiveTab('fragments')}
          className={`flex-1 py-3 text-sm font-bold z-10 transition-colors ${activeTab === 'fragments' ? 'text-white' : 'text-white/50'}`}
        >
          <Puzzle size={16} className="inline mr-1 mb-1" /> Фрагменты
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar relative pb-32">
        <AnimatePresence mode="wait">
          {activeTab === 'tasks' ? (
            <motion.div key="tasks" {...tabTransition} className="space-y-3.5 pb-2">
              <AnimatePresence mode="popLayout">
                {/* ВЫПОЛНЕННЫЕ ЗАДАНИЯ (Улучшенные тени) */}
                {completedTasks.length > 0 && (
                  <div className="relative space-y-3.5 mb-6">
                    <AdaptiveParticles
                      variant="accent"
                      tone="green"
                      baseCount={14}
                      baseSpeed={0.15}
                      className="z-0 opacity-55"
                    />
                    <div className="relative z-10 space-y-3.5">
                      {completedTasks.map((task, i) => (
                        <motion.div
                          key={task.id}
                          layout
                          custom={i}
                          variants={itemVariant}
                          initial="hidden"
                          animate="visible"
                          className="relative border rounded-3xl p-4 bg-emerald-500/10 border-emerald-500/30 shadow-[inset_0_0_20px_rgba(16,185,129,0.05)] transition-colors overflow-hidden group"
                        >
                          <div className="flex items-center gap-4 relative z-10">
                            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 bg-emerald-500/20 text-emerald-400 p-[1px]">
                              <div className="w-full h-full bg-[#111322] rounded-2xl flex items-center justify-center shadow-inner">
                                <CheckCircle2 size={26} className="drop-shadow-md text-emerald-400" />
                              </div>
                            </div>

                            <div className="flex-1 min-w-0 py-0.5">
                              <h3 className="font-extrabold text-[16px] mb-1 truncate text-emerald-400">
                                {task.title}
                              </h3>
                              <p className="text-emerald-400/60 text-xs truncate font-medium">Выполнено</p>
                            </div>

                            <div className="text-right flex-shrink-0">
                              <div className="flex flex-col items-end px-2">
                                <div className="text-emerald-400/50 font-black text-xl leading-none">+{task.reward}</div>
                                <div className="text-emerald-500/40 text-[10px] font-bold uppercase mt-1 tracking-widest">монет</div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}

                {/* АКТИВНЫЕ ЗАДАНИЯ (GLASS-Стиль + Кнопка) */}
                {pendingTasks.map((task, i) => (
                  <motion.div
                    key={task.id}
                    layout
                    custom={i + completedTasks.length}
                    variants={itemVariant}
                    initial="hidden"
                    animate="visible"
                    className={`
                      relative border rounded-3xl p-4 overflow-hidden group transition-all duration-300
                      ${task.locked
                        ? 'bg-white/5 border-white/5 opacity-50 cursor-not-allowed'
                        : 'bg-[#1e2341]/80 border-amber-500/40 backdrop-blur-xl shadow-[0_8px_32px_rgba(245,158,11,0.15),inset_0_2px_20px_rgba(255,255,255,0.05)] hover:border-amber-400/60'
                      }
                    `}
                  >
                    {!task.locked && (
                      <>
                        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-orange-600/5 animate-pulse" />
                        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />
                      </>
                    )}

                    <div className="flex items-center gap-4 relative z-10">
                      <div className={`
                        w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 p-[1px]
                        ${task.locked
                          ? 'bg-gray-500/20 text-gray-400'
                          : 'bg-gradient-to-br from-purple-500/20 to-blue-500/20 text-purple-400'
                        }
                      `}>
                        <div className="w-full h-full bg-[#111322] rounded-2xl flex items-center justify-center shadow-inner">
                          <task.icon size={26} className="drop-shadow-md" />
                        </div>
                      </div>

                      <div className="flex-1 min-w-0 py-0.5">
                        <h3 className="font-extrabold text-[16px] mb-1 truncate text-white">
                          {task.title}
                        </h3>
                        <p className="text-white/50 text-xs truncate">{task.description}</p>
                        {!task.locked && (
                          <div className="text-amber-400 font-bold text-sm mt-1.5 drop-shadow-[0_0_5px_rgba(251,191,36,0.5)]">
                            +{task.reward} монет
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 flex flex-col items-end justify-center">
                        {task.locked ? (
                          <div className="flex flex-col items-end px-2">
                            <div className="text-yellow-400/50 font-black text-xl leading-none">+{task.reward}</div>
                            <div className="text-yellow-500/40 text-[10px] font-bold uppercase mt-1 tracking-widest">монет</div>
                          </div>
                        ) : (
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.9 }} 
                            onClick={(e) => handleTaskClick(task, e)}
                            className="relative overflow-hidden bg-gradient-to-b from-amber-400 to-orange-600 text-white font-black text-[12px] uppercase tracking-wider px-5 py-3.5 rounded-xl shadow-[0_8px_20px_rgba(245,158,11,0.5),inset_0_2px_0_rgba(255,255,255,0.4)] flex items-center gap-1.5 min-w-[100px] justify-center"
                          >
                            <motion.div 
                              animate={{ x: ["-100%", "200%"] }}
                              transition={{ duration: 1.5, repeat: Infinity, ease: "linear", repeatDelay: 1 }}
                              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12"
                            />
                            <Sparkles size={16} className="relative z-10 text-yellow-100" />
                            <span className="relative z-10 drop-shadow-md">ЗАБРАТЬ</span>
                          </motion.button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div key="fragments" {...tabTransition} className="h-full flex items-center justify-center px-2">
              <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#1e2341]/40 backdrop-blur-2xl p-8 text-center relative overflow-hidden shadow-2xl">
                <AdaptiveParticles
                  variant="accent"
                  tone="neutral"
                  baseCount={12}
                  baseSpeed={0.14}
                  className="z-0 opacity-55"
                />
                <Puzzle size={56} className="mx-auto text-white/20 mb-4 relative z-10 drop-shadow-lg" />
                <h3 className="text-white text-2xl font-black mb-2 relative z-10 tracking-wide">Фрагменты</h3>
                <p className="text-white/50 text-sm relative z-10 max-w-[200px] mx-auto leading-relaxed">
                  Скоро появятся кусочки мозаики для уникальных скинов!
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ЯКОРЬ ДЛЯ ЦИФР (Служит мишенью для монеток) */}
      <div className="absolute bottom-[110px] left-4 right-4 z-0 pointer-events-none flex justify-center h-[80px]">
        <div className="w-full relative">
          <div ref={coinTargetAnchorRef} className="absolute left-[84px] top-[32px] w-[80px] h-[36px]" />
        </div>
      </div>

      {/* ВСПЛЫВАЮЩИЙ КОШЕЛЕК */}
      <div className="absolute bottom-6 left-4 right-4 z-[120] pointer-events-none flex justify-center">
        <AnimatePresence>
          {isStashVisible && (
            <motion.div
              initial={{ y: 100, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 100, opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              className="w-full relative pointer-events-auto"
            >
              <BottomCoinStash balance={userCoins} isPulsing={isStashPulsing} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}