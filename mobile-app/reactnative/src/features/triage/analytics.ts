// ── Paymax AI Symptom Checker — analytics (no-op stub) ───────────────────────
// House style (mirrors src/features/academy/analytics.ts): a feature-local
// no-op sink with a string-union event type. Real telemetry wired here later.
// Kept side-effect-free so mock-first screens run with no backend.

export type TriageEvent =
  | 'triage_started'
  | 'red_flag_shown'
  | 'disposition_given'
  | 'care_booked';

const ENABLED = (process.env.EXPO_PUBLIC_TRIAGE_ANALYTICS_LOG ?? 'true') !== 'false';

export function track(event: TriageEvent, props?: Record<string, unknown>): void {
  if (__DEV__ && ENABLED) {
    // eslint-disable-next-line no-console
    console.log(`[triage] ${event}`, props ?? {});
  }
  // no-op sink — real telemetry wired here later.
}
