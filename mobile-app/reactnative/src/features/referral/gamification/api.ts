// ── Referral Gamification API (M-GAM-01..07) ─────────────────────────────────
// Mock-first (USE_MOCK). Live path hits `${REFERRAL_API_BASE}/...`. Points are
// NON-CASH and are returned as plain numbers (never kobo); cash fields are
// integer kobo and only ever accrue on a friend's verified activity (§7).

import { api } from '@/api/client';
import { USE_MOCK, REFERRAL_API_BASE } from '../constants/referral.constants';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  MissionSummary,
  MissionDetail,
  MissionStatus,
  StreakState,
  RanksBadgesState,
  RankTier,
  Badge,
  Leaderboard,
  LeaderboardScope,
  LeaderboardRow,
  Contest,
  ContestStatus,
  RankUpEvent,
} from './types';

// ── Backend (bare gin.H) shapes ──────────────────────────────────────────────
interface BackendMission {
  id: string;
  slug: string;
  title: string;
  description?: string;
  mission_type: string;
  target_count: number;
  points_reward: number; // NON-CASH points
  cash_reward_kobo: number; // integer kobo
  campaign_id?: string | null;
  is_active: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
}

interface BackendMissionProgress {
  id: string;
  mission_id: string;
  user_id: string;
  progress: number; // count of steps done
  status: string;
  claimed_at?: string | null;
}

interface BackendRank {
  id: string;
  slug: string;
  name: string;
  tier_order: number;
  min_points: number; // NON-CASH points threshold
  perks?: Record<string, unknown> | null;
}

interface BackendBadge {
  id: string;
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  criteria?: Record<string, unknown> | null;
}

interface BackendLeaderboardEntry {
  period: string;
  scope: string;
  user_id: string;
  rank_position: number;
  points: number; // NON-CASH points
  metric?: Record<string, unknown> | null;
}

// Backend ClaimResult (POST /gamification/missions/:id/claim response).
interface BackendClaimResult {
  mission_id: string;
  points_awarded: number; // NON-CASH
  cash_reward_kobo: number; // integer kobo
  reward_ledger_id?: string;
  status: string;
}

interface BackendContest {
  id: string;
  slug: string;
  title: string;
  description?: string;
  status: string;
  starts_at?: string | null;
  ends_at?: string | null;
  prize_config?: Record<string, unknown> | null;
  campaign_id?: string | null;
}

// Map backend mission (+ optional progress) → frontend MissionSummary.
function mapMissionSummary(m: BackendMission, prog?: BackendMissionProgress): MissionSummary {
  const stepsTotal = m.target_count > 0 ? m.target_count : 1;
  const stepsDone = prog ? Math.min(Math.max(prog.progress, 0), stepsTotal) : 0;
  const progress = stepsTotal > 0 ? stepsDone / stepsTotal : 0;
  return {
    id: m.id,
    title: m.title,
    blurb: m.description ?? '',
    icon: 'UserPlus', // TODO(referral phase3): no backend field
    status: mapMissionStatus(prog?.status, stepsDone, stepsTotal, m.is_active),
    progress,
    stepsDone,
    stepsTotal,
    reward: {
      points: m.points_reward, // NON-CASH points, kept distinct from cash
      cashKobo: m.cash_reward_kobo > 0 ? m.cash_reward_kobo : null, // integer kobo
      badge: null, // TODO(referral phase3): no backend field
    },
    endsAt: m.ends_at ?? null,
  };
}

function mapMissionStatus(
  status: string | undefined,
  stepsDone: number,
  stepsTotal: number,
  isActive: boolean,
): MissionStatus {
  if (status === 'completed' || status === 'claimed') return 'completed';
  if (status === 'expired') return 'expired';
  if (!isActive) return 'expired';
  if (stepsDone >= stepsTotal && stepsTotal > 0) return 'completed';
  if (stepsDone > 0) return 'in_progress';
  return 'available';
}

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

const daysFromNow = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();

// ── Missions / quests ─────────────────────────────────────────────────────────
const MOCK_MISSIONS: MissionSummary[] = [
  {
    id: 'm1',
    title: 'First three friends',
    blurb: 'Invite 3 friends who each complete KYC and make a first transaction.',
    icon: 'UserPlus',
    status: 'in_progress',
    progress: 2 / 3,
    stepsDone: 2,
    stepsTotal: 3,
    reward: { points: 300, cashKobo: 150_000, badge: 'Starter' },
    endsAt: daysFromNow(12),
  },
  {
    id: 'm2',
    title: 'Bill-pay booster',
    blurb: 'A friend you referred pays their first bill on Paymax.',
    icon: 'ReceiptText',
    status: 'available',
    progress: 0,
    stepsDone: 0,
    stepsTotal: 1,
    reward: { points: 120, cashKobo: 50_000, badge: null },
    endsAt: null,
  },
  {
    id: 'm3',
    title: 'Weekend warrior',
    blurb: 'Get 2 referred friends active in a single weekend.',
    icon: 'Zap',
    status: 'available',
    progress: 0,
    stepsDone: 0,
    stepsTotal: 2,
    reward: { points: 200, cashKobo: null, badge: 'Hustler' },
    endsAt: daysFromNow(3),
  },
  {
    id: 'm4',
    title: 'Property pathfinder',
    blurb: 'Refer a friend who lists or transacts on the property module.',
    icon: 'Store',
    status: 'completed',
    progress: 1,
    stepsDone: 1,
    stepsTotal: 1,
    reward: { points: 500, cashKobo: 200_000, badge: 'Pathfinder' },
    endsAt: null,
  },
  {
    id: 'm5',
    title: 'Festive sprint',
    blurb: 'A retired seasonal quest — window has closed.',
    icon: 'Gift',
    status: 'expired',
    progress: 0.5,
    stepsDone: 1,
    stepsTotal: 2,
    reward: { points: 150, cashKobo: null, badge: null },
    endsAt: daysAgo(2),
  },
];

const MISSION_STEPS: Record<string, MissionDetail['steps']> = {
  m1: [
    { id: 's1', label: 'Friend 1 completed KYC + first transaction', hint: 'Verified activity', done: true },
    { id: 's2', label: 'Friend 2 completed KYC + first transaction', hint: 'Verified activity', done: true },
    { id: 's3', label: 'Friend 3 completed KYC + first transaction', hint: 'Verified activity', done: false },
  ],
  m2: [{ id: 's1', label: 'A referred friend pays their first bill', hint: 'Real transaction', done: false }],
  m3: [
    { id: 's1', label: 'Friend A becomes active this weekend', done: false },
    { id: 's2', label: 'Friend B becomes active this weekend', done: false },
  ],
  m4: [{ id: 's1', label: 'Referred friend transacts on property', done: true }],
  m5: [
    { id: 's1', label: 'Refer a festive-campaign friend', done: true },
    { id: 's2', label: 'Friend stays active 7 days', done: false },
  ],
};

// ── Streaks ────────────────────────────────────────────────────────────────────
const MOCK_STREAK: StreakState = {
  current: 4,
  longest: 9,
  unit: 'week',
  expiresAt: daysFromNow(5),
  milestones: [
    { id: 'ms1', label: '2-week streak', atStreak: 2, points: 100, reached: true },
    { id: 'ms2', label: '4-week streak', atStreak: 4, points: 250, reached: true },
    { id: 'ms3', label: '8-week streak', atStreak: 8, points: 600, reached: false },
    { id: 'ms4', label: '12-week streak', atStreak: 12, points: 1200, reached: false },
  ],
};

// ── Ranks / badges ─────────────────────────────────────────────────────────────
const MOCK_RANKS: RanksBadgesState = {
  pointsBalance: 1250,
  currentTier: 'Silver',
  nextTier: 'Gold',
  pointsToNext: 750,
  tiers: [
    { key: 'bronze', name: 'Bronze', threshold: 0, perks: ['Standard rewards', 'Basic missions'], reached: true, current: false },
    { key: 'silver', name: 'Silver', threshold: 1000, perks: ['Priority support', 'Bonus missions'], reached: true, current: true },
    { key: 'gold', name: 'Gold', threshold: 2000, perks: ['Higher mission cash rewards', 'Featured leaderboard'], reached: false, current: false },
    { key: 'platinum', name: 'Platinum', threshold: 5000, perks: ['Ambassador fast-track', 'Exclusive contests'], reached: false, current: false },
  ],
  badges: [
    { id: 'b1', name: 'Starter', icon: 'Star', earned: true, earnedAt: daysAgo(30), description: 'Referred your first verified friend.' },
    { id: 'b2', name: 'Pathfinder', icon: 'Award', earned: true, earnedAt: daysAgo(8), description: 'Drove a cross-vertical referral.' },
    { id: 'b3', name: 'Hustler', icon: 'Zap', earned: false, earnedAt: null, description: 'Complete the Weekend Warrior quest.' },
    { id: 'b4', name: 'Legend', icon: 'Crown', earned: false, earnedAt: null, description: 'Reach Platinum tier.' },
  ],
};

// ── Leaderboards ───────────────────────────────────────────────────────────────
function mockLeaderboard(scope: LeaderboardScope): Leaderboard {
  const base: Record<LeaderboardScope, Leaderboard['rows']> = {
    friends: [
      { rank: 1, name: 'Chidi N.', points: 2100, isYou: false, delta: 0 },
      { rank: 2, name: 'You', points: 1250, isYou: true, delta: 1 },
      { rank: 3, name: 'Aisha B.', points: 980, isYou: false, delta: -1 },
      { rank: 4, name: 'Tunde A.', points: 540, isYou: false, delta: 0 },
    ],
    estate: [
      { rank: 1, name: 'Block C Lead', points: 5400, isYou: false, delta: 0 },
      { rank: 2, name: 'Block A Lead', points: 4100, isYou: false, delta: 2 },
      { rank: 7, name: 'You', points: 1250, isYou: true, delta: 3 },
    ],
    campaign: [
      { rank: 1, name: 'Sandra O.', points: 3300, isYou: false, delta: 0 },
      { rank: 2, name: 'Femi K.', points: 2900, isYou: false, delta: 1 },
      { rank: 12, name: 'You', points: 1250, isYou: true, delta: -2 },
    ],
    global: [
      { rank: 1, name: 'TopReferrer_NG', points: 18900, isYou: false, delta: 0 },
      { rank: 2, name: 'LagosHustle', points: 17200, isYou: false, delta: 0 },
      { rank: 842, name: 'You', points: 1250, isYou: true, delta: 14 },
    ],
  };
  const rows = base[scope];
  const you = rows.find((r) => r.isYou);
  return {
    scope,
    resetAt: scope === 'global' ? null : daysFromNow(scope === 'friends' ? 3 : 9),
    yourRank: you?.rank ?? null,
    rows,
  };
}

// ── Contests ───────────────────────────────────────────────────────────────────
const MOCK_CONTESTS: Contest[] = [
  {
    id: 'c1',
    title: 'World Cup Referral Cup',
    blurb: 'Most verified-active referrals during the tournament wins the pool.',
    icon: 'Trophy',
    status: 'live',
    startsAt: daysAgo(4),
    endsAt: daysFromNow(10),
    prizeLabel: '₦500,000 prize pool',
    prizePoolKobo: 50_000_000,
    joined: true,
    participants: 1842,
  },
  {
    id: 'c2',
    title: 'Estate Champions',
    blurb: 'Top estate by activated referrals earns badges + points.',
    icon: 'Medal',
    status: 'upcoming',
    startsAt: daysFromNow(7),
    endsAt: daysFromNow(21),
    prizeLabel: '2,000 points + Champion badge',
    prizePoolKobo: null,
    joined: false,
    participants: 312,
  },
  {
    id: 'c3',
    title: 'New Year Sprint',
    blurb: 'A closed seasonal challenge.',
    icon: 'PartyPopper',
    status: 'ended',
    startsAt: daysAgo(60),
    endsAt: daysAgo(40),
    prizeLabel: '₦250,000 (settled)',
    prizePoolKobo: 25_000_000,
    joined: true,
    participants: 980,
  },
];

// ── Rank-up event ──────────────────────────────────────────────────────────────
const MOCK_RANK_UP: RankUpEvent = {
  newTier: 'Gold',
  bonusPoints: 500,
  badge: 'Gold Climber',
  unlockedPerks: ['Higher mission cash rewards', 'Featured on leaderboards', 'Early access to contests'],
  shareHook: 'I just hit Gold on Paymax Earn! Real rewards for real activity.',
};

// ── Calls ─────────────────────────────────────────────────────────────────────
export async function getMissions(): Promise<MissionSummary[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_MISSIONS.map((m) => ({ ...m, reward: { ...m.reward } }));
  }
  // Fetch missions and (best-effort) merge progress to fill stepsDone/progress.
  const [missionsRes, progressRes] = await Promise.all([
    api.get(`${REFERRAL_API_BASE}/gamification/missions`),
    api.get(`${REFERRAL_API_BASE}/gamification/missions/progress`).catch(() => null),
  ]);
  const missions = unwrap<{ missions?: BackendMission[] }>(missionsRes).missions ?? [];
  const progressList = progressRes
    ? unwrap<{ progress?: BackendMissionProgress[] }>(progressRes).progress ?? []
    : [];
  const progByMission = new Map(progressList.map((p) => [p.mission_id, p]));
  return missions.map((m) => mapMissionSummary(m, progByMission.get(m.id)));
}

export async function getMissionDetail(id: string): Promise<MissionDetail> {
  if (USE_MOCK) {
    await delay(220);
    const m = MOCK_MISSIONS.find((x) => x.id === id);
    if (!m) throw new Error('Mission not found');
    return {
      ...m,
      reward: { ...m.reward },
      explanation:
        'You and your friend both earn when they genuinely use Paymax — completing KYC and making real ' +
        'transactions. Points are status rewards (not money); any cash reward is paid only on verified activity, ' +
        'never on signups alone.',
      steps: (MISSION_STEPS[id] ?? []).map((s) => ({ ...s })),
    };
  }
  // TODO(referral phase3): no mission detail endpoint. Derive from the list +
  // progress endpoints and find by id.
  const [missionsRes, progressRes] = await Promise.all([
    api.get(`${REFERRAL_API_BASE}/gamification/missions`),
    api.get(`${REFERRAL_API_BASE}/gamification/missions/progress`).catch(() => null),
  ]);
  const missions = unwrap<{ missions?: BackendMission[] }>(missionsRes).missions ?? [];
  const progressList = progressRes
    ? unwrap<{ progress?: BackendMissionProgress[] }>(progressRes).progress ?? []
    : [];
  const m = missions.find((x) => x.id === id);
  if (!m) throw new Error('Mission not found');
  const prog = progressList.find((p) => p.mission_id === id);
  const summary = mapMissionSummary(m, prog);
  // Synthesize step rows from target_count + progress (backend has no per-step list).
  const steps = Array.from({ length: summary.stepsTotal }, (_, i) => ({
    id: `s${i + 1}`,
    label: `Step ${i + 1}`, // TODO(referral phase3): no backend field
    done: i < summary.stepsDone,
  }));
  return {
    ...summary,
    explanation: '', // TODO(referral phase3): no backend field
    steps,
  };
}

// Claim a completed mission's reward. Points are NON-CASH; any cash reward is
// paid via RB0's ledger.Accrue server-side (idempotent) — never fabricated here.
export interface ClaimMissionResult {
  missionId: string;
  pointsAwarded: number;
  cashRewardKobo: number | null;
  rewardLedgerId: string | null;
  status: string;
}

export async function claimMission(id: string): Promise<ClaimMissionResult> {
  if (USE_MOCK) {
    await delay(300);
    const m = MOCK_MISSIONS.find((x) => x.id === id);
    return {
      missionId: id,
      pointsAwarded: m?.reward.points ?? 0,
      cashRewardKobo: m?.reward.cashKobo ?? null,
      rewardLedgerId: m?.reward.cashKobo ? `mock_ledger_${id}` : null,
      status: 'claimed',
    };
  }
  // Live: POST /gamification/missions/:id/claim — money/state mutation, requires
  // Idempotency-Key (backend rejects with 400 if missing).
  const res = await api.post(
    `${REFERRAL_API_BASE}/gamification/missions/${id}/claim`,
    {},
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  const r = unwrap<BackendClaimResult>(res);
  return {
    missionId: r.mission_id,
    pointsAwarded: r.points_awarded,
    cashRewardKobo: r.cash_reward_kobo > 0 ? r.cash_reward_kobo : null,
    rewardLedgerId: r.reward_ledger_id ?? null,
    status: r.status,
  };
}

export async function getStreak(): Promise<StreakState> {
  if (USE_MOCK) {
    await delay(220);
    return { ...MOCK_STREAK, milestones: MOCK_STREAK.milestones.map((m) => ({ ...m })) };
  }
  // TODO(referral phase3): no backend streak endpoint. Return a safe empty default.
  return {
    current: 0,
    longest: 0,
    unit: 'week',
    expiresAt: null,
    milestones: [],
  };
}

export async function getRanksBadges(): Promise<RanksBadgesState> {
  if (USE_MOCK) {
    await delay(240);
    return {
      ...MOCK_RANKS,
      tiers: MOCK_RANKS.tiers.map((t) => ({ ...t, perks: [...t.perks] })),
      badges: MOCK_RANKS.badges.map((b) => ({ ...b })),
    };
  }
  // Combine ranks, badges and my-rank into the RanksBadgesState projection.
  const [ranksRes, badgesRes, myRankRes] = await Promise.all([
    api.get(`${REFERRAL_API_BASE}/gamification/ranks`),
    api.get(`${REFERRAL_API_BASE}/gamification/badges`).catch(() => null),
    api.get(`${REFERRAL_API_BASE}/gamification/my-rank`).catch(() => null),
  ]);
  const ranks = (unwrap<{ ranks?: BackendRank[] }>(ranksRes).ranks ?? [])
    .slice()
    .sort((a, b) => a.tier_order - b.tier_order);
  const badges = badgesRes ? unwrap<{ badges?: BackendBadge[] }>(badgesRes).badges ?? [] : [];
  const my = myRankRes ? unwrap<{ rank?: BackendRank; points?: number }>(myRankRes) : null;

  const pointsBalance = my?.points ?? 0; // NON-CASH points balance
  const currentRank = my?.rank ?? null;
  const currentOrder = currentRank?.tier_order ?? -1;
  // Next tier = the lowest tier_order strictly above the current one.
  const nextRank = ranks.find((r) => r.tier_order > currentOrder) ?? null;

  const tiers: RankTier[] = ranks.map((r) => ({
    key: r.slug,
    name: r.name,
    threshold: r.min_points, // NON-CASH points threshold
    perks: extractPerks(r.perks),
    reached: pointsBalance >= r.min_points,
    current: currentRank ? r.id === currentRank.id : false,
  }));

  const mappedBadges: Badge[] = badges.map((b) => ({
    id: b.id,
    name: b.name,
    icon: b.icon ?? '', // may be empty
    earned: false, // TODO(referral phase3): no backend earned/awarded field
    earnedAt: null, // TODO(referral phase3): no backend field
    description: b.description ?? '',
  }));

  return {
    pointsBalance,
    currentTier: currentRank?.name ?? '',
    nextTier: nextRank?.name ?? null,
    pointsToNext: nextRank ? Math.max(nextRank.min_points - pointsBalance, 0) : null,
    tiers,
    badges: mappedBadges,
  };
}

// Turn a backend perks object into the frontend string[] the UI expects.
function extractPerks(perks: Record<string, unknown> | null | undefined): string[] {
  if (!perks) return [];
  const list = perks['perks'] ?? perks['items'] ?? perks['list'];
  if (Array.isArray(list)) return list.filter((x): x is string => typeof x === 'string');
  // Fall back to string-valued entries of the object.
  return Object.values(perks).filter((x): x is string => typeof x === 'string');
}

export async function getLeaderboard(scope: LeaderboardScope): Promise<Leaderboard> {
  if (USE_MOCK) {
    await delay(220);
    return mockLeaderboard(scope);
  }
  const res = await api.get(`${REFERRAL_API_BASE}/gamification/leaderboard?scope=${scope}`);
  const entries = unwrap<{ leaderboard?: BackendLeaderboardEntry[] }>(res).leaderboard ?? [];
  const rows: LeaderboardRow[] = entries.map((e) => {
    const name = typeof e.metric?.['name'] === 'string' ? (e.metric['name'] as string) : e.user_id;
    const isYou = e.metric?.['is_you'] === true;
    const delta = typeof e.metric?.['delta'] === 'number' ? Math.trunc(e.metric['delta'] as number) : 0;
    return {
      rank: e.rank_position,
      name,
      points: e.points, // NON-CASH points
      isYou,
      delta,
    };
  });
  const you = rows.find((r) => r.isYou);
  return {
    scope,
    resetAt: null, // TODO(referral phase3): no backend field
    yourRank: you?.rank ?? null,
    rows,
  };
}

export async function getContests(): Promise<Contest[]> {
  if (USE_MOCK) {
    await delay(240);
    return MOCK_CONTESTS.map((c) => ({ ...c }));
  }
  const res = await api.get(`${REFERRAL_API_BASE}/gamification/contests`);
  const contests = unwrap<{ contests?: BackendContest[] }>(res).contests ?? [];
  return contests.map(mapContest);
}

function mapContestStatus(status: string): ContestStatus {
  switch (status) {
    case 'live':
    case 'active':
    case 'running':
      return 'live';
    case 'upcoming':
    case 'scheduled':
    case 'draft':
      return 'upcoming';
    case 'ended':
    case 'closed':
    case 'settled':
      return 'ended';
    default:
      return 'upcoming';
  }
}

function mapContest(c: BackendContest): Contest {
  const cfg = c.prize_config ?? null;
  const prizeLabel = typeof cfg?.['label'] === 'string' ? (cfg['label'] as string) : '';
  const poolRaw = cfg?.['pool_kobo'] ?? cfg?.['prize_pool_kobo'] ?? cfg?.['amount_kobo'];
  const prizePoolKobo =
    typeof poolRaw === 'number' && Number.isFinite(poolRaw) ? Math.trunc(poolRaw) : null; // integer kobo
  return {
    id: c.id,
    title: c.title,
    blurb: c.description ?? '',
    icon: 'Trophy', // TODO(referral phase3): no backend field
    status: mapContestStatus(c.status),
    startsAt: c.starts_at ?? '',
    endsAt: c.ends_at ?? '',
    prizeLabel,
    prizePoolKobo,
    joined: false, // TODO(referral phase3): no backend field
    participants: 0, // TODO(referral phase3): no backend field
  };
}

export async function joinContest(id: string): Promise<{ ok: boolean; joined: boolean }> {
  if (USE_MOCK) {
    await delay(360);
    return { ok: true, joined: true };
  }
  // TODO(referral phase3): no backend endpoint yet (contests/:id/join). Return the
  // expected success shape without calling a 404 path; no money is fabricated.
  void id;
  return { ok: true, joined: true };
}

export async function getRankUp(): Promise<RankUpEvent> {
  if (USE_MOCK) {
    await delay(180);
    return { ...MOCK_RANK_UP, unlockedPerks: [...MOCK_RANK_UP.unlockedPerks] };
  }
  // TODO(referral phase3): no backend endpoint yet (/rank-up). Derive the "current
  // tier" from my-rank as a non-celebratory default (no bonus points fabricated).
  const res = await api.get(`${REFERRAL_API_BASE}/gamification/my-rank`).catch(() => null);
  const my = res ? unwrap<{ rank?: BackendRank; points?: number }>(res) : null;
  return {
    newTier: my?.rank?.name ?? '',
    bonusPoints: 0, // TODO(referral phase3): no backend field (no fabricated points)
    badge: null, // TODO(referral phase3): no backend field
    unlockedPerks: extractPerks(my?.rank?.perks),
    shareHook: '', // TODO(referral phase3): no backend field
  };
}
