/**
 * P3 Task 11 — the lifecycle routes and the slot-art upload.
 *
 * Four of these five routes exist so that a state change happens in exactly one
 * place: the `security definer` functions of migration `20272300000000`. The routes
 * never write `status`, never compute a version number, and never archive the
 * previous live template themselves — D1 (only `duplicate` mints an id), D2 (the
 * single-active swap is one transaction) and the idempotent second archive press are
 * all database facts, and a TypeScript copy of them would drift the moment the
 * migration is amended. What the routes *do* own, and what is tested here:
 *
 * - **the guard runs first** — an unauthorised caller must not be able to make any
 *   of them create a client, let alone fire an RPC (asserted via
 *   `createAdminClient` never having been called);
 * - **`p_actor` is a UUID or nothing** — `published_by`/`created_by` reference
 *   `user_profiles`, so the literal `'api-key'` an `x-admin-key` caller gets would
 *   fail inside the function with a Postgres error that has nothing to do with the
 *   admin's action (the precedent the legacy PATCH set at `route.ts:182`);
 * - **a template id that is not a UUID never reaches Postgres** — otherwise the
 *   function's `invalid input syntax for type uuid` is classified by
 *   `studioRpcFailure` as a 500 and the admin is told the server is broken;
 * - **the RPC's own sentence is the answer** — `22023` refusals arrive with the fix
 *   spelled out ("add one before publishing"), so the response carries it, minus the
 *   `function_name:` prefix that exists for Postgres logs;
 * - **the answer is the stored row** — after the RPC, each route re-reads
 *   `contest_templates` so `status`/`published_at`/`version` in the response are what
 *   the database holds, not what the client hoped for;
 * - **slot-art refuses before it uploads** — an oversized file, an unsupported type,
 *   a missing template and a published (D6) template are each answered with the object
 *   still unwritten, which `calls.uploadKeys` proves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { POST as duplicatePOST } from '@/app/api/admin/voting/contest-templates/[templateId]/duplicate/route';
import { POST as publishPOST } from '@/app/api/admin/voting/contest-templates/[templateId]/publish/route';
import { POST as archivePOST } from '@/app/api/admin/voting/contest-templates/[templateId]/archive/route';
import { GET as versionsGET } from '@/app/api/admin/voting/contest-templates/[templateId]/versions/route';
import { POST as slotArtPOST } from '@/app/api/admin/voting/contest-templates/[templateId]/slot-art/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { MAX_CONTEST_TEMPLATE_UPLOAD_BYTES } from '@/src/lib/storage/upload-limits';
import { makeSupabase, type StudioFakeOptions } from './_contest-template-fake';

const BASE = 'https://x.test/api/admin/voting/contest-templates';
const TID = '2f8a1c34-56ab-4c9d-8e11-0a1b2c3d4e5f';
const SIBLING = '5b1c2d3e-4455-4677-8899-001122334455';
const NEW_ID = 'b1e2c3d4-5566-4778-8899-aabbccddeeff';
const ADMIN_UUID = '9c0d1e2f-3c4d-5e6f-7a8b-7f0f1a2b3c4d';
const CONTEST_UUID = '7f0f1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b';

function ctx(templateId: string = TID) {
  return { params: Promise.resolve({ templateId }) };
}

function post(path: string, init: RequestInit = {}) {
  return new Request(`${BASE}/${path}`, { method: 'POST', ...init });
}

/**
 * A request that hands the route a prepared `FormData` instead of a byte stream.
 *
 * Only one test needs it. undici recomputes `File.size` from the parsed part, so a
 * 50 MB file cannot be described to `request.formData()` without actually sending
 * 50 MB through the parser; this stub keeps the transport honest everywhere else
 * (the 415 case above and every other upload test use a real `Request`) while the
 * ceiling is exercised against the value the route reads it from.
 */
function stubMultipart(form: FormData): Request {
  return {
    method: 'POST',
    headers: new Headers({ 'content-type': 'multipart/form-data; boundary=life-cycle' }),
    formData: async () => form,
  } as unknown as Request;
}

function artReq(body?: FormData) {
  const fd = body ?? new FormData();
  if (!body) fd.set('file', new File(['fake-png-bytes'], 'ribbon.png', { type: 'image/png' }));
  return post('tpl/slot-art', { body: fd });
}

function storedRow(over: Record<string, unknown> = {}) {
  return {
    id: TID,
    name: 'Graduation 2026',
    connect_contest_id: CONTEST_UUID,
    contest_id: null,
    template_url: `https://cdn.test/templates/${TID}/frame.png`,
    thumbnail_url: null,
    file_format: 'png',
    width: 1080,
    height: 1350,
    aspect_ratio: '4:5',
    status: 'draft',
    version: 1,
    parent_template_id: null,
    is_reusable: true,
    created_by: ADMIN_UUID,
    photo_mode: 'auto',
    blend_preset: 'natural',
    blend_settings: { featherPx: 1 },
    published_at: null,
    published_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function storedSlot(over: Record<string, unknown> = {}) {
  return {
    id: 'slot-1',
    template_id: NEW_ID,
    slot_name: 'portrait',
    slot_type: 'contestant',
    slot_order: 0,
    x: 100,
    y: 120,
    width: 600,
    height: 900,
    rotation: 0,
    z_index: 1,
    scale: 1,
    crop_mode: 'cover',
    border_radius: 0,
    opacity: 1,
    snap_to_grid: false,
    grid_size: 10,
    image_url: null,
    anchor: 'center',
    bleed: 0,
    face_protect: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function useFake(options: StudioFakeOptions) {
  const fake = makeSupabase(options);
  vi.mocked(createAdminClient).mockReturnValue(fake.client as any);
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: ADMIN_UUID, role: 'super_admin' } as any);
});

describe('the five routes share their preconditions', () => {
  const actions: { label: string; run: (templateId: string) => Promise<Response> }[] = [
    { label: 'duplicate', run: (tid) => duplicatePOST(post('x/duplicate'), ctx(tid)) },
    { label: 'publish', run: (tid) => publishPOST(post('x/publish'), ctx(tid)) },
    { label: 'archive', run: (tid) => archivePOST(post('x/archive'), ctx(tid)) },
    { label: 'versions', run: (tid) => versionsGET(new Request(`${BASE}/x/versions`), ctx(tid)) },
    { label: 'slot-art', run: (tid) => slotArtPOST(artReq(), ctx(tid)) },
  ];

  for (const action of actions) {
    it(`${action.label}: the admin guard runs before any Supabase client exists`, async () => {
      const { client, calls } = makeSupabase({ templateRow: storedRow() });
      vi.mocked(createAdminClient).mockReturnValue(client as any);
      vi.mocked(assertAdminPermission).mockRejectedValueOnce(new ApiError('Forbidden', 403));

      const res = await action.run(TID);

      expect(res.status).toBe(403);
      expect(createAdminClient).not.toHaveBeenCalled();
      expect(calls.rpcCalls).toEqual([]);
      expect(calls.uploadKeys).toEqual([]);
    });

    it(`${action.label}: a template id that is not a UUID is refused before Postgres sees it`, async () => {
      const { calls } = useFake({ templateRow: storedRow() });

      const res = await action.run('tpl-1');

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('template_id_invalid');
      expect(calls.rpcCalls).toEqual([]);
      expect(calls.uploadKeys).toEqual([]);
    });
  }
});

describe('POST …/duplicate', () => {
  it('copies via the RPC and answers the new draft with its own slots', async () => {
    const { client, calls } = makeSupabase({
      templateRow: storedRow(),
      publishedRow: storedRow({
        id: NEW_ID,
        version: 2,
        status: 'draft',
        parent_template_id: TID,
        created_by: ADMIN_UUID,
      }),
      existingSlots: [storedSlot(), storedSlot({ id: 'slot-2', slot_type: 'decoration', image_url: 'https://cdn.test/s/ribbon.png' })],
      rpcResults: {
        duplicate_contest_template: { template_id: NEW_ID, version: 2, slot_count: 2, overlay_count: 1 },
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await duplicatePOST(post(`${TID}/duplicate`), ctx());

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, templateId: NEW_ID, version: 2 });
    expect(body.template).toMatchObject({
      id: NEW_ID,
      version: 2,
      status: 'draft',
      parentTemplateId: TID,
      photoMode: 'auto',
      blendPreset: 'natural',
      publishedAt: null,
    });
    expect(body.slots).toHaveLength(2);
    expect(body.slots[1]).toMatchObject({
      slotType: 'decoration',
      imageUrl: 'https://cdn.test/s/ribbon.png',
      anchor: 'center',
      faceProtect: true,
    });
    expect(calls.rpcCalls).toEqual([
      { fn: 'duplicate_contest_template', args: { p_template_id: TID, p_actor: ADMIN_UUID } },
    ]);
    // The reads that follow must be scoped to the copy the RPC just minted. With a
    // parent-id read the response would carry the old template's slots and every
    // assertion above would still pass.
    expect(calls.eqs).toContainEqual({ table: 'contest_templates', column: 'id', value: NEW_ID });
    expect(calls.eqs).toContainEqual({ table: 'template_slots', column: 'template_id', value: NEW_ID });
    expect(calls.eqs).not.toContainEqual({ table: 'template_slots', column: 'template_id', value: TID });
  });

  it('passes p_actor null for an api-key caller so the function cannot fail on the FK', async () => {
    const { client, calls } = makeSupabase({
      publishedRow: storedRow({ id: NEW_ID }),
      rpcResults: { duplicate_contest_template: { template_id: NEW_ID, version: 2 } },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    vi.mocked(assertAdminPermission).mockResolvedValueOnce({ actorId: 'api-key', role: 'service' } as any);

    const res = await duplicatePOST(post(`${TID}/duplicate`), ctx());

    expect(res.status).toBe(201);
    expect(calls.rpcCalls[0].args).toEqual({ p_template_id: TID, p_actor: null });
  });

  it('refuses an RPC result that does not name the new row', async () => {
    const { client } = makeSupabase({
      templateRow: storedRow(),
      rpcResults: { duplicate_contest_template: { version: 2 } },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await duplicatePOST(post(`${TID}/duplicate`), ctx());

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('duplicate_result_missing');
  });

  it('answers 500 rather than inventing a copy that the read-back cannot find', async () => {
    const { client } = makeSupabase({
      rpcResults: { duplicate_contest_template: { template_id: NEW_ID, version: 2 } },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await duplicatePOST(post(`${TID}/duplicate`), ctx());

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('template_readback_missing');
  });

  it('fails loudly when the copy exists but its slots cannot be read', async () => {
    const { client } = makeSupabase({
      publishedRow: storedRow({ id: NEW_ID }),
      slotReadError: { message: 'permission denied for table template_slots' },
      rpcResults: { duplicate_contest_template: { template_id: NEW_ID, version: 2 } },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await duplicatePOST(post(`${TID}/duplicate`), ctx());

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('template_slots_read_failed');
  });

  it('maps the function\'s "no contest template" raise to 404 template_not_found', async () => {
    const { client } = makeSupabase({
      rpcError: { code: '22023', message: `duplicate_contest_template: no contest template ${TID} to duplicate` },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await duplicatePOST(post(`${TID}/duplicate`), ctx());

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('template_not_found');
    expect(body.error).toContain('Reload');
  });

  it('answers studio_rpc_missing when the migration is not applied here', async () => {
    const { client } = makeSupabase({
      rpcError: {
        code: '42883',
        message: 'function public.duplicate_contest_template(uuid, uuid) does not exist',
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await duplicatePOST(post(`${TID}/duplicate`), ctx());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('studio_rpc_missing');
    expect(body.error).toContain('20272300000000');
  });
});

describe('POST …/publish', () => {
  it('activates via the RPC and answers the stored row plus the archived ids', async () => {
    const { client, calls } = makeSupabase({
      publishedRow: storedRow({
        status: 'active',
        version: 3,
        published_at: '2026-11-28T10:00:00Z',
        published_by: ADMIN_UUID,
      }),
      rpcResults: {
        publish_contest_template: { template_id: TID, version: 3, archived_ids: [SIBLING] },
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await publishPOST(post(`${TID}/publish`), ctx());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, archivedIds: [SIBLING] });
    // status/published_at come from the read-back, which is the row the composer
    // will resolve — not from the request or the RPC's echo.
    expect(body.template).toMatchObject({
      id: TID,
      status: 'active',
      version: 3,
      publishedAt: '2026-11-28T10:00:00Z',
      publishedBy: ADMIN_UUID,
    });
    expect(calls.rpcCalls).toEqual([
      { fn: 'publish_contest_template', args: { p_template_id: TID, p_actor: ADMIN_UUID } },
    ]);
  });

  it('passes p_actor null for an api-key caller and a uuid for a staff profile', async () => {
    const keyed = makeSupabase({
      publishedRow: storedRow({ status: 'active' }),
      rpcResults: { publish_contest_template: { template_id: TID, archived_ids: [] } },
    });
    vi.mocked(createAdminClient).mockReturnValue(keyed.client as any);
    vi.mocked(assertAdminPermission).mockResolvedValueOnce({ actorId: 'api-key', role: 'service' } as any);
    const res1 = await publishPOST(post(`${TID}/publish`), ctx());
    expect(res1.status).toBe(200);
    expect(keyed.calls.rpcCalls[0].args.p_actor).toBeNull();

    const staff = makeSupabase({
      publishedRow: storedRow({ status: 'active' }),
      rpcResults: { publish_contest_template: { template_id: TID, archived_ids: [] } },
    });
    vi.mocked(createAdminClient).mockReturnValue(staff.client as any);
    vi.mocked(assertAdminPermission).mockResolvedValueOnce({ actorId: ADMIN_UUID, role: 'super_admin' } as any);
    const res2 = await publishPOST(post(`${TID}/publish`), ctx());
    expect(res2.status).toBe(200);
    expect(staff.calls.rpcCalls[0].args.p_actor).toBe(ADMIN_UUID);
  });

  it('reports no archived templates when the row was already the only active one', async () => {
    const { client } = makeSupabase({
      publishedRow: storedRow({ status: 'active' }),
      rpcResults: { publish_contest_template: { template_id: TID, archived_ids: [] } },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await publishPOST(post(`${TID}/publish`), ctx());

    expect(res.status).toBe(200);
    expect((await res.json()).archivedIds).toEqual([]);
  });

  it('carries the "no contestant slot" sentence the admin has to act on', async () => {
    const { client } = makeSupabase({
      rpcError: {
        code: '22023',
        message: `publish_contest_template: template "Graduation 2026" (${TID}) has no contestant slot — add one before publishing`,
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await publishPOST(post(`${TID}/publish`), ctx());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('publish_needs_contestant_slot');
    expect(body.error).toContain('add one before publishing');
    expect(body.error).not.toContain('publish_contest_template:');
  });

  it('carries the "no connect contest linked" sentence too', async () => {
    const { client } = makeSupabase({
      rpcError: {
        code: '22023',
        message: `publish_contest_template: template "Graduation 2026" (${TID}) has no connect contest linked, so no contest can resolve it — link it to a contest first`,
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await publishPOST(post(`${TID}/publish`), ctx());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('publish_needs_connect_contest');
    expect(body.error).toContain('link it to a contest first');
  });

  it('answers 500 rather than a published-looking response when the row vanished', async () => {
    const { client } = makeSupabase({
      publishedReadError: { message: 'connection terminated unexpectedly' },
      rpcResults: { publish_contest_template: { template_id: TID, archived_ids: [] } },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await publishPOST(post(`${TID}/publish`), ctx());

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('template_read_failed');
  });
});

describe('POST …/archive', () => {
  it('archives via the RPC and answers changed with the stored row', async () => {
    const { client, calls } = makeSupabase({
      publishedRow: storedRow({ status: 'archived', published_at: '2026-11-01T00:00:00Z' }),
      rpcResults: {
        archive_contest_template: { template_id: TID, status: 'archived', changed: true },
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await archivePOST(post(`${TID}/archive`), ctx());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, changed: true });
    expect(body.template).toMatchObject({ id: TID, status: 'archived' });
    // published_at survives archiving, and the versions panel depends on it: that
    // timestamp is the only record that this row was ever live.
    expect(body.template.publishedAt).toBe('2026-11-01T00:00:00Z');
    expect(calls.rpcCalls[0].args).toEqual({ p_template_id: TID, p_actor: ADMIN_UUID });
  });

  it('reports changed false for the second press, which is not a second event', async () => {
    const { client } = makeSupabase({
      publishedRow: storedRow({ status: 'archived' }),
      rpcResults: {
        archive_contest_template: { template_id: TID, status: 'archived', changed: false },
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await archivePOST(post(`${TID}/archive`), ctx());

    expect(res.status).toBe(200);
    expect((await res.json()).changed).toBe(false);
  });

  it('answers false rather than undefined when the RPC reports nothing at all', async () => {
    const { client } = makeSupabase({ publishedRow: storedRow({ status: 'archived' }) });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await archivePOST(post(`${TID}/archive`), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    // A console that does `if (changed)` and one that does `if (changed === false)` both
    // need a real boolean here; `undefined` would read as "nothing happened".
    expect(body.changed).toBe(false);
  });

  it('maps a missing row to 404 template_not_found through the shared failure shape', async () => {
    const { client } = makeSupabase({
      rpcError: { code: '22023', message: `archive_contest_template: no contest template ${TID} to archive` },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await archivePOST(post(`${TID}/archive`), ctx());

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('template_not_found');
  });
});

describe('GET …/versions', () => {
  it('maps the chain to camelCase, in the order the function sorted it', async () => {
    const { client, calls } = makeSupabase({
      rpcResults: {
        contest_template_versions: {
          // `order by version desc, created_at desc` (20272300000000:275) — the live
          // version first, which is the order the panel renders. A route that re-sorted
          // would pass a fixture written oldest-first, so this one is written newest-first.
          chain: [
            {
              id: NEW_ID,
              name: 'Graduation 2026',
              version: 2,
              status: 'active',
              published_at: '2026-11-28T10:00:00Z',
              created_at: '2026-11-20T00:00:00Z',
            },
            {
              id: TID,
              name: 'Graduation 2026',
              version: 1,
              status: 'archived',
              published_at: '2026-10-01T00:00:00Z',
              created_at: '2026-09-01T00:00:00Z',
            },
          ],
        },
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await versionsGET(new Request(`${BASE}/${TID}/versions`), ctx());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.versions).toEqual([
      {
        id: NEW_ID,
        name: 'Graduation 2026',
        version: 2,
        status: 'active',
        publishedAt: '2026-11-28T10:00:00Z',
        createdAt: '2026-11-20T00:00:00Z',
      },
      {
        id: TID,
        name: 'Graduation 2026',
        version: 1,
        status: 'archived',
        publishedAt: '2026-10-01T00:00:00Z',
        createdAt: '2026-09-01T00:00:00Z',
      },
    ]);
  });

  it('reads the lineage without pretending to write (no p_actor)', async () => {
    const { client, calls } = makeSupabase({
      rpcResults: { contest_template_versions: { chain: [] } },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await versionsGET(new Request(`${BASE}/${TID}/versions`), ctx());

    expect(res.status).toBe(200);
    expect(calls.rpcCalls).toEqual([{ fn: 'contest_template_versions', args: { p_template_id: TID } }]);
    expect(calls.rpcCalls[0].args).not.toHaveProperty('p_actor');
  });

  it('answers an empty list for a template that is not in the chain', async () => {
    const { client } = makeSupabase({ rpcResults: { contest_template_versions: { chain: [] } } });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await versionsGET(new Request(`${BASE}/${TID}/versions`), ctx());

    expect(res.status).toBe(200);
    expect((await res.json()).versions).toEqual([]);
  });

  it('answers an empty list when the function returns nothing at all', async () => {
    const { client } = makeSupabase({});
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await versionsGET(new Request(`${BASE}/${TID}/versions`), ctx());

    expect(res.status).toBe(200);
    expect((await res.json()).versions).toEqual([]);
  });

  it('carries the RPC refusal sentence for a malformed lineage', async () => {
    const { client } = makeSupabase({
      rpcError: { code: '22023', message: 'contest_template_versions: version chain is deeper than 100 levels' },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await versionsGET(new Request(`${BASE}/${TID}/versions`), ctx());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('studio_refused');
    expect(body.error).toContain('deeper than 100 levels');
  });
});

describe('POST …/slot-art', () => {
  it('uploads to slots/<templateId>/<uuid>.<ext> and answers the public URL', async () => {
    const { client, calls } = makeSupabase({ templateRow: storedRow() });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await slotArtPOST(artReq(), ctx());

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(calls.uploads).toHaveLength(1);
    const key = calls.uploadKeys[0];
    expect(key).toMatch(new RegExp(`^slots/${TID}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.png$`));
    expect(body.imageUrl).toBe(`https://cdn.test/${key}`);
    // The bucket's allowed_mime_types and the browser's rendering both read the
    // stored content type, so the upload has to carry the file's own.
    expect(calls.uploads[0].options).toMatchObject({ contentType: 'image/png', upsert: false });
    expect(calls.removedKeys).toEqual([]);
  });

  it('derives the extension from the mime type, not the filename', async () => {
    const { client, calls } = makeSupabase({ templateRow: storedRow() });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const fd = new FormData();
    fd.set('file', new File(['bytes'], 'sticker.jpg', { type: 'image/webp' }));

    const res = await slotArtPOST(post('tpl/slot-art', { body: fd }), ctx());

    expect(res.status).toBe(201);
    expect(calls.uploadKeys[0]).toMatch(/\.webp$/);
  });

  it('refuses a file above the bucket ceiling before uploading anything', async () => {
    const { client, calls } = makeSupabase({ templateRow: storedRow() });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const file = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: MAX_CONTEST_TEMPLATE_UPLOAD_BYTES + 1 });
    const fd = new FormData();
    fd.set('file', file);

    const res = await slotArtPOST(stubMultipart(fd), ctx());

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe('file_too_large');
    expect(body.error).toContain('50MB');
    expect(calls.uploadKeys).toEqual([]);
  });

  it('refuses a mime the bucket would reject before uploading anything', async () => {
    const { client, calls } = makeSupabase({ templateRow: storedRow() });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const fd = new FormData();
    fd.set('file', new File(['bytes'], 'art.tiff', { type: 'image/tiff' }));

    const res = await slotArtPOST(post('tpl/slot-art', { body: fd }), ctx());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('file_type_unsupported');
    expect(body.error).toContain('PNG, JPEG, WebP or SVG');
    expect(calls.uploadKeys).toEqual([]);
  });

  it('refuses a request with no file part', async () => {
    const { client, calls } = makeSupabase({ templateRow: storedRow() });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const fd = new FormData();
    fd.set('slotName', 'ribbon');

    const res = await slotArtPOST(post('tpl/slot-art', { body: fd }), ctx());

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('file_required');
    expect(calls.uploadKeys).toEqual([]);
  });

  it('answers 415 for a body that is not multipart', async () => {
    const { client, calls } = makeSupabase({ templateRow: storedRow() });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await slotArtPOST(
      post('tpl/slot-art', { body: JSON.stringify({}), headers: { 'content-type': 'application/json' } }),
      ctx(),
    );

    expect(res.status).toBe(415);
    expect(calls.uploadKeys).toEqual([]);
  });

  it('refuses art for a template that does not exist', async () => {
    const { client, calls } = makeSupabase({});
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await slotArtPOST(artReq(), ctx());

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('template_not_found');
    expect(calls.uploadKeys).toEqual([]);
  });

  it('refuses art for a published template (D6) instead of stranding an object it cannot attach', async () => {
    const { client, calls } = makeSupabase({ templateRow: storedRow({ status: 'active' }) });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await slotArtPOST(artReq(), ctx());

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('template_is_published');
    expect(body.error).toMatch(/duplicate/i);
    expect(calls.uploadKeys).toEqual([]);
  });

  it('says the server failed when the template read fails, instead of "not found"', async () => {
    const { client, calls } = makeSupabase({
      templateReadError: { message: 'connection terminated unexpectedly' },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await slotArtPOST(artReq(), ctx());

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('template_read_failed');
    expect(calls.uploadKeys).toEqual([]);
  });

  it('classifies a storage refusal with the shared verdict, not the raw error', async () => {
    const { client, calls } = makeSupabase({
      templateRow: storedRow(),
      uploadError: { code: 'EntityTooLarge', message: 'Your card to us' },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await slotArtPOST(artReq(), ctx());

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe('storage_too_large');
    expect(body.error).not.toContain('EntityTooLarge');
    expect(calls.uploadKeys).toHaveLength(1);
  });

  it('answers 500 when the object landed but no public URL resolved', async () => {
    const fake = makeSupabase({ templateRow: storedRow() });
    const client = {
      ...fake.client,
      storage: {
        from: () => ({
          upload: (key: string) => {
            fake.calls.uploadKeys.push(key);
            return Promise.resolve({ data: { path: key }, error: null });
          },
          remove: () => Promise.resolve({ data: [], error: null }),
          getPublicUrl: () => ({ data: {} }),
        }),
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await slotArtPOST(artReq(), ctx());

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('public_url_unresolved');
  });
});
