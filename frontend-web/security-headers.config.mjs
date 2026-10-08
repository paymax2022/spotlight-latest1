/**
 * Baseline hardening headers (E2E-SEC-057, security.md F5), emitted by
 * next.config.mjs' headers() on EVERY response — route-handler output
 * included, so /api/* is covered.
 *
 * Extracted into a standalone module (same pattern as image-hosts.config.mjs)
 * so the policy is unit-testable: next.config.mjs is wrapped in
 * withSentryConfig and cannot be imported without dragging the Sentry build
 * toolchain into the test process.
 *
 * Content-Security-Policy is deliberately shipped REPORT-ONLY: this app loads
 * third-party origins that differ between environments (Supabase URL is
 * env-driven — 127.0.0.1:54321 locally, *.supabase.co in prod), Paystack inline
 * checkout injects scripts + iframes (js.paystack.co / checkout.paystack.com),
 * uploads PUT to *.r2.cloudflarestorage.com, photos flow through Cloudinary,
 * and Sentry posts to *.ingest.sentry.io. An enforcing CSP can't be proven
 * safe from code inspection alone, so we emit the intended policy in
 * Report-Only mode; harvest violations in the wild, then promote the header
 * name to Content-Security-Policy when the report stream is clean.
 *
 * X-Frame-Options is SAMEORIGIN, not DENY: nothing in this app renders an
 * iframe today (verified — no <iframe>/<frame> usage), but SAMEORIGIN still
 * blocks third-party clickjacking while leaving same-origin embedding working.
 * frame-ancestors in the CSP carries the same policy for modern browsers.
 */

// Loopback origins exist so local dev (Supabase :54321, the Go backend, Expo)
// can connect. They are DEV-ONLY — a production browser has no business
// reaching localhost from this origin, and shipping them in the prod policy
// both leaks the dev topology and widens the attack surface for local-network
// exploitation if the policy is ever enforced.
const DEV_ONLY_CONNECT_ORIGINS = [
  'http://localhost:*',
  'http://127.0.0.1:*',
  'ws://localhost:*',
  'ws://127.0.0.1:*',
];

function supabaseOrigins() {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const ws = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;
    return [url.origin, ws];
  } catch {
    return [];
  }
}

/**
 * @param {{ dev?: boolean }} [options] — `dev` defaults to
 *   `NODE_ENV !== 'production'`; pass it explicitly in tests.
 */
export function buildReportOnlyCsp({ dev = process.env.NODE_ENV !== 'production' } = {}) {
  const devConnect = dev ? ` ${DEV_ONLY_CONNECT_ORIGINS.join(' ')}` : '';
  return [
    "default-src 'self'",
    // 'unsafe-inline' is required by Next's inline bootstrap scripts (no nonce
    // pipeline); 'unsafe-eval' only in dev for React/webpack HMR.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''} https://js.paystack.co`,
    "style-src 'self' 'unsafe-inline'",
    // Remote images come from many hosts (R2, Cloudinary, editorial CDN hosts)
    // — an allowlist can't be complete, so https: is the pragmatic bound.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    `connect-src 'self' ${supabaseOrigins().join(' ')} https://*.supabase.co wss://*.supabase.co https://api.paystack.co https://js.paystack.co https://*.r2.cloudflarestorage.com https://res.cloudinary.com https://api.cloudinary.com https://*.ingest.sentry.io https://*.ingest.de.sentry.io${devConnect}`,
    // Paystack inline checkout renders its payment frame from these origins.
    "frame-src 'self' https://checkout.paystack.com https://*.paystack.co",
    "media-src 'self' https: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "worker-src 'self' blob:",
  ].join('; ');
}

/**
 * @param {{ dev?: boolean }} [options] — forwarded to buildReportOnlyCsp.
 */
export function buildSecurityHeaders(options = {}) {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    // HSTS: 6 months, subdomains included, no `preload` — preload can't be
    // undone without a browser-list change, so it stays off until the domain
    // is deliberately submitted.
    { key: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // camera/mic: unused anywhere in the app. geolocation=self: the restaurant
    // checkout reads navigator.geolocation to prefill the delivery address.
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
    { key: 'Content-Security-Policy-Report-Only', value: buildReportOnlyCsp(options) },
  ];
}
