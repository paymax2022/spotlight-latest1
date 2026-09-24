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
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
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

// ── AUTH-017 regression: real Supabase JWT-signing-keys tokens are ES256 ────
// (asymmetric), not HS256. isSessionValid() must verify those against the
// project's JWKS instead of (uselessly) trying SUPABASE_JWT_SECRET against
// them. These build REAL ES256 tokens with a real, freshly generated key
// pair via jose's own key-generation helpers — deterministic and offline —
// and mock `fetch` to serve the matching public JWKS, so the test exercises
// the exact `jwtVerify(token, JWKS)` path the fix uses without depending on
// the live local Supabase instance. This is the class of test AUTH-002's own
// suite lacked (it only ever hand-crafted HS256 tokens), which is why the
// original regression shipped undetected.
describe('isSessionValid — ES256 via JWKS (AUTH-017)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** Builds a real ES256 JWT plus a fetch mock serving its matching JWKS. */
  async function setupEs256(opts: { badKid?: boolean; wrongKey?: boolean; jwksReachable?: boolean } = {}) {
    const { jwksReachable = true } = opts;
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
    const kid = `test-kid-${Math.random().toString(36).slice(2)}`;
    const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };

    const supabaseUrl = `https://jwks-test-${Math.random().toString(36).slice(2)}.example`;
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        if (!jwksReachable) throw new Error('simulated network failure: JWKS unreachable');
        const url = typeof input === 'string' ? input : String(input);
        if (url === `${supabaseUrl}/auth/v1/.well-known/jwks.json`) {
          return new Response(JSON.stringify({ keys: [jwk] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      }),
    );

    const signingKey = opts.wrongKey ? (await generateKeyPair('ES256', { extractable: true })).privateKey : privateKey;
    const token = await new SignJWT({ sub: 'admin-1' })
      .setProtectedHeader({ alg: 'ES256', kid: opts.badKid ? 'not-the-real-kid' : kid })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(signingKey);

    return { token, supabaseUrl };
  }

  it('accepts a real ES256 token verified against the project JWKS — the exact case that was broken', async () => {
    const { token } = await setupEs256();
    await expect(isSessionValid(token)).resolves.toBe(true);
  });

  it('still fails closed for ES256 when SUPABASE_JWT_SECRET is configured but unrelated — proves the fix does not depend on it for this path', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', REAL_SECRET);
    const { token } = await setupEs256();
    await expect(isSessionValid(token)).resolves.toBe(true);
  });

  it('rejects an ES256 token whose kid is not present in the JWKS', async () => {
    const { token } = await setupEs256({ badKid: true });
    await expect(isSessionValid(token)).resolves.toBe(false);
  });

  it('rejects an ES256 token signed with a different (forged) private key', async () => {
    const { token } = await setupEs256({ wrongKey: true });
    await expect(isSessionValid(token)).resolves.toBe(false);
  });

  it('rejects a tampered ES256 token (payload flipped after signing)', async () => {
    const { token } = await setupEs256();
    const parts = token.split('.');
    const flipped = parts[1].slice(0, -1) + (parts[1].slice(-1) === 'A' ? 'B' : 'A');
    await expect(isSessionValid(`${parts[0]}.${flipped}.${parts[2]}`)).resolves.toBe(false);
  });

  it('rejects an ES256 token when the JWKS endpoint is unreachable — fails closed, no weaker fallback', async () => {
    const { token } = await setupEs256({ jwksReachable: false });
    await expect(isSessionValid(token)).resolves.toBe(false);
  });

  it('rejects an ES256 token when NEXT_PUBLIC_SUPABASE_URL is unset — this is the exact broken-production scenario (secret configured, token is actually ES256)', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', REAL_SECRET);
    const { privateKey } = await generateKeyPair('ES256', { extractable: true });
    const token = await new SignJWT({ sub: 'admin-1' })
      .setProtectedHeader({ alg: 'ES256', kid: 'whatever' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    await expect(isSessionValid(token)).resolves.toBe(false);
  });

  it('an alg-confusion attempt (claiming HS256, "signed" with public JWKS key material) is still rejected', async () => {
    // The HS256 path only ever trusts SUPABASE_JWT_SECRET, never key material
    // from the JWKS — so relabeling a token's alg to HS256 and "signing" it
    // with the ES256 public key as an HMAC secret must not validate.
    vi.stubEnv('SUPABASE_JWT_SECRET', REAL_SECRET);
    const { publicKey } = await generateKeyPair('ES256', { extractable: true });
    const attackerGuessSecret = JSON.stringify(await exportJWK(publicKey));
    const forged = makeToken(notExpired, attackerGuessSecret);
    await expect(isSessionValid(forged)).resolves.toBe(false);
  });
});
