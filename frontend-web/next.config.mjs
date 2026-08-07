import { withSentryConfig } from '@sentry/nextjs';
import { imageHosts } from './image-hosts.config.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: true,
  distDir: process.env.DIST_DIR || '.next',

  // Required on Next 14 for the Sentry instrumentation.ts hook (stable in Next 15).
  experimental: {
    instrumentationHook: true,
  },

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
  // mobile app and web reach /api/finance/* (wallet, transport/mobility, etc.) via
  // their single base URL. The Go service has no Next.js route handlers of its own.
  // Set GO_BACKEND_URL to the backend's address (default APP_PORT 8080).
  async rewrites() {
    const goBackend = process.env.GO_BACKEND_URL || 'http://localhost:8080';
    // Array form = `afterFiles`: these apply AFTER filesystem routes, so any
    // existing frontend-web app/api/** route handler still takes precedence;
    // only unhandled paths fall through to the Go backend.
    return [
      {
        source: '/api/finance/:path*',
        destination: `${goBackend}/api/finance/:path*`,
      },
      // The Go backend also serves the mobile-aligned /api/v1/* surface
      // (connect, crypto, invest, stocks, telemedicine, learn, spotlight,
      // investai, ai/invest, mobility, …). Proxy it here so mobile/web reach it
      // through the single gateway origin instead of 404-ing at Next.
      {
        source: '/api/v1/:path*',
        destination: `${goBackend}/api/v1/:path*`,
      },
    ];
  }
};

// withSentryConfig uploads source maps at build (gated by SENTRY_AUTH_TOKEN) and
// tunnels events past ad-blockers. All Sentry options are optional — with no
// org/token the wrapper is a no-op, so builds succeed without a Sentry account.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN, // secret — CI/Vercel env only
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring', // route Sentry through our origin (avoids ad-block)
  sourcemaps: {
    // Only upload when we actually have a token (otherwise skip cleanly).
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
