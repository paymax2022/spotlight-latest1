# Spotlight One-Beat, One-Verse Upgrade Blueprint

## Goal
Integrate a new competition module inside the current Spotlight ecosystem to discover and monetize singing talent through a beat-based challenge workflow.

## Scope
- Extend existing authentication, profile, contest, voting, payment, notification, media upload, fraud, and admin modules.
- Preserve existing design language, route conventions, and admin navigation.
- Ship as an extensible contest type so additional music formats can be added with minimal rework.

## Architecture Decisions
1. Reuse existing contest model with `contest_type = "one_beat_one_verse"`.
2. Keep route handlers thin; place business logic in domain services.
3. Drive behavior from configuration (windows, rules, pricing, weights, limits).
4. Use existing payment services for paid votes and premium boosts.
5. Use existing notification channels for lifecycle messaging.
6. Enforce RBAC + audit logs for moderation, judging, fraud, and winner actions.

## Product Modules
1. Public competition landing and conversion page.
2. Enrollment with unified signup/signin and profile completion.
3. Beat preview/download with access policy and download logs.
4. Entry draft/edit/submit flow with media validation.
5. Moderator review queue and action auditing.
6. Judge scoring portal with weighted criteria.
7. Public gallery and leaderboard.
8. Voting extensions (free/paid policy per competition).
9. Monetization extensions (boosts/promoted profiles).
10. Winner publication and prize fulfillment.
11. Talent pipeline handoff for finalists/winners.
12. Competition analytics and reporting.

## Data Model Additions
- `competition_windows`
- `competition_beats`
- `beat_download_logs`
- `competition_enrollments`
- `competition_entries`
- `entry_media`
- `moderation_logs`
- `judge_assignments`
- `judge_criteria`
- `judge_scores`
- `vote_policies`
- `vote_transactions` (competition-aware extension if table already exists)
- `fraud_signals`
- `fraud_decisions`
- `leaderboard_snapshots`
- `winner_records`
- `prize_fulfillments`
- `promotion_purchases`
- `talent_pipeline_records`

## Status Lifecycle
- Entry: `draft -> submitted -> under_review -> approved -> live_for_voting -> finalist -> winner`
- Recovery and enforcement: `rejected`, `correction_requested`, `disqualified`

## API Contract Set
- Public:
  - `GET /api/competitions?type=one_beat_one_verse`
  - `GET /api/competitions/:slug`
  - `GET /api/competitions/:id/gallery`
  - `GET /api/competitions/:id/leaderboard`
- Contestant:
  - `POST /api/competitions/:id/enroll`
  - `POST /api/entries`
  - `PATCH /api/entries/:id`
  - `POST /api/entries/:id/submit`
  - `POST /api/beats/:id/download-token`
- Moderation/Judging:
  - `POST /api/moderation/entries/:id/action`
  - `POST /api/judging/entries/:id/score`
- Voting/Monetization:
  - Extend `POST /api/vote/free` and `POST /api/vote/paid` with contest policy checks
  - `POST /api/promotions/purchase`
- Admin:
  - `POST|PATCH /api/admin/competitions/music/:id`
  - `POST /api/admin/competitions/:id/winners/publish`
  - `GET /api/admin/competitions/:id/reports`
  - `POST /api/admin/fraud/:signalId/decision`

## RBAC Matrix
- `super_admin`: all actions, including fraud and winner override.
- `competition_admin`: contest config, timelines, beats, judges, winners, reports.
- `moderator`: review, reject, approve, correction request, flag.
- `judge`: score assigned entries only.
- `finance_viewer`: payment/revenue/report exports.

## Validation Rules
- Enrollment:
  - one enrollment per user per competition
  - age/location/genre eligibility checks
  - consent + terms required
- Entry:
  - accepted format, file size, and duration limits
  - submission window enforcement
  - duplicate and max-entry rules
- Voting:
  - daily free caps
  - paid vote verification and idempotency checks
  - abuse/rate-limit controls
- Judging:
  - assigned access only
  - score freeze lock after deadline

## Fraud Controls
- IP/device/user velocity checks.
- Risk scoring and suspicious vote queue.
- Vote invalidation with actor/reason audit logs.
- Admin restore flow for false positives.

## Analytics Events
- `competition_landing_view`
- `competition_cta_click`
- `competition_enrollment_completed`
- `beat_preview_played`
- `beat_downloaded`
- `entry_draft_saved`
- `entry_submitted`
- `entry_live_for_voting`
- `vote_cast_free`
- `vote_cast_paid`
- `winner_published`

## Rollout Plan
1. MVP:
  - contest config, landing page, enrollment, beats, submission, moderation, gallery, leaderboard, vote policy extension.
2. Phase 2:
  - judge portal, winner workflows, richer reports, fraud queue upgrades.
3. Phase 3:
  - premium monetization suite, sponsor campaign tooling, talent pipeline CRM depth.

## Release Risk Controls
- Feature flag: `music_competition_v1`.
- Stage rollout by capability: enroll -> submit -> gallery -> voting -> winner publish.
- Keep rollback switches for voting pause and submission close.
- Require QA gates from `docs/testing-strategy.md`.
