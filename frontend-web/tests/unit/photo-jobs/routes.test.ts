/**
 * Task 8 — the three surfaces the spec's polling contract is made of.
 *
 * What is under test is the promise each surface exists to keep:
 *
 * `GET /api/photo-jobs/[id]` is the poll target, so its one job is to never
 * describe a half-built portrait. That is why asset URLs appear only on a `ready`
 * row, why `listPhotoAssets` is not even called for a job that is still running,
 * and why the ownership check reads the registration's user from the row rather
 * than trusting the caller's id — RLS denies both tables to every non-service
 * role (migration §RLS note), so a client-side read is not a fallback that exists.
 *
 * `POST` on the same route cancels. `cancel_photo_job` is `returns void` with a
 * `where status not in ('ready','cancelled')` guard, so the route pre-reads the
 * row and answers 409 on a terminal job instead of returning `cancelled: true`
 * for an action that changed nothing.
 *
 * `GET /api/admin/photo-config-status` is the surface that has to be honest about
 * things an env var cannot prove. It reports names and verdicts, never values:
 * the sentinel test below injects real-shaped secrets and asserts none of them
 * reach the body, because this payload is readable by any admin-role caller.
 * Task 12 added two sections to it — a census of the stored template URLs, which
 * is the probe that keeps P2's invisible "no environment can read a template"
 * defect from coming back, and the renderer's own blend tables so the studio's
 * sliders cannot drift from the numbers the compositor clamps against.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  getPhotoJob: vi.fn(),
  getLatestPhotoJob: vi.fn(),
  listPhotoAssets: vi.fn(),
  cancelPhotoJob: vi.fn(),
  photoJobSummary: vi.fn(),
}));
const worker = vi.hoisted(() => ({ maybeDrainPhotoJobs: vi.fn() }));
const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
const adminAuth = vi.hoisted(() => ({ assertAdminPermission: vi.fn() }));
const r2 = vi.hoisted(() => ({
  hasR2Config: vi.fn(),
  getR2PublicUrl: vi.fn(),
  createR2DownloadUrl: vi.fn(),
}));
/**
 * Task 12 gives this route its first direct database read: the template census.
 * Mocked rather than real because the census runs on every page view of the
 * configuration surface, and the P2 defect it exists to catch — a template URL
 * the reader will refuse — is provable from the stored shape without a storage
 * service answering.
 */
const supabase = vi.hoisted(() => ({ createAdminClient: vi.fn() }));

vi.mock('@/src/server/photo-jobs/job-store', () => store);
vi.mock('@/src/server/photo-jobs/worker', () => worker);
vi.mock('@/src/lib/auth/server', () => auth);
vi.mock('@/src/server/admin/auth', () => adminAuth);
vi.mock('@/src/lib/storage/r2', () => r2);
vi.mock('@/lib/supabase/server', () => supabase);

import { GET, POST } from '@/app/api/photo-jobs/[id]/route';
import { GET as LATEST } from '@/app/api/photo-jobs/latest/route';
import { GET as CONFIG } from '@/app/api/admin/photo-config-status/route';
import { isUuidId } from '@/src/server/photo-jobs/status-read';
import { BOUNDS, PRESETS, SHADOW_MODES } from '@/lib/rendering/blend/params';
import { PHOTO_MODES, SLOT_ANCHORS } from '@/src/server/template-studio/authoring';

const uuid = 'b7f3f1d2-3f1c-4a5e-9c3b-2a1d0e4f5a6b';
/** The origin the reader trusts, because `configuredSupabaseOrigin()` reads it from
 *  the server environment rather than from a row: it is stubbed in `beforeEach` so a
 *  template URL built from it is the same shape an admin upload produces. */
const ORIGIN = 'http://127.0.0.1:54321';
/** Both ids in these cases are real uuids because the routes refuse anything
 *  else: `id` and `registration_id` are uuid columns, and a non-uuid filter value
 *  reaches Postgres as 22P02, so the guard is a 400 here rather than a 500 there.
 *  `jobId` is the row's id, `uuid` the registration the latest route is asked about. */
const jobId = '6d2c9f4a-1b7e-4c3d-8a5f-0e9d1c2b3a44';
const key = 'contestants/composited/9b1c2d3e.png';

const job = (over: Record<string, unknown> = {}) => ({
  id: jobId,
  run_key: 'photo:orig:none:',
  registration_id: 'r1',
  registration_user_id: 'u1',
  contest_id: 'c1',
  template_id: null,
  source_asset_id: 'a-original',
  status: 'ready',
  progress: 100,
  attempt: 1,
  max_attempts: 6,
  last_error: null,
  render_params: {},
  result_asset_id: 'a-final',
  ...over,
});

const statusRequest = (url = `http://x.test/api/photo-jobs/${jobId}`, init: RequestInit = {}) =>
  new Request(url, init);
const ctx = (id = jobId) => ({ params: Promise.resolve({ id }) });

/** The config route reads its blockers from the environment at call time, so the
 *  cases that flip Cloudinary between configured and unconfigured would leak into
 *  each other — and into the next file — without this. Assigning `undefined` to
 *  `process.env` stores the string "undefined", which is truthy to every
 *  `!process.env.X` check in `missingCloudinaryEnv()`, so an absent variable has
 *  to be deleted rather than unset. */
const ENV_KEYS = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'R2_PUBLIC_BASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  // Task 12: the census classifies a stored URL against this origin, so the tests
  // need it to hold the dev value the reader trusts. Snapshot-restored like the
  // others, because a Supabase origin left pointing at 127.0.0.1 would change how
  // the next file's template URLs classify.
  'NEXT_PUBLIC_SUPABASE_URL',
] as const;
const envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  vi.resetAllMocks();
  auth.requireUser.mockResolvedValue({ user: { id: 'u1' } });
  adminAuth.assertAdminPermission.mockResolvedValue({ role: 'super-admin' });
  r2.hasR2Config.mockReturnValue(true);
  r2.getR2PublicUrl.mockImplementation((k: string) => `https://cdn.test/${k}`);
  r2.createR2DownloadUrl.mockImplementation(async ({ key: k }: { key: string }) => `https://signed.test/${k}`);
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;
  // Default: an empty table. The four pre-existing config-status cases are about
  // provider/storage/jobs truth, and a route that gained an unmocked database read
  // would otherwise answer 500 for them — which is exactly the regression this
  // fake exists to make visible rather than to hide.
  supabase.createAdminClient.mockReturnValue({
    from: () => ({
      select: () => ({
        in: () => {
          const p = Promise.resolve({ data: [], error: null });
          return Object.assign(p, { limit: () => p });
        },
      }),
    }),
  });
  store.listPhotoAssets.mockResolvedValue([]);
  store.photoJobSummary.mockResolvedValue({ queued: 0, processing: 0, failed: 0, paused: 0, ready: 0 });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envSnapshot[k] === undefined) delete process.env[k];
    else process.env[k] = envSnapshot[k];
  }
});

describe('GET /api/photo-jobs/[id]', () => {
  it('gives the owner the published asset URLs, through the public base when one is configured', async () => {
    store.getPhotoJob.mockResolvedValue(job());
    store.listPhotoAssets.mockResolvedValue([
      { kind: 'final', storage_key: key },
      { kind: 'preview', storage_key: 'contestants/preview/1.png' },
      { kind: 'transparent', provider_url: 'https://res.cloudinary.com/demo/image.png' },
    ]);

    const res = await GET(statusRequest(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job.status).toBe('ready');
    expect(body.job.assets.final).toBe(`https://cdn.test/${key}`);
    // Only our own stored output is given out, and only by kind: a cutout is not
    // something a status surface should hand to a client.
    expect(body.job.assets.transparent).toBeUndefined();
    expect(body.job.assets.thumbnail).toBeUndefined();
  });

  it('signs the key when no public base exists, rather than inventing a route', async () => {
    r2.getR2PublicUrl.mockReturnValue(undefined);
    store.getPhotoJob.mockResolvedValue(job());
    store.listPhotoAssets.mockResolvedValue([{ kind: 'final', storage_key: key }]);

    const body = await (await GET(statusRequest(), ctx())).json();
    expect(body.job.assets.final).toBe(`https://signed.test/${key}`);
    expect(r2.createR2DownloadUrl).toHaveBeenCalledWith(expect.objectContaining({ key }));
  });

  it('carries no asset URLs while the job is still working, and does not read assets at all', async () => {
    store.getPhotoJob.mockResolvedValue(job({ status: 'compositing', progress: 70, result_asset_id: null }));

    const body = await (await GET(statusRequest(), ctx())).json();
    expect(body.job).toMatchObject({ status: 'compositing', progress: 70, assets: {} });
    expect(store.listPhotoAssets).not.toHaveBeenCalled();
  });

  it('refuses a job whose registration the caller does not own, before reading its assets', async () => {
    store.getPhotoJob.mockResolvedValue(job({ registration_user_id: 'someone-else' }));

    const res = await GET(statusRequest(), ctx());
    expect(res.status).toBe(403);
    expect(store.listPhotoAssets).not.toHaveBeenCalled();
  });

  it('answers 404 for a job that is not there, including the store saying "read failed"', async () => {
    store.getPhotoJob.mockResolvedValue(null);
    expect((await GET(statusRequest(), ctx())).status).toBe(404);
  });

  it('surfaces the reason only for a job that has one to show', async () => {
    store.getPhotoJob.mockResolvedValue(job({ status: 'paused', progress: 35, last_error: 'Cloudinary timed out' }));
    const body = await (await GET(statusRequest(), ctx())).json();
    expect(body.job).toMatchObject({ status: 'paused', progress: 35, lastError: 'Cloudinary timed out' });

    store.getPhotoJob.mockResolvedValue(job({ status: 'failed', last_error: null }));
    const failed = await (await GET(statusRequest(), ctx())).json();
    expect(failed.job.lastError).toBeNull();
  });

  it('kicks the drain without waiting for it, so an idle process still starts a queued job', async () => {
    store.getPhotoJob.mockResolvedValue(job({ status: 'queued', progress: 0 }));
    worker.maybeDrainPhotoJobs.mockImplementation(() => {
      throw new Error('drain blew up');
    });

    const res = await GET(statusRequest(), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).job.status).toBe('queued');
  });

  it('answers 400 on a malformed id instead of letting Postgres raise 22P02', async () => {
    const res = await GET(statusRequest('http://x.test/api/photo-jobs/not-a-uuid'), ctx('not-a-uuid'));
    expect(res.status).toBe(400);
    expect(store.getPhotoJob).not.toHaveBeenCalled();
    // A uuid-shaped id from a path is not a uuid-shaped id from a query: the
    // latest route filters by registration_id, and the same guard covers it.
    expect(isUuidId(uuid)).toBe(true);
  });

  it('401s when there is no user, without touching the store', async () => {
    auth.requireUser.mockRejectedValue(new Error('UNAUTHORIZED'));
    expect((await GET(statusRequest(), ctx())).status).toBe(401);
    expect(store.getPhotoJob).not.toHaveBeenCalled();
  });
});

describe('POST /api/photo-jobs/[id] cancel', () => {
  it('cancels a job the caller owns and reports it', async () => {
    store.getPhotoJob.mockResolvedValue(job({ status: 'extracting' }));
    const res = await POST(statusRequest(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: true, id: jobId });
    expect(store.cancelPhotoJob).toHaveBeenCalledWith(jobId, 'Cancelled by the contestant');
  });

  it('refuses a terminal job with 409 rather than claiming it changed anything', async () => {
    store.getPhotoJob.mockResolvedValue(job({ status: 'ready' }));
    const res = await POST(statusRequest(), ctx());
    expect(res.status).toBe(409);
    expect(store.cancelPhotoJob).not.toHaveBeenCalled();
  });

  it('refuses a job it does not own before calling the cancel RPC', async () => {
    store.getPhotoJob.mockResolvedValue(job({ registration_user_id: 'someone-else', status: 'queued' }));
    expect((await POST(statusRequest(), ctx())).status).toBe(403);
    expect(store.cancelPhotoJob).not.toHaveBeenCalled();
  });
});

describe('GET /api/photo-jobs/latest', () => {
  const latestUrl = (id = uuid) => `http://x.test/api/photo-jobs/latest?registrationId=${id}`;

  it('returns the newest job for the registration its caller owns', async () => {
    store.getLatestPhotoJob.mockResolvedValue(job({ status: 'extracting', progress: 5 }));
    const res = await LATEST(new Request(latestUrl(), { headers: new Headers({ authorization: 'Bearer t' }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).job).toMatchObject({ id: jobId, status: 'extracting' });
    expect(store.getLatestPhotoJob).toHaveBeenCalledWith(uuid);
  });

  it('requires a registration id and refuses one that is not a uuid', async () => {
    expect((await LATEST(new Request('http://x.test/api/photo-jobs/latest'))).status).toBe(400);
    expect((await LATEST(new Request(latestUrl('1=1')))).status).toBe(400);
    expect(store.getLatestPhotoJob).not.toHaveBeenCalled();
  });

  it('404s when the registration has no job, so a surface can fall back to the original', async () => {
    store.getLatestPhotoJob.mockResolvedValue(null);
    expect((await LATEST(new Request(latestUrl()))).status).toBe(404);
  });

  it('403s when the newest job belongs to somebody else', async () => {
    store.getLatestPhotoJob.mockResolvedValue(job({ registration_user_id: 'someone-else' }));
    expect((await LATEST(new Request(latestUrl()))).status).toBe(403);
  });
});

describe('GET /api/admin/photo-config-status', () => {
  const configRequest = () =>
    new Request('http://x.test/api/admin/photo-config-status', {
      headers: new Headers({ authorization: 'Bearer admin' }),
    });

  it('is gated by the admin permission the review surfaces already use', async () => {
    adminAuth.assertAdminPermission.mockRejectedValue(new Error('FORBIDDEN'));
    expect((await CONFIG(configRequest())).status).toBe(403);
    // Auth first, before any read: the census is the route's only database call and
    // a rejected caller must not be able to make it.
    expect(supabase.createAdminClient).not.toHaveBeenCalled();
  });

  it('names the missing provider variables as a blocker when nothing is configured', async () => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;

    const body = await (await CONFIG(configRequest())).json();
    expect(body.provider).toMatchObject({ configured: false, name: 'none', cloudNamePresent: false });
    expect(body.blockers.join(' ')).toContain('CLOUDINARY_CLOUD_NAME');
  });

  it('reports storage truthfully: presign availability is what the provider needs', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo';
    process.env.CLOUDINARY_API_KEY = '123456789012345';
    process.env.CLOUDINARY_API_SECRET = 'a-secret-value';
    delete process.env.R2_PUBLIC_BASE_URL;
    r2.hasR2Config.mockReturnValue(false);

    const body = await (await CONFIG(configRequest())).json();
    expect(body.storage).toEqual({
      r2Configured: false,
      publicBaseUrlConfigured: false,
      presignForProvider: 'unavailable',
    });
    expect(body.blockers.join(' ')).toContain('R2 is not configured');
  });

  it('surfaces paused work as a blocker an operator has to look at', async () => {
    store.photoJobSummary.mockResolvedValue({ queued: 1, processing: 0, failed: 4, paused: 3, ready: 9 });
    const body = await (await CONFIG(configRequest())).json();
    expect(body.jobs).toEqual({ queued: 1, processing: 0, paused: 3, failed: 4 });
    expect(body.blockers.join(' ')).toContain('3 paused');
  });

  it('never leaks a value it read from the environment', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
    process.env.CLOUDINARY_API_KEY = 'SENTINEL-API-KEY';
    process.env.CLOUDINARY_API_SECRET = 'SENTINEL-API-SECRET';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'SENTINEL-SERVICE-ROLE';
    process.env.R2_PUBLIC_BASE_URL = 'https://cdn.test';

    const res = await CONFIG(configRequest());
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('SENTINEL-API-KEY');
    expect(text).not.toContain('SENTINEL-API-SECRET');
    expect(text).not.toContain('SENTINEL-SERVICE-ROLE');
    // The cloud name is a public identifier, not a secret: it is what the vendor
    // URL is built from, and the surface is more useful naming it than hiding it.
    expect(text).toContain('demo-cloud');
  });

  it('says the vendor add-on state is unprobed instead of claiming it is fine', async () => {
    const body = await (await CONFIG(configRequest())).json();
    expect(body.provider.extractionProbe).toBe('not_attempted');
    expect(body.provider.moderationProbe).toBe('not_attempted');
    expect(body.provider.probeNote).toContain('test asset');
  });

  // ─── Task 12: the template census and the published blend bounds ───────────
  //
  // This exists because of a defect that stayed invisible for two phases: P2's
  // blend tests handed the resolver a `https://cdn.test/template.png`, so nothing
  // ever ran the real trust predicate against the URL shape an admin upload
  // actually produces — which meant no environment could read a template at all,
  // and every job degraded to a paste while the configuration page looked green.
  // A probe that has to fetch would not have caught it either (the shape is the
  // fault), and a probe that only runs when an admin presses preview cannot tell
  // the operator about it before a contestant notices.

  function census(rows: any[] | null, error: any = null) {
    const seen: { table: string; columns: string; filter: { column: string; values: unknown[] }; limit?: number }[] = [];
    supabase.createAdminClient.mockReturnValue({
      from: (table: string) => ({
        select: (columns: string) => ({
          in: (column: string, values: unknown[]) => {
            const entry: any = { table, columns, filter: { column, values } };
            const result = Promise.resolve(error ? { data: null, error } : { data: rows ?? [], error: null });
            // `.limit()` is recorded because it is the difference between a census
            // and an unbounded select on a diagnostics page, and the only way a
            // dropped cap shows up as a failing assertion instead of a slower page.
            seen.push(entry);
            return Object.assign(result, {
              limit: (n: number) => {
                entry.limit = n;
                return result;
              },
            });
          },
        }),
      }),
    });
    return seen;
  }

  const frame = (over: Record<string, unknown> = {}) => ({
    id: uuid,
    name: 'Graduation 2026',
    status: 'active',
    template_url: `${ORIGIN}/storage/v1/object/public/contest-templates/templates/tpl-1/frame.png`,
    ...over,
  });

  it('counts a readable active frame and raises no template blocker', async () => {
    const seen = census([frame()]);

    const body = await (await CONFIG(configRequest())).json();
    expect(body.templates).toMatchObject({
      counted: true,
      activeCount: 1,
      readableCount: 1,
      draftCount: 0,
      refused: [],
    });
    expect(body.blockers.join(' ')).not.toMatch(/template/i);

    // The filter is the point of the read: an archived row is history, and
    // counting it would report a broken frame that no contest can resolve.
    expect(seen).toHaveLength(1);
    expect(seen[0].table).toBe('contest_templates');
    expect(seen[0].filter).toEqual({ column: 'status', values: ['active', 'draft'] });
    // Not `select('*')`: the census needs four columns per row, and a configuration
    // page that drags every template's `blend_settings` and thumbnails on every
    // page view is a slow page for information nobody reads there.
    expect(seen[0].columns).toContain('template_url');
    expect(seen[0].columns).not.toBe('*');
    expect(typeof seen[0].limit).toBe('number');
  });

  it('names the host and the reason for a frame the reader will refuse', async () => {
    census([frame({ template_url: 'https://evil.test/x.png' })]);

    const body = await (await CONFIG(configRequest())).json();
    expect(body.templates.readableCount).toBe(0);
    expect(body.templates.refused).toEqual([
      { id: uuid, name: 'Graduation 2026', reason: 'host-not-allowed', host: 'evil.test' },
    ]);
    const blockers = body.blockers.join(' ');
    expect(blockers).toContain('1 active template');
    expect(blockers).toContain('host-not-allowed');
    // The sentence has to name the fix, not just the count — this is the state the
    // whole feature was invisible in.
    expect(blockers).toMatch(/re-upload|edit the template|storage/i);
  });

  it('separates a same-origin row in the wrong bucket from a foreign host', async () => {
    census([frame({ template_url: `${ORIGIN}/storage/v1/object/public/avatars/face.png` })]);

    const body = await (await CONFIG(configRequest())).json();
    expect(body.templates.refused[0].reason).toBe('bucket-not-allowed');
  });

  it('counts an allowlisted remote frame as readable', async () => {
    census([frame({ template_url: 'https://images.unsplash.com/photo-1.png' })]);

    const body = await (await CONFIG(configRequest())).json();
    // `templateImagePlan` answers `remote`, not `storage`, for a host on the closed
    // SSRF list, and the compositor can read it. Counting only same-origin objects
    // would report a working template as broken — a blocker nobody can act on.
    expect(body.templates).toMatchObject({ activeCount: 1, readableCount: 1, refused: [] });
    expect(body.blockers.join(' ')).not.toMatch(/template/i);
  });

  it('reports a row with no stored frame, and no invented host', async () => {
    census([frame({ template_url: null })]);

    const body = await (await CONFIG(configRequest())).json();
    // `empty` is its own reason — the fix is to upload a frame, not to move one —
    // and `host` stays null rather than becoming the string "null" in a console cell.
    expect(body.templates.refused).toEqual([{ id: uuid, name: 'Graduation 2026', reason: 'empty', host: null }]);
  });

  it('counts every refusal but lists the cap', async () => {
    census(Array.from({ length: 25 }, (_, i) => frame({ id: `t${i}`, name: `Template ${i}`, template_url: 'https://evil.test/x.png' })));

    const body = await (await CONFIG(configRequest())).json();
    expect(body.templates).toMatchObject({ activeCount: 25, readableCount: 0, refusedCount: 25 });
    // The count in the sentence is the true one; the array is what a banner can
    // render. Both properties matter, so neither is allowed to imply the other.
    expect(body.templates.refused).toHaveLength(20);
    expect(body.blockers.join(' ')).toContain('25 active templates');
  });

  it('separates "nothing published yet" from "nothing readable"', async () => {
    census([
      frame({ id: 'd1', status: 'draft', template_url: 'https://evil.test/a.png' }),
      frame({ id: 'd2', status: 'draft' }),
      frame({ id: 'a1' }),
    ]);

    const body = await (await CONFIG(configRequest())).json();
    // A broken draft is a studio problem, not a contestant outage: the blocker
    // fires on the active set only, and `draftCount` is what stops a fresh
    // environment (0 active) from being reported as a reader that works.
    expect(body.templates).toMatchObject({ activeCount: 1, readableCount: 1, draftCount: 2, refused: [] });
    expect(body.blockers.join(' ')).not.toMatch(/template/i);
  });

  it('survives a failed census as a blocker instead of a 500 on the status page', async () => {
    census(null, { code: '42P01', message: 'relation "contest_templates" does not exist' });

    const res = await CONFIG(configRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.templates).toMatchObject({ counted: false, activeCount: 0, readableCount: 0, refused: [] });
    expect(body.blockers.join(' ')).toContain('templates could not be counted');
  });

  it('publishes the renderer\'s own bounds and preset list, verbatim', async () => {
    census([]);
    const body = await (await CONFIG(configRequest())).json();

    // The parity assertion is made against the imported table, not a literal:
    // the point is that the console's sliders are bounded by the same numbers the
    // compositor clamps against, so a seventh knob or a widened range reaches the
    // admin UI without anyone editing two packages.
    expect(body.blend.bounds).toEqual(BOUNDS);
    expect(body.blend.bounds.featherPx).toEqual([0, 2]);
    expect(body.blend.presets).toEqual(Object.keys(PRESETS));
    expect(body.blend.shadowModes).toEqual([...SHADOW_MODES]);
    expect(body.blend.modes).toEqual([...PHOTO_MODES]);
    expect(body.blend.anchors).toEqual([...SLOT_ANCHORS]);
  });
});
