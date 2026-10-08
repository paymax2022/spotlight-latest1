/**
 * Malformed-UUID gate regression (wave-6 votes lane): path/query ids that hit
 * Postgres uuid columns via .eq() must be rejected with 400 BEFORE any query —
 * otherwise a malformed id surfaces as a Postgres 22P02 that lands as a 500
 * (or a misleading []/403 via a swallowed error) for authorized callers.
 *
 * Routes pinned:
 *   GET  /api/v1/elections/[id]                      (detail)
 *   GET  /api/v1/elections/[id]/eligibility          (predicate)
 *   POST /api/v1/elections/[id]/vote                 (id + candidateId)
 *   GET  /api/v1/elections/[id]/candidates/[candidateId]/media
 *   GET  /api/v1/contests/[id]/leaderboard           (was [] via swallowed err)
 *   GET  /api/v1/contestants/[id]                    (was 500)
 *   GET  /api/contestant/votes/summary               (contestId query param)
 *   GET  /api/contestant/votes/timeline              (contestId query param)
 *   POST /api/votes/paid/wallet                      (was 500 via getVotingSettings)
 *   getRegistrationDraft (store guard → null, covers the brownfield-protected
 *   /api/registration/applications/[id]/* routes that cannot carry gates)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

vi.mock('@/src/lib/auth/request', () => ({ requireRequestUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/elections/elections.service', () => ({
  getResidentContext: vi.fn(),
  mapElection: vi.fn(),
  isWithinWindow: vi.fn(),
  MAIN_POSITION_SUFFIX: ':main',
}));
vi.mock('@/src/server/voting-bridge/leaderboard.service', () => ({ getLeaderboard: vi.fn() }));
vi.mock('@/src/server/voting/visibility.service', () => ({ getEffectiveVisibility: vi.fn() }));
vi.mock('@/src/server/voting/totals.service', () => ({ getVoteTotals: vi.fn(), incrementVoteTotals: vi.fn() }));
vi.mock('@/src/server/voting/share.service', () => ({ getOrCreateShareLink: vi.fn() }));
vi.mock('@/src/server/voting/paid-vote.service', () => ({ initiatePaidVote: vi.fn() }));
vi.mock('@/src/server/voting/free-vote.service', () => ({
  getVotingSettings: vi.fn(),
  assertVotingOpen: vi.fn(),
}));
vi.mock('@/src/server/voting/audit.service', () => ({ appendAuditLog: vi.fn() }));
vi.mock('@/src/server/wallet/service', () => ({ debitWallet: vi.fn(), reverseWalletDebit: vi.fn() }));
vi.mock('@/src/server/wallet/idempotency', () => ({ checkIdempotencyKey: vi.fn() }));
vi.mock('@/src/server/voting-bridge/idempotency', () => ({ boundClaimKey: vi.fn().mockReturnValue('k') }));
vi.mock('@/src/server/voting-bridge/outbox', () => ({ enqueueOutboxEvent: vi.fn() }));
vi.mock('@/src/lib/voting/rate-limit', () => ({ checkRateLimit: vi.fn().mockReturnValue({ allowed: true }) }));
vi.mock('@/src/lib/rate-limit/client-ip', () => ({ getRequestIp: vi.fn().mockReturnValue('1.2.3.4') }));
vi.mock('@/src/lib/feature-flags', () => ({ featureFlags: { wallet: () => true } }));

import { GET as getElection } from '../../../app/api/v1/elections/[id]/route';
import { GET as getEligibility } from '../../../app/api/v1/elections/[id]/eligibility/route';
import { POST as postElectionVote } from '../../../app/api/v1/elections/[id]/vote/route';
import { GET as getCandidateMedia } from '../../../app/api/v1/elections/[id]/candidates/[candidateId]/media/route';
import { GET as getV1Leaderboard } from '../../../app/api/v1/contests/[id]/leaderboard/route';
import { GET as getContestant } from '../../../app/api/v1/contestants/[id]/route';
import { GET as getSummary } from '../../../app/api/contestant/votes/summary/route';
import { GET as getTimeline } from '../../../app/api/contestant/votes/timeline/route';
import { POST as walletVote } from '../../../app/api/votes/paid/wallet/route';
import { getRegistrationDraft } from '@/src/server/registration/supabase-store';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getResidentContext } from '@/src/server/elections/elections.service';
import { getVotingSettings } from '@/src/server/voting/free-vote.service';
import { createAdminClient } from '@/lib/supabase/server';

const RESIDENT_CTX = { estateId: 'estate-1', role: 'resident' };
const VALID_ELECTION = '11111111-1111-4111-8111-111111111111';

function req(url: string, init?: RequestInit) {
  return new Request(url, {
    ...init,
    headers: { authorization: 'Bearer test-token', ...(init?.headers ?? {}) },
  });
}

function params<T extends Record<string, string>>(p: T) {
  return { params: Promise.resolve(p) };
}

describe('malformed-UUID gates — elections + contests votes surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'user-1', email: 'a@b.c' } as any);
    // A resident context so the routes get PAST the residency gate — proving
    // the UUID check fires before any uuid-column query for authorized users.
    vi.mocked(getResidentContext).mockResolvedValue(RESIDENT_CTX as any);
    const { mock } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
  });

  it('GET /api/v1/elections/[id] → 400 on non-UUID id (before DB)', async () => {
    const res = await getElection(req('http://x/api/v1/elections/nope'), params({ id: 'nope' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid election ID');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('GET /api/v1/elections/[id]/eligibility → 400 on non-UUID id', async () => {
    const res = await getEligibility(req('http://x/api/v1/elections/nope/eligibility'), params({ id: 'nope' }));
    expect(res.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('POST /api/v1/elections/[id]/vote → 400 on non-UUID election id', async () => {
    const res = await postElectionVote(
      req('http://x/api/v1/elections/nope/vote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateId: VALID_ELECTION }),
      }),
      params({ id: 'nope' }),
    );
    expect(res.status).toBe(400);
  });

  it('POST /api/v1/elections/[id]/vote → 400 on non-UUID candidateId', async () => {
    const res = await postElectionVote(
      req(`http://x/api/v1/elections/${VALID_ELECTION}/vote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateId: 'not-a-uuid' }),
      }),
      params({ id: VALID_ELECTION }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid candidate ID');
  });

  it('GET /api/v1/elections/[id]/candidates/[candidateId]/media → 400 on non-UUID election id', async () => {
    const res = await getCandidateMedia(
      req('http://x/api/v1/elections/nope/candidates/c1/media'),
      params({ id: 'nope', candidateId: 'c1' }),
    );
    expect(res.status).toBe(400);
  });

  it('GET /api/v1/contests/[id]/leaderboard → 400 on non-UUID id (was 200 [] via swallowed error)', async () => {
    const res = await getV1Leaderboard(
      req('http://x/api/v1/contests/nope/leaderboard'),
      params({ id: 'nope' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid contest ID');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('GET /api/contestant/votes/summary → 400 on non-UUID contestId', async () => {
    const res = await getSummary(req('http://x/api/contestant/votes/summary?contestId=zzz'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid contest ID');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('GET /api/contestant/votes/timeline → 400 on non-UUID contestId', async () => {
    const res = await getTimeline(req('http://x/api/contestant/votes/timeline?contestId=zzz'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid contest ID');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('GET /api/v1/contestants/[id] → 400 on non-UUID id (was 500)', async () => {
    const res = await getContestant(
      req('http://x/api/v1/contestants/zzz'),
      params({ id: 'zzz' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid contestant ID');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('POST /api/votes/paid/wallet → 400 on non-UUID ids (was 500 via getVotingSettings)', async () => {
    const res = await walletVote(
      req('http://x/api/votes/paid/wallet', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
        body: JSON.stringify({
          contestId: 'zzz', contestantId: 'zzz', packageId: 'zzz',
          voterEmail: 'a@b.c', voterName: 'X',
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('contestId must be a valid UUID');
    expect(getVotingSettings).not.toHaveBeenCalled();
  });

  it('getRegistrationDraft → null for non-UUID id without hitting Postgres (all [id] routes get 404, not 500)', async () => {
    // The registrations.id uuid guard lives in the shared store because
    // several [id] route files are brownfield-protected and cannot carry
    // their own gates.
    await expect(getRegistrationDraft('zzz')).resolves.toBeNull();
    await expect(getRegistrationDraft('not a uuid at all')).resolves.toBeNull();
  });
});
