import { NextResponse } from 'next/server';
import { extractSessionToken, isSessionValid, resolveEnforce } from '../../../../middleware';

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

async function forward(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  // The enforce opt-out exists for local dev only. In production it would
  // attach x-admin-api-key to ANY caller's request — fail loud instead.
  if (process.env.NODE_ENV === 'production' && !resolveEnforce(process.env.ADMIN_MIDDLEWARE_ENFORCE)) {
    return NextResponse.json(
      { success: false, error: 'ADMIN_MIDDLEWARE_ENFORCE must not be disabled in production.' },
      { status: 503 },
    );
  }

  const { path } = await ctx.params;

  // The HttpOnly session cookie holds the Supabase access token itself.
  // Browser code no longer sends Authorization (the token must never sit in
  // JS-readable storage — CodeQL js/clear-text-storage-of-sensitive-data), so
  // this route attaches the bearer server-side from the cookie instead.
  const sessionToken = extractSessionToken(request.headers.get('cookie'));

  if (resolveEnforce(process.env.ADMIN_MIDDLEWARE_ENFORCE)) {
    if (!(await isSessionValid(sessionToken))) {
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
  // The session cookie's verified token wins over any client-supplied
  // Authorization header: the cookie is the credential this app manages
  // (mirrored by features/auth/adminAuth on every refresh), while a raw header
  // could be anything the caller typed.
  const auth = sessionToken
    ? `Bearer ${sessionToken}`
    : request.headers.get('authorization');
  if (auth) headers['Authorization'] = auth;
  const cookie = request.headers.get('cookie');
  if (cookie) headers['Cookie'] = cookie;
  const contentType = request.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;

  // Idempotency-Key MUST survive the hop.
  // This proxy builds its outbound headers from an allowlist, and this one was
  // not on it — so every idempotent admin write was arriving at the backend
  // with no key at all, no matter how carefully the calling service generated
  // one. Handlers that merely *prefer* a key (offline-payment decision,
  // ErrIdempotencyRequired) rejected every request with a 400 that looked like
  // a client bug. Nothing in the browser could fix it: the header was dropped
  // here, one hop later.
  const idem = request.headers.get('idempotency-key');
  if (idem) headers['Idempotency-Key'] = idem;

  // AUTH-020: x-stem-role MUST survive the hop.
  // Same class of bug as Idempotency-Key above: this proxy's outbound headers
  // are an allowlist, and x-stem-role was missing from it. The STEM admin
  // console UI sends it on every /admin/stem*, /admin/schools*, /admin/stem-*
  // request, but it was silently dropped here — so the backend's
  // RequireStemRoles middleware always saw "missing stem role" (403) no matter
  // what the browser sent, once AUTH-018 made this proxy attach a real bearer
  // token and callers stopped 401ing before they even got this far.
  const stemRole = request.headers.get('x-stem-role');
  if (stemRole) headers['x-stem-role'] = stemRole;

  const method = request.method;
  // arrayBuffer, not text(): text() corrupts binary/multipart payloads (U+FFFD
  // on non-UTF8 bytes) — admin file uploads through this proxy arrived mangled.
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
