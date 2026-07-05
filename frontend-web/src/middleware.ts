import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

// Routes that require an authenticated Supabase session.
const PROTECTED_PATTERNS: RegExp[] = [
  /^\/admin(?:\/|$)/,
  /^\/apply(?:\/|$)/,
  /^\/film-academy(?:\/|$)/,
  /^\/open-mic\/[^/]+\/apply(?:\/|$)/,
  /^\/open-mic\/[^/]+\/enter(?:\/|$)/,
  /^\/stem\/contests(?:\/|$)/,
  /^\/contestant(?:\/|$)/,
  /^\/user-dashboard(?:\/|$)/,
  /^\/profile(?:\/|$)/,
  /^\/my-applications(?:\/|$)/,
];

// These paths are always public even if they match a protected pattern above.
const PUBLIC_EXCEPTIONS: RegExp[] = [
  /^\/admin\/login(?:\/|$)/,
];

// Login page to redirect to (universal — not service-specific).
const LOGIN_PATH = '/login';
const ADMIN_LOGIN_PATH = '/admin/login';

function isProtected(pathname: string): boolean {
  if (PUBLIC_EXCEPTIONS.some((p) => p.test(pathname))) return false;
  return PROTECTED_PATTERNS.some((p) => p.test(pathname));
}

function loginPathFor(pathname: string): string {
  return /^\/admin(?:\/|$)/.test(pathname) ? ADMIN_LOGIN_PATH : LOGIN_PATH;
}

// ── CORS for /api/* ──────────────────────────────────────────────────────────
// The mobile app runs on its own origin (Expo web :8081, devices, prod web) and
// calls these API routes cross-origin, so we must answer the preflight and echo
// an allowed Origin. We reflect the request Origin only if it's allow-listed:
// any localhost/127.0.0.1 port (dev) plus anything in CORS_ALLOWED_ORIGINS
// (comma-separated, for staging/prod web origins). Never a bare '*' with creds.
function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  const allow = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return allow.includes(origin);
}

function corsHeaders(origin: string): Headers {
  const h = new Headers();
  if (isAllowedOrigin(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Vary', 'Origin');
    h.set('Access-Control-Allow-Credentials', 'true');
    h.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, X-Request-Id');
    h.set('Access-Control-Max-Age', '86400');
  }
  return h;
}

function handleApiCors(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin') ?? '';
  const headers = corsHeaders(origin);
  // Preflight: respond 204 immediately with the CORS headers.
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers });
  }
  // Actual request: let it through to the route handler, attaching CORS headers.
  const res = NextResponse.next({ request });
  headers.forEach((value, key) => res.headers.set(key, value));
  return res;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // API routes handle their own auth — here we only attach CORS (and answer
  // preflight) so cross-origin clients (mobile/web) can call them.
  if (pathname.startsWith('/api/')) {
    return handleApiCors(request);
  }

  // Always refresh the Supabase session cookie so it doesn't expire.
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    // Supabase not configured — let all requests through (dev/test mode).
    return response;
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() re-validates the JWT against Supabase; never trust only local cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtected(pathname) && !user) {
    const redirectUrl = request.nextUrl.clone();
    const next = `${pathname}${search || ''}`;
    redirectUrl.pathname = loginPathFor(pathname);
    redirectUrl.search = `?next=${encodeURIComponent(next)}`;
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Page routes: everything except Next.js internals, static files, and API.
     */
    '/((?!_next/static|_next/image|favicon|assets|icons|images|api/).*)',
    /*
     * API routes: matched so the CORS layer can answer preflight + attach
     * Access-Control headers (the handler short-circuits before Supabase auth).
     */
    '/api/:path*',
  ],
};
