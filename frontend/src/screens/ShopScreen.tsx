import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag, Sparkles, X, Zap, Gift, Package, CheckCircle, Clock } from 'lucide-react';
import { useState } from 'react';

// --- ИСПРАВЛЕННЫЕ АНИМАЦИИ (БЕЗ МАСШТАБИРОВАНИЯ) ---

// Контейнер управляет очередью (лесенкой)
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05, // Задержка 50мс между элементами
      delayChildren: 0.1
    }
  }
};

// Элемент просто выезжает снизу (y: 20 -> 0). Это убирает эффект "думающего" скейла.
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0, 
    transition: { 
      type: "spring", 
      stiffness: 350, 
      damping: 25 
    }
  }
};

// --- ДАННЫЕ (ОРИГИНАЛ) ---

const shopItems = [
  // Боксы и наборы
  { 
    id: 1, 
    name: 'Mystery Box', 
    emoji: '🎁', 
    price: 500, 
    type: 'coins', 
    category: 'boxes', 
    rarity: 'epic', 
    isNew: true,
    description: 'Открой бокс и получи случайный скин или бустер! Шанс выпадения легендарного предмета — 10%',
    benefits: ['Случайный скин', '3-5 бустеров', 'Бонус: +200 монет']
  },
  
  // Скины
  { 
    id: 2, 
    name: 'Rainbow Skin', 
    emoji: '🌈', 
    price: 500, 
    type: 'coins', 
    category: 'skins', 
    rarity: 'rare',
    description: 'Яркий радужный скин для твоих карточек. Выделись среди друзей уникальным дизайном!',
    benefits: ['Эксклюзивный дизайн', 'Анимированные эффекты', '+10% к удаче']
  },
  { 
    id: 3, 
    name: 'Neon Skin', 
    emoji: '✨', 
    price: 800, 
    type: 'coins', 
    category: 'skins', 
    rarity: 'rare',
    description: 'Неоновое свечение в киберпанк-стиле. Твои карты будут сиять в темноте!',
    benefits: ['Неоновые эффекты', 'Светящаяся анимация', 'Уникальные звуки']
  },
  { 
    id: 4, 
    name: 'Fire Skin', 
    emoji: '🔥', 
    price: 50, 
    type: 'stars', 
    category: 'skins', 
    rarity: 'epic',
    description: 'Горячий огненный стиль для настоящих чемпионов. Сожги всех конкурентов!',
    benefits: ['Анимация пламени', 'Огненные частицы', '+5% к скорости игры']
  },
  { 
    id: 5, 
    name: 'Ice Skin', 
    emoji: '❄️', 
    price: 50, 
    type: 'stars', 
    category: 'skins', 
    rarity: 'epic',
    description: 'Ледяное спокойствие и холодная красота. Заморозь соперников своим стилем!',
    benefits: ['Ледяные кристаллы', 'Морозный эффект', 'Успокаивающая анимация']
  },
  { 
    id: 6, 
    name: 'Gold Skin', 
    emoji: '🏆', 
    price: 100, 
    type: 'stars', 
    category: 'skins', 
    rarity: 'legendary',
    description: 'Легендарный золотой скин для истинных победителей. Показывает всем, кто тут босс!',
    benefits: ['Золотое сияние', 'VIP-статус', '+15% к удаче', 'Эксклюзивные звуки']
  },
  
  // Бустеры
  { 
    id: 7, 
    name: '3 Hints', 
    emoji: '💡', 
    price: 50, 
    type: 'coins', 
    category: 'boosters', 
    rarity: 'common',
    description: 'Три подсказки для сложных уровней. Используй с умом!',
    benefits: ['3 подсказки', 'Не сгорают', 'Работают на любом уровне']
  },
  { 
    id: 8, 
    name: '10 Hints', 
    emoji: '🔦', 
    price: 150, 
    type: 'coins', 
    category: 'boosters', 
    rarity: 'rare',
    description: 'Выгодный набор из 10 подсказок. Экономия 50 монет!',
    benefits: ['10 подсказок', 'Выгодное предложение', 'Бессрочные']
  },
  { 
    id: 9, 
    name: '+1 Life', 
    emoji: '❤️', 
    price: 100, 
    type: 'coins', 
    category: 'boosters', 
    rarity: 'common',
    description: 'Дополнительная жизнь для продолжения игры. Никогда не помешает!',
    benefits: ['Дополнительная попытка', 'Мгновенное использование']
  },
  { 
    id: 10, 
    name: '+5 Energy', 
    emoji: '⚡', 
    price: 20, 
    type: 'stars', 
    category: 'boosters', 
    rarity: 'rare',
    description: 'Моментальное восстановление 5 единиц энергии. Продолжай играть без остановки!',
    benefits: ['5 единиц энергии', 'Мгновенное восстановление']
  },
  { 
    id: 11, 
    name: 'Full Energy', 
    emoji: '🔋', 
    price: 40, 
    type: 'stars', 
    category: 'boosters', 
    rarity: 'epic',
    description: 'Полное восстановление энергии до максимума. Играй без ограничений!',
    benefits: ['100% энергии', 'Мгновенный эффект', 'Выгодно!']
  },
  
  // Премиум
  { 
    id: 12, 
    name: 'VIP Week', 
    emoji: '👑', 
    price: 200, 
    type: 'stars', 
    category: 'premium', 
    rarity: 'legendary', 
    isHot: true,
    description: 'Недельная VIP-подписка с эксклюзивными привилегиями. Стань элитой!',
    benefits: ['Удвоенные награды', 'Безлимитная энергия', 'Эксклюзивный бейдж', 'Приоритетная поддержка', 'VIP-скины']
  },
];

const mysteryBoxRewards = [
  { id: 2, name: 'Rainbow Skin', emoji: '🌈', rarity: 'rare' },
  { id: 3, name: 'Neon Skin', emoji: '✨', rarity: 'rare' },
  { id: 4, name: 'Fire Skin', emoji: '🔥', rarity: 'epic' },
  { id: 5, name: 'Ice Skin', emoji: '❄️', rarity: 'epic' },
  { id: 6, name: 'Gold Skin', emoji: '🏆', rarity: 'legendary' },
  { id: 7, name: '3 Hints', emoji: '💡', rarity: 'common' },
  { id: 8, name: '10 Hints', emoji: '🔦', rarity: 'rare' },
  { id: 9, name: '+1 Life', emoji: '❤️', rarity: 'common' },
  { id: 10, name: '+5 Energy', emoji: '⚡', rarity: 'rare' },
  { id: 11, name: 'Full Energy', emoji: '🔋', rarity: 'epic' },
];

const categories = [
  { key: 'boxes', title: '🎁 Боксы и наборы', icon: '🎁' },
  { key: 'skins', title: '🎨 Скины', icon: '🎨' },
  { key: 'boosters', title: '💡 Бустеры', icon: '💡' },
  { key: 'premium', title: '👑 Премиум', icon: '👑' },
];

const rarityStyles = {
  common: {
    border: 'border-gray-700/40',
    bg: 'from-gray-600/15 to-gray-700/10',
    glow: '',
    iconBg: 'bg-gradient-to-br from-gray-600/30 to-gray-700/20',
    modalBg: 'from-gray-600/20 to-gray-800/30',
    text: 'text-gray-400',
    cardBg: 'from-gray-700/40 to-gray-800/60',
    cardBorder: 'border-gray-500/50',
    cardShadow: 'shadow-[0_0_20px_rgba(107,114,128,0.3)]',
  },
  rare: {
    border: 'border-blue-500/40',
    bg: 'from-blue-600/20 to-purple-600/15',
    glow: 'shadow-[0_0_15px_rgba(59,130,246,0.15)]',
    iconBg: 'bg-gradient-to-br from-blue-600/30 to-purple-600/25',
    modalBg: 'from-blue-600/20 to-purple-800/30',
    text: 'text-blue-400',
    cardBg: 'from-blue-600/40 to-purple-700/60',
    cardBorder: 'border-blue-400/60',
    cardShadow: 'shadow-[0_0_20px_rgba(59,130,246,0.4)]',
  },
  epic: {
    border: 'border-purple-500/50',
    bg: 'from-purple-600/25 to-pink-600/20',
    glow: 'shadow-[0_0_20px_rgba(168,85,247,0.25)]',
    iconBg: 'bg-gradient-to-br from-purple-600/35 to-pink-600/30',
    modalBg: 'from-purple-600/25 to-pink-800/35',
    text: 'text-purple-400',
    cardBg: 'from-purple-600/50 to-pink-700/70',
    cardBorder: 'border-purple-400/70',
    cardShadow: 'shadow-[0_0_25px_rgba(168,85,247,0.5)]',
  },
  legendary: {
    border: 'border-yellow-500/50',
    bg: 'from-yellow-600/25 to-orange-600/20',
    glow: 'shadow-[0_0_25px_rgba(234,179,8,0.3)]',
    iconBg: 'bg-gradient-to-br from-yellow-600/35 to-orange-600/30',
    modalBg: 'from-yellow-600/25 to-orange-800/35',
    text: 'text-yellow-400',
    cardBg: 'from-yellow-600/60 to-orange-700/80',
    cardBorder: 'border-yellow-400/80',
    cardShadow: 'shadow-[0_0_30px_rgba(234,179,8,0.6)]',
  },
};

export function ShopScreen() {
  const userBalance = { coins: 1250, stars: 75 };
  const [activeTab, setActiveTab] = useState<'shop' | 'inventory'>('shop');
  const [selectedItem, setSelectedItem] = useState<typeof shopItems[0] | null>(null);
  const [isOpeningBox, setIsOpeningBox] = useState(false);
  const [boxReward, setBoxReward] = useState<typeof mysteryBoxRewards[0] | null>(null);
  const [rouletteOffset, setRouletteOffset] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [activeSkin, setActiveSkin] = useState<number | null>(4); // По умолчанию Fire Skin активен
  
  // TODO: Получать из store
  const userInventory = [
    { ...shopItems[3], quantity: 1, isActive: true }, // Fire Skin (active)
    { ...shopItems[4], quantity: 1, isActive: false }, // Ice Skin
    { ...shopItems[6], quantity: 5, isActive: false }, // 3 Hints
    { ...shopItems[8], quantity: 2, isActive: false }, // +1 Life
    { ...shopItems[11], quantity: 1, isActive: true, expiresAt: '2026-02-07' }, // VIP Week
  ];

  // Группировка инвентаря по категориям
  const inventoryByCategory = {
    premium: userInventory.filter(item => item.category === 'premium'),
    skins: userInventory.filter(item => item.category === 'skins'),
    boosters: userInventory.filter(item => item.category === 'boosters'),
  };

  // Подсчет дней до истечения
  const getDaysLeft = (expiresAt: string) => {
    const now = new Date('2026-01-31'); // Текущая дата из system-reminder
    const expires = new Date(expiresAt);
    const diff = expires.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days;
  };
  
  const handleBuy = (item: typeof shopItems[0]) => {
    if (item.category === 'boxes') {
      openMysteryBox();
    } else {
      console.log('Buying:', item);
      setSelectedItem(null);
    }
  };

  const handleActivateItem = (itemId: number) => {
    const item = userInventory.find(i => i.id === itemId);
    if (!item) return;

    if (item.category === 'skins') {
      setActiveSkin(itemId);
      console.log('Activated skin:', itemId);
    } else if (item.category === 'boosters') {
      console.log('Using booster:', itemId);
    }
  };

  const openMysteryBox = () => {
    setIsOpeningBox(true);
    setSelectedItem(null);
    setIsSpinning(true);
    setBoxReward(null);
    setRouletteOffset(0);
    
    const random = Math.random();
    let reward;
    
    if (random < 0.1) {
      reward = mysteryBoxRewards.find(r => r.rarity === 'legendary');
    } else if (random < 0.35) {
      const epics = mysteryBoxRewards.filter(r => r.rarity === 'epic');
      reward = epics[Math.floor(Math.random() * epics.length)];
    } else if (random < 0.65) {
      const rares = mysteryBoxRewards.filter(r => r.rarity === 'rare');
      reward = rares[Math.floor(Math.random() * rares.length)];
    } else {
      const commons = mysteryBoxRewards.filter(r => r.rarity === 'common');
      reward = commons[Math.floor(Math.random() * commons.length)];
    }
    
    const rewardIndex = 45;
    const cardWidth = 168;
    const finalOffset = -(rewardIndex * cardWidth - window.innerWidth / 2 + 72);
    
    setTimeout(() => setRouletteOffset(finalOffset), 100);
    setTimeout(() => setIsSpinning(false), 4600);
    setTimeout(() => setBoxReward(reward!), 5200);
  };

  const closeBoxReward = () => {
    setIsOpeningBox(false);
    setBoxReward(null);
    setRouletteOffset(0);
    setIsSpinning(false);
  };

  const canAfford = (item: typeof shopItems[0]) => {
    return item.type === 'coins' 
      ? userBalance.coins >= item.price 
      : userBalance.stars >= item.price;
  };

  const generateRoulette = () => {
    const items = [];
    for (let i = 0; i < 50; i++) {
      const randomItem = mysteryBoxRewards[Math.floor(Math.random() * mysteryBoxRewards.length)];
      items.push({ ...randomItem, key: i });
    }
    if (boxReward) {
      items[45] = { ...boxReward, key: 45 };
    }
    return items;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Sticky Balance Header */}
      <div className="sticky top-0 bg-gray-900/90 backdrop-blur-xl px-4 py-4 border-b border-white/10 z-20">
        <div className="flex items-center justify-center gap-6">
          <div className="flex items-center gap-2 bg-gradient-to-r from-yellow-500/20 to-amber-600/20 px-4 py-2 rounded-full border border-yellow-500/30">
            <span className="text-2xl">💰</span>
            <div className="flex flex-col">
              <span className="text-white font-bold text-lg leading-none">{userBalance.coins.toLocaleString()}</span>
              <span className="text-yellow-400/60 text-[10px] uppercase tracking-wider">монет</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2 bg-gradient-to-r from-purple-500/20 to-pink-600/20 px-4 py-2 rounded-full border border-purple-500/30">
            <span className="text-2xl">⭐</span>
            <div className="flex flex-col">
              <span className="text-white font-bold text-lg leading-none">{userBalance.stars}</span>
              <span className="text-purple-400/60 text-[10px] uppercase tracking-wider">звёзд</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-4">
        <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-1 mb-4 flex relative border border-white/10">
          <motion.div 
            className="absolute top-1 bottom-1 bg-white/10 rounded-xl shadow-sm"
            initial={false}
            animate={{ 
              left: activeTab === 'shop' ? '4px' : '50%', 
              width: 'calc(50% - 6px)' 
            }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
          <button 
            onClick={() => setActiveTab('shop')}
            className={`flex-1 py-3 text-sm font-bold z-10 transition-colors ${activeTab === 'shop' ? 'text-white' : 'text-white/50'}`}
          >
            <ShoppingBag size={16} className="inline mr-1 mb-1" />
            Магазин
          </button>
          <button 
            onClick={() => setActiveTab('inventory')}
            className={`flex-1 py-3 text-sm font-bold z-10 transition-colors ${activeTab === 'inventory' ? 'text-white' : 'text-white/50'}`}
          >
            <Package size={16} className="inline mr-1 mb-1" />
            Инвентарь
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-24">
        {activeTab === 'shop' ? (
          
          /* --- SHOP TAB --- */
          /* Оборачиваем ВЕСЬ таб в motion.div с containerVariants для запуска каскада */
          <motion.div
            key="shop"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {/* Header */}
            <div className="mb-6 text-center">
              <div className="relative inline-block">
                <ShoppingBag size={48} className="mx-auto text-cyan-400 mb-2 drop-shadow-[0_0_15px_rgba(34,211,238,0.4)]" />
                <Sparkles size={20} className="absolute -top-1 -right-1 text-yellow-400 animate-pulse" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-1">Магазин</h2>
              <p className="text-white/60 text-sm">Улучшай свою игру</p>
            </div>

            {/* Categories */}
            {categories.map((category) => {
              const items = shopItems.filter(item => item.category === category.key);
              if (items.length === 0) return null;

              return (
                <div key={category.key} className="mb-8">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="text-2xl">{category.icon}</div>
                    <h3 className="text-white font-bold text-lg">{category.title}</h3>
                    <div className="flex-1 h-px bg-gradient-to-r from-white/20 to-transparent ml-2"></div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {items.map((item) => {
                      const styles = rarityStyles[item.rarity as keyof typeof rarityStyles];

                      return (
                        <motion.div
                          key={item.id}
                          // Используем variants вместо ручного initial/animate
                          variants={itemVariants} 
                          onClick={() => setSelectedItem(item)}
                          className={`
                            relative rounded-2xl p-4 flex flex-col items-center overflow-hidden
                            border ${styles.border} ${styles.glow}
                            bg-gradient-to-br ${styles.bg}
                            transition-all duration-300
                            cursor-pointer hover:scale-105 hover:-translate-y-1 active:scale-95
                          `}
                        >
                          {item.isNew && (
                            <div className="absolute top-2 left-2 bg-green-500/90 backdrop-blur-sm px-2 py-0.5 rounded-full border border-green-400/50 z-10">
                              <span className="text-[10px] text-white font-bold uppercase tracking-wider">New</span>
                            </div>
                          )}
                          {item.isHot && (
                            <div className="absolute top-2 left-2 bg-red-500/90 backdrop-blur-sm px-2 py-0.5 rounded-full border border-red-400/50 z-10 animate-pulse">
                              <span className="text-[10px] text-white font-bold uppercase tracking-wider">🔥 Hot</span>
                            </div>
                          )}

                          <div className={`w-20 h-20 rounded-full mb-3 flex items-center justify-center text-4xl relative ${styles.iconBg} ring-2 ring-white/10`}>
                            <motion.div
                              whileHover={{ scale: 1.1, rotate: 5 }}
                              transition={{ type: 'spring', stiffness: 400 }}
                            >
                              {item.emoji}
                            </motion.div>
                          </div>

                          <div className="text-white font-bold text-sm mb-3 text-center leading-tight">
                            {item.name}
                          </div>

                          <div className="flex items-baseline justify-center gap-1">
                            <span className={`text-2xl font-black ${
                              item.type === 'coins' 
                                ? 'bg-gradient-to-r from-yellow-400 to-amber-500 bg-clip-text text-transparent'
                                : 'bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent'
                            }`}>
                              {item.price}
                            </span>
                            <span className={`text-[10px] uppercase tracking-wider font-medium ${
                              item.type === 'coins' ? 'text-yellow-400/60' : 'text-purple-400/60'
                            }`}>
                              {item.type === 'coins' ? 'монет' : 'звёзд'}
                            </span>
                          </div>

                          <div className="absolute inset-0 bg-gradient-to-t from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </motion.div>
        ) : (
          
          /* --- INVENTORY TAB --- */
          /* Тоже оборачиваем для каскадной анимации */
          <motion.div
             key="inventory"
             variants={containerVariants}
             initial="hidden"
             animate="visible"
          >
            {/* Inventory Header */}
            <div className="mb-6 text-center">
              <div className="relative inline-block">
                <Package size={48} className="mx-auto text-purple-400 mb-2 drop-shadow-[0_0_15px_rgba(168,85,247,0.4)]" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-1">Инвентарь</h2>
              <p className="text-white/60 text-sm">Управляй своими предметами</p>
            </div>

            {/* Inventory Items by Category */}
            {userInventory.length > 0 ? (
              <div className="space-y-6">
                {/* ПРЕМИУМ - Всегда первый */}
                {inventoryByCategory.premium.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">👑</span>
                      <h3 className="text-white font-bold text-base uppercase tracking-wider">Премиум</h3>
                      <span className="text-white/40 text-sm">({inventoryByCategory.premium.length})</span>
                      <div className="flex-1 h-px bg-gradient-to-r from-white/20 to-transparent ml-2"></div>
                    </div>
                    
                    {inventoryByCategory.premium.map((item) => {
                      const styles = rarityStyles[item.rarity as keyof typeof rarityStyles];
                      const daysLeft = item.expiresAt ? getDaysLeft(item.expiresAt) : null;

                      return (
                        <motion.div
                          key={item.id}
                          variants={itemVariants}
                          className={`
                            relative rounded-2xl p-4 border-2
                            ${styles.border} ${styles.glow}
                            bg-gradient-to-br ${styles.bg}
                            ring-2 ring-yellow-400/30
                          `}
                        >
                          {/* Active Badge */}
                          <div className="absolute top-3 right-3 bg-green-500/90 backdrop-blur-sm px-3 py-1 rounded-full border border-green-400/50 flex items-center gap-1.5 shadow-lg">
                            <CheckCircle size={14} className="text-white" />
                            <span className="text-xs text-white font-bold uppercase tracking-wider">Активно</span>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className={`w-16 h-16 rounded-full flex items-center justify-center text-5xl ${styles.iconBg} ring-4 ring-white/20 flex-shrink-0 shadow-xl`}>
                              {item.emoji}
                            </div>

                            <div className="flex-1 min-w-0">
                              <h3 className="text-white font-black text-lg mb-1">{item.name}</h3>
                              <div className={`text-xs font-bold uppercase tracking-wider ${styles.text} mb-2`}>
                                👑 Легендарный
                              </div>
                              
                              {daysLeft !== null && (
                                <div className="flex items-center gap-1.5 bg-yellow-500/20 border border-yellow-400/40 px-3 py-1.5 rounded-full inline-flex">
                                  <Clock size={14} className="text-yellow-400" />
                                  <span className="text-yellow-300 font-bold text-sm">
                                    Осталось {daysLeft} {daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}

                {/* СКИНЫ */}
                {inventoryByCategory.skins.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">🎨</span>
                      <h3 className="text-white font-bold text-base uppercase tracking-wider">Скины</h3>
                      <span className="text-white/40 text-sm">({inventoryByCategory.skins.length})</span>
                      <div className="flex-1 h-px bg-gradient-to-r from-white/20 to-transparent ml-2"></div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      {inventoryByCategory.skins.map((item) => {
                        const styles = rarityStyles[item.rarity as keyof typeof rarityStyles];
                        const isActiveSkin = activeSkin === item.id;

                        return (
                          <motion.div
                            key={item.id}
                            variants={itemVariants}
                            className={`
                              relative rounded-2xl p-4 border-2 flex flex-col items-center
                              ${styles.border} ${styles.glow}
                              bg-gradient-to-br ${styles.bg}
                              ${isActiveSkin ? 'ring-2 ring-green-400/50' : ''}
                              transition-all duration-300
                            `}
                          >
                            {isActiveSkin && (
                              <div className="absolute top-2 right-2 bg-green-500/90 backdrop-blur-sm px-2 py-1 rounded-full border border-green-400/50 flex items-center gap-1">
                                <CheckCircle size={12} className="text-white" />
                                <span className="text-[9px] text-white font-bold uppercase tracking-wider">Активен</span>
                              </div>
                            )}

                            <div className={`w-20 h-20 rounded-full mb-3 flex items-center justify-center text-5xl ${styles.iconBg} ring-2 ring-white/10`}>
                              {item.emoji}
                            </div>

                            <h3 className="text-white font-bold text-sm text-center mb-1">{item.name}</h3>
                            <div className={`text-[10px] font-bold uppercase tracking-wider ${styles.text} mb-3`}>
                              {item.rarity === 'legendary' && '👑 Легендарный'}
                              {item.rarity === 'epic' && '💎 Эпический'}
                              {item.rarity === 'rare' && '⭐ Редкий'}
                            </div>

                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handleActivateItem(item.id)}
                              disabled={isActiveSkin}
                              className={`
                                w-full py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition-all
                                ${isActiveSkin 
                                  ? 'bg-green-500/20 text-green-400 border-2 border-green-400/50 cursor-default'
                                  : 'bg-white/10 hover:bg-white/20 text-white border-2 border-white/20'
                                }
                              `}
                            >
                              {isActiveSkin ? '✓ Активен' : 'Надеть'}
                            </motion.button>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* БУСТЕРЫ - Компактный дизайн */}
                {inventoryByCategory.boosters.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">💡</span>
                      <h3 className="text-white font-bold text-base uppercase tracking-wider">Бустеры</h3>
                      <span className="text-white/40 text-sm">({inventoryByCategory.boosters.length})</span>
                      <div className="flex-1 h-px bg-gradient-to-r from-white/20 to-transparent ml-2"></div>
                    </div>
                    
                    <div className="space-y-2">
                      {inventoryByCategory.boosters.map((item) => {
                        const styles = rarityStyles[item.rarity as keyof typeof rarityStyles];

                        return (
                          <motion.div
                            key={item.id}
                            variants={itemVariants}
                            className={`
                              flex items-center gap-3 p-3 rounded-xl border
                              ${styles.border}
                              bg-gradient-to-r ${styles.bg}
                              hover:bg-white/5 transition-all
                            `}
                          >
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-3xl ${styles.iconBg} ring-2 ring-white/10 flex-shrink-0`}>
                              {item.emoji}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <h3 className="text-white font-bold text-sm">{item.name}</h3>
                                {item.quantity && item.quantity > 1 && (
                                  <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs text-white font-bold">
                                    ×{item.quantity}
                                  </span>
                                )}
                              </div>
                              <div className={`text-[10px] font-bold uppercase tracking-wider ${styles.text}`}>
                                {item.rarity === 'rare' && '⭐ Редкий'}
                                {item.rarity === 'common' && 'Обычный'}
                              </div>
                            </div>

                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handleActivateItem(item.id)}
                              className="px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-400 hover:to-purple-500 text-white transition-all shadow-lg flex-shrink-0"
                            >
                              Применить
                            </motion.button>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <Package size={64} className="mx-auto text-white/20 mb-4" />
                <p className="text-white/50 text-lg font-medium mb-2">Инвентарь пуст</p>
                <p className="text-white/40 text-sm mb-6">Купи предметы в магазине</p>
                <button
                  onClick={() => setActiveTab('shop')}
                  className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold px-6 py-3 rounded-xl transition-all"
                >
                  Перейти в магазин
                </button>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Item Details Modal */}
      <AnimatePresence>
        {selectedItem && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedItem(null)}
              className="fixed inset-0 bg-black/80 backdrop-blur-md z-50"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 50 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 50 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed inset-x-4 bottom-20 top-auto translate-y-0 z-50 max-w-md mx-auto max-h-[75vh] overflow-y-auto custom-scrollbar"
            >
              <div className={`
                relative rounded-3xl overflow-hidden border-2
                ${rarityStyles[selectedItem.rarity as keyof typeof rarityStyles].border}
                ${rarityStyles[selectedItem.rarity as keyof typeof rarityStyles].glow}
                bg-gradient-to-br ${rarityStyles[selectedItem.rarity as keyof typeof rarityStyles].modalBg}
                backdrop-blur-xl
              `}>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="absolute top-4 right-4 z-10 bg-white/10 hover:bg-white/20 p-2 rounded-full transition-all backdrop-blur-sm border border-white/20"
                >
                  <X size={20} className="text-white" />
                </button>

                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                  {[...Array(20)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="absolute w-1 h-1 bg-white/30 rounded-full"
                      initial={{ 
                        x: Math.random() * 400, 
                        y: Math.random() * 600,
                        scale: Math.random() 
                      }}
                      animate={{
                        y: [null, Math.random() * 600],
                        opacity: [0, 1, 0],
                      }}
                      transition={{
                        duration: 3 + Math.random() * 2,
                        repeat: Infinity,
                        delay: Math.random() * 2,
                      }}
                    />
                  ))}
                </div>

                <div className="relative p-5">
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', damping: 15, delay: 0.1 }}
                    className={`
                      w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center text-5xl
                      ${rarityStyles[selectedItem.rarity as keyof typeof rarityStyles].iconBg}
                      ring-4 ring-white/20 shadow-2xl
                    `}
                  >
                    <motion.div
                      animate={{ 
                        rotate: [0, 5, -5, 0],
                        scale: [1, 1.05, 1]
                      }}
                      transition={{ 
                        duration: 2,
                        repeat: Infinity,
                        ease: 'easeInOut'
                      }}
                    >
                      {selectedItem.emoji}
                    </motion.div>
                  </motion.div>

                  <div className="flex gap-2 justify-center mb-4 flex-wrap">
                    {selectedItem.isNew && (
                      <span className="px-3 py-1 bg-green-500/20 text-green-400 text-xs font-bold uppercase tracking-wider rounded-full border border-green-500/40">
                        ✨ Новинка
                      </span>
                    )}
                    {selectedItem.isHot && (
                      <span className="px-3 py-1 bg-red-500/20 text-red-400 text-xs font-bold uppercase tracking-wider rounded-full border border-red-500/40 animate-pulse">
                        🔥 Хит продаж
                      </span>
                    )}
                    <span className={`
                      px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full border
                      ${selectedItem.rarity === 'legendary' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40' : ''}
                      ${selectedItem.rarity === 'epic' ? 'bg-purple-500/20 text-purple-400 border-purple-500/40' : ''}
                      ${selectedItem.rarity === 'rare' ? 'bg-blue-500/20 text-blue-400 border-blue-500/40' : ''}
                      ${selectedItem.rarity === 'common' ? 'bg-gray-500/20 text-gray-400 border-gray-500/40' : ''}
                    `}>
                      {selectedItem.rarity === 'legendary' && '👑 Легендарный'}
                      {selectedItem.rarity === 'epic' && '💎 Эпический'}
                      {selectedItem.rarity === 'rare' && '⭐ Редкий'}
                      {selectedItem.rarity === 'common' && 'Обычный'}
                    </span>
                  </div>

                  <h3 className="text-2xl font-black text-white text-center mb-2">
                    {selectedItem.name}
                  </h3>

                  <p className="text-white/80 text-center text-sm mb-5 leading-relaxed">
                    {selectedItem.description}
                  </p>

                  <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-3 mb-5 border border-white/10">
                    <div className="flex items-center gap-2 mb-3">
                      <Gift size={18} className="text-purple-400" />
                      <span className="text-white font-bold text-sm uppercase tracking-wider">Что внутри:</span>
                    </div>
                    <div className="space-y-1.5">
                      {selectedItem.benefits.map((benefit, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.2 + i * 0.1 }}
                          className="flex items-center gap-2"
                        >
                          <Zap size={14} className="text-yellow-400 flex-shrink-0" />
                          <span className="text-white/90 text-sm">{benefit}</span>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2 py-2 px-6 bg-black/30 rounded-2xl border border-white/10">
                      <span className="text-white/60 text-sm">Цена:</span>
                      <div className="flex items-baseline gap-1">
                        <span className={`text-3xl font-black ${
                          selectedItem.type === 'coins'
                            ? 'bg-gradient-to-r from-yellow-400 to-amber-500 bg-clip-text text-transparent'
                            : 'bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent'
                        }`}>
                          {selectedItem.price}
                        </span>
                        <span className={`text-sm uppercase tracking-wider font-bold ${
                          selectedItem.type === 'coins' ? 'text-yellow-400/80' : 'text-purple-400/80'
                        }`}>
                          {selectedItem.type === 'coins' ? 'монет' : 'звёзд'}
                        </span>
                      </div>
                    </div>

                    {canAfford(selectedItem) ? (
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleBuy(selectedItem)}
                        className={`
                          w-full py-3 rounded-2xl font-black text-base uppercase tracking-wider
                          transition-all duration-300 shadow-2xl
                          ${selectedItem.type === 'coins'
                            ? 'bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-400 hover:to-amber-500 text-gray-900'
                            : 'bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-400 hover:to-pink-500 text-white'
                          }
                        `}
                      >
                        <span className="flex items-center justify-center gap-2">
                          <ShoppingBag size={20} />
                          {selectedItem.category === 'boxes' ? 'Открыть бокс' : 'Купить сейчас'}
                        </span>
                      </motion.button>
                    ) : (
                      <div className="w-full py-3 rounded-2xl bg-gray-700/50 border-2 border-gray-600/50 text-center">
                        <div className="text-gray-400 font-bold text-sm mb-1">
                          Недостаточно {selectedItem.type === 'coins' ? 'монет' : 'звёзд'}
                        </div>
                        <div className="text-white/60 text-xs">
                          Нужно ещё: {selectedItem.type === 'coins' 
                            ? selectedItem.price - userBalance.coins
                            : selectedItem.price - userBalance.stars
                          } {selectedItem.type === 'coins' ? 'монет' : 'звёзд'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Mystery Box Opening Animation */}
      <AnimatePresence>
        {isOpeningBox && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: boxReward ? 1 : 0 }}
              className="fixed inset-0 bg-black/95 backdrop-blur-lg z-[70] pointer-events-none"
            />

            <div className="fixed inset-0 z-50 bg-black/90">
              <div className="h-full flex flex-col items-center justify-center">
                <motion.div
                  initial={{ opacity: 0, y: -50 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-12 text-center"
                >
                  <motion.div
                    animate={{ 
                      scale: [1, 1.2, 1],
                      rotate: [0, 5, -5, 0]
                    }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                    className="text-8xl mb-4"
                  >
                    🎁
                  </motion.div>
                  <h2 className="text-4xl font-black text-white mb-2 drop-shadow-[0_0_20px_rgba(255,255,255,0.3)]">
                    Открываем Mystery Box
                  </h2>
                  <p className="text-white/60 text-lg">Удача на твоей стороне!</p>
                </motion.div>

                <div className="relative w-full h-48">
                  <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-black via-black/50 to-transparent z-20 pointer-events-none" />
                  <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-black via-black/50 to-transparent z-20 pointer-events-none" />

                  <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 flex items-center justify-center z-30 pointer-events-none">
                    <motion.div
                      animate={isSpinning ? {
                        boxShadow: [
                          '0 0 20px rgba(234,179,8,0.4)',
                          '0 0 40px rgba(234,179,8,0.8)',
                          '0 0 20px rgba(234,179,8,0.4)',
                        ]
                      } : {}}
                      transition={{ duration: 0.5, repeat: Infinity }}
                      className="w-40 h-40 border-4 border-yellow-400 rounded-3xl bg-black/40"
                    />
                    <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 bg-gradient-to-b from-transparent via-yellow-400 to-transparent" />
                  </div>

                  <div className="absolute inset-0 overflow-hidden">
                    <motion.div
                      className="absolute left-0 top-6 flex gap-6 items-center px-4"
                      initial={{ x: 0 }}
                      animate={{ x: rouletteOffset }}
                      transition={{ 
                        duration: 4.5,
                        ease: [0.22, 0.03, 0.26, 1.0]
                      }}
                    >
                      {generateRoulette().map((item, i) => {
                        const styles = rarityStyles[item.rarity as keyof typeof rarityStyles];
                        const isWinning = i === 45;
                        
                        return (
                          <motion.div
                            key={item.key}
                            animate={isWinning && !isSpinning ? {
                              scale: [1, 1.1, 1],
                            } : {}}
                            transition={{ duration: 0.5, repeat: Infinity }}
                            className={`
                              flex-shrink-0 w-36 h-36 rounded-2xl border-3 flex flex-col items-center justify-center relative
                              bg-gradient-to-br ${styles.cardBg} ${styles.cardBorder} ${styles.cardShadow}
                            `}
                          >
                            <div className={`absolute inset-0 rounded-2xl bg-gradient-to-t from-white/10 to-transparent`} />
                            
                            <div className="relative z-10 flex flex-col items-center">
                              <div className="text-6xl mb-2 drop-shadow-lg">{item.emoji}</div>
                              <div className={`text-xs font-black uppercase tracking-wider ${styles.text} drop-shadow-md`}>
                                {item.rarity}
                              </div>
                            </div>

                            {(item.rarity === 'legendary' || item.rarity === 'epic') && (
                              <motion.div
                                className="absolute inset-0 rounded-2xl"
                                animate={{
                                  background: [
                                    'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%)',
                                    'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%)',
                                  ],
                                  backgroundPosition: ['-200%', '200%'],
                                }}
                                transition={{ duration: 2, repeat: Infinity }}
                              />
                            )}
                          </motion.div>
                        );
                      })}
                    </motion.div>
                  </div>
                </div>

                {isSpinning && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-12 flex items-center gap-3 text-white/80"
                  >
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-6 h-6 border-3 border-yellow-400 border-t-transparent rounded-full"
                    />
                    <span className="text-lg font-bold">Определяем ваш приз...</span>
                  </motion.div>
                )}
              </div>
            </div>

            <AnimatePresence>
              {boxReward && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ type: 'spring', damping: 15 }}
                  className="fixed inset-0 z-[80] flex items-center justify-center"
                  onClick={closeBoxReward}
                >
                  <div className="relative">
                    {[...Array(40)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="absolute w-3 h-3 rounded-full"
                        style={{
                          background: ['#FFD700', '#FF1493', '#00CED1', '#FF69B4', '#FFD700', '#9333EA'][i % 6],
                          left: '50%',
                          top: '50%',
                        }}
                        initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                        animate={{
                          x: (Math.random() - 0.5) * 500,
                          y: (Math.random() - 0.5) * 500,
                          opacity: 0,
                          scale: 0,
                          rotate: Math.random() * 360,
                        }}
                        transition={{ duration: 1.8, ease: 'easeOut' }}
                      />
                    ))}

                    <motion.div
                      initial={{ rotateY: 0 }}
                      animate={{ rotateY: 360 }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                      className={`
                        relative w-80 rounded-3xl p-8 text-center border-4
                        ${rarityStyles[boxReward.rarity as keyof typeof rarityStyles].border}
                        bg-gradient-to-br ${rarityStyles[boxReward.rarity as keyof typeof rarityStyles].modalBg}
                        backdrop-blur-xl shadow-2xl
                      `}
                      style={{
                        boxShadow: '0 0 80px rgba(234, 179, 8, 0.6)',
                      }}
                    >
                      <div className="absolute inset-0 rounded-3xl bg-gradient-to-t from-yellow-400/20 via-transparent to-transparent animate-pulse" />

                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.3, type: 'spring', damping: 10 }}
                        className="relative z-10"
                      >
                        <div className="text-yellow-400 font-black text-3xl uppercase tracking-wider mb-6">
                          🎉 Поздравляем! 🎉
                        </div>

                        <div className={`
                          w-36 h-36 mx-auto mb-6 rounded-full flex items-center justify-center text-8xl
                          ${rarityStyles[boxReward.rarity as keyof typeof rarityStyles].iconBg}
                          ring-4 ring-white/30 shadow-2xl
                        `}>
                          <motion.div
                            animate={{ 
                              rotate: [0, 10, -10, 0],
                              scale: [1, 1.1, 1]
                            }}
                            transition={{ duration: 0.5, repeat: Infinity }}
                          >
                            {boxReward.emoji}
                          </motion.div>
                        </div>

                        <div className="text-white font-black text-4xl mb-4">
                          {boxReward.name}
                        </div>

                        <div className={`
                          inline-block px-5 py-2.5 rounded-full font-bold text-base uppercase tracking-wider mb-8
                          ${boxReward.rarity === 'legendary' ? 'bg-yellow-500/30 text-yellow-300 border-2 border-yellow-400' : ''}
                          ${boxReward.rarity === 'epic' ? 'bg-purple-500/30 text-purple-300 border-2 border-purple-400' : ''}
                          ${boxReward.rarity === 'rare' ? 'bg-blue-500/30 text-blue-300 border-2 border-blue-400' : ''}
                          ${boxReward.rarity === 'common' ? 'bg-gray-500/30 text-gray-300 border-2 border-gray-400' : ''}
                        `}>
                          {boxReward.rarity === 'legendary' && '👑 Легендарный'}
                          {boxReward.rarity === 'epic' && '💎 Эпический'}
                          {boxReward.rarity === 'rare' && '⭐ Редкий'}
                          {boxReward.rarity === 'common' && 'Обычный'}
                        </div>

                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={closeBoxReward}
                          className="w-full bg-gradient-to-r from-yellow-500 to-amber-600 text-gray-900 font-black py-4 rounded-2xl text-xl uppercase tracking-wider shadow-xl hover:from-yellow-400 hover:to-amber-500 transition-all"
                        >
                          Забрать приз
                        </motion.button>

                        <p className="mt-4 text-white/40 text-sm">
                          Нажми чтобы продолжить
                        </p>
                      </motion.div>
                    </motion.div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}