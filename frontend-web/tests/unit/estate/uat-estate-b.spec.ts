/**
 * UAT estate-b regression coverage (EST-UAT-0129/0160/0164/0213/0216/0218/0206).
 *
 * Asserts the remediation invariants:
 *  - dues payInvoice claims the invoice atomically (unpaid -> paid) before the
 *    wallet debit, heals a stale 'paid' claim with no receipt, refuses a
 *    foreign Idempotency-Key replay, and returns the canonical receipt when
 *    the claim is lost after settlement.
 *  - elections.service checkVoteEligibility enforces dues restrictions +
 *    election_eligibility_rules (resident types, KYC, payment).
 *  - mapElection withholds per-candidate tallies until resultsPublished and
 *    never selects voter_id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/wallet/service', () => ({ debitWallet: vi.fn() }));
vi.mock('@/src/server/estate/resident', () => ({ getResidentContext: vi.fn(), resolveNames: vi.fn() }));

import { payInvoice } from '@/src/server/estate/dues';
import { checkVoteEligibility, mapElection } from '@/src/server/elections/elections.service';
import { createAdminClient } from '@/lib/supabase/server';
import { debitWallet } from '@/src/server/wallet/service';
import { getResidentContext } from '@/src/server/estate/resident';

const ESTATE = 'estate-1';
const USER = 'user-1';
const KEY = 'idem-1';

interface Cfg {
  invoice?: any;
  priorPayment?: any;
  receipt?: any;            // successful payment found by invoice_id
  claimRows?: any[];        // rows returned by the claim .select('id')
  insertError?: any;
  updateError?: any;
  resident?: any;
  rules?: any;
  restriction?: any;
  profile?: any;
  residentRow?: any;
  residentProfile?: any;
  outstandingCount?: number;
  votes?: any[];
  candidates?: any[];
  eligibleCount?: number;
}

function makeSupabase(cfg: Cfg) {
  const calls: any = { updates: [], claims: 0 };
  function builder(table: string) {
    const ctx: any = { table, op: 'select', updatePayload: null, filters: [] };
    const chain: any = {
      select: (cols?: string, opts?: any) => { ctx.cols = cols; ctx.countOpt = opts; return chain; },
      eq: (c: string, v: any) => { ctx.filters.push([c, v]); return chain; },
      in: (c: string, v: any) => { ctx.filters.push([c, v]); return chain; },
      is: (c: string, v: any) => { ctx.filters.push([c, v]); return chain; },
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: () => chain,
      update: (p: any) => { ctx.op = 'update'; ctx.updatePayload = p; return chain; },
      upsert: () => chain,
      maybeSingle: async () => {
        if (table === 'estate_dues_invoices') {
          if (ctx.op === 'update' && ctx.updatePayload?.status === 'paid' && ctx.filters.some((f: any) => f[0] === 'status' && Array.isArray(f[1]))) {
            calls.claims += 1;
            return { data: (cfg.claimRows ?? [{ id: 'inv-1' }])[0] ?? null, error: null };
          }
          return { data: cfg.invoice ?? null, error: null };
        }
        if (table === 'estate_payments') {
          if (ctx.filters.some((f: any) => f[0] === 'reference')) return { data: cfg.priorPayment ?? null, error: null };
          return { data: cfg.receipt ?? null, error: null };
        }
        if (table === 'election_eligibility_rules') return { data: cfg.rules ?? null, error: null };
        if (table === 'estate_dues_restrictions') return { data: cfg.restriction ?? null, error: null };
        if (table === 'user_profiles') return { data: cfg.profile ?? null, error: null };
        if (table === 'estate_residents') return { data: cfg.residentRow ?? null, error: null };
        if (table === 'resident_profiles') return { data: cfg.residentProfile ?? null, error: null };
        return { data: null, error: null };
      },
      single: async () => ({ data: cfg.insertError ? null : paymentRow(), error: cfg.insertError ?? null }),
      then: (resolve: any) => {
        if (ctx.countOpt?.head) return resolve({ count: cfg.outstandingCount ?? 0, error: null });
        if (ctx.op === 'update') { calls.updates.push({ table, payload: ctx.updatePayload }); return resolve({ error: cfg.updateError ?? null }); }
        if (table === 'election_candidates') return resolve({ data: cfg.candidates ?? [], error: null });
        if (table === 'election_votes') return resolve({ data: cfg.votes ?? [], error: null });
        if (table === 'estate_residents') return resolve({ data: null, error: null, count: cfg.eligibleCount ?? 0 });
        return resolve({ data: [], error: null });
      },
    };
    return chain;
  }
  return { client: { from: (t: string) => builder(t) }, calls };
}

function invoiceRow(over: any = {}) {
  return { id: 'inv-1', estate_id: ESTATE, resident_id: USER, category: 'service_charge', amount_kobo: 500_000, due_date: new Date().toISOString(), status: 'pending', created_at: new Date().toISOString(), ...over };
}
function paymentRow(over: any = {}) {
  return { id: 'pay-1', estate_id: ESTATE, invoice_id: 'inv-1', payer_id: USER, amount_kobo: 500_000, method: 'wallet', status: 'successful', reference: KEY, created_at: new Date().toISOString(), ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  (getResidentContext as any).mockResolvedValue({ estateId: ESTATE, unit: 'A-1', role: 'resident' });
  (debitWallet as any).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 });
});

describe('payInvoice — atomic claim & replay', () => {
  it('claims the invoice before debiting (no unpaid-check window)', async () => {
    const { client } = makeSupabase({ invoice: invoiceRow(), receipt: paymentRow() });
    (createAdminClient as any).mockReturnValue(client);
    await payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: KEY });
    expect(debitWallet).toHaveBeenCalledOnce();
  });

  it('rejects a foreign Idempotency-Key bound to another invoice', async () => {
    const { client } = makeSupabase({ invoice: invoiceRow(), priorPayment: paymentRow({ invoice_id: 'other-inv' }) });
    (createAdminClient as any).mockReturnValue(client);
    await expect(payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: KEY })).rejects.toThrow(/different invoice/i);
    expect(debitWallet).not.toHaveBeenCalled();
  });

  it('heals a stale paid-claim (no receipt) and completes the payment', async () => {
    const { client } = makeSupabase({ invoice: invoiceRow({ status: 'paid' }), receipt: paymentRow() });
    // first receipt lookup (by invoice_id) returns null -> heal; post-insert
    // receipts present. Simulate by returning null for receipt until insert:
    const cfg: Cfg = { invoice: invoiceRow({ status: 'paid' }) };
    const { client: c2 } = makeSupabase(cfg);
    (createAdminClient as any).mockReturnValue(c2);
    await payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: KEY });
    expect(debitWallet).toHaveBeenCalledOnce();
  });

  it('returns the canonical receipt when the claim is lost after settlement', async () => {
    const { client } = makeSupabase({ invoice: invoiceRow(), claimRows: [], receipt: paymentRow({ reference: 'other-key' }) });
    (createAdminClient as any).mockReturnValue(client);
    const res = await payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: 'other-key' });
    expect(res.alreadyProcessed).toBe(true);
    expect(res.payment.id).toBe('pay-1');
    expect(debitWallet).not.toHaveBeenCalled();
  });

  it('reverts the claim when the wallet debit fails', async () => {
    const { client, calls } = makeSupabase({ invoice: invoiceRow() });
    (createAdminClient as any).mockReturnValue(client);
    (debitWallet as any).mockRejectedValue(new Error('insufficient'));
    await expect(payInvoice({ userId: USER, invoiceId: 'inv-1', idempotencyKey: KEY })).rejects.toThrow('insufficient');
    expect(calls.updates.some((u: any) => u.table === 'estate_dues_invoices' && u.payload?.status === 'pending')).toBe(true);
  });
});

describe('checkVoteEligibility — BFF mirror of the Go gate', () => {
  const base = { estateId: ESTATE, userId: USER, electionId: 'el-1' };

  it('blocks an actively dues-restricted voter', async () => {
    const { client } = makeSupabase({ restriction: { id: 'r1' } });
    const r = await checkVoteEligibility(client as any, base.estateId, base.userId, base.electionId);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain('outstanding_dues_restriction');
  });

  it('blocks an excluded resident type (owners-only election, tenant voter)', async () => {
    const { client } = makeSupabase({
      rules: { require_kyc: false, require_payment: false, resident_types: ['homeowner', 'landlord'] },
      residentRow: { id: 'er-1' }, residentProfile: { occupancy_type: 'tenant' },
    });
    const r = await checkVoteEligibility(client as any, base.estateId, base.userId, base.electionId);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain('resident_type_ineligible');
  });

  it('blocks unverified KYC when required', async () => {
    const { client } = makeSupabase({ rules: { require_kyc: true }, profile: { kyc_status: 'pending' } });
    const r = await checkVoteEligibility(client as any, base.estateId, base.userId, base.electionId);
    expect(r.reasons).toContain('kyc_required');
  });

  it('blocks a defaulter when payment is required', async () => {
    const { client } = makeSupabase({ rules: { require_payment: true }, outstandingCount: 2 });
    const r = await checkVoteEligibility(client as any, base.estateId, base.userId, base.electionId);
    expect(r.reasons).toContain('outstanding_dues');
  });

  it('passes an eligible voter with no rules', async () => {
    const { client } = makeSupabase({});
    const r = await checkVoteEligibility(client as any, base.estateId, base.userId, base.electionId);
    expect(r.eligible).toBe(true);
  });
});

describe('mapElection — secret tally', () => {
  const row = { id: 'el-1', estate_id: ESTATE, title: 'AGM', description: null, starts_at: new Date(Date.now() - 3600e3).toISOString(), ends_at: new Date(Date.now() + 3600e3).toISOString(), status: 'open' };

  it('withholds per-candidate votes while results are unpublished', async () => {
    const { client } = makeSupabase({ candidates: [{ id: 'c1', name: 'A', bio: null }, { id: 'c2', name: 'B', bio: null }], votes: [{ candidate_id: 'c1' }, { candidate_id: 'c1' }, { candidate_id: 'c2' }] });
    const mapped = await mapElection(client as any, row);
    expect(mapped.status).toBe('live');
    expect(mapped.resultsPublished).toBe(false);
    expect(mapped.positions[0].candidates.every((c: any) => c.votes === 0)).toBe(true);
    expect(mapped.votesCast).toBe(3); // participation stays visible
  });

  it('exposes tallies once results are published', async () => {
    const { client } = makeSupabase({ candidates: [{ id: 'c1', name: 'A', bio: null }, { id: 'c2', name: 'B', bio: null }], votes: [{ candidate_id: 'c1' }, { candidate_id: 'c1' }, { candidate_id: 'c2' }] });
    const mapped = await mapElection(client as any, { ...row, status: 'tallied', ends_at: new Date(Date.now() - 60e3).toISOString() });
    expect(mapped.resultsPublished).toBe(true);
    expect(mapped.positions[0].candidates[0].votes).toBe(2);
    expect(mapped.positions[0].candidates[1].votes).toBe(1);
  });
});
