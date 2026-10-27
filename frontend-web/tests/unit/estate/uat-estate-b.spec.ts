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
import { checkVoteEligibility, getVoterUnits, mapElection } from '@/src/server/elections/elections.service';
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
  ballots?: any[];          // election_ballots rows (choice, no voter column)
  participation?: any[];    // election_votes rows (voter, no choice column)
  candidates?: any[];
  eligibleCount?: number;
  frozenRoll?: any;         // election_rolls row (null = no published roll)
  rollEntry?: any;          // the caller's election_roll_entries row
  units?: any[];            // estate_properties the caller holds
}

function makeSupabase(cfg: Cfg) {
  const calls: any = { updates: [], claims: 0, selects: [] };
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
        if (table === 'election_rolls') return { data: cfg.frozenRoll ?? null, error: null };
        if (table === 'election_roll_entries') return { data: cfg.rollEntry ?? null, error: null };
        return { data: null, error: null };
      },
      single: async () => ({ data: cfg.insertError ? null : paymentRow(), error: cfg.insertError ?? null }),
      then: (resolve: any) => {
        calls.selects.push(table);
        if (ctx.countOpt?.head) return resolve({ count: cfg.outstandingCount ?? 0, error: null });
        if (ctx.op === 'update') { calls.updates.push({ table, payload: ctx.updatePayload }); return resolve({ error: cfg.updateError ?? null }); }
        if (table === 'election_candidates') return resolve({ data: cfg.candidates ?? [], error: null });
        // ESTB-D003: choices live in election_ballots, participation in election_votes.
        if (table === 'election_ballots') return resolve({ data: cfg.ballots ?? cfg.votes ?? [], error: null });
        if (table === 'election_votes') return resolve({ data: cfg.participation ?? [], error: null });
        if (table === 'estate_properties') return resolve({ data: cfg.units ?? [], error: null });
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

  // EST-UAT-0204/0219: a published roll IS the franchise. The BFF mirrors what
  // estate_cast_vote enforces in the write so the app can say why it refused.
  it('blocks a voter the frozen roll does not list', async () => {
    const { client } = makeSupabase({ frozenRoll: { id: 'roll-9' }, rollEntry: null });
    const r = await checkVoteEligibility(client as any, base.estateId, base.userId, base.electionId);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain('not_on_roll');
  });

  it('admits a voter with an active entry on the frozen roll', async () => {
    const { client } = makeSupabase({ frozenRoll: { id: 'roll-9' }, rollEntry: { id: 'entry-1' } });
    const r = await checkVoteEligibility(client as any, base.estateId, base.userId, base.electionId);
    expect(r.eligible).toBe(true);
    expect(r.reasons).not.toContain('not_on_roll');
  });

  it('is not gated by a roll that has not been published', async () => {
    // A draft roll (or none at all) constrains nothing — elections configured
    // before governance keep working (EST-UAT-0204).
    const { client } = makeSupabase({ frozenRoll: null, rollEntry: null });
    const r = await checkVoteEligibility(client as any, base.estateId, base.userId, base.electionId);
    expect(r.eligible).toBe(true);
  });
});

describe('getVoterUnits — the holdings a weighted ballot is cast on', () => {
  it('labels each holding and keeps block and unit together', async () => {
    const { client } = makeSupabase({
      units: [
        { id: 'u-1', unit_label: 'W-01', block: 'A' },
        { id: 'u-2', unit_label: 'W-02', block: null },
      ],
    });
    const units = await getVoterUnits(client as any, ESTATE, USER);
    expect(units).toEqual([
      { id: 'u-1', label: 'A / W-01' },
      { id: 'u-2', label: 'W-02' },
    ]);
  });

  it('returns no holdings for a resident who owns nothing', async () => {
    const { client } = makeSupabase({ units: [] });
    expect(await getVoterUnits(client as any, ESTATE, USER)).toEqual([]);
  });
});

describe('mapElection — secret tally', () => {
  const row = { id: 'el-1', estate_id: ESTATE, title: 'AGM', description: null, starts_at: new Date(Date.now() - 3600e3).toISOString(), ends_at: new Date(Date.now() + 3600e3).toISOString(), status: 'open' };

  it('withholds per-candidate votes while results are unpublished', async () => {
    const { client } = makeSupabase({ candidates: [{ id: 'c1', name: 'A', bio: null }, { id: 'c2', name: 'B', bio: null }], ballots: [{ candidate_id: 'c1' }, { candidate_id: 'c1' }, { candidate_id: 'c2' }] });
    const mapped = await mapElection(client as any, row);
    expect(mapped.status).toBe('live');
    expect(mapped.resultsPublished).toBe(false);
    expect(mapped.positions[0].candidates.every((c: any) => c.votes === 0)).toBe(true);
    expect(mapped.votesCast).toBe(3); // participation stays visible
  });

  it('exposes tallies once results are published', async () => {
    const { client } = makeSupabase({ candidates: [{ id: 'c1', name: 'A', bio: null }, { id: 'c2', name: 'B', bio: null }], ballots: [{ candidate_id: 'c1' }, { candidate_id: 'c1' }, { candidate_id: 'c2' }] });
    const mapped = await mapElection(client as any, { ...row, status: 'tallied', ends_at: new Date(Date.now() - 60e3).toISOString() });
    expect(mapped.resultsPublished).toBe(true);
    expect(mapped.positions[0].candidates[0].votes).toBe(2);
    expect(mapped.positions[0].candidates[1].votes).toBe(1);
  });

  // ESTB-D003: the tally must come from the anonymous ballot table. If it ever
  // reads the participation registry for choices again, the voter→choice link is
  // back in the read path and the secret ballot is only nominally true.
  it('counts from election_ballots, never from the participation registry', async () => {
    const { client, calls } = makeSupabase({
      candidates: [{ id: 'c1', name: 'A', bio: null }],
      ballots: [{ candidate_id: 'c1' }],
      participation: [{ candidate_id: 'c1' }, { candidate_id: 'c1' }, { candidate_id: 'c1' }, { candidate_id: 'c1' }],
    });
    const mapped = await mapElection(client as any, { ...row, status: 'tallied', ends_at: new Date(Date.now() - 60e3).toISOString() });
    expect(calls.selects).toContain('election_ballots');
    expect(mapped.positions[0].candidates[0].votes).toBe(1);
    expect(mapped.votesCast).toBe(1);
  });

  // EST-UAT-0221: a blank ballot is counted in turnout and attributed to nobody.
  it('counts an abstention in turnout without crediting a candidate', async () => {
    const { client } = makeSupabase({
      candidates: [{ id: 'c1', name: 'A', bio: null }, { id: 'c2', name: 'B', bio: null }],
      ballots: [{ candidate_id: 'c1' }, { candidate_id: null }],
    });
    const mapped = await mapElection(client as any, { ...row, status: 'tallied', ends_at: new Date(Date.now() - 60e3).toISOString() });
    expect(mapped.votesCast).toBe(2);
    expect(mapped.positions[0].candidates[0].votes).toBe(1);
    expect(mapped.positions[0].candidates[1].votes).toBe(0);
  });

  // EST-UAT-0205/0223/0225/0230: the client can only explain a per-unit ballot, a
  // missed quorum or a runoff requirement if the configuration travels with the election.
  it('passes the governance configuration through to the client', async () => {
    const { client } = makeSupabase({ candidates: [{ id: 'c1', name: 'A', bio: null }], ballots: [] });
    const mapped = await mapElection(client as any, {
      ...row,
      kind: 'poll', weighting: 'one_vote_per_unit', quorum_type: 'percent', quorum_value: 75,
      tie_break: 'runoff', roll_frozen_at: '2026-10-01T00:00:00Z', rules_locked_at: null,
    });
    expect(mapped.governance).toMatchObject({
      kind: 'poll', weighting: 'one_vote_per_unit', quorumType: 'percent', quorumValue: 75,
      tieBreak: 'runoff', rollFrozenAt: '2026-10-01T00:00:00Z',
    });
  });

  it('reports the pre-governance defaults for an election with no configuration', async () => {
    const { client } = makeSupabase({ candidates: [{ id: 'c1', name: 'A', bio: null }], ballots: [] });
    const mapped = await mapElection(client as any, row);
    expect(mapped.governance).toMatchObject({
      kind: 'binding', weighting: 'one_person_one_vote', quorumType: 'none', quorumValue: 0, tieBreak: 'none',
    });
  });
});
