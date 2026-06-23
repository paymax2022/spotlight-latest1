# Testing Strategy

## Current State
The project now has stronger server-side boundaries, but it still needs dedicated automated coverage for its most critical commercial flows.

## Priority Order
1. API integration coverage for payment confirmation, academy application submission, and voting routes.
2. End-to-end coverage for signup, film academy registration, paid voting, and admin moderation.
3. Regression coverage for fraud logic, storage permissions, and admin-only APIs.

## API Coverage Targets
- `POST /api/auth/registration/payment/confirm`
- `POST /api/academy/apply`
- `POST /api/academy/payment/confirm`
- `POST /api/vote/free`
- `POST /api/vote/paid`
- `POST /api/vote/referral`
- `GET/PATCH /api/academy/applications/[id]`
- `GET/PATCH /api/admin/applicants`
- `GET /api/competitions?type=one_beat_one_verse`
- `GET /api/competitions/[slug]`
- `POST /api/competitions/[id]/enroll`
- `POST /api/entries`
- `PATCH /api/entries/[id]`
- `POST /api/entries/[id]/submit`
- `POST /api/beats/[id]/download-token`
- `POST /api/moderation/entries/[id]/action`
- `POST /api/judging/entries/[id]/score`
- `GET /api/competitions/[id]/gallery`
- `GET /api/competitions/[id]/leaderboard`
- `POST /api/admin/competitions/[id]/winners/publish`
- `GET /api/admin/competitions/[id]/reports`
- `POST /api/admin/fraud/[signalId]/decision`

## E2E Coverage Targets
- User signup and registration payment
- Film academy submission and payment confirmation
- Paid voting flow from package selection to confirmation page
- Admin applicant review flow
- Music competition landing page to successful enrollment
- Beat preview and gated download for enrolled contestants
- Entry draft save, edit, and final submission
- Moderator approval/rejection flow with reason capture
- Judge scoring and score lock behavior
- Public voting journey with free and paid vote paths
- Winner publishing and public winner visibility
- Music lifecycle email metadata checks on enroll, submit, and moderation actions

## Recommended Tooling
- API and unit tests: `vitest`
- Browser tests: `playwright`
- Contract and fixture management: static JSON fixtures plus Supabase seed data

## Current Automated Coverage (Music Notifications)
- `tests/unit/music-notifications.test.ts`
- `tests/unit/music-enrollment-route.test.ts`
- `tests/unit/music-entry-submit-route.test.ts`
- `tests/unit/music-moderation-route.test.ts`

## Current Automated Coverage (E2E Smoke)
- `tests/e2e/music-smoke.spec.mjs`
- `tests/e2e/security-smoke.spec.mjs`
- `tests/e2e/admin-authenticated.spec.mjs` (env-driven)

CI note:
- `.github/workflows/ci.yml` now runs Playwright smoke tests after verify gates.

## Interim Manual Smoke Suite
- Run the payment-required flows after every deployment.
- Verify admin-only routes reject non-admin users.
- Verify rate limiting responds with `429` for abusive repeated requests.

## One-Beat, One-Verse Quality Gates
1. API suite must pass for enrollment, beat access, entry submission, moderation, judging, and winners publish.
2. Notification assertions must pass for enrollment, entry submit, and moderation update (`email_notification_sent` behavior).
3. E2E suite must pass for contestant path, admin moderation path, judge path, and fan voting path.
4. Fraud checks must verify suspicious velocity handling and vote invalidation audit logs.
5. Payment tests must verify idempotent confirmation and duplicate callback safety.
6. Release requires a manual smoke test on mobile viewport for landing, join, submit, and vote pages.
