import { NextResponse } from 'next/server';
import { extractSessionToken, isSessionValid, resolveEnforce } from '../../../../middleware';
import { describeUpstreamFailure } from '@/lib/webProxyError';

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

/**
 * A big upload gets a longer deadline than a JSON relay.
 *
 * `AbortSignal.timeout` covers the entire exchange, including pushing the body
 * out to frontend-web. 20 s is right for the list/read calls this proxy mostly
 * carries and wrong for the 50 MiB contest-template images it also carries: on a
 * real connection the console aborts first, reports "the web app did not answer",
 * and the image lands anyway — the worst kind of failure, because retrying
 * stacks a second copy in the bucket.
 *
 * Measured 2026-11-25 against a dev server: the transfer itself is not the
 * problem locally (a 20 MiB multipart relayed intact in 0.23 s), so this is
 * about the remote hop, not about localhost.
 */
const LARGE_UPLOAD_BYTES = 4 * 1024 * 1024;
const LARGE_UPLOAD_TIMEOUT_MS = Number(process.env.WEB_PROXY_UPLOAD_TIMEOUT_MS ?? 180_000);

/**
 * Body size: this proxy is deliberately NOT capped the way frontend-web's is.
 *
 * Next forks the request body for the proxy layer and cuts that fork at
 * `experimental.proxyClientMaxBodySize` (10 MiB default) — which is why
 * frontend-web needed `upload-limits.config.mjs` at all
 * (frontend-web/upload-limits.config.mjs). Here it does not apply: the matcher in
 * middleware.ts is `['/admin/:path*']`, so `/api/web-proxy` runs no proxy layer
 * and nothing forks the body. Verified, not assumed — a 20 MiB multipart POST
 * through this route on the unmodified config arrived at the upstream with
 * `declared == received == 20 971 726` and no buffering warning in the dev log.
 * If the matcher ever grows to cover `/api/*`, this route needs the same
 * `proxyClientMaxBodySize` treatment frontend-web has, or every large upload
 * starts arriving cut in half.
 */

/**
 * The four headers that describe the bytes being relayed, and nothing else.
 *
 * The body below is forwarded verbatim, so the headers a client needs to read
 * that body correctly have to travel with it: `Content-Type` says what the
 * bytes are, `Content-Range` is what makes a 206 legal (a 206 without it is a
 * protocol error the media element rejects outright), `Accept-Ranges` tells the
 * player it may seek, and `Content-Disposition` is the difference between the
 * console's Download button saving a beat and opening one.
 *
 * Deliberately an allowlist rather than a copy of everything upstream returned:
 * this proxy talks to frontend-web with the admin session bearer attached, and
 * relaying a `set-cookie` — or any other header the upstream sets for its own
 * origin — back through a console response would put a second credential in the
 * browser that nothing here decided to issue.
 */
function passthroughHeaders(upstream: Headers): Record<string, string> {
  const out: Record<string, string> = {
    'Content-Type': upstream.get('content-type') || 'application/json',
  };
  for (const name of ['Content-Range', 'Accept-Ranges', 'Content-Disposition'] as const) {
    const value = upstream.get(name.toLowerCase());
    if (value) out[name] = value;
  }
  return out;
}

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
  // A media element does not fetch a file, it fetches a range of one, and the
  // Open Mic review panel points its <audio src> at this proxy. Without the
  // caller's Range the web app answers a full 200 body every time: the song
  // plays from the top, scrubbing re-downloads it, and the partial headers
  // below would have nothing to describe.
  const range = request.headers.get('range');
  if (range) headers['Range'] = range;

  const method = request.method;
  // corrupts any binary body — a multipart image upload arrives with its bytes
  // replaced by U+FFFD and the file lands unopenable. Every route proxied here
  // harmless now. An ArrayBuffer forwards JSON and multipart alike, verbatim,
  // and the Content-Type (including the multipart boundary) is already
  // forwarded above.
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

  // The deadline covers the whole exchange, so it has to be sized to the body:
  // an upload that outruns WEB_PROXY_TIMEOUT_MS mid-transfer is reported to the
  // admin as "the web app did not answer", after frontend-web has already stored
  // the file. Small JSON keeps the short deadline that catches a hung route.
  const timeoutMs =
    body && body.byteLength > LARGE_UPLOAD_BYTES ? LARGE_UPLOAD_TIMEOUT_MS : TIMEOUT_MS;

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    // BYTE-FOR-BYTE passthrough, mirroring the request body above. Reading the
    // response as text corrupted every binary payload exactly the way it
    // corrupted a multipart request: a contest banner served through this proxy
    // came back as replacement characters and the <img> silently refused to
    // decode. JSON is valid UTF-8, so every existing caller gets identical bytes.
    const buffer = await upstream.arrayBuffer();
    return new NextResponse(buffer, {
      status: upstream.status,
      headers: passthroughHeaders(upstream.headers),
    });
  } catch (err) {
    // Log the TARGET, never a header. An unbounded hang here would be invisible.
    console.error(`[web-proxy] ${method} /${path.join('/')} -> ${WEB_API_BASE_URL} failed:`,
      err instanceof Error ? err.message : err);
    return NextResponse.json({
      // This string is the only thing the operator sees, so it names the cause:
      // refused means nothing is listening, a missed deadline means it was slow.
      error: describeUpstreamFailure(err, { baseUrl: WEB_API_BASE_URL, timeoutMs }),
    }, { status: 502 });
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
