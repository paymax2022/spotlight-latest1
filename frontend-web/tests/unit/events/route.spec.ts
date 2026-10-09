import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, withAuth } from '../golden-path/_fixtures';

/**
 * Events BFF route contract tests — wave-6 provider-lane prod probe.
 *
 * Two dead surfaces existed because static leaf routes shadowed the
 * [...path] catch-all while exporting fewer methods:
 *
 *   GET  /api/v1/events            → 405 (route.ts exported only POST) —
 *                                    Go serves ListEvents at GET /api/finance/events;
 *                                    mobile's listEvents() was dead via the BFF.
 *   GET  /api/v1/events/my/tickets → 405 ([id]/tickets is the more-specific match
 *                                    for the 2-segment path; it exported only POST) —
 *                                    mobile's listMyTickets() was dead via the BFF.
 *   POST /api/v1/events/scan       → 405 ([id] shadows the catch-all for the
 *                                    single-segment path and exported only GET) —
 *                                    steward ticket scan was dead via the BFF
 *                                    while /api/finance/events/scan worked.
 *
 * A real event id on the tickets leaf still proxies through and gets the
 * honest upstream answer (Go has no GET /:id/tickets → 404), identical to
 * what the catch-all would have produced.
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
  featureFlags: { events: vi.fn(() => true) },
}));

vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: vi.fn(),
}));

vi.mock('@/src/lib/go-backend', () => ({
  GO_BACKEND_URL: 'http://localhost:8080',
  proxyToGoBackend: vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
}));

import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { GET as rootGET, POST as rootPOST, HEAD as rootHEAD } from '../../../app/api/v1/events/route';
import { GET as ticketsGET, POST as ticketsPOST } from '../../../app/api/v1/events/[id]/tickets/route';
import { POST as scanPOST } from '../../../app/api/v1/events/scan/route';

const TEST_USER = { id: 'user-ev-1', email: 'ev@example.com' };

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('events BFF route → Go upstream mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureFlags.events).mockReturnValue(true);
    vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER as any);
  });

  it('proxies GET /api/v1/events to the Go list mount (ListEvents)', async () => {
    const res = await rootGET(makeRequest('/api/v1/events', { method: 'GET', headers: withAuth() }));
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(expect.anything(), '/api/finance/events');
  });

  it('still proxies POST /api/v1/events (CreateEvent)', async () => {
    const res = await rootPOST(
      makeRequest('/api/v1/events', { method: 'POST', headers: withAuth(), body: {} })
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(expect.anything(), '/api/finance/events');
  });

  it('proxies HEAD /api/v1/events upstream as HEAD', async () => {
    const res = await rootHEAD(makeRequest('/api/v1/events', { method: 'HEAD', headers: withAuth() }));
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/events',
      { method: 'HEAD' }
    );
  });

  it('un-shadows GET /api/v1/events/my/tickets → Go GET /api/finance/events/my/tickets', async () => {
    const res = await ticketsGET(
      makeRequest('/api/v1/events/my/tickets', { method: 'GET', headers: withAuth() }),
      idParams('my')
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/events/my/tickets'
    );
  });

  it('keeps POST /api/v1/events/:id/tickets proxying verbatim (upstream owns the answer)', async () => {
    const res = await ticketsPOST(
      makeRequest('/api/v1/events/ev-1/tickets', { method: 'POST', headers: withAuth(), body: {} }),
      idParams('ev-1')
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/events/ev-1/tickets'
    );
  });

  it('un-shadows POST /api/v1/events/scan → Go POST /api/finance/events/scan', async () => {
    const res = await scanPOST(
      makeRequest('/api/v1/events/scan', { method: 'POST', headers: withAuth(), body: {} })
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/events/scan'
    );
  });

  it('refuses 503 before auth when the events flag is off', async () => {
    vi.mocked(featureFlags.events).mockReturnValue(false);
    const res = await rootGET(makeRequest('/api/v1/events', { method: 'GET' }));
    expect(res.status).toBe(503);
    expect(vi.mocked(requireRequestUser)).not.toHaveBeenCalled();
    expect(vi.mocked(proxyToGoBackend)).not.toHaveBeenCalled();
  });
});
