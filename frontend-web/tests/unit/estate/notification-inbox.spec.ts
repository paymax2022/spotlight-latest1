/**
 * Estate notification inbox BFF tests (estate-d EST-UAT-0359 / ESTD-D008, close-out Phase 2.5a).
 *
 * These pin the BFF against the rules that live in backend/internal/estate/notifications_retention.go,
 * because the two surfaces answer the same UAT row and must not drift:
 *  - the list is an envelope with `total`, pinned-first ordering and three views (active/archived/all);
 *  - a bad state, category, 1-character search or out-of-range limit is the caller's 400, not a 500;
 *  - every personal write is owner-scoped, and "not yours" answers the same 404 as "not here";
 *  - only an estate admin reaches the retention plane, and a pin named for another user is admin-only;
 *  - archiving the read state, and never archiving into `read-all`;
 *  - an estate with no policy row reads back the documented defaults, flagged `defaulted`.
 *
 * The stub records the filter chain each route issues, so the assertions are about the query the caller
 * asked for rather than about the fake's own behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: class {
    status: number;
    body: unknown;
    constructor(body?: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    static json(body: unknown, init?: { status?: number }) {
      return new this(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } });
    }
    async json() { return JSON.parse(String(this.body) ?? 'null'); }
  },
}));

vi.mock('@/src/lib/auth/request', () => ({ requireRequestUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/estate/resident', () => ({ getResidentContext: vi.fn(), resolveNames: vi.fn() }));

import { GET as listInbox } from '../../../app/api/v1/estate/notifications/route';
import { POST as markRead } from '../../../app/api/v1/estate/notifications/[id]/read/route';
import { POST as setArchived } from '../../../app/api/v1/estate/notifications/[id]/archive/route';
import { POST as setPinned } from '../../../app/api/v1/estate/notifications/[id]/pin/route';
import { POST as readAll } from '../../../app/api/v1/estate/notifications/read-all/route';
import { GET as getRetention, PUT as putRetention } from '../../../app/api/v1/estate/notifications/retention/route';
import { POST as runRetention } from '../../../app/api/v1/estate/notifications/retention/run/route';

import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';
import { ApiError } from '@/src/lib/api/responses';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ESTATE = '33333333-3333-4333-8333-333333333333';
const NOTIF = '44444444-4444-4444-8444-444444444444';

type Row = Record<string, any>;
type Step = { table: string; op: string; args: any[] };

interface Fixture {
  rows?: Row[];
  /** The row a single-row owner lookup finds. null means "no such row for this recipient". */
  ownRow?: Row | null;
  policy?: Row | null;
  rpcResult?: any;
  rpcError?: any;
}

function makeClient(fx: Fixture = {}) {
  const log: Step[] = [];
  let updates: Row[] = [];
  let inserts: Row[] = [];
  let upserts: Row[] = [];
  // The policy table is held statefully: writeRetentionPolicy() reads the row back after writing it, and
  // a stub that kept answering the pre-write fixture would "prove" the write landed when it did not.
  let policy: Row | null | undefined = fx.policy;
  const calls: { rpc?: { fn: string; args: any } } = {};

  const step = (table: string, op: string, args: any[]) => { log.push({ table, op, args }); };

  function chain(table: string, opts: Record<string, any> = {}): any {
    const self: any = {
      select: (cols: string, o?: any) => { step(table, 'select', [cols, o]); return self; },
      eq: (c: string, v: unknown) => { step(table, 'eq', [c, v]); return self; },
      is: (c: string, v: unknown) => { step(table, 'is', [c, v]); return self; },
      not: (c: string, o: string, v: unknown) => { step(table, 'not', [c, o, v]); return self; },
      or: (f: string) => { step(table, 'or', [f]); return self; },
      order: (c: string, o?: any) => { step(table, 'order', [c, o]); return self; },
      range: (a: number, b: number) => { step(table, 'range', [a, b]); return self; },
      limit: (n: number) => { step(table, 'limit', [n]); return self; },
      update: (p: Row) => { step(table, 'update', [p]); updates.push(p); return self; },
      insert: (p: Row) => { step(table, 'insert', [p]); inserts.push(p); return self; },
      upsert: (p: Row, o?: any) => {
        step(table, 'upsert', [p, o]);
        upserts.push(p);
        if (table === 'estate_notification_retention_policies') policy = { ...(policy ?? {}), ...p };
        return self;
      },
      maybeSingle: async () => ({
        data: table === 'estate_notification_retention_policies' ? (policy === undefined ? null : policy)
          : (fx.ownRow === undefined ? null : fx.ownRow),
        error: null,
      }),
      single: async () => ({ data: updates[updates.length - 1] ? { ...fx.ownRow, ...updates[updates.length - 1] } : (fx.ownRow ?? null), error: null }),
      then: (ok: any) => Promise.resolve({ data: fx.rows ?? [], count: fx.rows?.length ?? 0, error: null }).then(ok),
    };
    void opts;
    return self;
  }

  return {
    from: (t: string) => chain(t),
    rpc: async (fn: string, args: any) => {
      calls.rpc = { fn, args };
      return fx.rpcError ? { data: null, error: fx.rpcError } : { data: fx.rpcResult, error: null };
    },
    log,
    get updates() { return updates; },
    get inserts() { return inserts; },
    get upserts() { return upserts; },
    get rpcCall() { return calls.rpc; },
  };
}

function req(method: string, url: string, body?: any) {
  return new Request(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  }) as any;
}
const params = (o: Record<string, string>) => ({ params: Promise.resolve(o) }) as any;

const activeRow = (over: Row = {}) => ({
  id: NOTIF, estate_id: ESTATE, user_id: USER, category: 'announcement', title: 'Water supply maintenance',
  body: 'Water off 9am-12pm Saturday', deep_link: '/announcements', read_at: null, archived_at: null,
  pinned: false, created_at: '2026-10-20T09:00:00Z', ...over,
});

const member = { estateId: ESTATE, unit: 'A1', role: 'resident' };
const admin = { estateId: ESTATE, unit: 'A1', role: 'estate_admin' };

function hasFilter(log: Step[], table: string, op: string, ...match: unknown[]) {
  return log.some((s) => s.table === table && s.op === op && match.every((m, i) => s.args[i] === m));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRequestUser).mockResolvedValue({ id: USER } as any);
  vi.mocked(getResidentContext).mockResolvedValue(member as any);
});

describe('GET /api/v1/estate/notifications — paged inbox', () => {
  it('defaults to the active half and answers the envelope the Go surface answers', async () => {
    const client = makeClient({ rows: [activeRow()] });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await listInbox(req('GET', `http://x/notifications?estate_id=${OTHER}`));
    expect(res.status).toBe(200);
    const body = await (res as any).json();
    expect(body.total).toBe(1);
    expect(body.state).toBe('active');
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(body.unread_only).toBe(false);
    expect(body.data[0].archivedAt).toBeUndefined();
    // The caller's estate comes from its own membership; an estate_id in the query is not a filter it gets.
    expect(hasFilter(client.log, 'estate_notifications', 'eq', 'estate_id', ESTATE)).toBe(true);
    expect(client.log.some((s) => s.op === 'eq' && s.args[0] === 'estate_id' && s.args[1] === OTHER)).toBe(false);
    expect(hasFilter(client.log, 'estate_notifications', 'is', 'archived_at', null)).toBe(true);
  });

  it('pages, orders pinned first and counts before paging', async () => {
    const client = makeClient({ rows: [] });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    await listInbox(req('GET', 'http://x/notifications?limit=5&offset=5'));
    expect(client.log.find((s) => s.op === 'select')?.args[1]).toEqual({ count: 'exact' });
    expect(hasFilter(client.log, 'estate_notifications', 'order', 'pinned')).toBe(true);
    expect(client.log.find((s) => s.op === 'order' && s.args[0] === 'pinned')?.args[1]).toEqual({ ascending: false });
    expect(hasFilter(client.log, 'estate_notifications', 'range', 5, 9)).toBe(true);
  });

  it('switches between the archive half and both halves', async () => {
    const archived = makeClient({ rows: [] });
    vi.mocked(createAdminClient).mockReturnValue(archived as any);
    await listInbox(req('GET', 'http://x/notifications?state=archived'));
    expect(hasFilter(archived.log, 'estate_notifications', 'not', 'archived_at')).toBe(true);

    const everything = makeClient({ rows: [] });
    vi.mocked(createAdminClient).mockReturnValue(everything as any);
    const res = await listInbox(req('GET', 'http://x/notifications?state=all'));
    expect(res.status).toBe(200);
    expect(everything.log.some((s) => s.op === 'is' && s.args[0] === 'archived_at')).toBe(false);
    expect(everything.log.some((s) => s.op === 'not' && s.args[0] === 'archived_at')).toBe(false);
  });

  it('searches title and body, and filters unread and category', async () => {
    const client = makeClient({ rows: [] });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    await listInbox(req('GET', 'http://x/notifications?q=water&unread_only=true&category=announcement'));
    expect(hasFilter(client.log, 'estate_notifications', 'or', 'title.ilike.%water%,body.ilike.%water%')).toBe(true);
    expect(hasFilter(client.log, 'estate_notifications', 'is', 'read_at', null)).toBe(true);
    expect(hasFilter(client.log, 'estate_notifications', 'eq', 'category', 'announcement')).toBe(true);
  });

  it.each([
    ['state=bogus', 'state must be active, archived or all'],
    ['category=emergencz', 'Unknown notification category'],
    ['q=w', 'search term of at least 2 characters'],
    ['q=water%2C%20fire', 'may not contain'],
    ['limit=0', 'limit must be between 1 and 200'],
    ['limit=5000', 'limit must be between 1 and 200'],
  ])('rejects %s as a 400 before touching the inbox', async (qs, message) => {
    const client = makeClient({ rows: [] });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await listInbox(req('GET', `http://x/notifications?${qs}`));
    expect(res.status).toBe(400);
    expect((await (res as any).json()).error).toContain(message);
    expect(client.log.filter((s) => s.op === 'select').length).toBe(0);
  });

  it('refuses a caller who is not a resident of any estate', async () => {
    vi.mocked(getResidentContext).mockResolvedValue(null);
    vi.mocked(createAdminClient).mockReturnValue(makeClient() as any);
    const res = await listInbox(req('GET', 'http://x/notifications'));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/estate/notifications/[id]/archive — reversible, personal', () => {
  it('stamps archived_at, and clears it back to null when un-archived', async () => {
    const inClient = makeClient({ ownRow: activeRow() });
    vi.mocked(createAdminClient).mockReturnValue(inClient as any);
    const res = await setArchived(req('POST', 'http://x/archive', { archived: true }), params({ id: NOTIF }));
    expect(res.status).toBe(200);
    expect(typeof inClient.updates[0].archived_at).toBe('string');
    expect(hasFilter(inClient.log, 'estate_notifications', 'eq', 'user_id', USER)).toBe(true);

    const outClient = makeClient({ ownRow: activeRow({ archived_at: '2026-10-25T00:00:00Z', read_at: '2026-10-21T00:00:00Z' }) });
    vi.mocked(createAdminClient).mockReturnValue(outClient as any);
    await setArchived(req('POST', 'http://x/archive', { archived: false }), params({ id: NOTIF }));
    expect(outClient.updates[0].archived_at).toBeNull();
    // Pulling a notice back into the inbox must not rewrite when it was read.
    expect(outClient.updates[0]).not.toHaveProperty('read_at');
  });

  it('defaults to archiving and answers 404 for somebody else’s row', async () => {
    const client = makeClient({ ownRow: null });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await setArchived(req('POST', 'http://x/archive', {}), params({ id: NOTIF }));
    expect(res.status).toBe(404);
    expect(client.updates.length).toBe(0);
  });

  it('rejects a malformed id before any lookup', async () => {
    const client = makeClient();
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await setArchived(req('POST', 'http://x/archive', {}), params({ id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    expect(client.log.length).toBe(0);
  });
});

describe('POST /api/v1/estate/notifications/[id]/read', () => {
  it('stamps read_at once and never overwrites it', async () => {
    const stamp = activeRow({ read_at: '2026-10-20T10:00:00Z' });
    const client = makeClient({ ownRow: stamp });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await markRead(req('POST', 'http://x/read', {}), params({ id: NOTIF }));
    expect(res.status).toBe(200);
    expect(client.updates.length).toBe(0);

    const fresh = makeClient({ ownRow: activeRow() });
    vi.mocked(createAdminClient).mockReturnValue(fresh as any);
    await markRead(req('POST', 'http://x/read', {}), params({ id: NOTIF }));
    expect(typeof fresh.updates[0].read_at).toBe('string');
  });

  it('refuses a write on an estate that is not active (the Go LifecycleGate mirror)', async () => {
    vi.mocked(getResidentContext).mockImplementation(async (_s: any, _u: string, o?: any) => {
      if (o?.forWrite) throw new ApiError('Estate is suspended — changes are disabled until it is active', 423);
      return member as any;
    });
    vi.mocked(createAdminClient).mockReturnValue(makeClient({ ownRow: activeRow() }) as any);
    const res = await markRead(req('POST', 'http://x/read', {}), params({ id: NOTIF }));
    expect(res.status).toBe(423);
  });
});

describe('POST /api/v1/estate/notifications/[id]/pin', () => {
  it('lets a member pin their own row', async () => {
    const client = makeClient({ ownRow: activeRow() });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await setPinned(req('POST', 'http://x/pin', { pinned: true }), params({ id: NOTIF }));
    expect(res.status).toBe(200);
    expect(client.updates[0]).toEqual({ pinned: true });
  });

  it('forbids a member who names somebody else, and allows the estate admin', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeClient({ ownRow: activeRow({ user_id: OTHER }) }) as any);
    const res = await setPinned(req('POST', 'http://x/pin', { pinned: true, user_id: OTHER }), params({ id: NOTIF }));
    expect(res.status).toBe(403);

    vi.mocked(getResidentContext).mockResolvedValue(admin as any);
    const client = makeClient({ ownRow: activeRow({ user_id: OTHER }) });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const ok = await setPinned(req('POST', 'http://x/pin', { pinned: true, user_id: OTHER }), params({ id: NOTIF }));
    expect(ok.status).toBe(200);
    expect(hasFilter(client.log, 'estate_notifications', 'eq', 'user_id', OTHER)).toBe(true);
  });

  it('answers 404, not 403, when an admin names a row that is not that member’s', async () => {
    vi.mocked(getResidentContext).mockResolvedValue(admin as any);
    vi.mocked(createAdminClient).mockReturnValue(makeClient({ ownRow: null }) as any);
    const res = await setPinned(req('POST', 'http://x/pin', { pinned: true, user_id: OTHER }), params({ id: NOTIF }));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/estate/notifications/read-all — the inbox only', () => {
  it('never reaches the archive half', async () => {
    const client = makeClient();
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await readAll(req('POST', 'http://x/read-all', {}));
    expect(res.status).toBe(204);
    expect(hasFilter(client.log, 'estate_notifications', 'is', 'archived_at', null)).toBe(true);
    expect(hasFilter(client.log, 'estate_notifications', 'is', 'read_at', null)).toBe(true);
    expect(hasFilter(client.log, 'estate_notifications', 'eq', 'estate_id', ESTATE)).toBe(true);
  });
});

describe('/api/v1/estate/notifications/retention — estate admin plane', () => {
  it('is closed to a member on all three routes', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeClient() as any);
    expect((await getRetention(req('GET', 'http://x/retention'))).status).toBe(403);
    expect((await putRetention(req('PUT', 'http://x/retention', { archive_after_days: 30 }))).status).toBe(403);
    expect((await runRetention(req('POST', 'http://x/retention/run', {}))).status).toBe(403);
  });

  it('reads back the documented defaults when the estate has no policy row', async () => {
    vi.mocked(getResidentContext).mockResolvedValue(admin as any);
    const client = makeClient({ policy: null });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const body = await (await getRetention(req('GET', 'http://x/retention'))).json();
    expect(body).toMatchObject({ enabled: true, archive_after_days: 90, purge_after_days: null, keep_categories: ['security', 'system'], defaulted: true });
  });

  it('writes a policy and audits it', async () => {
    vi.mocked(getResidentContext).mockResolvedValue(admin as any);
    const client = makeClient({ policy: null });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const body = await (await putRetention(req('PUT', 'http://x/retention', { archive_after_days: 200, purge_after_days: 300 }))).json();
    expect(body).toMatchObject({ estate_id: ESTATE, archive_after_days: 200, purge_after_days: 300, defaulted: false });
    expect(client.upserts[0]).toMatchObject({ estate_id: ESTATE, archive_after_days: 200, purge_after_days: 300, updated_by: USER });
    const audit = client.inserts.find((i) => i.action === 'NOTIFICATION_RETENTION_SET');
    expect(audit).toBeTruthy();
    expect(audit?.subject_type).toBe('estate');
  });

  it('replaces the protected categories rather than merging them', async () => {
    vi.mocked(getResidentContext).mockResolvedValue(admin as any);
    const client = makeClient({ policy: {
      enabled: true, archive_after_days: 90, purge_after_days: null,
      keep_categories: ['security', 'system', 'payment'], updated_by: USER, updated_at: '2026-10-01T00:00:00Z',
    } });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const body = await (await putRetention(req('PUT', 'http://x/retention', { keep_categories: ['payment'] }))).json();
    expect(client.upserts[0].keep_categories).toEqual(['payment']);
    expect(body.keep_categories).toEqual(['payment']);
  });

  it.each([
    [{ archive_after_days: 0 }, 'positive'],
    [{ archive_after_days: -5 }, 'positive'],
    [{ archive_after_days: 200, purge_after_days: 50 }, 'before archive'],
    [{ keep_categories: ['emergencz'] }, 'category'],
  ])('refines %s with a 400', async (patch, message) => {
    vi.mocked(getResidentContext).mockResolvedValue(admin as any);
    const client = makeClient({ policy: null });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await putRetention(req('PUT', 'http://x/retention', patch));
    expect(res.status).toBe(400);
    expect((await (res as any).json()).error).toContain(message);
    expect(client.upserts.length).toBe(0);
  });

  it('reads a purge of 0 as "never purge"', async () => {
    vi.mocked(getResidentContext).mockResolvedValue(admin as any);
    const client = makeClient({ policy: {
      enabled: true, archive_after_days: 90, purge_after_days: 400, keep_categories: ['security'], updated_by: USER, updated_at: '2026-10-01T00:00:00Z',
    } });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    await putRetention(req('PUT', 'http://x/retention', { purge_after_days: 0 }));
    expect(client.upserts[0].purge_after_days).toBeNull();
  });

  it('runs the database sweep and reports its counters', async () => {
    vi.mocked(getResidentContext).mockResolvedValue(admin as any);
    const client = makeClient({ rpcResult: { archived: 7, purged: 2 } });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const body = await (await runRetention(req('POST', 'http://x/retention/run', {}))).json();
    expect(client.rpcCall?.fn).toBe('estate_notifications_apply_retention');
    expect(client.rpcCall?.args).toEqual({ p_estate_id: ESTATE });
    expect(body).toMatchObject({ notifications_archived: 7, notifications_purged: 2 });
    expect(client.inserts.some((i) => i.action === 'NOTIFICATION_RETENTION_RUN')).toBe(true);
  });

  it('lets the database refuse a purge through the guard', async () => {
    vi.mocked(getResidentContext).mockResolvedValue(admin as any);
    const client = makeClient({ rpcError: { message: 'estate_notifications_block_purge: row is pinned' } });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await runRetention(req('POST', 'http://x/retention/run', {}));
    expect(res.status).toBe(500);
    expect(client.inserts.length).toBe(0);
  });
});
