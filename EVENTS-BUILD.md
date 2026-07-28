# EVENTS-BUILD.md
### Build/reconciliation record for Claude Code — Events & Cashless Ticketing vertical

> **Purpose.** This file records the reconciliation and wiring pass that made the Events &
> Cashless Ticketing vertical a single, coherent, correctly-routed system. Read this with the
> repo's root `CLAUDE.md` (architecture + `NL` invariants) and `PAYMAX_BUILD_PLAYBOOK.md` Block 18
> (original Events & ticketing spec). Durable per-vertical progress tracker:
> `mobile-app/reactnative/EVENTS_TASK_TRACKER.json` (the root `task-tracker.json` is contended
> across concurrent sessions and gets overwritten — this file and the tracker JSON are the durable
> record).

---

## 0. How this file should be used

1. Read root `CLAUDE.md` first (Gin router, ledger-money rules, brownfield safety, migration
   rules, feature-flag rule).
2. This is **not** a greenfield build spec — it documents a reconciliation of two pre-existing,
   colliding backend implementations into one canonical, wired system, plus the mobile rewiring
   needed to consume it for real.
3. Feature flag: `FEATURE_EVENTS_ENABLED` (default off). Nothing here ships live until the flag is
   flipped in a real environment (see Open Items).
4. Brownfield rule applied: the legacy `backend/internal/events` package was **not deleted or
   edited** — only its router registration was removed. The package itself is left in place per
   the brownfield/no-orphan-deletion convention.

---

## 1. What was found (audit findings, pre-existing state)

Two independent backend implementations of "Events" existed side by side:

- **`backend/internal/events`** — a legacy, simple ticketing CMS (create event, buy ticket, scan
  ticket at the door). This is the implementation originally described in
  `PAYMAX_BUILD_PLAYBOOK.md` Block 18.
- **`backend/internal/top5events`** — the Top-5 Phase-2 build's cashless-wallet ticketing system:
  event lifecycle + ticket lifecycle + a closed-loop **event wallet** (top-up, vendor
  charge/POS-lite, residual-refund on close), organiser tooling, and a steward/scan flow. This is
  the richer, more recently built implementation (see
  `mobile-app/reactnative/TOP5_TASK_TRACKER.json`, phase `p2`).

Both packages defined overlapping database tables (`events`, `event_tickets`) and both were
reachable from route registration, which produced a route/schema collision: two different Go
types backed by two different column sets could both claim the same table names and the same URL
namespace depending on registration order.

---

## 2. Resolution — top5events is now canonical

**Decision:** `top5events` is the sole, canonical, wired implementation of the Events vertical
going forward.

- The legacy `internal/events` package's **router wiring was removed** — it is no longer
  reachable from any HTTP route. The package's source files are untouched and remain in the tree
  (brownfield rule: no deletion of existing modules; adapters/de-registration only).
- All new work (routes, migrations, mobile wiring, tests — see below) targets `top5events`
  exclusively.
- `PAYMAX_BUILD_PLAYBOOK.md`'s Block 18 table row has been annotated to reflect this (see
  "Playbook update" below); Block 18's original text describing `internal/events/service.go`
  is now historical/superseded, not the live implementation.

---

## 3. Route-path fix

**Bug:** a double `/events/events` path segment existed in the route registration, meaning the
intended member-facing surface was not reachable at the documented path.

**Fix:** route registration corrected so the real, live API surface is:

- **Member:** `/api/finance/events/...` (discovery/list, event detail, ticket purchase, wallet
  top-up/spend/close, steward scan)
- **Admin:** `/api/events/admin/...` (approve, suspend, settle)

This matches the existing per-module convention used by the other Top-5 modules (member routes
under `/api/finance/<module>`, admin routes under `/api/<module>/admin`, each gated by its own
feature flag via the shared `adminGroupTop5` helper — see
`backend/internal/app/top5_p2_routes.go`).

---

## 4. New endpoint — discovery/list

**Gap found:** there was no `GET /api/finance/events` endpoint — i.e. no way to list/discover
events at all. The mobile discovery screen's category-chip filter (All / Music / Tech / Sports /
Comedy / Faith) had nothing to call.

**Fix:** added `GET /api/finance/events`, supporting:
- `category` filter (matching the mobile chip set)
- `state` filter (event lifecycle state)

This is now the entry point for the mobile discovery screen and is wired behind
`FEATURE_EVENTS_ENABLED`.

---

## 5. Schema-drift migration reconciliation

**Bug found:** two separate migrations each did `CREATE TABLE IF NOT EXISTS events` /
`CREATE TABLE IF NOT EXISTS event_tickets`, with **different, incompatible column sets**. Because
of `IF NOT EXISTS`, the second migration silently no-op'd instead of erroring — so whichever
migration ran first "won," and the columns the other implementation expected were simply absent
at runtime.

**Fix:** an additive reconciliation migration was written. It does **not** drop or rename
anything; it only adds the missing columns, with backfill from the legacy columns where an
equivalent existed:

- `events` gains: `organiser_id`, `venue`, `state`, `fee_bps`, `category`
- `event_tickets` gains: `tier_id`, `order_id`, `state`, `credential_id`

This follows the repo's additive-only migration rule (`CLAUDE.md` brownfield safety: no DROP, no
renames, no type narrowing).

---

## 6. Mobile app rewiring

The mobile app's Events feature already had all 17 screens built (discovery, detail, checkout ×3,
organiser ×3, wallet ×4, steward scan) but was defaulting to mock data. This pass:

- Flipped the default from mock to calling the real API (`EXPO_PUBLIC_EVENTS_USE_MOCK` semantics
  now match the other Top-5 modules' convention).
- Remapped field names used by the mobile client to match the backend's actual field names:
  `organiser_id`, `state`, `venue`, `fee_bps`, `tier_id`, `credential_id`.

Relevant mobile paths: `mobile-app/reactnative/src/features/events/`,
`mobile-app/reactnative/src/features/mobility/api/event.api.ts`.

---

## 7. Feature flag

`FEATURE_EVENTS_ENABLED` (Go env var, default **off**) now gates the single, reconciled,
non-colliding `top5events` implementation end-to-end (member routes, admin routes, discovery
endpoint). No flag flip has been performed in any real environment as part of this pass — see
Open Items.

---

## 8. Test coverage added

New Go tests were added covering:
- **State machines:** event lifecycle, ticket lifecycle, event-wallet lifecycle (top-up → vendor
  charge → close/residual-refund).
- **Idempotency:** ticket purchase, wallet top-up, vendor-charge — all keyed on
  `Idempotency-Key` per the root `CLAUDE.md` money-handling rule.
- **Object-level authZ:** e.g. one member cannot read/act on another member's ticket or wallet.

---

## 9. Open items (not resolved by this pass)

- [ ] **OpenAPI contract review.** `contracts/openapi.yaml`'s Events section (around line ~6142)
  was rewritten as part of this pass. **Status at time of writing: still the old 2-operation stub**
  (`POST /events`, `POST /events/{id}/tickets` only) — it does **not** yet reflect the
  `top5events` surface (discovery/list, wallet top-up/spend/close, organiser/admin
  approve-suspend-settle, steward scan). Treat the rewritten contract as **in progress, not
  landed** as of this writing; re-check `contracts/openapi.yaml` before relying on it as the
  source of truth, and get it reviewed/signed off once it lands, per `CLAUDE.md`'s
  "API changes start in `contracts/openapi.yaml`" workflow rule.
- [ ] **No `ledger-auditor` subagent exists yet.** `CLAUDE.md` §Workflow says money-path work
  requires sign-off from a `ledger-auditor` subagent (and auth/PII work from a
  `security-reviewer` subagent) before being marked complete. As of this writing, only
  `.claude/agents/test-engineer.md` and `.claude/agents/brownfield-guardian.md` exist in this
  repo — there is no `ledger-auditor` or `security-reviewer` agent definition. This is a **process
  gap, not a code gap**: the Events wallet/ticket money-path changes in this pass have not had a
  dedicated ledger-auditor review pass, because that agent does not exist yet. This gap is not
  papered over here — it is called out so a human (or a future agent once defined) closes it
  before go-live.
- [ ] **Live-DB verification.** The reconciliation migration has not been applied against a real
  Supabase connection in this pass; it needs to be applied to a live/staging DB and the backfill
  spot-checked for data loss before it is trusted in production.
- [ ] **Go-live flag flip.** `FEATURE_EVENTS_ENABLED` and `EXPO_PUBLIC_EVENTS_USE_MOCK=false` are
  not flipped in any real environment yet — this is a deliberate go/no-go decision, not an
  oversight.

---

## 10. Acceptance criteria (this pass)

- [x] Only one Events implementation (`top5events`) is reachable from HTTP routing; legacy
  `internal/events` router wiring removed, package left in place.
- [x] Member surface reachable at `/api/finance/events/...`; admin surface at
  `/api/events/admin/...`; no `/events/events` double segment.
- [x] `GET /api/finance/events` exists and supports `category` + `state` filters.
- [x] `events` and `event_tickets` tables carry the full column set both implementations expect,
  via additive migration only (no drops, no renames).
- [x] Mobile Events feature (17 screens) calls the real API by default, with field names matching
  the backend.
- [x] `FEATURE_EVENTS_ENABLED` gates the entire reconciled surface.
- [x] Go tests cover event/ticket/wallet state machines, purchase/topup/vendor-charge idempotency,
  and object-level authZ.
- [ ] OpenAPI contract review-signed-off (open — see §9).
- [ ] Ledger-auditor sign-off (open — no such subagent exists yet, see §9).
- [ ] Live-DB migration verification (open — see §9).

---
*Companion files:* root `CLAUDE.md` (base architecture + `NL` invariants),
`PAYMAX_BUILD_PLAYBOOK.md` Block 18 (original Events & ticketing spec, now superseded by
`top5events`), `docs/estate/BUILD-PLAN.md`-style companion for Top-5 (see
`mobile-app/reactnative/TOP5_TASK_TRACKER.json`), and
`mobile-app/reactnative/EVENTS_TASK_TRACKER.json` (durable per-vertical progress tracker for this
document).
