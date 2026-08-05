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
// SHIPPED OFF by default. Set ADMIN_MIDDLEWARE_ENFORCE=1 only after verifying the
// cookie sign-in flow (see the Phase 0 runbook). Set SUPABASE_JWT_SECRET to enable
// real signature verification; without it the gate falls back to decode+expiry
// only (structure/expiry checked, signature NOT — weaker, but still blocks the
// no-session case). Never rely on this alone: authorization must be enforced by
// the backend on every admin endpoint.

const ENFORCE = process.env.ADMIN_MIDDLEWARE_ENFORCE === '1';
const SESSION_COOKIE = 'sb-admin-token';

// Paths under /admin reachable without a session (login + terminal states).
function isPublicAdminPath(pathname: string): boolean {
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

async function isSessionValid(token: string | undefined): Promise<boolean> {
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

  // Signature check (only when the secret is configured — Supabase signs HS256).
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return true; // decode+expiry only — set SUPABASE_JWT_SECRET to harden.
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
