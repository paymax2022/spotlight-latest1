/**
 * Estate/visitor authorization & gate-ordering tests.
 *
 * Covers the gaps found in the wave-6 prod E2E pass:
 *  - GET /estate/meetings/[id]/minutes had NO residency gate — any authed user
 *    could read any meeting's minutes by id (IDOR) and a malformed id 500'd.
 *  - POST /visitor/codes/[id]/{arrival,exit} had NO guard check — any authed
 *    user could write gate events on anyone's access code.
 *  - GET /visitor/codes/[id]/attendance had NO ownership check — leaked gate
 *    events for any code id (enumeration oracle + movement leak).
 *  - POST /visitor/codes/[id]/share 204'd unconditionally — diverged from the
 *    sibling code routes' owner-only 404.
 *  - GET /estate/analytics/[type] validated the type BEFORE the residency
 *    gate, leaking valid-type info via 400-vs-403.
 *  - POST /estate/notifications/[id]/read 500'd on malformed ids (22P02).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', () => ({
  // Minimal NextResponse: static .json() (JSON body) + constructible for the
  // `new NextResponse(null, { status: 204 })` empty-body responses.
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
vi.mock('@/src/server/estate/resident', () => ({
  getResidentContext: vi.fn(),
  resolveNames: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/src/server/visitor/gate.service', () => ({
  getGuardContext: vi.fn(),
  mapGateEvent: (r: any) => r,
  mapSession: (r: any) => r,
}));
vi.mock('@/src/server/estate/analytics', () => ({
  isAnalyticsType: (t: string) => t === 'dues_trend',
  buildAnalytics: vi.fn(),
}));

import { GET as getMinutes } from '../../../app/api/v1/estate/meetings/[id]/minutes/route';
import { POST as markEstateNotifRead } from '../../../app/api/v1/estate/notifications/[id]/read/route';
import { GET as getAnalytics } from '../../../app/api/v1/estate/analytics/[type]/route';
import { GET as getAttendance } from '../../../app/api/v1/visitor/codes/[id]/attendance/route';
import { POST as postArrival } from '../../../app/api/v1/visitor/codes/[id]/arrival/route';
import { POST as postExit } from '../../../app/api/v1/visitor/codes/[id]/exit/route';
import { POST as postShare } from '../../../app/api/v1/visitor/codes/[id]/share/route';

import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';
import { getGuardContext } from '@/src/server/visitor/gate.service';
import { buildAnalytics } from '@/src/server/estate/analytics';

const USER = { id: 'user-1', email: 'u@e.com' };
const ESTATE = 'estate-1';
const CODE_ID = '11111111-2222-3333-4444-555555555555';
const MEETING_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NOTIF_ID = '99999999-8888-7777-6666-555555555555';

function req(method: string, url: string, body?: any) {
  return new Request(url, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  }) as any;
}
const params = (o: Record<string, string>) => ({ params: Promise.resolve(o) }) as any;

// Chainable supabase stub: per-table canned maybeSingle/rows results.
interface TableCfg { single?: any; singleErr?: any; rows?: any[] }
function makeSupabase(tables: Record<string, TableCfg>) {
  function builder(table: string) {
    const cfg = tables[table] ?? {};
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: () => chain,
      update: () => chain,
      upsert: () => chain,
      maybeSingle: async () => ({ data: cfg.single ?? null, error: cfg.singleErr ?? null }),
      single: async () => ({ data: cfg.single ?? null, error: cfg.singleErr ?? null }),
      then: (resolve: any) => resolve({ data: cfg.rows ?? [], error: null }),
    };
    return chain;
  }
  return { from: (t: string) => builder(t) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRequestUser).mockResolvedValue(USER as any);
});

describe('GET /api/v1/estate/meetings/[id]/minutes — residency gate', () => {
  it('returns 403 for non-residents regardless of id validity', async () => {
    vi.mocked(getResidentContext).mockResolvedValue(null);
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({}) as any);
    const res = await getMinutes(req('GET', 'http://x/minutes'), params({ id: 'not-a-uuid' }));
    expect(res.status).toBe(403);
    const res2 = await getMinutes(req('GET', 'http://x/minutes'), params({ id: MEETING_ID }));
    expect(res2.status).toBe(403);
  });

  it('returns 400 for a malformed id (was 500 via 22P02)', async () => {
    vi.mocked(getResidentContext).mockResolvedValue({ estateId: ESTATE, unit: '', role: 'resident' } as any);
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({}) as any);
    const res = await getMinutes(req('GET', 'http://x/minutes'), params({ id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 for a meeting in another estate (was: leaked minutes)', async () => {
    vi.mocked(getResidentContext).mockResolvedValue({ estateId: ESTATE, unit: '', role: 'resident' } as any);
    // estate_meetings lookup scoped to ctx.estateId misses → 404 before minutes read.
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ estate_meetings: { single: null } }) as any);
    const res = await getMinutes(req('GET', 'http://x/minutes'), params({ id: MEETING_ID }));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/estate/notifications/[id]/read — malformed id', () => {
  it('returns 400 instead of 500 on non-UUID ids', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({}) as any);
    const res = await markEstateNotifRead(req('POST', 'http://x/read', {}), params({ id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/estate/analytics/[type] — gate before type validation', () => {
  it('returns 403 (not 400) for a non-resident even with an invalid type', async () => {
    vi.mocked(getResidentContext).mockResolvedValue(null);
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({}) as any);
    const res = await getAnalytics(req('GET', 'http://x/analytics'), params({ type: 'bogus' }));
    expect(res.status).toBe(403);
    expect(buildAnalytics).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/visitor/codes/[id]/attendance — owner-or-guard', () => {
  it('404s for a non-owner non-guard even when the code exists', async () => {
    vi.mocked(getGuardContext).mockResolvedValue(null);
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({
      visitor_access_codes: { single: { id: CODE_ID, estate_id: ESTATE, issued_by: 'someone-else' } },
    }) as any);
    const res = await getAttendance(req('GET', 'http://x/attendance'), params({ id: CODE_ID }));
    expect(res.status).toBe(404);
  });

  it('404s for a guard whose session is in a DIFFERENT estate', async () => {
    vi.mocked(getGuardContext).mockResolvedValue({ estateId: 'estate-9', gateId: 'g', guardName: '' } as any);
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({
      visitor_access_codes: { single: { id: CODE_ID, estate_id: ESTATE, issued_by: 'someone-else' } },
    }) as any);
    const res = await getAttendance(req('GET', 'http://x/attendance'), params({ id: CODE_ID }));
    expect(res.status).toBe(404);
  });

  it('serves the code issuer', async () => {
    vi.mocked(getGuardContext).mockResolvedValue(null);
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({
      visitor_access_codes: { single: { id: CODE_ID, estate_id: ESTATE, issued_by: USER.id } },
      visitor_gate_events: { rows: [{ id: 'e1', access_code_id: CODE_ID, action: 'arrival' }] },
    }) as any);
    const res = await getAttendance(req('GET', 'http://x/attendance'), params({ id: CODE_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.codeId).toBe(CODE_ID);
    expect(body.events).toHaveLength(1);
  });
});

describe('POST /api/v1/visitor/codes/[id]/{arrival,exit} — guard gate', () => {
  it('returns 403 when the caller has no active gate session (was: wrote events)', async () => {
    vi.mocked(getGuardContext).mockResolvedValue(null);
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({}) as any);
    for (const h of [postArrival, postExit]) {
      const res = await h(req('POST', 'http://x', { gateId: 'g1' }), params({ id: CODE_ID }));
      expect(res.status).toBe(403);
    }
  });

  it('404s when the code is outside the guard\u2019s estate', async () => {
    vi.mocked(getGuardContext).mockResolvedValue({ estateId: ESTATE, gateId: 'g', guardName: '' } as any);
    // estate-scoped lookup misses (code belongs to another estate / absent).
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ visitor_access_codes: { single: null } }) as any);
    const res = await postArrival(req('POST', 'http://x', { gateId: 'g1' }), params({ id: CODE_ID }));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/visitor/codes/[id]/share — ownership', () => {
  it('404s for a code the caller does not own (was unconditional 204)', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({
      visitor_access_codes: { single: { id: CODE_ID, issued_by: 'someone-else' } },
    }) as any);
    const res = await postShare(req('POST', 'http://x', {}), params({ id: CODE_ID }));
    expect(res.status).toBe(404);
  });

  it('204s for the owner', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({
      visitor_access_codes: { single: { id: CODE_ID, issued_by: USER.id } },
    }) as any);
    const res = await postShare(req('POST', 'http://x', {}), params({ id: CODE_ID }));
    expect(res.status).toBe(204);
  });
});
