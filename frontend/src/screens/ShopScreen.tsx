import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Coins, Diamond, Heart, Lightbulb, Minus, Plus, RefreshCcw, ShoppingBag } from 'lucide-react';
import { useTonConnectUI } from '@tonconnect/ui-react';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';
import { HeaderBar } from '../components/ui/HeaderBar';
import { shopApi } from '../api/client';
import { useWalletConnectionController } from '../hooks/useWalletConnectionController';
import { useAppStore } from '../stores/store';
import type { ShopItem } from '../game/types';

function buildCommentPayload(comment: string): string {
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(comment);
  const dataBytes = new Uint8Array(4 + textBytes.length);
  dataBytes.set(textBytes, 4);

  const dataBits = dataBytes.length * 8;
  const cellDescriptor1 = 0x00;
  const cellDescriptor2 = Math.ceil(dataBits / 8) * 2 + (dataBits % 8 !== 0 ? 1 : 0);

  const bocMagic = new Uint8Array([0xb5, 0xee, 0x9c, 0x72]);
  const flags = 0x01;
  const sizeBytes = 1;
  const cellCount = 1;
  const rootCount = 1;
  const absentCount = 0;
  const totalCellSize = 2 + dataBytes.length;

  const boc = new Uint8Array(4 + 1 + 5 + 2 + dataBytes.length);
  let offset = 0;

  boc.set(bocMagic, offset); offset += 4;
  boc[offset++] = flags;
  boc[offset++] = sizeBytes;
  boc[offset++] = cellCount;
  boc[offset++] = rootCount;
  boc[offset++] = absentCount;
  boc[offset++] = totalCellSize;
  boc[offset++] = 0;
  boc[offset++] = cellDescriptor1;
  boc[offset++] = cellDescriptor2;
  boc.set(dataBytes, offset);

  let binary = '';
  for (let i = 0; i < boc.length; i++) {
    binary += String.fromCharCode(boc[i]);
  }
  return btoa(binary);
}

type BoostId = 'hints_1' | 'revive_1';
type QuantityState = Record<BoostId, number>;

const BOOST_IDS: BoostId[] = ['hints_1', 'revive_1'];
const MAX_BOOST_QUANTITY = 10;

const BOOST_UI: Record<BoostId, {
  title: string;
  description: string;
  priceFallback: number;
  iconWrapClass: string;
  iconClass: string;
  buttonClass: string;
}> = {
  hints_1: {
    title: 'Подсказки',
    description: 'Показывают верный ход. Хранятся в общем запасе.',
    priceFallback: 25,
    iconWrapClass: 'border-cyan-500/20 bg-cyan-500/10',
    iconClass: 'text-cyan-400',
    buttonClass: 'bg-cyan-500 hover:bg-cyan-400',
  },
  revive_1: {
    title: 'Возрождения',
    description: 'Дают шанс продолжить игру после ошибки.',
    priceFallback: 50,
    iconWrapClass: 'border-rose-500/20 bg-rose-500/10',
    iconClass: 'text-rose-400',
    buttonClass: 'bg-rose-500 hover:bg-rose-400',
  },
};

function clampBoostQuantity(value: number): number {
  return Math.min(MAX_BOOST_QUANTITY, Math.max(1, Math.floor(value)));
}

function normalizeBoosts(items: ShopItem[]): Array<ShopItem & { id: BoostId }> {
  return items.filter((item): item is ShopItem & { id: BoostId } =>
    BOOST_IDS.includes(item.id as BoostId),
  );
}

function BoostCard({
  boostId,
  item,
  quantity,
  coinBalance,
  isPurchasing,
  onChangeQuantity,
  onPurchase,
}: {
  boostId: BoostId;
  item: ShopItem & { id: BoostId };
  quantity: number;
  coinBalance: number;
  isPurchasing: boolean;
  onChangeQuantity: (value: number) => void;
  onPurchase: () => void;
}) {
  const config = BOOST_UI[boostId];
  const unitPrice = item.priceCoins ?? config.priceFallback;
  const totalPrice = unitPrice * quantity;
  const insufficientCoins = totalPrice > coinBalance;
  const Icon = boostId === 'hints_1' ? Lightbulb : Heart;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-[24px] border border-white/5 bg-[#18181b]/60 p-5 backdrop-blur-md"
    >
      <div className="flex items-start gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${config.iconWrapClass}`}>
          <Icon size={24} className={config.iconClass} strokeWidth={2.5} />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-[#f7f8fb]">{config.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-[#a7abb8]">{config.description}</p>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-4">
        <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-black/20 p-1">
          <button
            type="button"
            onClick={() => onChangeQuantity(quantity - 1)}
            disabled={quantity <= 1}
            aria-label={`Уменьшить количество ${config.title.toLowerCase()}`}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-[#9fa5b5] transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <Minus size={18} />
          </button>
          <span className="w-6 text-center text-lg font-bold text-[#f7f8fb]">{quantity}</span>
          <button
            type="button"
            onClick={() => onChangeQuantity(quantity + 1)}
            disabled={quantity >= MAX_BOOST_QUANTITY}
            aria-label={`Увеличить количество ${config.title.toLowerCase()}`}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-[#9fa5b5] transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <Plus size={18} />
          </button>
        </div>

        <button
          type="button"
          onClick={onPurchase}
          disabled={insufficientCoins || isPurchasing}
          className={`relative flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl font-bold text-white transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-50 ${config.buttonClass}`}
        >
          {isPurchasing ? (
            <span className="animate-pulse">Обработка...</span>
          ) : (
            <>
              <span>Купить</span>
              <div className="mx-1 h-4 w-px bg-black/20" />
              <div className="flex items-center gap-1.5">
                <Coins size={16} className="text-amber-300 drop-shadow-sm" />
                <span>{totalPrice}</span>
              </div>
            </>
          )}
        </button>
      </div>
    </motion.section>
  );
}

export function ShopScreen() {
  const user = useAppStore((s) => s.user);
  const updateUser = useAppStore((s) => s.updateUser);
  const [tonConnectUI] = useTonConnectUI();
  const walletController = useWalletConnectionController();

  const [items, setItems] = useState<Array<ShopItem & { id: BoostId }>>([]);
  const [tonItems, setTonItems] = useState<ShopItem[]>([]);
  const [upgrades, setUpgrades] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [tonStatus, setTonStatus] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<QuantityState>({ hints_1: 1, revive_1: 1 });

  const coinBalance = user?.coins ?? 0;
  const hintBalance = user?.hintBalance ?? 0;
  const reviveBalance = user?.reviveBalance ?? 0;

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const catalog = await shopApi.getCatalog();
      setItems(normalizeBoosts(catalog.boosts));
      setTonItems([...catalog.arrowSkins, ...catalog.themes].filter((item) => item.priceTon != null));
      setUpgrades(catalog.upgrades ?? []);
    } catch {
      setError('Не удалось загрузить магазин');
      setItems([]);
      setTonItems([]);
      setUpgrades([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const boostMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const setQuantity = useCallback((boostId: BoostId, nextValue: number) => {
    setQuantities((prev) => ({
      ...prev,
      [boostId]: clampBoostQuantity(nextValue),
    }));
  }, []);

  const handlePurchase = useCallback(async (item: ShopItem & { id: BoostId }, quantity: number) => {
    const unitPrice = item.priceCoins ?? BOOST_UI[item.id].priceFallback;
    if (purchasingId || unitPrice * quantity > coinBalance) return;

    setPurchasingId(item.id);
    setPurchaseError(null);

    try {
      const result = await shopApi.purchaseCoins('boosts', item.id, quantity);
      if (!result.success) {
        setPurchaseError(result.error ?? 'Покупка не удалась');
        return;
      }

      updateUser({
        coins: result.coins,
        hintBalance: result.hintBalance ?? hintBalance,
        reviveBalance: result.reviveBalance ?? reviveBalance,
      });

      setQuantities((prev) => ({ ...prev, [item.id]: 1 }));
    } catch {
      setPurchaseError('Покупка не удалась');
    } finally {
      setPurchasingId(null);
    }
  }, [coinBalance, hintBalance, purchasingId, reviveBalance, updateUser]);

  const handleTonPurchase = useCallback(async (item: ShopItem) => {
    if (purchasingId) return;

    if (!user?.walletAddress) {
      setPurchaseError('Сначала подключите TON кошелёк');
      return;
    }

    const itemType = item.id === 'extra_life' ? 'boosts'
      : item.id.startsWith('vip') ? 'boosts'
      : ['diamond', 'cyber', 'rainbow', 'neon', 'fire', 'ice', 'gold', 'default'].includes(item.id) ? 'arrow_skins'
      : 'themes';

    setPurchasingId(item.id);
    setPurchaseError(null);
    setTonStatus('Создаём транзакцию...');

    try {
      const paymentInfo = await shopApi.purchaseTon(itemType, item.id);

      setTonStatus('Подтвердите в кошельке...');

      const amountNano = paymentInfo.amount_nano ?? String(Math.round(paymentInfo.amount * 1e9));
      const commentPayload = buildCommentPayload(paymentInfo.comment);

      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [
          {
            address: paymentInfo.address,
            amount: amountNano,
            payload: commentPayload,
          },
        ],
      });

      setTonStatus('Ожидаем подтверждение...');

      for (let i = 0; i < 12; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        try {
          const result = await shopApi.confirmTransaction(paymentInfo.transaction_id);
          if (result.status === 'completed') {
            setTonStatus(null);
            setPurchaseError(null);
            if (item.id === 'extra_life' && result.extra_lives != null) {
              updateUser({ extraLives: result.extra_lives });
            }
            void loadCatalog();
            return;
          }
        } catch {
          // Continue polling.
        }
      }

      setTonStatus(null);
      setPurchaseError('Транзакция отправлена, но подтверждение ещё не получено. Проверьте позже.');
    } catch (errorValue) {
      console.error('[TON purchase error]', errorValue);
      const message = errorValue instanceof Error
        ? errorValue.message
        : typeof errorValue === 'string'
          ? errorValue
          : JSON.stringify(errorValue);
      if (message.includes('Interrupted') || message.includes('cancel') || message.includes('Reject') || message.includes('reject')) {
        setTonStatus(null);
      } else {
        setPurchaseError(`Ошибка: ${message || 'неизвестная ошибка'}`);
        setTonStatus(null);
      }
    } finally {
      setPurchasingId(null);
    }
  }, [loadCatalog, purchasingId, tonConnectUI, user?.walletAddress]);

  const hasStoreContent = items.length > 0 || tonItems.length > 0 || upgrades.length > 0;

  return (
    <div className="custom-scrollbar relative h-full overflow-y-auto px-4 pb-nav pt-3">
      <AdaptiveParticles
        variant="bg"
        tone="neutral"
        baseCount={16}
        baseSpeed={0.08}
        className="z-0 opacity-22"
      />

      <div className="relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-3 rounded-[28px] border border-white/10 bg-[#14182b]/80 px-4 py-4 shadow-[0_14px_36px_rgba(0,0,0,0.22)] backdrop-blur-xl"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white/60">
            <ShoppingBag size={13} />
            Beta Shop
          </div>

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-[18rem]">
              <h1 className="text-[34px] font-black leading-[0.95] tracking-tight text-[#f7f8fb]">
                Магазин бустов
              </h1>
              <p className="mt-2 text-[15px] leading-7 text-[#d2d7e5]">
                Подсказки и возрождения за монеты. Выбирайте количество и покупайте сразу.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:min-w-[220px]">
              <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.05] px-3 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8bb8cb]">Подсказки</div>
                <div className="mt-1 flex items-center gap-2 text-xl font-black text-[#f7f8fb]">
                  <Lightbulb size={15} className="text-cyan-300" />
                  {hintBalance}
                </div>
              </div>
              <div className="rounded-2xl border border-rose-500/15 bg-rose-500/[0.05] px-3 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#d2a1b1]">Возрождения</div>
                <div className="mt-1 flex items-center gap-2 text-xl font-black text-[#f7f8fb]">
                  <Heart size={15} className="text-rose-300" />
                  {reviveBalance}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        <HeaderBar
          balance={coinBalance}
          walletMode={walletController.walletMode}
          walletDisplay={walletController.walletDisplay}
          walletError={walletController.walletError}
          showDisconnectAction={walletController.showDisconnectAction}
          onWalletClick={walletController.onWalletClick}
          onDisconnect={walletController.onDisconnect}
          animated={false}
          className="mb-3 shrink-0"
        />

        {purchaseError && (
          <div className="mb-3 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {purchaseError}
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="rounded-3xl border border-white/10 bg-[#111526]/75 px-6 py-5 text-white/70 backdrop-blur-xl">
              Загружаем магазин...
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#111526]/75 p-6 text-center backdrop-blur-xl">
              <p className="text-lg font-bold text-white">{error}</p>
              <button
                type="button"
                onClick={() => void loadCatalog()}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 font-bold text-white transition hover:bg-white/15"
              >
                <RefreshCcw size={16} />
                Повторить
              </button>
            </div>
          </div>
        ) : !hasStoreContent ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#111526]/75 p-6 text-center backdrop-blur-xl">
              <p className="text-lg font-bold text-white">Магазин временно недоступен</p>
              <p className="mt-2 text-sm text-white/60">Каталог пока не вернул доступные товары.</p>
            </div>
          </div>
        ) : (
          <div className="pb-6">
            {tonStatus && (
              <div className="mb-3 rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
                {tonStatus}
              </div>
            )}

            <section className="space-y-4">
              <div className="pl-1 text-sm font-bold uppercase tracking-[0.18em] text-[#677086]">Расходники</div>

              {BOOST_IDS.map((boostId) => {
                const item = boostMap.get(boostId);
                if (!item) return null;

                return (
                  <BoostCard
                    key={boostId}
                    boostId={boostId}
                    item={item}
                    quantity={quantities[boostId]}
                    coinBalance={coinBalance}
                    isPurchasing={purchasingId === boostId}
                    onChangeQuantity={(value) => setQuantity(boostId, value)}
                    onPurchase={() => void handlePurchase(item, quantities[boostId])}
                  />
                );
              })}
            </section>

            {upgrades.length > 0 && (
              <section className="mt-5 space-y-4">
                <div className="pl-1 text-sm font-bold uppercase tracking-[0.18em] text-[#677086]">Улучшения</div>

                {upgrades.map((item) => {
                  const purchased = item.purchasedCount ?? 0;
                  const maxP = item.maxPurchases ?? 2;
                  const isMaxed = purchased >= maxP;
                  const noWallet = !user?.walletAddress;

                  return (
                    <motion.section
                      key={item.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-[24px] border border-white/5 bg-[#18181b]/60 p-5 backdrop-blur-md"
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-pink-500/20 bg-pink-500/10">
                          <Heart size={24} className="text-pink-400" strokeWidth={2.5} />
                        </div>
                        <div className="min-w-0">
                          <h2 className="text-xl font-bold text-[#f7f8fb]">{item.name}</h2>
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex gap-1">
                              {Array.from({ length: maxP }, (_, i) => (
                                <div
                                  key={i}
                                  className={`h-1.5 w-8 rounded-full ${i < purchased ? 'bg-pink-400' : 'bg-white/10'}`}
                                />
                              ))}
                            </div>
                            <span className="text-xs text-[#677086]">{purchased}/{maxP}</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-6 flex items-center">
                        <button
                          type="button"
                          onClick={() => void handleTonPurchase(item)}
                          disabled={!!purchasingId || isMaxed || noWallet}
                          className="relative flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-pink-500 font-bold text-white transition-all hover:bg-pink-400 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                        >
                          {purchasingId === item.id ? (
                            <span className="animate-pulse">Обработка...</span>
                          ) : isMaxed ? (
                            <span>Максимум</span>
                          ) : noWallet ? (
                            <span>Подключите кошелёк</span>
                          ) : (
                            <>
                              <span>Купить</span>
                              <div className="mx-1 h-4 w-px bg-black/20" />
                              <span>{item.priceTon} TON</span>
                            </>
                          )}
                        </button>
                      </div>
                    </motion.section>
                  );
                })}
              </section>
            )}

            {tonItems.length > 0 && (
              <div className="mt-5">
                <div className="mb-3 flex items-center gap-2">
                  <Diamond size={16} className="text-violet-400" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-300/80">Premium</span>
                </div>

                <div className="space-y-3">
                  {tonItems.map((item, index) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.06 * index }}
                      className="rounded-3xl border border-white/10 bg-[#14182b]/78 p-4 shadow-[0_16px_36px_rgba(0,0,0,0.24)] backdrop-blur-xl"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-400/10 text-2xl text-violet-200">
                          {item.preview || '💎'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-base font-bold text-white">{item.name}</h3>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleTonPurchase(item)}
                          disabled={!!purchasingId || item.owned === true}
                          className="shrink-0 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-600 px-4 py-2.5 text-sm font-black text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {item.owned
                            ? 'Куплено'
                            : purchasingId === item.id
                              ? '...'
                              : `${item.priceTon} TON`}
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
