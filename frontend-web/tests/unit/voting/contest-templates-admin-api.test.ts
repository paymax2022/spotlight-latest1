/**
 * AD-003/CS-004 — contest-templates admin API
 * (app/api/admin/voting/contest-templates/**).
 *
 * Mirrors tests/unit/registration/vote-packages-crud.spec.ts's pattern:
 * assertAdminPermission and createAdminClient are mocked at their module
 * boundary, so these assert the routes' own contract (auth gating, image
 * validation, draft-on-create, active-requires-contestant-slot guard,
 * delete-while-active refusal) rather than Postgres itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { GET as listGET, POST as createPOST } from '@/app/api/admin/voting/contest-templates/route';
import {
  GET as itemGET,
  PATCH as itemPATCH,
  DELETE as itemDELETE,
} from '@/app/api/admin/voting/contest-templates/[templateId]/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
// Shared with tests/unit/voting/contest-templates-studio.test.ts — one fake, both files.
import { makeSupabase } from './_contest-template-fake';

function ctx(templateId = 'tpl-1') {
  return { params: Promise.resolve({ templateId }) };
}

function jsonReq(method: string, body?: unknown, url = 'https://x.test/api/admin/voting/contest-templates') {
  return new Request(url, { method, body: body ? JSON.stringify(body) : undefined });
}

function multipartReq(fields: Record<string, string | File>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v as any);
  return new Request('https://x.test/api/admin/voting/contest-templates', { method: 'POST', body: fd });
}


beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
});

describe('AD-003/CS-004: contest-templates admin API', () => {
  it('GET (list) is rejected before any query when the caller lacks votes:manage', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    const res = await listGET(jsonReq('GET'));
    expect(res.status).toBe(403);
  });

  it('POST is rejected before any query when the caller lacks votes:manage', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    const res = await createPOST(jsonReq('POST'));
    expect(res.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('POST rejects a create with a non-image file', async () => {
    const { client } = makeSupabase({});
    vi.mocked(createAdminClient).mockReturnValue(client);

    // A UUID contest id on purpose: this asserts the mime gate alone, so the
    // request must otherwise be valid enough to reach it.
    const file = new File(['not an image'], 'evil.txt', { type: 'text/plain' });
    const res = await createPOST(
      multipartReq({ name: 'Contestant Frame', connectContestId: CONTEST_UUID, file }),
    );
    expect(res.status).toBe(400);
  });

  it('POST create succeeds with status:draft and contest_id:null', async () => {
    const insertedTemplate = {
      id: 'tpl-new', name: 'Contestant Frame', connect_contest_id: CONTEST_UUID, contest_id: null,
      template_url: 'https://cdn.test/templates/x.png', file_format: 'png', width: 1080, height: 1080,
      aspect_ratio: '1:1', status: 'draft', version: 1, created_by: 'admin-1',
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    };
    const { client, calls } = makeSupabase({ insertedTemplate });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const file = new File(['fake-png-bytes'], 'frame.png', { type: 'image/png' });
    const res = await createPOST(
      multipartReq({ name: 'Contestant Frame', connectContestId: CONTEST_UUID, file }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.template.status).toBe('draft');
    expect(body.template.contestId).toBeNull();
    expect(calls.insertPayload).toMatchObject({ status: 'draft', contest_id: null, connect_contest_id: CONTEST_UUID });
  });

  /**
   * D6, rewritten for P3: `PATCH status:'active'` keeps its shape for old callers
   * but no longer writes the column. The pre-P3 route set `status='active'` with a
   * local `hasContestantSlot()` read, which is why two templates could be active
   * for one contest at the same time (spec §2 D2 names that as the shipped
   * behaviour). `publish_contest_template` archives the others in the same
   * transaction, so the route's job is now to call it and answer with the stored
   * row — and to prove it never takes the old shortcut.
   */
  it('PATCH to active goes through the publish RPC and never writes status itself', async () => {
    const published = {
      id: 'tpl-1', name: 'Frame', connect_contest_id: 'contest-1', contest_id: null,
      template_url: 'https://cdn/x.png', file_format: 'png', width: 1080, height: 1080,
      aspect_ratio: '1:1', status: 'active', version: 1, created_by: 'admin-1',
      published_at: '2026-01-02T00:00:00Z', published_by: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
    };
    const { client, calls } = makeSupabase({
      templateRow: { id: 'tpl-1', status: 'draft' },
      publishedRow: published,
      rpcResults: { publish_contest_template: { template_id: 'tpl-1', version: 1, archived_ids: ['tpl-0'] } },
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemPATCH(jsonReq('PATCH', { status: 'active' }), ctx('tpl-1'));
    expect(res.status).toBe(200);
    expect(calls.rpcCalls).toEqual([
      { fn: 'publish_contest_template', args: { p_template_id: 'tpl-1', p_actor: null } },
    ]);
    expect(calls.updatePayload, 'publishing must not be a plain UPDATE').toBeNull();
    const body = await res.json();
    expect(body.template.status).toBe('active');
    expect(body.archivedIds).toEqual(['tpl-0']);
  });

  it('PATCH to active answers the RPC\'s own refusal, not a locally rebuilt one', async () => {
    const { client } = makeSupabase({
      templateRow: { id: 'tpl-1', status: 'draft' },
      rpcError: {
        code: '22023',
        message: 'publish_contest_template: template "Finale" (tpl-1) has no contestant slot — add one before publishing',
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemPATCH(jsonReq('PATCH', { status: 'active' }), ctx('tpl-1'));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe('publish_needs_contestant_slot');
    expect(body.error).toContain('no contestant slot');
  });

  it('PATCH to active reports a vanished template as 404', async () => {
    const { client } = makeSupabase({
      templateRow: { id: 'tpl-1', status: 'draft' },
      rpcError: {
        code: '22023',
        message: 'publish_contest_template: no contest template 7f0f1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b to publish',
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemPATCH(jsonReq('PATCH', { status: 'active' }), ctx('tpl-1'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('template_not_found');
  });

  it('DELETE on an active template is refused with 409', async () => {
    const { client } = makeSupabase({ templateRow: { id: 'tpl-1', status: 'active' } });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemDELETE(jsonReq('DELETE'), ctx('tpl-1'));
    expect(res.status).toBe(409);
  });

  it('DELETE on a draft template succeeds', async () => {
    const { client, calls } = makeSupabase({ templateRow: { id: 'tpl-1', status: 'draft' } });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemDELETE(jsonReq('DELETE'), ctx('tpl-1'));
    expect(res.status).toBe(200);
    expect(calls.deletedFrom).toContain('contest_templates');
  });

  it('DELETE on an archived template succeeds', async () => {
    const { client } = makeSupabase({ templateRow: { id: 'tpl-1', status: 'archived' } });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemDELETE(jsonReq('DELETE'), ctx('tpl-1'));
    expect(res.status).toBe(200);
  });

  it('GET single 404s when the template does not exist', async () => {
    const { client } = makeSupabase({ templateRow: null });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemGET(jsonReq('GET'), ctx('missing'));
    expect(res.status).toBe(404);
  });
});

/**
 * The upload itself, when it fails.
 *
 * WHY THIS EXISTS — report 2026-11-25, /admin/voting/templates: an admin picked
 * a frame PNG, got `Error: Failed to upload template image`, and had nothing to
 * act on. The cause was the local storage container being stopped, which the
 * route had logged to its own stdout and then flattened into that one sentence
 * (`route.ts:147`). Same defect family as #1173: a correct refusal, an
 * unreadable answer.
 *
 * These pin the four ways this route can lose an upload and what the console has
 * to hear in each case — plus the two side effects that must NOT happen: writing
 * bytes that no row will ever reference, and rejecting a request whose only
 * fault was that its body never fully arrived.
 */
const CONTEST_UUID = '7f0f1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b';
const ADMIN_UUID = '9c0d1e2f-3c4d-5e6f-7a8b-7f0f1a2b3c4d';
const MB = 1024 * 1024;

function pngFile(name = 'frame.png', type = 'image/png') {
  return new File(['fake-png-bytes'], name, { type });
}

function uploadReq(fields: Record<string, string | File>) {
  return multipartReq({ name: 'Grand Finale Frame', connectContestId: CONTEST_UUID, ...fields });
}

/**
 * A request that hands the route exactly these parts, without a multipart round trip.
 *
 * Only the size gate needs it: `new Request(url, { body: formData })` serializes the
 * form and `request.formData()` rebuilds the File from whatever bytes survived, so its
 * `size` becomes the 14 characters of the fake, not the 51 MB the gate is about. The
 * request itself is otherwise the real shape — same header, same parts.
 */
function partsReq(fields: Record<string, string | File>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v as any);
  return {
    headers: new Headers({ 'content-type': 'multipart/form-data; boundary=----testBoundary' }),
    formData: () => Promise.resolve(fd),
  } as unknown as Request;
}

describe('AD-003: contest-template upload failures reach the admin as reasons', () => {
  it('names the storage service when it is unreachable, instead of a dead-end 500', async () => {
    const { client, calls } = makeSupabase({
      uploadError: {
        name: 'StorageApiError',
        message: 'An invalid response was received from the upstream server',
        status: 502,
        statusCode: '502',
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await createPOST(uploadReq({ file: pngFile() }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe('storage_unreachable');
    expect(body.error).toMatch(/storage service/i);
    // The sentence the bug report contained.
    expect(body.error).not.toBe('Failed to upload template image');
    expect(calls.insertPayload).toBeNull();
  });

  it('refuses an over-bucket-size file before the bytes are sent anywhere', async () => {
    const { client, calls } = makeSupabase({});
    vi.mocked(createAdminClient).mockReturnValue(client);

    const big = pngFile();
    // The bucket's own limit (52 428 800 bytes) is what the route has to clear;
    // a File whose declared size exceeds it must never reach storage.
    Object.defineProperty(big, 'size', { value: 51 * MB });

    const res = await createPOST(
      partsReq({ name: 'Grand Finale Frame', connectContestId: CONTEST_UUID, file: big }),
    );
    const body = await res.json();

    expect(res.status).toBe(413);
    expect(body.error).toMatch(/50MB/);
    expect(calls.uploadKeys, 'the size gate has to run before the upload').toHaveLength(0);
  });

  it('reads a truncated multipart body as a size problem, not a missing content type', async () => {
    const { client, calls } = makeSupabase({});
    vi.mocked(createAdminClient).mockReturnValue(client);

    // A boundary the client did declare, with the closing delimiter missing —
    // byte-for-byte what Next hands the handler when it cuts the body clone at
    // `proxyClientMaxBodySize` (see tests/unit/registration/upload-body-limit.spec.ts).
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const res = await createPOST(
      new Request('https://x.test/api/admin/voting/contest-templates', {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        body:
          `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nFrame\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n` +
          'Content-Type: image/png\r\n\r\nPNGBYTES',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(413);
    expect(body.error).not.toBe('Expected multipart/form-data');
    expect(calls.uploadKeys).toHaveLength(0);
  });

  it('refuses a non-UUID contest id before uploading, so nothing is orphaned', async () => {
    const { client, calls } = makeSupabase({});
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await createPOST(uploadReq({ connectContestId: 'open-mic-2026', file: pngFile() }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/contest/i);
    expect(calls.uploadKeys).toHaveLength(0);
  });

  it('deletes the object it already uploaded when the row cannot be inserted', async () => {
    const { client, calls } = makeSupabase({
      // PostgREST's foreign-key violation for connect_contests, the shape the
      // console used to turn into "Failed to create template".
      insertError: {
        code: '23503',
        message:
          'insert or update on table "contest_templates" violates foreign key constraint "contest_templates_connect_contest_id_fkey"',
        details: 'Key is not present in table "connect_contests".',
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await createPOST(uploadReq({ file: pngFile() }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/contest/i);
    expect(calls.uploadKeys).toHaveLength(1);
    // The whole point: a refused create must not leave a frame in the bucket.
    expect(calls.removedKeys).toEqual(calls.uploadKeys);
  });

  it('still reports a hard failure when the cleanup of that object also fails', async () => {
    const { client, calls } = makeSupabase({
      insertError: { code: '23503', message: 'violates foreign key constraint "contest_templates_created_by_fkey"' },
    });
    vi.mocked(createAdminClient).mockReturnValue(client);
    client.storage.from = () => ({
      upload: (key: string) => {
        calls.uploadKeys.push(key);
        return Promise.resolve({ data: { path: key }, error: null });
      },
      remove: () => Promise.resolve({ data: null, error: { message: 'storage refuses to delete' } }),
      getPublicUrl: (key: string) => ({ data: { publicUrl: `https://cdn.test/${key}` } }),
    });

    const res = await createPOST(uploadReq({ file: pngFile() }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
    expect(body.error).not.toMatch(/undefined/);
  });

  it('does not write a non-UUID actor into created_by', async () => {
    // The x-admin-key path of assertAdminPermission returns actorId 'api-key'
    // (src/server/admin/auth.ts:77). contest_templates.created_by is a UUID with
    // an FK to user_profiles, so passing it through failed the insert AFTER a
    // successful upload — a guaranteed 500 plus an orphaned image for every
    // server-to-server create.
    vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'api-key', role: 'super_admin' } as any);
    const { client, calls } = makeSupabase({ insertedTemplate: { id: 'tpl-new', status: 'draft' } });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await createPOST(uploadReq({ file: pngFile() }));

    expect(res.status).toBe(201);
    expect(calls.insertPayload.created_by).toBeNull();
  });

  it('keeps a real admin UUID as created_by and leaves the object alone on success', async () => {
    vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: ADMIN_UUID, role: 'super_admin' } as any);
    const { client, calls } = makeSupabase({ insertedTemplate: { id: 'tpl-new', status: 'draft' } });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await createPOST(uploadReq({ file: pngFile() }));

    expect(res.status).toBe(201);
    expect(calls.insertPayload.created_by).toBe(ADMIN_UUID);
    expect(calls.removedKeys, 'a create that worked must not delete its own image').toHaveLength(0);
  });
});
