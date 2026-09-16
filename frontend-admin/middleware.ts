import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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

export async function isSessionValid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  // Decode + expiry check (always).
  let payload: { exp?: number };
  try {
    payload = JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return false;
  }
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return false;

  // Signature check — REQUIRED (AUTH-002). A missing secret used to fall back
  // to decode+expiry only, which accepts any structurally-valid, unexpired
  // JWT regardless of who signed it (or whether anyone did). That is a fail
  // OPEN on a forged/tampered cookie, so it now fails CLOSED instead: no
  // secret configured means no request is admitted while enforcement is on.
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return false;
  try {
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
