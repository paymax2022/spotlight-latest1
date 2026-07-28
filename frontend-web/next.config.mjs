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
export default nextConfig;
