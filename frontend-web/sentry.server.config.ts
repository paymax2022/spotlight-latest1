// Sentry — Node.js server runtime (SSR, route handlers, server actions).
// Inert until SENTRY_DSN is set, so this is safe to commit/deploy without a DSN.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? 'development',
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
  // Performance tracing — sample conservatively in prod to control cost.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
  // Never send local PII by default; fintech data must not leak into error events.
  // @sentry/nextjs v11 removed sendDefaultPii; dataCollection defaults are
  // permissive, so pin the restrictive v10 baseline explicitly.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    frameContextLines: 7,
  },
});
