import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, ChevronRight, Gem, Info, Loader2, Lock, Package, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { contractsApi, handleApiError } from '../api/client';
import viceCreamImage from '../assets/contract-nfts/vice-cream.png';
import victoryMedalImage from '../assets/contract-nfts/victory-medal.png';
import type { ContractDto, UserContractState } from '../game/types';
import { useAppStore } from '../stores/store';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function useLocale() {
  return useAppStore((s) => s.user?.locale ?? 'ru');
}

type TFn = ReturnType<typeof useTranslation>['t'];
type ContractDevScenarioId =
  | 'live'
  | 'fresh'
  | 'active'
  | 'stage_ready'
  | 'stage_completed'
  | 'notification'
  | 'reward_ready'
  | 'sending'
  | 'cancelled'
  | 'completed'
  | 'sold_out'
  | 'mixed';

function getTitle(contract: ContractDto, locale: string): string {
  return locale === 'ru' ? contract.titleRu : contract.titleEn;
}

function getStageTitle(
  stage: { titleRu: string; titleEn: string },
  locale: string,
): string {
  return locale === 'ru' ? stage.titleRu : stage.titleEn;
}

const DEV_CONTRACTS_ENABLED = import.meta.env.DEV || (
  import.meta.env.MODE !== 'production'
  && ['1', 'true', 'yes', 'on'].includes(String(import.meta.env.VITE_ENABLE_DEV_AUTH || '').toLowerCase())
);

const CONTRACT_DEV_SCENARIOS: readonly {
  id: ContractDevScenarioId;
  label: string;
  description: string;
}[] = [
  { id: 'live', label: 'Live API', description: 'Реальные данные' },
  { id: 'fresh', label: 'Новый', description: 'Все доступны' },
  { id: 'active', label: 'В процессе', description: 'Этап не готов' },
  { id: 'stage_ready', label: 'Выполнил', description: 'Можно закрыть этап' },
  { id: 'stage_completed', label: 'Закрыл этап', description: 'Следующий открыт' },
  { id: 'notification', label: 'Уведомление', description: 'Красная точка' },
  { id: 'reward_ready', label: 'Готово', description: 'Можно забрать' },
  { id: 'sending', label: 'Отправка', description: 'Подарок летит' },
  { id: 'cancelled', label: 'Отменил', description: 'Повтор получения' },
  { id: 'completed', label: 'Получил', description: 'В завершённых' },
  { id: 'sold_out', label: 'Sold out', description: 'Нет слотов' },
  { id: 'mixed', label: 'Микс', description: 'Разные секции' },
];

const CONTRACT_NFT_IMAGE_BY_ID: Record<string, string> = {
  vice_cream: viceCreamImage,
  victory_medal: victoryMedalImage,
};

const CONTRACT_NFT_IDLE_ANIMATION = {
  y: [0, -3, 0, 2, 0],
  rotate: [0, -1.4, 0, 1.4, 0],
  scale: [1, 1.018, 1, 0.992, 1],
};

const CONTRACT_NFT_IDLE_TRANSITION = {
  duration: 3.8,
  times: [0, 0.25, 0.5, 0.75, 1],
  ease: 'easeInOut' as const,
  repeat: Infinity,
};

function getContractNftImage(contract: ContractDto): string | null {
  if (contract.type !== 'nft_gift') return null;
  return CONTRACT_NFT_IMAGE_BY_ID[contract.id] ?? null;
}

function getDeliveryIssueText(status: string | null, locale: string): string | null {
  if (status === 'cancelled') {
    return locale === 'ru' ? 'Получение отменено. Можно попробовать ещё раз.' : 'Claim cancelled. You can try again.';
  }
  if (status === 'failed') {
    return locale === 'ru' ? 'Доставка не удалась. Можно попробовать ещё раз.' : 'Delivery failed. You can try again.';
  }
  return null;
}

function logFragmentsError(
  operation: string,
  error: unknown,
  context: Record<string, unknown> = {},
): string {
  const message = handleApiError(error);
  console.error(`[Fragments] ${operation} failed`, { ...context, message }, error);
  return message;
}

function getDevStageTemplate(contract: ContractDto, index: number) {
  const existing = contract.userState?.stages.find((stage) => stage.index === index);
  const stageNumber = index + 1;
  return {
    index,
    metric: existing?.metric ?? 'dev_metric',
    target: existing?.target ?? stageNumber * 100,
    titleRu: existing?.titleRu ?? `DEV этап ${stageNumber}`,
    titleEn: existing?.titleEn ?? `DEV stage ${stageNumber}`,
    snapshotValue: existing?.snapshotValue ?? null,
  };
}

function buildDevUserState(
  contract: ContractDto,
  status: UserContractState['status'],
  options: {
    currentStageIndex?: number;
    completedCount?: number;
    currentProgressRatio?: number;
    currentCompletable?: boolean;
    rewardClaimStatus?: string | null;
  } = {},
): UserContractState {
  const now = new Date().toISOString();
  const maxStageIndex = Math.max(0, contract.stagesCount - 1);
  const isFinished = status === 'reward_ready' || status === 'collecting' || status === 'completed';
  const currentStageIndex = Math.min(
    maxStageIndex,
    options.currentStageIndex ?? (isFinished ? maxStageIndex : 0),
  );
  const completedCount = Math.min(
    contract.stagesCount,
    options.completedCount ?? (isFinished ? contract.stagesCount : 0),
  );
  const visibleCount = status === 'completed' || isFinished ? contract.stagesCount : currentStageIndex + 1;

  const stages = Array.from({ length: visibleCount }, (_, index) => {
    const template = getDevStageTemplate(contract, index);
    const isCompleted = index < completedCount;
    const isCurrent = index === currentStageIndex;
    const progressRatio = options.currentProgressRatio ?? 0.42;
    const progressCurrent = isCompleted
      ? template.target
      : isCurrent
      ? Math.min(template.target, Math.max(0, Math.round(template.target * progressRatio)))
      : 0;

    return {
      ...template,
      progressCurrent: options.currentCompletable && isCurrent ? template.target : progressCurrent,
      isCurrent,
      isCompleted,
      isCompletable: status === 'active' && isCurrent && options.currentCompletable === true,
    };
  });

  return {
    status,
    currentStageIndex,
    stages,
    activatedAt: now,
    completedAt: status === 'completed' ? now : null,
    rewardClaimStatus: options.rewardClaimStatus ?? (status === 'collecting' ? 'sending' : null),
    hasPendingAction: status === 'reward_ready' || stages.some((stage) => stage.isCompletable),
  };
}

function makeDevCatalogContract(
  contract: ContractDto,
  options: { busy?: boolean; soldOut?: boolean } = {},
): ContractDto {
  return {
    ...contract,
    remainingQuantity: options.soldOut ? 0 : Math.max(1, contract.remainingQuantity || contract.totalQuantity),
    hasActiveElsewhere: options.busy === true,
    userState: null,
  };
}

function makeDevUserContract(
  contract: ContractDto,
  status: UserContractState['status'],
  options: Parameters<typeof buildDevUserState>[2] = {},
): ContractDto {
  return {
    ...contract,
    remainingQuantity: Math.max(0, (contract.remainingQuantity || contract.totalQuantity) - 1),
    hasActiveElsewhere: false,
    userState: buildDevUserState(contract, status, options),
  };
}

function pickDevContract(contracts: ContractDto[], preferNft = true): ContractDto | null {
  if (preferNft) {
    return contracts.find((contract) => contract.type === 'nft_gift') ?? contracts[0] ?? null;
  }
  return contracts[0] ?? null;
}

function buildContractDevScenario(contracts: ContractDto[], scenario: ContractDevScenarioId): ContractDto[] {
  if (scenario === 'live' || contracts.length === 0) return contracts;

  const activeBase = pickDevContract(contracts, scenario !== 'mixed');
  if (!activeBase) return contracts;

  if (scenario === 'fresh') {
    return contracts.map((contract) => makeDevCatalogContract(contract));
  }

  if (scenario === 'sold_out') {
    return contracts.map((contract) => makeDevCatalogContract(contract, { soldOut: true }));
  }

  if (scenario === 'completed') {
    return contracts.map((contract) =>
      contract.id === activeBase.id
        ? makeDevUserContract(contract, 'completed')
        : makeDevCatalogContract(contract),
    );
  }

  if (scenario === 'mixed') {
    const completedBase = contracts.find((contract) => contract.id !== activeBase.id && contract.type === 'nft_gift');
    return contracts.map((contract) => {
      if (contract.id === activeBase.id) {
        return makeDevUserContract(contract, 'active', {
          currentStageIndex: 0,
          currentCompletable: true,
          currentProgressRatio: 1,
        });
      }
      if (completedBase && contract.id === completedBase.id) {
        return makeDevUserContract(contract, 'completed');
      }
      return makeDevCatalogContract(contract, { busy: true });
    });
  }

  const activeOptionsByScenario: Record<
    Exclude<ContractDevScenarioId, 'live' | 'fresh' | 'sold_out' | 'completed' | 'mixed'>,
    { status: UserContractState['status']; options?: Parameters<typeof buildDevUserState>[2] }
  > = {
    active: { status: 'active', options: { currentProgressRatio: 0.35 } },
    stage_ready: { status: 'active', options: { currentProgressRatio: 1, currentCompletable: true } },
    stage_completed: activeBase.stagesCount <= 1
      ? { status: 'reward_ready' }
      : {
          status: 'active',
          options: {
            currentStageIndex: 1,
            completedCount: 1,
            currentProgressRatio: 0,
          },
        },
    notification: { status: 'active', options: { currentProgressRatio: 1, currentCompletable: true } },
    reward_ready: { status: 'reward_ready' },
    sending: { status: 'collecting', options: { rewardClaimStatus: 'sending' } },
    cancelled: { status: 'reward_ready', options: { rewardClaimStatus: 'cancelled' } },
  };
  const activeScenario = activeOptionsByScenario[scenario];

  return contracts.map((contract) =>
    contract.id === activeBase.id
      ? makeDevUserContract(contract, activeScenario.status, activeScenario.options)
      : makeDevCatalogContract(contract, { busy: true }),
  );
}

function ContractGiftVisual({
  contract,
  frameClassName,
  frameStyle,
  imageClassName,
  emojiClassName,
  soldOut = false,
  completed = false,
  showNftBadge = false,
}: {
  contract: ContractDto;
  frameClassName: string;
  frameStyle?: CSSProperties;
  imageClassName: string;
  emojiClassName: string;
  soldOut?: boolean;
  completed?: boolean;
  showNftBadge?: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();
  const nftImage = getContractNftImage(contract);
  const shouldAnimate = Boolean(nftImage && !soldOut && !completed && !prefersReducedMotion);

  return (
    <div className={frameClassName} style={frameStyle}>
      {nftImage ? (
        <motion.div
          animate={shouldAnimate ? CONTRACT_NFT_IDLE_ANIMATION : undefined}
          transition={shouldAnimate ? CONTRACT_NFT_IDLE_TRANSITION : undefined}
          className={imageClassName}
          style={{ transformOrigin: '50% 58%', willChange: shouldAnimate ? 'transform' : 'auto' }}
        >
          <img
            src={nftImage}
            alt={getTitle(contract, 'en')}
            className={`h-full w-full object-contain sm:drop-shadow-[0_8px_12px_rgba(0,0,0,0.35)] ${
              soldOut ? 'grayscale opacity-40' : completed ? 'grayscale opacity-70' : ''
            }`}
            draggable={false}
          />
        </motion.div>
      ) : (
        <span className={emojiClassName}>{contract.emoji}</span>
      )}
      {showNftBadge && contract.type === 'nft_gift' && !soldOut && !completed && (
        <div className="absolute -top-1.5 -right-1.5 text-[7px] font-black text-white px-1.5 py-[3px] rounded border border-white/20 uppercase tracking-wide bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.6)]">
          NFT
        </div>
      )}
    </div>
  );
}

// ─── Info modal ───────────────────────────────────────────────────────────────

const INFO_STEPS: Array<{ emoji: string; key: 'step1' | 'step2' | 'step3' }> = [
  { emoji: '🎯', key: 'step1' },
  { emoji: '📋', key: 'step2' },
  { emoji: '🎁', key: 'step3' },
];

const InfoModal = memo(({ isOpen, onClose, t }: { isOpen: boolean; onClose: () => void; t: TFn }) => {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/55 backdrop-blur-[2px] z-[2000]"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(_e, info) => {
              if (info.offset.y > 100 || info.velocity.y > 500) onClose();
            }}
            className="fixed bottom-0 left-0 right-0 z-[2001] bg-[#1a1a24] rounded-t-[32px] border-t border-[#22d3ee]/30 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] flex flex-col"
            style={{ maxHeight: '85vh', paddingBottom: 'var(--app-safe-bottom)' }}
          >
            {/* Ползунок для свайпа */}
            <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mt-4 mb-3 shrink-0" />

            <div className="text-center px-6 pb-4 shrink-0">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/20 mb-4">
                <Gem className="text-cyan-400 w-8 h-8" />
              </div>
              <h3 className="text-2xl font-black text-white uppercase tracking-wide drop-shadow-md">
                {t('fragments:info.title')}
              </h3>
            </div>

            <div className="overflow-y-auto overscroll-contain px-6 pb-6 flex-1 min-h-0">
              <div className="space-y-4 text-left">
                {/* Блок с шагами */}
                <div className="bg-gradient-to-br from-cyan-900/40 to-blue-900/20 rounded-2xl p-4 border border-cyan-500/30 shadow-lg">
                  <h4 className="text-cyan-400 font-bold text-base mb-3 text-center uppercase tracking-wider drop-shadow-sm">
                    {t('fragments:info.lead')}
                  </h4>
                  <div className="space-y-2">
                    {INFO_STEPS.map(({ emoji, key }) => (
                      <div key={key} className="flex items-center gap-3 bg-black/20 rounded-xl p-3 border border-cyan-500/20">
                        <span className="text-2xl drop-shadow-md">{emoji}</span>
                        <span className="text-white font-medium text-sm">{t(`fragments:info.${key}`)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white/5 rounded-2xl p-4 border border-white/5 mt-4">
                  <p className="text-white/90 font-medium text-sm leading-relaxed">
                    {t('fragments:info.stock')}
                  </p>
                </div>

                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <p className="text-white/90 font-medium text-sm leading-relaxed">
                    {t('fragments:info.limit')}
                  </p>
                </div>

                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <p className="text-white/90 font-medium text-sm leading-relaxed">
                    {t('fragments:info.nftDisclaimer')}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
});
InfoModal.displayName = 'InfoModal';

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ current, target, t }: { current: number; target: number; t: TFn }) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div className="mt-3">
      <div className="flex justify-between items-end mb-1.5">
        <span className="text-[10px] text-white/50 font-bold uppercase tracking-wide">{t('fragments:contracts.progress')}</span>
        <span className="text-sm font-black text-white">
          {current}
          <span className="text-white/40 text-xs font-bold">/{target}</span>
        </span>
      </div>
      <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
        <motion.div
          className="h-full bg-gradient-to-r from-cyan-500 to-blue-400 rounded-full shadow-[0_0_8px_rgba(0,210,255,0.4)]"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

// ─── Stage list ───────────────────────────────────────────────────────────────

function StageList({
  state,
  stagesCount,
  locale,
  t,
}: {
  state: UserContractState;
  stagesCount: number;
  locale: string;
  t: TFn;
}) {
  const completedCount = state.stages.filter((s) => s.isCompleted).length;

  return (
    <div className="mt-3 space-y-2">
      {/* Счётчик этапов */}
      <div className="flex items-center justify-between text-[11px] text-white/50 font-medium">
        <span>{t('fragments:contracts.stages')}</span>
        <span className="font-bold text-white/70">
          {completedCount}/{stagesCount}
        </span>
      </div>

      {state.stages.map((stage) => (
        <div
          key={stage.index}
          className={`flex items-start gap-2 p-2.5 rounded-xl border ${
            stage.isCompleted
              ? 'border-emerald-500/20 bg-emerald-500/5'
              : stage.isCurrent
              ? 'border-cyan-500/30 bg-cyan-500/5'
              : 'border-white/8 bg-white/3'
          }`}
        >
          <div
            className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
              stage.isCompleted
                ? 'bg-emerald-500'
                : stage.isCurrent
                ? 'bg-cyan-500/20 border border-cyan-500/50'
                : 'bg-white/10'
            }`}
          >
            {stage.isCompleted ? (
              <CheckCircle2 size={11} className="text-white" />
            ) : (
              <span className="text-[9px] font-bold text-white/60">{stage.index + 1}</span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p
              className={`text-xs font-semibold leading-tight ${
                stage.isCompleted ? 'text-emerald-400' : stage.isCurrent ? 'text-white' : 'text-white/50'
              }`}
            >
              {getStageTitle(stage, locale)}
            </p>

            {stage.isCurrent && !stage.isCompleted && (
              <ProgressBar current={stage.progressCurrent} target={stage.target} t={t} />
            )}
          </div>

          {stage.isCompleted && (
            <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
          )}
          {stage.isCurrent && !stage.isCompleted && stage.isCompletable && (
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shrink-0 mt-1.5" />
          )}
        </div>
      ))}

      {/* Locked future stages */}
      {state.stages.length < stagesCount &&
        Array.from({ length: stagesCount - state.stages.length }).map((_, i) => (
          <div
            key={`locked-${i}`}
            className="flex items-center gap-2 p-2.5 rounded-xl border border-white/5 bg-white/[0.02] opacity-40"
          >
            <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center shrink-0">
              <Lock size={9} className="text-white/40" />
            </div>
            <p className="text-xs text-white/30 font-medium">{t('fragments:contracts.nextStage')}</p>
          </div>
        ))}
    </div>
  );
}

// ─── Active contract card ─────────────────────────────────────────────────────

const ActiveContractCard = memo(function ActiveContractCard({
  contract,
  onCompleteStage,
  onCollect,
  loadingAction,
  locale,
  t,
}: {
  contract: ContractDto;
  onCompleteStage: (id: string) => void;
  onCollect: (id: string) => void;
  loadingAction: string | null;
  locale: string;
  t: TFn;
}) {
  const state = contract.userState!;
  const isLoading = loadingAction === contract.id;

  const currentStage = state.stages.find((s) => s.isCurrent && !s.isCompleted) ?? null;
  const canCompleteStage = state.status === 'active' && currentStage?.isCompletable === true;
  const canCollect = state.status === 'reward_ready';
  const isCollecting = state.status === 'collecting' || state.rewardClaimStatus === 'sending';
  const hasAction = canCompleteStage || canCollect || isCollecting;
  const deliveryIssueText = getDeliveryIssueText(state.rewardClaimStatus, locale);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{
        opacity: 1,
        y: 0,
        boxShadow: hasAction
          ? ['0 0 0 0 rgba(0,210,255,0.3)', '0 0 0 8px rgba(0,210,255,0)', '0 0 0 0 rgba(0,210,255,0)']
          : '0 0 0 0 rgba(0,0,0,0)',
      }}
      transition={{
        opacity: { duration: 0.3 },
        y: { duration: 0.3 },
        boxShadow: { duration: 2, repeat: hasAction ? Infinity : 0, ease: 'easeOut' },
      }}
      className="rounded-2xl border border-cyan-500/40 bg-gradient-to-b from-cyan-500/10 to-transparent p-4 relative overflow-hidden backdrop-blur-[10px]"
    >
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />

      {/* Header */}
      <div className="flex items-start gap-3">
        <ContractGiftVisual
          contract={contract}
          frameClassName="relative w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/40 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(0,210,255,0.2)]"
          imageClassName="h-14 w-14"
          emojiClassName="text-3xl"
          showNftBadge
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-400/80 mb-0.5">
                {t('fragments:contracts.activeLabel')}
              </p>
              <h3 className="font-bold text-base leading-tight text-white">
                {getTitle(contract, locale)}
              </h3>
            </div>
            <div className="shrink-0 text-[10px] font-bold text-white/40 bg-white/5 border border-white/10 px-2 py-1 rounded-lg">
              {contract.remainingQuantity}/{contract.totalQuantity} {t('common:units.itemShort')}
            </div>
          </div>

          {contract.giftStarCost > 0 && (
            <div className="flex items-center gap-1 mt-1">
              <Star size={10} className="text-yellow-400" />
              <span className="text-xs font-bold text-yellow-400">{contract.giftStarCost} ⭐️</span>
            </div>
          )}
        </div>
      </div>

      {/* Stage list */}
      <StageList state={state} stagesCount={contract.stagesCount} locale={locale} t={t} />

      {deliveryIssueText && (
        <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200/90">
          {deliveryIssueText}
        </div>
      )}

      {/* CTA */}
      <div className="mt-4">
        {isCollecting ? (
          <div className="w-full py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-center justify-center gap-2">
            <Loader2 size={14} className="text-yellow-400 animate-spin" />
            <span className="text-yellow-400 text-sm font-bold">{t('fragments:contracts.sending')}</span>
          </div>
        ) : canCollect ? (
          <button
            onClick={() => onCollect(contract.id)}
            disabled={isLoading}
            className="relative w-full py-3 text-sm font-bold uppercase tracking-wider text-white rounded-xl overflow-hidden flex items-center justify-center gap-2 disabled:opacity-60"
            style={{
              background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
              boxShadow: '0 0 16px rgba(16,185,129,0.35)',
            }}
          >
            {isLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>{t('fragments:contracts.collectGift')}</>
            )}
            {!isLoading && (
              <motion.span
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-[-25deg]"
                animate={{ x: ['-150%', '250%'] }}
                transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 1.5, ease: 'linear' }}
              />
            )}
          </button>
        ) : canCompleteStage ? (
          <button
            onClick={() => onCompleteStage(contract.id)}
            disabled={isLoading}
            className="relative w-full py-3 text-sm font-bold uppercase tracking-wider text-white rounded-xl overflow-hidden flex items-center justify-center gap-2 disabled:opacity-60"
            style={{
              background: 'linear-gradient(90deg, #00d2ff 0%, #009dff 100%)',
              boxShadow: '0 0 16px rgba(0,210,255,0.35)',
            }}
          >
            {isLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>{t('fragments:contracts.completeStage')}</>
            )}
            {!isLoading && (
              <motion.span
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-[-25deg]"
                animate={{ x: ['-150%', '250%'] }}
                transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 1.5, ease: 'linear' }}
              />
            )}
          </button>
        ) : (
          <div className="w-full py-2.5 bg-white/5 border border-white/8 rounded-xl text-center text-xs font-bold text-white/40 uppercase tracking-wider">
            {t('fragments:contracts.waiting')}
          </div>
        )}
      </div>
    </motion.div>
  );
});

// ─── Catalog contract card ────────────────────────────────────────────────────

const CatalogContractCard = memo(function CatalogContractCard({
  contract,
  onActivate,
  loadingAction,
  locale,
  t,
}: {
  contract: ContractDto;
  onActivate: (id: string) => void;
  loadingAction: string | null;
  locale: string;
  t: TFn;
}) {
  const isLoading = loadingAction === contract.id;
  const soldOut = contract.remainingQuantity <= 0;
  const busy = contract.hasActiveElsewhere;
  const isNft = contract.type === 'nft_gift';

  const scheme = isNft
    ? {
        border: 'border-violet-500/30',
        gradientFrom: 'from-violet-500/12',
        topLine: 'via-violet-400/50',
        glowBg: 'bg-violet-500/10',
        emojiBorder: 'border-violet-500/40',
        emojiGradient: 'from-violet-600/20 to-purple-700/20',
        emojiShadow: '0 0 18px rgba(139,92,246,0.35)',
        qty: 'text-violet-300 bg-violet-500/10 border-violet-500/25',
        btn: { background: 'linear-gradient(90deg,#7c3aed 0%,#6d28d9 100%)', boxShadow: '0 0 14px rgba(124,58,237,0.4)' },
      }
    : {
        border: 'border-cyan-500/25',
        gradientFrom: 'from-cyan-500/8',
        topLine: 'via-cyan-400/40',
        glowBg: 'bg-cyan-500/8',
        emojiBorder: 'border-cyan-500/35',
        emojiGradient: 'from-cyan-500/15 to-blue-600/15',
        emojiShadow: '0 0 18px rgba(0,210,255,0.25)',
        qty: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
        btn: { background: 'linear-gradient(90deg,#00d2ff 0%,#0099ee 100%)', boxShadow: '0 0 14px rgba(0,210,255,0.35)' },
      };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`rounded-2xl border relative overflow-hidden backdrop-blur-[10px] ${scheme.border} bg-gradient-to-b ${scheme.gradientFrom} to-transparent ${soldOut || busy ? 'opacity-55' : ''}`}
    >
      {/* Top shine line */}
      <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-2/3 h-px bg-gradient-to-r from-transparent ${scheme.topLine} to-transparent`} />
      {/* Corner glow */}
      <div className={`absolute -top-4 -right-4 w-28 h-28 ${scheme.glowBg} blur-2xl pointer-events-none rounded-full`} />

      <div className="flex items-center gap-3 p-4 relative z-10">
        {/* Gift badge */}
        <ContractGiftVisual
          contract={contract}
          frameClassName={`relative w-[60px] h-[60px] rounded-2xl bg-gradient-to-br ${scheme.emojiGradient} border ${scheme.emojiBorder} flex items-center justify-center shrink-0 ${soldOut ? 'grayscale' : ''}`}
          frameStyle={{ boxShadow: soldOut ? 'none' : scheme.emojiShadow }}
          imageClassName="h-[60px] w-[60px]"
          emojiClassName={`text-[34px] leading-none ${soldOut ? 'opacity-40' : ''}`}
          soldOut={soldOut}
          showNftBadge
        />

        {/* Info block */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-black text-[15px] leading-tight text-white tracking-tight">
              {getTitle(contract, locale)}
            </h3>
            <div className={`shrink-0 text-[10px] font-bold px-2 py-[3px] rounded-lg border whitespace-nowrap ${soldOut ? 'text-white/25 bg-white/5 border-white/8' : scheme.qty}`}>
              {contract.remainingQuantity}/{contract.totalQuantity} {t('common:units.itemShort')}
            </div>
          </div>

          <div className="flex items-center gap-2 mt-1.5">
            {contract.giftStarCost > 0 && (
              <span className="text-[11px] font-bold text-yellow-400 flex items-center gap-0.5">
                ⭐ {contract.giftStarCost}
              </span>
            )}
            <span className="text-[10px] text-white/35 font-medium">
              {t('fragments:contracts.stagesCount', { count: contract.stagesCount })}
            </span>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="px-4 pb-4 relative z-10">
        {soldOut ? (
          <div className="w-full py-2 bg-black/25 rounded-xl text-center text-[10px] font-bold text-white/25 uppercase tracking-widest border border-white/5">
            {t('fragments:contracts.soldOutCard')}
          </div>
        ) : busy ? (
          <div className="w-full py-2 bg-white/5 rounded-xl text-center text-[10px] font-bold text-white/35 uppercase tracking-widest border border-white/8">
            {t('fragments:contracts.busy')}
          </div>
        ) : (
          <button
            onClick={() => onActivate(contract.id)}
            disabled={isLoading}
            className="relative w-full py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white rounded-xl overflow-hidden flex items-center justify-center gap-1.5 disabled:opacity-60 active:scale-[0.97] transition-transform"
            style={scheme.btn}
          >
            {isLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <><ChevronRight size={13} strokeWidth={2.5} /> {t('fragments:contracts.activate')}</>
            )}
            {!isLoading && (
              <motion.span
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-[-25deg]"
                animate={{ x: ['-150%', '250%'] }}
                transition={{ duration: 2.8, repeat: Infinity, repeatDelay: 2, ease: 'linear' }}
              />
            )}
          </button>
        )}
      </div>
    </motion.div>
  );
});

// ─── Completed contract card ──────────────────────────────────────────────────

function CompletedContractCard({ contract, locale, t }: { contract: ContractDto; locale: string; t: TFn }) {
  return (
    <div className="rounded-2xl border border-emerald-500/15 bg-emerald-900/10 p-4 backdrop-blur-[10px]">
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <ContractGiftVisual
            contract={contract}
            frameClassName="relative w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center"
            imageClassName="h-12 w-12"
            emojiClassName="text-2xl grayscale opacity-70"
            completed
          />
          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-[#0a0c27]">
            <CheckCircle2 size={10} className="text-white" />
          </div>
        </div>
        <div>
          <p className="text-xs font-bold text-emerald-400">{t('fragments:contracts.giftReceived')}</p>
          <p className="text-sm font-semibold text-white/60 mt-0.5">{getTitle(contract, locale)}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Section divider ──────────────────────────────────────────────────────────

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10" />
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">{label}</span>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent via-white/10" />
    </div>
  );
}

function ContractDevPanel({
  scenario,
  onScenarioChange,
  onReloadLive,
}: {
  scenario: ContractDevScenarioId;
  onScenarioChange: (scenario: ContractDevScenarioId) => void;
  onReloadLive: () => void;
}) {
  return (
    <div className="rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-fuchsia-200/90">DEV</p>
          <p className="text-[11px] font-medium text-white/45">Локальная подмена сценариев фрагментов</p>
        </div>
        <button
          type="button"
          onClick={onReloadLive}
          className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/60 active:scale-95"
        >
          API
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {CONTRACT_DEV_SCENARIOS.map((item) => {
          const active = item.id === scenario;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onScenarioChange(item.id)}
              className={`rounded-xl border px-3 py-2 text-left transition active:scale-[0.98] ${
                active
                  ? 'border-fuchsia-300/45 bg-fuchsia-400/20 text-white'
                  : 'border-white/8 bg-black/15 text-white/55'
              }`}
            >
              <span className="block text-[11px] font-black uppercase tracking-[0.08em]">{item.label}</span>
              <span className="mt-0.5 block text-[10px] font-medium opacity-65">{item.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FragmentsTab({
  onPendingActionChange,
  // TODO: ВРЕМЕННО для тестирования — убрать после публичного запуска Fragments
  isAdmin = false,
}: {
  onPendingActionChange?: (hasPending: boolean) => void;
  isAdmin?: boolean;
}) {
  const locale = useLocale();
  const { t } = useTranslation();
  const [contracts, setContracts] = useState<ContractDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [isContractDevOpen, setIsContractDevOpen] = useState(false);
  const [contractDevScenario, setContractDevScenario] = useState<ContractDevScenarioId>('live');

  // Polling for gift delivery
  const pollingRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const loadContracts = useCallback(async () => {
    try {
      const data = await contractsApi.getContracts();
      setContracts(data.contracts);
      onPendingActionChange?.(data.hasPendingAction);
      setError(null);

      // Start polling for any contracts in 'collecting' state
      data.contracts.forEach((c) => {
        if (c.userState?.status === 'collecting' || c.userState?.rewardClaimStatus === 'sending') {
          startPolling(c.id);
        }
      });
    } catch (e) {
      setError(logFragmentsError('loadContracts', e));
    } finally {
      setLoading(false);
    }
  }, [onPendingActionChange]);

  useEffect(() => {
    void loadContracts();
    return () => {
      Object.values(pollingRef.current).forEach(clearInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPolling = useCallback((contractId: string) => {
    if (pollingRef.current[contractId]) return;
    let polls = 0;
    const MAX_POLLS = 100;
    pollingRef.current[contractId] = setInterval(async () => {
      polls++;
      try {
        const status = await contractsApi.getStatus(contractId);
        if (status.claimStatus === 'delivered' || status.status === 'completed') {
          clearInterval(pollingRef.current[contractId]);
          delete pollingRef.current[contractId];
          void loadContracts();
        } else if (status.claimStatus === 'failed') {
          clearInterval(pollingRef.current[contractId]);
          delete pollingRef.current[contractId];
          setContracts((prev) =>
            prev.map((c) =>
              c.id === contractId && c.userState
                ? { ...c, userState: { ...c.userState, status: 'reward_ready', rewardClaimStatus: 'failed' } }
                : c,
            ),
          );
        } else if (polls >= MAX_POLLS) {
          clearInterval(pollingRef.current[contractId]);
          delete pollingRef.current[contractId];
          void loadContracts();
        }
      } catch (e) {
        logFragmentsError('pollContractStatus', e, { contractId, polls });
      }
    }, 6000);
  }, [loadContracts]);

  const handleActivate = useCallback(async (contractId: string) => {
    if (loadingAction) return;
    setLoadingAction(contractId);
    setActionError(null);
    try {
      const updated = await contractsApi.activate(contractId);
      setContracts((prev) =>
        prev.map((c) => (c.id === contractId ? { ...updated, remainingQuantity: c.remainingQuantity - 1, hasActiveElsewhere: false } : { ...c, hasActiveElsewhere: true })),
      );
      onPendingActionChange?.(false);
    } catch (e) {
      setActionError(logFragmentsError('activateContract', e, { contractId }));
    } finally {
      setLoadingAction(null);
    }
  }, [loadingAction, onPendingActionChange]);

  const handleCompleteStage = useCallback(async (contractId: string) => {
    if (loadingAction) return;
    setLoadingAction(contractId);
    setActionError(null);
    try {
      const updated = await contractsApi.completeStage(contractId);
      setContracts((prev) => prev.map((c) => (c.id === contractId ? { ...c, userState: updated.userState } : c)));
      onPendingActionChange?.(updated.userState?.hasPendingAction ?? false);
    } catch (e) {
      setActionError(logFragmentsError('completeContractStage', e, { contractId }));
    } finally {
      setLoadingAction(null);
    }
  }, [loadingAction, onPendingActionChange]);

  const handleCollect = useCallback(async (contractId: string) => {
    if (loadingAction) return;
    setLoadingAction(contractId);
    setActionError(null);
    try {
      const result = await contractsApi.collect(contractId);
      if (result.claimStatus === 'delivered') {
        void loadContracts();
      } else {
        // sending — show collecting state & start polling
        setContracts((prev) =>
          prev.map((c) =>
            c.id === contractId && c.userState
              ? { ...c, userState: { ...c.userState, status: 'collecting', rewardClaimStatus: 'sending' } }
              : c,
          ),
        );
        startPolling(contractId);
      }
      onPendingActionChange?.(false);
    } catch (e) {
      setActionError(logFragmentsError('collectContractReward', e, { contractId }));
      void loadContracts();
    } finally {
      setLoadingAction(null);
    }
  }, [loadingAction, loadContracts, startPolling, onPendingActionChange]);

  const isDevScenarioActive = DEV_CONTRACTS_ENABLED && contractDevScenario !== 'live';
  const displayContracts = isDevScenarioActive
    ? buildContractDevScenario(contracts, contractDevScenario)
    : contracts;
  const displayHasPendingAction = displayContracts.some((contract) => contract.userState?.hasPendingAction === true);

  const handleDevScenarioChange = useCallback((scenario: ContractDevScenarioId) => {
    setActionError(null);
    setContractDevScenario(scenario);
    if (scenario === 'live') {
      onPendingActionChange?.(contracts.some((contract) => contract.userState?.hasPendingAction === true));
    }
  }, [contracts, onPendingActionChange]);

  useEffect(() => {
    if (!DEV_CONTRACTS_ENABLED || contractDevScenario === 'live') return;
    onPendingActionChange?.(displayHasPendingAction);
  }, [contractDevScenario, displayHasPendingAction, onPendingActionChange]);

  const handleReloadLiveContracts = useCallback(() => {
    setActionError(null);
    setContractDevScenario('live');
    setLoading(true);
    void loadContracts();
  }, [loadContracts]);

  const handleDisplayActivate = useCallback((contractId: string) => {
    if (isDevScenarioActive) {
      setActionError(null);
      setContractDevScenario('active');
      return;
    }
    void handleActivate(contractId);
  }, [handleActivate, isDevScenarioActive]);

  const handleDisplayCompleteStage = useCallback((contractId: string) => {
    if (isDevScenarioActive) {
      setActionError(null);
      setContractDevScenario('stage_completed');
      return;
    }
    void handleCompleteStage(contractId);
  }, [handleCompleteStage, isDevScenarioActive]);

  const handleDisplayCollect = useCallback((contractId: string) => {
    if (isDevScenarioActive) {
      setActionError(null);
      setContractDevScenario('sending');
      return;
    }
    void handleCollect(contractId);
  }, [handleCollect, isDevScenarioActive]);

  // Separate contracts into sections
  const activeContract = displayContracts.find(
    (c) => c.userState && c.userState.status !== 'completed',
  ) ?? null;
  const catalogContracts = displayContracts.filter((c) => !c.userState);
  const completedContracts = displayContracts.filter((c) => c.userState?.status === 'completed');

  // TODO: ВРЕМЕННО для тестирования — убрать после публичного запуска Fragments
  if (!isAdmin && !DEV_CONTRACTS_ENABLED) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
          <Lock size={28} className="text-cyan-400" />
        </div>
        <p className="text-white font-bold text-lg">
          {locale === 'ru' ? 'Скоро' : 'Coming soon'}
        </p>
        <p className="text-white/40 text-sm">
          {locale === 'ru'
            ? 'Задания с наградами появятся совсем скоро'
            : 'Reward tasks are coming very soon'}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={28} className="text-cyan-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
        <p className="font-bold mb-1">{t('fragments:contracts.loadError')}</p>
        <p className="text-red-300/70 text-xs">{error}</p>
        <button
          onClick={() => { setLoading(true); void loadContracts(); }}
          className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white"
        >
          {t('common:retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="pb-6 space-y-4 pt-1">
      {/* Banner */}
      <div className="bg-gradient-to-b from-cyan-500/15 to-transparent p-5 rounded-3xl border border-cyan-500/25 text-center relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-28 bg-cyan-500/15 blur-3xl pointer-events-none" />
        <button
          onClick={() => setShowInfo(true)}
          className="absolute top-3.5 right-3.5 z-10 w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 border border-white/20 text-white/75 hover:text-white hover:bg-white/15 active:scale-95 transition-all backdrop-blur-sm shadow-[0_4px_14px_rgba(0,0,0,0.28)] focus-visible:outline-none"
        >
          <Info size={21} />
        </button>
        <Gem size={40} className="text-cyan-400 mx-auto mb-2 relative z-10 drop-shadow-[0_0_12px_rgba(34,211,238,0.5)]" />
        <h1 className="text-[22px] leading-tight font-black text-white uppercase tracking-wide drop-shadow-md relative z-10">
          {t('fragments:contracts.bannerTitle')}
        </h1>
        <p className="text-white/50 text-xs mt-1 relative z-10">
          {t('fragments:contracts.bannerSubtitle')}
        </p>
      </div>

      {DEV_CONTRACTS_ENABLED && (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setIsContractDevOpen((prev) => !prev)}
              className={`rounded-xl border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] transition active:scale-95 ${
                isDevScenarioActive
                  ? 'border-fuchsia-300/35 bg-fuchsia-400/20 text-fuchsia-50'
                  : 'border-fuchsia-400/20 bg-fuchsia-500/10 text-fuchsia-100/85'
              }`}
            >
              {isContractDevOpen
                ? 'Скрыть DEV'
                : `DEV: ${CONTRACT_DEV_SCENARIOS.find((item) => item.id === contractDevScenario)?.label ?? 'Live API'}`}
            </button>
          </div>

          <AnimatePresence initial={false}>
            {isContractDevOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -6 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0, y: -6 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <ContractDevPanel
                  scenario={contractDevScenario}
                  onScenarioChange={handleDevScenarioChange}
                  onReloadLive={handleReloadLiveContracts}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Action error */}
      <AnimatePresence>
        {actionError && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs text-red-300"
          >
            {actionError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active contract */}
      {activeContract && (
        <>
          <SectionDivider label={t('fragments:contracts.sectionActive')} />
          <ActiveContractCard
            contract={activeContract}
            onCompleteStage={handleDisplayCompleteStage}
            onCollect={handleDisplayCollect}
            loadingAction={loadingAction}
            locale={locale}
            t={t}
          />
        </>
      )}

      {/* Catalog */}
      {catalogContracts.length > 0 && (
        <>
          <SectionDivider label={t('fragments:contracts.sectionCatalog')} />
          <div className="space-y-3">
            {catalogContracts.map((contract, i) => (
              <motion.div
                key={contract.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: i * 0.05 }}
              >
                <CatalogContractCard
                  contract={contract}
                  onActivate={handleDisplayActivate}
                  loadingAction={loadingAction}
                  locale={locale}
                  t={t}
                />
              </motion.div>
            ))}
          </div>
        </>
      )}

      {/* Empty catalog */}
      {catalogContracts.length === 0 && !activeContract && completedContracts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Package size={36} className="text-white/20 mb-3" />
          <p className="text-white/40 text-sm font-medium">{t('fragments:contracts.empty')}</p>
        </div>
      )}

      {/* Completed */}
      {completedContracts.length > 0 && (
        <>
          <SectionDivider label={t('fragments:contracts.sectionReceived')} />
          <div className="space-y-2">
            {completedContracts.map((contract) => (
              <CompletedContractCard key={contract.id} contract={contract} locale={locale} t={t} />
            ))}
          </div>
        </>
      )}

      {/* Info modal */}
      <InfoModal isOpen={showInfo} onClose={() => setShowInfo(false)} t={t} />
    </div>
  );
}
