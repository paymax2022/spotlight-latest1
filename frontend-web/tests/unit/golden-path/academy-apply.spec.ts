/**
 * Golden-path suite: POST /api/academy/apply
 *
 * Tests the Film Academy application route: auth, field validation,
 * batch lookup, duplicate detection, and insert contract.
 *
 * External dependencies (Supabase, Paystack) are mocked. The test scenarios
 * assume free-registration mode (no payment required) unless stated otherwise.
 *
 * Protected source: frontend-web/app/api/academy/apply/route.ts (DO NOT EDIT)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, makeSupabaseMock } from './_fixtures';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@/src/server/user/profile', () => ({
  getOrCreateUserProfile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/src/lib/payments/paystack', () => ({
  verifyPaystackTransaction: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { POST, GET } from '../../../app/api/academy/apply/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyPaystackTransaction } from '@/src/lib/payments/paystack';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_USER = { id: 'user-001', email: 'student@example.com' };

function authAsTestUser() {
  vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER as any);
}

function authUnauthorized() {
  vi.mocked(requireRequestUser).mockRejectedValue(new Error('UNAUTHORIZED'));
}

function makeApplyBody(overrides: Record<string, unknown> = {}) {
  return {
    full_name: 'Ada Okafor',
    email: 'student@example.com',
    phone: '08012345678',
    batch_id: 'batch-001',
    areas_of_interest: ['acting'],
    motivation: 'I want to become a professional actor.',
    payment_preference: 'installment',
    ...overrides,
  };
}

/**
 * Sets up the Supabase mock to simulate a free-registration, no-existing-app
 * happy path. Call sequence:
 *   1. academy_settings  → { registration_type: 'free', application_fee: 0 }
 *   2. academy_batches   → { id: 'batch-001' }          (batch exists)
 *   3. academy_applications (by userId)  → null          (no existing app)
 *   4. academy_applications (by email)   → null          (no existing app)
 *   5. insert            → { error: null }
 */
/**
 * The route prices the application from academy_interest_areas via
 * `.in('slug', …)`. The shared fixture keeps `in` chainable because other
 * suites chain onto it, so this overrides it locally to resolve like a real
 * terminal query. Defaults to the areas used by makeApplyBody(), fee 0.
 */
function mockInterestAreas(
  mock: Record<string, unknown>,
  rows: Array<{ slug: string; fee_ngn: number; is_active?: boolean }> =
    [{ slug: 'acting', fee_ngn: 0, is_active: true }],
) {
  (mock as { in: unknown }).in = vi.fn().mockResolvedValue({
    data: rows.map((r) => ({ is_active: true, ...r })),
    error: null,
  });
}

function setupHappyPathMock() {
  const { mock, maybySingle, insertFn } = makeSupabaseMock();
  mockInterestAreas(mock);

  maybySingle
    .mockResolvedValueOnce({
      data: {
        registration_type: 'free',
        application_fee: 0,
        application_fee_refundable: false,
        tuition_fee: 0,
      },
      error: null,
    })
    .mockResolvedValueOnce({ data: { id: 'batch-001' }, error: null }) // batch
    .mockResolvedValueOnce({ data: null, error: null })                // no existing by userId
    .mockResolvedValueOnce({ data: null, error: null });               // no existing by email

  insertFn.mockResolvedValue({ error: null });

  vi.mocked(createAdminClient).mockReturnValue(mock as any);
  return { mock, maybySingle, insertFn };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/academy/apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAsTestUser();
  });

  it('should submit a free application and return applicationId', async () => {
    setupHappyPathMock();

    const res = await POST(makeRequest('/api/academy/apply', { body: makeApplyBody() }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(typeof body.applicationId).toBe('string');
    expect(body.applicationId).toHaveLength(36); // UUID v4
  });

  it('should return 401 when user is not authenticated', async () => {
    authUnauthorized();

    const res = await POST(makeRequest('/api/academy/apply', { body: makeApplyBody() }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/sign in/i);
  });

  it('should return 400 when full_name is missing', async () => {
    setupHappyPathMock();

    const res = await POST(
      makeRequest('/api/academy/apply', { body: makeApplyBody({ full_name: '' }) }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/full name/i);
  });

  it('should return 400 when batch_id is missing', async () => {
    setupHappyPathMock();

    const res = await POST(
      makeRequest('/api/academy/apply', { body: makeApplyBody({ batch_id: '' }) }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/batch/i);
  });

  it('should return 400 when batch does not exist in the database', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    mockInterestAreas(mock);

    maybySingle
      .mockResolvedValueOnce({
        data: { registration_type: 'free', application_fee: 0 },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null }); // batch not found

    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest('/api/academy/apply', { body: makeApplyBody() }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/invalid batch/i);
  });

  it('should return 409 when applicant has already applied for the same batch', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    mockInterestAreas(mock);

    maybySingle
      .mockResolvedValueOnce({
        data: { registration_type: 'free', application_fee: 0 },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: 'batch-001' }, error: null })
      // Existing application found by userId:
      .mockResolvedValueOnce({
        data: { id: 'existing-app-001', status: 'pending', payment_status: 'not_required' },
        error: null,
      });

    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest('/api/academy/apply', { body: makeApplyBody() }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/already applied/i);
  });


  // ── Application fee: base + selected areas ────────────────────────────────
  // The client renders a running total, but it is the SERVER that decides what
  // must be paid. These pin the arithmetic and the three ways it could be
  // subverted: an understated payment, an unknown slug priced at zero, and a
  // retired area still being chargeable.

  /** Paid-mode settings + areas + a batch that exists and no prior application. */
  function setupPaidMock(
    applicationFee: number,
    areaRows: Array<{ slug: string; fee_ngn: number; is_active?: boolean }>,
  ) {
    const { mock, maybySingle, insertFn } = makeSupabaseMock();
    mockInterestAreas(mock, areaRows);
    maybySingle
      .mockResolvedValueOnce({
        data: { registration_type: 'paid', application_fee: applicationFee, tuition_fee: 0 },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: 'batch-001' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    insertFn.mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    return { mock, insertFn };
  }

  function paystackPaid(amountNaira: number) {
    vi.mocked(verifyPaystackTransaction).mockResolvedValue({
      status: 'success',
      currency: 'NGN',
      amountKobo: amountNaira * 100,
      customerEmail: 'student@example.com',
    } as any);
  }

  // Area fees are TUITION — payable on acceptance and refundable. Only the
  // application fee is taken at submit. Charging tuition here would have taken
  // hundreds of thousands of naira before anyone read the application, under a
  // fee the settings mark non-refundable.
  it('charges ONLY the application fee, never the tuition of chosen areas', async () => {
    const { insertFn } = setupPaidMock(5000, [
      { slug: 'acting', fee_ngn: 250000 },
      { slug: 'editing', fee_ngn: 35000 },
    ]);
    // Pays the application fee alone while selecting ₦285,000 of tuition.
    paystackPaid(5000);

    const res = await POST(makeRequest('/api/academy/apply', {
      body: makeApplyBody({
        areas_of_interest: ['acting', 'editing'],
        application_fee_reference: 'ref-app-fee-only',
      }),
    }));

    expect(res.status).toBe(201);
    expect(insertFn).toHaveBeenCalled();
  });

  it('rejects a payment below the application fee', async () => {
    setupPaidMock(5000, [{ slug: 'acting', fee_ngn: 250000 }]);
    paystackPaid(2000);

    const res = await POST(makeRequest('/api/academy/apply', {
      body: makeApplyBody({ application_fee_reference: 'ref-underpaid' }),
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/application fee payment is lower/i);
    expect(body.error).toContain('5,000');
    // The tuition figure must NOT appear — it is not what was being collected.
    expect(body.error).not.toContain('250,000');
  });

  it('accepts a payment covering base plus the selected areas', async () => {
    const { insertFn } = setupPaidMock(5000, [
      { slug: 'acting', fee_ngn: 2000 },
      { slug: 'editing', fee_ngn: 3000 },
    ]);
    paystackPaid(10000);

    const res = await POST(makeRequest('/api/academy/apply', {
      body: makeApplyBody({
        areas_of_interest: ['acting', 'editing'],
        application_fee_reference: 'ref-ok',
      }),
    }));

    expect(res.status).toBe(201);
    expect(insertFn).toHaveBeenCalled();
  });

  it('charges the base only when the selected areas are free', async () => {
    setupPaidMock(5000, [{ slug: 'acting', fee_ngn: 0 }]);
    paystackPaid(5000);

    const res = await POST(makeRequest('/api/academy/apply', {
      body: makeApplyBody({ application_fee_reference: 'ref-base-only' }),
    }));

    expect(res.status).toBe(201);
  });

  it('rejects an unknown area instead of pricing it at zero', async () => {
    // The lookup returns only the known slug; 'forgery' is not a row.
    setupPaidMock(5000, [{ slug: 'acting', fee_ngn: 2000 }]);
    paystackPaid(7000);

    const res = await POST(makeRequest('/api/academy/apply', {
      body: makeApplyBody({
        areas_of_interest: ['acting', 'forgery'],
        application_fee_reference: 'ref-unknown',
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/unknown area of interest/i);
    expect(body.error).toContain('forgery');
  });

  it('treats a retired area as unknown rather than chargeable', async () => {
    setupPaidMock(5000, [{ slug: 'acting', fee_ngn: 2000, is_active: false }]);
    paystackPaid(7000);

    const res = await POST(makeRequest('/api/academy/apply', {
      body: makeApplyBody({ application_fee_reference: 'ref-retired' }),
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/unknown area of interest/i);
  });

  it('ignores any application fee the client claims', async () => {
    setupPaidMock(5000, [{ slug: 'acting', fee_ngn: 250000 }]);
    paystackPaid(1);   // a token payment

    const res = await POST(makeRequest('/api/academy/apply', {
      body: makeApplyBody({
        application_fee_reference: 'ref-claimed',
        // A hostile client asserting its own arithmetic. Must not be believed:
        // the required amount comes from academy_settings, never the request.
        required_fee: 1,
        application_fee: 1,
        total: 1,
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('5,000');
  });


  it('rejects an area the chosen batch does not offer', async () => {
    const { mock } = setupPaidMock(5000, [{ slug: 'acting', fee_ngn: 2000 }]);
    paystackPaid(7000);
    // This batch offers only cinematography. Scope the stub to THAT TABLE:
    // overriding `.eq` wholesale also captures the settings and batch lookups,
    // which chain through eq and then maybeSingle — doing so returned 500.
    const passthrough = mock as unknown as { from: (t: string) => unknown };
    passthrough.from = vi.fn((table: string) =>
      table === 'academy_batch_interest_areas'
        ? { select: () => ({ eq: () => Promise.resolve({ data: [{ area_slug: 'cinematography' }], error: null }) }) }
        : mock,
    ) as never;

    const res = await POST(makeRequest('/api/academy/apply', {
      body: makeApplyBody({ application_fee_reference: 'ref-not-offered' }),
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/does not offer/i);
    expect(body.error).toContain('acting');
  });

  it('should return 400 when areas_of_interest is empty', async () => {
    setupHappyPathMock();

    const res = await POST(
      makeRequest('/api/academy/apply', {
        body: makeApplyBody({ areas_of_interest: [] }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/area of interest/i);
  });

  // ── The two-area cap ────────────────────────────────────────────────────────
  // A commercial rule, so it is enforced on the SERVER. The mobile form stops at
  // two, but an application that slipped past the form would be CHARGED for every
  // area it named — which is why these are route tests, not UI tests.

  it('rejects more than two areas of interest', async () => {
    const { mock } = makeSupabaseMock();
    mockInterestAreas(mock, [
      { slug: 'acting', fee_ngn: 50000 },
      { slug: 'editing', fee_ngn: 35000 },
      { slug: 'sound', fee_ngn: 20000 },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest('/api/academy/apply', {
      body: makeApplyBody({ areas_of_interest: ['acting', 'editing', 'sound'] }),
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/at most 2/i);
  });

  it('accepts exactly two areas — the cap is inclusive', async () => {
    // Off-by-one here would reject a legitimate application, so the boundary is
    // pinned from both sides.
    const { mock } = setupHappyPathMock();
    mockInterestAreas(mock, [
      { slug: 'acting', fee_ngn: 0 },
      { slug: 'editing', fee_ngn: 0 },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest('/api/academy/apply', {
      body: makeApplyBody({ areas_of_interest: ['acting', 'editing'] }),
    }));
    expect(res.status).toBe(201); // 201 Created — the application was accepted
  });

  it('rejects a duplicated slug rather than counting it once', async () => {
    // ['acting','acting','acting'] must not read as three selections — and more
    // importantly must not price the same area three times in the tuition sum.
    const { mock } = makeSupabaseMock();
    mockInterestAreas(mock, [{ slug: 'acting', fee_ngn: 50000 }]);
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest('/api/academy/apply', {
      body: makeApplyBody({ areas_of_interest: ['acting', 'acting', 'acting'] }),
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/more than once/i);
  });

  it('publishes the cap on GET so the client does not hardcode its own copy', async () => {
    const { mock } = makeSupabaseMock();
    mockInterestAreas(mock);
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await GET(makeRequest('/api/academy/apply', { method: 'GET' }));
    const body = await res.json();
    const d = body.data ?? body;
    expect(d.maxInterestAreas).toBe(2);
  });
});
