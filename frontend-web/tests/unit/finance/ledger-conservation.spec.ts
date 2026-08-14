/**
 * ADR-PR98 — ledger conservation invariant (Next.js wallet plane).
 *
 * The shared `public.ledger_entries` table is written by BOTH the Go finance
 * ledger and this Next.js wallet plane. Before ADR-PR98 the wallet plane posted a
 * single leg per money event, so the table could not conserve value — a top-up
 * left a `CREDIT 500000` with no offsetting `DEBIT` anywhere, and global
 * conservation was permanently unassertable.
 *
 * These tests pin the property at the level CI can check on every PR, without a
 * database: the journal BUILDER can only produce balanced legs, and the writer
 * refuses to post anything else. The cross-plane, whole-table assertion lives in
 * backend/tests/ledger/global_conservation_live_db_test.go.
 *
 * If you are here because a test failed: you probably added a wallet write that
 * posts one leg. Post a journal instead (src/server/wallet/journal.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import {
  buildJournalLegs,
  journalIsBalanced,
  journalSignedSum,
  signedKobo,
  postJournal,
  COUNTER_SIDE,
  COUNTER_LEG_SUFFIX,
  DEFAULT_CREDIT_COUNTER,
  DEFAULT_DEBIT_COUNTER,
  type LedgerLegInsert,
} from '@/src/server/wallet/journal';
import { CREDIT_SIDE_TYPES, type LedgerEntryType } from '@/src/server/wallet/ledger';
import { createAdminClient } from '@/lib/supabase/server';

const WALLET = 'account-wallet-001';
const COUNTER = 'account-standing-001';
const ALL_TYPES: LedgerEntryType[] = ['CREDIT', 'DEBIT', 'REVERSAL_CREDIT', 'REVERSAL_DEBIT'];

// ---------------------------------------------------------------------------
// 1. Sign rule matches the wallet_balance view / Go balanceProjectionSQL.
// ---------------------------------------------------------------------------
describe('signed amount rule', () => {
  it('treats CREDIT and REVERSAL_DEBIT as positive', () => {
    expect(signedKobo({ type: 'CREDIT', amount_kobo: 500 })).toBe(500);
    expect(signedKobo({ type: 'REVERSAL_DEBIT', amount_kobo: 500 })).toBe(500);
  });

  it('treats DEBIT and REVERSAL_CREDIT as negative', () => {
    expect(signedKobo({ type: 'DEBIT', amount_kobo: 500 })).toBe(-500);
    expect(signedKobo({ type: 'REVERSAL_CREDIT', amount_kobo: 500 })).toBe(-500);
  });

  it('agrees with CREDIT_SIDE_TYPES for every entry type', () => {
    for (const type of ALL_TYPES) {
      const expected = CREDIT_SIDE_TYPES.has(type) ? 1 : -1;
      expect(Math.sign(signedKobo({ type, amount_kobo: 1 }))).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Every side has an opposite, and opposing is an involution — so a journal
//    built from any side is balanced by construction.
// ---------------------------------------------------------------------------
describe('counter-side mapping', () => {
  it('covers every entry type', () => {
    for (const type of ALL_TYPES) {
      expect(ALL_TYPES).toContain(COUNTER_SIDE[type]);
    }
  });

  it('is an involution — the counter of the counter is the original', () => {
    for (const type of ALL_TYPES) {
      expect(COUNTER_SIDE[COUNTER_SIDE[type]]).toBe(type);
    }
  });

  it('always flips the sign', () => {
    for (const type of ALL_TYPES) {
      const a = signedKobo({ type, amount_kobo: 1000 });
      const b = signedKobo({ type: COUNTER_SIDE[type], amount_kobo: 1000 });
      expect(a + b).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. THE invariant: the builder cannot produce an unbalanced journal.
// ---------------------------------------------------------------------------
describe('buildJournalLegs conservation', () => {
  const base = {
    primaryAccountId: WALLET,
    counterAccountId: COUNTER,
    amountKobo: 500_000,
    reference: 'TOPUP:TOPUP_C2379AC8A0474D06',
    idempotencyKey: 'topup:intent-001:CREDIT',
  };

  it('sums to exactly zero for every possible primary side', () => {
    for (const primarySide of ALL_TYPES) {
      const legs = buildJournalLegs({ ...base, primarySide });
      expect(journalSignedSum(legs)).toBe(0);
      expect(journalIsBalanced(legs)).toBe(true);
    }
  });

  it('conserves for any positive integer amount', () => {
    for (const amountKobo of [1, 99, 10_000, 500_000, 999_999_999]) {
      const legs = buildJournalLegs({ ...base, amountKobo, primarySide: 'CREDIT' });
      expect(journalSignedSum(legs)).toBe(0);
    }
  });

  it('posts the two legs to DIFFERENT accounts (a self-pair conserves but moves nothing)', () => {
    const legs = buildJournalLegs({ ...base, primarySide: 'CREDIT' });
    expect(legs[0].account_id).toBe(WALLET);
    expect(legs[1].account_id).toBe(COUNTER);
    expect(legs[0].account_id).not.toBe(legs[1].account_id);
  });

  it('shares one reference across both legs so the pair is groupable', () => {
    const legs = buildJournalLegs({ ...base, primarySide: 'DEBIT' });
    expect(legs[0].reference).toBe(base.reference);
    expect(legs[1].reference).toBe(base.reference);
  });

  it('rejects non-integer and non-positive amounts (kobo iron rule)', () => {
    expect(() => buildJournalLegs({ ...base, amountKobo: 0, primarySide: 'CREDIT' }))
      .toThrow(/positive/i);
    expect(() => buildJournalLegs({ ...base, amountKobo: -1, primarySide: 'CREDIT' }))
      .toThrow(/positive/i);
    expect(() => buildJournalLegs({ ...base, amountKobo: 99.99, primarySide: 'CREDIT' }))
      .toThrow(/integer/i);
  });

  // ---------------------------------------------------------------------------
  // Regression guard for the most dangerous detail in ADR-PR98. Entries written
  // before the ADR carry the UN-suffixed key, and checkIdempotencyKey looks up
  // that exact string. Suffixing the wallet leg would make a replayed webhook
  // miss dedup and double-credit the user.
  // ---------------------------------------------------------------------------
  it('keeps the caller idempotency key VERBATIM on the primary leg', () => {
    const legs = buildJournalLegs({ ...base, primarySide: 'CREDIT' });
    expect(legs[0].idempotency_key).toBe('topup:intent-001:CREDIT');
  });

  it('suffixes only the counter-leg, so its key can never collide with history', () => {
    const legs = buildJournalLegs({ ...base, primarySide: 'CREDIT' });
    expect(legs[1].idempotency_key).toBe('topup:intent-001:CREDIT' + COUNTER_LEG_SUFFIX);
    expect(legs[1].idempotency_key).not.toBe(legs[0].idempotency_key);
  });
});

// ---------------------------------------------------------------------------
// 4. Balance detection itself.
// ---------------------------------------------------------------------------
describe('journalIsBalanced', () => {
  it('rejects the pre-ADR-PR98 single-leg top-up shape', () => {
    // The exact row observed on the local DB: a lone CREDIT with no counter-leg.
    const singleLeg: Pick<LedgerLegInsert, 'type' | 'amount_kobo'>[] = [
      { type: 'CREDIT', amount_kobo: 500_000 },
    ];
    expect(journalIsBalanced(singleLeg)).toBe(false);
    expect(journalSignedSum(singleLeg)).toBe(500_000);
  });

  it('rejects an empty journal (nothing posted is not a balanced posting)', () => {
    expect(journalIsBalanced([])).toBe(false);
  });

  it('rejects the pre-ADR-PR98 fee leak (DR amount+fee vs CR amount)', () => {
    const amount = 100_000;
    const fee = 2_500;
    expect(journalIsBalanced([
      { type: 'DEBIT', amount_kobo: amount + fee },
      { type: 'CREDIT', amount_kobo: amount },
    ])).toBe(false);
  });

  it('accepts the fixed transfer journal once the fee has its own leg', () => {
    const amount = 100_000;
    const fee = 2_500;
    expect(journalIsBalanced([
      { type: 'DEBIT', amount_kobo: amount + fee },
      { type: 'CREDIT', amount_kobo: amount },
      { type: 'CREDIT', amount_kobo: fee },
    ])).toBe(true);
  });

  it('accepts a multi-leg journal that nets out', () => {
    expect(journalIsBalanced([
      { type: 'DEBIT', amount_kobo: 300 },
      { type: 'CREDIT', amount_kobo: 100 },
      { type: 'CREDIT', amount_kobo: 200 },
    ])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. The writer is fail-closed: an unbalanced set never reaches the database.
// ---------------------------------------------------------------------------
describe('postJournal fail-closed guard', () => {
  const insertFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    insertFn.mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: insertFn }),
    } as never);
  });

  const leg = (type: LedgerEntryType, amount_kobo: number): LedgerLegInsert => ({
    account_id: type === 'CREDIT' ? WALLET : COUNTER,
    type,
    amount_kobo,
    reference: 'REF-1',
    idempotency_key: `k-${type}`,
    description: null,
    metadata: null,
  });

  it('writes a balanced pair in ONE insert call (atomic — no half-journal)', async () => {
    const legs = buildJournalLegs({
      primaryAccountId: WALLET,
      counterAccountId: COUNTER,
      primarySide: 'CREDIT',
      amountKobo: 500_000,
      reference: 'TOPUP:X',
      idempotencyKey: 'topup:x:CREDIT',
    });

    const result = await postJournal(legs, 'ctx');

    expect(result.duplicate).toBe(false);
    expect(insertFn).toHaveBeenCalledTimes(1);
    expect(insertFn).toHaveBeenCalledWith(legs);
    expect(insertFn.mock.calls[0][0]).toHaveLength(2);
  });

  it('refuses to insert a single leg', async () => {
    await expect(postJournal([leg('CREDIT', 500_000)], 'ctx'))
      .rejects.toThrow(/unbalanced journal/i);
    expect(insertFn).not.toHaveBeenCalled();
  });

  it('refuses to insert legs whose amounts do not match', async () => {
    await expect(postJournal([leg('CREDIT', 500_000), leg('DEBIT', 499_999)], 'ctx'))
      .rejects.toThrow(/unbalanced journal/i);
    expect(insertFn).not.toHaveBeenCalled();
  });

  it('reports the residual so the error names the size of the break', async () => {
    await expect(postJournal([leg('CREDIT', 500_000)], 'ctx'))
      .rejects.toThrow(/500000 kobo/);
  });

  it('maps a UNIQUE violation to duplicate rather than throwing', async () => {
    insertFn.mockResolvedValue({ error: { code: '23505', message: 'dup' } });
    const legs = buildJournalLegs({
      primaryAccountId: WALLET,
      counterAccountId: COUNTER,
      primarySide: 'CREDIT',
      amountKobo: 1_000,
      reference: 'R',
      idempotencyKey: 'k',
    });
    await expect(postJournal(legs, 'ctx')).resolves.toEqual({ duplicate: true });
  });
});

// ---------------------------------------------------------------------------
// 6. Counter-account defaults are on the SHARED chart of accounts — using the Go
//    ledger's own type names is what keeps the two planes reconcilable.
// ---------------------------------------------------------------------------
describe('counter-account defaults', () => {
  it('funds inbound money from provider_clearing', () => {
    expect(DEFAULT_CREDIT_COUNTER).toBe('provider_clearing');
  });

  it('settles outbound money against settlement', () => {
    expect(DEFAULT_DEBIT_COUNTER).toBe('settlement');
  });
});
