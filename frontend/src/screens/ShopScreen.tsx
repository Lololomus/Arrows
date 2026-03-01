import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Coins, Lightbulb, RefreshCcw, ShoppingBag } from 'lucide-react';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';
import { CoinStashCard } from '../components/ui/CoinStashCard';
import { shopApi } from '../api/client';
import { useAppStore } from '../stores/store';
import type { ShopItem } from '../game/types';

const BETA_ITEM_COPY: Record<string, { title: string; description: string }> = {
  hints_3: {
    title: '+3 подсказки',
    description: 'Быстрый набор для сложных уровней. Подсказки сохраняются в общем балансе.',
  },
  hints_10: {
    title: '+10 подсказок',
    description: 'Выгодный запас на серию уровней. Баланс обновляется сразу после покупки.',
  },
};

function normalizeBoosts(items: ShopItem[]): ShopItem[] {
  return items.filter((item) => item.id === 'hints_3' || item.id === 'hints_10');
}

export function ShopScreen() {
  const user = useAppStore(s => s.user);
  const updateUser = useAppStore(s => s.updateUser);

  const [items, setItems] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const catalog = await shopApi.getCatalog();
      setItems(normalizeBoosts(catalog.boosts));
    } catch {
      setError('Не удалось загрузить магазин');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const coinBalance = user?.coins ?? 0;
  const hintBalance = user?.hintBalance ?? 0;

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => (a.priceCoins ?? 0) - (b.priceCoins ?? 0));
  }, [items]);

  const handlePurchase = useCallback(async (item: ShopItem) => {
    if (purchasingId || (item.priceCoins ?? Infinity) > coinBalance) return;

    setPurchasingId(item.id);
    setPurchaseError(null);

    try {
      const result = await shopApi.purchaseCoins('boosts', item.id);
      if (!result.success) {
        setPurchaseError(result.error ?? 'Покупка не удалась');
        return;
      }

      updateUser({
        coins: result.coins,
        hintBalance: result.hintBalance ?? hintBalance,
      });
    } catch {
      setPurchaseError('Покупка не удалась');
    } finally {
      setPurchasingId(null);
    }
  }, [coinBalance, hintBalance, purchasingId, updateUser]);

  return (
    <div className="relative h-full overflow-hidden px-4 pb-nav pt-6">
      <AdaptiveParticles
        variant="bg"
        tone="neutral"
        baseCount={18}
        baseSpeed={0.09}
        className="z-0 opacity-30"
      />

      <div className="relative z-10 flex h-full flex-col">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 rounded-3xl border border-white/10 bg-[#111526]/70 p-5 backdrop-blur-xl"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-white/60">
                <ShoppingBag size={14} />
                Магазин
              </div>
              <h1 className="text-3xl font-black tracking-tight text-white">Beta Shop</h1>
              <p className="mt-2 max-w-sm text-sm text-white/60">
                Пока доступна только покупка подсказок за монеты. Всё остальное скрыто до следующей итерации.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-right">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200/70">Подсказки</div>
              <div className="mt-1 flex items-center justify-end gap-2 text-2xl font-black text-white">
                <Lightbulb size={20} className="text-amber-300" />
                {hintBalance}
              </div>
            </div>
          </div>
        </motion.div>

        <CoinStashCard balance={coinBalance} animated={false} className="mb-4 shrink-0" />

        {purchaseError && (
          <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {purchaseError}
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="rounded-3xl border border-white/10 bg-[#111526]/70 px-6 py-5 text-white/70 backdrop-blur-xl">
              Загружаем магазин...
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#111526]/75 p-6 text-center backdrop-blur-xl">
              <p className="text-lg font-bold text-white">{error}</p>
              <button
                onClick={() => void loadCatalog()}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 font-bold text-white transition hover:bg-white/15"
              >
                <RefreshCcw size={16} />
                Повторить
              </button>
            </div>
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#111526]/75 p-6 text-center backdrop-blur-xl">
              <p className="text-lg font-bold text-white">Магазин временно недоступен</p>
              <p className="mt-2 text-sm text-white/60">Каталог пока не вернул доступные товары.</p>
            </div>
          </div>
        ) : (
          <div className="custom-scrollbar relative flex-1 overflow-y-auto pb-6">
            <div className="space-y-4">
              {sortedItems.map((item, index) => {
                const price = item.priceCoins ?? 0;
                const insufficientCoins = price > coinBalance;
                const copy = BETA_ITEM_COPY[item.id] ?? {
                  title: item.name,
                  description: 'Покупка за монеты.',
                };

                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.06 }}
                    className="rounded-3xl border border-white/10 bg-[#111526]/75 p-5 backdrop-blur-xl shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/20 to-orange-500/20 text-amber-300 ring-1 ring-amber-300/20">
                        <Lightbulb size={24} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h2 className="text-xl font-black text-white">{copy.title}</h2>
                            <p className="mt-1 text-sm text-white/60">{copy.description}</p>
                          </div>

                          <div className="rounded-2xl border border-yellow-400/20 bg-yellow-500/10 px-3 py-2 text-right">
                            <div className="text-xs font-bold uppercase tracking-[0.16em] text-yellow-200/70">Цена</div>
                            <div className="mt-1 flex items-center gap-1 text-xl font-black text-white">
                              <Coins size={16} className="text-yellow-300" />
                              {price}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-3">
                          <div className="text-xs text-white/45">
                            {insufficientCoins ? 'Недостаточно монет для покупки' : 'Подсказки добавятся в общий баланс'}
                          </div>

                          <button
                            onClick={() => void handlePurchase(item)}
                            disabled={insufficientCoins || purchasingId === item.id}
                            className="rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-3 text-sm font-black text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {purchasingId === item.id ? 'Покупаем...' : 'Купить'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
