/**
 * Realtor lease-invoice money-path invariant tests.
 *
 * Regression coverage for the Blocker-severity fix: `realtor_pay_invoice`
 * (Supabase RPC) used to be called directly by the mobile client and would
 * finalize a lease payment (mark invoice paid, activate lease, create escrow
 * deposit) with ZERO verification that any money moved.
 *
 * These tests exercise src/server/realtor/invoices.ts#payInvoice against the
 * CLAUDE.md iron rules, mirroring tests/unit/estate/dues.money-path.spec.ts.
 * `debitWallet` is mocked at its module boundary — these tests assert the
 * realtor invoices service's own contract (idempotency, authorization, kobo
 * validation, channel gating, no-clobber recording), NOT the ledger internals
 * (covered by tests/unit/wallet/*) and NOT the SQL RPC's own defenses
 * (covered by the live-DB proof script — see docs/qa/modules/realtor.md).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/wallet/service', () => ({ debitWallet: vi.fn() }));

import { payInvoice } from '@/src/server/realtor/invoices';
import { createAdminClient } from '@/lib/supabase/server';
import { debitWallet } from '@/src/server/wallet/service';

const USER = 'tenant-1';
const OTHER_USER = 'someone-else';
const LEASE = 'lease-1';
const INVOICE = 'inv-1';
const KEY = 'idem-key-abc';

interface Cfg {
  invoice: any;
  lease: any;
  priorPayment?: any;         // returned by realtor_payments .maybeSingle() (fast-path + post-finalize refetch)
  rpcResult?: any;            // returned by supabase.rpc('realtor_pay_invoice', …)
  rpcError?: any;
  postFinalizePayment?: any;  // payment row AFTER a successful rpc call (defaults to rpcResult shape)
  postFinalizeInvoice?: any;  // invoice row AFTER a successful rpc call
}

function makeSupabase(cfg: Cfg) {
  const rpcCalls: any[] = [];
  let paymentLookupCount = 0;
  let invoiceLookupCount = 0;

  function builder(table: string) {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => {
        if (table === 'realtor_payments') {
          paymentLookupCount += 1;
          // First lookup = idempotent fast-path (before any debit/rpc).
          if (paymentLookupCount === 1) return { data: cfg.priorPayment ?? null, error: null };
          // Subsequent lookup(s) = post-finalize refetch.
          return { data: cfg.postFinalizePayment ?? cfg.priorPayment ?? null, error: null };
        }
        if (table === 'realtor_invoices') {
          invoiceLookupCount += 1;
          // First lookup = the authorization/amount load (before any debit/rpc).
          if (invoiceLookupCount === 1) return { data: cfg.invoice, error: null };
          // Subsequent lookup(s) = post-finalize refetch.
          return { data: cfg.postFinalizeInvoice ?? cfg.invoice, error: null };
        }
        if (table === 'realtor_leases') return { data: cfg.lease, error: null };
        return { data: null, error: null };
      },
    };
    return chain;
  }

  const client = {
    from: (t: string) => builder(t),
    rpc: async (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      if (cfg.rpcError) return { data: null, error: cfg.rpcError };
      return { data: cfg.rpcResult ?? paymentRow(), error: null };
    },
  };
  return { client, rpcCalls };
}

function invoiceRow(over: Partial<Record<string, any>> = {}) {
  return { id: INVOICE, lease_id: LEASE, status: 'pending', lines: [{ label: 'Annual rent', amount_kobo: 6_500_000_00 }, { label: 'Caution deposit', amount_kobo: 650_000_00, refundable: true }], total_kobo: 7_150_000_00, due_date: null, paid_at: null, created_at: new Date().toISOString(), ...over };
}
function leaseRow(over: Partial<Record<string, any>> = {}) {
  return { id: LEASE, tenant_id: USER, listing_id: 'ls-1', status: 'signed', ...over };
}
function paymentRow(over: Partial<Record<string, any>> = {}) {
  return { id: 'pay-1', invoice_id: INVOICE, user_id: USER, channel: 'WALLET', amount_kobo: 7_150_000_00, escrow_held_kobo: 650_000_00, status: 'paid', reference: 'REF123', idempotency_key: KEY, paid_at: new Date().toISOString(), ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('payInvoice — idempotency-key', () => {
  it('throws 400 when the key is empty', async () => {
    await expect(payInvoice({ userId: USER, invoiceId: INVOICE, channel: 'WALLET', idempotencyKey: '' }))
      .rejects.toMatchObject({ status: 400 });
    expect(debitWallet).not.toHaveBeenCalled();
  });
});

describe('payInvoice — authorization', () => {
  it('returns 404 for an invoice whose lease belongs to another tenant', async () => {
    const { client } = makeSupabase({ invoice: invoiceRow(), lease: leaseRow({ tenant_id: OTHER_USER }) });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    await expect(payInvoice({ userId: USER, invoiceId: INVOICE, channel: 'WALLET', idempotencyKey: KEY }))
      .rejects.toMatchObject({ status: 404 });
    expect(debitWallet).not.toHaveBeenCalled();
  });

  it('returns 404 when the invoice does not exist', async () => {
    const { client } = makeSupabase({ invoice: null, lease: leaseRow() });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    await expect(payInvoice({ userId: USER, invoiceId: INVOICE, channel: 'WALLET', idempotencyKey: KEY }))
      .rejects.toMatchObject({ status: 404 });
    expect(debitWallet).not.toHaveBeenCalled();
  });
});

describe('payInvoice — kobo validation', () => {
  it('rejects a non-positive amount with 422', async () => {
    const { client } = makeSupabase({ invoice: invoiceRow({ total_kobo: 0 }), lease: leaseRow() });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    await expect(payInvoice({ userId: USER, invoiceId: INVOICE, channel: 'WALLET', idempotencyKey: KEY }))
      .rejects.toMatchObject({ status: 422 });
    expect(debitWallet).not.toHaveBeenCalled();
  });

  it('rejects a non-integer amount with 422', async () => {
    const { client } = makeSupabase({ invoice: invoiceRow({ total_kobo: 100.5 }), lease: leaseRow() });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    await expect(payInvoice({ userId: USER, invoiceId: INVOICE, channel: 'WALLET', idempotencyKey: KEY }))
      .rejects.toMatchObject({ status: 422 });
  });
});

describe('payInvoice — status guards', () => {
  it('rejects an already-paid invoice with 409', async () => {
    const { client } = makeSupabase({ invoice: invoiceRow({ status: 'paid' }), lease: leaseRow(), priorPayment: null });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    await expect(payInvoice({ userId: USER, invoiceId: INVOICE, channel: 'WALLET', idempotencyKey: KEY }))
      .rejects.toMatchObject({ status: 409 });
    expect(debitWallet).not.toHaveBeenCalled();
  });
});

describe('payInvoice — unsupported channel (PAYSTACK)', () => {
  it('refuses with 501 and never touches the wallet or the RPC', async () => {
    const { client, rpcCalls } = makeSupabase({ invoice: invoiceRow(), lease: leaseRow(), priorPayment: null });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    await expect(payInvoice({ userId: USER, invoiceId: INVOICE, channel: 'PAYSTACK', idempotencyKey: KEY }))
      .rejects.toMatchObject({ status: 501 });
    expect(debitWallet).not.toHaveBeenCalled();
    expect(rpcCalls.length).toBe(0);
  });
});

describe('payInvoice — happy path (WALLET)', () => {
  it('debits the wallet exactly once with kobo + idempotency key, then finalizes via the hardened RPC', async () => {
    const { client, rpcCalls } = makeSupabase({
      invoice: invoiceRow(), lease: leaseRow(), priorPayment: null,
      rpcResult: paymentRow(), postFinalizePayment: paymentRow(), postFinalizeInvoice: invoiceRow({ status: 'paid' }),
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    vi.mocked(debitWallet).mockResolvedValue({ alreadyProcessed: false, amountKobo: 7_150_000_00 } as any);

    const res = await payInvoice({ userId: USER, invoiceId: INVOICE, channel: 'WALLET', idempotencyKey: KEY });

    expect(debitWallet).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(debitWallet).mock.calls[0][1] as any;
    expect(arg.amountKobo).toBe(7_150_000_00);
    expect(Number.isInteger(arg.amountKobo)).toBe(true);
    expect(arg.reference).toBe(KEY);
    expect(arg.idempotencyKey).toBe(KEY);
    expect(arg.metadata).toMatchObject({ kind: 'realtor_invoice', invoice_id: INVOICE, lease_id: LEASE, payer_id: USER });

    // Finalization only happens AFTER the debit, via the hardened RPC — never
    // a direct table mutation of invoice/lease/escrow.
    expect(rpcCalls.length).toBe(1);
    expect(rpcCalls[0].fn).toBe('realtor_pay_invoice');
    expect(rpcCalls[0].args).toMatchObject({ p_invoice_id: INVOICE, p_channel: 'WALLET', p_idempotency_key: KEY, p_user_id: USER });

    expect(res.invoice.status).toBe('paid');
    expect(res.alreadyProcessed).toBe(false);
  });

  it('surfaces a loud 500 if the RPC finalization fails after a successful debit (no silent divergence)', async () => {
    const { client } = makeSupabase({
      invoice: invoiceRow(), lease: leaseRow(), priorPayment: null,
      rpcError: { message: 'payment_not_verified: no matching wallet debit found for idempotency key idem-key-abc' },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    vi.mocked(debitWallet).mockResolvedValue({ alreadyProcessed: false, amountKobo: 7_150_000_00 } as any);

    await expect(payInvoice({ userId: USER, invoiceId: INVOICE, channel: 'WALLET', idempotencyKey: KEY }))
      .rejects.toMatchObject({ status: 500 });
  });
});

describe('payInvoice — idempotent replay (no double-charge)', () => {
  it('returns the prior payment WITHOUT debiting again when the key was already used', async () => {
    const { client, rpcCalls } = makeSupabase({ invoice: invoiceRow({ status: 'paid' }), lease: leaseRow(), priorPayment: paymentRow() });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await payInvoice({ userId: USER, invoiceId: INVOICE, channel: 'WALLET', idempotencyKey: KEY });

    expect(debitWallet).not.toHaveBeenCalled();
    expect(rpcCalls.length).toBe(0); // no second finalization call either
    expect(res.alreadyProcessed).toBe(true);
    expect(res.payment.id).toBe('pay-1');
  });

  it('propagates alreadyProcessed=true when the ledger reports a duplicate debit but still finalizes idempotently', async () => {
    const { client } = makeSupabase({
      invoice: invoiceRow(), lease: leaseRow(), priorPayment: null,
      rpcResult: paymentRow(), postFinalizePayment: paymentRow(),
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    vi.mocked(debitWallet).mockResolvedValue({ alreadyProcessed: true, amountKobo: 7_150_000_00 } as any);

    const res = await payInvoice({ userId: USER, invoiceId: INVOICE, channel: 'WALLET', idempotencyKey: KEY });

    expect(debitWallet).toHaveBeenCalledTimes(1);
    expect(res.alreadyProcessed).toBe(true);
  });
});
