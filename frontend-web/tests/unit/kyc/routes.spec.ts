/**
 * KYC route handler contract tests.
 *   GET  /api/v1/kyc/me
 *   POST /api/v1/kyc/initiate
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRequest } from '../golden-path/_fixtures';

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

vi.mock('@/src/server/kyc/service', () => ({
  getKycProfile: vi.fn(),
  initiateKyc: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { GET } from '../../../app/api/v1/kyc/me/route';
import { POST } from '../../../app/api/v1/kyc/initiate/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getKycProfile, initiateKyc } from '@/src/server/kyc/service';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_USER = { id: 'user-001', email: 'test@example.com' };

function enableKycFlag() { process.env.FEATURE_KYC_ENABLED = 'true'; }
function disableKycFlag() { delete process.env.FEATURE_KYC_ENABLED; }

function authAsUser() {
  vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER as any);
}

function unverifiedProfile() {
  return {
    kyc_tier: 0 as const,
    kyc_status: 'unverified' as const,
    phone_verified: false,
    kyc_submitted_at: null,
    kyc_verified_at: null,
    document_type: null,
  };
}

// ── Tests: GET /api/v1/kyc/me ────────────────────────────────────────────────

describe('GET /api/v1/kyc/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAsUser();
    enableKycFlag();
  });
  afterEach(disableKycFlag);

  it('returns kyc_tier and kyc_status for authenticated user', async () => {
    vi.mocked(getKycProfile).mockResolvedValue(unverifiedProfile());

    const res = await GET(new Request('http://localhost/api/v1/kyc/me'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.kyc_tier).toBe(0);
    expect(body.kyc_status).toBe('unverified');
    expect(body.phone_verified).toBe(false);
  });

  it('returns 503 when KYC feature flag is off', async () => {
    disableKycFlag();

    const res = await GET(new Request('http://localhost/api/v1/kyc/me'));
    expect(res.status).toBe(503);
  });

  it('returns 401 when user is not authenticated', async () => {
    vi.mocked(requireRequestUser).mockRejectedValue(new Error('UNAUTHORIZED'));

    const res = await GET(new Request('http://localhost/api/v1/kyc/me'));
    expect(res.status).toBe(401);
  });
});

// ── Tests: POST /api/v1/kyc/initiate ─────────────────────────────────────────

describe('POST /api/v1/kyc/initiate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAsUser();
    enableKycFlag();
  });
  afterEach(disableKycFlag);

  it('returns 202 with pending status on valid BVN submission', async () => {
    vi.mocked(initiateKyc).mockResolvedValue({
      ...unverifiedProfile(),
      kyc_status: 'pending',
      kyc_submitted_at: '2026-06-13T10:00:00.000Z',
      document_type: 'BVN',
    });

    const res = await POST(
      makeRequest('/api/v1/kyc/initiate', {
        body: { document_type: 'BVN', document_number: '12345678901' },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.success).toBe(true);
    expect(body.kyc_status).toBe('pending');
    expect(body.submitted_at).toBeTruthy();
  });

  it('returns 400 when document_type is missing', async () => {
    const res = await POST(
      makeRequest('/api/v1/kyc/initiate', {
        body: { document_number: '12345678901' },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/document_type/i);
  });

  it('returns 400 when document_type is invalid', async () => {
    const res = await POST(
      makeRequest('/api/v1/kyc/initiate', {
        body: { document_type: 'VOTERS_CARD', document_number: '12345678901' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when document_number is too short', async () => {
    const res = await POST(
      makeRequest('/api/v1/kyc/initiate', {
        body: { document_type: 'BVN', document_number: '123' },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/document_number/i);
  });

  it('returns 503 when KYC feature flag is off', async () => {
    disableKycFlag();
    const res = await POST(
      makeRequest('/api/v1/kyc/initiate', {
        body: { document_type: 'BVN', document_number: '12345678901' },
      }),
    );
    expect(res.status).toBe(503);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(requireRequestUser).mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = await POST(
      makeRequest('/api/v1/kyc/initiate', {
        body: { document_type: 'BVN', document_number: '12345678901' },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('propagates service error status codes', async () => {
    const { ApiError } = await import('@/src/lib/api/responses');
    vi.mocked(initiateKyc).mockRejectedValue(
      new ApiError('KYC transition verified → pending is not permitted.', 409),
    );

    const res = await POST(
      makeRequest('/api/v1/kyc/initiate', {
        body: { document_type: 'BVN', document_number: '12345678901' },
      }),
    );
    expect(res.status).toBe(409);
  });
});
