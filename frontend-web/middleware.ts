// Next.js only loads middleware from the directory that holds the routes it is
// serving. This project has BOTH `app/` (70 routes, at the project root) and
// `src/app/`; when both exist Next uses the root `app/` and ignores `src/app`.
//
// The session/CORS middleware lives in `src/middleware.ts` — where CLAUDE.md
// documents it and where every import path expects it — and this file delegates
// to it. On top of that delegation this wrapper adds two edge controls that
// cannot live in the protected legacy route files (see
// .claude/hooks/protect-legacy.sh):
//
//   1. Client-IP normalization. ~45 API route handlers — including the
//      protected /api/votes/* files that feed duplicate_ip fraud scoring and
//      the IP-scoped free-vote allowance — read `x-forwarded-for` verbatim
//      (`split(',')[0]`), i.e. the LEFTMOST entry, which a caller can claim
//      arbitrarily. Rewriting the header here to the trust-aware
//      `getRequestIp()` resolution gives every downstream reader the same
//      un-spoofed value without touching a single protected file.
//
//   2. Rate limits on the legacy paid-vote endpoints. `/api/votes/paid/initiate`
//      calls Paystack and inserts `vote_transactions` rows, and
//      `/api/votes/paid/verify` is the reference-enumeration surface; both were
//      unthrottled and are un-editable. The v2 twins carry 10/min and 30/min
//      respectively (PR #430) — the same per-IP budgets are applied here, with
//      the SAME bucket keys so v1+v2 share one allowance rather than doubling it.

import { type NextRequest, NextResponse } from 'next/server';
import { middleware as impl } from './src/middleware';
import { checkRateLimit } from './src/lib/voting/rate-limit';
import { getRequestIp } from './src/lib/rate-limit/client-ip';

const WINDOW_MS = 60_000;

// path → [bucket key prefix, per-minute limit]. Prefixes intentionally match
// the v2 routes' so both versions draw from one bucket.
const LEGACY_PAID_VOTE_LIMITS: Array<{ pattern: RegExp; bucket: string; limit: number }> = [
  { pattern: /^\/api\/votes\/paid\/initiate\/?$/, bucket: 'vote:paid:initiate', limit: 10 },
  { pattern: /^\/api\/votes\/paid\/verify\/?$/, bucket: 'vote:paid:verify', limit: 30 },
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  let clientIp: string | undefined;
  if (pathname.startsWith('/api/')) {
    clientIp = getRequestIp(request);

    if (request.method === 'POST') {
      const rule = LEGACY_PAID_VOTE_LIMITS.find((r) => r.pattern.test(pathname));
      if (rule) {
        const rl = checkRateLimit(`${rule.bucket}:${clientIp}`, rule.limit, WINDOW_MS);
        if (!rl.allowed) {
          return NextResponse.json(
            { error: 'Too many requests. Please slow down.' },
            { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetInMs / 1000)) } },
          );
        }
      }
    }

    // Rewrite before delegating: the inner middleware forwards `request` to
    // NextResponse.next(), which re-emits these mutated headers downstream.
    request.headers.set('x-forwarded-for', clientIp);
    request.headers.set('x-real-ip', clientIp);
  }

  const response = await impl(request);

  if (clientIp !== undefined) {
    // Belt and suspenders: also pin the override on the response contract
    // (x-middleware-request-*) so the rewrite holds even if the inner
    // middleware's forwarding mechanics change under us.
    const prior = response.headers.get('x-middleware-override-headers');
    const names = new Set((prior ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    names.add('x-forwarded-for');
    names.add('x-real-ip');
    response.headers.set('x-middleware-override-headers', [...names].join(','));
    response.headers.set('x-middleware-request-x-forwarded-for', clientIp);
    response.headers.set('x-middleware-request-x-real-ip', clientIp);
  }

  return response;
}

// `config` CANNOT be re-exported alongside the implementation. Next parses the
// matcher at compile time, before any module is evaluated, so it has to read an
// object literal in this file. Under Next 15's webpack builder a re-export
// happened to survive; Next 16 builds with Turbopack, which rejects it
// outright:
//
//   Error: Next.js can't recognize the exported `config` field in route.
//          It mustn't be reexported.
//
// So this literal is the ONE definition of the matcher — `src/middleware.ts`
// deliberately does not export a `config` of its own, because two copies would
// drift and the dead one would look authoritative. Edit the matcher here.
export const config = {
  matcher: [
    /*
     * Page routes: everything except Next.js internals, static files, and API.
     */
    '/((?!_next/static|_next/image|_next/hmr|_next/webpack-hmr|_next/turbopack-hmr|favicon|assets|icons|images|api/).*)',
    /*
     * API routes: matched so the CORS layer can answer preflight + attach
     * Access-Control headers (the handler short-circuits before Supabase auth).
     */
    '/api/:path*',
  ],
};
