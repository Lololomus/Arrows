import type { AuthResponse, User } from '../game/types';

export interface RawUserResponse {
  id: number;
  telegram_id?: number;
  telegramId?: number;
  username: string | null;
  first_name?: string | null;
  firstName?: string | null;
  photo_url?: string | null;
  current_level?: number;
  currentLevel?: number;
  total_stars?: number;
  totalStars?: number;
  coins?: number;
  hint_balance?: number;
  hintBalance?: number;
  energy?: number;
  energy_updated_at?: string;
  energyUpdatedAt?: string;
  active_arrow_skin?: string;
  activeArrowSkin?: string;
  active_theme?: string;
  activeTheme?: string;
  is_premium?: boolean;
  isPremium?: boolean;
  referrals_count?: number;
  referrals_pending?: number;
}

export interface RawAuthResponse {
  token: string;
  expires_at?: string;
  expiresAt?: string;
  user: RawUserResponse;
}

export function normalizeUserResponse(raw: RawUserResponse): User {
  return {
    id: raw.id,
    telegramId: raw.telegramId ?? raw.telegram_id ?? 0,
    username: raw.username ?? null,
    firstName: raw.firstName ?? raw.first_name ?? null,
    photo_url: raw.photo_url ?? null,
    currentLevel: raw.currentLevel ?? raw.current_level ?? 1,
    totalStars: raw.totalStars ?? raw.total_stars ?? 0,
    coins: raw.coins ?? 0,
    hintBalance: raw.hintBalance ?? raw.hint_balance ?? 5,
    energy: raw.energy ?? 0,
    energyUpdatedAt: raw.energyUpdatedAt ?? raw.energy_updated_at ?? '',
    activeArrowSkin: raw.activeArrowSkin ?? raw.active_arrow_skin ?? 'default',
    activeTheme: raw.activeTheme ?? raw.active_theme ?? 'light',
    isPremium: raw.isPremium ?? raw.is_premium ?? false,
    referrals_count: raw.referrals_count ?? 0,
    referrals_pending: raw.referrals_pending ?? 0,
  };
}

export function normalizeAuthResponse(raw: RawAuthResponse): AuthResponse {
  return {
    token: raw.token,
    expiresAt: raw.expiresAt ?? raw.expires_at ?? '',
    user: normalizeUserResponse(raw.user),
  };
}
