import { motion } from 'framer-motion';
import { ClipboardList, Trophy, Users, Share2, Youtube, Send, CheckCircle2, Lock } from 'lucide-react';

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
  const tasks: Task[] = [
    {
      id: 1,
      title: 'Подпишись на канал',
      description: 'Подпишись на наш Telegram канал',
      reward: 100,
      icon: Send,
      completed: false,
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
  ];

  const handleTaskClick = (task: Task) => {
    if (task.locked || task.completed) return;
    console.log('Starting task:', task.id);
    // TODO: Интеграция с backend
  };

  return (
    <div className="px-4 pb-24 pt-4 h-full flex flex-col">
      
      {/* Header */}
      <div className="mb-6 text-center">
        <ClipboardList size={48} className="mx-auto text-purple-400 mb-2" />
        <h2 className="text-2xl font-bold text-white">Задания</h2>
        <p className="text-white/60 text-sm">Выполняй задания и получай награды</p>
      </div>

      {/* Tasks List */}
      <div className="space-y-3 overflow-y-auto custom-scrollbar flex-1">
        {tasks.map((task, i) => (
          <motion.div
            key={task.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08, type: 'spring' }}
            onClick={() => handleTaskClick(task)}
            className={`
              bg-white/5 border border-white/10 rounded-2xl p-4 
              ${task.locked || task.completed 
                ? 'opacity-50 cursor-not-allowed' 
                : 'hover:bg-white/10 cursor-pointer'
              }
              transition-all relative overflow-hidden group
            `}
          >
            {!task.locked && !task.completed && (
              <div className="absolute inset-0 bg-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            )}

            <div className="flex items-center gap-4 relative z-10">
              {/* Icon */}
              <div className={`
                w-14 h-14 rounded-2xl flex items-center justify-center
                ${task.completed 
                  ? 'bg-green-500/20' 
                  : task.locked 
                    ? 'bg-gray-500/20' 
                    : 'bg-gradient-to-br from-purple-500/20 to-blue-500/20'
                }
              `}>
                {task.completed ? (
                  <CheckCircle2 size={28} className="text-green-400" />
                ) : (
                  <task.icon 
                    size={28} 
                    className={task.locked ? 'text-gray-400' : 'text-purple-400'} 
                  />
                )}
              </div>

              {/* Content */}
              <div className="flex-1">
                <h3 className="text-white font-bold text-sm mb-1">{task.title}</h3>
                <p className="text-white/50 text-xs">{task.description}</p>
              </div>

              {/* Reward */}
              <div className="text-right">
                <div className="text-yellow-400 font-bold text-lg">+{task.reward}</div>
                <div className="text-yellow-400/60 text-xs">монет</div>
              </div>
            </div>

            {/* Progress bar (for future) */}
            {!task.completed && !task.locked && (
              <div className="mt-3 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 w-0"></div>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Stats Footer */}
      <div className="mt-4 bg-white/5 border border-white/10 rounded-2xl p-4 flex justify-around">
        <div className="text-center">
          <div className="text-white font-bold text-xl">0/6</div>
          <div className="text-white/50 text-xs">Выполнено</div>
        </div>
        <div className="w-px bg-white/10"></div>
        <div className="text-center">
          <div className="text-yellow-400 font-bold text-xl">0</div>
          <div className="text-white/50 text-xs">Заработано</div>
        </div>
      </div>
    </div>
  );
}