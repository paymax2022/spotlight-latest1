/**
 * Where to send a browser after Paystack redirects it back.
 *
 * The payment callback used to answer every redirect with
 * `paymaxrn://registration/...`. A native app registers that scheme; a browser
 * does not, so paying on Expo web ended on a navigation the browser could not
 * follow. The charge was recorded correctly — the applicant just never got back
 * to the app.
 *
 * The callback cannot work out the browser's origin on its own: it is reached by
 * a top-level navigation from Paystack, so there is no Origin or Referer to
 * trust. The origin is therefore captured at INITIATE time (where the app is
 * talking to us directly and does send Origin) and carried through Paystack in
 * the callback URL, which Paystack echoes back verbatim.
 *
 * That makes the return target attacker-influenceable in principle, so it is
 * re-validated here on the way out. An unrecognised origin falls back to the
 * scheme rather than being honoured — this must never become an open redirect
 * that laundered a trusted domain into an arbitrary one.
 *
 * The allow rule mirrors middleware.ts's isAllowedOrigin (any localhost /
 * 127.0.0.1 port for dev, plus CORS_ALLOWED_ORIGINS for deployed web origins).
 * It is duplicated rather than imported because middleware.ts is a protected
 * legacy file that must be wrapped, not edited — if that rule changes, change it
 * here too.
 */

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isReturnableOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  // Reject anything that is not a bare scheme://host[:port] — a value carrying a
  // path, query or fragment is not an origin and has no business here.
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin !== origin) return false;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  if (LOOPBACK.test(origin)) return true;

  return (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .includes(origin);
}

/** The caller's origin, when it is one we would send a browser back to. */
export function resolveReturnOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  return isReturnableOrigin(origin) ? origin : null;
}

/**
 * Where the browser should land: the same screen the native deep link targets,
 * on the origin the payment was started from.
 */
export function buildWebReturnUrl(
  origin: string,
  applicationId: string,
  params: Record<string, string | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  return `${origin}/registration/${applicationId}/payment-processing?${qs.toString()}`;
}
