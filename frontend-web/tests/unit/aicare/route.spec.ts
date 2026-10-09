import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, withAuth } from '../golden-path/_fixtures';

/**
 * AI Care BFF route contract tests — prod-sweep P1.
 *
 *   POST /api/v1/support/sessions/:id/resolve  → Go POST /api/finance/support/sessions/:id/resolve
 *
 * Go mounts Resolve on the finance support group
 * (backend/internal/app/finance_routes.go — aicGroup.POST("/sessions/:id/resolve"))
 * but no BFF route file existed for it: sessions could be created and
 * escalated through the public API yet never resolved — every call 404'd at
 * Next.js routing before reaching Go.
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
  featureFlags: { aiCare: vi.fn(() => true) },
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
import { POST as resolvePOST } from '../../../app/api/v1/support/sessions/[id]/resolve/route';
import { POST as escalatePOST } from '../../../app/api/v1/support/sessions/[id]/escalate/route';
import { POST as messagePOST } from '../../../app/api/v1/support/sessions/[id]/messages/route';

const TEST_USER = { id: 'user-aicare-1', email: 'aicare@example.com' };

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('aicare BFF route → Go upstream mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureFlags.aiCare).mockReturnValue(true);
    vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER as any);
  });

  it('proxies POST /api/v1/support/sessions/:id/resolve to the finance support mount', async () => {
    const res = await resolvePOST(
      makeRequest('/api/v1/support/sessions/sess-1/resolve', { method: 'POST', headers: withAuth() }),
      idParams('sess-1')
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/support/sessions/sess-1/resolve'
    );
  });

  it('keeps the sibling session actions on the same upstream mount', async () => {
    await escalatePOST(
      makeRequest('/api/v1/support/sessions/sess-1/escalate', { method: 'POST', headers: withAuth(), body: { reason: 'r' } }),
      idParams('sess-1')
    );
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/support/sessions/sess-1/escalate'
    );

    await messagePOST(
      makeRequest('/api/v1/support/sessions/sess-1/messages', { method: 'POST', headers: withAuth(), body: { content: 'hi' } }),
      idParams('sess-1')
    );
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/support/sessions/sess-1/messages'
    );
  });

  it('refuses 503 before auth when the aiCare flag is off', async () => {
    vi.mocked(featureFlags.aiCare).mockReturnValue(false);
    const res = await resolvePOST(
      makeRequest('/api/v1/support/sessions/sess-1/resolve', { method: 'POST' }),
      idParams('sess-1')
    );
    expect(res.status).toBe(503);
    expect(vi.mocked(requireRequestUser)).not.toHaveBeenCalled();
    expect(vi.mocked(proxyToGoBackend)).not.toHaveBeenCalled();
  });
});
