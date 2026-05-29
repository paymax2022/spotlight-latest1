import { NextResponse, type NextRequest } from 'next/server';

const FORM_ROUTE_PATTERNS: RegExp[] = [
  /^\/apply(?:\/|$)/,
  /^\/open-mic\/[^/]+\/apply(?:\/|$)/,
  /^\/open-mic\/[^/]+\/enter(?:\/|$)/,
  /^\/stem\/contests(?:\/|$)/,
];

function hasSupabaseSessionCookie(request: NextRequest): boolean {
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith('sb-') && cookie.name.includes('-auth-token')) {
      return true;
    }
  }
  return false;
}

function isFormRoute(pathname: string): boolean {
  return FORM_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!isFormRoute(pathname)) {
    return NextResponse.next();
  }
  if (hasSupabaseSessionCookie(request)) {
    return NextResponse.next();
  }

  const redirectUrl = request.nextUrl.clone();
  const nextPath = `${pathname}${search || ''}`;
  redirectUrl.pathname = '/open-mic/login';
  redirectUrl.search = `?next=${encodeURIComponent(nextPath)}`;
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: [
    '/apply/:path*',
    '/open-mic/:slug/apply',
    '/open-mic/:slug/enter',
    '/stem/contests/:path*',
  ],
};
