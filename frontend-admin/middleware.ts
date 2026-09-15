import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';

// ── Server-side authentication gate for /admin/* ────────────────────────────
// The admin session is mirrored into an HttpOnly cookie at sign-in (see
// app/api/admin/session + features/auth/adminAuth). This middleware runs on the
// edge BEFORE any admin page renders, so an unauthenticated request never
// receives admin HTML — closing the "every page ships to the client, guarded only
// in a useEffect that reads localStorage" hole (which was bypassable by editing
// localStorage). The client route guard remains for per-route AUTHORIZATION (UX);
// the Go backend remains the authority for per-endpoint RBAC.
//
// ENFORCED BY DEFAULT (AUTH-001). An unset/omitted ADMIN_MIDDLEWARE_ENFORCE —
// the state of every in-repo deploy config (render.yaml, app.yaml,
// railway.json, .env.production.example) — now enforces the gate, not the
// other way around. Opting OUT requires a deliberate ADMIN_MIDDLEWARE_ENFORCE=0
// (e.g. a local dev flow that hasn't configured SUPABASE_JWT_SECRET yet and
// wants the client-side AdminRouteGuard to keep working standalone). Never
// rely on this middleware alone: authorization must be enforced by the
// backend on every admin endpoint.
//
// SUPABASE_JWT_SECRET is REQUIRED for enforcement to actually admit anyone
// (AUTH-002). Without it, isSessionValid() fails closed — every /admin/*
// request is refused, including legitimate ones — rather than falling back
// to a decode+expiry-only check that accepts a structurally-valid but
// unsigned/forged cookie. A deploy that forgets this secret gets a visibly
// broken admin console, not a silently unlocked one.
//
// AUTH-017: SUPABASE_JWT_SECRET alone is not enough. It only verifies tokens
// signed the legacy way (HS256, a shared symmetric secret). A Supabase
// project on the newer JWT-signing-keys model signs its tokens asymmetrically
// (ES256/RS256, matched by `kid` against the project's own JWKS endpoint) —
// there is no shared secret to check those against, and an HS256-only
// verifier can NEVER validate them: wrong algorithm family entirely, not a
// misconfiguration. Confirmed live: with SUPABASE_JWT_SECRET configured and
// enforcement on, a real Supabase-issued ES256 session token failed the old
// HMAC check on every request, locking out every admin, including
// legitimate ones. isSessionValid() now branches on the token's OWN `alg`
// header: HS256 keeps using SUPABASE_JWT_SECRET (still required for that
// path — legacy projects aren't going away); anything asymmetric verifies
// against the project's JWKS (`${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
// via `jose`, which handles kid-based key selection and algorithm-aware
// verification. Either path missing its prerequisite (no secret, no/unreachable
// JWKS) fails closed exactly like before — never a silent downgrade.

/**
 * Resolves the enforcement flag from its raw env value. Enforced unless the
 * operator explicitly opts out with '0' — there is no opt-IN state, because
 * an opt-in default is exactly what left every in-repo deploy config (which
 * never set this var) serving /admin/* to anyone. Exported for direct unit
 * testing without constructing a NextRequest.
 */
export function resolveEnforce(raw: string | undefined): boolean {
  return raw !== '0';
}

const ENFORCE = resolveEnforce(process.env.ADMIN_MIDDLEWARE_ENFORCE);

// Exported so other server-side entry points that need the same session check
// (e.g. app/api/admin-proxy/[...path]/route.ts — AUTH-010) use the identical
// cookie name instead of re-deriving it.
export const SESSION_COOKIE = 'sb-admin-token';

// Paths under /admin reachable without a session (login + terminal states).
export function isPublicAdminPath(pathname: string): boolean {
  return (
    pathname === '/admin/login' ||
    pathname.startsWith('/admin/login/') ||
    pathname === '/admin/unauthorized'
  );
}

function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='));
}

// The asymmetric algorithms Supabase's JWT-signing-keys model can issue.
// Anything not in this list AND not 'HS256' is unsupported and fails closed —
// we never guess an algorithm, we only act on what the token's own header
// declares, and only for algorithms we know how to verify.
const JWKS_ALGORITHMS = ['ES256', 'ES384', 'ES512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512'];

// One JWKS fetcher per distinct URL, reused across requests so `jose` can
// apply its own cross-request cache/cooldown instead of re-fetching on every
// admin request. Keyed by URL (rather than a single module-level constant)
// so a changed NEXT_PUBLIC_SUPABASE_URL — or a distinct URL per test — never
// serves stale keys from a different project.
const jwksCache = new Map<string, JWTVerifyGetKey>();

function getJwks(jwksUrl: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    jwksCache.set(jwksUrl, jwks);
  }
  return jwks;
}

/** HS256 path (legacy shared-secret Supabase projects) — unchanged from AUTH-002. */
async function verifyHs256(token: string, parts: string[], secret: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const sigBytes = Uint8Array.from(base64UrlDecode(parts[2]), (c) => c.charCodeAt(0));
  return await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(`${parts[0]}.${parts[1]}`));
}

/**
 * Asymmetric path (JWT-signing-keys / JWKS Supabase projects) — AUTH-017.
 * `jwtVerify` fetches the project's JWKS, picks the key matching the
 * token's `kid`, and verifies the signature for exactly the algorithm
 * passed in — never falls back to a weaker check on its own.
 */
async function verifyAsymmetric(token: string, alg: string): Promise<boolean> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  const jwksUrl = `${base.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`;
  const jwks = getJwks(jwksUrl);
  await jwtVerify(token, jwks, { algorithms: [alg] });
  return true;
}

export async function isSessionValid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  // Decode header + payload, and check expiry (always).
  let header: { alg?: string };
  let payload: { exp?: number };
  try {
    header = JSON.parse(base64UrlDecode(parts[0]));
    payload = JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return false;
  }
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return false;

  // Signature check — REQUIRED (AUTH-002), and now algorithm-aware (AUTH-017).
  // A missing secret / unreachable JWKS used to (HS256) or would (asymmetric)
  // fall back to a weaker or wrong check — both fail CLOSED instead: no
  // request is admitted while enforcement is on unless its OWN algorithm's
  // verification prerequisite is actually satisfied and the signature checks
  // out against it.
  try {
    if (header.alg === 'HS256') {
      const secret = process.env.SUPABASE_JWT_SECRET;
      if (!secret) return false;
      return await verifyHs256(token, parts, secret);
    }
    if (header.alg && JWKS_ALGORITHMS.includes(header.alg)) {
      return await verifyAsymmetric(token, header.alg);
    }
    // Unknown/unsupported alg (including 'none') — never admitted.
    return false;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  if (!ENFORCE) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isPublicAdminPath(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await isSessionValid(token)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/admin/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Only run on admin routes. The session route (/api/admin/session) and static
  // assets are intentionally excluded so the sign-in flow stays reachable.
  matcher: ['/admin/:path*'],
};
