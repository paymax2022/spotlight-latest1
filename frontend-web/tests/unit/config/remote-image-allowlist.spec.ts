/**
 * Contest-template images are stored as Supabase public URLs. The admin upload
 * route writes `createAdminClient().storage.from('contest-templates')
 * .getPublicUrl(objectKey)`, and that client is built from
 * NEXT_PUBLIC_SUPABASE_URL — so the host of a stored `template_url` is always
 * the deployment's own Supabase origin: `http://127.0.0.1:54321` in local dev,
 * `https://<project>.supabase.co` in production.
 *
 * imageCompositor's fetch gate used to recognise only six literal CDN hosts and
 * only over https, so every stored template URL was refused and the compositing
 * pass died on `Remote image host is not allowed`. These tests pin the resolved
 * rule: trust exactly the configured origin — nothing else, on any scheme, port
 * or host — while every literal CDN entry keeps behaving as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

// This is the only unit spec that drives Sharp, and libvips defaults to one
// worker thread per core. Left at the default, those threads starve the files
// that follow in the same worker — a `await import()` in the wallet spec crossed
// vitest's 5s default timeout here and the suite went red without any behaviour
// changing. One thread keeps the composite assertions real and the pool quiet.
sharp.concurrency(1);

import { configuredSupabaseOrigin, isAllowedRemoteImageUrl } from '@/lib/config';
import { compositeImage } from '@/lib/rendering/imageCompositor';

const DEV_ORIGIN = 'http://127.0.0.1:54321';
const PROD_ORIGIN = 'https://nmseefdlliejmdbxytej.supabase.co';

/** The shape the dev database actually holds (draft rows, templates/<contestId>/). */
const DEV_TEMPLATE_URL =
  `${DEV_ORIGIN}/storage/v1/object/public/contest-templates/` +
  'templates/c2eca087-c1ba-44ad-8744-b7160d94bc06/frame.png';
const PROD_TEMPLATE_URL =
  `${PROD_ORIGIN}/storage/v1/object/public/contest-templates/` +
  'templates/c2eca087-c1ba-44ad-8744-b7160d94bc06/frame.png';

function configureSupabaseOrigin(url: string | undefined) {
  if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
}

describe('configuredSupabaseOrigin', () => {
  const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
  afterEach(() => configureSupabaseOrigin(saved));

  it('is the protocol+host+port of the configured Supabase URL', () => {
    configureSupabaseOrigin(`${DEV_ORIGIN}/extra/path`);
    expect(configuredSupabaseOrigin()).toBe(DEV_ORIGIN);
  });

  it('is null when no Supabase URL is configured', () => {
    configureSupabaseOrigin(undefined);
    expect(configuredSupabaseOrigin()).toBeNull();
  });

  it('is null when the configured URL is a placeholder that cannot parse', () => {
    configureSupabaseOrigin('not-a-url');
    expect(configuredSupabaseOrigin()).toBeNull();
  });

  it('re-reads the environment instead of caching the first answer', () => {
    configureSupabaseOrigin(DEV_ORIGIN);
    expect(configuredSupabaseOrigin()).toBe(DEV_ORIGIN);
    configureSupabaseOrigin(PROD_ORIGIN);
    expect(configuredSupabaseOrigin()).toBe(PROD_ORIGIN);
  });
});

describe('isAllowedRemoteImageUrl — stored template URLs', () => {
  const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
  afterEach(() => configureSupabaseOrigin(saved));

  it('accepts the dev row shape on the configured loopback origin', () => {
    configureSupabaseOrigin(DEV_ORIGIN);
    expect(isAllowedRemoteImageUrl(DEV_TEMPLATE_URL)).toBe(true);
  });

  it('accepts the production row shape on the configured supabase.co origin', () => {
    configureSupabaseOrigin(PROD_ORIGIN);
    expect(isAllowedRemoteImageUrl(PROD_TEMPLATE_URL)).toBe(true);
  });

  it('refuses a Supabase-looking URL from a project that is not configured', () => {
    configureSupabaseOrigin(PROD_ORIGIN);
    expect(
      isAllowedRemoteImageUrl(
        'https://wnicsubiznmishkmunsv.supabase.co/storage/v1/object/public/contest-templates/a.png',
      ),
    ).toBe(false);
  });

  it('refuses the configured host on another port', () => {
    configureSupabaseOrigin(DEV_ORIGIN);
    expect(isAllowedRemoteImageUrl('http://127.0.0.1:54322/storage/v1/object/public/contest-templates/a.png')).toBe(false);
  });

  it('refuses the configured host on a scheme the config does not use', () => {
    configureSupabaseOrigin(DEV_ORIGIN);
    expect(isAllowedRemoteImageUrl('https://127.0.0.1:54321/storage/v1/object/public/contest-templates/a.png')).toBe(false);
    configureSupabaseOrigin(PROD_ORIGIN);
    expect(isAllowedRemoteImageUrl('http://nmseefdlliejmdbxytej.supabase.co/storage/a.png')).toBe(false);
  });

  it('refuses credentials smuggled into the configured origin', () => {
    configureSupabaseOrigin(DEV_ORIGIN);
    expect(isAllowedRemoteImageUrl(`http://admin:x@127.0.0.1:54321/storage/a.png`)).toBe(false);
  });

  it('refuses a configured-origin path that escapes by host suffix tricks', () => {
    configureSupabaseOrigin(PROD_ORIGIN);
    expect(isAllowedRemoteImageUrl(`https://evil.com/${PROD_ORIGIN}/a.png`)).toBe(false);
    expect(isAllowedRemoteImageUrl('https://nmseefdlliejmdbxytej.supabase.co.evil.com/a.png')).toBe(false);
  });

  it('trusts nothing extra when the Supabase URL is missing or unusable', () => {
    configureSupabaseOrigin(undefined);
    expect(isAllowedRemoteImageUrl(DEV_TEMPLATE_URL)).toBe(false);
    configureSupabaseOrigin('');
    expect(isAllowedRemoteImageUrl(DEV_TEMPLATE_URL)).toBe(false);
    configureSupabaseOrigin('not-a-url');
    expect(isAllowedRemoteImageUrl(DEV_TEMPLATE_URL)).toBe(false);
  });

  it('keeps the literal CDN entries working over https only', () => {
    configureSupabaseOrigin(DEV_ORIGIN);
    expect(isAllowedRemoteImageUrl('https://images.unsplash.com/a.jpg')).toBe(true);
    expect(isAllowedRemoteImageUrl('https://res.cloudinary.com/demo/image/upload/a.png')).toBe(true);
    expect(isAllowedRemoteImageUrl('http://images.unsplash.com/a.jpg')).toBe(false);
  });

  it('refuses anything that is not a URL at all', () => {
    configureSupabaseOrigin(DEV_ORIGIN);
    expect(isAllowedRemoteImageUrl('/storage/a.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('file:///tmp/a.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('')).toBe(false);
  });
});

describe('compositeImage fetches a stored template URL', () => {
  const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let templateBytes: Buffer;

  beforeEach(async () => {
    configureSupabaseOrigin(DEV_ORIGIN);
    templateBytes = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 255 } },
    })
      .png()
      .toBuffer();
  });

  afterEach(() => {
    configureSupabaseOrigin(saved);
    vi.unstubAllGlobals();
  });

  it('reads the template from the configured origin and returns a composite', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return new Response(new Uint8Array(templateBytes), { status: 200 });
      }),
    );

    const result = await compositeImage({
      templateUrl: DEV_TEMPLATE_URL,
      templateWidth: 8,
      templateHeight: 8,
      slots: [],
    });

    expect(fetched).toEqual([DEV_TEMPLATE_URL]);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.mimeType).toBe('image/png');
  });

  it('still refuses a template host that is not the configured origin', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(templateBytes), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      compositeImage({
        templateUrl: 'https://cdn.test/template.png',
        templateWidth: 8,
        templateHeight: 8,
        slots: [],
      }),
    ).rejects.toThrow(/not allowed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
