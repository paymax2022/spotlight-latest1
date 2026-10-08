import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Doctor bank-accounts/verify flag gate — wave-6 provider-lane prod probe.
 *
 * FEATURE_DOCTOR_ENABLED is OFF on prod: the whole /api/v1/doctor/* Go surface
 * is unmounted and every path through the [...path] catch-all correctly 404s.
 * This leaf route answered its own validation errors (400) instead — an
 * error-shape oracle revealing the route exists on a dark module, and a door
 * into a bank-resolve call on an upstream that does not exist. It now gates
 * on the doctor flag first and fails closed 503.
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
  featureFlags: { doctor: vi.fn(() => false) },
}));

vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: vi.fn(async () => ({ id: 'u-1' })),
}));

vi.mock('@/src/lib/go-backend', () => ({
  proxyToGoBackend: vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
}));

import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { ApiError } from '@/src/lib/api/responses';
import { POST } from '../../../app/api/v1/doctor/bank-accounts/verify/route';

function req(body: unknown) {
  return new Request('https://app.test/api/v1/doctor/bank-accounts/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;
}

describe('doctor bank-accounts/verify flag gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureFlags.doctor).mockReturnValue(false);
  });

  it('fails closed 503 when FEATURE_DOCTOR_ENABLED is off — no validation leak', async () => {
    const res = await POST(req({ bank_code: '058', account_number: '0123456789' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/not available/i);
  });

  it('requires auth before proxying when the flag is on', async () => {
    // Auth runs BEFORE any proxying — an anonymous request can no longer reach
    // the upstream even when the module flag is on.
    vi.mocked(featureFlags.doctor).mockReturnValue(true);
    vi.mocked(requireRequestUser).mockRejectedValueOnce(new ApiError('Unauthorized', 401));
    const res = await POST(req({ bank_code: '058', account_number: '0123456789' }));
    expect(res.status).toBe(401);
    expect(vi.mocked(proxyToGoBackend)).not.toHaveBeenCalled();
  });

  it('proxies to Go when the flag is on and the caller is authenticated', async () => {
    vi.mocked(featureFlags.doctor).mockReturnValue(true);
    const res = await POST(req({ bank_code: '058', account_number: '0123456789' }));
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalled();
  });
});
