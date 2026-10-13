import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AdminUsersRequestError,
  assignUserRole,
  getAdminUser,
  getLoginActivity,
  getSecurityEvents,
  getUserRoles,
  listAdminUsers,
  removeUserRole,
} from './usersService';

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

afterEach(() => vi.unstubAllGlobals());

describe('usersService read errors', () => {
  it('returns the users on success', async () => {
    respond(200, { success: true, users: [{ id: 'u1' }] });
    await expect(listAdminUsers({})).resolves.toEqual([{ id: 'u1' }]);
  });

  it('returns an empty list only for a genuinely empty result', async () => {
    respond(200, { success: true, users: [] });
    await expect(listAdminUsers({})).resolves.toEqual([]);
  });

  it.each([401, 403, 500])('throws on HTTP %i instead of returning []', async (status) => {
    respond(status, { success: false, error: 'nope' });
    const err = await listAdminUsers({}).catch((e) => e);
    expect(err).toBeInstanceOf(AdminUsersRequestError);
    expect(err.status).toBe(status);
    expect(err.message).toContain(`HTTP ${status}`);
    expect(err.message).toContain('nope');
  });

  it('throws when a 200 carries an unexpected shape', async () => {
    respond(200, { success: true });
    await expect(listAdminUsers({})).rejects.toBeInstanceOf(AdminUsersRequestError);
  });

  it('getAdminUser returns null for 404 but throws for other failures', async () => {
    respond(404, { success: false });
    await expect(getAdminUser('x')).resolves.toBeNull();
    respond(403, { success: false, error: 'forbidden' });
    await expect(getAdminUser('x')).rejects.toBeInstanceOf(AdminUsersRequestError);
  });
});

function lastCall() {
  const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  return { url: String(url), init: (init ?? {}) as RequestInit };
}

describe('usersService profile reads', () => {
  const cases: Array<[string, (id: string) => Promise<unknown>, string, Record<string, unknown>, unknown]> = [
    ['getUserRoles', getUserRoles, '/api/admin/users/u1/roles', { success: true, roles: ['admin'] }, ['admin']],
    ['getLoginActivity', getLoginActivity, '/api/admin/login-activity?actorUser=u1&limit=50', { success: true, activity: [{ a: 1 }] }, [{ a: 1 }]],
    ['getSecurityEvents', getSecurityEvents, '/api/admin/security-events?actorUser=u1&limit=50', { success: true, events: [{ e: 1 }] }, [{ e: 1 }]],
  ];
  it.each(cases)('%s hits the right URL (GET) and maps the payload', async (_n, fn, path, body, expected) => {
    respond(200, body);
    await expect(fn('u1')).resolves.toEqual(expected);
    const { url, init } = lastCall();
    expect(url.endsWith(path)).toBe(true);
    expect(init.method ?? 'GET').toBe('GET');
  });
  it.each(cases)('%s throws AdminUsersRequestError(403) on forbidden', async (_n, fn, _p, _b, _e) => {
    respond(403, { success: false, error: 'forbidden' });
    const err = await fn('u1').catch((e) => e);
    expect(err).toBeInstanceOf(AdminUsersRequestError);
    expect(err.status).toBe(403);
  });
});

describe('usersService role writes', () => {
  it('assignUserRole POSTs { roleId }', async () => {
    respond(200, { success: true });
    await expect(assignUserRole('u1', 'r1')).resolves.toBe(true);
    const { url, init } = lastCall();
    expect(url.endsWith('/api/admin/users/u1/roles')).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ roleId: 'r1' });
  });
  it('assignUserRole returns false on failure', async () => {
    respond(403, { success: false });
    await expect(assignUserRole('u1', 'r1')).resolves.toBe(false);
  });
  it('removeUserRole DELETEs the role path', async () => {
    respond(200, { success: true });
    await expect(removeUserRole('u1', 'r1')).resolves.toBe(true);
    const { url, init } = lastCall();
    expect(url.endsWith('/api/admin/users/u1/roles/r1')).toBe(true);
    expect(init.method).toBe('DELETE');
  });
  it('removeUserRole returns false on failure', async () => {
    respond(500, { success: false });
    await expect(removeUserRole('u1', 'r1')).resolves.toBe(false);
  });
});
