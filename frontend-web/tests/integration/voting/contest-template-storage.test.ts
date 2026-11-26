/**
 * WHY THIS EXISTS — what a mocked client cannot prove.
 *
 * /admin/voting/templates answered "Failed to upload template image" for every
 * failure, and the report was real: the local storage service was simply stopped,
 * so `supabase.storage.upload()` returned 502 while every other Supabase call kept
 * working. The hermetic specs (tests/unit/voting/contest-templates-admin-api.test.ts,
 * tests/unit/storage/storage-error.spec.ts) mock the client, so they can only prove
 * the shape of the mapping — the error objects they feed in are transcriptions of a
 * real response, not the response.
 *
 * Against a migrated stack this spec proves the four things only the real service
 * decides:
 *   1. the bucket exists with the policy the migration ran (limit + mime list), which
 *      is what frontend-web's new route constants are pinned to;
 *   2. an over-limit file and a disallowed format are refused by storage with the
 *      machine codes `describeStorageFailure` claims to recognise — `status: 400` for
 *      both, which is precisely the trap that made the old blanket 500 useless;
 *   3. a create really produces a public URL that serves those bytes back, so the
 *      compositing pipeline downstream has something to load;
 *   4. an insert refused by a foreign key leaves NOTHING in the bucket — the orphan
 *      the old code wrote on every retry.
 *
 * Local only, like the other live lanes. `SPOTLIGHT_ADMIN_API_KEY` needs no real
 * value: the route and this test share a process, so the spec sets its own fixture
 * key and authenticates with it (src/server/admin/auth.ts:54).
 *
 *   set -a; source frontend-web/.env.local; set +a
 *   cd frontend-web && npm run test:integration
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';
import {
  BUCKET,
  POST as createTemplate,
} from '@/app/api/admin/voting/contest-templates/route';
import { describeStorageFailure } from '@/src/lib/storage/storage-error';
import {
  MAX_CONTEST_TEMPLATE_UPLOAD_BYTES,
  MAX_CONTEST_TEMPLATE_UPLOAD_MB,
} from '@/src/lib/storage/upload-limits';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(SUPABASE_URL && SERVICE_KEY);
const db = () => createClient(SUPABASE_URL as string, SERVICE_KEY as string, { auth: { persistSession: false } });

// A fixture credential, never a real one: assertAdminPermission compares this header
// against process.env.SPOTLIGHT_ADMIN_API_KEY, which only this process reads.
const SPEC_KEY = `contest-template-spec-${randomUUID()}`;
process.env.SPOTLIGHT_ADMIN_API_KEY = SPEC_KEY;

const STAMP = Date.now();
let contestId = '';

/** A genuine 1x1 RGBA PNG, built here so the spec owns its own bytes. */
function png1x1(): Buffer {
  const table = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc32 = (buf: Buffer) => {
    let c = ~0;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const idat = deflateSync(Buffer.from([0, 0, 0, 0, 0])); // filter byte + one pixel
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * `new Blob([buffer])` is a type error, not a runtime one: a Node Buffer is a view
 * over the shared pool, so it is `ArrayBufferView<ArrayBufferLike>` where BlobPart
 * wants `ArrayBuffer`. Copy into a freshly allocated array.
 */
function blobPart(bytes: Buffer): BlobPart {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function routeReq(fields: Record<string, string | Blob>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v as never);
  return new Request('http://localhost/api/admin/voting/contest-templates', {
    method: 'POST',
    // voting_manager, not super_admin: this also proves `votes:manage` is what
    // gates the route. Role tokens are underscore-cased here (src/server/admin/
    // rbac.ts:48); the hyphenated DB slugs are translated by
    // adminRoleFromRbacSlug on the JWT path, which this header bypasses.
    headers: { 'x-admin-key': SPEC_KEY, 'x-admin-role': 'voting_manager' },
    body: form,
  });
}

/** Objects stored directly under `templates/<contestId>/`. */
async function listPrefix(prefix: string) {
  const { data, error } = await db().storage.from(BUCKET).list(prefix);
  expect(error, `listing ${prefix}: ${error?.message}`).toBeNull();
  return data ?? [];
}

beforeAll(async () => {
  const { data, error } = await db()
    .from('connect_contests')
    .insert({ title: `contest-template spec ${STAMP}` })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  contestId = data!.id as string;
});

afterAll(async () => {
  // Nothing this spec writes may outlive it: rows first (they reference the
  // objects), then the objects under both contest prefixes, then the fixture contest.
  const { data: rows } = await db().from('contest_templates').select('id').eq('connect_contest_id', contestId);
  for (const row of rows ?? []) {
    await db().from('contest_templates').delete().eq('id', row.id);
  }
  await db().storage.from(BUCKET).remove(
    (await listPrefix(`templates/${contestId}`)).map((o) => `templates/${contestId}/${o.name}`),
  );
  await db().from('connect_contests').delete().eq('id', contestId);
});

describe.skipIf(!live)('contest-template uploads against the real storage service', () => {
  it('reads back the bucket policy the migration ran', async () => {
    const { data: bucket, error } = await db().storage.getBucket(BUCKET);
    expect(error, `bucket ${BUCKET} must exist: ${error?.message}`).toBeNull();
    expect((bucket as { public?: boolean }).public).toBe(true);
    expect((bucket as { file_size_limit?: number }).file_size_limit).toBe(MAX_CONTEST_TEMPLATE_UPLOAD_BYTES);
    expect([...((bucket as { allowed_mime_types?: string[] }).allowed_mime_types ?? [])].sort()).toEqual(
      ['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml', 'image/webp'],
    );
  });

  it('classifies a real EntityTooLarge refusal as 413, not as a 500', async () => {
    const { error } = await db().storage.from(BUCKET).upload(
      `templates/${contestId}/oversize-${STAMP}.png`,
      Buffer.alloc(MAX_CONTEST_TEMPLATE_UPLOAD_BYTES + 1),
      { contentType: 'image/png' },
    );
    expect(error, 'storage must refuse a file over its own limit').toBeTruthy();

    const verdict = describeStorageFailure(error, {
      bucket: BUCKET,
      subject: 'template image',
      maxMb: MAX_CONTEST_TEMPLATE_UPLOAD_MB,
      formats: ['PNG', 'JPEG', 'WebP', 'SVG'],
    });
    // The trap the classifier exists for: Supabase reports this with HTTP 400.
    expect(verdict.status).toBe(413);
    expect(verdict.code).toBe('storage_too_large');
    expect(verdict.message).toContain(`${MAX_CONTEST_TEMPLATE_UPLOAD_MB}MB`);
  });

  it('classifies a real disallowed-format refusal as 400 with the bucket\'s own list', async () => {
    const { error } = await db().storage.from(BUCKET).upload(
      `templates/${contestId}/bad-${STAMP}.gif`,
      Buffer.from('GIF89a'),
      { contentType: 'image/gif' },
    );
    expect(error, 'the bucket must refuse a mime it does not list').toBeTruthy();

    const verdict = describeStorageFailure(error, {
      bucket: BUCKET,
      subject: 'template image',
      maxMb: MAX_CONTEST_TEMPLATE_UPLOAD_MB,
      formats: ['PNG', 'JPEG', 'WebP', 'SVG'],
    });
    expect(verdict.status).toBe(400);
    expect(verdict.code).toBe('storage_type_rejected');
  });

  it('creates a draft whose public URL really serves the bytes', async () => {
    const bytes = png1x1();
    const res = await createTemplate(
      routeReq({
        name: `Live frame ${STAMP}`,
        connectContestId: contestId,
        file: new Blob([blobPart(bytes)], { type: 'image/png' }),
      }),
    );
    expect(res.status, JSON.stringify(await res.clone().json().catch(() => ({})))).toBe(201);
    const body = await res.json();
    expect(body.template.status).toBe('draft');
    expect(body.template.contestId ?? null).toBeNull();

    const { data: row, error } = await db()
      .from('contest_templates')
      .select('id, template_url, created_by, status')
      .eq('id', body.template.id)
      .single();
    expect(error, error?.message).toBeNull();
    // The x-admin-key path has no user behind it (auth.ts:77), and user_profiles.id
    // is a UUID — writing 'api-key' there is what used to fail this insert after the
    // image had already been uploaded.
    expect((row as { created_by: string | null }).created_by).toBeNull();
    expect((row as { status: string }).status).toBe('draft');

    const served = await fetch((row as { template_url: string }).template_url);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toMatch(/image\/png/);
    expect(Buffer.from(await served.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('refuses a route-level over-limit file before storage sees it', async () => {
    // A count delta, not emptiness: the happy-path spec above legitimately stored a
    // frame under this same prefix, and specs must not depend on each other's order.
    const before = await listPrefix(`templates/${contestId}`);
    const res = await createTemplate(
      routeReq({
        name: `Too big ${STAMP}`,
        connectContestId: contestId,
        file: new Blob([blobPart(Buffer.alloc(MAX_CONTEST_TEMPLATE_UPLOAD_BYTES + 1))], { type: 'image/png' }),
      }),
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe('file_too_large');
    expect(await listPrefix(`templates/${contestId}`), 'nothing may be written for a refused file').toHaveLength(
      before.length,
    );
  });

  it('removes the object it already wrote when the row cannot be inserted', async () => {
    // A syntactically valid UUID that no connect_contests row carries: the route
    // cannot know the FK will fail, so it uploads first — and must then undo it.
    const missing = randomUUID();
    const res = await createTemplate(
      routeReq({
        name: `Orphan probe ${STAMP}`,
        connectContestId: missing,
        file: new Blob([blobPart(png1x1())], { type: 'image/png' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('template_contest_not_found');
    expect(body.error).toMatch(/contest/i);
    expect(await listPrefix(`templates/${missing}`), 'a refused create must leave no image behind').toHaveLength(0);
  });
});
