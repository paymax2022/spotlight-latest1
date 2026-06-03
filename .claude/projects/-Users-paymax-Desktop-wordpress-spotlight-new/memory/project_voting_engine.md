---
name: project-voting-engine
description: Universal Contest Voting Engine — architecture, key decisions, and integration points built on 2026-06-02
metadata:
  type: project
---

Universal voting engine was fully built on 2026-06-02.

**Why:** Spotlight needs a reusable paid+free voting system that works across all contest types (Open Mic, STEM, Football, Acting, etc.) without code duplication.

**How to apply:** When adding voting to any new contest, create a `voting_settings` row for that contest and configure it via admin UI at `/admin/voting/[contestId]/settings`.

## Key files

- `supabase/migrations/20260602100000_universal_voting_engine.sql` — 16-table schema
- `frontend-web/src/features/voting/types.ts` — all TypeScript types
- `frontend-web/src/features/voting/constants.ts` — defaults, package presets
- `frontend-web/src/server/voting/free-vote.service.ts` — free vote logic + daily limits
- `frontend-web/src/server/voting/paid-vote.service.ts` — paid vote + Paystack initiation + idempotent credit
- `frontend-web/src/server/voting/totals.service.ts` — atomic vote totals + leaderboard
- `frontend-web/src/server/voting/fraud.service.ts` — IP/device/bot/spike/self-vote scoring
- `frontend-web/src/server/voting/audit.service.ts` — append-only audit log
- `frontend-web/src/server/voting/share.service.ts` — share links + analytics
- `frontend-web/src/server/voting/payment/paystack.ts` — Paystack API (init + verify)
- `frontend-web/src/server/voting/payment/webhook.ts` — idempotent webhook handler

## API surface

- `POST /api/votes/free` — cast free votes (anonymous or logged in)
- `GET /api/votes/remaining?contestId=` — check remaining daily free votes
- `POST /api/votes/paid/initiate` — start a Paystack payment
- `POST /api/votes/paid/verify` — client-side verify after callback (server also uses webhook)
- `GET /api/votes/stream?contestId=&contestantId=` — SSE real-time vote updates (5s poll)
- `GET /api/leaderboard/[contestId]` — public leaderboard (respects freeze + visibility settings)
- `POST /api/webhooks/paystack` — Paystack webhook (idempotent, always returns 200)
- `GET/POST /api/admin/voting/settings` — CRUD voting settings (JWT or API key required)
- `GET/POST/PATCH/DELETE /api/admin/voting/packages` — vote package management
- `GET /api/admin/voting/[contestId]/leaderboard` — admin leaderboard with enrichment
- `GET /api/admin/voting/[contestId]/revenue` — revenue dashboard data
- `GET/PATCH /api/admin/voting/[contestId]/fraud-alerts` — fraud flag management
- `POST /api/admin/voting/[contestId]/freeze` — freeze/unfreeze leaderboard
- `POST /api/admin/voting/[contestId]/adjust` — admin vote adjustment (audited)
- `POST /api/admin/voting/votes/[voteId]/reverse` — reverse a specific vote
- `GET /api/contestant/votes/summary?contestId=` — contestant's own vote summary
- `GET /api/contestant/votes/timeline?contestId=` — 30-day vote timeline

## Auth architecture (post-2026-06-02 fix)

Admin routes now require either:
  (a) Valid Supabase JWT + `user_profiles.role` satisfying the permission, OR
  (b) `SPOTLIGHT_ADMIN_API_KEY` + `x-admin-role` header (server-to-server only)

**SPOTLIGHT_ADMIN_API_KEY must be set in .env** — if unset, API key path is disabled and only JWT works.

Server Supabase client now uses `@supabase/ssr` + `cookies()` for proper session reading in Next.js App Router.

Middleware now refreshes session cookies on every request (prevents silent logout).

## Voting logic rules

- Free votes: enforced by `voter_daily_limits` table with upsert+update (atomic enough for moderate load)
- Paid votes: NEVER credit before webhook or server-side verification. `vote_credit_status` = 'credited' is the idempotency guard.
- Fraud: scores 0–100; ≥ 80 → quarantine, ≥ 60 → flagged, ≥ 30 → suspicious
- All vote records are immutable (status-change only, never DELETE)
- Leaderboard freeze → serves last `leaderboard_snapshots` row instead of live totals

## DB functions needed

Two Postgres RPC functions are expected by the services (fallback JS implementation exists):
  - `increment_vote_totals(p_contest_id, p_contestant_id, p_round_id, p_free_votes, ...)`
  - `recompute_leaderboard_ranks(p_contest_id, p_round_id)`

Add these via a follow-up migration for production performance.
