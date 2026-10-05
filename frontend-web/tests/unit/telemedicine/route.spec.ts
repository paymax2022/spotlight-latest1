import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, withAuth } from '../golden-path/_fixtures';

/**
 * Telemedicine BFF route contract tests — prod-sweep P1.
 *
 *   GET  /api/v1/telemedicine/appointments              → Go GET  /api/v1/telemedicine/appointments
 *   POST /api/v1/telemedicine/appointments              → Go POST /api/finance/telemedicine/appointments (legacy mount)
 *   GET  /api/v1/telemedicine/appointments/:id          → Go GET  /api/v1/telemedicine/appointments/:id
 *   GET  /api/v1/telemedicine/appointments/:id/prescription
 *                                                       → Go GET  /api/v1/telemedicine/appointments/:id/prescription
 *
 * Go mounts the appointment reads ONLY on the v1 group
 * (backend/internal/app/finance_routes.go — ListMyAppointments,
 * GetAppointment, GetPrescription); the legacy /api/finance/telemedicine
 * group carries mutations only. The static route files exported mutations
 * but no GETs, so Next.js preferred them over the [...path] catch-all and
 * every appointment read 405'd once FEATURE_TELEMEDICINE_ENABLED flipped on.
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
  featureFlags: { telemedicine: vi.fn(() => true) },
}));

vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: vi.fn(),
}));

// Mock the proxy so tests assert the UPSTREAM PATH the route builds, without
// needing a live Go backend on GO_BACKEND_URL.
vi.mock('@/src/lib/go-backend', () => ({
  GO_BACKEND_URL: 'http://localhost:8080',
  proxyToGoBackend: vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
}));

import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { GET as listGET, POST as bookPOST } from '../../../app/api/v1/telemedicine/appointments/route';
import { GET as getByIdGET } from '../../../app/api/v1/telemedicine/appointments/[id]/route';
import { GET as prescriptionGET } from '../../../app/api/v1/telemedicine/appointments/[id]/prescription/route';

const TEST_USER = { id: 'user-tele-1', email: 'tele@example.com' };

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('telemedicine BFF route → Go upstream mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureFlags.telemedicine).mockReturnValue(true);
    vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER as any);
  });

  it('proxies GET /api/v1/telemedicine/appointments to the v1 list mount (ListMyAppointments)', async () => {
    const res = await listGET(
      makeRequest('/api/v1/telemedicine/appointments', { method: 'GET', headers: withAuth() })
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/v1/telemedicine/appointments'
    );
  });

  it('proxies GET /api/v1/telemedicine/appointments/:id to the v1 mount (GetAppointment)', async () => {
    const res = await getByIdGET(
      makeRequest('/api/v1/telemedicine/appointments/appt-1', { method: 'GET', headers: withAuth() }),
      idParams('appt-1')
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/v1/telemedicine/appointments/appt-1'
    );
  });

  it('proxies GET /api/v1/telemedicine/appointments/:id/prescription to the v1 mount (GetPrescription)', async () => {
    const res = await prescriptionGET(
      makeRequest('/api/v1/telemedicine/appointments/appt-1/prescription', { method: 'GET', headers: withAuth() }),
      idParams('appt-1')
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/v1/telemedicine/appointments/appt-1/prescription'
    );
  });

  it('keeps POST /api/v1/telemedicine/appointments on the legacy mount (BookAppointment)', async () => {
    const res = await bookPOST(
      makeRequest('/api/v1/telemedicine/appointments', { method: 'POST', headers: withAuth(), body: {} })
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/telemedicine/appointments'
    );
  });

  it('refuses 503 before auth when the telemedicine flag is off', async () => {
    vi.mocked(featureFlags.telemedicine).mockReturnValue(false);
    const res = await listGET(
      makeRequest('/api/v1/telemedicine/appointments', { method: 'GET' })
    );
    expect(res.status).toBe(503);
    expect(vi.mocked(requireRequestUser)).not.toHaveBeenCalled();
    expect(vi.mocked(proxyToGoBackend)).not.toHaveBeenCalled();
  });
});
