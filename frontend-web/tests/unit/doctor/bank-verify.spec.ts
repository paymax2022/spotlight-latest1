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

import { featureFlags } from '@/src/lib/feature-flags';
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

  it('still validates when the flag is on', async () => {
    vi.mocked(featureFlags.doctor).mockReturnValue(true);
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });
});
