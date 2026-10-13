import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminUsersRequestError, getAdminUser, listAdminUsers } from './usersService';

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
