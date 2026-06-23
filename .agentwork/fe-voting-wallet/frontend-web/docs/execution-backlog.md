# Spotlight Transformation Backlog

This backlog converts the audit into an execution plan the team can work through in sequence. Owners are role-based so work can be assigned immediately even before final headcount is fixed.

## Sprint 0 - Production Safety Baseline

### PLAT-001 - Fix production runtime command
- Owner: Platform
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/package.json`
- Outcome:
  - `npm start` runs production server instead of development mode.

### SEC-001 - Stop environment files from being tracked accidentally
- Owner: Security / Platform
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/.gitignore`
- Outcome:
  - Local secrets are protected from accidental commits going forward.
- Follow-up:
  - Rotate any secret that may already have been exposed.

### AUTH-001 - Unify admin source of truth
- Owner: Backend Platform
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/contexts/AuthContext.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/middleware.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/supabase/migrations/*admin*.sql`
- Outcome:
  - Frontend and backend both rely on `user_profiles.role` and `public.is_admin()`.

### PAY-001 - Verify academy payments with Paystack on the server
- Owner: Backend
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/academy/payment/confirm/route.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/lib/payments/paystack.ts`
- Outcome:
  - Application status is only finalized after verified payment provider confirmation.

### SEC-002 - Harden privileged fraud review APIs
- Owner: Backend / Security
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/fraud/flags/route.ts`
- Outcome:
  - Only admins can list and review fraud flags.

## Sprint 1 - Payment and Auth Integrity

### PAY-002 - Move signup payment flow to server-verified completion
- Owner: Backend + Frontend
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/sign-up/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/auth/*`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/lib/payments/paystack.ts`
- Outcome:
  - User account creation and paid registration status are finalized only after gateway verification or webhook success.

### AUTH-002 - Replace custom auth edge workarounds with a simpler supported SSR pattern
- Owner: Backend Platform
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/lib/supabase/client.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/lib/supabase/server.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/middleware.ts`
- Outcome:
  - Reduced auth complexity and fewer token propagation edge cases.

### SEC-003 - Add environment contract validation
- Owner: Platform
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/lib/config/*`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/.env.example`
- Outcome:
  - App fails fast with clear errors when required env vars are missing.

## Sprint 2 - API and Domain Architecture Cleanup

### ARCH-001 - Extract academy domain service layer
- Owner: Backend
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/academy/apply/route.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/academy/payment/confirm/route.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/academy/applications/[id]/route.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/server/services/academy/*`
- Outcome:
  - Business logic moved out of route handlers and standardized.

### ARCH-002 - Replace internal API-to-API fetches in voting flow
- Owner: Backend
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/vote/free/route.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/vote/paid/route.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/fraud/check/route.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/server/services/fraud/*`
- Outcome:
  - Fraud checks become direct service calls with lower latency and tighter contracts.

### ARCH-003 - Standardize API validation and response envelopes
- Owner: Backend Platform
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/**/*`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/lib/validation/*`
- Outcome:
  - Consistent request validation, predictable errors, and cleaner monitoring.

## Sprint 3 - Frontend Decomposition

### FE-001 - Break film academy page into feature modules
- Owner: Frontend
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/film-academy/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/film-academy/components/*`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/film-academy/hooks/*`
- Outcome:
  - Form steps, validation, uploads, and payment orchestration become maintainable.

### FE-002 - Refactor signup flow into form + payment modules
- Owner: Frontend
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/sign-up/page.tsx`
- Outcome:
  - Signup becomes testable and less fragile.

### FE-003 - Decompose voting page into data, voting actions, and presentation modules
- Owner: Frontend
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/vote/[slug]/page.tsx`
- Outcome:
  - Lower hydration pressure and easier iteration on the public voting experience.

## Sprint 4 - Security and Storage Hardening

### SEC-004 - Replace open academy uploads with signed upload flow
- Owner: Backend / Security
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/academy/upload/route.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/supabase/migrations/20260406000000_enhanced_film_academy.sql`
- Outcome:
  - Upload permissions become scoped, auditable, and abuse-resistant.

### SEC-005 - Restrict remote asset fetching for template rendering
- Owner: Backend / Security
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/lib/rendering/imageCompositor.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/image-hosts.config.mjs`
- Outcome:
  - Rendering path no longer accepts arbitrary remote URLs.

### SEC-006 - Add rate limiting to auth, payment, upload, and voting routes
- Owner: Platform / Backend
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/**/*`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/lib/rate-limit/*`
- Outcome:
  - Basic abuse prevention exists for public endpoints.

## Sprint 5 - Data and Admin Reliability

### DATA-001 - Reconcile academy schema drift and remove compatibility debt
- Owner: Backend / Database
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/supabase/migrations/*academy*.sql`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/academy/apply/route.ts`
- Outcome:
  - One clean academy schema path with no legacy fallback logic required.

### ADMIN-001 - Move admin mutations behind explicit admin APIs
- Owner: Backend + Frontend
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/admin/academy/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/admin/template-manager/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/admin-panel/page.tsx`
- Outcome:
  - Sensitive admin actions become easier to secure, audit, and test.

## Sprint 6 - Quality, Testing, and Release Discipline

### QA-001 - Add integration tests for core APIs
- Owner: QA / Backend
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/tests/api/*`
- Outcome:
  - Core auth, academy, vote, and fraud APIs are regression-protected.

### QA-002 - Add end-to-end coverage for top business flows
- Owner: QA / Frontend
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/tests/e2e/*`
- Outcome:
  - Signup, academy registration, contestant registration, voting, and admin login are covered.

### DEVOPS-001 - Add CI gates
- Owner: DevOps / Platform
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/.github/workflows/*`
- Outcome:
  - Lint, typecheck, build, and tests block bad merges.

## Sprint 7 - Product and Premium Experience

### UX-001 - Replace placeholder dashboard data with live application state
- Owner: Frontend + Backend
- Priority: Medium
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/user-dashboard/page.tsx`
- Outcome:
  - User dashboard feels trustworthy and operationally real.

### UX-002 - Accessibility and feedback state polish
- Owner: Frontend / Product Design
- Priority: Medium
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/**/*`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/components/**/*`
- Outcome:
  - Keyboard navigation, semantic structure, and form feedback meet production expectations.

### OPS-001 - Add observability, error tracking, and runbooks
- Owner: DevOps / Platform

## Sprint 8 - One-Beat, One-Verse MVP Foundation

### Delivery Snapshot (2026-04-10)
- Completed: `MUSIC-001` to `MUSIC-017` core implementation paths are now in place across migrations, APIs, and admin/public pages.
- Completed this sweep: Playwright e2e harness and smoke specs are in repository.
- Completed this sweep: CI gate includes type-check, lint, unit tests, build, and e2e smoke tests.
- Remaining before production launch: staging execution/sign-off and environment-specific launch approvals.

### MUSIC-001 - Extend contest domain for music competition type
- Owner: Backend / Database
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/supabase/migrations/*music_competition*.sql`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/server/services/contest/*`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/lib/validation/*`
- Outcome:
  - Existing contest model supports `one_beat_one_verse` with timeline windows, weights, and eligibility configuration.

### MUSIC-002 - Build public competition landing page in existing design system
- Owner: Frontend / Product Design
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/competitions/[slug]/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/components/competitions/*`
- Outcome:
  - Conversion-focused mobile-first public page with hero, timeline, prizes, FAQ, CTA, sponsors, and terms links.

### MUSIC-003 - Add enrollment flow with unified auth + profile completion
- Owner: Frontend + Backend
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/competitions/[slug]/join/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/competitions/[id]/enroll/route.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/contestant-register/page.tsx`
- Outcome:
  - User can sign up/sign in and enroll in one guided flow with validation and eligibility checks.

### MUSIC-004 - Implement beat management and gated download tracking
- Owner: Backend + Frontend
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/admin/competitions/[id]/beats/*`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/beats/[id]/download-token/route.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/competitions/[slug]/join/page.tsx`
- Outcome:
  - Admin manages beats; contestants preview/download according to enrollment policy; downloads are logged.

### MUSIC-005 - Implement music entry draft and final submit workflow
- Owner: Frontend + Backend
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/competitions/[slug]/submit/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/entries/*`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/lib/storage/paths.ts`
- Outcome:
  - Contestants can create draft entries, upload audio/video, and finalize within allowed windows.

### MUSIC-006 - Add moderation queue and action audit trail
- Owner: Backend + Admin Frontend
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/admin/competitions/music/[id]/moderation/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/moderation/entries/[id]/action/route.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/lib/auth/server.ts`
- Outcome:
  - Moderators can approve/reject/request corrections with full actor and timestamp audit logs.

### MUSIC-007 - Extend public gallery and leaderboard for music entries
- Owner: Frontend + Backend
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/competitions/[slug]/gallery/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/competitions/[slug]/leaderboard/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/competitions/[id]/gallery/route.ts`
- Outcome:
  - Public discovery, filtering, and ranking pages work with approved/live music submissions.

### MUSIC-008 - Reuse and extend voting engine with contest-level policy
- Owner: Backend / Payments
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/vote/free/route.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/vote/paid/route.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/server/services/vote/*`
- Outcome:
  - Free and paid voting respect per-competition limits, pricing, and anti-abuse constraints.

### MUSIC-009 - Trigger lifecycle notifications for enrollment, submission, and moderation
- Owner: Backend
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/lib/email/registration-notifications.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/competitions/[id]/enroll/route.ts`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/entries/*`
- Outcome:
  - Participants receive consistent transactional updates across key competition events.

## Sprint 9 - One-Beat, One-Verse Admin, Judging, and Revenue

### MUSIC-010 - Build admin competition configuration panel
- Owner: Admin Frontend + Backend
- Priority: Critical
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/admin/competitions/music/[id]/config/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/admin/competitions/music/[id]/route.ts`
- Outcome:
  - Admin can configure windows, rules, eligibility, vote settings, and prize definitions.

### MUSIC-011 - Build judge assignment and scoring portal
- Owner: Backend + Frontend
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/judge/competitions/[id]/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/judging/*`
- Outcome:
  - Judges can score assigned entries with weighted criteria and deadline locking.

### MUSIC-012 - Implement winner management and prize fulfillment tracking
- Owner: Admin Frontend + Backend
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/admin/competitions/music/[id]/winners/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/admin/competitions/[id]/winners/*`
- Outcome:
  - Admin can publish winners by tier/category and track fulfillment status.

### MUSIC-013 - Add monetization controls for boosts and promotions
- Owner: Product Backend + Frontend
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/admin/competitions/music/[id]/monetization/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/promotions/*`
- Outcome:
  - Paid profile boosts and promoted placements become configurable and measurable.

### MUSIC-014 - Add fraud review extensions for vote integrity
- Owner: Security + Backend
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/fraud/*`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/admin/competitions/music/[id]/fraud/page.tsx`
- Outcome:
  - Risk-scored suspicious vote activity is triaged with invalidate/restore controls and auditability.

## Sprint 10 - One-Beat, One-Verse Growth, Analytics, and Pipeline

### MUSIC-015 - Build competition analytics dashboard
- Owner: Data / Backend / Admin Frontend
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/admin/competitions/music/[id]/reports/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/admin/competitions/[id]/reports/route.ts`
- Outcome:
  - Admin can view funnel, submissions, voting, revenue, and moderation SLA metrics.

### MUSIC-016 - Add sponsor slots and campaign performance tracking
- Owner: Backend + Frontend
- Priority: Medium
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/admin/competitions/music/[id]/sponsors/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/admin/competitions/[id]/sponsors/*`
- Outcome:
  - Sponsor assets and placements are manageable with impression/click reporting.

### MUSIC-017 - Launch talent pipeline handoff flow for finalists/winners
- Owner: Product Backend + Admin Frontend
- Priority: Medium
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/admin/competitions/music/[id]/pipeline/page.tsx`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/src/app/api/admin/pipeline/*`
- Outcome:
  - Top contestants can be moved into Spotlight artist development with status tracking.
- Priority: High
- Files:
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/README.md`
  - `/Users/paymax/Desktop/wordpress/spotlight website/spotlight/docs/*`
- Outcome:
  - The team can monitor, deploy, and recover professionally.
