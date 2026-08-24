/**
 * Money-path suite: Film Academy tuition.
 *
 * Two invariants, both of which were defects before this suite existed:
 *
 *  1. The instalment plan created on approval must bill the tuition the applicant
 *     was actually shown — the sum of the priced interest areas they chose
 *     (`tuition_total_ngn`) — not the batch's flat `training_fee_ngn`.
 *
 *  2. Confirming an instalment must check the AMOUNT Paystack settled, not just
 *     that the reference verified. A reference alone only proves some payment
 *     succeeded, so without this a ₦100 charge could settle a ₦255,000 instalment.
 *
 * Money note: academy tables store NAIRA (they predate the kobo convention used
 * across finance); Paystack reports kobo. The ×100 boundary is under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, withAuth } from './_fixtures';

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
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(), createClient: vi.fn() }));
vi.mock('@/src/server/voting/payment/paystack', () => ({ verifyPaystackPayment: vi.fn() }));
vi.mock('@/src/lib/email/transactional', () => ({
  sendTransactionalEmail: vi.fn().mockResolvedValue(undefined),
}));

import { POST as PAY } from '../../../app/api/academy/installments/pay/route';
import { GET as STATUS } from '../../../app/api/academy/application/route';
import { autoCreateInstallmentPlan } from '@/src/server/services/academy/installments';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyPaystackPayment } from '@/src/server/voting/payment/paystack';

const USER = { id: 'user-001', email: 'student@example.com' };

// ── A Supabase stub that records inserts, keyed by table ─────────────────────

type Rows = Record<string, unknown>;

function makeDb(config: {
  rows: Record<string, Rows | null>;
  inserts: Record<string, Rows[]>;
}) {
  const builder = (table: string): any => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: config.rows[table] ?? null, error: null }),
      single: async () => ({ data: config.rows[table] ?? null, error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
      insert: (payload: Rows | Rows[]) => {
        const list = Array.isArray(payload) ? payload : [payload];
        (config.inserts[table] ??= []).push(...list);
        const inserted: any = {
          select: () => inserted,
          single: async () => ({ data: { id: `${table}-new` }, error: null }),
          then: (r: (v: unknown) => unknown) => r({ error: null }),
        };
        return inserted;
      },
    };
    return chain;
  };
  return { from: (table: string) => builder(table) } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRequestUser).mockResolvedValue(USER as any);
});

// ── 1. What gets billed on approval ──────────────────────────────────────────

describe('autoCreateInstallmentPlan — what the applicant is billed', () => {
  function runWith(appRow: Rows, batchRow: Rows) {
    const inserts: Record<string, Rows[]> = {};
    const db = makeDb({
      rows: {
        academy_batches: batchRow,
        academy_applications: appRow,
        academy_installment_plans: null, // no existing plan
      },
      inserts,
    });
    vi.mocked(createAdminClient).mockReturnValue(db);
    return { inserts, done: autoCreateInstallmentPlan('app-1', 'batch-1', '2026-09-01T00:00:00Z') };
  }

  it('bills the sum of the applicant’s selected areas, not the batch flat fee', async () => {
    const { inserts, done } = runWith(
      { id: 'app-1', payment_preference: 'one_off', tuition_total_ngn: 585000 },
      { id: 'batch-1', training_fee_ngn: 150000, installments_count: 1, one_off_discount_pct: 0 },
    );
    await done;

    const plan = inserts.academy_installment_plans?.[0] as any;
    expect(plan).toBeDefined();
    expect(plan.total_amount_ngn).toBe(585000);
    expect(plan.total_amount_ngn).not.toBe(150000);
  });

  it('falls back to the batch fee when no areas were priced', async () => {
    const { inserts, done } = runWith(
      { id: 'app-1', payment_preference: 'one_off', tuition_total_ngn: 0 },
      { id: 'batch-1', training_fee_ngn: 150000, installments_count: 1, one_off_discount_pct: 0 },
    );
    await done;
    expect((inserts.academy_installment_plans?.[0] as any).total_amount_ngn).toBe(150000);
  });

  it('splits area tuition across instalments without losing naira to rounding', async () => {
    const { inserts, done } = runWith(
      { id: 'app-1', payment_preference: 'installment', tuition_total_ngn: 100000 },
      { id: 'batch-1', training_fee_ngn: 0, installments_count: 3, fee_frequency: 'monthly' },
    );
    await done;

    const payments = (inserts.academy_installment_payments ?? []) as any[];
    expect(payments).toHaveLength(3);
    const total = payments.reduce((s, p) => s + Number(p.amount_ngn), 0);
    expect(Math.round(total * 100) / 100).toBe(100000);
  });

  // The plan table constrains `frequency` to weekly|biweekly|monthly and
  // `installments_count` to 1..12. Violating either makes the insert fail, and the
  // caller swallows that — so an approved applicant silently gets no plan.
  const LEGAL_CADENCES = ['weekly', 'biweekly', 'monthly'];

  it('never writes "upfront" as a cadence — it is not a legal frequency', async () => {
    // A one-off plan wrote frequency:'upfront', which the check constraint rejects.
    // No one-off plan could ever be created.
    const { inserts, done } = runWith(
      { id: 'app-1', payment_preference: 'one_off', tuition_total_ngn: 50000 },
      { id: 'batch-1', training_fee_ngn: 0, installments_count: 1, fee_frequency: 'upfront', one_off_discount_pct: 0 },
    );
    await done;

    const plan = inserts.academy_installment_plans?.[0] as any;
    expect(plan).toBeDefined();
    expect(LEGAL_CADENCES).toContain(plan.frequency);
    expect(plan.installments_count).toBe(1); // upfront is a COUNT, not a cadence
  });

  it('normalises a batch whose own fee_frequency is "upfront"', async () => {
    // Batch A is configured this way, so no plan could be created for it at all.
    const { inserts, done } = runWith(
      { id: 'app-1', payment_preference: 'installment', tuition_total_ngn: 50000 },
      { id: 'batch-1', training_fee_ngn: 0, installments_count: 1, fee_frequency: 'upfront' },
    );
    await done;

    const plan = inserts.academy_installment_plans?.[0] as any;
    expect(LEGAL_CADENCES).toContain(plan.frequency);
    expect(inserts.academy_installment_payments).toHaveLength(1);
  });

  it('clamps installments_count to the 1..12 the constraint allows', async () => {
    const { inserts, done } = runWith(
      { id: 'app-1', payment_preference: 'installment', tuition_total_ngn: 120000 },
      { id: 'batch-1', training_fee_ngn: 0, installments_count: 24, fee_frequency: 'monthly' },
    );
    await done;

    const plan = inserts.academy_installment_plans?.[0] as any;
    expect(plan.installments_count).toBeLessThanOrEqual(12);
    expect(inserts.academy_installment_payments).toHaveLength(plan.installments_count);
    // and the split still conserves the total
    const total = (inserts.academy_installment_payments as any[]).reduce((s, p) => s + Number(p.amount_ngn), 0);
    expect(Math.round(total * 100) / 100).toBe(120000);
  });

  it('creates no plan at all when tuition is zero on both sources', async () => {
    const { inserts, done } = runWith(
      { id: 'app-1', payment_preference: 'one_off', tuition_total_ngn: 0 },
      { id: 'batch-1', training_fee_ngn: 0, installments_count: 1 },
    );
    await done;
    expect(inserts.academy_installment_plans).toBeUndefined();
  });
});

// ── 2. What is accepted as payment ───────────────────────────────────────────

describe('POST /api/academy/installments/pay — amount verification', () => {
  function payDb(paymentRow: Rows | null) {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: paymentRow, error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
    // The reference-reuse guard queries the same table a second time; returning
    // the same row means "the reference belongs to this payment", not a reuse.
    return { from: () => chain } as any;
  }

  const OWNED_PAYMENT = {
    id: 'pay-1',
    plan_id: 'plan-1',
    installment_number: 1,
    amount_ngn: 255000,
    status: 'pending',
    academy_installment_plans: {
      application_id: 'app-1',
      academy_applications: { user_id: USER.id, full_name: 'Ada', email: USER.email },
    },
  };

  const body = { planId: 'plan-1', paymentId: 'pay-1', reference: 'ref-abc' };

  function verified(amountKobo: number, currency = 'NGN') {
    vi.mocked(verifyPaystackPayment).mockResolvedValue({
      success: true,
      providerReference: 'ref-abc',
      amountKobo,
      currency,
      paidAt: '2026-09-01T00:00:00Z',
      customerEmail: USER.email,
      metadata: {},
    } as any);
  }

  it('rejects a reference that settled less than the instalment', async () => {
    vi.mocked(createAdminClient).mockReturnValue(payDb(OWNED_PAYMENT));
    verified(10_000); // ₦100 against a ₦255,000 instalment

    const res = await PAY(makeRequest('/api/academy/installments/pay', { body, headers: withAuth() }));
    expect(res.status).toBe(402);
  });

  it('rejects a settlement in the wrong currency', async () => {
    vi.mocked(createAdminClient).mockReturnValue(payDb(OWNED_PAYMENT));
    verified(255_000 * 100, 'USD');

    const res = await PAY(makeRequest('/api/academy/installments/pay', { body, headers: withAuth() }));
    expect(res.status).toBe(402);
  });

  it('accepts a reference that settled the full instalment', async () => {
    vi.mocked(createAdminClient).mockReturnValue(payDb(OWNED_PAYMENT));
    verified(255_000 * 100);

    const res = await PAY(makeRequest('/api/academy/installments/pay', { body, headers: withAuth() }));
    expect(res.status).toBe(200);
  });

  it('refuses to settle an instalment belonging to another user', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      payDb({
        ...OWNED_PAYMENT,
        academy_installment_plans: {
          application_id: 'app-9',
          academy_applications: { user_id: 'someone-else', full_name: 'Bo', email: 'bo@example.com' },
        },
      }),
    );
    verified(255_000 * 100);

    const res = await PAY(makeRequest('/api/academy/installments/pay', { body, headers: withAuth() }));
    expect(res.status).toBe(403);
  });

  it('is idempotent — a second confirmation of a paid instalment is a no-op', async () => {
    vi.mocked(createAdminClient).mockReturnValue(payDb({ ...OWNED_PAYMENT, status: 'paid' }));

    const res = await PAY(makeRequest('/api/academy/installments/pay', { body, headers: withAuth() }));
    expect(res.status).toBe(200);
    // Crucially it must not have re-verified or re-charged anything.
    expect(verifyPaystackPayment).not.toHaveBeenCalled();
  });
});

// ── 3. What the applicant is told to do next ─────────────────────────────────

describe('GET /api/academy/application — required actions', () => {
  /** Stubs the three tables the route reads, keyed by table name. */
  function statusDb(application: Rows | null, history: Rows[], plan: Rows | null, enrolment: Rows | null = null) {
    return {
      from: (table: string) => {
        const data =
          table === 'academy_applications' ? application :
          table === 'academy_installment_plans' ? plan :
          table === 'academy_enrollments' ? enrolment : null;
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          limit: () => chain,
          update: () => ({ eq: async () => ({ error: null }) }),
          maybeSingle: async () => ({ data, error: null }),
          order: () =>
            table === 'academy_application_status_history'
              ? Promise.resolve({ data: history, error: null })
              : chain,
        };
        return chain;
      },
    } as any;
  }

  const BASE = {
    id: 'app-1',
    status: 'pending',
    payment_status: 'pending',
    application_fee_paid: 5000, // NUMERIC naira, not a boolean
    tuition_total_ngn: 50000,
    full_name: 'Ada',
    email: USER.email,
    batch_id: 'batch-1',
    created_at: '2026-08-01T00:00:00Z',
  };

  async function actionsFor(app: Rows, plan: Rows | null = null, enrolment: Rows | null = null) {
    vi.mocked(createAdminClient).mockReturnValue(statusDb(app, [], plan, enrolment));
    const res = await STATUS(
      makeRequest('/api/academy/application', { method: 'GET', headers: withAuth() }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    return { body, keys: (body.data ?? body).actions.map((a: any) => a.key) };
  }

  it('does not chase an applicant whose fee is recorded as a naira amount', async () => {
    // Regression: `application_fee_paid` is NUMERIC. A boolean test against it never
    // matches, which told every paid applicant their fee was still outstanding.
    const { keys } = await actionsFor(BASE);
    expect(keys).not.toContain('pay_application_fee');
    expect(keys).toContain('await_review');
  });

  it('chases an applicant whose fee genuinely did not settle', async () => {
    const { keys } = await actionsFor({ ...BASE, application_fee_paid: 0, payment_status: 'pending' });
    expect(keys).toContain('pay_application_fee');
  });

  it('offers no tuition action while the application is still pending', async () => {
    const { keys } = await actionsFor(BASE);
    expect(keys).not.toContain('pay_tuition');
  });

  it('offers tuition only once approved, and only for an unpaid instalment', async () => {
    const plan = {
      id: 'plan-1',
      total_amount_ngn: 50000,
      academy_installment_payments: [
        { id: 'p1', installment_number: 1, amount_ngn: 50000, status: 'pending', due_date: '2026-09-01' },
      ],
    };
    const { keys, body } = await actionsFor({ ...BASE, status: 'approved' }, plan);
    expect(keys).toContain('pay_tuition');

    const payAction = (body.data ?? body).actions.find((a: any) => a.key === 'pay_tuition');
    expect(payAction.amountNgn).toBe(50000);
  });

  it('opens learning once every instalment is paid', async () => {
    const plan = {
      id: 'plan-1',
      total_amount_ngn: 50000,
      academy_installment_payments: [
        { id: 'p1', installment_number: 1, amount_ngn: 50000, status: 'paid', paid_at: '2026-09-02' },
      ],
    };
    const { keys } = await actionsFor({ ...BASE, status: 'approved' }, plan, { id: 'enr-1' });
    expect(keys).toContain('start_learning');
    expect(keys).not.toContain('pay_tuition');
  });

  it('opens learning mid-plan — an enrolled learner is not locked out until the last instalment', async () => {
    // A three-month plan would otherwise keep a paying learner out until the course
    // was nearly over. Enrolment, not full settlement, is the gate.
    const plan = {
      id: 'plan-1',
      total_amount_ngn: 90000,
      academy_installment_payments: [
        { id: 'p1', installment_number: 1, amount_ngn: 30000, status: 'paid', paid_at: '2026-09-02' },
        { id: 'p2', installment_number: 2, amount_ngn: 30000, status: 'pending', due_date: '2026-10-01' },
        { id: 'p3', installment_number: 3, amount_ngn: 30000, status: 'pending', due_date: '2026-11-01' },
      ],
    };
    const { keys, body } = await actionsFor({ ...BASE, status: 'approved' }, plan, { id: 'enr-1' });
    expect(keys).toContain('start_learning');
    expect(keys).toContain('pay_tuition'); // still owes instalment 2

    const pay = (body.data ?? body).actions.find((a: any) => a.key === 'pay_tuition');
    expect(pay.amountNgn).toBe(30000); // the NEXT one, not the balance
  });

  it('does not open learning for an approved applicant who has paid no tuition', async () => {
    const plan = {
      id: 'plan-1',
      total_amount_ngn: 50000,
      academy_installment_payments: [
        { id: 'p1', installment_number: 1, amount_ngn: 50000, status: 'pending', due_date: '2026-09-01' },
      ],
    };
    const { keys } = await actionsFor({ ...BASE, status: 'approved' }, plan, null);
    expect(keys).not.toContain('start_learning');
    expect(keys).toContain('pay_tuition');
  });

  it('returns an empty result rather than failing when the user never applied', async () => {
    vi.mocked(createAdminClient).mockReturnValue(statusDb(null, [], null));
    const res = await STATUS(
      makeRequest('/api/academy/application', { method: 'GET', headers: withAuth() }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body.data ?? body).application).toBeNull();
    expect((body.data ?? body).actions).toEqual([]);
  });
});
