/**
 * Telling "you are signed out" apart from "something broke".
 *
 * Screens render one generic failure for every error — "Couldn't load. Please
 * try again." — with a Retry button. When the cause is an expired session that
 * button cannot work: retrying sends the same dead token and fails identically,
 * so the user is offered the one action guaranteed not to help, and the real
 * remedy (sign in again) is never mentioned. Reported against /properties, where
 * GET /api/v1/estate/properties answers 401.
 */

/** True when this error is an HTTP 401 from our API client. */
export function isUnauthorized(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { response?: { status?: number }; status?: number }).response?.status
    ?? (error as { status?: number }).status;
  return status === 401;
}

/**
 * The path to come back to after signing in.
 *
 * Web only, deliberately. Expo Router exposes the current route to COMPONENTS
 * via usePathname(), but this is called from an axios interceptor and from error
 * branches where no hook is available, and reaching into the router's internal
 * store to get it anyway would break on any upgrade. On web the address bar is
 * the honest source; on native the caller passes its own path or accepts the
 * default landing screen.
 */
export function currentPathForReturn(): string | undefined {
  if (typeof window === 'undefined' || !window.location) return undefined;
  const { pathname, search } = window.location;
  // Rooted, and NOT protocol-relative. "//evil.example" starts with "/" but a
  // browser reads it as an absolute URL to another host, so a startsWith('/')
  // check alone is an open redirect.
  if (!pathname || !pathname.startsWith('/') || pathname.startsWith('//')) return undefined;
  // Never send the user back to a login screen after logging in.
  if (pathname.startsWith('/(auth)') || pathname.includes('/login')) return undefined;
  return `${pathname}${search ?? ''}`;
}
