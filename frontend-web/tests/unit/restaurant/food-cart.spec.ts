import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, withAuth } from '../golden-path/_fixtures';

/**
 * Food cart BFF contract tests — wave-6 restaurant lane.
 *
 *   POST /api/v1/food/cart — snake_case wire fields must be honoured
 *   (a `restaurant_id` post used to be silently dropped → cart saved with
 *   restaurantId:null). camelCase remains canonical and wins when both arrive.
 *
 *   POST /api/v1/restaurant/bank-accounts/verify — the route was dead twice
 *   (cookie auth + wrong upstream prefix); it is now a standard
 *   flag+auth+proxy to Go's /api/finance/restaurant/bank-accounts/verify.
 */

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

vi.mock('@/src/lib/feature-flags', () => ({
  featureFlags: { restaurant: vi.fn(() => true) },
}));

vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: vi.fn(),
}));

vi.mock('@/src/lib/go-backend', () => ({
  GO_BACKEND_URL: 'http://localhost:8080',
  proxyToGoBackend: vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
}));

// Chainable Supabase stub — the cart route drives select/eq/maybeSingle,
// upsert, and delete/eq off `createAdminClient().from(table)`.
const upsertSpy = vi.fn();
const fromSpy = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: fromSpy }),
}));

function chain(result: unknown) {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.delete = () => b;
  b.maybeSingle = () => Promise.resolve(result);
  b.upsert = (payload: unknown, opts: unknown) => {
    upsertSpy(payload, opts);
    return Promise.resolve({ error: null });
  };
  // make the builder awaitable so `await ….delete().eq(…)` resolves
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return b;
}

import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { GET as cartGET, POST as cartPOST } from '../../../app/api/v1/food/cart/route';
import { POST as verifyPOST } from '../../../app/api/v1/restaurant/bank-accounts/verify/route';

const USER = { id: '648e1080-d66e-4e53-b8d8-72bc51acc3af', email: 'u@e.com' };
const REST_ID = 'c8c26e1e-01ce-40c5-8986-251babf01bb9';

function post(body: unknown) {
  return makeRequest('/api/v1/food/cart', { method: 'POST', body, headers: withAuth() });
}

describe('POST /api/v1/food/cart wire-shape tolerance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureFlags.restaurant).mockReturnValue(true);
    vi.mocked(requireRequestUser).mockResolvedValue(USER as never);
    fromSpy.mockImplementation((table: string) =>
      table === 'restaurants' ? chain({ data: { id: REST_ID }, error: null }) : chain({ data: null, error: null }),
    );
  });

  it('persists a snake_case restaurant_id (previously dropped → null)', async () => {
    const res = await cartPOST(post({ restaurant_id: REST_ID, restaurant_name: 'probe', packages: [], active_package_id: null }));
    expect(res.status).toBe(200);
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ restaurant_id: REST_ID, restaurant_name: 'probe' }),
      expect.anything(),
    );
  });

  it('camelCase is canonical and wins when both spellings arrive', async () => {
    const other = '11111111-1111-4111-8111-111111111111';
    const res = await cartPOST(post({ restaurantId: REST_ID, restaurant_id: other, packages: [] }));
    expect(res.status).toBe(200);
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ restaurant_id: REST_ID }),
      expect.anything(),
    );
  });

  it('rejects a non-UUID restaurant_id with 422', async () => {
    const res = await cartPOST(post({ restaurant_id: 'not-a-uuid', packages: [] }));
    expect(res.status).toBe(422);
  });

  it('rejects a well-formed id of a restaurant that does not exist with 404', async () => {
    fromSpy.mockImplementation((table: string) =>
      table === 'restaurants' ? chain({ data: null, error: null }) : chain({ data: null, error: null }),
    );
    const res = await cartPOST(post({ restaurant_id: REST_ID, packages: [] }));
    expect(res.status).toBe(404);
  });

  it('empty/whitespace id normalizes to null (cart with no store)', async () => {
    const res = await cartPOST(post({ restaurant_id: '   ', packages: [] }));
    expect(res.status).toBe(200);
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ restaurant_id: null }),
      expect.anything(),
    );
  });
});

describe('POST /api/v1/restaurant/bank-accounts/verify proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureFlags.restaurant).mockReturnValue(true);
    vi.mocked(requireRequestUser).mockResolvedValue(USER as never);
  });

  it('forwards to Go /api/finance/restaurant/bank-accounts/verify (the mounted prefix)', async () => {
    const res = await verifyPOST(
      makeRequest('/api/v1/restaurant/bank-accounts/verify', {
        method: 'POST',
        body: { bank_code: '058', account_number: '0123456789', account_name: 'Y Akinleye', bank_name: 'GTBank' },
        headers: withAuth(),
      }),
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/restaurant/bank-accounts/verify',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('401s when the Bearer token is absent/invalid (was: cookie-only auth)', async () => {
    vi.mocked(requireRequestUser).mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = await verifyPOST(
      makeRequest('/api/v1/restaurant/bank-accounts/verify', {
        method: 'POST',
        body: { bank_code: '058', account_number: '0123456789', account_name: 'Y', bank_name: 'GTB' },
      }),
    );
    expect(res.status).toBe(401);
    expect(vi.mocked(proxyToGoBackend)).not.toHaveBeenCalled();
  });

  it('503s when the restaurant feature flag is off', async () => {
    vi.mocked(featureFlags.restaurant).mockReturnValue(false);
    const res = await verifyPOST(
      makeRequest('/api/v1/restaurant/bank-accounts/verify', {
        method: 'POST',
        body: { bank_code: '058', account_number: '0123456789', account_name: 'Y', bank_name: 'GTB' },
        headers: withAuth(),
      }),
    );
    expect(res.status).toBe(503);
    expect(vi.mocked(proxyToGoBackend)).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/food/cart shape (regression)', () => {
  it('maps the stored row back to camelCase', async () => {
    vi.clearAllMocks();
    vi.mocked(featureFlags.restaurant).mockReturnValue(true);
    vi.mocked(requireRequestUser).mockResolvedValue(USER as never);
    fromSpy.mockImplementation(() =>
      chain({
        data: {
          restaurant_id: REST_ID,
          restaurant_name: 'probe',
          packages: [],
          active_package_id: null,
          updated_at: '2026-10-06T00:00:00Z',
        },
        error: null,
      }),
    );
    const res = await cartGET(makeRequest('/api/v1/food/cart', { method: 'GET', headers: withAuth() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.restaurantId).toBe(REST_ID);
    expect(body.data.restaurantName).toBe('probe');
  });
});
