import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardList, Trophy, Users, Share2, Youtube, Send, CheckCircle2, Lock, Puzzle } from 'lucide-react';

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

  const handleTaskClick = (task: Task) => {
    if (task.locked) return;

    if (!task.completed) {
      console.log('Completing task:', task.id);
      setTasks(prev => prev.map(t =>
        t.id === task.id ? { ...t, completed: true } : t,
      ));
    }
  };

  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.completed === b.completed) return 0;
    return a.completed ? -1 : 1;
  });

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
    <div className="px-4 pb-24 pt-4 h-full flex flex-col">
      <div className="mb-6 text-center shrink-0">
        <div className="relative inline-block">
          <ClipboardList size={48} className="mx-auto text-purple-400 mb-2 drop-shadow-[0_0_15px_rgba(168,85,247,0.4)]" />
        </div>
        <h2 className="text-2xl font-bold text-white">Задания</h2>
        <p className="text-white/60 text-sm">Выполняй задания и получай награды</p>
      </div>

      <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-1 mb-6 flex relative border border-white/10 shrink-0">
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

      <div className="flex-1 overflow-y-auto custom-scrollbar relative">
        <AnimatePresence mode="wait">
          {activeTab === 'tasks' ? (
            <motion.div key="tasks" {...tabTransition} className="space-y-3 pb-2">
              <AnimatePresence mode="popLayout">
                {sortedTasks.map((task, i) => (
                  <motion.div
                    key={task.id}
                    layout
                    custom={i}
                    variants={itemVariant}
                    initial="hidden"
                    animate="visible"
                    onClick={() => handleTaskClick(task)}
                    className={`
                      relative border rounded-2xl p-4
                      ${task.completed
                        ? 'bg-green-500/10 border-green-500/30'
                        : task.locked
                          ? 'bg-white/5 border-white/5 opacity-50 cursor-not-allowed'
                          : 'bg-white/5 border-white/10 hover:bg-white/10 cursor-pointer'
                      }
                      transition-colors overflow-hidden group
                    `}
                  >
                    {!task.locked && !task.completed && (
                      <div className="absolute inset-0 bg-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}

                    <div className="flex items-center gap-4 relative z-10">
                      <div className={`
                        w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors
                        ${task.completed
                          ? 'bg-green-500/20 text-green-400'
                          : task.locked
                            ? 'bg-gray-500/20 text-gray-400'
                            : 'bg-gradient-to-br from-purple-500/20 to-blue-500/20 text-purple-400'
                        }
                      `}>
                        {task.completed ? <CheckCircle2 size={24} /> : <task.icon size={24} />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3 className={`font-bold text-sm mb-1 truncate transition-colors ${task.completed ? 'text-green-400' : 'text-white'}`}>
                          {task.title}
                        </h3>
                        <p className="text-white/50 text-xs truncate">{task.description}</p>
                      </div>

                      <div className="text-right flex-shrink-0">
                        {task.completed ? (
                          <span className="text-xs font-bold text-green-400 uppercase tracking-wider bg-green-400/10 px-2 py-1 rounded-lg">
                            Выполнено
                          </span>
                        ) : (
                          <div className="flex flex-col items-end">
                            <div className="text-yellow-400 font-bold text-lg leading-none">+{task.reward}</div>
                            <div className="text-yellow-400/60 text-[10px] uppercase mt-1">монет</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div key="fragments" {...tabTransition} className="h-full flex items-center justify-center px-2">
              <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 backdrop-blur-lg p-6 text-center">
                <Puzzle size={42} className="mx-auto text-white/50 mb-3" />
                <h3 className="text-white text-xl font-bold mb-2">Фрагменты</h3>
                <p className="text-white/60 text-sm">Скоро появится</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
