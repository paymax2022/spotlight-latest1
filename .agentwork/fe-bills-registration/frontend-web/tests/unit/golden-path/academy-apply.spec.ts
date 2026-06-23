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

import { POST } from '../../../app/api/academy/apply/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

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
function setupHappyPathMock() {
  const { mock, maybySingle, insertFn } = makeSupabaseMock();

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
});
