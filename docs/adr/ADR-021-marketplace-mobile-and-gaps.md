# ADR-021 — Marketplace Mobile App + Backend Gap Endpoints

**Date:** 2026-07-05  
**Status:** Accepted  
**Deciders:** Platform team

## Context

The Paymax Marketplace backend (Agent C swarm) shipped ~40 endpoints under
`/v1/marketplace`: listings, offers, orders (escrow FSM), disputes, boosts,
saved-searches, verification, sellers, categories, search, and admin. The React
Native mobile app (`mobile-app/reactnative/app/marketplace/**`) is a 5-tab shell
(Discover / Sell / Chat-Deals / Orders / Account) built on a shared foundation
feature (`src/features/marketplace/**`), with the Discover, Sell, and Transact
groups owned by separate agents.

Two gaps remained for the Trust & Account group (Mobile-UX-Flows.md §28–34) and a
few cross-cutting needs of the sibling agents:

1. **Backend endpoints the mobile needs that did not exist.** The Sell composer
   needs a listing-photo presign; buyers need a wishlist (saved-items, distinct
   from the existing saved-searches); users need a safety report flow, a block
   list, and per-category notification preferences; Meetup Mode (Transact) needs
   a curated safe-spot list; and `GET /search` returned `501 SEARCH_NOT_WIRED`
   without Elasticsearch, leaving mobile search dead.

2. **The Account tab was a placeholder.** Verification Center, Report flow,
   Blocked users, Notification Preferences, and Help & Support were unbuilt.

New backend files (all in `backend/internal/marketplace/`, additive, no existing
file rewritten beyond adding routes/fields):
`presign.go`, `handler_account.go`, `model_account.go`, `service_account.go`,
`repository_account.go`; route registration + presigner wiring in
`backend/internal/app/marketplace_routes.go`; the `Search` fallback in
`service.go`. Migration:
`supabase/migrations/20260908000000_marketplace_account_gaps.sql` (additive-only).

New mobile files:
`app/marketplace/account.tsx` (hub), `app/marketplace/account/{report,blocked,notifications,help}.tsx`,
`src/features/marketplace/api/account.api.ts` (+ mock layer) and `account.hooks.ts`.

## Decision

1. **Mobile architecture: a snake→camel normalizer client + 5-tab nav.** The Go
   module returns snake_case JSON and binds snake_case bodies; every screen and
   sibling agent talks camelCase. The foundation client
   (`src/features/marketplace/api/client.ts`) normalizes in ONE place —
   `deepCamel()` on every response, `deepSnake()` on every request body — so no
   screen re-implements the conversion. The Account tab and its API module
   (`account.api.ts`) import ONLY that foundation client; they do not modify the
   client, types, Discover, Sell, or Transact code. Account-domain types (Report,
   Block, NotificationPrefs, SafeSpot, SavedItem, MediaPresign) live in
   `account.api.ts` because the frozen foundation `types.ts` does not carry them.

2. **Escrow FSM reuses the finance settlement/ledger — the marketplace never
   stores a balance.** Unchanged from the core module and reaffirmed here: money
   moves are postings against `ledger.AccountEscrow` / `AccountCommission`, keyed
   by deterministic idempotent refs (`mkt:order:<id>:fund|release|refund|fee`).
   The gap endpoints added in this ADR are **non-money metadata** (presign,
   saved-items, reports, blocks, notification-prefs, safe-spots) — no
   `Idempotency-Key`, no ledger posting, no tier gate. That is deliberate: the
   iron money rules apply only where money moves, and none of these move money.

3. **Listing-media presign reuses the R2 SigV4 presigner, fail-closed.**
   `POST /v1/marketplace/media/presign` mints a short-lived presigned R2 PUT URL
   with a **server-controlled** object key (`marketplace/<userId>/<uuid>.<ext>`),
   Content-Type bound into the signature, mirroring `estate/presign.go`. When R2
   env is absent the presigner reports `Configured()==false` and the endpoint
   returns `503 UPLOADS_NOT_CONFIGURED` — it NEVER fabricates a URL.
   **Path note:** mounted at `/media/presign`, not `/listings/media/presign`,
   because Gin's radix router forbids a static `media` segment alongside the
   existing `/listings/:id` param at the same tree position (it panics at route
   registration). Functionally identical; documented in OpenAPI and code.

4. **Search fallback: a minimal Postgres search when Elasticsearch is unwired.**
   Previously `GET /search` returned `501` with no ES. Now `Service.Search`
   degrades to `Repository.SearchListingsFallback` — an `ILIKE` title match plus
   `category_id` / `condition` / `state` / `lga` / `price_min` / `price_max`
   filters over `status='active'` listings, newest-first, `LIMIT`-bounded. The
   response envelope matches what the mobile client already understands
   (`results` + empty `facets` + no cursor) and carries `degraded: true`. Full
   relevance ranking, facets, and geo/near-me only ship with ES
   (`ELASTICSEARCH_URL` set). This makes mobile search WORK on day one instead of
   dead-ending, without pulling in a search dependency.

5. **Account screens reuse existing Paymax surfaces where the spec says "reuse".**
   Verification Center (§28) links into the existing KYC flow (`/kyc-verify`);
   Wallet hand-off (§30) links into the existing wallet screen
   (`/(tabs)/wallet`); Help's "Contact support" (§34) routes into the existing
   support surface with the active order/listing pre-attached. Only Report (§31),
   Blocked users (§32), and Notification Preferences (§33) are net-new screens,
   plus the Account hub (`account.tsx`). My Orders (§29) is owned by the Transact
   agent and is intentionally not built here.

6. **New Account tables carry no RLS — consistent with the marketplace schema.**
   `mkt_saved_items`, `mkt_reports`, `mkt_blocks`, `mkt_notification_prefs` are
   accessed exclusively through the Go backend's pgx **service-role** pool, which
   enforces owner-level authorization (OLA) in the service layer — the same
   posture as every other `mkt_*` table (`marketplace_v1.sql` defines none with
   RLS, and no PostgREST/anon-key path reaches these rows). Adding RLS to only the
   new tables would be inconsistent and misleading; if a direct-Supabase path is
   ever introduced, owner-scoped RLS + a `service_role` bypass should be added
   module-wide in one pass. This is the one deliberate deviation from the task's
   "RLS owner-scoped + service_role" instruction, taken to match the existing,
   audited module convention.

## Consequences

- Mobile Account tab is functional end-to-end with a `MKT_USE_MOCK` mock layer,
  so the whole group is demoable offline; `EXPO_PUBLIC_MARKETPLACE_USE_MOCK=false`
  switches to the live proxy.
- Search works without Elasticsearch (reduced fidelity, flagged `degraded`), and
  transparently upgrades to full ES search when `ELASTICSEARCH_URL` is set.
- Listing-photo uploads are secure (server-chosen keys, signed Content-Type) and
  fail closed with a clear 503 when R2 is unconfigured.
- One additive migration; no DROP/rename/narrow; safe to re-run.

## Alternatives considered

- **Presign at `/listings/media/presign` (as originally specced).** Rejected:
  Gin panics registering a static segment where `/listings/:id` already binds a
  param. `/media/presign` is the functional equivalent.
- **Return 501 for search until ES ships.** Rejected: leaves mobile search dead;
  the Postgres fallback is cheap, correct, and degrades gracefully.
- **Add RLS to only the new tables.** Rejected for module consistency (see
  Decision 6).
- **Extend the frozen foundation `types.ts` with Account types.** Rejected:
  the foundation is owned by another agent and must not be modified; Account
  types live in `account.api.ts`.
