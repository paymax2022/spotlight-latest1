# Events Organiser Self-Service — Phase 2 (Ticketing Depth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give organisers deeper ticket control — editable tiers with on/off-sale windows and invite-only, plus richer promo codes (fixed-amount, validity window, per-user cap, per-tier scope) — enforced at purchase, behind a feature flag.

**Architecture:** Extend the existing `backend/internal/top5events` module. Add tier/promo management in new focused files (`tiers.go`, `promos.go`), extend the existing `AddTier`/`AddPromo` create paths and the `Purchase` enforcement in place, one additive migration for the new tier/promo columns + a `event_promo_redemptions` table. Gated by `FEATURE_EVENTS_TICKETING_DEPTH`. Contract-first; React Native tier/promo management screens.

**Tech Stack:** Go 1.27 + Gin, pgx, PostgreSQL (additive migrations), Next.js API proxy (passthrough), React Native/Expo.

**Spec:** `docs/superpowers/specs/2026-10-11-events-organiser-self-service-design.md` (§Ticketing depth, §3/§4/§6).

**Scope note:** `min/max tickets per order` and multi-quantity/group purchase are **deferred** to a separate money-path slice (per the user's decision 2026-10-12) — this plan does NOT add a quantity to `Purchase`, nor the `min_per_order`/`max_per_order` columns. `invite_only` is added here; comp-filling of invite-only tiers lands in Phase 3.

## Global Constraints

- Money = integer **kobo**; promo discounts never produce a negative `payable` (floor at 0). `Purchase` stays single-ticket and keeps its existing idempotency/crash-resume behaviour intact.
- Migrations are **additive-only** (no drop/rename/narrowing). Load the `db-migrations` skill before authoring. Choose a version strictly greater than the max on a **freshly fetched `origin/main`**, and re-check `scripts/ci/check-migration-versions.sh` immediately before merge AND verify no duplicate stamp on `origin/main` after merge (cross-PR collisions are invisible to the per-branch guard — see the migration-stamp-cross-pr-collision memory).
- **Only** touch `top5events`, its routes/contract section, and the events mobile feature. Never the legacy Spotlight modules.
- Feature-flag everything: Go `FEATURE_EVENTS_TICKETING_DEPTH`, mobile `EXPO_PUBLIC_EVENTS_TICKETING_DEPTH`.
- Go request structs use **snake_case** json tags.
- Tier/promo management authorization is object-level via the existing `authorizeManage` (owner **or** MANAGER), consistent with the Phase-1 edit matrix — not owner-only `assertOwner`.
- A promo has **exactly one** of `percent_off` / `amount_off_kobo` set.
- Conventional Commits; test-first for every task; live-DB tests gate on `TEST_DATABASE_URL`.

## Review Focus

- **Purchase outside a tier's sales window** (before `sales_start_at` or after `sales_end_at`) must be rejected, not sold. → Task 4.
- **Promo over its per-user cap** (same buyer's 2nd use when `per_user_limit=1`) must be rejected, and a redemption row recorded exactly once per successful apply (no double-count on crash-resume). → Task 4.
- **Invite-only tier bought publicly** must be rejected. → Task 4.
- **Promo with both or neither of percent/amount**, or a tier-scoped promo applied to a different tier, must be rejected. → Task 3 (create) + Task 4 (apply).
- **Editing a tier's price after a sale, or capacity below `sold`, or a promo's value after it's been used** must be rejected. → Task 2 / Task 3.

---

## File Structure
- Create `backend/internal/top5events/tiers.go` — `UpdateTier`; extend tier create validation.
- Create `backend/internal/top5events/promos.go` — `UpdatePromo`; extend promo create validation + the promo helper used by Purchase.
- Create `backend/internal/top5events/ticketing_live_db_test.go` — live-DB tests for tier/promo edit + purchase enforcement.
- Modify `backend/internal/top5events/service.go` — extend `AddTier`/`AddPromo` inserts; extend `Purchase` enforcement (tier window + invite_only; promo window/per-user/tier-scope/amount).
- Modify `backend/internal/top5events/model.go` — add fields to `TicketTier`/`PromoCode`.
- Modify `handler.go` / `handler_lifecycle.go` (or a new `handler_ticketing.go`) + `app/top5_routes.go` + `config/config.go` + `.env.example`.
- Create `supabase/migrations/<ts>_events_ticketing_depth.sql`.
- Modify `contracts/openapi.yaml` (events section).
- Modify `mobile-app/reactnative/src/features/events/{api.ts,types.ts,hooks.ts,constants}` and add `app/events/organiser/{tiers,promos}/[id].tsx`.

---

### Task 1: Additive migration

**Files:** Create `supabase/migrations/<ts>_events_ticketing_depth.sql`; verify on a throwaway/isolated Postgres.

**Interfaces — Produces:**
- `event_ticket_tiers`: `sales_start_at timestamptz NULL`, `sales_end_at timestamptz NULL`, `description text NOT NULL DEFAULT ''`, `invite_only boolean NOT NULL DEFAULT false`.
- `event_promo_codes`: `tier_id uuid NULL REFERENCES event_ticket_tiers(id) ON DELETE CASCADE`, `amount_off_kobo bigint NULL CHECK (amount_off_kobo >= 0)`, `starts_at timestamptz NULL`, `ends_at timestamptz NULL`, `per_user_limit int NOT NULL DEFAULT 0 CHECK (per_user_limit >= 0)`.
- New `event_promo_redemptions (id uuid PK, promo_id uuid NOT NULL REFERENCES event_promo_codes(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, order_id uuid NOT NULL REFERENCES event_orders(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now())`, RLS enabled mirroring the module's tables, unique index on `(promo_id, order_id)`.

- [ ] **Step 1: Load `db-migrations` skill**; `git fetch origin main`; choose a version `> ` the max migration on `origin/main`; name it `<ts>_events_ticketing_depth.sql`.
- [ ] **Step 2: Write the migration** (all `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`, additive; model `event_promo_redemptions` RLS on `event_stewards`/`event_team_members`).
- [ ] **Step 3: Verify version uniqueness** — `scripts/ci/check-migration-versions.sh` passes.
- [ ] **Step 4: Apply on an isolated DB and assert** the columns/table/defaults exist (use a throwaway Postgres or a dedicated test DB; never the shared one).
- [ ] **Step 5: Commit** — `feat(events): additive migration for ticketing depth (tier windows/invite_only, richer promos, redemptions)`

### Task 2: Tier create + edit (`UpdateTier`)

**Files:** Create `tiers.go`; modify `service.go` (`AddTier`), `model.go`; test in `ticketing_live_db_test.go`.

**Interfaces:**
- Consumes: `authorizeManage` (Phase 1), the tier scan.
- Produces: `TicketTier` gains `Description string`, `SalesStartAt,SalesEndAt *time.Time`, `InviteOnly bool` (snake_case tags). `AddTier` accepts+persists the new fields. `func (s *Service) UpdateTier(ctx, callerID, eventID, tierID string, patch TierPatch) (*TicketTier, error)` where `TierPatch` has optional pointer fields: `Name,Description *string; PriceKobo,Capacity *int64/*int; Active,InviteOnly *bool; SalesStartAt,SalesEndAt *time.Time`.

- [ ] **Step 1: Write failing live-DB tests** `TestLiveDB_UpdateTier_*`: owner edits name/description/window ok; `price` change rejected once `sold>0` (`ErrTierLocked`); `capacity` below `sold` rejected; `sales_start_at >= sales_end_at` rejected (`ErrInvalidWindow`); a MANAGER may edit; a stranger → `ErrForbidden`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** `AddTier` field extension + `UpdateTier` (authorizeManage; `SELECT ... FOR UPDATE` the tier; price editable only while `sold==0`; capacity `>= sold`; window `start<end` when both set; dynamic parameterized UPDATE of provided fields; new sentinels `ErrTierLocked`/`ErrInvalidWindow`).
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** — `feat(events): tier edit with sales windows, invite_only, price/capacity locks`

### Task 3: Promo create + edit (`UpdatePromo`, richer fields)

**Files:** Create `promos.go`; modify `service.go` (`AddPromo`), `model.go`; test in `ticketing_live_db_test.go`.

**Interfaces:**
- Produces: `PromoCode` gains `TierID *string`, `AmountOffKobo *int64`, `StartsAt,EndsAt *time.Time`, `PerUserLimit int` (snake_case). `AddPromo` validates **exactly one** of `PercentOff`/`AmountOffKobo` is set (percent in 0..100; amount >= 0), optional tier scope (tier must belong to the event), optional window (`start<end`), `per_user_limit >= 0`, and persists them. `func (s *Service) UpdatePromo(ctx, callerID, eventID, promoID string, patch PromoPatch) (*PromoCode, error)` — while `used==0`: code/scope/value/window/limit editable; after first use: only `active` (deactivate) and raising `max_uses` allowed (`ErrPromoLocked` otherwise).

- [ ] **Step 1: Write failing live-DB tests** `TestLiveDB_Promo_*`: create percent-only ok; create amount-only ok; create with both or neither → error; tier-scoped promo whose tier_id isn't on the event → error; UpdatePromo value change after `used>0` → `ErrPromoLocked`; deactivate after use ok; raising max_uses after use ok; MANAGER may manage; stranger → `ErrForbidden`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the create-validation extension + `UpdatePromo` (authorizeManage; exactly-one-of guard; parameterized dynamic UPDATE; sentinel `ErrPromoLocked`). Align `AddTier`/`AddPromo` authz to `authorizeManage` (owner or MANAGER) to match the Phase-1 matrix.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** — `feat(events): richer promos (fixed-amount, window, per-user cap, per-tier scope) + edit`

### Task 4: Purchase-time enforcement

**Files:** Modify `service.go` (`Purchase`) + `promos.go` (promo resolution helper); test in `ticketing_live_db_test.go`.

**Interfaces:**
- Consumes: the existing `Purchase` tier-lock + promo-apply block (service.go).
- Produces: enforcement inside the existing `Purchase` tx — reject when: now `< sales_start_at` or `> sales_end_at` (`ErrNotPurchasable` or a new `ErrTierNotOnSale`); tier `invite_only` (`ErrInviteOnly`); promo outside `[starts_at,ends_at]`, over `max_uses`, over `per_user_limit` for this buyer, or `tier_id` set and `!= tierID` (reject with a clear promo error). Discount: `amount_off_kobo` (floor payable at 0) OR `percent_off`, whichever the promo carries. On a successful promo apply, insert an `event_promo_redemptions` row **in the same tx** (idempotent on `(promo_id, order_id)` so crash-resume doesn't double-count) alongside the existing `used=used+1`.

- [ ] **Step 1: Write failing live-DB tests** `TestLiveDB_Purchase_*` (zero/low-price tiers, funded where needed): buy before window → rejected; within window → ok; after window → rejected; invite_only tier → rejected; amount-off promo discounts correctly and floors at 0; per-user-limit: same buyer's 2nd use rejected while a different buyer still succeeds; tier-scoped promo on the wrong tier rejected; redemption row written exactly once (assert count after a resumed/retried purchase).
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the enforcement in `Purchase` (keep the existing idempotent-replay path first; add checks within the existing tier `FOR UPDATE` tx; per-user count via `SELECT count(*) FROM event_promo_redemptions WHERE promo_id=$1 AND user_id=$2`). New sentinels as needed.
- [ ] **Step 4: Run to verify they pass**, plus the whole package (`go test ./internal/top5events/ -count=1`).
- [ ] **Step 5: Commit** — `feat(events): enforce tier sale windows, invite_only, and richer promo rules at purchase`

### Task 5: Handlers, routes, flag

**Files:** Modify `handler*.go`, `app/top5_routes.go`, `config/config.go`, `.env.example`; test alongside the package.

**Interfaces:**
- Produces: `FeatureEventsTicketingDepth` (env `FEATURE_EVENTS_TICKETING_DEPTH`, default false). Routes on the member group, registered only when the flag is on: `PATCH /events/:id/tiers/:tierId`, `PATCH /events/:id/promos/:promoId`. Extend the existing create handlers (`POST /:id/tiers`, `POST /:id/promos`) to bind the new fields. Map new sentinels: `ErrTierLocked`/`ErrPromoLocked`→409, `ErrInvalidWindow`→400, `ErrInviteOnly`/`ErrTierNotOnSale`→409, reusing the Phase-1 `lifecycleStatus`-style mapper.

- [ ] **Step 1: Add the config flag** + `.env.example` doc (mirror `FeatureEventsEditLifecycle`).
- [ ] **Step 2: Write a failing handler test** — flag on: PATCH tier/promo by owner → 200; bad window → 400; locked edit → 409; non-owner → 403. Flag off: routes 404.
- [ ] **Step 3: Implement** handlers (snake_case bind, sentinel→status) + flag-gated registration.
- [ ] **Step 4: Run to verify**; `go build ./... && go vet ./...`.
- [ ] **Step 5: Commit** — `feat(events): tier/promo management routes behind FEATURE_EVENTS_TICKETING_DEPTH`

### Task 6: OpenAPI contract

**Files:** Modify `contracts/openapi.yaml` (events section).

- [ ] **Step 1: Add paths** `PATCH /events/{id}/tiers/{tierId}` and `PATCH /events/{id}/promos/{promoId}` with their patch bodies + statuses (200/400/403/404/409); extend the tier and promo **create** request schemas and the `TicketTier`/`PromoCode` response schemas with the new fields. Match the surrounding events-path conventions.
- [ ] **Step 2: Validate** — `cd frontend-web && npm run contract:check` passes.
- [ ] **Step 3: Commit** — `docs(contract): events ticketing-depth tier/promo endpoints + fields`

### Task 7: Mobile api/types/hooks

**Files:** Modify `mobile-app/reactnative/src/features/events/{api.ts,types.ts,hooks.ts,constants/events.constants.ts}`.

**Interfaces:**
- Produces: `updateTier(eventId, tierId, patch)`, `updatePromo(eventId, promoId, patch)` (+ extend the existing create-tier/create-promo calls with the new fields) — WRITES that **throw in fixture mode** (the Phase-1 `notInFixtureMode` pattern); matching types; hooks `useUpdateTier`/`useUpdatePromo` invalidating the event-detail + organiser queries; a `EVENTS_TICKETING_DEPTH_ENABLED` constant (default off).

- [ ] **Step 1: Write the constant + api functions** (writes refuse fixture mode) and types.
- [ ] **Step 2: Add the hooks** with invalidation of the existing query keys.
- [ ] **Step 3: Verify** — `cd mobile-app/reactnative && npx tsc --noEmit` (0 errors; `--stack-size=10000` if it crashes).
- [ ] **Step 4: Commit** — `feat(events-mobile): tier/promo management api + hooks (writes refuse fixture mode)`

### Task 8: Mobile organiser screens

**Files:** Create `app/events/organiser/tiers/[id].tsx`, `app/events/organiser/promos/[id].tsx` (+ dashboard/detail entry points).

- [ ] **Step 1: Tier management screen** — list the event's tiers; add/edit a tier (name, description, price [disabled when sold], capacity, active, sales window, invite_only), gated behind `EVENTS_TICKETING_DEPTH_ENABLED`, using `useUpdateTier`/create; map thrown fixture/HTTP errors to friendly messages.
- [ ] **Step 2: Promo management screen** — list/add/edit promos (code, percent OR amount, optional tier scope, window, max_uses, per_user_limit, active), same gating + error mapping.
- [ ] **Step 3: Verify** — `npx tsc --noEmit` (0 errors). (Mobile preview is unreliable in this worktree — verify via tsc + code review against the Phase-1 screens.)
- [ ] **Step 4: Commit** — `feat(events-mobile): organiser tier & promo management screens`

---

## Notes / deliberate scoping
- **Deferred:** `min/max tickets per order`, multi-quantity/group purchase, and the `min_per_order`/`max_per_order` columns — their own money-path slice.
- **`invite_only`** is enforced as a purchase block here; filling invite-only tiers via comps is Phase 3.
- `Purchase` stays single-ticket; its idempotency/crash-resume path is unchanged except for the added read-only checks + the redemption insert.
- Aligning `AddTier`/`AddPromo` authz to `authorizeManage` is a small, intentional consistency change (Phase-1 matrix allows MANAGER to manage tiers/promos).
