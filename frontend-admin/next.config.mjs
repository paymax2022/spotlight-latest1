/**
 * E2E-SEC-057 (security.md F5): baseline hardening headers on every response,
 * mirroring frontend-web. CSP is Report-Only for the same reason — the
 * Supabase origin is env-driven and realtime uses websockets; harvest reports
 * before promoting to an enforcing Content-Security-Policy.
 */
const isDev = process.env.NODE_ENV !== 'production';

function supabaseOrigins() {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const ws = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;
    return [url.origin, ws];
  } catch {
    return [];
  }
}

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Admin console uses none of these capabilities.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy-Report-Only',
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      `connect-src 'self' ${supabaseOrigins().join(' ')} https://*.supabase.co wss://*.supabase.co http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*`,
      "frame-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  output: 'standalone',
  experimental: {
    externalDir: true,
    // This app prerenders 488 static pages. Next forks one static-generation
    // worker per CPU, each with its own V8 heap; on a 2 GB Render instance the
    // pool exhausts the container and the workers die with SIGABRT. Serialize
    // them so peak memory is one heap instead of N.
    cpus: 1,
    workerThreads: false,
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

// Export plain config (Sentry removed - install @sentry/nextjs to re-enable)
export default nextConfig;
