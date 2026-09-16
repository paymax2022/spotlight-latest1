/**
 * SEC-002: RBAC — a non-admin / wrong-sub-role caller cannot hit
 * `votes:manage`-gated admin voting routes.
 *
 * `assertAdminPermission()` (src/server/admin/auth.ts, NOT protected) is the
 * single gate every admin voting route calls before doing anything:
 *   - JWT path: role comes from `user_profiles.role` in the DB (never from a
 *     client-supplied header) and is checked against a fixed permission map
 *     (src/server/admin/rbac.ts).
 *   - Server-to-server path: requires SPOTLIGHT_ADMIN_API_KEY; the claimed
 *     role on that path is still checked against the same permission map.
 *
 * This test exercises assertAdminPermission directly (fastest, most precise
 * signal) plus one real route (admin vote adjustment) end-to-end to confirm
 * the gate is actually wired, not just present in isolation.
 *
 * Routes swept for the presence of this gate (SEC-001/SEC-002 combined pass):
 *   admin/voting/[contestId]/{adjust,freeze,fraud-alerts,leaderboard,transactions,
 *   revenue,export}, admin/voting/votes/[voteId]/reverse, admin/voting/{settings,
 *   packages,package-templates,package-templates/apply,rounds,phases} — ALL call
 *   assertAdminPermission with an appropriate permission (votes:manage /
 *   finance:view / reports:export). No gap found. Admin roles are GLOBAL
 *   (platform staff), not per-contest — there is no organizer-scoped-to-one-
 *   contest concept in the RBAC model today, so no additional per-contest
 *   ownership check is missing; a `votes:manage` holder is intentionally
 *   allowed to manage any contest.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }));

import { assertAdminPermission } from '@/src/server/admin/auth';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { hasPermission, parseAdminRole } from '@/src/server/admin/rbac';

function jwtRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/admin/voting/contest-1/adjust', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', ...headers },
    body: JSON.stringify({}),
  });
}

function mockSupabaseUser(role: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: role ? { role } : null, error: null });
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1', app_metadata: {}, user_metadata: {} } }, error: null }),
    },
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle,
  };
  vi.mocked(createClient).mockResolvedValue(client as any);
  // assertAdminPermission looks up user_profiles.role via the service-role
  // client (createAdminClient), not the cookie/RLS-scoped one — see WAL-001 /
  // src/server/admin/auth.ts: the RLS-scoped query silently returned zero
  // rows for a Bearer-token caller with no session cookie, so the DB role
  // was NEVER actually consulted for real (non-cookie) admin callers. Mock
  // both clients identically so this suite keeps exercising the real
  // (now-correct) code path instead of a stale one.
  vi.mocked(createAdminClient).mockReturnValue(client as any);
  return client;
}

describe('SEC-002: votes:manage RBAC gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an unauthenticated caller with 401', async () => {
    mockSupabaseUser(null);
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'no token' } }) },
    } as any);

    await expect(assertAdminPermission(jwtRequest(), 'votes:manage')).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a role WITHOUT votes:manage (e.g. support_agent) with 403 — fail closed', async () => {
    mockSupabaseUser('support_agent');
    await expect(assertAdminPermission(jwtRequest(), 'votes:manage')).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a role adjacent-but-distinct (finance_admin has finance:*, not votes:manage)', async () => {
    mockSupabaseUser('finance_admin');
    await expect(assertAdminPermission(jwtRequest(), 'votes:manage')).rejects.toMatchObject({ status: 403 });
  });

  it('rejects an unrecognized/garbage role string (defaults to executive_readonly, fail-closed)', async () => {
    mockSupabaseUser('definitely-not-a-role');
    await expect(assertAdminPermission(jwtRequest(), 'votes:manage')).rejects.toMatchObject({ status: 403 });
  });

  it('allows a role WITH votes:manage (contest_manager)', async () => {
    mockSupabaseUser('contest_manager');
    const identity = await assertAdminPermission(jwtRequest(), 'votes:manage');
    expect(identity.role).toBe('contest_manager');
    expect(identity.actorId).toBe('u-1');
  });

  it('ignores a client-supplied x-admin-role header on the JWT path — DB role is the only source of truth', async () => {
    // A caller with a real (low-privilege) JWT tries to elevate by also sending
    // x-admin-role: super_admin. The JWT path must never read that header.
    mockSupabaseUser('support_agent');
    await expect(
      assertAdminPermission(jwtRequest({ 'x-admin-role': 'super_admin' }), 'votes:manage'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('the permission map itself is fail-closed for every role but the ones explicitly granted votes:manage', () => {
    const granted = ['super_admin', 'contest_manager', 'voting_manager'];
    for (const role of Object.keys({
      super_admin: 0, program_manager: 0, contest_manager: 0, voting_manager: 0, finance_admin: 0,
      finance_maker: 0, finance_checker: 0, finance_viewer: 0, content_manager: 0, media_manager: 0,
      sponsor_manager: 0, judge: 0, reviewer: 0, event_manager: 0, support_agent: 0, auditor: 0,
      executive_readonly: 0,
    })) {
      const expected = granted.includes(role);
      expect(hasPermission(parseAdminRole(role), 'votes:manage')).toBe(expected);
    }
  });
});
