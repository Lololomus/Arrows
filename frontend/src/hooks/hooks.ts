import { useCallback, useState } from 'react';
import { socialApi } from '../api/client';
import type { ReferralInfo, ReferralLeaderboardEntry } from '../game/types';

type TelegramWebAppLike = {
  openTelegramLink: (url: string) => void;
};

type TelegramWindow = Window & {
  Telegram?: {
    WebApp?: TelegramWebAppLike;
  };
};

export function useReferral() {
  const [code, setCode] = useState('');
  const [link, setLink] = useState('');
  const [stats, setStats] = useState({ count: 0, pending: 0, earned: 0 });
  const [confirmLevel, setConfirmLevel] = useState<number | null>(null);
  const [referrals, setReferrals] = useState<ReferralInfo[]>([]);
  const [referralLeaders, setReferralLeaders] = useState<ReferralLeaderboardEntry[]>([]);
  const [myReferralPosition, setMyReferralPosition] = useState<number | null>(null);
  const [myReferralScore, setMyReferralScore] = useState(0);
  const [myReferralInTop, setMyReferralInTop] = useState(false);
  const [referralTotalParticipants, setReferralTotalParticipants] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchReferralCode = useCallback(async () => {
    try {
      const data = await socialApi.getReferralCode();
      setCode(data.code);
      setLink(data.link);
    } catch (error) {
      console.error('Fetch referral code error:', error);
    }
  }, []);

  const fetchReferralStats = useCallback(async () => {
    try {
      const data = await socialApi.getReferralStats();
      setStats({
        count: data.referrals_count,
        pending: data.referrals_pending,
        earned: data.total_earned,
      });
      setConfirmLevel(data.referral_confirm_level);
      if (data.referral_code) setCode(data.referral_code);
      if (data.referral_link) setLink(data.referral_link);
    } catch (error) {
      console.error('Fetch referral stats error:', error);
    }
  }, []);

  const fetchMyReferrals = useCallback(async () => {
    setLoading(true);
    try {
      const data = await socialApi.getMyReferrals();
      setReferrals(data.referrals);
    } catch (error) {
      console.error('Fetch my referrals error:', error);
    }
    setLoading(false);
  }, []);

  const fetchReferralLeaderboard = useCallback(async (limit = 100) => {
    setLoading(true);
    try {
      const data = await socialApi.getReferralLeaderboard(limit);
      setReferralLeaders(data.leaders);
      setMyReferralPosition(data.my_position);
      setMyReferralScore(data.my_score);
      setMyReferralInTop(data.my_in_top ?? false);
      setReferralTotalParticipants(data.total_participants ?? 0);
    } catch (error) {
      console.error('Fetch referral leaderboard error:', error);
    }
    setLoading(false);
  }, []);

  const shareReferral = useCallback(() => {
    if (!link) return;

    const text = `Играй в Arrow Puzzle и получи бонус!\n${link}`;
    const tg = (window as TelegramWindow).Telegram?.WebApp;

    if (tg) {
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Играй в Arrow Puzzle!')}`;
      tg.openTelegramLink(shareUrl);
    } else {
      void navigator.clipboard.writeText(text);
    }
  }, [link]);

  return {
    code,
    link,
    stats,
    confirmLevel,
    referrals,
    referralLeaders,
    myReferralPosition,
    myReferralScore,
    myReferralInTop,
    referralTotalParticipants,
    loading,
    fetchReferralCode,
    fetchReferralStats,
    fetchMyReferrals,
    fetchReferralLeaderboard,
    shareReferral,
  };
}