// Next.js instrumentation hook — loads the right Sentry runtime config and wires
// nested-RSC error capture. Requires experimental.instrumentationHook in Next 14.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Captures errors thrown in nested React Server Components (App Router).
export const onRequestError = Sentry.captureRequestError;
