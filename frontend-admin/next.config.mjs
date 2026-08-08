/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
  },
};

// Export plain config (Sentry removed - install @sentry/nextjs to re-enable)
export default nextConfig;
