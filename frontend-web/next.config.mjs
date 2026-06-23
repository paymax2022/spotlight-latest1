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
    return [
      {
        source: '/api/finance/:path*',
        destination: `${goBackend}/api/finance/:path*`,
      },
    ];
  }
};
export default nextConfig;
