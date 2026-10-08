/**
 * CS-007 — paid-vote packages CRUD (price, quantity, minor-unit correctness).
 *
 * Exercises `app/api/admin/voting/packages/route.ts` directly. Supabase and
 * the admin RBAC gate are mocked at their module boundary, mirroring
 * `tests/unit/estate/dues.money-path.spec.ts`'s pattern — this asserts the
 * route's OWN contract (input validation, camelCase<->snake_case mapping,
 * the empty-string-datetime guard, audit logging) rather than Postgres itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/voting/audit.service', () => ({ appendAuditLog: vi.fn() }));

import { GET, POST, PATCH, DELETE } from '@/app/api/admin/voting/packages/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { appendAuditLog } from '@/src/server/voting/audit.service';

function req(method: string, body?: unknown, url = 'https://x.test/api/admin/voting/packages') {
  return new Request(url, { method, body: body ? JSON.stringify(body) : undefined });
}

function makeSupabase(opts: { insertResult?: any; listResult?: any[]; updateResult?: any }) {
  const calls: any = { insertPayload: null, updatePayload: null };
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve({ data: opts.listResult ?? [], error: null }),
    insert: (payload: any) => { calls.insertPayload = payload; return chain; },
    update: (payload: any) => { calls.updatePayload = payload; return chain; },
    single: () => Promise.resolve({ data: opts.insertResult ?? opts.updateResult ?? null, error: null }),
  };
  return { client: { from: () => chain }, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
});

describe('CS-007: vote packages CRUD', () => {
  it('POST rejects a package with non-positive votes', async () => {
    const res = await POST(req('POST', { contestId: 'c1', name: 'Starter', votes: 0, amount: 500 }));
    expect(res.status).toBe(400);
  });

  it('POST rejects a package missing amount (minor-unit price)', async () => {
    const res = await POST(req('POST', { contestId: 'c1', name: 'Starter', votes: 10 }));
    expect(res.status).toBe(400);
  });

  it('POST rejects a package missing contestId or name', async () => {
    expect((await POST(req('POST', { name: 'x', votes: 1, amount: 1 }))).status).toBe(400);
    expect((await POST(req('POST', { contestId: 'c1', votes: 1, amount: 1 }))).status).toBe(400);
  });

  it('POST inserts a valid package with correct field mapping and audits it', async () => {
    const created = { id: 'pkg-1', contest_id: 'c1', name: 'Starter', votes: 10, amount: 50000 };
    const { client, calls } = makeSupabase({ insertResult: created });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await POST(req('POST', {
      contestId: 'c1', name: 'Starter', votes: 10, bonusVotes: 2, amount: 50000, currency: 'NGN',
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.package).toEqual(created);

    // amount is passed through verbatim — the caller is responsible for minor
    // units (kobo); the route must not silently rescale it.
    expect(calls.insertPayload).toMatchObject({ contest_id: 'c1', name: 'Starter', votes: 10, bonus_votes: 2, amount: 50000 });
    expect(appendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'vote_package_created', entityId: 'pkg-1' }));
  });

  it('GET normalizes snake_case rows to the camelCase shape the admin page reads', async () => {
    const row = { id: 'pkg-1', is_active: false, is_recommended: true, bonus_votes: 3, promo_label: 'x', display_order: 2, starts_at: null, ends_at: null };
    const { client } = makeSupabase({ listResult: [row] });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await GET(req('GET', undefined, 'https://x.test/api/admin/voting/packages'));
    const body = await res.json();
    expect(body.packages[0]).toMatchObject({ isActive: false, isRecommended: true, bonusVotes: 3, promoLabel: 'x', displayOrder: 2 });
  });

  it('PATCH clears an empty-string startsAt/endsAt to null instead of sending "" to a timestamptz column', async () => {
    const { client, calls } = makeSupabase({ updateResult: { id: 'pkg-1' } });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await PATCH(req('PATCH', { id: 'pkg-1', startsAt: '', endsAt: '2026-01-01T00:00:00Z' }));
    expect(res.status).toBe(200);
    expect(calls.updatePayload.starts_at).toBeNull();
    expect(calls.updatePayload.ends_at).toBe('2026-01-01T00:00:00Z');
  });

  it('PATCH requires an id', async () => {
    const res = await PATCH(req('PATCH', { name: 'x' }));
    expect(res.status).toBe(400);
  });

  it('DELETE soft-deactivates (is_active=false) rather than removing the row, and audits it', async () => {
    const { client, calls } = makeSupabase({});
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await DELETE(req('DELETE', undefined, 'https://x.test/api/admin/voting/packages?id=pkg-1'));
    expect(res.status).toBe(200);
    expect(calls.updatePayload).toEqual({ is_active: false });
    expect(appendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'vote_package_deactivated', entityId: 'pkg-1' }));
  });

  it('every mutating route requires the votes:manage admin permission', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new Error('Forbidden'));
    await expect(POST(req('POST', { contestId: 'c1', name: 'x', votes: 1, amount: 1 }))).resolves.toBeDefined();
    expect(assertAdminPermission).toHaveBeenCalledWith(expect.anything(), 'votes:manage');
  });
});
