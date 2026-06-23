/**
 * Virtual accounts route contract tests.
 *   GET /api/v1/virtual-accounts/me
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('@/src/server/kyc/gate', () => ({
  requireKycTier: vi.fn(),
}));

vi.mock('@/src/server/virtual-accounts/service', () => ({
  getVirtualAccount: vi.fn(),
}));

import { GET } from '../../../app/api/v1/virtual-accounts/me/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireKycTier } from '@/src/server/kyc/gate';
import { getVirtualAccount } from '@/src/server/virtual-accounts/service';

const TEST_USER = { id: 'user-001', email: 'test@example.com' };

function enableFlag() { process.env.FEATURE_VIRTUAL_ACCOUNTS_ENABLED = 'true'; }
function disableFlag() { delete process.env.FEATURE_VIRTUAL_ACCOUNTS_ENABLED; }

function authAsUser() {
  vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER as any);
  vi.mocked(requireKycTier).mockResolvedValue(undefined);
}

const DVA_ROW = {
  id: 'dva-001',
  user_id: 'user-001',
  provider: 'paystack',
  customer_code: 'CUS_123',
  account_number: '1234567890',
  account_name: 'SPOTLIGHT / TEST',
  bank_name: 'Wema Bank',
  bank_code: '945',
  currency: 'NGN',
  provisioned_at: '2026-06-13T12:00:00Z',
};

describe('GET /api/v1/virtual-accounts/me', () => {
  beforeEach(() => { vi.clearAllMocks(); authAsUser(); enableFlag(); });
  afterEach(disableFlag);

  it('returns 200 with account details when provisioned', async () => {
    vi.mocked(getVirtualAccount).mockResolvedValue(DVA_ROW as any);

    const res = await GET(new Request('http://localhost/api/v1/virtual-accounts/me'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.provisioned).toBe(true);
    expect(body.account?.account_number).toBe('1234567890');
    expect(body.account?.bank_name).toBe('Wema Bank');
  });

  it('returns 200 with account=null when not yet provisioned', async () => {
    vi.mocked(getVirtualAccount).mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/v1/virtual-accounts/me'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.provisioned).toBe(false);
    expect(body.account).toBeNull();
  });

  it('returns 503 when virtual accounts feature flag is off', async () => {
    disableFlag();
    const res = await GET(new Request('http://localhost/api/v1/virtual-accounts/me'));
    expect(res.status).toBe(503);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(requireRequestUser).mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = await GET(new Request('http://localhost/api/v1/virtual-accounts/me'));
    expect(res.status).toBe(401);
  });

  it('returns 403 when KYC tier is insufficient', async () => {
    const { ApiError } = await import('@/src/lib/api/responses');
    vi.mocked(requireKycTier).mockRejectedValue(new ApiError('KYC Tier 1 required.', 403));
    const res = await GET(new Request('http://localhost/api/v1/virtual-accounts/me'));
    expect(res.status).toBe(403);
  });

  it('returns 500 when service throws an unexpected error', async () => {
    vi.mocked(getVirtualAccount).mockRejectedValue(new Error('DB connection lost'));
    const res = await GET(new Request('http://localhost/api/v1/virtual-accounts/me'));
    expect(res.status).toBe(500);
  });
});
