/**
 * The admin console showed a broken image where a contestant's photo should be.
 *
 * `contestants.photo_url` is not a URL the console can use. The registration
 * flow stores the whole upload response ({"fileName","previewUrl","storageKey"}),
 * and the Go connect module — which is what this page's record comes from —
 * signs the object key against R2 and hands the console a presigned GET. That
 * presigned URL is only reachable when the bytes are actually in the bucket.
 * On localhost they are not: `frontend-web` has no R2 credentials, so the upload
 * landed in its local fallback store ($TMPDIR/spotlight-registration-uploads)
 * and R2 answers 404 NoSuchKey for a signature that is otherwise perfectly
 * valid. Measured on the reported record:
 *   GET https://…r2.cloudflarestorage.com/spotlight-openmic-songs/registration/…jpg
 *     → 404 <Code>NoSuchKey</Code>
 *   the same key on disk → 113,374 bytes
 *
 * Only the web plane can see both stores, so only the web plane can serve the
 * photo. These tests pin the route that does it: admin-gated, key from the
 * stored row (never from the caller), local bytes when R2 is not configured,
 * a presigned redirect when it is, and — the half that stops the same page
 * failing quietly in production — a 404 instead of a signed URL to a missing
 * object. Handing back the preview route itself is not an option: it answers
 * 403 for everyone but the uploader, which is how the voter screens broke too.
 *
 * Pattern follows tests/unit/openmic/song-stream.test.ts (real temp-dir local
 * store, R2 stubbed) and tests/unit/registration/contest-admin-schedule-route.spec.ts
 * (route handler with the auth + supabase boundaries mocked).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const r2 = vi.hoisted(() => ({ configured: false, exists: true }));

vi.mock('@/src/lib/storage/r2', () => ({
  hasR2Config: () => r2.configured,
  assertR2ObjectExists: async () => {
    if (!r2.exists) throw new Error('NotFound: NoSuchKey');
  },
  createR2DownloadUrl: async ({ key }: { key: string }) =>
    `https://bucket.example.invalid/signed/${key}?X-Amz-Signature=deadbeef`,
}));

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));

const selectPhoto = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, value: string) => ({ maybeSingle: () => selectPhoto(value) }),
      }),
    }),
  }),
  createClient: () => ({}),
}));

const { GET } = await import('@/app/api/admin/voting/contestants/[id]/photo/route');
const { assertAdminPermission } = await import('@/src/server/admin/auth');
const { saveLocalUpload } = await import('@/src/lib/storage/local-uploads');

const CONTESTANT_ID = '01e02692-d38b-4f84-b13c-9363e4ab528d';
// The key the reported row names, and the bytes behind it.
const KEY = 'registration/6c6d04cd-5635-4b94-acd1-b5378b8a2975/9c90d2d5-2a8a-4773-8c7e-76061b292e6b.jpg';
const BYTES = Buffer.from('jpeg-bytes-not-a-real-image-but-enough-to-compare');
// Exactly what public.contestants.photo_url holds for an app registration.
const STORED_BLOB = JSON.stringify({
  fileName: 'IMG-20261120-WA0034.jpg',
  previewUrl: `/api/registration/uploads/${Buffer.from(KEY).toString('base64url')}`,
  storageKey: KEY,
});

let dir = '';

function request(photoUrl: string | null) {
  selectPhoto.mockResolvedValueOnce({ data: { photo_url: photoUrl }, error: null });
  return GET(new Request('https://web.test/api/admin/voting/contestants/x/photo'), {
    params: Promise.resolve({ id: CONTESTANT_ID }),
  });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'contestant-photo-'));
  process.env.LOCAL_UPLOAD_DIR = dir;
  await saveLocalUpload(KEY, BYTES);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  r2.configured = false;
  r2.exists = true;
  // Queued rows must not survive into the next case: a test whose request stops
  // before the query (auth refused, malformed id) would otherwise leave its row
  // on the stack for the following test to read.
  selectPhoto.mockReset();
  vi.mocked(assertAdminPermission).mockReset();
  vi.mocked(assertAdminPermission).mockResolvedValue({ role: 'super_admin', actorId: 'admin-1' } as never);
});

describe('admin contestant photo route', () => {
  it('serves the locally stored upload when R2 is not configured (the dev case that 404s today)', async () => {
    const response = await request(STORED_BLOB);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(BYTES);
  });

  it('refuses a caller the web plane does not recognise as admin', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new Error('UNAUTHORIZED'));

    const response = await request(STORED_BLOB);

    expect(response.status).toBe(401);
    // A rejected caller must not learn whether the row has a photo at all.
    expect(selectPhoto).not.toHaveBeenCalled();
  });

  it('answers 404 rather than handing back the owner-only preview route', async () => {
    const missing = JSON.stringify({
      fileName: 'x.jpg',
      previewUrl: '/api/registration/uploads/none',
      storageKey: 'registration/deadbeef/deadbeef.jpg',
    });

    const response = await request(missing);
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).not.toContain('/api/registration/uploads/');
  });

  it('does not sign a bucket object that is not there', async () => {
    r2.configured = true;
    r2.exists = false;

    const response = await request(STORED_BLOB);

    expect(response.status).toBe(404);
  });

  it('redirects to a presigned GET when the bucket does hold the object', async () => {
    r2.configured = true;

    const response = await request(STORED_BLOB);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain(`/signed/${KEY}`);
  });

  it('follows a photo that is already a public external URL', async () => {
    const response = await request('https://cdn.example.test/artist.jpg');

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://cdn.example.test/artist.jpg');
  });

  it('404s a contestant with no photo on record', async () => {
    const response = await request(null);

    expect(response.status).toBe(404);
  });

  it('rejects a malformed id before the query, so it is not a 500', async () => {
    const response = await GET(new Request('https://web.test/api/admin/voting/contestants/x/photo'), {
      params: Promise.resolve({ id: "1 or 1=1" }),
    });

    expect(response.status).toBe(400);
    expect(selectPhoto).not.toHaveBeenCalled();
  });

  it('reads the contestants table this record belongs to, by its id', async () => {
    await request(STORED_BLOB);

    expect(selectPhoto).toHaveBeenCalledWith(CONTESTANT_ID);
  });
});
