// ── Spotlight Academy — Analytics taxonomy (no-op stub) ──────────────────────
// Per nfr.md, emit at each meaningful transition. Every event carries cohorting
// context (curriculumVersion, class, subject, offlineOrigin) where available.
// This is a console/no-op stub for Phase 0/1 — swap the sink for the real
// telemetry pipeline later without touching call sites.

export type AcademyEvent =
  // Acquisition
  | 'install' | 'tv_code_entered' | 'referral_signup'
  // Activation
  | 'onboarding_completed' | 'diagnostic_completed' | 'first_lesson'
  // Engagement
  | 'lesson_started' | 'lesson_completed' | 'practice_completed' | 'streak_extended' | 'challenge_completed'
  // Outcomes
  | 'mastery_gained' | 'mock_completed' | 'readiness_updated'
  // Monetisation
  | 'plan_viewed' | 'checkout_started' | 'bnpl_started' | 'bundle_purchased' | 'edupay_paid'
  // Rewards
  | 'reward_earned' | 'reward_redeemed'
  // Earning bridge
  | 'credential_issued' | 'opportunity_viewed' | 'opportunity_applied';

const ENABLED = (process.env.EXPO_PUBLIC_ACADEMY_ANALYTICS_LOG ?? 'true') !== 'false';

export function track(event: AcademyEvent, props?: Record<string, unknown>): void {
  if (__DEV__ && ENABLED) {
    // eslint-disable-next-line no-console
    console.log(`[academy] ${event}`, props ?? {});
  }
  // no-op sink — real telemetry wired here later.
}
