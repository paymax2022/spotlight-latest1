/**
 * UAT estate-a fixes — visitor/gate BFF routes.
 *
 * Covers defects found in the Oct-2026 UAT pass (EST-UAT M05/M06):
 *  - POST /visitor/gate/session did not exist: gate_sessions was never
 *    written, so every guard-gated route 403'd forever (ESTA-D001).
 *  - POST /visitor/codes accepted inverted/past validity windows and any
 *    phone string, and a numeric-code collision 500'd (ESTA-D002).
 *  - POST /visitor/gate/approve admitted expired/revoked/over-used/
 *    blacklisted codes and never consumed them — a one-time code could be
 *    scanned repeatedly, including by two guards concurrently (ESTA-D003).
 *  - POST /visitor/gate/sync only flipped a flag — offline events could not
 *    be uploaded and a replayed payload would double-count (ESTA-D006).
 *  - No regenerate endpoint existed for a compromised code (ESTA-D007).
 *  - visitor_blacklist.reason is NOT NULL but the route allowed a null insert;
 *    gate lookup only matched plates, never phone (ESTA-D005).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: class {
    status: number;
    constructor(_body: any, init?: { status?: number }) {
      this.status = init?.status ?? 200;
    }
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body === undefined ? null : body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
}));

vi.mock('@/src/lib/auth/request', () => ({ requireRequestUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/lib/voting/rate-limit', () => ({ checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 1, resetInMs: 0 })) }));
vi.mock('@/src/server/visitor/gate.service', () => ({
  getGuardContext: vi.fn(),
  mapGateEvent: (r: any) => r,
  mapSession: (r: any) => r,
  mapNotification: (r: any) => r,
  mapBlacklist: (r: any) => r,
  mapIncident: (r: any) => r,
}));

import { POST as postSession } from '../../../app/api/v1/visitor/gate/session/route';
import { POST as postCode } from '../../../app/api/v1/visitor/codes/route';
import { POST as postApprove } from '../../../app/api/v1/visitor/gate/approve/route';
import { POST as postSync } from '../../../app/api/v1/visitor/gate/sync/route';
import { POST as postRegenerate } from '../../../app/api/v1/visitor/codes/[id]/regenerate/route';
import { POST as postBlacklist } from '../../../app/api/v1/visitor/blacklist/route';
import { GET as getLookup } from '../../../app/api/v1/visitor/gate/lookup/route';

import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';
import { getGuardContext } from '@/src/server/visitor/gate.service';

const USER = { id: 'user-1', email: 'u@e.com' };
const ESTATE = '11111111-2222-3333-4444-555555555555';
const GATE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CODE_ID = '99999999-8888-7777-6666-555555555555';
const GUARD = { estateId: ESTATE, gateId: GATE, guardName: 'G' };
const NOW = Date.now();

function req(method: string, url: string, body?: any) {
  return new Request(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  }) as any;
}
const params = (o: Record<string, string>) => ({ params: Promise.resolve(o) }) as any;

// Per-table canned results; maybeSingle/single -> cfg.single, awaited chain -> cfg.rows,
// update()/insert()/upsert() record the payload in cfg.writes.
interface TableCfg { single?: any; singleErr?: any; rows?: any[]; writes?: any[] }
function makeSupabase(tables: Record<string, TableCfg>) {
  function builder(table: string) {
    const cfg = (tables[table] ??= {});
    cfg.writes = cfg.writes ?? [];
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      in: () => chain,
      neq: () => chain,
      gt: () => chain,
      gte: () => chain,
      lt: () => chain,
      lte: () => chain,
      ilike: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (p: any) => { cfg.writes!.push({ op: 'insert', p }); return chain; },
      update: (p: any) => { cfg.writes!.push({ op: 'update', p }); return chain; },
      upsert: (p: any) => { cfg.writes!.push({ op: 'upsert', p }); return chain; },
      delete: () => chain,
      maybeSingle: async () => ({ data: cfg.single ?? null, error: cfg.singleErr ?? null }),
      single: async () => ({ data: cfg.single ?? null, error: cfg.singleErr ?? null }),
      then: (resolve: any) => resolve({ data: cfg.rows ?? [], error: null, count: (cfg.rows ?? []).length }),
    };
    return chain;
  }
  return { from: (t: string) => builder(t) };
}

const futureCode = (over: Record<string, any> = {}) => ({
  id: CODE_ID,
  estate_id: ESTATE,
  issued_by: 'resident-1',
  visitor_name: 'V',
  visitor_phone: '+2348012345678',
  vehicle_plate: null,
  purpose: null,
  code_type: 'one_time',
  numeric_code: '123456',
  qr_code: 'q',
  valid_from: new Date(NOW - 60_000).toISOString(),
  valid_until: new Date(NOW + 3_600_000).toISOString(),
  recurrence: null,
  used_count: 0,
  max_uses: 1,
  status: 'active',
  blacklisted: false,
  usage_mode: 'one_time',
  party_size: 1,
  created_at: new Date(NOW - 120_000).toISOString(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRequestUser).mockResolvedValue(USER as any);
  vi.mocked(getGuardContext).mockResolvedValue(GUARD as any);
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 1, resetInMs: 0 });
});

describe('POST /api/v1/visitor/gate/session — shift sign-in (ESTA-D001)', () => {
  const base = { estate_residents: { single: { id: 'r1' } }, estate_gates: { single: { id: GATE, name: 'Main' } }, user_profiles: { single: { full_name: 'Guard One' } }, gate_sessions: { single: { id: 's1', estate_id: ESTATE, gate_id: GATE, guard_id: USER.id, shift_start: 't', shift_end: null } } };

  it('creates a gate_sessions row for an estate member at an active gate', async () => {
    const sb = makeSupabase(base);
    vi.mocked(createAdminClient).mockReturnValue(sb as any);
    const res = await postSession(req('POST', 'http://x', { estateId: ESTATE, gateId: GATE }));
    expect(res.status).toBe(201);
    const writes = (base.gate_sessions as any).writes;
    expect(writes[0].op).toBe('update'); // stale open shift closed first
    expect(writes[1].op).toBe('insert');
    expect(writes[1].p.guard_name).toBe('Guard One');
    expect(writes[1].p.gate_label).toBe('Main');
  });

  it('403s a non-member and 404s a gate outside the estate', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ estate_residents: { single: null } }) as any);
    expect((await postSession(req('POST', 'http://x', { estateId: ESTATE, gateId: GATE }))).status).toBe(403);
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ estate_residents: { single: { id: 'r1' } }, estate_gates: { single: null } }) as any);
    expect((await postSession(req('POST', 'http://x', { estateId: ESTATE, gateId: GATE }))).status).toBe(404);
  });
});

describe('POST /api/v1/visitor/codes — validity window + phone (ESTA-D002)', () => {
  const residentCtx = { estate_residents: { single: { estate_id: ESTATE, unit: 'A1', role: 'resident' } }, visitor_access_codes: { single: futureCode() }, visitor_blacklist: { single: null }, estates: { single: null }, user_profiles: { single: null } };
  const body = { visitorName: 'V', validityStart: new Date(NOW + 60_000).toISOString(), validityEnd: new Date(NOW + 3_600_000).toISOString() };

  it('rejects an inverted window (end before start)', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase(residentCtx) as any);
    const res = await postCode(req('POST', 'http://x', { ...body, validityEnd: new Date(NOW - 60_000).toISOString() }));
    expect(res.status).toBe(400);
  });

  it('rejects a window wholly in the past', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase(residentCtx) as any);
    const res = await postCode(req('POST', 'http://x', { ...body, validityStart: new Date(NOW - 7200_000).toISOString(), validityEnd: new Date(NOW - 60_000).toISOString() }));
    expect(res.status).toBe(400);
  });

  it('rejects a malformed visitor phone', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase(residentCtx) as any);
    const res = await postCode(req('POST', 'http://x', { ...body, visitorPhone: 'abc' }));
    expect(res.status).toBe(400);
  });

  it('issues the code flagged blacklisted when the phone is on the watchlist', async () => {
    const tables = { ...residentCtx, visitor_blacklist: { single: { id: 'b1' } } };
    const sb = makeSupabase(tables);
    vi.mocked(createAdminClient).mockReturnValue(sb as any);
    const res = await postCode(req('POST', 'http://x', { ...body, visitorPhone: '+2348012345678' }));
    expect(res.status).toBe(201);
    const ins = (tables.visitor_access_codes as any).writes.find((w: any) => w.op === 'insert');
    expect(ins.p.blacklisted).toBe(true);
  });
});

describe('POST /api/v1/visitor/gate/approve — admission enforcement (ESTA-D003)', () => {
  const okTables = () => ({
    visitor_access_codes: { single: futureCode(), rows: [{ id: CODE_ID }] },
    visitor_blacklist: { single: null },
    estate_residents: { single: { unit: 'A1' } },
    visitor_gate_events: { single: { id: 'e1', action: 'check_in' } },
    visitor_notifications: {},
  });

  it('admits a valid code and consumes it atomically (CAS on used_count)', async () => {
    const tables = okTables();
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase(tables) as any);
    const res = await postApprove(req('POST', 'http://x', { accessCodeId: CODE_ID }));
    expect(res.status).toBe(200);
    const upd = (tables.visitor_access_codes as any).writes.find((w: any) => w.op === 'update');
    expect(upd.p.used_count).toBe(1);
    expect(upd.p.status).toBe('used');
  });

  it('denies a revoked code', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ visitor_access_codes: { single: futureCode({ status: 'revoked' }) } }) as any);
    expect((await postApprove(req('POST', 'http://x', { accessCodeId: CODE_ID }))).status).toBe(409);
  });

  it('denies an expired code and a not-yet-valid code', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ visitor_access_codes: { single: futureCode({ valid_until: new Date(NOW - 1000).toISOString() }) } }) as any);
    expect((await postApprove(req('POST', 'http://x', { accessCodeId: CODE_ID }))).status).toBe(409);
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ visitor_access_codes: { single: futureCode({ valid_from: new Date(NOW + 60_000).toISOString() }) } }) as any);
    expect((await postApprove(req('POST', 'http://x', { accessCodeId: CODE_ID }))).status).toBe(409);
  });

  it('denies an exhausted code (max_uses reached)', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ visitor_access_codes: { single: futureCode({ used_count: 1 }) } }) as any);
    expect((await postApprove(req('POST', 'http://x', { accessCodeId: CODE_ID }))).status).toBe(409);
  });

  it('denies a blacklisted code (flag and phone watchlist)', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ visitor_access_codes: { single: futureCode({ blacklisted: true }) } }) as any);
    expect((await postApprove(req('POST', 'http://x', { accessCodeId: CODE_ID }))).status).toBe(403);
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ visitor_access_codes: { single: futureCode() }, visitor_blacklist: { single: { id: 'b1' } } }) as any);
    expect((await postApprove(req('POST', 'http://x', { accessCodeId: CODE_ID }))).status).toBe(403);
  });

  it('denies when the issuing resident moved out or was banned', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ visitor_access_codes: { single: futureCode() }, visitor_blacklist: { single: null }, estate_residents: { single: null } }) as any);
    expect((await postApprove(req('POST', 'http://x', { accessCodeId: CODE_ID }))).status).toBe(409);
  });

  it('denies the losing scanner when the CAS claim matches zero rows (concurrent scan race)', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ visitor_access_codes: { single: futureCode(), rows: [] }, visitor_blacklist: { single: null }, estate_residents: { single: { unit: 'A1' } } }) as any);
    expect((await postApprove(req('POST', 'http://x', { accessCodeId: CODE_ID }))).status).toBe(409);
  });

  it('denies a code from another estate (scoped lookup returns no row)', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ visitor_access_codes: { single: null } }) as any);
    expect((await postApprove(req('POST', 'http://x', { accessCodeId: CODE_ID }))).status).toBe(404);
  });
});

describe('POST /api/v1/visitor/gate/sync — offline upload + dedup (ESTA-D006)', () => {
  it('upserts client events by stable id (replays are no-ops) and keeps capturedAt', async () => {
    const tables = { visitor_gate_events: { rows: [{ id: 'x' }] } };
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase(tables) as any);
    const captured = new Date(NOW - 3600_000).toISOString();
    const res = await postSync(req('POST', 'http://x', { events: [{ id: CODE_ID, action: 'check_in', visitorName: 'V', capturedAt: captured }] }));
    expect(res.status).toBe(200);
    const up = (tables.visitor_gate_events as any).writes.find((w: any) => w.op === 'upsert');
    expect(up.p[0].id).toBe(CODE_ID);
    expect(up.p[0].created_at).toBe(captured);
    expect(up.p[0].sync_status).toBe('synced');
  });

  it('rejects an event without a UUID id or with a bad action', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ visitor_gate_events: {} }) as any);
    expect((await postSync(req('POST', 'http://x', { events: [{ id: 'nope', action: 'check_in', visitorName: 'V' }] }))).status).toBe(400);
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ visitor_gate_events: {} }) as any);
    expect((await postSync(req('POST', 'http://x', { events: [{ id: CODE_ID, action: 'hack', visitorName: 'V' }] }))).status).toBe(400);
  });
});

describe('POST /api/v1/visitor/codes/[id]/regenerate — compromised share (ESTA-D007)', () => {
  it('revokes the old code and issues a replacement preserving validity', async () => {
    const tables = { visitor_access_codes: { single: futureCode({ issued_by: USER.id }), rows: [{ id: CODE_ID }] }, estates: { single: null }, user_profiles: { single: null }, estate_residents: { single: null } };
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase(tables) as any);
    const res = await postRegenerate(req('POST', 'http://x'), params({ id: CODE_ID }));
    expect(res.status).toBe(201);
    const writes = (tables.visitor_access_codes as any).writes;
    expect(writes[0].p.status).toBe('revoked');
    expect(writes[1].op).toBe('insert');
    expect(writes[1].p.status).toBe('active');
    expect(writes[1].p.used_count).toBe(0);
  });

  it('refuses to regenerate a non-active code', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ visitor_access_codes: { single: futureCode({ issued_by: USER.id, status: 'revoked' }) } }) as any);
    expect((await postRegenerate(req('POST', 'http://x'), params({ id: CODE_ID }))).status).toBe(409);
  });

  it('404s on a code owned by someone else', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ visitor_access_codes: { single: futureCode({ issued_by: 'other-user' }) } }) as any);
    expect((await postRegenerate(req('POST', 'http://x'), params({ id: CODE_ID }))).status).toBe(404);
  });
});

describe('visitor blacklist + lookup hardening (ESTA-D005)', () => {
  it('defaults a missing reason instead of violating the NOT NULL column', async () => {
    const tables = { estate_residents: { single: { estate_id: ESTATE, unit: '', role: 'resident' } }, visitor_blacklist: { single: { id: 'b1', match_kind: 'phone', match_value: 'x', reason: 'Flagged at estate security review', created_at: 't' } } };
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase(tables) as any);
    const res = await postBlacklist(req('POST', 'http://x', { matchKind: 'phone', matchValue: '+2348' }));
    expect(res.status).toBe(201);
    const ins = (tables.visitor_blacklist as any).writes[0];
    expect(ins.p.reason).toBe('Flagged at estate security review');
  });

  it('rate-limits gate lookup (brute-force guard)', async () => {
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, remaining: 0, resetInMs: 1000 });
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({}) as any);
    const res = await getLookup(req('GET', 'http://x?code=123456'));
    expect(res.status).toBe(429);
  });
});
