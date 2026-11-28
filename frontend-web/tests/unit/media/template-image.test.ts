/**
 * Reading the bytes behind a template's stored image URL (spec §5), both
 * directions.
 *
 * `templateImagePlan` is tested apart from `readTemplateImage` on purpose: the
 * admin configuration surface has to census the templates it already has — "3 of
 * 5 are readable, 2 point at a host this app will not fetch" — without spending a
 * request per row, and without depending on the stack being up. The read then has
 * to agree with the plan, which is why the refusal cases below assert that
 * `fetch` was never called: a refusal is a decision, not a failed network trip.
 *
 * The URL shapes are the ones this repo actually produces, not invented ones:
 * the dev database's rows are
 * `http://127.0.0.1:54321/storage/v1/object/public/contest-templates/templates/<contestId>/<fileUuid>.png`
 * and production's are the same path under `https://<project>.supabase.co`,
 * because both come from `supabase.storage.from('contest-templates').getPublicUrl`
 * (`app/api/admin/voting/contest-templates/route.ts:205-228`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTemplateImage, templateImagePlan } from '@/src/lib/media/template-image';

const KEY = 'NEXT_PUBLIC_SUPABASE_URL';
const ORIGIN = 'http://127.0.0.1:54321';
const stored = `${ORIGIN}/storage/v1/object/public/contest-templates/templates/c1/a.png`;

beforeEach(() => {
  process.env[KEY] = ORIGIN;
});

afterEach(() => {
  delete process.env[KEY];
  vi.unstubAllGlobals();
});

describe('templateImagePlan — what would happen, and why, with no network', () => {
  it('names the storage object the admin console wrote', () => {
    expect(templateImagePlan(stored)).toEqual({
      kind: 'storage',
      bucket: 'contest-templates',
      key: 'templates/c1/a.png',
    });
  });

  it('names a third-party CDN object remote', () => {
    expect(templateImagePlan('https://res.cloudinary.com/demo/x.png')).toEqual({ kind: 'remote' });
  });

  it('refuses the shapes the guard refuses, each with the reason that says what to change', () => {
    expect(templateImagePlan('')).toEqual({ kind: 'refused', reason: 'empty' });
    expect(templateImagePlan(null)).toEqual({ kind: 'refused', reason: 'empty' });
    expect(templateImagePlan(undefined)).toEqual({ kind: 'refused', reason: 'empty' });
    expect(templateImagePlan('   ')).toEqual({ kind: 'refused', reason: 'empty' });
    expect(templateImagePlan('nonsense')).toEqual({ kind: 'refused', reason: 'not-a-url' });
    expect(templateImagePlan('https://evil.test/x.png')).toEqual({ kind: 'refused', reason: 'host-not-allowed' });
    expect(templateImagePlan(`${ORIGIN}/storage/v1/object/public/avatars/a.png`))
      .toEqual({ kind: 'refused', reason: 'bucket-not-allowed' });
    expect(templateImagePlan(`${ORIGIN}/rest/v1/contest_templates`))
      .toEqual({ kind: 'refused', reason: 'not-a-storage-object' });
    expect(templateImagePlan('http://postgres:pw@127.0.0.1:54321/storage/v1/object/public/contest-templates/a.png'))
      .toEqual({ kind: 'refused', reason: 'credentials-in-url' });
  });

  it('does not trust a port or scheme variant of the configured origin', () => {
    expect(templateImagePlan('http://127.0.0.1:9999/storage/v1/object/public/contest-templates/a.png'))
      .toEqual({ kind: 'refused', reason: 'host-not-allowed' });
    expect(templateImagePlan('https://127.0.0.1:54321/storage/v1/object/public/contest-templates/a.png'))
      .toEqual({ kind: 'refused', reason: 'host-not-allowed' });
  });
});

describe('readTemplateImage', () => {
  it('returns bytes for a stored template URL — the read that used to be impossible', async () => {
    const fetch = vi.fn(async () => new Response(Buffer.from('template-png-bytes'), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    const read = await readTemplateImage(stored);

    expect(read.ok).toBe(true);
    expect((read as { bytes: Buffer }).bytes).toEqual(Buffer.from('template-png-bytes'));
    expect(fetch).toHaveBeenCalledWith(stored, { cache: 'no-store', redirect: 'follow' });
  });

  it('refuses a host the guard refuses without touching the network', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    expect(await readTemplateImage('https://evil.test/x.png')).toEqual({ ok: false, reason: 'host-not-allowed' });
    expect(await readTemplateImage(null)).toEqual({ ok: false, reason: 'empty' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a non-2xx with its status, so the job record can say so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    expect(await readTemplateImage(stored)).toEqual({ ok: false, reason: 'http-status', status: 404 });
  });

  it('reports an unreachable host as its own reason, not as an HTTP status it never got', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('fetch failed');
    }));
    expect(await readTemplateImage(stored)).toEqual({ ok: false, reason: 'not-fetchable' });
  });

  it('refuses a response that landed on another origin, so a row cannot be a redirect primitive', async () => {
    const landed = 'https://evil.test/x.png';
    const response = {
      ok: true,
      status: 200,
      url: landed,
      arrayBuffer: async () => new ArrayBuffer(4),
    } as unknown as Response;
    const fetch = vi.fn(async () => response);
    vi.stubGlobal('fetch', fetch);

    expect(await readTemplateImage(stored)).toEqual({ ok: false, reason: 'redirected-off-origin' });
  });
});
