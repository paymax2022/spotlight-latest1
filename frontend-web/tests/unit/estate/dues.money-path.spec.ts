/**
 * Dues money-path invariant tests (Block 47b).
 *
 * Exercises src/server/estate/dues.ts#payInvoice against the CLAUDE.md iron
 * rules. The wallet ledger primitive (debitWallet) and the resident-context
 * helper are mocked at their module boundary — these tests assert the dues
 * service's own contract (idempotency, authorization, kobo validation,
 * no-clobber recording, error surfacing), NOT the ledger internals (those are
 * covered by tests/unit/wallet/*).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/wallet/service', () => ({ debitWallet: vi.fn() }));
vi.mock('@/src/server/estate/resident', () => ({ getResidentContext: vi.fn(), resolveNames: vi.fn() }));

import { payInvoice } from '@/src/server/estate/dues';
import { createAdminClient } from '@/lib/supabase/server';
import { debitWallet } from '@/src/server/wallet/service';
import { getResidentContext } from '@/src/server/estate/resident';

const ESTATE = 'estate-1';
const USER = 'user-1';
const KEY = 'idem-key-abc';

// ---------------------------------------------------------------------------
// A minimal per-table Supabase stub. select()/eq()/is() chain; the dues service
// terminates selects with maybeSingle()/single() and awaits update().eq()
// directly, so the chain is also thenable (resolves the update result).
// ---------------------------------------------------------------------------
interface Cfg {
  invoice: any;
  priorPayment?: any;          // returned by estate_payments .maybeSingle()
  upsertResult?: any;          // returned by estate_payments upsert().single()
  updateError?: any;           // error returned when awaiting invoice update().eq()
}
function makeSupabase(cfg: Cfg) {
  const calls: any = { upsertPayload: null, upsertConflict: null, updatePayload: null, updatedTable: null };
  function builder(table: string) {
    const ctx = { table, op: 'select' as 'select' | 'upsert' | 'update' };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      upsert: (payload: any, opts: any) => { ctx.op = 'upsert'; calls.upsertPayload = payload; calls.upsertConflict = opts?.onConflict; return chain; },
      update: (payload: any) => { ctx.op = 'update'; calls.updatePayload = payload; calls.updatedTable = table; return chain; },
      maybeSingle: async () => {
        if (table === 'estate_dues_invoices') return { data: cfg.invoice, error: null };
        if (table === 'estate_payments') return { data: cfg.priorPayment ?? null, error: null };
        return { data: null, error: null };
      },
      single: async () => {
        if (table === 'estate_payments' && ctx.op === 'upsert') return { data: cfg.upsertResult ?? null, error: null };
        return { data: null, error: null };
      },
      // Make the chain awaitable for `await supabase.from(t).update(..).eq(..)`.
      then: (resolve: any) => resolve({ error: ctx.op === 'update' ? (cfg.updateError ?? null) : null, data: null }),
    };
    return chain;
  }
  return { client: { from: (t: string) => builder(t) }, calls };
}

function invoiceRow(over: Partial<Record<string, any>> = {}) {
  return { id: 'inv-1', estate_id: ESTATE, resident_id: USER, category: 'service_charge', amount_kobo: 7_500_000, due_date: new Date().toISOString(), status: 'pending', created_at: new Date().toISOString(), ...over };
}
function paymentRow(over: Partial<Record<string, any>> = {}) {
  return { id: 'pay-1', estate_id: ESTATE, invoice_id: 'inv-1', payer_id: USER, amount_kobo: 7_500_000, method: 'wallet', status: 'successful', reference: KEY, created_at: new Date().toISOString(), ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getResidentContext).mockResolvedValue({ estateId: ESTATE, unit: 'A1', role: 'resident' } as any);
});

describe('payInvoice — idempotency-key', () => {
  it('throws 400 when the key is empty', async () => {
    await expect(payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: '' }))
      .rejects.toMatchObject({ status: 400 });
    expect(debitWallet).not.toHaveBeenCalled();
  });
});

describe('payInvoice — authorization', () => {
  it('returns 403 when the user is not a resident', async () => {
    vi.mocked(getResidentContext).mockResolvedValue(null as any);
    const { client } = makeSupabase({ invoice: invoiceRow() });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    await expect(payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: KEY })).rejects.toMatchObject({ status: 403 });
  });

  it('returns 404 for an invoice belonging to another estate', async () => {
    const { client } = makeSupabase({ invoice: invoiceRow({ estate_id: 'other-estate' }) });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    await expect(payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: KEY })).rejects.toMatchObject({ status: 404 });
    expect(debitWallet).not.toHaveBeenCalled();
  });

  it('returns 404 for an invoice belonging to another resident', async () => {
    const { client } = makeSupabase({ invoice: invoiceRow({ resident_id: 'someone-else' }) });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    await expect(payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: KEY })).rejects.toMatchObject({ status: 404 });
    expect(debitWallet).not.toHaveBeenCalled();
  });
});

describe('payInvoice — kobo validation', () => {
  it('rejects a non-positive amount with 422', async () => {
    const { client } = makeSupabase({ invoice: invoiceRow({ amount_kobo: 0 }) });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    await expect(payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: KEY })).rejects.toMatchObject({ status: 422 });
    expect(debitWallet).not.toHaveBeenCalled();
  });

  it('rejects a non-integer amount with 422', async () => {
    const { client } = makeSupabase({ invoice: invoiceRow({ amount_kobo: 100.5 }) });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    await expect(payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: KEY })).rejects.toMatchObject({ status: 422 });
  });
});

describe('payInvoice — status guards', () => {
  it('rejects an already-paid invoice with 409', async () => {
    const { client } = makeSupabase({ invoice: invoiceRow({ status: 'paid' }), priorPayment: null });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    await expect(payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: KEY })).rejects.toMatchObject({ status: 409 });
    expect(debitWallet).not.toHaveBeenCalled();
  });
});

describe('payInvoice — happy path', () => {
  it('debits the wallet exactly once with kobo + idempotency key and records the payment', async () => {
    const { client, calls } = makeSupabase({ invoice: invoiceRow(), priorPayment: null, upsertResult: paymentRow() });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    vi.mocked(debitWallet).mockResolvedValue({ alreadyProcessed: false, amountKobo: 7_500_000 } as any);

    const res = await payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: KEY });

    expect(debitWallet).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(debitWallet).mock.calls[0][1] as any;
    expect(arg.amountKobo).toBe(7_500_000);
    expect(Number.isInteger(arg.amountKobo)).toBe(true);
    expect(arg.reference).toBe(KEY);
    expect(arg.idempotencyKey).toBe(KEY);
    expect(arg.metadata).toMatchObject({ kind: 'estate_dues', estate_id: ESTATE, invoice_id: 'inv-1', payer_id: USER });

    // Payment recorded idempotently (upsert on the unique reference) + invoice paid.
    expect(calls.upsertConflict).toBe('reference');
    expect(calls.upsertPayload).toMatchObject({ status: 'successful', method: 'wallet', amount_kobo: 7_500_000, reference: KEY });
    expect(calls.updatedTable).toBe('estate_dues_invoices');
    expect(calls.updatePayload).toMatchObject({ status: 'paid' });
    expect(res.invoice.status).toBe('paid');
    expect(res.alreadyProcessed).toBe(false);
  });
});

describe('payInvoice — idempotent replay (no double-charge)', () => {
  it('returns the prior payment WITHOUT debiting again when the key was already used', async () => {
    const { client, calls } = makeSupabase({ invoice: invoiceRow(), priorPayment: paymentRow() });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: KEY });

    expect(debitWallet).not.toHaveBeenCalled();      // no second debit
    expect(calls.upsertPayload).toBeNull();          // no duplicate payment row
    expect(res.alreadyProcessed).toBe(true);
    expect(res.payment.id).toBe('pay-1');
  });

  it('reconciles when the wallet was already debited but no payment row was written', async () => {
    // Fast-path finds no prior payment; debit reports alreadyProcessed (ledger UNIQUE);
    // re-check still finds none → upsert recreates the payment row (no second debit).
    const { client, calls } = makeSupabase({ invoice: invoiceRow(), priorPayment: null, upsertResult: paymentRow() });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    vi.mocked(debitWallet).mockResolvedValue({ alreadyProcessed: true, amountKobo: 7_500_000 } as any);

    const res = await payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: KEY });

    expect(debitWallet).toHaveBeenCalledTimes(1);
    expect(calls.upsertConflict).toBe('reference');  // idempotent insert
    expect(res.alreadyProcessed).toBe(true);
  });
});

describe('payInvoice — error surfacing (no silent divergence)', () => {
  it('throws 500 when the invoice-status update fails (not fire-and-forget)', async () => {
    const { client } = makeSupabase({ invoice: invoiceRow(), priorPayment: null, upsertResult: paymentRow(), updateError: { message: 'db down' } });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    vi.mocked(debitWallet).mockResolvedValue({ alreadyProcessed: false, amountKobo: 7_500_000 } as any);

    await expect(payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: KEY })).rejects.toMatchObject({ status: 500 });
  });
});
