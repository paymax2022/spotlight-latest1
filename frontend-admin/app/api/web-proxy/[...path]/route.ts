import { NextResponse } from 'next/server';

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
 * frontend-web validates exactly that via supabase.auth.getUser. The caller's
 * Bearer is forwarded unchanged; frontend-web still runs its own authorization.
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

  const { path } = await ctx.params;
  const search = new URL(request.url).search;
  const target = `${WEB_API_BASE_URL}/${path.join('/')}${search}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  // Forward the caller's identity. Deliberately no service key of any kind:
  // frontend-web authorizes the real user, so a stolen console session cannot
  // become blanket service-role access.
  const auth = request.headers.get('authorization');
  if (auth) headers['Authorization'] = auth;
  const contentType = request.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;
  // Not a secret — a per-request dedup key the CALLER generates and frontend-web
  // requires for money mutations (see app/api/admin/payments-finance/wallet/
  // adjust/route.ts). Every route proxied here until payments-finance only
  // needed Authorization + Content-Type, so this was never forwarded; without
  // it, any money-mutation route reached through this proxy 400s unconditionally.
  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const method = request.method;
  // Read as BYTES, not text. request.text() decodes as UTF-8, which silently
  // corrupts any binary body — a multipart image upload arrives with its bytes
  // replaced by U+FFFD and the file lands unopenable. Every route proxied here
  // was JSON until contest banner uploads, so text() was harmless; it is not
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
