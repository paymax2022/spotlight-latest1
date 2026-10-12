# Events Organiser Self-Service — Phase 1 (Edit & Lifecycle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an event organiser edit (within tiered-lock rules), duplicate, pause/resume, and cancel-with-refund their events, behind a feature flag, in the existing `top5events` module.

**Architecture:** Add organiser-management logic in a new `manage.go` inside `backend/internal/top5events` (keeping the large `service.go` untouched), gated by a new `FEATURE_EVENTS_EDIT_LIFECYCLE` flag. Lifecycle changes reuse the existing `transition()` state-machine helper; cancel refunds mirror `SettleVendor`'s proven integer 90/10 escrow split and idempotent ledger legs. One additive migration widens the event-state CHECK and adds the cancel columns + the (phase-4-populated) team-grant table. Contract-first in `contracts/openapi.yaml`; React Native organiser screens consume the new endpoints with writes that refuse fixture mode.

**Tech Stack:** Go 1.27 + Gin, pgx pool, the module's `ledger`/`wallet`/`credential` services, PostgreSQL (Supabase additive migrations), Next.js API proxy (passthrough only), React Native/Expo (`src/features/events`).

**Spec:** `docs/superpowers/specs/2026-10-11-events-organiser-self-service-design.md`

## Global Constraints

- All monetary amounts are **integer kobo**; never floats/strings for math.
- Every money mutation: requires an `Idempotency-Key`, posts **balanced** double-entry, is idempotent on crash-resume (consult `ledger.Posted`, never the error type), emits an audit event.
- Ledger entries are immutable — refunds are **reversing credits**, never edits/UPDATEs of balances.
- Migrations are **additive-only**: no DROP (except widening a CHECK in place), no renames, no type narrowing. Load the `db-migrations` skill before authoring. Re-check the migration version for collisions immediately before merge.
- **Never modify the legacy Spotlight modules**; stay within `top5events`, its routes, contract section, and the events mobile feature.
- Platform fee is **`fee_bps = 1000` (10%)**, recorded per sale; cancel refunds the buyer **90%**, platform keeps **10%**.
- Feature-flag everything: no flag, no merge. Flag name differs per plane — Go `FEATURE_EVENTS_EDIT_LIFECYCLE`, mobile `EXPO_PUBLIC_EVENTS_EDIT_LIFECYCLE`.
- Go request structs use **snake_case** json tags (mobile deep-snakes request bodies).
- Conventional Commits; keep PRs < 400 lines where possible.

## Review Focus

- **Cancel crash-resume / double-refund:** a cancel retried after a partial run (some tickets refunded) must refund each ticket exactly once — consult `ledger.Posted` per ticket, not the error. → Task 6.
- **Cancel over mixed ticket set:** an event with PAID + COMP + already-`REFUNDED` tickets must refund only the live PAID ones (comps/refunded skipped), and leave escrow/ledger balanced. → Task 6.
- **Hard-field edit with tickets sold:** editing `starts_at`/`ends_at` once any ticket exists (non-DRAFT) must be rejected with a clear 409-class error, not a 500 or a silent write. → Task 3.
- **Non-owner management attempt:** a user who is neither organiser nor a qualifying team member calling edit/pause/cancel must get `ErrForbidden` (404/403), never a partial effect. → Task 3 (edit), Task 6 (cancel owner-only).
- **Purchase on a paused event:** once an event is `PAUSED`, a purchase attempt must be refused (no ticket, no debit). → Task 5.

---

## File Structure

- Create `backend/internal/top5events/manage.go` — `editability`, `authorizeManage`, `UpdateEvent`, `DuplicateEvent`, `Pause`, `Resume`, `Cancel`, `cancelRefundOneTicket`.
- Create `backend/internal/top5events/editability_test.go` — pure-logic unit tests.
- Create `backend/internal/top5events/manage_live_db_test.go` — live-DB tests (gated on `TEST_DATABASE_URL`).
- Modify `backend/internal/top5events/service.go` — CreateEvent fee default; `Purchase` LIVE-only guard.
- Modify `backend/internal/top5events/handler.go` — handlers + route registration for the new endpoints.
- Modify `backend/internal/config/config.go` + `backend/.env.example` — `FeatureEventsEditLifecycle`.
- Create `supabase/migrations/<ts>_events_organiser_lifecycle.sql`.
- Modify `contracts/openapi.yaml` — events section: PATCH `/events/{id}`, POST `/events/{id}/duplicate|pause|resume|cancel`.
- Modify `mobile-app/reactnative/src/features/events/{api.ts,types.ts,hooks.ts}` and `constants/events.constants.ts`.
- Modify `mobile-app/reactnative/app/events/organiser/{create.tsx,dashboard.tsx}`.

---

### Task 1: Additive migration (schema)

**Files:**
- Create: `supabase/migrations/<ts>_events_organiser_lifecycle.sql`
- Test: throwaway Postgres assertion (psql), plus the repo's version guard.

**Interfaces:**
- Produces: new event states `PAUSED`/`CANCELLED`; `events.cancelled_at`, `events.cancel_reason`; `events.fee_bps` default `1000`; table `event_team_members(id, event_id, user_id, role CHECK IN ('MANAGER','FINANCE'), granted_by, created_at)` with a unique `(event_id, user_id, role)`.

- [ ] **Step 1: Load the `db-migrations` skill**, then create the migration with a fresh timestamp version greater than the latest in `supabase/migrations/`.
- [ ] **Step 2: Write the migration.** Widen the state CHECK in place: `ALTER TABLE public.events DROP CONSTRAINT <existing state check name>; ALTER TABLE public.events ADD CONSTRAINT events_state_check CHECK (state IN ('DRAFT','SUBMITTED','APPROVED','LIVE','CLOSED','SUSPENDED','PAUSED','CANCELLED'));` (widen-only — every prior value still allowed). Add `cancelled_at timestamptz`, `cancel_reason text` (nullable). `ALTER TABLE public.events ALTER COLUMN fee_bps SET DEFAULT 1000;`. `CREATE TABLE IF NOT EXISTS public.event_team_members (...)` mirroring `event_stewards` (RLS enabled, same grant posture); add `CREATE UNIQUE INDEX ... ON event_team_members (event_id, user_id, role)`.
- [ ] **Step 3: Verify version uniqueness.** Run: `scripts/ci/check-migration-versions.sh` — Expected: passes, version unique.
- [ ] **Step 4: Apply on a throwaway DB and assert.** Spin a throwaway Postgres (never the shared checkout DB), apply the chain, then assert: the state CHECK admits `PAUSED`/`CANCELLED`, `event_team_members` exists, `fee_bps` default is `1000`. Expected: all assertions pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(events): additive migration for organiser lifecycle (states, cancel cols, team grants)"`

### Task 2: `editability` helper (pure logic)

**Files:**
- Create: `backend/internal/top5events/manage.go`
- Test: `backend/internal/top5events/editability_test.go`

**Interfaces:**
- Produces: `type editDecision struct { AllowSoft bool; AllowHardTime bool; Reason string }` and `func editability(state EventState, anyTicketSold bool) editDecision`.

- [ ] **Step 1: Write the failing test** `TestEditability` as a table test covering: `DRAFT` + no sales → soft+hard allowed; `DRAFT` + sold → soft allowed, hard allowed (DRAFT only); `LIVE`/`SUBMITTED`/`APPROVED`/`PAUSED` + no sales → soft+hard allowed; `LIVE` + sold → soft allowed, hard **blocked**; `CLOSED`/`CANCELLED` → nothing allowed.
- [ ] **Step 2: Run to verify it fails** — Run: `go test ./backend/internal/top5events/ -run TestEditability -v` — Expected: FAIL (undefined `editability`).
- [ ] **Step 3: Implement `editability(state EventState, anyTicketSold bool) editDecision`** in `manage.go`. Soft allowed in any non-terminal state; hard-time allowed when `!anyTicketSold`, or when `state == DRAFT`; both false in `CLOSED`/`CANCELLED`. `Reason` set when a field class is blocked.
- [ ] **Step 4: Run to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(events): editability rules for tiered-lock edits"`

### Task 3: `authorizeManage` + `UpdateEvent`

**Files:**
- Modify: `backend/internal/top5events/manage.go`
- Test: `backend/internal/top5events/manage_live_db_test.go`

**Interfaces:**
- Consumes: `editability` (Task 2); `transition`-style FOR UPDATE pattern (see `service.go`).
- Produces:
  - `func (s *Service) authorizeManage(ctx, callerID, eventID string) (isOwner bool, err error)` — true owner if `events.organiser_id == callerID`; else passes (isOwner=false) if an `event_team_members` row exists for `(eventID, callerID, 'MANAGER')`; else `ErrForbidden`; `ErrNotFound` if event missing.
  - `func (s *Service) UpdateEvent(ctx, callerID, eventID string, patch EventPatch) (*Event, error)` where `EventPatch` has optional pointer fields `Title,Description,Venue,Category *string; StartsAt,EndsAt *time.Time` (snake_case json tags).

- [ ] **Step 1: Write failing live-DB tests** in `manage_live_db_test.go` (guard on `TEST_DATABASE_URL`, `t.Cleanup` for pool close): `TestLiveDB_UpdateEvent_SoftFieldsOrganiser` (owner edits description in LIVE → persisted); `TestLiveDB_UpdateEvent_HardTimeLockedAfterSale` (LIVE event with a sold ticket, patch `StartsAt` → `ErrEditLocked`, nothing written); `TestLiveDB_UpdateEvent_ManagerAllowed` (a MANAGER team row edits soft field → ok); `TestLiveDB_UpdateEvent_StrangerForbidden` (random user → `ErrForbidden`).
- [ ] **Step 2: Run to verify they fail** — Run: `TEST_DATABASE_URL=... go test ./backend/internal/top5events/ -run TestLiveDB_UpdateEvent -v` — Expected: FAIL (undefined).
- [ ] **Step 3: Implement `authorizeManage` and `UpdateEvent`.** `UpdateEvent`: `SELECT ... FOR UPDATE` the event, compute `anyTicketSold` (`EXISTS(SELECT 1 FROM event_tickets WHERE event_id=$1)`), call `editability`; reject hard-time patches with a new sentinel `ErrEditLocked` when not allowed; build a dynamic `UPDATE events SET ... , updated_at=now()` over only the provided fields; enforce `starts_at < ends_at`; audit each changed field via `s.log`.
- [ ] **Step 4: Run to verify they pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(events): organiser/manager event edit with tiered lock"`

### Task 4: `DuplicateEvent`

**Files:**
- Modify: `backend/internal/top5events/manage.go`
- Test: `backend/internal/top5events/manage_live_db_test.go`

**Interfaces:**
- Produces: `func (s *Service) DuplicateEvent(ctx, callerID, eventID string) (*Event, error)` — new `DRAFT` event owned by `callerID`, copying title (suffixed " (copy)"), description, venue, category, times, `fee_bps`, and all tiers (reset `sold=0`) and promos (reset `used=0`); **not** tickets/orders/wallets.

- [ ] **Step 1: Write failing live-DB test** `TestLiveDB_DuplicateEvent` — duplicate a LIVE event with 2 tiers + 1 promo and sold tickets → new event is `DRAFT`, owned by caller, has 2 tiers (`sold=0`) and 1 promo (`used=0`), zero tickets.
- [ ] **Step 2: Run to verify it fails** — Expected: FAIL.
- [ ] **Step 3: Implement `DuplicateEvent`** in one transaction: insert new event (writing both `organizer_id` and `organiser_id`, as CreateEvent does), copy tiers and promos. Any authenticated caller may duplicate any discoverable event into their own draft (mirrors CreateEvent's authz — no owner check); audit `events.duplicate`.
- [ ] **Step 4: Run to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(events): duplicate event into a fresh draft"`

### Task 5: `Pause`/`Resume` + purchase guard

**Files:**
- Modify: `backend/internal/top5events/manage.go`, `backend/internal/top5events/service.go` (Purchase)
- Test: `backend/internal/top5events/manage_live_db_test.go`

**Interfaces:**
- Consumes: `transition(ctx, eventID, from, to EventState, ownerCheck *string, action string)`.
- Produces: `func (s *Service) Pause(ctx, callerID, eventID string) error` (LIVE→PAUSED); `func (s *Service) Resume(ctx, callerID, eventID string) error` (PAUSED→LIVE). Both allow owner or MANAGER via `authorizeManage` (resolve caller, then call `transition` with the organiser as ownerCheck=nil and do the manage-auth check first).

- [ ] **Step 1: Write failing live-DB tests** `TestLiveDB_PauseBlocksPurchase` (pause a LIVE event, then `Purchase` → rejected with `ErrNotPurchasable`, no order/debit) and `TestLiveDB_ResumeRestoresPurchase` (resume → purchase succeeds).
- [ ] **Step 2: Run to verify they fail** — Expected: FAIL.
- [ ] **Step 3: Implement `Pause`/`Resume`** (authorizeManage, then transition). In `Purchase`, after loading the event, reject when `state != LIVE` with a new sentinel `ErrNotPurchasable` (add the check before reserving the order; keep existing idempotent-replay behaviour intact).
- [ ] **Step 4: Run to verify they pass**, and run the full module tests to confirm no regression — Run: `go test ./backend/internal/top5events/ -count=1` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(events): organiser pause/resume; block purchase when not live"`

### Task 6: `Cancel` + refund (money path — ledger-auditor gated)

**Files:**
- Modify: `backend/internal/top5events/manage.go`, `backend/internal/top5events/service.go` (CreateEvent fee default), `backend/internal/top5events/reconciler.go` (resume stragglers)
- Test: `backend/internal/top5events/manage_live_db_test.go`

**Interfaces:**
- Consumes: `s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)`, `s.led.Credit(...)` + `alreadyApplied`, the escrow→revenue fee-leg posting, and `s.cred.Revoke(ctx, credentialID)` — all exactly as `SettleVendor` (service.go ~1139–1210) uses them.
- Produces: `func (s *Service) Cancel(ctx, ownerID, eventID, reason, idemKey string) error` (**owner-only** — not delegated to MANAGER); `func (s *Service) cancelRefundOneTicket(ctx, ev *Event, t ticketRow, idemKey string) error`.

- [ ] **Step 1: Write failing live-DB tests** (money invariants):
  - `TestLiveDB_CancelRefunds90_10` — LIVE event, `fee_bps=1000`, one ticket at payable `P=100000`: after cancel, buyer main wallet credited `90000`, platform revenue `10000`, escrow net zero for that ticket; ticket `REFUNDED`, order `REFUNDED`, credential revoked; event `CANCELLED`, `cancelled_at`/`cancel_reason` set.
  - `TestLiveDB_CancelIdempotentResume` — run cancel twice with the same `idemKey`; buyer credited once (assert ledger has one `cancel:<e>:<t>` posting).
  - `TestLiveDB_CancelMixedTickets` — PAID + COMP + pre-`REFUNDED` tickets: only the live PAID ticket moves money; comps just flip `REFUNDED`, no ledger leg.
  - `TestLiveDB_CancelManagerForbidden` — a MANAGER (non-owner) → `ErrForbidden`.
  - `TestLiveDB_CreateEventDefaultsFee1000` — a freshly created event has `fee_bps == 1000`.
- [ ] **Step 2: Run to verify they fail** — Expected: FAIL.
- [ ] **Step 3: Implement.** In `CreateEvent`, when `e.FeeBps <= 0` set `e.FeeBps = 1000` before insert. `Cancel`: verify `ownerID == events.organiser_id` (else `ErrForbidden`); reject if state already `CLOSED`/`CANCELLED`; set `CANCELLED` + `cancelled_at`/`cancel_reason`; then iterate live tickets and call `cancelRefundOneTicket`, idempotent per ticket (`idemKey + ":" + ticketID`), consulting `ledger.Posted` on error rather than trusting the error type. Per PAID ticket with payable `P`: `fee = P*int64(ev.FeeBps)/10000`, `refund = P - fee`; `led.Credit(buyer, "evt-cancel-refund:"+ticketID, idemKey+":"+ticketID+":refund", escrow.ID, refund)`; post fee escrow→revenue (`...:fee`) mirroring SettleVendor; `ticket→REFUNDED`, `order→REFUNDED`, `cred.Revoke`. COMP/already-REFUNDED tickets: flip state + revoke only, no money. Extend `reconciler.go` so a `CANCELLED` event with unrefunded live tickets is re-driven (same idem keys) to completion.
- [ ] **Step 4: Run to verify they pass**; run `cd frontend-web && npm run test:money` and the module suite — Expected: PASS.
- [ ] **Step 5: Request `ledger-auditor` review** of the cancel/refund path before committing; address findings.
- [ ] **Step 6: Commit** — `git commit -m "feat(events): cancel event with 90/10 buyer refund (reversing, idempotent)"`

### Task 7: Handlers, routes, feature flag

**Files:**
- Modify: `backend/internal/top5events/handler.go`, `backend/internal/app/top5_routes.go`, `backend/internal/config/config.go`, `backend/.env.example`
- Test: `backend/internal/top5events/manage_live_db_test.go` (handler-level) or a throwaway-server curl check.

**Interfaces:**
- Consumes: Tasks 3–6 service methods; existing `Register(member, admin, guard)` wiring and `RequireAuthContext`/idempotency middleware.
- Produces: routes under the member group — `PATCH /events/:id`, `POST /events/:id/duplicate`, `POST /events/:id/pause`, `POST /events/:id/resume`, `POST /events/:id/cancel` — registered **only when** `cfg.FeatureEventsEditLifecycle`.

- [ ] **Step 1: Add `FeatureEventsEditLifecycle bool`** to config (env `FEATURE_EVENTS_EDIT_LIFECYCLE`, default false) and document it in `.env.example`.
- [ ] **Step 2: Write a failing handler/integration check** — with the flag ON, `PATCH /events/:id` by the owner returns 200 and persists; cancel without an `Idempotency-Key` returns 400; cancel by a non-owner returns 403. (Flag OFF → routes 404.)
- [ ] **Step 3: Run to verify it fails** — Expected: FAIL (routes unregistered).
- [ ] **Step 4: Implement handlers** (bind snake_case bodies, map `ErrEditLocked`→409, `ErrForbidden`→403, `ErrNotFound`→404, `ErrNotPurchasable`→409; require `Idempotency-Key` on cancel) and register the routes behind the flag in `RegisterEvents`.
- [ ] **Step 5: Run to verify it passes**; `go vet ./... && go build ./...` — Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(events): organiser lifecycle routes behind FEATURE_EVENTS_EDIT_LIFECYCLE"`

### Task 8: OpenAPI contract

**Files:**
- Modify: `contracts/openapi.yaml` (events section)

- [ ] **Step 1: Add paths** `PATCH /events/{id}` (EventPatch body, 200/409/403/404), `POST /events/{id}/duplicate` (201 EventSummary), `POST /events/{id}/pause`, `POST /events/{id}/resume` (200), `POST /events/{id}/cancel` (requires `Idempotency-Key` header, body `{reason}`, 202/400/403), plus the `EventPatch` schema and the `PAUSED`/`CANCELLED` state enum values.
- [ ] **Step 2: Validate** — Run: `cd frontend-web && npm run contract:check` — Expected: PASS (syntax + openapi/paths present).
- [ ] **Step 3: Commit** — `git commit -m "docs(contract): events organiser lifecycle endpoints"`

### Task 9: Mobile API client, types, hooks

**Files:**
- Modify: `mobile-app/reactnative/src/features/events/{api.ts,types.ts,hooks.ts}`, `constants/events.constants.ts`

**Interfaces:**
- Produces: `updateEvent(id, patch)`, `duplicateEvent(id)`, `pauseEvent(id)`, `resumeEvent(id)`, `cancelEvent(id, reason, idemKey)` in `api.ts`; matching types; react-query mutation hooks `useUpdateEvent/useDuplicateEvent/usePauseEvent/useResumeEvent/useCancelEvent`.

- [ ] **Step 1: Add an `EXPO_PUBLIC_EVENTS_EDIT_LIFECYCLE` gate** and make the five new client functions **throw `notInFixtureMode(...)`** when events mock mode is on (the #698 pattern — writes never fake success).
- [ ] **Step 2: Implement the api functions** against `/api/finance/events/*` (cancel sends an `Idempotency-Key`), the request/response types, and the react-query hooks (invalidate the organiser dashboard + event queries on success).
- [ ] **Step 3: Verify types** — Run: `cd mobile-app/reactnative && npx tsc --noEmit` (with `--stack-size=10000` if it crashes clean) — Expected: 0 errors.
- [ ] **Step 4: Commit** — `git commit -m "feat(events-mobile): lifecycle api client + hooks (writes refuse fixture mode)"`

### Task 10: Mobile organiser screens

**Files:**
- Modify: `mobile-app/reactnative/app/events/organiser/create.tsx` (dual-mode), `dashboard.tsx` (actions + cancel modal)

- [ ] **Step 1: Make `create.tsx` dual-mode** — accept an optional `id` param; when present, prefill from the event and submit via `useUpdateEvent`, disabling hard-time fields when the event has sold tickets (reflect the lock from the loaded event).
- [ ] **Step 2: Add dashboard row actions** — Edit (→ create in edit mode), Duplicate (`useDuplicateEvent` → navigate to the new draft), Pause/Resume (toggle by state via the realtime-updated event), and Cancel behind a confirm modal showing the refund impact ("N tickets · ₦X refunded at 90%"), calling `useCancelEvent` with a fresh idempotency key.
- [ ] **Step 3: Verify types** — Run: `cd mobile-app/reactnative && npx tsc --noEmit` — Expected: 0 errors. (Mobile preview is unreliable in this worktree; verify by tsc + code review against the existing organiser screens, not a live preview.)
- [ ] **Step 4: Commit** — `git commit -m "feat(events-mobile): organiser edit/duplicate/pause/cancel on dashboard"`

---

## Notes / deliberate scoping

- **No buyer-notification machinery in Phase 1.** Under the tiered lock, an accepted `starts_at`/`ends_at` change implies no tickets are sold (DRAFT only), so there are no buyers to notify. Push/email to attendees arrives as the Phase 3 announcement feature.
- **`event_team_members` is created here but populated in Phase 4.** `authorizeManage` already reads it, so MANAGER edits/pauses work the moment a Phase-4 grant exists; until then every manage action is owner-only in practice.
- **Tier/promo editing, sales windows, min/max, invite-only** are Phase 2 — Phase 1's `Purchase` change is limited to the `LIVE`-only guard that makes pause meaningful.
- **Organiser payout of the 90%** is the deferred settlement slice; Phase 1 only records `fee_bps=1000` and keeps the 10% on cancel.
