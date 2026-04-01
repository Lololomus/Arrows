import { exists, translate } from './index';

function fromKey(key: string, fallback = ''): string {
  return exists(key) ? translate(key) : fallback;
}

function normalizeTaskClaimId(claimId: string): string {
  return claimId.split(':', 1)[0] || claimId;
}

export function getTaskBaseTitle(taskId: string, fallback = ''): string {
  return fromKey(`tasks:catalog.base.${taskId}.title`, fallback);
}

export function getTaskBaseDescription(taskId: string, fallback = ''): string {
  return fromKey(`tasks:catalog.base.${taskId}.description`, fallback);
}

export function getTaskTierTitle(claimId: string, fallback = ''): string {
  return fromKey(`tasks:catalog.tiers.${normalizeTaskClaimId(claimId)}`, fallback);
}

export function getShopItemName(itemId: string, fallback = ''): string {
  return fromKey(`shop:items.${itemId}.name`, fallback);
}

export function getShopItemDescription(itemId: string, fallback = ''): string {
  return fromKey(`shop:items.${itemId}.description`, fallback);
}

export function getFragmentConditionDescription(
  conditionType: string,
  target: number,
  fallback = '',
): string {
  const key = `fragments:conditions.${conditionType}`;
  if (!exists(key)) return fallback;
  return translate(key, { count: target });
}

export function getErrorCodeMessage(code?: string, fallback = ''): string {
  if (!code) return fallback;
  const key = `errors:codes.${code}`;
  return exists(key) ? translate(key) : fallback;
}
