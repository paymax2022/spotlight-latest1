/**
 * The image-host guard, both directions.
 *
 * Why this file exists: the admin create route writes
 * `<NEXT_PUBLIC_SUPABASE_URL>/storage/v1/object/public/contest-templates/…`
 * (`app/api/admin/voting/contest-templates/route.ts:227`) and every compositing
 * reader refused it, because `allowedRemoteImageHostnames` only names third-party
 * CDNs. The fix has to widen exactly one origin and nothing else, so the refusals
 * below are the test: a guard that reads a stored row's host as trusted is an
 * SSRF primitive, not a convenience. Editing a `contest_templates.template_url`
 * must therefore buy an attacker nothing — the value is only fetchable when it is
 * byte-for-byte this app's own configured origin serving a public object of an
 * allowlisted bucket, or one of the literal CDN hosts it already trusted.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  configuredSupabaseOrigin,
  isAllowedRemoteImageUrl,
  isConfiguredSupabaseOrigin,
} from '@/lib/config';

const KEY = 'NEXT_PUBLIC_SUPABASE_URL';
const DEV_ORIGIN = 'http://127.0.0.1:54321';
const DEV_OBJECT = `${DEV_ORIGIN}/storage/v1/object/public/contest-templates/templates/c1/a.png`;
const PROD_ORIGIN = 'https://demo-project.supabase.co';
const PROD_OBJECT = `${PROD_ORIGIN}/storage/v1/object/public/contest-templates/templates/c1/a.png`;
const previous = process.env[KEY];

beforeAll(() => {
  process.env[KEY] = DEV_ORIGIN;
});

afterEach(() => {
  process.env[KEY] = DEV_ORIGIN;
});

afterAll(() => {
  if (previous === undefined) delete process.env[KEY];
  else process.env[KEY] = previous;
});

describe('the configured Supabase origin is trusted, exactly', () => {
  it('accepts the URL shape the admin console writes in dev', () => {
    expect(configuredSupabaseOrigin()).toBe(DEV_ORIGIN);
    expect(isConfiguredSupabaseOrigin(DEV_ORIGIN)).toBe(true);
    expect(isAllowedRemoteImageUrl(DEV_OBJECT)).toBe(true);
  });

  it('accepts the production shape from the same variable', () => {
    process.env[KEY] = PROD_ORIGIN;
    expect(configuredSupabaseOrigin()).toBe(PROD_ORIGIN);
    expect(isAllowedRemoteImageUrl(PROD_OBJECT)).toBe(true);
  });

  it('refuses a different port on the same host', () => {
    expect(isAllowedRemoteImageUrl(
      'http://127.0.0.1:9999/storage/v1/object/public/contest-templates/templates/c1/a.png',
    )).toBe(false);
  });

  it('refuses the other scheme, in both directions', () => {
    process.env[KEY] = PROD_ORIGIN;
    expect(isAllowedRemoteImageUrl(
      'http://demo-project.supabase.co/storage/v1/object/public/contest-templates/a.png',
    )).toBe(false);
    process.env[KEY] = DEV_ORIGIN;
    expect(isAllowedRemoteImageUrl(
      'https://127.0.0.1:54321/storage/v1/object/public/contest-templates/a.png',
    )).toBe(false);
  });

  it('refuses credentials smuggled into the URL', () => {
    expect(isAllowedRemoteImageUrl(
      'http://postgres:pw@127.0.0.1:54321/storage/v1/object/public/contest-templates/a.png',
    )).toBe(false);
  });

  it('refuses another bucket of the same origin, and a path that is not a public object', () => {
    expect(isAllowedRemoteImageUrl('http://127.0.0.1:54321/storage/v1/object/private/contest-templates/a.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('http://127.0.0.1:54321/storage/v1/object/public/avatars/a.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('http://127.0.0.1:54321/rest/v1/contest_templates')).toBe(false);
    expect(isAllowedRemoteImageUrl('http://127.0.0.1:54321/')).toBe(false);
  });

  it('refuses a prefix look-alike host', () => {
    process.env[KEY] = PROD_ORIGIN;
    expect(isAllowedRemoteImageUrl(
      'https://demo-project.supabase.co.evil.test/storage/v1/object/public/contest-templates/a.png',
    )).toBe(false);
    expect(isAllowedRemoteImageUrl('https://evil-demo-project.supabase.co/storage/v1/object/public/contest-templates/a.png')).toBe(false);
  });

  it('is inert when the app has no Supabase URL configured', () => {
    delete process.env[KEY];
    expect(configuredSupabaseOrigin()).toBeNull();
    expect(isConfiguredSupabaseOrigin(DEV_ORIGIN)).toBe(false);
    expect(isAllowedRemoteImageUrl(DEV_OBJECT)).toBe(false);
  });
});

describe('the literal CDN entries still work', () => {
  it('accepts each allowlisted host over https and refuses it over http', () => {
    expect(isAllowedRemoteImageUrl('https://res.cloudinary.com/demo/x.png')).toBe(true);
    expect(isAllowedRemoteImageUrl('https://images.unsplash.com/x')).toBe(true);
    expect(isAllowedRemoteImageUrl('https://images.pexels.com/x')).toBe(true);
    expect(isAllowedRemoteImageUrl('https://images.pixabay.com/x')).toBe(true);
    expect(isAllowedRemoteImageUrl('https://img.rocket.new/x')).toBe(true);
    expect(isAllowedRemoteImageUrl('http://res.cloudinary.com/demo/x.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('https://evil.test/x.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('not a url')).toBe(false);
    expect(isAllowedRemoteImageUrl('')).toBe(false);
  });

  it('still refuses loopback that is not the configured origin', () => {
    expect(isAllowedRemoteImageUrl('https://localhost/x.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('http://localhost:3000/x.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('http://127.0.0.1:54321/storage/v1/object/public/other/a.png')).toBe(false);
  });
});
