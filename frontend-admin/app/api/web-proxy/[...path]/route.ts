import { NextResponse } from 'next/server';
import { extractSessionToken, isSessionValid, resolveEnforce } from '../../../../middleware';

/**
 * Server-side proxy to the PUBLIC WEB APP: /api/web-proxy/<...> -> <WEB_API_BASE_URL>/<...>
 *
 * ADMIN CONSOLIDATION, SLICE 3 (path A). frontend-admin is the surviving admin
 * console. Several consoles still in frontend-web read its own TypeScript server
 * layer directly (openmic, registration, scoring, reality-show) and have NO Go
 * module behind them. Path A routes those modules here instead of inventing
 * three backend modules before a single page can move.
 *
 * Separate from /api/admin-proxy on purpose. That one targets the Go backend and
 * attaches ADMIN_API_KEY; this one targets frontend-web and must NOT send that
 * key. Two explicit routes beat one proxy with a path-matching table deciding
 * which upstream and which secret applies — a mis-sorted rule there would leak
 * the admin key to the wrong origin.
 *
 * Auth needs no bridge: frontend-admin holds a Supabase session.access_token and
 * frontend-web validates exactly that via supabase.auth.getUser. The token lives
 * in the HttpOnly session cookie and is attached as Bearer HERE, server-side —
 * browser code never reads it (CodeQL js/clear-text-storage-of-sensitive-data);
 * frontend-web still runs its own authorization.
 *
 * Like /api/admin-proxy this route runs the same session gate middleware.ts
 * uses (AUTH-010 pattern): it sits outside the '/admin/:path*' matcher, holds
 * a real credential (the session bearer), and honors the same
 * ADMIN_MIDDLEWARE_ENFORCE opt-out for local dev without SUPABASE_JWT_SECRET.
 */
export const dynamic = 'force-dynamic';

// No trailing /api/v1 — callers spell out the full path, matching admin-proxy.
// Unset it fails LOUDLY rather than silently targeting a plausible wrong port:
// ADMIN_API_BASE_URL defaulting to :8080 (a Docker container, not the Go backend)
// produced 404s that read as missing routes for far longer than they should have.
const WEB_API_BASE_URL = process.env.WEB_API_BASE_URL || '';
const TIMEOUT_MS = Number(process.env.WEB_PROXY_TIMEOUT_MS ?? 20_000);

async function forward(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (!WEB_API_BASE_URL) {
    return NextResponse.json(
      { error: 'WEB_API_BASE_URL is not set — the admin console cannot reach the web app. See frontend-admin/.env.example.' },
      { status: 500 },
    );
  }

  // The enforce opt-out exists for local dev only; in production it would let
  // any request through this proxy unauthenticated — fail loud instead.
  if (process.env.NODE_ENV === 'production' && !resolveEnforce(process.env.ADMIN_MIDDLEWARE_ENFORCE)) {
    return NextResponse.json(
      { error: 'ADMIN_MIDDLEWARE_ENFORCE must not be disabled in production.' },
      { status: 503 },
    );
  }

  // The HttpOnly session cookie holds the Supabase access token itself — the
  // same credential frontend-web validates. Attach it server-side; the token
  // must never be readable by browser JS.
  const sessionToken = extractSessionToken(request.headers.get('cookie'));

  if (resolveEnforce(process.env.ADMIN_MIDDLEWARE_ENFORCE)) {
    if (!(await isSessionValid(sessionToken))) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }
  }

  const { path } = await ctx.params;
  const search = new URL(request.url).search;
  const target = `${WEB_API_BASE_URL}/${path.join('/')}${search}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  // Forward the caller's identity. Deliberately no service key of any kind:
  // frontend-web authorizes the real user, so a stolen console session cannot
  // become blanket service-role access. The verified cookie token wins over a
  // client-supplied Authorization header, as in /api/admin-proxy.
  const auth = sessionToken
    ? `Bearer ${sessionToken}`
    : request.headers.get('authorization');
  if (auth) headers['Authorization'] = auth;
  const contentType = request.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;
  // Not a secret — a per-request dedup key the CALLER generates and frontend-web
  // requires for money mutations (see app/api/admin/payments-finance/wallet/
  // adjust/route.ts). Every route proxied here until payments-finance only
  // it, any money-mutation route reached through this proxy 400s unconditionally.
  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const method = request.method;
  // corrupts any binary body — a multipart image upload arrives with its bytes
  // replaced by U+FFFD and the file lands unopenable. Every route proxied here
  // harmless now. An ArrayBuffer forwards JSON and multipart alike, verbatim,
  // and the Content-Type (including the multipart boundary) is already
  // forwarded above.
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
    });
  } catch (err) {
    // Log the TARGET, never a header. An unbounded hang here would be invisible.
    console.error(`[web-proxy] ${method} /${path.join('/')} -> ${WEB_API_BASE_URL} failed:`,
      err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Upstream web app unreachable.' }, { status: 502 });
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
