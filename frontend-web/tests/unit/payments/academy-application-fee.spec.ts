/**
 * AUD-FE-003 residual — Film Academy application-fee intents.
 *
 * The fee used to be initiated entirely client-side: Paystack minted the
 * reference and the server only learned it when the form was submitted — a
 * paid charge whose submit never arrived was orphaned with no record at all.
 *
 * These specs pin the fix:
 *   - POST /api/academy/application-fee/initiate mints OUR reference and quotes
 *     ONE charge — the application fee from academy_settings PLUS the first
 *     tuition instalment from the admin-managed price rows and the batch plan
 *     config; a client-declared amount is ignored;
 *   - fulfilVerifiedGatewayCharge (webhook / recover / sweep) marks a pending
 *     intent paid only when Paystack collected ≥ the quote — under-collection
 *     terminates as amount_mismatch, never a paid intent;
 *   - POST /api/academy/apply trusts the intent's recorded verified amount
 *     (no live re-verify) provided it covers fee + first instalment, consumes it
 *     so one charge files one application, releases it when the insert fails,
 *     and treats replay as a no-op.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: vi.fn(),
}));

vi.mock('@/src/server/user/profile', () => ({
  getOrCreateUserProfile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/src/lib/payments', () => ({
  verifyPaystackTransaction: vi.fn(),
}));

vi.mock('@/src/server/services/academy', () => ({
  getActiveAcademySettings: vi.fn(),
  // A batch accepts EXACTLY its linked trainings — this spec submits 'acting'.
  getBatchAreaSlugs: vi.fn(async () => ['acting']),
}));

vi.mock('@/src/server/services/academy/service', () => ({
  approveAfterPayment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/src/server/voting-bridge/bridge', () => ({
  bridgedVerifyPaidVote: vi.fn(),
}));

vi.mock('@/src/server/registration/supabase-store', () => ({
  getRegistrationPaymentIntentByReference: vi.fn(async () => null),
  applyRegistrationPaymentSuccess: vi.fn(),
  markRegistrationPaymentIntentStatus: vi.fn(),
}));

vi.mock('@/src/server/payments/openmic-vote-intents', () => ({
  getOpenMicVoteIntentByReference: vi.fn(async () => null),
  markOpenMicVoteIntent: vi.fn(async () => undefined),
}));

vi.mock('@/src/server/payments/academy-fee-intents', () => ({
  getAcademyFeeIntentByReference: vi.fn(async () => null),
  createAcademyFeeIntent: vi.fn(async () => undefined),
  markAcademyFeeIntent: vi.fn(async () => undefined),
  markAcademyFeeIntentPaid: vi.fn(async () => undefined),
  consumeAcademyFeeIntent: vi.fn(async () => true),
  releaseAcademyFeeIntent: vi.fn(async () => undefined),
}));

vi.mock('@/src/server/openmic/persistence', () => ({
  castVote: vi.fn(),
}));

import { fulfilVerifiedGatewayCharge } from '@/src/server/payments/gateway-fulfil';
import { POST as initiateFee } from '../../../app/api/academy/application-fee/initiate/route';
import { POST as applyPost } from '../../../app/api/academy/apply/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyPaystackTransaction } from '@/src/lib/payments';
import { getActiveAcademySettings } from '@/src/server/services/academy';
import { approveAfterPayment } from '@/src/server/services/academy/service';
import {
  createAcademyFeeIntent,
  getAcademyFeeIntentByReference,
  markAcademyFeeIntent,
  markAcademyFeeIntentPaid,
  consumeAcademyFeeIntent,
  releaseAcademyFeeIntent,
} from '@/src/server/payments/academy-fee-intents';

const TEST_USER = { id: 'user-001', email: 'student@example.com' };

const PAID_INTENT = {
  reference: 'academy-fee-ref-1',
  user_id: 'user-001',
  email: 'student@example.com',
  full_name: 'Ada Okafor',
  batch_id: 'batch-001',
  // Application fee 5,000 + first of three 30,000 instalments.
  amount_kobo: 3_500_000,
  verified_amount_kobo: 3_500_000,
  provider_reference: '999001',
  application_id: null,
  status: 'paid' as const,
};

const post = (route: (r: Request) => Promise<Response>, url: string, body: unknown) =>
  route(new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  }));

/**
 * The two `.in(...)` lookups both routes make: the chosen areas by slug and
 * their price rows by area_id. 'acting' has a weekend_day price of 90,000.
 */
function lookupIn(priceNgn = 90_000) {
  return vi.fn().mockImplementation((column: string) =>
    Promise.resolve(
      column === 'area_id'
        ? {
            data: [{ area_id: 'acting', key: 'weekend_day', label: 'Weekend', note: null, price_ngn: priceNgn, sort_order: 1 }],
            error: null,
          }
        : { data: [{ id: 'acting', slug: 'acting', fee_ngn: 0, is_active: true }], error: null },
    ),
  );
}

// 90,000 over 3 monthly instalments → 30,000 now, plus the 5,000 fee.
const THREE_INSTALMENT_BATCH = {
  id: 'batch-001', max_students: null, installments_count: 3, fee_frequency: 'monthly',
  one_off_discount_pct: 10, training_fee_ngn: 0,
};

// ── Initiate ─────────────────────────────────────────────────────────────────

describe('POST /api/academy/application-fee/initiate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER as never);
    vi.mocked(getActiveAcademySettings).mockResolvedValue({
      registration_type: 'paid',
      application_fee: 5000,
      application_fee_refundable: false,
      tuition_fee: 0,
    } as never);
    const { mock, maybySingle } = makeSupabaseMock();
    (mock as { in: unknown }).in = lookupIn();
    maybySingle.mockResolvedValue({ data: THREE_INSTALMENT_BATCH, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
  });

  const call = (body: unknown) =>
    post(initiateFee, '/api/academy/application-fee/initiate', body);

  it('mints a server reference and quotes fee + first instalment — client amount ignored', async () => {
    const res = await call({
      email: 'applicant@example.com',
      full_name: 'Ada Okafor',
      batch_id: 'batch-001',
      area_selections: [{ slug: 'acting', key: 'weekend_day' }],
      payment_preference: 'installment',
      // Hostile claim: the amount comes from settings + price rows, never the request.
      amountKobo: 1,
      application_fee: 1,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reference).toMatch(/^academy-fee-/);
    // 5,000 fee + 90,000 / 3 = 35,000.
    expect(body.amountKobo).toBe(3_500_000);
    expect(createAcademyFeeIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: body.reference,
        userId: 'user-001',
        amountKobo: 3_500_000,
        batchId: 'batch-001',
        metadata: expect.objectContaining({ applicationFeeNgn: 5000, firstTuitionNgn: 30000 }),
      }),
    );
  });

  it('quotes the discounted full tuition for a one-off payment', async () => {
    const res = await call({
      full_name: 'Ada Okafor',
      batch_id: 'batch-001',
      area_selections: [{ slug: 'acting', key: 'weekend_day' }],
      payment_preference: 'one_off',
    });
    const body = await res.json();

    // 90,000 less the batch's 10% = 81,000, plus the 5,000 fee.
    expect(res.status).toBe(200);
    expect(body.amountKobo).toBe(8_600_000);
  });

  it('quotes only the application fee when no areas are chosen yet', async () => {
    const res = await call({ full_name: 'Ada Okafor', batch_id: 'batch-001' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.amountKobo).toBe(500_000);
  });

  it('prefers the session email over the request body', async () => {
    const res = await call({ email: 'other@example.com', full_name: 'Ada Okafor' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.email).toBe('student@example.com');
    expect(createAcademyFeeIntent).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'student@example.com' }),
    );
  });

  it('400s when nothing is payable (free registration, no tuition)', async () => {
    vi.mocked(getActiveAcademySettings).mockResolvedValue({
      registration_type: 'free',
      application_fee: 0,
      application_fee_refundable: false,
      tuition_fee: 0,
    } as never);

    const res = await call({ email: 'a@b.com', full_name: 'Ada Okafor' });
    expect(res.status).toBe(400);
    expect(createAcademyFeeIntent).not.toHaveBeenCalled();
  });

  it('free registration still charges the first tuition instalment', async () => {
    vi.mocked(getActiveAcademySettings).mockResolvedValue({
      registration_type: 'free',
      application_fee: 0,
      application_fee_refundable: false,
      tuition_fee: 0,
    } as never);

    const res = await call({
      full_name: 'Ada Okafor',
      batch_id: 'batch-001',
      area_selections: [{ slug: 'acting', key: 'weekend_day' }],
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.amountKobo).toBe(3_000_000);
  });

  it('400s without a full name, 401s when signed out', async () => {
    expect((await call({ email: 'a@b.com', full_name: '' })).status).toBe(400);

    vi.mocked(requireRequestUser).mockRejectedValue(new Error('UNAUTHORIZED'));
    expect((await call({ email: 'a@b.com', full_name: 'Ada Okafor' })).status).toBe(401);
  });
});

// ── Gateway fulfil arm ───────────────────────────────────────────────────────

describe('fulfilVerifiedGatewayCharge — academy application-fee arm', () => {
  const call = (intent: unknown, verifiedAmountKobo = 3_500_000) =>
    fulfilVerifiedGatewayCharge('academy-fee-ref-1', verifiedAmountKobo, {
      voteTransaction: null,
      registrationIntent: null,
      openmicIntent: null,
      academyIntent: intent as never,
    });

  beforeEach(() => vi.clearAllMocks());

  it('marks a pending intent paid on a verified charge covering the quote', async () => {
    const outcome = await call({ ...PAID_INTENT, status: 'pending', verified_amount_kobo: null });

    expect(outcome).toEqual({ fulfilled: ['academy_application_fee'] });
    expect(markAcademyFeeIntentPaid).toHaveBeenCalledWith(
      'academy-fee-ref-1',
      expect.objectContaining({ verifiedAmountKobo: 3_500_000 }),
    );
    expect(markAcademyFeeIntent).not.toHaveBeenCalled();
  });

  it('terminates as amount_mismatch when Paystack under-collected', async () => {
    const outcome = await call({ ...PAID_INTENT, status: 'pending' }, 100);

    expect(outcome).toEqual({ fulfilled: [] });
    expect(markAcademyFeeIntentPaid).not.toHaveBeenCalled();
    expect(markAcademyFeeIntent).toHaveBeenCalledWith(
      'academy-fee-ref-1',
      'amount_mismatch',
      expect.stringContaining('100 kobo'),
    );
  });

  it('is a no-op on replay — a settled intent is not touched', async () => {
    for (const status of ['paid', 'consumed', 'amount_mismatch'] as const) {
      const outcome = await call({ ...PAID_INTENT, status });
      expect(outcome).toEqual({ fulfilled: [] });
    }
    expect(markAcademyFeeIntentPaid).not.toHaveBeenCalled();
    expect(markAcademyFeeIntent).not.toHaveBeenCalled();
  });
});

// ── Apply route consume path ─────────────────────────────────────────────────

describe('POST /api/academy/apply — fee intent', () => {
  function applyBody(overrides: Record<string, unknown> = {}) {
    return {
      full_name: 'Ada Okafor',
      email: 'student@example.com',
      phone: '08012345678',
      batch_id: 'batch-001',
      areas_of_interest: ['acting'],
      motivation: 'I want to become a professional actor.',
      payment_preference: 'installment',
      application_fee_reference: 'academy-fee-ref-1',
      ...overrides,
    };
  }

  function mockApplyQueries() {
    const { mock, maybySingle, insertFn } = makeSupabaseMock();
    // Areas by slug, and their tuition price rows by area_id (90,000).
    (mock as { in: unknown }).in = lookupIn();
    maybySingle
      // academy_batches → exists, unlimited seats, 3 monthly instalments
      .mockResolvedValueOnce({ data: THREE_INSTALMENT_BATCH, error: null })
      // findExistingBatchApplication: by userId, then by email → none
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    insertFn.mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    return { mock, maybySingle, insertFn };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER as never);
    vi.mocked(getActiveAcademySettings).mockResolvedValue({
      registration_type: 'paid',
      application_fee: 5000,
      application_fee_refundable: false,
      tuition_fee: 0,
    } as never);
    vi.mocked(getAcademyFeeIntentByReference).mockResolvedValue(PAID_INTENT as never);
    vi.mocked(consumeAcademyFeeIntent).mockResolvedValue(true as never);
  });

  const call = (body: unknown) => post(applyPost, '/api/academy/apply', body);

  it('consumes a paid intent and files the application — no live re-verify', async () => {
    const { insertFn } = mockApplyQueries();

    const res = await call(applyBody());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(verifyPaystackTransaction).not.toHaveBeenCalled();
    expect(consumeAcademyFeeIntent).toHaveBeenCalledWith(
      'academy-fee-ref-1',
      expect.any(String),
    );
    expect(insertFn).toHaveBeenCalledWith(expect.objectContaining({
      application_fee_paid: 5000,
      tuition_total_ngn: 90000,
    }));
    expect(releaseAcademyFeeIntent).not.toHaveBeenCalled();
    // Approved on payment, first instalment recorded paid against the reference.
    expect(approveAfterPayment).toHaveBeenCalledWith(body.applicationId, {
      reference: 'academy-fee-ref-1',
      firstInstalmentPaid: true,
    });
  });

  it('rejects a paid intent that covers only the application fee, not the first instalment', async () => {
    vi.mocked(getAcademyFeeIntentByReference).mockResolvedValue({
      ...PAID_INTENT,
      amount_kobo: 500_000,
      verified_amount_kobo: 500_000,
    } as never);
    const { insertFn } = mockApplyQueries();

    const res = await call(applyBody());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/payment is lower/i);
    expect(body.error).toContain('35,000');
    expect(consumeAcademyFeeIntent).not.toHaveBeenCalled();
    expect(insertFn).not.toHaveBeenCalled();
    expect(approveAfterPayment).not.toHaveBeenCalled();
  });

  it('rejects a pending intent — payment confirmation still in flight', async () => {
    vi.mocked(getAcademyFeeIntentByReference).mockResolvedValue({
      ...PAID_INTENT,
      status: 'pending',
    } as never);
    const { insertFn } = mockApplyQueries();

    const res = await call(applyBody());
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.error).toMatch(/still being confirmed/i);
    expect(consumeAcademyFeeIntent).not.toHaveBeenCalled();
    expect(insertFn).not.toHaveBeenCalled();
  });

  it('rejects a consumed intent — one charge, one application', async () => {
    vi.mocked(getAcademyFeeIntentByReference).mockResolvedValue({
      ...PAID_INTENT,
      status: 'consumed',
    } as never);
    const { insertFn } = mockApplyQueries();

    const res = await call(applyBody());

    expect(res.status).toBe(409);
    expect(consumeAcademyFeeIntent).not.toHaveBeenCalled();
    expect(insertFn).not.toHaveBeenCalled();
  });

  it('rejects an intent initiated under a different account', async () => {
    vi.mocked(getAcademyFeeIntentByReference).mockResolvedValue({
      ...PAID_INTENT,
      user_id: 'someone-else',
    } as never);
    mockApplyQueries();

    const res = await call(applyBody());

    expect(res.status).toBe(403);
    expect(consumeAcademyFeeIntent).not.toHaveBeenCalled();
  });

  it('409s a replayed submit whose consume lost the race', async () => {
    vi.mocked(consumeAcademyFeeIntent).mockResolvedValue(false as never);
    const { insertFn } = mockApplyQueries();

    const res = await call(applyBody());

    expect(res.status).toBe(409);
    expect(insertFn).not.toHaveBeenCalled();
  });

  it('releases the claim when the application insert fails', async () => {
    const { insertFn } = mockApplyQueries();
    insertFn.mockResolvedValue({ error: { code: 'XX000', message: 'write failed' } });

    const res = await call(applyBody());

    expect(res.status).toBe(500);
    expect(releaseAcademyFeeIntent).toHaveBeenCalledWith('academy-fee-ref-1');
  });

  it('falls back to live Paystack verify when no intent exists (in-flight charge)', async () => {
    vi.mocked(getAcademyFeeIntentByReference).mockResolvedValue(null as never);
    vi.mocked(verifyPaystackTransaction).mockResolvedValue({
      status: 'success',
      currency: 'NGN',
      amountKobo: 3_500_000,
      customerEmail: 'student@example.com',
    } as never);
    const { insertFn } = mockApplyQueries();

    const res = await call(applyBody({ application_fee_reference: 'legacy-ref' }));

    expect(res.status).toBe(201);
    expect(verifyPaystackTransaction).toHaveBeenCalledWith('legacy-ref');
    expect(consumeAcademyFeeIntent).not.toHaveBeenCalled();
    expect(insertFn).toHaveBeenCalled();
  });
});
