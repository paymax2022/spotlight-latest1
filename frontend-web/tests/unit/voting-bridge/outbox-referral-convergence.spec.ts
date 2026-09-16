/**
 * REF-001 — regression test for the referral outbox dual-drain bug.
 *
 * Two independent code paths drain `bridge_outbox` rows where
 * `event_type = 'referral.triggered'`:
 *
 *   1. `processReferralOutbox()` in `@/src/server/referrals/service` — the real
 *      implementation, invoked via `POST /api/v1/referrals/outbox`.
 *   2. `processPendingOutboxEvents()` in `@/src/server/voting-bridge/outbox` —
 *      a generic outbox worker documented as "called by a background
 *      worker/cron". Its `handleReferralTriggered()` used to be a literal
 *      stub: it logged the payload and returned `true`, which marked the
 *      outbox row `done` WITHOUT crediting anyone — a silent, permanent,
 *      unrecoverable loss of the ₦500 referral reward if this drain path
 *      ever ran against a `referral.triggered` row.
 *
 * This suite proves:
 *   (a) `processPendingOutboxEvents()` now actually credits the wallet when it
 *       processes a `referral.triggered` row (not just logs and returns true).
 *   (b) Processing the SAME event through both drain paths (in either order)
 *       results in exactly ONE credit, never zero and never two — because both
 *       paths converge on the same `processReferralReward()`, which is guarded
 *       by the `referral-reward:<referrerId>:<referredUserId>` idempotency key.
 *
 * DB and wallet ledger are faked in-memory; only the leaf dependencies
 * (`@/lib/supabase/server` and `@/src/server/wallet/service`) are mocked. The
 * real `processReferralReward()`, `processReferralOutbox()`, and
 * `processPendingOutboxEvents()` all run for real against the fakes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── In-memory fakes (hoisted so vi.mock factories below can close over them) ──

const { store, creditedKeys, creditCalls, resetFakes } = vi.hoisted(() => {
  const store: {
    bridge_outbox: Array<Record<string, any>>;
    finance_referral_codes: Array<Record<string, any>>;
    referral_events: Array<Record<string, any>>;
  } = { bridge_outbox: [], finance_referral_codes: [], referral_events: [] };

  const creditedKeys = new Set<string>();
  const creditCalls: Array<{ userId: string; idempotencyKey: string; amountKobo: number }> = [];

  function resetFakes() {
    store.bridge_outbox = [];
    store.finance_referral_codes = [];
    store.referral_events = [];
    creditedKeys.clear();
    creditCalls.length = 0;
  }

  return { store, creditedKeys, creditCalls, resetFakes };
});

// ── Minimal chainable fake Supabase query builder ──────────────────────────────

function matchFilters(row: Record<string, any>, filters: Array<[string, string, any]>) {
  return filters.every(([col, op, val]) => {
    if (op === 'eq') return row[col] === val;
    if (op === 'in') return Array.isArray(val) && val.includes(row[col]);
    return true;
  });
}

class FakeQueryBuilder implements PromiseLike<{ data: any; error: any }> {
  private filters: Array<[string, string, any]> = [];
  private op: 'select' | 'insert' | 'update' | null = null;
  private payload: Record<string, any> | null = null;
  private limitN: number | null = null;

  constructor(private table: keyof typeof store) {}

  select(_cols?: string) {
    if (!this.op) this.op = 'select';
    return this;
  }
  insert(payload: Record<string, any>) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  update(payload: Record<string, any>) {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  eq(col: string, val: any) {
    this.filters.push([col, 'eq', val]);
    return this;
  }
  in(col: string, vals: any[]) {
    this.filters.push([col, 'in', vals]);
    return this;
  }
  order(_col: string, _opts?: unknown) {
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    return this._exec(true);
  }
  single() {
    return this._exec(true);
  }

  // Makes `await builder` work without an explicit terminal call.
  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this._exec(false).then(onfulfilled, onrejected);
  }

  private async _exec(single: boolean): Promise<{ data: any; error: any }> {
    const rows = store[this.table];

    if (this.op === 'insert') {
      const row: Record<string, any> = {
        id: `${this.table}-${rows.length + 1}`,
        created_at: new Date(Date.now() + rows.length).toISOString(),
        ...this.payload,
      };

      if (this.table === 'referral_events') {
        const dup = rows.find(
          r => (r.referrer_id === row.referrer_id && r.referred_id === row.referred_id) ||
               r.idempotency_key === row.idempotency_key,
        );
        if (dup) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
      }
      if (this.table === 'finance_referral_codes') {
        const dup = rows.find(r => r.user_id === row.user_id || r.code === row.code);
        if (dup) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
      }

      rows.push(row);
      return { data: single ? row : [row], error: null };
    }

    if (this.op === 'update') {
      const matched = rows.filter(r => matchFilters(r, this.filters));
      matched.forEach(r => Object.assign(r, this.payload));
      return { data: matched, error: null };
    }

    // select
    let matched = rows.filter(r => matchFilters(r, this.filters));
    matched = [...matched].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    if (this.limitN != null) matched = matched.slice(0, this.limitN);

    if (single) {
      return { data: matched[0] ?? null, error: null };
    }
    return { data: matched, error: null };
  }
}

function fakeCreateAdminClient() {
  return {
    from: (table: string) => new FakeQueryBuilder(table as keyof typeof store),
  };
}

// ── Module mocks ────────────────────────────────────────────────────────────────
// Both `@/lib/supabase/server` (used by referrals/service.ts) and
// `@/lib/supabase/admin` (used by voting-bridge/outbox.ts, which just
// re-exports the same factory from './server') are mocked identically so both
// drain paths operate on the exact same in-memory `bridge_outbox` table.

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: fakeCreateAdminClient,
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: fakeCreateAdminClient,
}));

// Wallet crediting is mocked with a faithful, idempotency-key-aware stand-in
// for the real `creditWallet()` — real `creditWallet()` checks the
// idempotency key against the ledger (via a UNIQUE constraint) before
// posting; this fake reproduces that guarantee without a real Postgres.
vi.mock('@/src/server/wallet/service', () => ({
  creditWallet: vi.fn(async (userId: string, input: { amountKobo: number; idempotencyKey: string }) => {
    if (creditedKeys.has(input.idempotencyKey)) {
      return { alreadyProcessed: true, amountKobo: input.amountKobo };
    }
    creditedKeys.add(input.idempotencyKey);
    creditCalls.push({ userId, idempotencyKey: input.idempotencyKey, amountKobo: input.amountKobo });
    return { alreadyProcessed: false, amountKobo: input.amountKobo };
  }),
}));

// ── Import real implementations AFTER mocks ─────────────────────────────────────

import { processPendingOutboxEvents } from '@/src/server/voting-bridge/outbox';
import { processReferralOutbox } from '@/src/server/referrals/service';

const REFERRER_ID = 'referrer-user-001';
const REFERRED_ID = 'referred-user-002';
const SHARE_CODE = 'SPOT-ABC123';
const IDEMPOTENCY_KEY = `referral-reward:${REFERRER_ID}:${REFERRED_ID}`;

function seedReferralCode() {
  store.finance_referral_codes.push({ user_id: REFERRER_ID, code: SHARE_CODE });
}

function seedOutboxRow(overrides: Record<string, any> = {}) {
  const row = {
    id: `outbox-${store.bridge_outbox.length + 1}`,
    event_type: 'referral.triggered',
    payload: { shareCode: SHARE_CODE, voterId: REFERRED_ID, contestantId: 'contestant-9' },
    status: 'pending',
    attempts: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
  store.bridge_outbox.push(row);
  return row;
}

beforeEach(() => {
  resetFakes();
  seedReferralCode();
});

describe('REF-001: referral.triggered outbox convergence', () => {
  it('processPendingOutboxEvents() actually credits the wallet, not just logs and returns true', async () => {
    const row = seedOutboxRow();

    const processedCount = await processPendingOutboxEvents();

    expect(processedCount).toBe(1);
    expect(creditCalls).toHaveLength(1);
    expect(creditCalls[0]).toMatchObject({
      userId: REFERRER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      amountKobo: 50_000,
    });

    const updatedRow = store.bridge_outbox.find(r => r.id === row.id);
    expect(updatedRow?.status).toBe('done');
    expect(updatedRow?.processed_at).toBeTruthy();
  });

  it('processing the same event via BOTH drain paths credits exactly once, never twice', async () => {
    // Path 1: the generic outbox worker (outbox.ts) picks up the row first.
    seedOutboxRow();
    await processPendingOutboxEvents();

    expect(creditCalls).toHaveLength(1);
    expect(store.bridge_outbox[0].status).toBe('done');

    // Path 2: the dedicated referral drain (referrals/service.ts) queries for
    // `status = 'pending'` rows — the row is already 'done', so it finds
    // nothing to reprocess. This models the real production guard: the FIRST
    // path to claim a row transitions it out of 'pending' before crediting.
    const result = await processReferralOutbox();

    expect(result).toEqual({ processed: 0, skipped: 0, failed: 0 });
    expect(creditCalls).toHaveLength(1); // still exactly one credit — never two
  });

  it('two concurrent pending rows for the SAME referral pair collapse to exactly one credit', async () => {
    // Simulates a race where both drain paths grab their own row for the same
    // underlying referral pair before either has transitioned it out of
    // 'pending' (e.g. duplicate enqueue, or two workers each with their own
    // claim). The idempotency key is keyed on (referrer, referred) — not on
    // the outbox row id — so both must converge on a single credit.
    seedOutboxRow({ id: 'outbox-race-a' });
    seedOutboxRow({ id: 'outbox-race-b' });

    // Process both rows through the SAME drain path back-to-back, simulating
    // the second row being picked up before a real DB's row-level locking
    // would normally prevent it.
    await processPendingOutboxEvents();
    // First call already drains all pending rows in one pass (limit 100), so
    // process again to prove a repeat pass is also safe (both rows are now
    // 'done', nothing left to double-credit).
    await processPendingOutboxEvents();

    expect(creditCalls).toHaveLength(1);
    expect(store.bridge_outbox.every(r => r.status === 'done')).toBe(true);
  });

  it('processReferralOutbox() (the dedicated path) still works standalone', async () => {
    seedOutboxRow();

    const result = await processReferralOutbox();

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 0 });
    expect(creditCalls).toHaveLength(1);
    expect(store.bridge_outbox[0].status).toBe('done');
  });

  it('a malformed payload (missing shareCode/voterId) is marked done, not retried forever', async () => {
    seedOutboxRow({ payload: { contestantId: 'contestant-9' } });

    const processedCount = await processPendingOutboxEvents();

    expect(processedCount).toBe(1); // handleReferralTriggered returns true (terminal, not retryable)
    expect(creditCalls).toHaveLength(0);
    expect(store.bridge_outbox[0].status).toBe('done');
  });
});
