import { imageHosts } from './image-hosts.config.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: true,
  distDir: process.env.DIST_DIR || '.next',

  images: {
    remotePatterns: imageHosts,
    minimumCacheTTL: 60,
  },

  async redirects() {
    return [
      {
        source: '/homepage',
        destination: '/',
        permanent: true,
      },
    ];
  },

  // Proxy the Go financial backend (Paymax v2) through the Next.js gateway so the
  // mobile app and web reach /api/finance/* and the mobile-aligned /api/v1/* surface
  // (connect, crypto, invest, stocks, telemedicine, learn, spotlight, investai,
  // ai/invest, mobility, …) via their single base URL. Set GO_BACKEND_URL to the
  // backend's address (default APP_PORT 8080).
  //
  // IMPORTANT: use the `fallback` phase, NOT the array (afterFiles) form. An
  // afterFiles rewrite overrides catch-all ([...path]) route handlers such as
  // app/api/v1/fx/[...path]/route.ts, sending those requests straight to Go and
  // bypassing both the handlers' auth guards AND the CORS headers that the Next
  // middleware attaches to handler responses (external rewrites are opaque — Next
  // does not decorate them with middleware/`headers()` CORS, and does not forward
  // the upstream response's CORS headers, so cross-origin browser calls fail with
  // net::ERR_FAILED). `fallback` runs only AFTER filesystem + dynamic routes, so
  // any existing route handler serves its own path (and gets CORS), while only
  // genuinely unhandled paths fall through to the Go backend.
  async rewrites() {
    const goBackend = process.env.GO_BACKEND_URL || 'http://localhost:8080';
    return {
      fallback: [
        {
          source: '/api/finance/:path*',
          destination: `${goBackend}/api/finance/:path*`,
        },
        {
          source: '/api/v1/:path*',
          destination: `${goBackend}/api/v1/:path*`,
        },
      ],
    };
  },
};
export default nextConfig;
