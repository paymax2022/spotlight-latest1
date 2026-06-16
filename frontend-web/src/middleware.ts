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

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

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
     * Match all request paths except Next.js internals, static files, and
     * API routes (which handle their own auth).
     */
    '/((?!_next/static|_next/image|favicon|assets|icons|images|api/).*)',
  ],
};
