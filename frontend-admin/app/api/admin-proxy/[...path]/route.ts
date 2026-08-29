import { NextResponse } from 'next/server';

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
 */
export const dynamic = 'force-dynamic';

// The backend ROOT — no /api/v1 suffix. Callers spell out the full backend path
// (/api/finance/..., /api/crowdfunding/..., /api/v1/admin/...), because the backend
// mounts modules at several roots and no single prefix covers them all. A base that
// ended in /api/v1 silently 404'd every module not mounted under it.
const ADMIN_API_BASE_URL = process.env.ADMIN_API_BASE_URL || 'http://localhost:8080';
const TIMEOUT_MS = Number(process.env.ADMIN_PROXY_TIMEOUT_MS ?? 20_000);

async function forward(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
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
