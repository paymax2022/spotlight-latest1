/**
 * ESTD-D027 — estate maker-checker BFF proxy (EST-UAT-0421 / EST-UAT-0428).
 *
 * The four-eyes rules live in Go (dual_control.go, live-DB tested). The BFF must:
 * 503 with the flag off, demand Idempotency-Key on create/approve, refuse
 * non-admins and malformed ids before proxying, and forward to the caller's
 * estate-scoped Go route.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } });
    }
  },
}));
vi.mock('@/src/lib/feature-flags', () => ({ featureFlags: { estateDualControl: vi.fn() } }));
vi.mock('@/src/lib/auth/request', () => ({ requireRequestUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock('@/src/server/estate/resident', () => ({ getResidentContext: vi.fn() }));
vi.mock('@/src/lib/go-backend', () => ({ proxyToGoBackend: vi.fn() }));

import { GET as listApprovals, POST as createApproval } from '../../../app/api/v1/estate/admin/approvals/route';
import { POST as approve } from '../../../app/api/v1/estate/admin/approvals/[id]/approve/route';
import { POST as reject } from '../../../app/api/v1/estate/admin/approvals/[id]/reject/route';
import { GET as thresholds } from '../../../app/api/v1/estate/admin/approval-thresholds/route';
import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getResidentContext } from '@/src/server/estate/resident';
import { proxyToGoBackend } from '@/src/lib/go-backend';

const ESTATE = '0f0e0d0c-0b0a-4908-8706-050403020100';
const RID = '11111111-2222-4333-8444-555555555555';
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function req(method: string, headers: Record<string, string> = {}, body?: unknown) {
  return new Request('http://localhost/api/v1/estate/admin/approvals', {
    method,
    headers: { Authorization: 'Bearer t', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(featureFlags.estateDualControl).mockReturnValue(true);
  vi.mocked(requireRequestUser).mockResolvedValue({ id: 'admin-a' } as any);
  vi.mocked(getResidentContext).mockResolvedValue({ estateId: ESTATE, unit: 'A1', role: 'estate_admin' });
  vi.mocked(proxyToGoBackend).mockReset();
  vi.mocked(proxyToGoBackend).mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
});

describe('estate approvals BFF', () => {
  it('503s every route when FEATURE_ESTATE_DUAL_CONTROL_ENABLED is off (today\'s behaviour)', async () => {
    vi.mocked(featureFlags.estateDualControl).mockReturnValue(false);
    const results = await Promise.all([
      listApprovals(req('GET')),
      createApproval(req('POST', { 'Idempotency-Key': 'k-12345678' }, { action: 'resident_ban' })),
      approve(req('POST', { 'Idempotency-Key': 'k-12345678' }), params(RID)),
      reject(req('POST'), params(RID)),
      thresholds(req('GET')),
    ]);
    for (const r of results) expect(r.status).toBe(503);
    expect(proxyToGoBackend).not.toHaveBeenCalled();
  });

  it('requires Idempotency-Key on create (maker) and approve (checker)', async () => {
    expect((await createApproval(req('POST', {}, { action: 'vendor_payout', subject_id: RID }))).status).toBe(400);
    expect((await approve(req('POST'), params(RID))).status).toBe(400);
    expect(proxyToGoBackend).not.toHaveBeenCalled();
  });

  it('refuses non-admin residents before proxying', async () => {
    vi.mocked(getResidentContext).mockResolvedValue({ estateId: ESTATE, unit: 'A1', role: 'resident' });
    const r = await approve(req('POST', { 'Idempotency-Key': 'k-12345678' }), params(RID));
    expect(r.status).toBe(403);
    expect(proxyToGoBackend).not.toHaveBeenCalled();
  });

  it('rejects malformed approval ids', async () => {
    expect((await approve(req('POST', { 'Idempotency-Key': 'k-12345678' }), params('not-a-uuid'))).status).toBe(400);
    expect((await reject(req('POST'), params('1; drop'))).status).toBe(400);
    expect(proxyToGoBackend).not.toHaveBeenCalled();
  });

  it('forwards to the caller\'s estate-scoped Go routes', async () => {
    await listApprovals(req('GET'));
    await createApproval(req('POST', { 'Idempotency-Key': 'k-12345678' }, { action: 'role_grant', subject_id: RID }));
    await approve(req('POST', { 'Idempotency-Key': 'k-87654321' }), params(RID));
    await reject(req('POST'), params(RID));
    await thresholds(req('GET'));
    const paths = vi.mocked(proxyToGoBackend).mock.calls.map((c) => c[1]);
    expect(paths).toEqual([
      `/api/finance/estate/${ESTATE}/admin/approvals`,
      `/api/finance/estate/${ESTATE}/admin/approvals`,
      `/api/finance/estate/${ESTATE}/admin/approvals/${RID}/approve`,
      `/api/finance/estate/${ESTATE}/admin/approvals/${RID}/reject`,
      `/api/finance/estate/${ESTATE}/admin/approval-thresholds`,
    ]);
  });

  it('passes the Go status through (e.g. 403 on self-approval)', async () => {
    vi.mocked(proxyToGoBackend).mockResolvedValue(new Response('{"error":"a different estate admin must approve"}', { status: 403 }));
    const r = await approve(req('POST', { 'Idempotency-Key': 'k-12345678' }), params(RID));
    expect(r.status).toBe(403);
  });
});
