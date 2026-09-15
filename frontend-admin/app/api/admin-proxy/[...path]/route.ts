import { NextResponse } from 'next/server';
import { isSessionValid, resolveEnforce, SESSION_COOKIE } from '../../../../middleware';

/**
 * Server-side admin proxy: /api/admin-proxy/<...> -> <ADMIN_API_BASE_URL>/<...>,
 * attaching x-admin-api-key here rather than in the browser.
 *
 * WHY THIS EXISTS: the console used to read NEXT_PUBLIC_ADMIN_API_KEY and send the
 * header itself. NEXT_PUBLIC_* is inlined into the client bundle, so the admin key
 * was readable by anyone who loaded the admin site - it was never a secret, and
 * rotating it only changed which value was public.
 *
 * ADMIN_API_KEY here has NO NEXT_PUBLIC_ prefix, so Next will not inline it, and it
 * is read at RUNTIME so rotating means a restart rather than a rebuild.
 *
 * AUTH-010: this is the admin console's REAL data path, and unlike every page
 * under /admin/*, it is NOT covered by middleware.ts (matcher is
 * '/admin/:path*'; this route lives at '/api/admin-proxy/*'). It previously
 * performed no session check of its own and forwarded ANY caller's request —
 * while still unconditionally attaching x-admin-api-key when configured. That
 * made this proxy a confused deputy: it holds a real secret that alone
 * satisfies the Go backend's RequireAdmin gate, and handed it to whoever
 * asked, anonymous or not, in production, with the key correctly configured.
 * This now runs the identical session check middleware.ts uses for page
 * requests (same cookie, same verified-JWT logic, imported rather than
 * reimplemented) before any request is forwarded — so the admin key is never
 * the SOLE authority here either. It honors the same ADMIN_MIDDLEWARE_ENFORCE
 * opt-out as middleware.ts, for the same reason: a local dev flow without
 * SUPABASE_JWT_SECRET configured yet needs to keep working standalone.
 */
export const dynamic = 'force-dynamic';

// The backend ROOT — no /api/v1 suffix. Callers spell out the full backend path
// (/api/finance/..., /api/crowdfunding/..., /api/v1/admin/...), because the backend
// mounts modules at several roots and no single prefix covers them all. A base that
// ended in /api/v1 silently 404'd every module not mounted under it.
const ADMIN_API_BASE_URL = process.env.ADMIN_API_BASE_URL || 'http://localhost:8080';
const TIMEOUT_MS = Number(process.env.ADMIN_PROXY_TIMEOUT_MS ?? 20_000);

/**
 * Pulls the admin session token out of a raw Cookie header. A route handler
 * here receives a plain Request (not NextRequest), so the req.cookies helper
 * isn't available — and keeping this as a standalone pure function makes it
 * unit-testable without constructing a Request at all.
 */
export function extractSessionToken(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return part.slice(idx + 1).trim();
    }
  }
  return undefined;
}

async function forward(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;

  if (resolveEnforce(process.env.ADMIN_MIDDLEWARE_ENFORCE)) {
    const token = extractSessionToken(request.headers.get('cookie'));
    if (!(await isSessionValid(token))) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated.' },
        { status: 401 },
      );
    }
  }

  const search = new URL(request.url).search;
  const target = `${ADMIN_API_BASE_URL}/${path.join('/')}${search}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = process.env.ADMIN_API_KEY || '';
  if (key) headers['x-admin-api-key'] = key;

  // Forward the caller's identity so the backend still does its own authz - the
  // admin key is a gate in front of these routes, never a substitute for it.
  const auth = request.headers.get('authorization');
  if (auth) headers['Authorization'] = auth;
  const cookie = request.headers.get('cookie');
  if (cookie) headers['Cookie'] = cookie;
  const contentType = request.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;

  // Idempotency-Key MUST survive the hop.
  //
  // This proxy builds its outbound headers from an allowlist, and this one was
  // not on it — so every idempotent admin write was arriving at the backend
  // with no key at all, no matter how carefully the calling service generated
  // one. Handlers that merely *prefer* a key (offline-payment decision,
  // application decision) silently lost their replay protection; handlers that
  // *require* one (the association dues-tier create/update, which return
  // ErrIdempotencyRequired) rejected every request with a 400 that looked like
  // a client bug. Nothing in the browser could fix it: the header was dropped
  // here, one hop later.
  const idem = request.headers.get('idempotency-key');
  if (idem) headers['Idempotency-Key'] = idem;

  const method = request.method;
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.text();

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
    // Log the TARGET, never the key. An unbounded hang here would be invisible.
    console.error(`[admin-proxy] ${method} /${path.join('/')} -> ${ADMIN_API_BASE_URL} failed:`,
      err instanceof Error ? err.message : err);
    return NextResponse.json(
      { success: false, error: 'The admin API could not be reached.' },
      { status: 504 },
    );
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
