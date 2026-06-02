import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

// Routes that require an authenticated Supabase session.
const PROTECTED_PATTERNS: RegExp[] = [
  /^\/apply(?:\/|$)/,
  /^\/open-mic\/[^/]+\/apply(?:\/|$)/,
  /^\/open-mic\/[^/]+\/enter(?:\/|$)/,
  /^\/stem\/contests(?:\/|$)/,
  /^\/contestant(?:\/|$)/,
  /^\/user-dashboard(?:\/|$)/,
  /^\/profile(?:\/|$)/,
  /^\/my-applications(?:\/|$)/,
];

// Login page to redirect to (universal — not open-mic-specific).
const LOGIN_PATH = '/login';

function isProtected(pathname: string): boolean {
  return PROTECTED_PATTERNS.some((p) => p.test(pathname));
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
    redirectUrl.pathname = LOGIN_PATH;
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
