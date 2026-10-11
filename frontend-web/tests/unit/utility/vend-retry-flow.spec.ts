// Card-paid utility bills: payment received => vend. When the vend is CONFIRMED
// failed, a cron retries it; 30 minutes after vending first failed the customer is
// refunded to their wallet; a customer with no active wallet has the funds HELD
// with admin and is emailed to activate it (released once active). Owner rule,
// closes the ADR-PR697 residual. Behind FEATURE_UTILITY_CARD_LEDGER.
//
// Also pins the race fix: the writer takes a version-checked claim on its row
// right before the collect and again before the spend, and yields if it lost the
// row or stalled, so the sweeper's retained funds can never be followed by a late
// spend (+X -X, no vend, no refund).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/wallet/service', () => ({
  debitWallet: vi.fn(),
  reverseWalletDebit: vi.fn(),
  creditWallet: vi.fn(),
}));
vi.mock('@/src/server/utility/adapters/registry', () => ({ getUtilityAdapter: vi.fn() }));
vi.mock('@/src/server/utility/notifications', () => ({
  notifyUtilityCustomer: vi.fn(),
  notifyUtilityTransactionStatus: vi.fn(),
  queueUtilityAdminAlert: vi.fn(),
}));
vi.mock('@/src/server/notifications/email', () => ({ sendEmail: vi.fn() }));
vi.mock('@/src/server/commission/config', () => ({ resolveUtilityCommission: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/server';
import { creditWallet, debitWallet, reverseWalletDebit } from '@/src/server/wallet/service';
import { getUtilityAdapter } from '@/src/server/utility/adapters/registry';
import { resolveUtilityCommission } from '@/src/server/commission/config';
import { queueUtilityAdminAlert, notifyUtilityCustomer, notifyUtilityTransactionStatus } from '@/src/server/utility/notifications';
import { sendEmail } from '@/src/server/notifications/email';
import {
  payUtility,
  requeryUtilityTransaction,
  reverseUtilityTransaction,
  runUtilityVendRetries,
} from '@/src/server/utility/service';
import { VEND_REFUND_AFTER_MS, VEND_RETRY_GAP_MS } from '@/src/server/utility/vendRetryPolicy';
import { BILLER, PRODUCT, makeFakeSupabase, type EventHook, type FakeSupabase, type Row } from './helpers/fakeSupabase';

const USER_ID = 'user-vend-retry-001';
const EMAIL = 'customer@example.com';
const FLAG = 'FEATURE_UTILITY_CARD_LEDGER';
const T0 = new Date('2026-10-12T10:00:00.000Z');
const minutes = (n: number) => n * 60_000;

let fake: FakeSupabase;

const input = (key: string) => ({
  category: 'airtime' as const, billerId: BILLER.id, productId: PRODUCT.id,
  customerReference: '+2348011111111', amountKobo: 500_000, paymentSource: 'paystack' as const,
  idempotencyKey: key, metadata: { payment_reference: 'UTIL_PAY_REF_1' },
});

/** The adapter answers with these statuses in order; the last one repeats. */
function adapterSequence(statuses: Array<'failed' | 'successful' | 'pending'>) {
  let i = 0;
  const purchase = vi.fn(async () => {
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    return {
      status,
      message: status === 'failed' ? 'Provider declined.' : status === 'pending' ? 'Pending.' : 'Vended.',
      raw: {},
      providerReference: `prov-${i}`,
      token: status === 'successful' ? 'TOKEN-1234' : undefined,
    };
  });
  vi.mocked(getUtilityAdapter).mockReturnValue({
    validateCustomer: vi.fn(async () => ({ valid: true })),
    purchase,
    queryTransactionStatus: vi.fn(),
  } as any);
  return purchase;
}

const creditKeys = () => vi.mocked(creditWallet).mock.calls.map((c) => (c[1] as any).idempotencyKey as string);
const reverseKeys = () => vi.mocked(reverseWalletDebit).mock.calls.map((c) => (c[1] as any).idempotencyKey as string);
const eventTypes = () => fake.events.map((e) => e.event_type);
const emails = () => vi.mocked(sendEmail).mock.calls.map((c) => ({ to: c[0], subject: c[1], html: c[2] }));

function wire(f: FakeSupabase) {
  fake = f;
  vi.mocked(createAdminClient).mockReturnValue(f as any);
  vi.mocked(creditWallet).mockImplementation(async (_u: string, i: any) => { f.ledgerKeys.add(i.idempotencyKey); return { alreadyProcessed: false } as any; });
  vi.mocked(debitWallet).mockImplementation(async (_u: string, i: any) => { f.ledgerKeys.add(i.idempotencyKey); return { alreadyProcessed: false } as any; });
  vi.mocked(reverseWalletDebit).mockImplementation(async (_u: string, i: any) => { f.ledgerKeys.add(i.idempotencyKey); return { alreadyProcessed: false } as any; });
}

const activeUser = { [EMAIL]: { status: 'active', deleted_at: null } };

/** A card-paid row whose vend failed and is in the retry window; collect+spend are posted. */
function retryRow(id: string, over: Row = {}, vendRetry: Row = {}): Row {
  return {
    id, user_id: USER_ID, payment_source: 'paystack', status: 'failed',
    category: 'airtime', biller_id: BILLER.id, product_id: PRODUCT.id, customer_reference: '+2348011111111',
    amount_kobo: 500_000, convenience_fee_kobo: 0, retail_amount_kobo: 500_000,
    provider_cost_kobo: 490_000, gross_profit_kobo: 10_000, gross_margin_bps: 200,
    receipt_number: `R-${id}`, idempotency_key: `k-${id}`,
    metadata: {
      payment_reference: 'UTIL_PAY_REF_1',
      vend_retry: {
        state: 'retrying', first_failed_at: T0.toISOString(), attempts: 1,
        last_attempt_at: T0.toISOString(), ...vendRetry,
      },
    },
    created_at: T0.toISOString(), updated_at: T0.toISOString(), ...over,
  };
}

function seed(f: FakeSupabase, id: string, legs: Array<'COLLECT' | 'DEBIT'> = ['COLLECT', 'DEBIT']) {
  for (const l of legs) f.ledgerKeys.add(`utility:${id}:${l === 'COLLECT' ? 'CARD_COLLECT' : 'DEBIT'}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env[FLAG] = '1';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.mocked(resolveUtilityCommission).mockResolvedValue({ service: null, subtype: '', config: null });
});
afterEach(() => {
  delete process.env[FLAG];
  vi.useRealTimers();
});

describe('writer: a confirmed failed vend starts the retry window — nothing is refunded yet', () => {
  it('posts only collect+spend; the row stays failed in the retrying state; no admin-approval queue', async () => {
    wire(makeFakeSupabase({ authEmails: { [USER_ID]: EMAIL }, platformUsers: activeUser }));
    adapterSequence(['failed']);
    const { transaction } = await payUtility(USER_ID, input('idem-w-1'));

    expect(creditKeys()).toEqual([`utility:${transaction.id}:CARD_COLLECT`]);
    expect(reverseWalletDebit).not.toHaveBeenCalled();
    const stored = fake.txs.get(transaction.id)!;
    expect(stored.status).toBe('failed');
    expect(stored.metadata?.vend_retry).toMatchObject({ state: 'retrying', attempts: 1 });
    expect(Date.parse(stored.metadata.vend_retry.first_failed_at)).toBe(T0.getTime());
    expect(eventTypes()).toContain('vend_retry_started');
    expect(vi.mocked(queueUtilityAdminAlert)).not.toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/approv/i) }));
  });

  it('a successful vend is untouched: no retry state, no extra credit', async () => {
    wire(makeFakeSupabase());
    adapterSequence(['successful']);
    const { transaction } = await payUtility(USER_ID, input('idem-w-2'));
    expect(transaction.status).toBe('successful');
    expect(fake.txs.get(transaction.id)!.metadata?.vend_retry).toBeUndefined();
    expect(creditKeys()).toEqual([`utility:${transaction.id}:CARD_COLLECT`]);
  });

  it('a retry-state write that is lost is loud, never silent, and still refunds nothing', async () => {
    wire(makeFakeSupabase({ dropVendRetryWrite: true }));
    adapterSequence(['failed']);
    await payUtility(USER_ID, input('idem-w-3'));
    expect(eventTypes()).toContain('vend_retry_unrecorded');
    expect(vi.mocked(queueUtilityAdminAlert)).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'finance', title: expect.stringMatching(/could not be recorded/i) }),
    );
    expect(reverseWalletDebit).not.toHaveBeenCalled();
  });
});

describe('cron worker: retry while inside 30 minutes', () => {
  it('retries after the gap and a successful vend completes the bill (no refund)', async () => {
    wire(makeFakeSupabase({ authEmails: { [USER_ID]: EMAIL }, platformUsers: activeUser, transactions: [retryRow('tx-a')] }));
    seed(fake, 'tx-a');
    const purchase = adapterSequence(['successful']);

    vi.setSystemTime(new Date(T0.getTime() + VEND_RETRY_GAP_MS));
    const r = await runUtilityVendRetries({ limit: 10 });

    expect(purchase).toHaveBeenCalledTimes(1);
    expect(r.vended).toBe(1);
    const row = fake.txs.get('tx-a')!;
    expect(row.status).toBe('successful');
    expect(row.token).toBe('TOKEN-1234');
    expect(row.metadata.vend_retry.state).toBe('vended');
    expect(reverseWalletDebit).not.toHaveBeenCalled();
    expect(creditWallet).not.toHaveBeenCalled();
    expect(vi.mocked(notifyUtilityTransactionStatus)).toHaveBeenCalled();
  });

  it('a retry that fails again counts the attempt and keeps waiting — no money moves', async () => {
    wire(makeFakeSupabase({ authEmails: { [USER_ID]: EMAIL }, platformUsers: activeUser, transactions: [retryRow('tx-b')] }));
    seed(fake, 'tx-b');
    adapterSequence(['failed']);

    vi.setSystemTime(new Date(T0.getTime() + VEND_RETRY_GAP_MS));
    await runUtilityVendRetries({ limit: 10 });

    const vr = fake.txs.get('tx-b')!.metadata.vend_retry;
    expect(vr.state).toBe('retrying');
    expect(vr.attempts).toBe(2);
    expect(fake.txs.get('tx-b')!.status).toBe('failed');
    expect(reverseWalletDebit).not.toHaveBeenCalled();
  });

  it('inside the gap the provider is not called at all', async () => {
    wire(makeFakeSupabase({ authEmails: { [USER_ID]: EMAIL }, platformUsers: activeUser, transactions: [retryRow('tx-c')] }));
    seed(fake, 'tx-c');
    const purchase = adapterSequence(['successful']);
    vi.setSystemTime(new Date(T0.getTime() + VEND_RETRY_GAP_MS - 1));
    await runUtilityVendRetries({ limit: 10 });
    expect(purchase).not.toHaveBeenCalled();
  });

  it('a retry that comes back pending hands the row to the normal provider_pending requery', async () => {
    wire(makeFakeSupabase({ authEmails: { [USER_ID]: EMAIL }, platformUsers: activeUser, transactions: [retryRow('tx-d')] }));
    seed(fake, 'tx-d');
    adapterSequence(['pending']);
    vi.setSystemTime(new Date(T0.getTime() + VEND_RETRY_GAP_MS));
    await runUtilityVendRetries({ limit: 10 });
    expect(fake.txs.get('tx-d')!.status).toBe('provider_pending');
    expect(reverseWalletDebit).not.toHaveBeenCalled();
  });
});

describe('cron worker: 30 minutes after vending first failed', () => {
  it('active wallet: refunds the spend to the wallet once, closes the row, tells the customer', async () => {
    wire(makeFakeSupabase({ authEmails: { [USER_ID]: EMAIL }, platformUsers: activeUser, transactions: [retryRow('tx-e')] }));
    seed(fake, 'tx-e');
    adapterSequence(['failed']);

    vi.setSystemTime(new Date(T0.getTime() + VEND_REFUND_AFTER_MS));
    const r = await runUtilityVendRetries({ limit: 10 });

    expect(r.refunded).toBe(1);
    expect(reverseKeys()).toEqual(['utility:tx-e:REVERSAL_DEBIT']);
    expect(creditWallet).not.toHaveBeenCalled();
    const row = fake.txs.get('tx-e')!;
    expect(row.status).toBe('reversed');
    expect(row.metadata.vend_retry.state).toBe('refunded');
    expect(vi.mocked(notifyUtilityCustomer)).toHaveBeenCalledWith(expect.anything(), 'refund_processed', expect.anything());
    expect(emails().some((m) => m.to === EMAIL && /refund/i.test(m.subject))).toBe(true);
  });

  it('is idempotent: a second run posts nothing more', async () => {
    wire(makeFakeSupabase({ authEmails: { [USER_ID]: EMAIL }, platformUsers: activeUser, transactions: [retryRow('tx-f')] }));
    seed(fake, 'tx-f');
    adapterSequence(['failed']);
    vi.setSystemTime(new Date(T0.getTime() + VEND_REFUND_AFTER_MS));
    await runUtilityVendRetries({ limit: 10 });
    await runUtilityVendRetries({ limit: 10 });
    expect(reverseKeys()).toHaveLength(1);
  });

  it('inactive wallet: the funds are HELD with admin, nothing is credited, and the user is emailed to activate', async () => {
    wire(makeFakeSupabase({
      authEmails: { [USER_ID]: EMAIL },
      platformUsers: { [EMAIL]: { status: 'pending', deleted_at: null } },
      transactions: [retryRow('tx-g')],
    }));
    seed(fake, 'tx-g');
    adapterSequence(['failed']);

    vi.setSystemTime(new Date(T0.getTime() + VEND_REFUND_AFTER_MS));
    const r = await runUtilityVendRetries({ limit: 10 });

    expect(r.held).toBe(1);
    expect(reverseWalletDebit).not.toHaveBeenCalled();
    expect(creditWallet).not.toHaveBeenCalled();
    const row = fake.txs.get('tx-g')!;
    expect(row.status).toBe('failed');
    expect(row.metadata.vend_retry).toMatchObject({ state: 'held' });
    expect(eventTypes()).toContain('refund_held');
    expect(vi.mocked(queueUtilityAdminAlert)).toHaveBeenCalledWith(expect.objectContaining({ audience: 'finance' }));
    const mail = emails().filter((m) => m.to === EMAIL);
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toMatch(/activate/i);
  });

  it('a held refund is not re-emailed or credited while the wallet stays inactive', async () => {
    wire(makeFakeSupabase({
      authEmails: { [USER_ID]: EMAIL },
      platformUsers: { [EMAIL]: { status: 'pending', deleted_at: null } },
      transactions: [retryRow('tx-h')],
    }));
    seed(fake, 'tx-h');
    adapterSequence(['failed']);
    vi.setSystemTime(new Date(T0.getTime() + VEND_REFUND_AFTER_MS));
    await runUtilityVendRetries({ limit: 10 });
    vi.setSystemTime(new Date(T0.getTime() + VEND_REFUND_AFTER_MS + 3 * 3_600_000));
    await runUtilityVendRetries({ limit: 10 });
    expect(emails().filter((m) => /activate/i.test(m.subject))).toHaveLength(1);
    expect(reverseWalletDebit).not.toHaveBeenCalled();
  });

  it('once the wallet becomes active the held funds are released as a refund, exactly once', async () => {
    const platformUsers: Record<string, Row> = { [EMAIL]: { status: 'pending', deleted_at: null } };
    wire(makeFakeSupabase({ authEmails: { [USER_ID]: EMAIL }, platformUsers, transactions: [retryRow('tx-i')] }));
    seed(fake, 'tx-i');
    adapterSequence(['failed']);
    vi.setSystemTime(new Date(T0.getTime() + VEND_REFUND_AFTER_MS));
    await runUtilityVendRetries({ limit: 10 });
    expect(reverseWalletDebit).not.toHaveBeenCalled();

    platformUsers[EMAIL] = { status: 'active', deleted_at: null };
    vi.setSystemTime(new Date(T0.getTime() + VEND_REFUND_AFTER_MS + 3_600_000));
    const r = await runUtilityVendRetries({ limit: 10 });
    await runUtilityVendRetries({ limit: 10 });

    expect(r.released).toBe(1);
    expect(reverseKeys()).toEqual(['utility:tx-i:REVERSAL_DEBIT']);
    expect(fake.txs.get('tx-i')!.status).toBe('reversed');
    expect(fake.txs.get('tx-i')!.metadata.vend_retry.state).toBe('refunded');
  });

  it('a suspended, locked or deleted account has no active wallet', async () => {
    for (const [i, u] of [{ status: 'suspended', deleted_at: null }, { status: 'locked', deleted_at: null }, { status: 'active', deleted_at: '2026-01-01' }].entries()) {
      vi.clearAllMocks();
      wire(makeFakeSupabase({ authEmails: { [USER_ID]: EMAIL }, platformUsers: { [EMAIL]: u }, transactions: [retryRow(`tx-n${i}`)] }));
      seed(fake, `tx-n${i}`);
      adapterSequence(['failed']);
      vi.setSystemTime(new Date(T0.getTime() + VEND_REFUND_AFTER_MS));
      await runUtilityVendRetries({ limit: 10 });
      expect(reverseWalletDebit).not.toHaveBeenCalled();
      expect(fake.txs.get(`tx-n${i}`)!.metadata.vend_retry.state).toBe('held');
    }
  });

  it('no platform_users row is treated as active (cannot prove otherwise): refunds', async () => {
    wire(makeFakeSupabase({ authEmails: { [USER_ID]: EMAIL }, platformUsers: {}, transactions: [retryRow('tx-j')] }));
    seed(fake, 'tx-j');
    adapterSequence(['failed']);
    vi.setSystemTime(new Date(T0.getTime() + VEND_REFUND_AFTER_MS));
    await runUtilityVendRetries({ limit: 10 });
    expect(reverseKeys()).toEqual(['utility:tx-j:REVERSAL_DEBIT']);
  });

  it('no spend leg posted (the charge was captured but never booked): refunds by crediting, keyed PAYSTACK_REFUND', async () => {
    wire(makeFakeSupabase({ authEmails: { [USER_ID]: EMAIL }, platformUsers: activeUser, transactions: [retryRow('tx-k')] }));
    adapterSequence(['failed']); // no ledger legs seeded
    vi.setSystemTime(new Date(T0.getTime() + VEND_REFUND_AFTER_MS));
    await runUtilityVendRetries({ limit: 10 });
    expect(creditKeys()).toEqual(['utility:tx-k:PAYSTACK_REFUND']);
    expect(reverseWalletDebit).not.toHaveBeenCalled();
  });

  it('still refunds a row already in the retry state after the flag is turned off', async () => {
    delete process.env[FLAG];
    wire(makeFakeSupabase({ authEmails: { [USER_ID]: EMAIL }, platformUsers: activeUser, transactions: [retryRow('tx-l')] }));
    seed(fake, 'tx-l');
    adapterSequence(['failed']);
    vi.setSystemTime(new Date(T0.getTime() + VEND_REFUND_AFTER_MS));
    await runUtilityVendRetries({ limit: 10 });
    expect(reverseKeys()).toEqual(['utility:tx-l:REVERSAL_DEBIT']);
  });
});

describe('cron worker: never refund or retry a vend that may have happened', () => {
  it('an ambiguous provider attempt sends the row to manual review — no retry, no refund', async () => {
    wire(makeFakeSupabase({
      authEmails: { [USER_ID]: EMAIL }, platformUsers: activeUser, transactions: [retryRow('tx-m')],
      attempts: [{ transaction_id: 'tx-m', status: 'timeout' }],
    }));
    seed(fake, 'tx-m');
    const purchase = adapterSequence(['successful']);
    vi.setSystemTime(new Date(T0.getTime() + VEND_REFUND_AFTER_MS * 2));
    const r = await runUtilityVendRetries({ limit: 10 });

    expect(r.manualReview).toBe(1);
    expect(purchase).not.toHaveBeenCalled();
    expect(reverseWalletDebit).not.toHaveBeenCalled();
    expect(creditWallet).not.toHaveBeenCalled();
    expect(fake.txs.get('tx-m')!.metadata.vend_retry.state).toBe('manual_review');
    expect(vi.mocked(queueUtilityAdminAlert)).toHaveBeenCalledWith(expect.objectContaining({ audience: 'support' }));
  });

  it('a row another worker already claimed is skipped (CAS), not double-processed', async () => {
    wire(makeFakeSupabase({ authEmails: { [USER_ID]: EMAIL }, platformUsers: activeUser, transactions: [retryRow('tx-o')] }));
    seed(fake, 'tx-o');
    adapterSequence(['failed']);
    vi.setSystemTime(new Date(T0.getTime() + VEND_REFUND_AFTER_MS));
    // Another worker bumps the version between this worker's read and its claim.
    const realFrom = fake.from;
    let bumped = false;
    (fake as any).from = vi.fn((t: string) => {
      const b = realFrom(t);
      if (t === 'utility_transactions' && !bumped) {
        const realUpdate = b.update;
        b.update = vi.fn((p: any) => {
          if (!bumped) { bumped = true; fake.txs.set('tx-o', { ...fake.txs.get('tx-o')!, updated_at: '2099-01-01T00:00:00.000Z' }); }
          return realUpdate(p);
        });
      }
      return b;
    });
    await runUtilityVendRetries({ limit: 10 });
    expect(reverseWalletDebit).not.toHaveBeenCalled();
  });
});

describe('stuck-sweeper recovery enters the same retry window instead of auto-refunding', () => {
  const stuck = (id: string, status: string): Row => ({
    id, user_id: USER_ID, payment_source: 'paystack', status, retail_amount_kobo: 500_000,
    receipt_number: `R-${id}`, category: 'airtime', idempotency_key: `k-${id}`,
    biller_id: BILLER.id, product_id: PRODUCT.id, customer_reference: '+2348011111111',
    metadata: { payment_reference: 'UTIL_PAY_REF_1' },
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  });

  it('collect + spend posted, no vend recorded: retry window opens, no credit', async () => {
    const f = makeFakeSupabase({ transactions: [stuck('tx-s1', 'wallet_debited')] });
    wire(f); seed(f, 'tx-s1');
    await requeryUtilityTransaction(f.txs.get('tx-s1') as any);
    expect(creditWallet).not.toHaveBeenCalled();
    expect(f.txs.get('tx-s1')!.status).toBe('failed');
    expect(f.txs.get('tx-s1')!.metadata.vend_retry).toMatchObject({ state: 'retrying', basis: 'stuck_recovery' });
  });

  it('nothing posted but the card was charged: retry window opens, no credit yet', async () => {
    const f = makeFakeSupabase({ transactions: [stuck('tx-s2', 'initiated')] });
    wire(f);
    await requeryUtilityTransaction(f.txs.get('tx-s2') as any);
    expect(creditWallet).not.toHaveBeenCalled();
    expect(f.txs.get('tx-s2')!.metadata.vend_retry?.state).toBe('retrying');
  });

  it('collect posted, spend never did: the customer already holds the money — retained, no retry window', async () => {
    const f = makeFakeSupabase({ transactions: [stuck('tx-s3', 'initiated')] });
    wire(f); seed(f, 'tx-s3', ['COLLECT']);
    await requeryUtilityTransaction(f.txs.get('tx-s3') as any);
    expect(creditWallet).not.toHaveBeenCalled();
    expect(eventTypes()).toContain('paystack_collected_funds_retained');
    expect(f.txs.get('tx-s3')!.metadata.vend_retry).toBeUndefined();
  });
});

describe('admin can still settle a retrying row by hand, exactly once', () => {
  it('manual reversal credits once and closes the retry state; a second one moves no money', async () => {
    wire(makeFakeSupabase({ transactions: [retryRow('tx-p')] }));
    seed(fake, 'tx-p');
    vi.setSystemTime(new Date(T0.getTime() + 2 * 60_000));
    const approved = await reverseUtilityTransaction(fake.txs.get('tx-p') as any, 'Support override');
    expect(creditKeys()).toEqual(['utility:tx-p:ADMIN_REVERSAL_PAYSTACK_REFUND']);
    expect(approved.status).toBe('reversed');
    expect(fake.txs.get('tx-p')!.metadata.vend_retry.state).toBe('refunded');
    const before = vi.mocked(creditWallet).mock.calls.length;
    await expect(reverseUtilityTransaction(fake.txs.get('tx-p') as any, 'again')).rejects.toThrow();
    expect(vi.mocked(creditWallet).mock.calls.length).toBe(before);
  });
});

describe('ADR-PR697 race: the writer can never spend after losing the row', () => {
  const claimAt = (at: string): EventHook => (eventType, txs) => {
    if (eventType !== at) return;
    for (const [id, row] of txs) {
      txs.set(id, { ...row, status: 'failed', failure_reason: 'swept', updated_at: new Date(Date.now() + 5).toISOString() });
    }
  };

  it('claimed BEFORE the collect: the writer posts nothing at all (no 2x)', async () => {
    wire(makeFakeSupabase({ onEvent: claimAt('paystack_verified') }));
    adapterSequence(['successful']);
    await payUtility(USER_ID, input('idem-race-1'));
    expect(creditWallet).not.toHaveBeenCalled();
    expect(debitWallet).not.toHaveBeenCalled();
    expect(eventTypes()).toContain('writer_outraced');
  });

  it('claimed BETWEEN collect and spend: the collect stands, the late spend is refused (no 0x)', async () => {
    wire(makeFakeSupabase({ onEvent: claimAt('card_collected') }));
    adapterSequence(['successful']);
    await payUtility(USER_ID, input('idem-race-2'));
    expect(creditKeys()).toHaveLength(1);
    expect(creditKeys()[0]).toMatch(/:CARD_COLLECT$/);
    expect(debitWallet).not.toHaveBeenCalled();
    expect(eventTypes()).toContain('writer_outraced');
  });

  it('stalled past the safe age after the collect: the writer yields instead of spending', async () => {
    wire(makeFakeSupabase({
      onEvent: (eventType) => { if (eventType === 'card_collected') vi.setSystemTime(new Date(T0.getTime() + minutes(6))); },
    }));
    adapterSequence(['successful']);
    await payUtility(USER_ID, input('idem-race-3'));
    expect(creditKeys()).toHaveLength(1);
    expect(debitWallet).not.toHaveBeenCalled();
    expect(eventTypes()).toContain('writer_stale_yield');
  });

  it('collect posts then the spend is refused: the row is settled NOW, not left initiated for the sweeper', async () => {
    wire(makeFakeSupabase());
    adapterSequence(['successful']);
    vi.mocked(debitWallet).mockRejectedValue(new Error('Daily limit exceeded.'));
    await expect(payUtility(USER_ID, input('idem-race-4'))).rejects.toThrow();
    const row = [...fake.txs.values()][0];
    expect(creditKeys()).toHaveLength(1);
    expect(row.status).not.toBe('initiated');
    expect(eventTypes()).toContain('paystack_collected_funds_retained');
  });

  it('the collect itself throws: the retry window opens immediately, no credit, row not left initiated', async () => {
    wire(makeFakeSupabase());
    adapterSequence(['successful']);
    vi.mocked(creditWallet).mockRejectedValue(new Error('ledger unavailable'));
    await expect(payUtility(USER_ID, input('idem-race-5'))).rejects.toThrow();
    const row = [...fake.txs.values()][0];
    expect(row.status).toBe('failed');
    expect(row.metadata?.vend_retry?.state).toBe('retrying');
    expect(debitWallet).not.toHaveBeenCalled();
  });

  it('an unraced writer still collects, spends and vends exactly once', async () => {
    wire(makeFakeSupabase());
    adapterSequence(['successful']);
    const { transaction } = await payUtility(USER_ID, input('idem-race-6'));
    expect(transaction.status).toBe('successful');
    expect(creditWallet).toHaveBeenCalledTimes(1);
    expect(debitWallet).toHaveBeenCalledTimes(1);
  });
});

describe('flag OFF keeps today\'s immediate automatic refund (nothing changes until the flag is on)', () => {
  it('failed vend auto-refunds once and closes the row', async () => {
    delete process.env[FLAG];
    wire(makeFakeSupabase());
    adapterSequence(['failed']);
    const { transaction } = await payUtility(USER_ID, input('idem-off-1'));
    expect(creditKeys()).toEqual([`utility:${transaction.id}:PAYSTACK_REFUND`]);
    expect(transaction.status).toBe('reversed');
    expect(fake.txs.get(transaction.id)!.metadata?.vend_retry).toBeUndefined();
  });
});
