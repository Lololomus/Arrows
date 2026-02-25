import { memo, useCallback, useEffect, useRef, type MouseEvent } from 'react';
import { motion } from 'framer-motion';
import { Users, ClipboardList, Gamepad2, Trophy, ShoppingBag } from 'lucide-react';
import { UI_ANIMATIONS } from '../config/constants';

export type TabId = 'friends' | 'tasks' | 'play' | 'leaderboard' | 'shop';

interface BottomNavProps {
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
}

interface TabConfig {
  id: TabId;
  label: string;
  icon: typeof Users;
  isMain?: boolean;
}

const tabs: TabConfig[] = [
  { id: 'friends', label: 'Друзья', icon: Users },
  { id: 'tasks', label: 'Задания', icon: ClipboardList },
  { id: 'play', label: 'Играть', icon: Gamepad2, isMain: true },
  { id: 'leaderboard', label: 'Топ', icon: Trophy },
  { id: 'shop', label: 'Магазин', icon: ShoppingBag },
];

const fadeDuration = UI_ANIMATIONS.fade / 1000;
const scaleDuration = UI_ANIMATIONS.scale / 1000;

const BottomNavComponent = ({ activeTab, onTabChange }: BottomNavProps) => {
  const navRef = useRef<HTMLDivElement>(null);

  const handleTabClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const id = event.currentTarget.dataset.tabId as TabId | undefined;
      if (!id || id === activeTab) {
        return;
      }

      const tg = (window as any).Telegram?.WebApp;
      if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');

      onTabChange(id);
    },
    [activeTab, onTabChange]
  );

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const rootStyle = document.documentElement.style;
    const writeNavOffset = () => {
      const measuredHeight = Math.ceil(nav.getBoundingClientRect().height);
      if (measuredHeight > 0) {
        rootStyle.setProperty('--app-bottom-nav-offset', `${measuredHeight}px`);
      }
    };

    writeNavOffset();
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(writeNavOffset) : null;
    resizeObserver?.observe(nav);
    window.addEventListener('resize', writeNavOffset);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', writeNavOffset);
      rootStyle.setProperty('--app-bottom-nav-offset', '96px');
    };
  }, []);

  return (
    <div
      ref={navRef}
      data-bottom-nav
      className="absolute bottom-0 left-0 z-30 w-full bg-slate-950 border-t border-slate-800 pb-6 pt-2 px-2 rounded-t-3xl safe-bottom shadow-[0_-8px_24px_rgba(0,0,0,0.35)]"
    >
      <div className="flex justify-around items-end">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              data-tab-id={tab.id}
              onClick={handleTabClick}
              className={`relative flex flex-col items-center justify-center p-2 transition-all duration-300 ${tab.isMain ? '-mt-8' : ''}`}
            >
              {isActive && !tab.isMain && (
                <motion.div
                  layoutId="nav-pill"
                  className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent rounded-2xl -z-10"
                  initial={false}
                  transition={UI_ANIMATIONS.spring}
                />
              )}

              <motion.div
                animate={{
                  y: isActive ? -4 : 0,
                  scale: isActive ? 1.1 : 1,
                }}
                transition={{
                  ...UI_ANIMATIONS.spring,
                  duration: scaleDuration,
                }}
                className={`
                  ${tab.isMain
                    ? `w-16 h-16 bg-gradient-to-tr from-blue-600 to-cyan-500 rounded-full flex items-center justify-center shadow-lg shadow-cyan-500/30 border-4 border-slate-900 ${isActive ? 'drop-shadow-glow' : ''}`
                    : 'w-10 h-10 flex items-center justify-center'
                  }
                `}
              >
                <tab.icon
                  size={tab.isMain ? 32 : 24}
                  className={isActive ? 'text-white' : 'text-slate-400'}
                  strokeWidth={isActive ? 2.5 : 2}
                />
              </motion.div>

              {!tab.isMain && (
                <motion.span
                  animate={{
                    opacity: isActive ? 1 : 0.6,
                    scale: isActive ? 1 : 0.9,
                    color: isActive ? '#ffffff' : '#94a3b8',
                  }}
                  transition={{ duration: fadeDuration }}
                  className="text-[10px] font-medium mt-1"
                >
                  {tab.label}
                </motion.span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const BottomNav = memo(BottomNavComponent);
BottomNav.displayName = 'BottomNav';
