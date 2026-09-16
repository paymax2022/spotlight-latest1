/**
 * Decision logic for the /admin/* server-side gate (AUTH-001 / AUTH-002).
 *
 * Runs in the 'node' environment (not the project default 'jsdom') because
 * the middleware's signature check needs a real Web Crypto `crypto.subtle`,
 * which jsdom does not reliably provide.
 *
 * @vitest-environment node
 */
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublicAdminPath, isSessionValid, resolveEnforce } from './middleware';

function base64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Builds a real HS256 JWT, signed with `secret` (or garbage bytes if omitted). */
function makeToken(payload: Record<string, unknown>, secret: string | undefined): string {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sig = secret
    ? base64Url(createHmac('sha256', secret).update(signingInput).digest())
    : base64Url('not-a-real-signature');
  return `${signingInput}.${sig}`;
}

const REAL_SECRET = 'test-only-hs256-secret-does-not-need-to-be-long';
const notExpired = { sub: 'admin-1', exp: Math.floor(Date.now() / 1000) + 3600 };
const expired = { sub: 'admin-1', exp: Math.floor(Date.now() / 1000) - 3600 };

describe('resolveEnforce (AUTH-001)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('enforces when the env var is unset — the state of every in-repo deploy config', () => {
    expect(resolveEnforce(undefined)).toBe(true);
  });

  it('enforces on an empty string too', () => {
    expect(resolveEnforce('')).toBe(true);
  });

  it('enforces on the old opt-in value, for anyone who left it at "1"', () => {
    expect(resolveEnforce('1')).toBe(true);
  });

  it('only "0" is a valid, deliberate opt-out', () => {
    expect(resolveEnforce('0')).toBe(false);
  });

  it('treats any other value as enforced, not disabled (no silent typo bypass)', () => {
    expect(resolveEnforce('false')).toBe(true);
    expect(resolveEnforce('off')).toBe(true);
    expect(resolveEnforce('no')).toBe(true);
  });
});

describe('isPublicAdminPath', () => {
  it('allows the login route and its subpaths, and the unauthorized page', () => {
    expect(isPublicAdminPath('/admin/login')).toBe(true);
    expect(isPublicAdminPath('/admin/login/callback')).toBe(true);
    expect(isPublicAdminPath('/admin/unauthorized')).toBe(true);
  });

  it('gates everything else', () => {
    expect(isPublicAdminPath('/admin')).toBe(false);
    expect(isPublicAdminPath('/admin/users')).toBe(false);
  });
});

describe('isSessionValid (AUTH-002)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects a missing token', async () => {
    await expect(isSessionValid(undefined)).resolves.toBe(false);
  });

  it('rejects a malformed token (wrong number of segments)', async () => {
    await expect(isSessionValid('not.a.jwt.at.all')).resolves.toBe(false);
  });

  it('rejects an expired token even with the right secret configured', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', REAL_SECRET);
    const token = makeToken(expired, REAL_SECRET);
    await expect(isSessionValid(token)).resolves.toBe(false);
  });

  it('FAILS CLOSED when SUPABASE_JWT_SECRET is unset — pins the AUTH-002 fix', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', '');
    // A structurally valid, unexpired, but entirely unsigned/forged token —
    // exactly what the old "decode+expiry only" fallback used to accept.
    const forged = makeToken(notExpired, undefined);
    await expect(isSessionValid(forged)).resolves.toBe(false);
  });

  it('rejects a token signed with the wrong secret when one is configured', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', REAL_SECRET);
    const token = makeToken(notExpired, 'a-different-secret-entirely');
    await expect(isSessionValid(token)).resolves.toBe(false);
  });

  it('accepts a valid, unexpired token correctly signed with the configured secret', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', REAL_SECRET);
    const token = makeToken(notExpired, REAL_SECRET);
    await expect(isSessionValid(token)).resolves.toBe(true);
  });
});
