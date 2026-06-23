# Spotlight Project Reference

## Overview
Spotlight is a full-stack talent and media platform built around public discovery, paid and free participation flows, film academy onboarding, hybrid learning, contestant voting, fraud monitoring, and admin operations.

The product currently includes:
- public signup and candidate onboarding
- Film Academy applications, payment confirmation, and LMS progression
- Film academy audition registration and schedule management
- contestant registration and public profiles
- paid, free, and referral voting
- contest browsing, results, and leaderboard views
- admin dashboards for academy, auditions, templates, winners, and fraud review
- One-Beat One-Verse music competition lifecycle:
  - public landing, enrollment, submission, gallery, leaderboard
  - admin moderation, judging, winners, reports, config, fraud, monetization, sponsors, pipeline

## Tech Stack
- Frontend: Next.js 15 App Router, React 19, TypeScript
- Styling: Tailwind CSS
- Backend: Next.js route handlers plus server-side domain services
- Database/Auth/Storage: Supabase
- Payments: Paystack
- Image processing: Sharp
- Email notifications: Mailgun integration via HTTP API
- Testing: Vitest
- E2E: Playwright smoke harness (`playwright.config.mjs`, `tests/e2e/*.spec.mjs`)

## Repository Structure
```text
src/
  app/                  App Router pages and API routes
  components/           Shared UI and layout components
  contexts/             React context providers
  lib/                  Shared platform utilities
  server/services/      Backend domain services
  pages/                Legacy Next.js pages support
  styles/               Global styling assets

supabase/
  migrations/           Database schema and data migrations

docs/
  *.md                  Architecture, runbook, backlog, and test strategy docs

tests/
  unit/                 Vitest unit coverage
  api/                  API testing guidance
  e2e/                  End-to-end testing guidance
```

## Main Product Areas

### Public Experience
- `/homepage`
- `/about`
- `/contact`
- `/sign-up`
- `/contest`
- `/contest/[id]`
- `/contest/[id]/results`
- `/contestant/[slug]`
- `/vote/[slug]`
- `/vote-history`
- `/competitions`
- `/competitions/[slug]`
- `/competitions/[slug]/join`
- `/competitions/[slug]/submit`
- `/competitions/[slug]/gallery`
- `/competitions/[slug]/leaderboard`
- `/music-entry/[id]`
- `/audition-register`
- `/film-academy`
- `/film-academy/dashboard`

### Admin Experience
- `/admin`
- `/admin/login`
- `/admin/academy`
- `/admin/academy/lms`
- `/admin/auditions`
- `/admin/template-manager`
- `/admin/winner-management`
- `/admin-panel`
- `/admin-analytics`
- `/fraud-detection`
- `/admin/competitions/music`
- `/admin/competitions/music/[id]/config`
- `/admin/competitions/music/[id]/moderation`
- `/admin/competitions/music/[id]/judging`
- `/admin/competitions/music/[id]/winners`
- `/admin/competitions/music/[id]/reports`
- `/admin/competitions/music/[id]/monetization`
- `/admin/competitions/music/[id]/sponsors`
- `/admin/competitions/music/[id]/fraud`
- `/admin/competitions/music/[id]/pipeline`

### API Areas
- `src/app/api/academy`
- `src/app/api/admin`
- `src/app/api/auth`
- `src/app/api/contestants`
- `src/app/api/fraud`
- `src/app/api/competitions`
- `src/app/api/entries`
- `src/app/api/judging`
- `src/app/api/templates`
- `src/app/api/vote`
- `src/app/api/promotions`

## Core Architecture

### Frontend
The UI is built primarily with App Router pages and client components. Larger domain flows live in route-level pages such as:
- `src/app/film-academy/page.tsx`
- `src/app/sign-up/page.tsx`
- `src/app/vote/[slug]/page.tsx`
- `src/app/admin/academy/lms/page.tsx`

Shared presentation and navigation live in:
- `src/components`
- `src/components/ui`

### Backend
Backend behavior is split between:
- route handlers in `src/app/api/**`
- domain services in `src/server/services/**`
- shared infrastructure helpers in `src/lib/**`

Important backend slices:
- Academy: `src/server/services/academy/service.ts`
- Academy LMS: `src/server/services/academy/lms.ts`
- Payments: `src/lib/payments`
- Auth guards: `src/lib/auth`
- Supabase clients: `src/lib/supabase`
- Validation: `src/lib/validation`
- Rate limiting: `src/lib/rate-limit`
- Fraud logic: `src/lib/fraud`

### Database
Supabase is the system of record for:
- auth and sessions
- user profiles
- contests, contestants, votes, and fraud data
- Film Academy applications and LMS entities
- template data and storage-backed assets

Recent academy-related migrations include:
- `20260406000000_enhanced_film_academy.sql`
- `20260407135234_confirm_academy_payment_rpc.sql`
- `20260408110000_academy_hybrid_learning_mvp.sql`
- `20260408123000_seed_academy_programs.sql`
- `20260408143000_fix_academy_seed_duplicates.sql`
- `20260408162000_harden_academy_payment_confirmation.sql`

## Film Academy Module
The Film Academy is now a hybrid module with:
- application and payment flow
- batch selection
- candidate dashboard
- online learning programs, modules, and lessons
- exam eligibility and grading
- practical invitation workflow
- admin LMS management

Key files:
- `src/app/film-academy/page.tsx`
- `src/app/film-academy/dashboard/page.tsx`
- `src/app/admin/academy/page.tsx`
- `src/app/admin/academy/lms/page.tsx`
- `src/server/services/academy/service.ts`
- `src/server/services/academy/lms.ts`

## Payments
Paystack is used for:
- signup/registration payment confirmation
- Film Academy application fee confirmation
- paid voting

Important payment files:
- `src/lib/payments/paystack.ts`
- `src/lib/payments/paystack-client.ts`
- `src/app/api/academy/payment/confirm/route.ts`
- `src/app/api/auth/registration/payment/confirm/route.ts`
- `src/app/api/vote/paid/route.ts`

## Email Notifications
Transactional email support is now wired through Mailgun in:
- `src/lib/email/transactional.ts`

Current email-dependent flows:
- Spotlight registration confirmation
- Film Academy application confirmation
- audition registration confirmation
- contestant registration confirmation
- music competition enrollment confirmation
- music entry submission confirmation
- music moderation status updates

Required env keys for Mailgun:
- `MAILGUN_API_KEY`
- `MAILGUN_DOMAIN`
- `MAILGUN_REGION`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO`

## Storage and Media
Storage paths are centralized and env-driven through:
- `src/lib/storage/paths.ts`

Configured folders include:
- contestant images, video, audio
- academy passports, portfolios, documents, resources
- template source and render folders

## Auth and Access Control
Auth is backed by Supabase. Route protection and role checks are implemented via:
- `src/lib/auth/server.ts`
- `src/middleware.ts`
- Supabase RLS policies in migrations

Admin permissions are centered on `user_profiles.role` and supporting database policies.

## Tests
Current automated coverage includes:
- `tests/unit/academy-lms.service.test.ts`
- `tests/unit/music-notifications.test.ts`
- `tests/unit/music-enrollment-route.test.ts`
- `tests/unit/music-entry-submit-route.test.ts`
- `tests/unit/music-moderation-route.test.ts`
- `tests/e2e/music-smoke.spec.mjs`

Test-related docs:
- `tests/api/README.md`
- `tests/e2e/README.md`
- `docs/testing-strategy.md`

## Developer Scripts
- `npm run dev` — start local server on port `4028`
- `npm run build` — production build
- `npm run start` — production server on port `4028`
- `npm run lint` — lint checks
- `npm run type-check` — TypeScript validation
- `npm test` — unit tests
- `npm run test:coverage` — unit test coverage
- `npm run verify` — typecheck + lint + build

## Environment Variables
Core env categories used by the project:
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`
- Payments: `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`, `PAYSTACK_SECRET_KEY`
- Email: `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_REGION`, `EMAIL_FROM`, `EMAIL_REPLY_TO`
- Site config: `NEXT_PUBLIC_SITE_URL`
- Media/storage: `STORAGE_*`, Cloudinary keys where applicable

Use `.env.example` as the starting contract and do not commit real secrets.

## Operational Docs
- `docs/execution-backlog.md`
- `docs/film-academy-hybrid-learning-plan.md`
- `docs/one-beat-one-verse-blueprint.md`
- `docs/production-runbook.md`
- `docs/observability-checklist.md`
- `docs/testing-strategy.md`

## Current State
At the time of this document:
- academy LMS schema is applied in Supabase
- academy seed duplication was cleaned and hardened
- academy payment confirmation path was hardened
- Mailgun transactional notifications are present across registration, academy, audition, contestant, and music lifecycle flows
- One-Beat One-Verse admin and public modules are integrated into the core Spotlight system
- CI gates now include `type-check`, `lint`, `test`, and `build`
- build, type-check, and lint were brought back to a green state during the stabilization work

## Recommended Next Documentation Additions
- API contract reference by route
- database entity dictionary
- admin operations manual
- deployment environment matrix
- incident response checklist
