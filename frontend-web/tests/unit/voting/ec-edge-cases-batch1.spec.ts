/**
 * TS-12 Edge Cases & Chaos — Batch 1
 *
 * Covers, per docs/qa/voting-contest-test-plan.md TS-12 (lines 286-303):
 *   EC-009 — Vote after contest close (late/queued request) is rejected, not counted.
 *   EC-012 — Same person registers in two contests: isolated entries, no bleed.
 *   EC-003 — Paid vote succeeds but count-apply fails: structural proof that this
 *            failure mode is no longer reachable after the PV-005 atomic-credit fix.
 *
 * EC-004 (duplicate webhook replay) and the concurrency-under-flood half of
 * EC-013 are proven with a *live* Postgres run (20/30-way truly-concurrent
 * calls against credit_paid_vote_transaction / claim_free_vote) — a mocked
 * unit test cannot prove real row-locking, exactly per the precedent set by
 * paid-vote-concurrency.spec.ts for PV-005. See the batch report for the
 * recorded DB-executed proof output; there is no committed vitest spec for
 * that live run because the frontend-web package has no Postgres driver
 * (`pg`) dependency — same reason PV-005/VI-002's DB-executed proofs aren't
 * committed specs either.
 *
 * EC-010 (refund after results published) is not re-tested here: the
 * existing tests/unit/voting/vote-reversal-refund.spec.ts already proves
 * refund idempotency (no double-refund) end to end; this batch only adds
 * analysis (see report) since there is no results-lock system to test against
 * (VI-010/AD-011, explicitly out of scope for this batch).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// EC-009 — Vote after contest close is rejected, not counted
// ---------------------------------------------------------------------------
//
// assertVotingOpen() itself (the pure guard function) already has full branch
// coverage in free-vote.spec.ts ("throws if voting has closed" etc). What is
// NOT yet covered anywhere is the *integration* claim in EC-009's Expected
// Result column: "Rejected; not counted" — i.e. that a late paid-vote
// initiation, when voting is closed, (a) throws before creating any
// vote_transactions row and (b) never calls the payment provider. These tests
// close that gap for the paid path (initiatePaidVote); the free path's
// equivalent (castFreeVote) shares the exact same assertVotingOpen() call
// site and pure-function coverage, so the remaining integration risk is
// concentrated in the paid path's extra side effects (Paystack init, DB
// writes), which is what's asserted here.

vi.mock('@/src/server/voting/payment/paystack', () => ({
  initializePaystackPayment: vi.fn().mockResolvedValue('https://checkout.paystack.com/mock'),
}));
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/src/server/voting/totals.service', () => ({
  incrementVoteTotals: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/server/voting/audit.service', () => ({
  appendAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/server/voting/core', () => ({
  resolveIdempotency: vi.fn(async (_key: string, anchor: { lookupCached: (k: string) => Promise<unknown> }) => {
    const cached = await anchor.lookupCached(_key);
    if (cached !== null && cached !== undefined) return { status: 'cached', value: cached };
    return { status: 'fresh' };
  }),
  verifyVotePayment: vi.fn(),
  recordVoteFraudSignals: vi.fn().mockResolvedValue({ signals: [], score: 0 }),
  recordVoteAudit: vi.fn().mockResolvedValue(undefined),
}));

import { createAdminClient } from '@/lib/supabase/server';
import { initiatePaidVote } from '@/src/server/voting/paid-vote.service';
import { initializePaystackPayment } from '@/src/server/voting/payment/paystack';

/** Minimal fake `.from(table)` chain; records every write attempt. */
function makeEC009SupabaseMock(votingSettingsRow: Record<string, unknown>) {
  const insertCalls: { table: string; payload: unknown }[] = [];

  function builder(table: string): any {
    const obj: any = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'or', 'is']) {
      obj[m] = vi.fn(() => obj);
    }
    obj.insert = vi.fn((payload: unknown) => {
      insertCalls.push({ table, payload });
      return obj;
    });
    obj.update = vi.fn(() => obj);
    obj.upsert = vi.fn(() => obj);
    obj.single = vi.fn(async () => {
      if (table === 'voting_settings') return { data: votingSettingsRow, error: null };
      return { data: null, error: null };
    });
    obj.maybeSingle = obj.single;
    obj.then = (resolve: any) => resolve({ data: table === 'voting_settings' ? votingSettingsRow : null, error: null });
    return obj;
  }

  const client: any = { from: vi.fn((table: string) => builder(table)), rpc: vi.fn() };
  return { client, insertCalls };
}

describe('EC-009: vote after contest close is rejected, not counted (paid path)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects initiatePaidVote when voting_end_date has passed, and creates no transaction or payment intent', async () => {
    const closedSettings = {
      id: 'vs-closed',
      contest_id: 'contest-closed',
      voting_enabled: true,
      voting_type: 'hybrid',
      paid_voting_enabled: true,
      currency: 'NGN',
      payment_provider: 'paystack',
      payment_ref_prefix: 'SPT-VOTE',
      voting_ends_at: new Date(Date.now() - 3600_000).toISOString(), // closed 1h ago
      status: 'active',
    };
    const { client, insertCalls } = makeEC009SupabaseMock(closedSettings);
    vi.mocked(createAdminClient).mockReturnValue(client);

    await expect(
      initiatePaidVote(
        {
          contestId: 'contest-closed',
          contestantId: 'contestant-A',
          voterEmail: 'voter@example.com',
          voterName: 'Late Voter',
          voteQuantity: 10,
          callbackUrl: 'https://example.com/callback',
        } as any,
        '10.0.0.1',
        'UA/1.0',
        'user-late-1',
      ),
    ).rejects.toThrow(/closed/i);

    // "not counted": no vote_transactions row, and Paystack never contacted.
    expect(insertCalls.some((c) => c.table === 'vote_transactions')).toBe(false);
    expect(initializePaystackPayment).not.toHaveBeenCalled();
  });

  it('rejects initiatePaidVote when voting has not started yet, and creates no transaction', async () => {
    const notYetSettings = {
      id: 'vs-future',
      contest_id: 'contest-future',
      voting_enabled: true,
      voting_type: 'hybrid',
      paid_voting_enabled: true,
      currency: 'NGN',
      payment_provider: 'paystack',
      payment_ref_prefix: 'SPT-VOTE',
      voting_starts_at: new Date(Date.now() + 3600_000).toISOString(), // starts in 1h
      status: 'active',
    };
    const { client, insertCalls } = makeEC009SupabaseMock(notYetSettings);
    vi.mocked(createAdminClient).mockReturnValue(client);

    await expect(
      initiatePaidVote(
        {
          contestId: 'contest-future',
          contestantId: 'contestant-A',
          voterEmail: 'voter@example.com',
          voterName: 'Early Voter',
          voteQuantity: 10,
          callbackUrl: 'https://example.com/callback',
        } as any,
        '10.0.0.1',
        'UA/1.0',
        'user-early-1',
      ),
    ).rejects.toThrow(/not started/i);

    expect(insertCalls.some((c) => c.table === 'vote_transactions')).toBe(false);
    expect(initializePaystackPayment).not.toHaveBeenCalled();
  });

  it('rejects initiatePaidVote when voting_enabled is false for the contest, regardless of window', async () => {
    const disabledSettings = {
      id: 'vs-disabled',
      contest_id: 'contest-disabled',
      voting_enabled: false,
      voting_type: 'hybrid',
      paid_voting_enabled: true,
      currency: 'NGN',
      payment_provider: 'paystack',
      payment_ref_prefix: 'SPT-VOTE',
      status: 'active',
    };
    const { client, insertCalls } = makeEC009SupabaseMock(disabledSettings);
    vi.mocked(createAdminClient).mockReturnValue(client);

    await expect(
      initiatePaidVote(
        {
          contestId: 'contest-disabled',
          contestantId: 'contestant-A',
          voterEmail: 'voter@example.com',
          voterName: 'Voter',
          voteQuantity: 10,
          callbackUrl: 'https://example.com/callback',
        } as any,
        '10.0.0.1',
        'UA/1.0',
        'user-1',
      ),
    ).rejects.toThrow(/not open/i);

    expect(insertCalls.some((c) => c.table === 'vote_transactions')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EC-012 — Same person registers in two contests: isolated entries, no bleed
// ---------------------------------------------------------------------------
//
// contest-distinctness.spec.ts already proves the two contests' FORM SCHEMAS
// don't bleed into each other. It never touches stored registration entries.
// The actual per-contest isolation guarantee lives in
// findLiveRegistrationForContest() (src/server/registration-v2/registration-for-contest.ts)
// — the duplicate-application guard startRegistrationDraft() calls before
// inserting a new row — backed by the DB's composite partial unique index
// `registrations_one_live_per_user_contest ON (user_id, contest_slug)`
// (supabase/migrations/20270125000000_registration_review_seam_and_dedupe.sql).
// These tests exercise that guard function directly against a mocked
// Supabase client that behaves like the real composite filter.
//
// Reuses the SAME '@/lib/supabase/server' mock registered above for the
// EC-009 section (one vi.mock per module path per file; a second call would
// just re-hoist redundantly) — createAdminClient is re-pointed per-test via
// vi.mocked(...).mockReturnValue(...) below, same as EC-009's tests do.

import { findLiveRegistrationForContest } from '@/src/server/registration-v2/registration-for-contest';

/**
 * Behaves like a real `.eq('user_id', ...).eq('contest_slug', ...)` filter
 * over an in-memory `registrations` table — so a lookup for contest B only
 * ever sees rows actually stored with contest_slug = B, proving the
 * composite key (not a bare user_id lookup) is what the guard enforces.
 */
function makeRegistrationsMock(rows: Array<Record<string, unknown>>) {
  function builder() {
    const filters: Record<string, unknown> = {};
    const obj: any = {
      select: () => obj,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return obj;
      },
      not: () => obj,
      order: () => obj,
      limit: async () => {
        const matched = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
        return { data: matched, error: null };
      },
    };
    return obj;
  }
  return { from: vi.fn(() => builder()) };
}

describe('EC-012: same person registers in two contests — isolated entries, no bleed', () => {
  const USER = 'user-cross-contest-1';

  const rows = [
    {
      id: 'reg-A',
      status: 'submitted',
      contest_slug: 'film-academy',
      user_id: USER,
      reference: 'REF-A',
      current_step: 'review',
      created_at: '2026-09-01T00:00:00Z',
      submitted_at: '2026-09-01T01:00:00Z',
    },
    // Note: NO row for 'open-mic-competition' — proving the same user has no
    // stored entry there yet.
  ];

  beforeEach(() => vi.clearAllMocks());

  it('finds the live registration for contest A', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeRegistrationsMock(rows) as any);

    const found = await findLiveRegistrationForContest(USER, { contestSlug: 'film-academy' });

    expect(found).not.toBeNull();
    expect(found?.contestSlug).toBe('film-academy');
    expect(found?.reference).toBe('REF-A');
  });

  it('does NOT leak contest A\'s registration when querying contest B for the same user', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeRegistrationsMock(rows) as any);

    const foundInB = await findLiveRegistrationForContest(USER, { contestSlug: 'open-mic-competition' });

    // Isolated: the guard must not find a "live registration" in B just
    // because the same user has one in A. This is the exact bleed EC-012 guards against.
    expect(foundInB).toBeNull();
  });

  it('the same user can hold live, independent entries in two DIFFERENT contests simultaneously', async () => {
    const twoContestRows = [
      ...rows,
      {
        id: 'reg-B',
        status: 'draft',
        contest_slug: 'open-mic-competition',
        user_id: USER,
        reference: 'REF-B',
        current_step: 'personal_information',
        created_at: '2026-09-05T00:00:00Z',
        submitted_at: null,
      },
    ];
    vi.mocked(createAdminClient).mockReturnValue(makeRegistrationsMock(twoContestRows) as any);

    const [foundA, foundB] = await Promise.all([
      findLiveRegistrationForContest(USER, { contestSlug: 'film-academy' }),
      findLiveRegistrationForContest(USER, { contestSlug: 'open-mic-competition' }),
    ]);

    expect(foundA?.id).toBe('reg-A');
    expect(foundB?.id).toBe('reg-B');
    // Distinct records: neither entry's data crosses into the other.
    expect(foundA?.reference).not.toBe(foundB?.reference);
    expect(foundA?.status).not.toBe(foundB?.status);
  });

  it('a DIFFERENT user querying the same contest slug does not see this user\'s entry (sanity: not a slug-only lookup)', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeRegistrationsMock(rows) as any);

    const found = await findLiveRegistrationForContest('some-other-user', { contestSlug: 'film-academy' });

    expect(found).toBeNull();
  });

  it('the DB-level guarantee behind this isolation is a COMPOSITE (user_id, contest_slug) index, not a user_id-only one', () => {
    // Static assertion against the migration itself: the isolation this
    // batch is proving at the service layer only HOLDS in the presence of two
    // properties — (a) the app-level guard is keyed on the pair, which the
    // tests above exercise, and (b) the DB constraint backing it is the same
    // pair, not user_id alone (which would make cross-contest registration
    // impossible rather than isolated). Reading the migration text pins that
    // second property without needing a live DB connection.
    const migrationPath = join(
      process.cwd(),
      '..',
      'supabase/migrations/20270125000000_registration_review_seam_and_dedupe.sql',
    );
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/registrations_one_live_per_user_contest/);
    expect(sql).toMatch(/ON public\.registrations \(user_id, contest_slug\)/);
  });
});

// ---------------------------------------------------------------------------
// EC-003 — Paid vote succeeds but count-apply fails: no longer reachable
// ---------------------------------------------------------------------------
//
// Before the PV-005 fix (20270211000000_vote_bridge_paid_vote_atomic_credit.sql),
// crediting a paid vote was: separate RPC to "lock" -> separate SELECT ->
// separate INSERT into votes -> separate UPDATE of vote_totals. Each of those
// was its own PostgREST request/transaction, so "paid vote succeeds but
// count-apply fails" was a real, reachable failure mode: the INSERT into
// `votes` could commit while the following `vote_totals` UPDATE/INSERT failed
// or was skipped (crash, timeout, disconnect between calls) — money/vote
// credited, contestant's tally not updated.
//
// After the fix, credit_paid_vote_transaction() does the INSERT into `votes`
// AND the vote_totals upsert inside ONE PL/pgSQL function body, invoked via a
// SINGLE Supabase RPC call — i.e. one Postgres transaction. Postgres commits
// or rolls back a function body atomically: there is no window where the vote
// row exists but the totals row does not (or vice versa) short of the whole
// database process dying mid-commit, which is a durability question (WAL/fsync),
// not an application-level "count-apply" step that can independently fail.
//
// This is a structural/static proof (reads the migration source and asserts
// the invariant architecturally), which is what "no longer possible" claims
// about atomicity require — no flaky timing-based mock can prove a race is
// eliminated, only that the code no longer HAS two separate steps to race.
describe('EC-003: paid-vote count-apply-fail reconciliation is no longer a reachable failure mode', () => {
  it('the vote INSERT and vote_totals UPDATE/INSERT live in the SAME function body (credit_paid_vote_transaction), not separate calls', () => {
    const migrationPath = join(
      process.cwd(),
      '..',
      'supabase/migrations/20270211000000_vote_bridge_paid_vote_atomic_credit.sql',
    );
    const sql = readFileSync(migrationPath, 'utf8');

    // One CREATE FUNCTION statement for the whole credit path.
    const fnMatches = sql.match(/CREATE OR REPLACE FUNCTION public\.credit_paid_vote_transaction/g);
    expect(fnMatches).toHaveLength(1);

    // Both the vote insert and the totals write are inside that one function's
    // body (i.e. appear after its opening and before its closing `$$;`).
    const bodyStart = sql.indexOf('LANGUAGE plpgsql');
    const bodyEnd = sql.indexOf('$$;', bodyStart);
    const body = sql.slice(bodyStart, bodyEnd);

    expect(body).toMatch(/INSERT INTO public\.votes/);
    expect(body).toMatch(/UPDATE public\.vote_totals/);
    expect(body).toMatch(/INSERT INTO public\.vote_totals/);
    // The row lock spans the whole check-and-write (this is what makes the
    // insert+totals-write atomic together, not just each individually safe).
    expect(body).toMatch(/FOR UPDATE/);

    // No second RPC/lock call pattern (the old, broken "lock then separate
    // calls" shape) remains anywhere in the bridge caller.
    const bridgePath = join(process.cwd(), 'src/server/voting-bridge/bridge.ts');
    const bridgeSrc = readFileSync(bridgePath, 'utf8');
    expect(bridgeSrc).not.toMatch(/lock_vote_transaction/);
    // Exactly one call site for the credit RPC — no fallback/legacy path that
    // could reintroduce the split-transaction race.
    const rpcCallCount = (bridgeSrc.match(/rpc\('credit_paid_vote_transaction'/g) || []).length;
    expect(rpcCallCount).toBe(1);
  });

  // The runtime half of this claim — a losing concurrent caller replays as a
  // safe success with vote_id undefined, i.e. no partial "credited but not
  // counted" state is ever exposed to a caller — is already exercised at
  // runtime by paid-vote-concurrency.spec.ts's "a losing concurrent caller
  // (already_credited=true) succeeds without double-crediting side effects"
  // test. Not duplicated here to avoid a second, conflicting set of module
  // mocks for '@/src/server/voting/core' within this same file.
});
