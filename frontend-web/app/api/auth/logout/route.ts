import { NextResponse } from 'next/server';
import { createServiceClient, extractBearerToken } from '../_supabase';
import { createClient as createCookieClient } from '@/lib/supabase/server';
import { addAuditEvent } from '@/src/server/admin/audit';
import { getRequestIp } from '@/src/lib/rate-limit/client-ip';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/logout
 *
 * E2E-SEC-055 / security.md F2: this used to accept anonymous POSTs, return
 * 200, and do nothing durable — and even when a Bearer token was supplied it
 * called `admin.auth.admin.signOut(user.id)`, but signOut's first argument is
 * the caller's JWT, not a user id, so GoTrue revoked nothing. Net effect:
 * "logout" was cosmetic — access and refresh tokens kept working afterwards.
 *
 * Now: an authenticated session is REQUIRED (401 for anon/invalid), GoTrue
 * revokes ALL of the user's sessions server-side (scope 'global' kills the
 * refresh-token grant too), the sb-*-auth-token cookies are expired on the
 * response, and an audit event is emitted.
 *
 * Known residual (documented in F2): access JWTs are stateless and remain
 * cryptographically valid until `exp` — there is no BFF-side primitive that
 * kills a stolen access token before expiry; full revocation needs the Go
 * backend's FEATURE_SESSION_HARDENING (sessions.ValidateAccess) gate.
 */

// @supabase/ssr session cookies are `sb-<ref>-auth-token`, chunked into
// `.0`, `.1`, … when the encoded value exceeds the client's chunk size.
const SESSION_COOKIE_RE = /^sb-.+-auth-token(\.\d+)?$/;

type ResolvedSession = { userId: string; email?: string; accessToken: string | null };

async function resolveSession(request: Request): Promise<ResolvedSession | null> {
  const admin = createServiceClient();

  // Bearer-token callers (mobile, API clients, web fetch wrappers).
  const bearer = extractBearerToken(request);
  if (bearer) {
    const { data: { user }, error } = await admin.auth.getUser(bearer);
    if (error || !user) return null;
    return { userId: user.id, email: user.email, accessToken: bearer };
  }

  // Cookie-based web session — the SSR client reads sb-*-auth-token cookies.
  try {
    const supabase = await createCookieClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return { userId: user.id, email: user.email, accessToken: session.access_token };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const session = await resolveSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Server-side revocation. signOut(jwt, scope) takes the caller's JWT:
    // 'global' revokes every session row for that user, so the refresh grant
    // stops minting new access tokens (the 'local' default would leave other
    // sessions alive — wrong for logout).
    if (session.accessToken) {
      const admin = createServiceClient();
      const { error } = await admin.auth.admin.signOut(session.accessToken, 'global');
      if (error) {
        console.error('[auth/logout] GoTrue signOut failed:',
          error.message ?? error);
        return NextResponse.json(
          { error: 'Logout could not be completed. Please try again.' },
          { status: 502 },
        );
      }
    }

    addAuditEvent({
      adminUser: session.userId,
      role: 'user',
      action: 'auth_logout',
      module: 'auth',
      entityType: 'auth_session',
      entityId: session.userId,
      reason: `User-initiated logout${session.email ? ` (${session.email})` : ''}`,
      ipAddress: getRequestIp(request) || undefined,
    });

    const response = NextResponse.json({ message: 'Logged out successfully' });

    // Expire every Supabase session cookie on the response — chunked and
    // unchunked — so the cookie-session path can't keep presenting a stale JWT.
    const cookieHeader = request.headers.get('cookie') ?? '';
    for (const part of cookieHeader.split(';')) {
      const name = part.split('=')[0]?.trim();
      if (name && SESSION_COOKIE_RE.test(name)) {
        response.cookies.set(name, '', { path: '/', maxAge: 0 });
      }
    }

    return response;
  } catch (err) {
    console.error('[auth/logout] unexpected error:',
      err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 });
  }
}
