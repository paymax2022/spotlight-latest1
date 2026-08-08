/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
    // This app prerenders 488 static pages. Next forks one static-generation
    // worker per CPU, each with its own V8 heap; on a 2 GB Render instance the
    // pool exhausts the container and the workers die with SIGABRT. Serialize
    // them so peak memory is one heap instead of N.
    cpus: 1,
    workerThreads: false,
  },
};

// Export plain config (Sentry removed - install @sentry/nextjs to re-enable)
export default nextConfig;
