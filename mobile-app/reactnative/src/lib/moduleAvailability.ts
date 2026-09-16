// ── "This module is not available here" — telling that apart from a real fault ─
//
// Modules on this platform are feature-flagged server-side, and the flag gates
// ROUTE REGISTRATION: with FEATURE_X_ENABLED unset, every path under that module
// 404s. Nothing distinguishes that from a route that was never written, or one
// the client is calling at the wrong path — a mistake this codebase has produced
// repeatedly.
//
// So a 404 gets two properties here, and only two:
//
//   1. It is TERMINAL. Retrying cannot make a disabled module appear, and
//      React Query's default retry + refetch-on-focus turns one absent module
//      into a request on every window focus, from whatever screen the user is
//      on — a cached property query re-firing on an unrelated page.
//
//   2. It is still an ERROR. It is deliberately not swallowed into empty data:
//      a genuinely missing route is a defect worth seeing, and hiding it would
//      make the next path mismatch invisible.
//
// Anything that is not a 404 keeps its normal retry: a 500 or a dropped
// connection is transient, and a 401 belongs to the API client's interceptor.

/** HTTP status off an axios-style rejection, if it carries one. */
function statusOf(error: unknown): number | undefined {
  const status = (error as { response?: { status?: unknown } } | null | undefined)?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * True when a failure means "this module is not registered in this environment"
 * rather than something a retry could fix.
 */
export function isModuleAbsent(error: unknown): boolean {
  return statusOf(error) === 404;
}

/**
 * Query options for an endpoint that belongs to a feature-flagged module.
 *
 * Spread into useQuery: `...moduleQueryOptions()`. Keeps the default retry for
 * real failures and makes only absence terminal.
 */
export function moduleQueryOptions(retries = 2) {
  return {
    retry: (failureCount: number, error: unknown) =>
      isModuleAbsent(error) ? false : failureCount < retries,
    refetchOnWindowFocus: (query: { state: { error: unknown } }) => !isModuleAbsent(query.state.error),
  };
}
