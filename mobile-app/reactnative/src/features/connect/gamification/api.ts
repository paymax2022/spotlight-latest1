// Paymax Connect — GAMIFICATION api (mock-first via USE_MOCK).
// All values are NON-CASH points/coins. No kobo, no money, ever.

import { api } from '@/api/client';
import { USE_MOCK, CONNECT_API_BASE } from '../constants/connect.constants';
import type {
  GamificationProfile,
  Mission,
  StreakState,
  LeaderboardScope,
  GameLeaderboardEntry,
  Season,
  CatalogReward,
  Badge,
  XpHistoryEntry,
  RedeemResult,
  ClaimResult,
} from './types';

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));
function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}
const AV = (s: string) => `https://i.pravatar.cc/160?u=${s}`;

const MOCK_PROFILE: GamificationProfile = {
  level: 14, xp: 2350, xpToNextLevel: 4000, totalXp: 86_400, coins: 1240,
  rank: 'Rising Star', streakDays: 5,
};

export async function getGamificationProfile(): Promise<GamificationProfile> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_PROFILE };
  }
  const res = await api.get(`${CONNECT_API_BASE}/gamification/profile`);
  return unwrap<GamificationProfile>(res);
}

const MOCK_MISSIONS: Mission[] = [
  { id: 'mi_1', title: 'Daily check-in', description: 'Open Connect today', period: 'daily', progress: 1, target: 1, xpReward: 50, coinReward: 10, status: 'completed' },
  { id: 'mi_2', title: 'Watch a live stream', description: 'Watch any stream for 2 minutes', period: 'daily', progress: 0, target: 1, xpReward: 80, coinReward: 15, status: 'in_progress' },
  { id: 'mi_3', title: 'Cast 3 votes', description: 'Vote in any contest 3 times', period: 'daily', progress: 1, target: 3, xpReward: 120, coinReward: 25, status: 'in_progress' },
  { id: 'mi_4', title: 'Send your first gift', description: 'Support a creator (uses your wallet)', period: 'weekly', progress: 0, target: 1, xpReward: 200, coinReward: 50, status: 'in_progress' },
  { id: 'mi_5', title: 'Reach a 7-day streak', description: 'Check in 7 days in a row', period: 'weekly', progress: 5, target: 7, xpReward: 300, coinReward: 100, status: 'in_progress' },
];

export async function listMissions(): Promise<Mission[]> {
  if (USE_MOCK) {
    await delay(200);
    return MOCK_MISSIONS.map((m) => ({ ...m }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/gamification/missions`);
  return unwrap<Mission[]>(res);
}

export async function claimMission(missionId: string): Promise<ClaimResult> {
  if (USE_MOCK) {
    await delay(320);
    const m = MOCK_MISSIONS.find((x) => x.id === missionId);
    return { ok: true, xpAwarded: m?.xpReward ?? 0, coinsAwarded: m?.coinReward ?? 0 };
  }
  const res = await api.post(`${CONNECT_API_BASE}/gamification/missions/${missionId}/claim`, {});
  return unwrap<ClaimResult>(res);
}

const MOCK_STREAK: StreakState = {
  currentStreak: 5, longestStreak: 21, checkedInToday: false, nextRewardCoins: 30,
  days: [
    { day: 1, rewardCoins: 10, claimed: true, isToday: false },
    { day: 2, rewardCoins: 15, claimed: true, isToday: false },
    { day: 3, rewardCoins: 20, claimed: true, isToday: false },
    { day: 4, rewardCoins: 25, claimed: true, isToday: false },
    { day: 5, rewardCoins: 30, claimed: false, isToday: true },
    { day: 6, rewardCoins: 40, claimed: false, isToday: false },
    { day: 7, rewardCoins: 100, claimed: false, isToday: false },
  ],
};

export async function getStreak(): Promise<StreakState> {
  if (USE_MOCK) {
    await delay(200);
    return JSON.parse(JSON.stringify(MOCK_STREAK));
  }
  const res = await api.get(`${CONNECT_API_BASE}/gamification/streak`);
  return unwrap<StreakState>(res);
}

export async function checkInStreak(): Promise<ClaimResult> {
  if (USE_MOCK) {
    await delay(320);
    return { ok: true, xpAwarded: 50, coinsAwarded: MOCK_STREAK.nextRewardCoins };
  }
  const res = await api.post(`${CONNECT_API_BASE}/gamification/streak/check-in`, {});
  return unwrap<ClaimResult>(res);
}

const MOCK_LB: Record<LeaderboardScope, GameLeaderboardEntry[]> = {
  gifters: [
    { rank: 1, userId: 'u1', name: 'Femi', avatar: AV('femi'), points: 98_200, level: 32 },
    { rank: 2, userId: 'u2', name: 'Ada', avatar: AV('ada'), points: 81_400, level: 28 },
    { rank: 3, userId: 'u3', name: 'Kola', avatar: AV('kola'), points: 64_900, level: 24 },
  ],
  streamers: [
    { rank: 1, userId: 's1', name: 'DJ Kemi', avatar: AV('kemi'), points: 142_000, level: 41 },
    { rank: 2, userId: 's2', name: 'Naomi', avatar: AV('naomi'), points: 120_500, level: 37 },
    { rank: 3, userId: 's3', name: 'Tomi', avatar: AV('tomi'), points: 99_800, level: 30 },
  ],
  voters: [
    { rank: 1, userId: 'v1', name: 'Bisi', avatar: AV('bisi'), points: 54_300, level: 22 },
    { rank: 2, userId: 'v2', name: 'Ife', avatar: AV('ife'), points: 49_100, level: 20 },
    { rank: 3, userId: 'v3', name: 'Zee', avatar: AV('zee'), points: 41_700, level: 18 },
  ],
  regional: [
    { rank: 1, userId: 'r1', name: 'Chuka', avatar: AV('chuka'), points: 71_000, level: 26, region: 'Lagos' },
    { rank: 2, userId: 'r2', name: 'Bola', avatar: AV('bola'), points: 60_200, level: 23, region: 'Lagos' },
    { rank: 3, userId: 'r3', name: 'Ada', avatar: AV('ada'), points: 52_800, level: 21, region: 'Lagos' },
  ],
};

export async function getGameLeaderboard(scope: LeaderboardScope): Promise<GameLeaderboardEntry[]> {
  if (USE_MOCK) {
    await delay(220);
    return MOCK_LB[scope].map((e) => ({ ...e }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/gamification/leaderboard`, { params: { scope } });
  return unwrap<GameLeaderboardEntry[]>(res);
}

const MOCK_SEASON: Season = {
  id: 'se_1', name: 'Harmattan Festival', theme: 'Music & celebration',
  bannerUrl: 'https://picsum.photos/seed/harmattan/800/360',
  endsAtIso: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  passTier: 4, passTotalTiers: 10, passXp: 1200, passXpToNext: 2000, isPassUnlocked: false,
  rewards: [
    { tier: 1, label: 'Festival frame', icon: 'sparkles', track: 'free', unlocked: true, claimed: true, isCash: false },
    { tier: 2, label: '50 coins', icon: 'coins', track: 'free', unlocked: true, claimed: true, isCash: false },
    { tier: 3, label: 'Glow badge', icon: 'badge-check', track: 'premium', unlocked: true, claimed: false, isCash: false },
    { tier: 4, label: 'Profile boost', icon: 'zap', track: 'free', unlocked: true, claimed: false, isCash: false },
    { tier: 5, label: 'Crown emote', icon: 'crown', track: 'premium', unlocked: false, claimed: false, isCash: false },
    { tier: 6, label: '150 coins', icon: 'coins', track: 'free', unlocked: false, claimed: false, isCash: false },
  ],
};

export async function getSeason(): Promise<Season> {
  if (USE_MOCK) {
    await delay(240);
    return JSON.parse(JSON.stringify(MOCK_SEASON));
  }
  const res = await api.get(`${CONNECT_API_BASE}/gamification/season`);
  return unwrap<Season>(res);
}

// Unlock the premium reward track. This is the POST-PAYMENT fulfilment only — the
// wallet charge (a money surface, with its Idempotency-Key) is handled by the
// shared checkout layer. Here we merely flip the non-cash unlock flag; the pass
// still grants cosmetics/coins, never cash.
export async function unlockSeasonPass(seasonId: string): Promise<Season> {
  if (USE_MOCK) {
    await delay(320);
    MOCK_SEASON.isPassUnlocked = true;
    MOCK_SEASON.rewards = MOCK_SEASON.rewards.map((r) => (r.track === 'premium' && r.tier <= MOCK_SEASON.passTier ? { ...r, unlocked: true } : r));
    return JSON.parse(JSON.stringify(MOCK_SEASON));
  }
  const res = await api.post(`${CONNECT_API_BASE}/gamification/season/${seasonId}/unlock`, {});
  return unwrap<Season>(res);
}

const MOCK_REWARDS: CatalogReward[] = [
  { id: 'rw_1', name: 'Neon name tag', description: 'A glowing chat name in live streams', icon: 'sparkles', category: 'cosmetic', costCoins: 300, owned: false },
  { id: 'rw_2', name: 'Discovery boost', description: '30 min of higher visibility', icon: 'zap', category: 'boost', costCoins: 500, owned: false },
  { id: 'rw_3', name: 'Supporter badge', description: 'Show it on your profile', icon: 'badge-check', category: 'badge', costCoins: 200, owned: true },
  { id: 'rw_4', name: 'Contest free-vote pack', description: '5 free votes for any free poll', icon: 'vote', category: 'entry', costCoins: 150, owned: false },
  { id: 'rw_5', name: 'Crown avatar frame', description: 'Premium animated frame', icon: 'crown', category: 'cosmetic', costCoins: 800, owned: false },
];

export async function listRewards(): Promise<CatalogReward[]> {
  if (USE_MOCK) {
    await delay(200);
    return MOCK_REWARDS.map((r) => ({ ...r }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/gamification/rewards`);
  return unwrap<CatalogReward[]>(res);
}

export async function redeemReward(rewardId: string): Promise<RedeemResult> {
  if (USE_MOCK) {
    await delay(360);
    const r = MOCK_REWARDS.find((x) => x.id === rewardId);
    return { ok: true, rewardId, newCoinBalance: Math.max(0, MOCK_PROFILE.coins - (r?.costCoins ?? 0)) };
  }
  const res = await api.post(`${CONNECT_API_BASE}/gamification/rewards/${rewardId}/redeem`, {});
  return unwrap<RedeemResult>(res);
}

const MOCK_BADGES: Badge[] = [
  { id: 'bd_1', name: 'First Steps', description: 'Completed onboarding', icon: 'sparkles', earned: true, earnedAtIso: new Date(Date.now() - 30 * 86_400_000).toISOString(), rarity: 'common' },
  { id: 'bd_2', name: 'Generous Soul', description: 'Sent 10 gifts', icon: 'gift', earned: true, earnedAtIso: new Date(Date.now() - 12 * 86_400_000).toISOString(), rarity: 'rare' },
  { id: 'bd_3', name: 'Streak Master', description: 'Hit a 30-day streak', icon: 'flame', earned: false, rarity: 'epic' },
  { id: 'bd_4', name: 'Voice of the People', description: 'Voted in 50 contests', icon: 'vote', earned: false, rarity: 'rare' },
  { id: 'bd_5', name: 'Legend', description: 'Reached level 50', icon: 'crown', earned: false, rarity: 'legendary' },
  { id: 'bd_6', name: 'Top Fan', description: 'Top 3 gifter in a stream', icon: 'trophy', earned: true, earnedAtIso: new Date(Date.now() - 3 * 86_400_000).toISOString(), rarity: 'epic' },
];

export async function listBadges(): Promise<Badge[]> {
  if (USE_MOCK) {
    await delay(200);
    return MOCK_BADGES.map((b) => ({ ...b }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/gamification/badges`);
  return unwrap<Badge[]>(res);
}

const MOCK_XP_HISTORY: XpHistoryEntry[] = [
  { id: 'xh_1', source: 'Daily check-in', xp: 50, coins: 30, atIso: new Date(Date.now() - 3_600_000).toISOString() },
  { id: 'xh_2', source: 'Watched a live stream', xp: 80, coins: 15, atIso: new Date(Date.now() - 5 * 3_600_000).toISOString() },
  { id: 'xh_3', source: 'Cast a vote', xp: 40, coins: 5, atIso: new Date(Date.now() - 8 * 3_600_000).toISOString() },
  { id: 'xh_4', source: 'Redeemed: Supporter badge', xp: 0, coins: -200, atIso: new Date(Date.now() - 86_400_000).toISOString() },
  { id: 'xh_5', source: 'Mission: Generous Soul', xp: 200, coins: 50, atIso: new Date(Date.now() - 2 * 86_400_000).toISOString() },
];

export async function getXpHistory(): Promise<XpHistoryEntry[]> {
  if (USE_MOCK) {
    await delay(200);
    return MOCK_XP_HISTORY.map((h) => ({ ...h }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/gamification/xp-history`);
  return unwrap<XpHistoryEntry[]>(res);
}
