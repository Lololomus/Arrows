import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Coins, Diamond, Heart, Lightbulb, RefreshCcw, ShoppingBag } from 'lucide-react';
import { useTonConnectUI } from '@tonconnect/ui-react';
import { AdaptiveParticles } from '../components/ui/AdaptiveParticles';
import { CoinStashCard } from '../components/ui/CoinStashCard';
import { WalletButton } from '../components/WalletButton';
import { shopApi } from '../api/client';
import { useAppStore } from '../stores/store';
import type { ShopItem } from '../game/types';

/**
 * Encode a text comment as a TON Cell BOC payload (base64).
 * This matches the standard comment format: 0x00000000 prefix + UTF-8 text.
 */
function buildCommentPayload(comment: string): string {
  // Comment cell: 32-bit zero tag + UTF-8 text
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(comment);
  // Simple BoC serialization of a single cell containing the comment
  // Cell data: 4 bytes (0x00000000 tag) + text bytes
  const dataBytes = new Uint8Array(4 + textBytes.length);
  // First 4 bytes are already 0 (comment op-code)
  dataBytes.set(textBytes, 4);

  // Minimal BOC serialization for a single cell with no refs
  // BOC magic + flags + cell count + root count + absent count + data length + cell data
  const dataBits = dataBytes.length * 8;
  const cellDescriptor1 = 0x00; // no refs, not exotic
  const cellDescriptor2 = Math.ceil(dataBits / 8) * 2 + (dataBits % 8 !== 0 ? 1 : 0); // ceil(bits/8)*2, no completion tag needed since byte-aligned

  const bocMagic = new Uint8Array([0xb5, 0xee, 0x9c, 0x72]);
  // flags byte: has_idx=0, hash_crc32=0, has_cache_bits=0, ref_size=1
  const flags = 0x01; // ref_byte_size = 1
  const sizeBytes = 1; // offset byte size
  const cellCount = 1;
  const rootCount = 1;
  const absentCount = 0;
  const totalCellSize = 2 + dataBytes.length; // 2 descriptor bytes + data

  const boc = new Uint8Array(
    4 + 1 + 1 * 5 + 2 + dataBytes.length
  );
  let offset = 0;

  // Magic
  boc.set(bocMagic, offset); offset += 4;
  // Flags + ref_size
  boc[offset++] = flags;
  // Offset byte size
  boc[offset++] = sizeBytes;
  // Cell count
  boc[offset++] = cellCount;
  // Root count
  boc[offset++] = rootCount;
  // Absent count
  boc[offset++] = absentCount;
  // Total cells size (1 byte since sizeBytes=1)
  boc[offset++] = totalCellSize;
  // Root index
  boc[offset++] = 0;
  // Cell: descriptor bytes
  boc[offset++] = cellDescriptor1;
  boc[offset++] = cellDescriptor2;
  // Cell: data
  boc.set(dataBytes, offset);

  // Base64 encode
  let binary = '';
  for (let i = 0; i < boc.length; i++) {
    binary += String.fromCharCode(boc[i]);
  }
  return btoa(binary);
}

const BETA_ITEM_COPY: Record<string, { title: string; description: string; isRevive?: boolean }> = {
  hints_3: {
    title: '+3 подсказки',
    description: 'Быстрый набор для сложных уровней. Подсказки сохраняются в общем балансе.',
  },
  hints_10: {
    title: '+10 подсказок',
    description: 'Выгодный запас на серию уровней. Баланс обновляется сразу после покупки.',
  },
  revive_1: {
    title: '+1 воскрешение',
    description: 'Воскреснуть на том же месте с +1 жизнью. Применяется мгновенно при смерти.',
    isRevive: true,
  },
  revive_3: {
    title: '+3 воскрешения',
    description: 'Запас воскрешений для сложной серии уровней. Выгоднее поштучно.',
    isRevive: true,
  },
};

const REVIVE_IDS = new Set(['revive_1', 'revive_3']);

function normalizeBoosts(items: ShopItem[]): ShopItem[] {
  return items.filter(
    (item) => item.id === 'hints_3' || item.id === 'hints_10' || REVIVE_IDS.has(item.id),
  );
}

export function ShopScreen() {
  const user = useAppStore(s => s.user);
  const updateUser = useAppStore(s => s.updateUser);
  const [tonConnectUI] = useTonConnectUI();

  const [items, setItems] = useState<ShopItem[]>([]);
  const [tonItems, setTonItems] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [tonStatus, setTonStatus] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const catalog = await shopApi.getCatalog();
      setItems(normalizeBoosts(catalog.boosts));
      setTonItems([...catalog.arrowSkins, ...catalog.themes].filter(i => i.priceTon != null));
    } catch {
      setError('Не удалось загрузить магазин');
      setItems([]);
      setTonItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const coinBalance = user?.coins ?? 0;
  const hintBalance = user?.hintBalance ?? 0;
  const reviveBalance = user?.reviveBalance ?? 0;

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
        reviveBalance: result.reviveBalance ?? reviveBalance,
      });
    } catch {
      setPurchaseError('Покупка не удалась');
    } finally {
      setPurchasingId(null);
    }
  }, [coinBalance, hintBalance, reviveBalance, purchasingId, updateUser]);

  const handleTonPurchase = useCallback(async (item: ShopItem) => {
    if (purchasingId) return;

    if (!user?.walletAddress) {
      setPurchaseError('Сначала подключите TON кошелёк');
      return;
    }

    const itemType = item.id.startsWith('vip') ? 'boosts'
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

      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [
          {
            address: paymentInfo.address,
            amount: amountNano,
            payload: commentPayload,
          },
        ],
      };

      await tonConnectUI.sendTransaction(transaction);

      setTonStatus('Ожидаем подтверждение...');

      // Poll confirm endpoint — backend scans blockchain by comment+amount
      const txId = paymentInfo.transaction_id;

      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const result = await shopApi.confirmTransaction(txId);
          if (result.status === 'completed') {
            setTonStatus(null);
            setPurchaseError(null);
            void loadCatalog();
            return;
          }
        } catch {
          // continue polling
        }
      }

      setTonStatus(null);
      setPurchaseError('Транзакция отправлена, но подтверждение ещё не получено. Проверьте позже.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('Interrupted') || msg.includes('cancel')) {
        setTonStatus(null);
      } else {
        setPurchaseError('Ошибка при отправке транзакции');
        setTonStatus(null);
      }
    } finally {
      setPurchasingId(null);
    }
  }, [purchasingId, user?.walletAddress, tonConnectUI, loadCatalog]);

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
                Подсказки и воскрешения за монеты. Воскрешение восстанавливает игру там, где вы остановились.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-right">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200/70">Подсказки</div>
                <div className="mt-1 flex items-center justify-end gap-2 text-2xl font-black text-white">
                  <Lightbulb size={20} className="text-amber-300" />
                  {hintBalance}
                </div>
              </div>
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-right">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200/70">Ревайвы</div>
                <div className="mt-1 flex items-center justify-end gap-2 text-2xl font-black text-white">
                  <Heart size={20} className="text-emerald-400" />
                  {reviveBalance}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        <CoinStashCard balance={coinBalance} animated={false} className="mb-2 shrink-0" />
        <WalletButton animated={false} className="mb-4 shrink-0" />

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
            {tonStatus && (
              <div className="mb-4 rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
                {tonStatus}
              </div>
            )}

            {/* Premium TON Items */}
            {tonItems.length > 0 && (
              <div className="mb-6">
                <div className="mb-3 flex items-center gap-2">
                  <Diamond size={16} className="text-violet-400" />
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-violet-300/80">Premium</span>
                </div>
                <div className="space-y-3">
                  {tonItems.map((item, index) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.06 }}
                      className="rounded-3xl border border-violet-500/20 bg-[#111526]/75 p-4 backdrop-blur-xl shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-400/20 to-purple-600/20 text-2xl ring-1 ring-violet-400/20">
                          {item.preview || '💎'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-base font-bold text-white">{item.name}</h3>
                        </div>
                        <button
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

            {/* Boosts for coins */}
            <div className="space-y-4">
              {sortedItems.map((item, index) => {
                const price = item.priceCoins ?? 0;
                const insufficientCoins = price > coinBalance;
                const copy = BETA_ITEM_COPY[item.id] ?? {
                  title: item.name,
                  description: 'Покупка за монеты.',
                };
                const isRevive = REVIVE_IDS.has(item.id);

                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.06 }}
                    className={`rounded-3xl border bg-[#111526]/75 p-5 backdrop-blur-xl shadow-[0_18px_50px_rgba(0,0,0,0.35)] ${
                      isRevive ? 'border-emerald-500/20' : 'border-white/10'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ring-1 ${
                        isRevive
                          ? 'bg-gradient-to-br from-emerald-400/20 to-green-600/20 text-emerald-400 ring-emerald-400/20'
                          : 'bg-gradient-to-br from-amber-400/20 to-orange-500/20 text-amber-300 ring-amber-300/20'
                      }`}>
                        {isRevive ? <Heart size={24} /> : <Lightbulb size={24} />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h2 className="text-xl font-black text-white">{copy.title}</h2>
                            <p className="mt-1 text-sm text-white/60">{copy.description}</p>
                          </div>

                          <div className={`rounded-2xl border px-3 py-2 text-right ${
                            isRevive
                              ? 'border-emerald-400/20 bg-emerald-500/10'
                              : 'border-yellow-400/20 bg-yellow-500/10'
                          }`}>
                            <div className={`text-xs font-bold uppercase tracking-[0.16em] ${
                              isRevive ? 'text-emerald-200/70' : 'text-yellow-200/70'
                            }`}>Цена</div>
                            <div className="mt-1 flex items-center gap-1 text-xl font-black text-white">
                              <Coins size={16} className={isRevive ? 'text-emerald-300' : 'text-yellow-300'} />
                              {price}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-3">
                          <div className="text-xs text-white/45">
                            {insufficientCoins
                              ? 'Недостаточно монет для покупки'
                              : isRevive
                                ? 'Воскрешения добавятся в баланс сразу'
                                : 'Подсказки добавятся в общий баланс'}
                          </div>

                          <button
                            onClick={() => void handlePurchase(item)}
                            disabled={insufficientCoins || purchasingId === item.id}
                            className={`rounded-2xl px-4 py-3 text-sm font-black text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${
                              isRevive
                                ? 'bg-gradient-to-r from-emerald-500 to-green-600'
                                : 'bg-gradient-to-r from-amber-500 to-orange-600'
                            }`}
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
