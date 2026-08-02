// Sentry — browser runtime. The DSN here is PUBLIC by design (NEXT_PUBLIC_*):
// it only permits sending events, not reading them. Inert until the DSN is set.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? 'development',
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),

  // Session Replay is OFF by default. If you enable it for a fintech app, you MUST
  // keep these masks on — never record card numbers, OTPs, balances, or any PII.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_ON_ERROR ?? '0'),
  integrations: [
    Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }),
  ],
});

// Instrumentation for navigation transactions (App Router).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
