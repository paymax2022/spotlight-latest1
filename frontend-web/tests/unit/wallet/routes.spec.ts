/**
 * Wallet route handler contract tests.
 *   GET  /api/v1/wallet/balance
 *   GET  /api/v1/wallet/transactions
 *   POST /api/v1/wallet/topup
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

vi.mock('@/src/server/kyc/gate', () => ({
  requireKycTier: vi.fn(),
}));

vi.mock('@/src/server/wallet/service', () => ({
  getBalance: vi.fn(),
  listTransactions: vi.fn(),
  createTopupIntent: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { GET as getBalance } from '../../../app/api/v1/wallet/balance/route';
import { GET as getTransactions } from '../../../app/api/v1/wallet/transactions/route';
import { POST as postTopup } from '../../../app/api/v1/wallet/topup/route';

import { requireRequestUser } from '@/src/lib/auth/request';
import { requireKycTier } from '@/src/server/kyc/gate';
import { getBalance as getBalanceSvc, listTransactions, createTopupIntent } from '@/src/server/wallet/service';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_USER = { id: 'user-001', email: 'wallet@example.com' };

function enableWalletFlag() { process.env.FEATURE_WALLET_ENABLED = 'true'; }
function disableWalletFlag() { delete process.env.FEATURE_WALLET_ENABLED; }

function authAsUser() {
  vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER as any);
  vi.mocked(requireKycTier).mockResolvedValue(undefined);
}

// ── Tests: GET /api/v1/wallet/balance ─────────────────────────────────────────

describe('GET /api/v1/wallet/balance', () => {
  beforeEach(() => { vi.clearAllMocks(); authAsUser(); enableWalletFlag(); });
  afterEach(disableWalletFlag);

  it('returns 200 with balance data for a verified user', async () => {
    vi.mocked(getBalanceSvc).mockResolvedValue({
      available_kobo: 250_000,
      currency: 'NGN',
      account_id: 'account-001',
    });

    const res = await getBalance(new Request('http://localhost/api/v1/wallet/balance'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.available_kobo).toBe(250_000);
    expect(body.currency).toBe('NGN');
  });

  it('returns 503 when wallet feature flag is off', async () => {
    disableWalletFlag();
    const res = await getBalance(new Request('http://localhost/api/v1/wallet/balance'));
    expect(res.status).toBe(503);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(requireRequestUser).mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = await getBalance(new Request('http://localhost/api/v1/wallet/balance'));
    expect(res.status).toBe(401);
  });

  it('returns 403 when user KYC tier is insufficient', async () => {
    const { ApiError } = await import('@/src/lib/api/responses');
    vi.mocked(requireKycTier).mockRejectedValue(
      new ApiError('KYC Tier 1 required.', 403),
    );
    const res = await getBalance(new Request('http://localhost/api/v1/wallet/balance'));
    expect(res.status).toBe(403);
  });
});

// ── Tests: GET /api/v1/wallet/transactions ────────────────────────────────────

describe('GET /api/v1/wallet/transactions', () => {
  beforeEach(() => { vi.clearAllMocks(); authAsUser(); enableWalletFlag(); });
  afterEach(disableWalletFlag);

  it('returns 200 with transaction list', async () => {
    const txns = [
      { id: 'e1', type: 'CREDIT', amount_kobo: 100_000, created_at: '2026-06-13T10:00:00Z' },
    ];
    vi.mocked(listTransactions).mockResolvedValue(txns as any);

    const res = await getTransactions(
      new Request('http://localhost/api/v1/wallet/transactions?limit=10&offset=0'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.transactions).toHaveLength(1);
    expect(body.meta.limit).toBe(10);
    expect(body.meta.offset).toBe(0);
  });

  it('returns 503 when wallet feature flag is off', async () => {
    disableWalletFlag();
    const res = await getTransactions(new Request('http://localhost/api/v1/wallet/transactions'));
    expect(res.status).toBe(503);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(requireRequestUser).mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = await getTransactions(new Request('http://localhost/api/v1/wallet/transactions'));
    expect(res.status).toBe(401);
  });

  it('returns 403 when KYC tier insufficient', async () => {
    const { ApiError } = await import('@/src/lib/api/responses');
    vi.mocked(requireKycTier).mockRejectedValue(new ApiError('KYC Tier 1 required.', 403));
    const res = await getTransactions(new Request('http://localhost/api/v1/wallet/transactions'));
    expect(res.status).toBe(403);
  });
});

// ── Tests: POST /api/v1/wallet/topup ─────────────────────────────────────────

describe('POST /api/v1/wallet/topup', () => {
  beforeEach(() => { vi.clearAllMocks(); authAsUser(); enableWalletFlag(); });
  afterEach(disableWalletFlag);

  function topupRequest(body: unknown, idempotencyKey = 'idem-key-001') {
    return makeRequest('/api/v1/wallet/topup', {
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  it('returns 201 with authorization_url on new topup', async () => {
    vi.mocked(createTopupIntent).mockResolvedValue({
      alreadyProcessed: false,
      intentId: 'intent-001',
      paymentReference: 'TOPUP_ABC123',
      authorizationUrl: 'https://checkout.paystack.com/xyz',
      amountKobo: 50_000,
    });

    const res = await postTopup(topupRequest({ amount_kobo: 50_000 }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.authorization_url).toBe('https://checkout.paystack.com/xyz');
    expect(body.already_processed).toBe(false);
  });

  it('returns 200 (not 201) when idempotent repeat', async () => {
    vi.mocked(createTopupIntent).mockResolvedValue({
      alreadyProcessed: true,
      intentId: 'intent-001',
      paymentReference: 'TOPUP_ABC123',
      authorizationUrl: 'https://checkout.paystack.com/xyz',
      amountKobo: 50_000,
    });

    const res = await postTopup(topupRequest({ amount_kobo: 50_000 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already_processed).toBe(true);
  });

  it('returns 400 when Idempotency-Key header is missing', async () => {
    const req = makeRequest('/api/v1/wallet/topup', { body: { amount_kobo: 50_000 } });
    const res = await postTopup(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/idempotency-key/i);
  });

  it('returns 400 when amount_kobo is missing', async () => {
    const res = await postTopup(topupRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/amount_kobo/i);
  });

  it('returns 400 when amount_kobo is a float', async () => {
    const res = await postTopup(topupRequest({ amount_kobo: 99.99 }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when amount_kobo is zero or negative', async () => {
    const res = await postTopup(topupRequest({ amount_kobo: 0 }));
    expect(res.status).toBe(400);
  });

  it('propagates 400 from service (below minimum topup)', async () => {
    const { ApiError } = await import('@/src/lib/api/responses');
    vi.mocked(createTopupIntent).mockRejectedValue(
      new ApiError('Minimum topup amount is 10000 kobo (₦100).', 400),
    );

    const res = await postTopup(topupRequest({ amount_kobo: 500 }));
    expect(res.status).toBe(400);
  });

  it('returns 503 when wallet feature flag is off', async () => {
    disableWalletFlag();
    const res = await postTopup(topupRequest({ amount_kobo: 50_000 }));
    expect(res.status).toBe(503);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(requireRequestUser).mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = await postTopup(topupRequest({ amount_kobo: 50_000 }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when KYC tier insufficient', async () => {
    const { ApiError } = await import('@/src/lib/api/responses');
    vi.mocked(requireKycTier).mockRejectedValue(new ApiError('KYC Tier 1 required.', 403));
    const res = await postTopup(topupRequest({ amount_kobo: 50_000 }));
    expect(res.status).toBe(403);
  });
});
