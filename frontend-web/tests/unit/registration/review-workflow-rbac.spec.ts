/**
 * RG-006 — approval/rejection workflow (with reason), and the RBAC-guard finding.
 *
 * The test-plan note says `reviewRegistrationApplication` (the store function)
 * has no RBAC guard of its own and "depends on caller route". The only caller
 * is `app/api/admin/registration/applications/[id]/review/route.ts`, which DOES
 * gate on `assertAdminPermission(request, 'applications:review')` before calling
 * the store function — i.e. the permission check already exists one layer up,
 * exactly where CLAUDE.md's admin-route pattern puts it. This test proves that
 * gate is real (a rejected permission short-circuits before any review write)
 * and that a successful review both changes status+records a reason AND writes
 * an audit event.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/src/server/admin/audit', () => ({ addAuditEvent: vi.fn() }));
vi.mock('@/src/server/registration/supabase-store', () => ({ reviewRegistrationApplication: vi.fn() }));

import { POST } from '@/app/api/admin/registration/applications/[id]/review/route';
import { ApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';
import { reviewRegistrationApplication } from '@/src/server/registration/supabase-store';

function req(body: unknown) {
  return new Request('https://x.test/api/admin/registration/applications/app-1/review', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
function ctx() {
  return { params: Promise.resolve({ id: 'app-1' }) };
}

beforeEach(() => vi.clearAllMocks());

describe('RG-006: approval/rejection workflow', () => {
  it('a caller without applications:review permission is rejected before any write', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValue(new Error('FORBIDDEN'));

    const res = await POST(req({ status: 'approved' }), ctx());
    expect(res.status).toBe(403);
    expect(reviewRegistrationApplication).not.toHaveBeenCalled();
    expect(addAuditEvent).not.toHaveBeenCalled();
    expect(assertAdminPermission).toHaveBeenCalledWith(expect.anything(), 'applications:review');
  });

  it('rejects a request with no status', async () => {
    vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
    const res = await POST(req({ note: 'missing status' }), ctx());
    expect(res.status).toBe(400);
    expect(reviewRegistrationApplication).not.toHaveBeenCalled();
  });

  it('an authorized approval records the status + reason and writes an audit event', async () => {
    vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
    vi.mocked(reviewRegistrationApplication).mockResolvedValue({ id: 'app-1', status: 'approved' } as any);

    const res = await POST(req({ status: 'approved', note: 'Looks great' }), ctx());
    expect(res.status).toBe(200);
    expect(reviewRegistrationApplication).toHaveBeenCalledWith('app-1', { status: 'approved', note: 'Looks great' });
    expect(addAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'registration_application_review',
      entityId: 'app-1',
      newValue: { status: 'approved' },
      reason: 'Looks great',
    }));
  });

  it('a rejection is recorded the same way, with its own reason', async () => {
    vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
    vi.mocked(reviewRegistrationApplication).mockResolvedValue({ id: 'app-1', status: 'rejected' } as any);

    const res = await POST(req({ status: 'rejected', note: 'Incomplete media upload' }), ctx());
    expect(res.status).toBe(200);
    expect(reviewRegistrationApplication).toHaveBeenCalledWith('app-1', { status: 'rejected', note: 'Incomplete media upload' });
    expect(addAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ newValue: { status: 'rejected' }, reason: 'Incomplete media upload' }));
  });

  /**
   * THE REPORTED DEFECT, AT THE HTTP BOUNDARY.
   *
   * localhost:3001/admin/registration answered
   *   "Reviewing application failed: Failed to review registration application"
   * for a review that was refused on purpose (the applicant has not ticked a
   * required consent). The row's `Fraud flags: missing_id_number` line looked
   * like the cause and is not one — nothing in the review path blocks on
   * fraud_flags. The real defect is this response: `handleApiError` passes a
   * message and status through only for an `ApiError`, so a refusal thrown as a
   * plain `Error` came back as a bare 500 carrying the route's fallback
   * sentence — indistinguishable from a crash, and with nothing the admin could
   * act on. A refusal must arrive as 409 + the reason + a machine code.
   */
  it('a refusal from the store reaches the admin as 409 + reason + code, never a bare 500', async () => {
    vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
    vi.mocked(reviewRegistrationApplication).mockRejectedValue(
      new ApiError(
        'Cannot approve: applicant has not consented to public voting visibility (publicProfile.publicVotingConsent consent missing). Set the application to "More information requested" so the applicant can confirm it.',
        409,
        'consent_voting_visibility_required',
      ),
    );

    const res = await POST(req({ status: 'approved' }), ctx());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/public voting visibility/);
    expect(body.error).toMatch(/more information requested/i);
    expect(body.code).toBe('consent_voting_visibility_required');
    expect(body.error).not.toBe('Failed to review registration application');
    expect(addAuditEvent).not.toHaveBeenCalled();
  });

  it('a genuine server-side fault still answers the generic 500 (the fix is not an internals dump)', async () => {
    vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
    vi.mocked(reviewRegistrationApplication).mockRejectedValue(
      new Error('Failed to review registration: duplicate key value violates unique constraint "x"'),
    );

    const res = await POST(req({ status: 'approved' }), ctx());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to review registration application');
    expect(JSON.stringify(body)).not.toContain('duplicate key');
  });
});
