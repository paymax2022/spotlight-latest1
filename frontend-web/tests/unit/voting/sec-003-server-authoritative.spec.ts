/**
 * SEC-003: server is authoritative on vote counts / payment amounts — a
 * tampered client payload is rejected or ignored, never trusted.
 *
 * Route under test: POST /api/votes/paid/wallet (frontend-web/app/api/votes/
 * paid/wallet/route.ts — NOT in the protect-legacy.sh list, so this is the
 * real handler, not a model).
 *
 * The route's request body type (`WalletVoteBody`) has NO amount / vote-count
 * / price field at all — it only accepts `packageId`, and looks up
 * votes/bonusVotes/amount server-side from `vote_packages` by that id
 * (route.ts:63-81, comment: "never trust client-supplied price"). These
 * tests confirm that contract: extra client-supplied fields that *look* like
 * an amount or vote-count override are silently ignored, and the amount
 * actually debited/credited always comes from the server-side package row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } }),
  },
}));

vi.mock('@/src/lib/feature-flags', () => ({ featureFlags: { wallet: () => true } }));
vi.mock('@/src/lib/auth/request', () => ({ requireRequestUser: vi.fn() }));
vi.mock('@/src/server/wallet/service', () => ({ debitWallet: vi.fn(), reverseWalletDebit: vi.fn() }));
vi.mock('@/src/server/voting/free-vote.service', () => ({
  getVotingSettings: vi.fn(),
  assertVotingOpen: vi.fn(),
}));
vi.mock('@/src/server/voting/totals.service', () => ({ incrementVoteTotals: vi.fn() }));
vi.mock('@/src/server/voting/audit.service', () => ({ appendAuditLog: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { POST } from '../../../app/api/votes/paid/wallet/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { debitWallet } from '@/src/server/wallet/service';
import { getVotingSettings, assertVotingOpen } from '@/src/server/voting/free-vote.service';
import { createAdminClient } from '@/lib/supabase/server';

const REAL_PACKAGE = { id: 'pkg-1', votes: 100, bonus_votes: 10, amount: 500, currency: 'NGN' }; // 500 NGN = 50,000 kobo

function makeReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/votes/paid/wallet', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'idem-1' },
    body: JSON.stringify(body),
  });
}

describe('SEC-003: /api/votes/paid/wallet trusts only the server-side package row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'user-1' } as any);
    vi.mocked(getVotingSettings).mockResolvedValue({ paidVotingEnabled: true } as any);
    vi.mocked(assertVotingOpen).mockReturnValue(undefined as any);
    vi.mocked(debitWallet).mockResolvedValue({ alreadyProcessed: false } as any);

    const { mock, maybySingle, insertFn } = makeSupabaseMock();
    maybySingle.mockResolvedValue({ data: REAL_PACKAGE, error: null });
    insertFn.mockImplementation(() => ({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'tx-1' }, error: null }) }),
    }));
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
  });

  it('ignores a client-supplied amount override and debits the SERVER package price (50,000 kobo)', async () => {
    const res = await POST(makeReq({
      contestId: 'contest-1',
      contestantId: 'contestant-1',
      packageId: 'pkg-1',
      voterEmail: 'a@b.com',
      voterName: 'A',
      // Tamper attempt: none of these fields exist on WalletVoteBody — a
      // client trying to pay ₦1 for 100,000 votes should have no effect.
      amount: 1,
      amountKobo: 100,
      price: 0,
      votes: 100000,
      voteQuantity: 100000,
    }));

    expect(res.status).toBe(201);
    expect(vi.mocked(debitWallet)).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ amountKobo: 50_000 }),
    );
    const body = await res.json();
    // Votes credited come from the package (100 + 10 bonus), not the tampered "votes: 100000".
    expect(body.votesCredited).toBe(110);
    expect(body.amountKobo).toBe(50_000);
  });

  it('rejects a packageId that does not resolve to an active package for this contest (404, no debit)', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValue({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await POST(makeReq({
      contestId: 'contest-1',
      contestantId: 'contestant-1',
      packageId: 'does-not-exist',
      voterEmail: 'a@b.com',
      voterName: 'A',
    }));

    expect(res.status).toBe(404);
    expect(vi.mocked(debitWallet)).not.toHaveBeenCalled();
  });
});
