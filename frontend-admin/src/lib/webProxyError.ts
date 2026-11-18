/**
 * Turns a thrown upstream fetch into a sentence an operator can act on.
 *
 * The proxy used to answer every transport failure with "Upstream web app
 * unreachable.", which pushed people to restart the web app even when it was
 * running fine and merely slow. Each branch below says WHICH failure it is:
 * refused (nothing listening), reset (server went away mid-request), DNS (a bad
 * WEB_API_BASE_URL), or the AbortSignal.timeout deadline.
 */

type UpstreamFailureContext = {
  baseUrl: string;
  timeoutMs: number;
};

type MaybeError = {
  name?: string;
  message?: string;
  code?: string;
  cause?: unknown;
};

/** undici nests the socket failure one level under `cause` on a `fetch failed` TypeError. */
function chain(err: unknown): unknown[] {
  return [err, (err as MaybeError | null)?.cause];
}

function socketCode(err: unknown): string | undefined {
  for (const hop of chain(err)) {
    if (hop && typeof hop === 'object') {
      const code = (hop as MaybeError).code;
      if (typeof code === 'string' && code) return code;
    }
  }
  return undefined;
}

function detail(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  const cause = (err as MaybeError | null)?.cause;
  if (cause instanceof Error && cause.message) return cause.message;
  return 'unknown error';
}

export function describeUpstreamFailure(
  err: unknown,
  { baseUrl, timeoutMs }: UpstreamFailureContext,
): string {
  const code = socketCode(err);
  if (code === 'ECONNREFUSED') {
    return `Upstream web app refused the connection (ECONNREFUSED) — nothing is listening at ${baseUrl}. Start frontend-web and retry.`;
  }
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ERR_STREAM_PREMATURE_CLOSE') {
    return `Upstream web app closed the connection mid-request (${code}) at ${baseUrl} — its server restarted while answering. Retry.`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EHOSTUNREACH') {
    return `${baseUrl} is not reachable (${code}) — check WEB_API_BASE_URL in frontend-admin/.env.local.`;
  }

  // AbortSignal.timeout rejects as TimeoutError and a hand-aborted signal as
  // AbortError, either at the top or nested under undici's "fetch failed" — so
  // scan every hop instead of taking the first name, which is just "TypeError".
  const names = chain(err).map((hop) => (hop as MaybeError)?.name);
  if (names.includes('TimeoutError') || names.includes('AbortError')) {
    return `Upstream web app did not answer ${baseUrl} within ${timeoutMs}ms (WEB_PROXY_TIMEOUT_MS) — a dev server cold-compiling a route can pass this once. Retry, or raise the value.`;
  }

  if (code) {
    return `Upstream web app failed at ${baseUrl} (${code}): ${detail(err)}.`;
  }
  return `Upstream web app unreachable at ${baseUrl}: ${detail(err)}.`;
}
