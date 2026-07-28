// Paymax Connect — VOTING api (mock-first via USE_MOCK).
// Paid votes move REAL money (kobo) and MUST carry an Idempotency-Key.

import { api } from '@/api/client';
import { USE_MOCK, CONNECT_API_BASE } from '../constants/connect.constants';
import type {
  Contest,
  ContestDetail,
  ContestStatus,
  VoteResult,
  VoteHistoryEntry,
  VoteLeaderboardEntry,
} from './types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));
function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

// Idempotency-Key for paid-vote money mutations (money-handling iron rule).
export function makeIdempotencyKey(scope: string): string {
  return `connect-${scope}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
const AV = (s: string) => `https://i.pravatar.cc/160?u=${s}`;
const COVER = (s: string) => `https://picsum.photos/seed/${s}/600/360`;

const MOCK_CONTESTS: Contest[] = [
  {
    id: 'c_1', title: 'Voice of Naija 2026', subtitle: 'Talent singing contest',
    coverUrl: COVER('voice'), status: 'active', mode: 'paid', pricePerVoteKobo: 10_000,
    totalVotes: 48210, endsAtIso: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    contestantCount: 8, hasPrizeForVoters: false,
  },
  {
    id: 'c_2', title: 'Best campus DJ', subtitle: 'Free community poll',
    coverUrl: COVER('dj'), status: 'active', mode: 'free', pricePerVoteKobo: 0,
    totalVotes: 12750, endsAtIso: new Date(Date.now() + 86_400_000).toISOString(),
    contestantCount: 5, hasPrizeForVoters: false,
  },
  {
    id: 'c_3', title: 'Dance crew finals', subtitle: 'Paid fan voting',
    coverUrl: COVER('dance'), status: 'upcoming', mode: 'paid', pricePerVoteKobo: 5_000,
    totalVotes: 0, endsAtIso: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    contestantCount: 6, hasPrizeForVoters: false,
  },
  {
    id: 'c_4', title: 'Comedian of the month', subtitle: 'Results in',
    coverUrl: COVER('comedy'), status: 'ended', mode: 'paid', pricePerVoteKobo: 10_000,
    totalVotes: 90400, endsAtIso: new Date(Date.now() - 86_400_000).toISOString(),
    contestantCount: 10, hasPrizeForVoters: false,
  },
];

function makeContestants(seed: string, n: number) {
  const names = ['Tomi', 'Ada', 'Femi', 'Bisi', 'Kola', 'Naomi', 'Zee', 'Chuka', 'Bola', 'Ife'];
  const base = Array.from({ length: n }, (_, i) => ({
    id: `${seed}_ct_${i}`,
    name: names[i % names.length],
    avatar: AV(`${seed}${i}`),
    tagline: 'Contestant',
    votes: Math.round(12000 / (i + 1)) + (i === 0 ? 800 : 0),
  }));
  const total = base.reduce((s, c) => s + c.votes, 0) || 1;
  return base
    .map((c) => ({ ...c, sharePct: Math.round((c.votes / total) * 1000) / 10 }))
    .sort((a, b) => b.votes - a.votes)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

export async function listContests(status?: ContestStatus): Promise<Contest[]> {
  if (USE_MOCK) {
    await delay();
    return status ? MOCK_CONTESTS.filter((c) => c.status === status) : MOCK_CONTESTS.map((c) => ({ ...c }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/voting/contests`, { params: { status } });
  return unwrap<Contest[]>(res);
}

export async function getContest(id: string): Promise<ContestDetail> {
  if (USE_MOCK) {
    await delay(220);
    const base = MOCK_CONTESTS.find((c) => c.id === id) ?? MOCK_CONTESTS[0];
    return {
      ...base,
      rules: [
        'One account, one identity. Multiple-account voting is detected and removed.',
        base.mode === 'paid'
          ? 'Paid votes are real wallet transfers and are final once confirmed.'
          : 'This is a free poll — no money is involved.',
        'Results are tallied transparently and audited for integrity.',
        'No prize or payout is given to voters. Prizes (if any) go to contestants only.',
      ],
      prizeInfo: base.mode === 'paid' ? 'Winner (a contestant) receives the announced prize. Voters receive nothing of monetary value.' : undefined,
      contestants: makeContestants(base.id, base.contestantCount || 5),
    };
  }
  const res = await api.get(`${CONNECT_API_BASE}/voting/contests/${id}`);
  return unwrap<ContestDetail>(res);
}

// Free vote — never moves money.
export async function castFreeVote(args: { contestId: string; contestantId: string }): Promise<VoteResult> {
  if (USE_MOCK) {
    await delay(300);
    return { ok: true, contestantId: args.contestantId, votesCast: 1, amountKobo: 0, newRemainingKobo: null };
  }
  const res = await api.post(`${CONNECT_API_BASE}/voting/contests/${args.contestId}/free-vote`, { contestantId: args.contestantId });
  return unwrap<VoteResult>(res);
}

// Paid vote — REAL money. MUST carry an Idempotency-Key (money-handling rule).
export async function castPaidVote(args: {
  contestId: string;
  contestantId: string;
  votes: number;
  amountKobo: number;
  idempotencyKey: string;
}): Promise<VoteResult> {
  if (USE_MOCK) {
    await delay(460);
    return {
      ok: true,
      contestantId: args.contestantId,
      votesCast: args.votes,
      amountKobo: args.amountKobo,
      newRemainingKobo: Math.max(0, 1_850_000 - args.amountKobo),
      ledgerRef: `lgr_${Date.now()}`,
    };
  }
  const res = await api.post(
    `${CONNECT_API_BASE}/voting/contests/${args.contestId}/paid-vote`,
    { contestantId: args.contestantId, votes: args.votes, amountKobo: args.amountKobo },
    { headers: { 'Idempotency-Key': args.idempotencyKey } },
  );
  return unwrap<VoteResult>(res);
}

export async function getContestLeaderboard(contestId: string): Promise<VoteLeaderboardEntry[]> {
  if (USE_MOCK) {
    await delay(220);
    const cs = makeContestants(contestId, 6);
    return cs.map((c) => ({ rank: c.rank, contestantId: c.id, name: c.name, avatar: c.avatar, votes: c.votes, sharePct: c.sharePct }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/voting/contests/${contestId}/leaderboard`);
  return unwrap<VoteLeaderboardEntry[]>(res);
}

const MOCK_HISTORY: VoteHistoryEntry[] = [
  { id: 'vh_1', contestTitle: 'Voice of Naija 2026', contestantName: 'Tomi', mode: 'paid', votes: 5, amountKobo: 50_000, castAtIso: new Date(Date.now() - 3 * 3_600_000).toISOString() },
  { id: 'vh_2', contestTitle: 'Best campus DJ', contestantName: 'Zee', mode: 'free', votes: 1, amountKobo: 0, castAtIso: new Date(Date.now() - 86_400_000).toISOString() },
  { id: 'vh_3', contestTitle: 'Comedian of the month', contestantName: 'Bola', mode: 'paid', votes: 10, amountKobo: 100_000, castAtIso: new Date(Date.now() - 5 * 86_400_000).toISOString() },
];

export async function getVoteHistory(): Promise<VoteHistoryEntry[]> {
  if (USE_MOCK) {
    await delay(200);
    return MOCK_HISTORY.map((h) => ({ ...h }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/voting/my-votes`);
  return unwrap<VoteHistoryEntry[]>(res);
}
