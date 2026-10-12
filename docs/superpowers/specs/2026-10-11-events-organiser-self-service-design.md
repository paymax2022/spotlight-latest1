# Events — Organiser Self-Service (design)

**Date:** 2026-10-11
**Module:** `backend/internal/top5events` (the existing "Top-5 Phase 2" events module)
**Status:** Design approved in brainstorming; pending spec review → implementation plan.

## 1. Purpose & context

The Events/Ticketing module already exists and is end-to-end: event lifecycle
(DRAFT→SUBMITTED→APPROVED→LIVE→CLOSED/SUSPENDED), ticket tiers, wallet-funded
purchase into escrow, rotating-QR credentials, steward-gated check-in/scan, a
closed-loop cashless event wallet, vendor tap-charge + vendor settlement, an
organiser read dashboard, an admin console (read side), and a React Native
organiser/attendee app.

What it **lacks** is organiser *self-service management*. Today an organiser can
create an event and add tiers/promos, but cannot **edit** it (no `UpdateEvent`
exists at all), **duplicate** it, **pause/resume** it, or **cancel** it with
refunds; tiers have no sales windows or per-order limits; promos are
event-wide/percent-only; there is no way to issue **comp/guest** tickets; and
the only delegated role is the scan-only steward.

This spec closes those gaps as the **organiser self-service** slice of the
larger Events program. It is brownfield gap-closing, not a rebuild.

Reference reconnaissance (build-vs-gap map) and the broader program
decomposition live in the brainstorming thread that produced this spec.

### Scope (this spec)

Four capability groups, delivered as four phased, flag-gated PRs:

1. **Edit & lifecycle** — edit (tiered-lock rules), duplicate, pause/resume,
   cancel-with-refund.
2. **Ticketing depth** — tier edit + sales windows + min/max per order +
   invite-only; richer/per-tier promos.
3. **Comp & attendees** — comp/guest ticket issuance, attendee CSV export,
   organiser→attendee announcements.
4. **Team roles** — per-event event-manager and finance roles.

Surfaces: **Go backend + the events section of `contracts/openapi.yaml` + the
React Native organiser screens.** No web organiser UI in this slice.

### Out of scope (each its own future slice)

Seating/seat maps, waitlists, virtual/hybrid events, consumer **web** pages,
admin moderation/fraud backends, vue-quasar parity, Apple/Google Wallet passes,
offline check-in, SMS (push + email only). Also **not** touched here: the 13
other `adminGroupTop5` call sites that share a known `RequireAuthContext` auth
bug (separate follow-up).

### Depends on (not built here)

The organiser **payout** settlement path (paying the organiser their 90%). This
spec *records* the platform fee on each sale (`fee_bps = 1000`, i.e. 10%) so the
economics are captured from day one, but the actual organiser payout is the
deferred "Platform-admin + settlement" slice. Until then, ticket escrow
accumulates and is not paid out to organisers.

## 2. Key decisions (locked in brainstorming)

| Decision | Choice |
|---|---|
| Edit rules | **Tiered lock**: soft fields editable in any non-terminal state; hard fields (times, tier price) lock once tickets are sold. |
| Comp tickets | **Zero-value issuance**: no wallet debit, no ledger entry; real QR credential; capacity consumed; counted separately from gross sales. |
| Platform fee | **10%** (`fee_bps` default `1000`), recorded per sale. Organiser nets 90% (payout in later slice). |
| Event cancel | Buyer refunded **90%**; platform keeps **10%** as revenue via a balanced ledger split. |
| Surfaces | Backend + contract + React Native. |
| Team authz | **Per-event object-level grants** mirroring `event_stewards`; no global RBAC. |

## 3. Data model (additive-only)

All money is **bigint kobo**. No drops, no renames, no type narrowing. Columns
and tables are split across the four phases' migrations so each PR is
self-contained. Migration versions are chosen at author time and
**re-checked immediately before merge** (stamp-collision rule); the
`db-migrations` skill is loaded before authoring any migration.

### Phase 1 — Edit & lifecycle
- `events.state` CHECK **widened** (widen-only, via drop+add broader CHECK in
  one migration) to add `PAUSED` and `CANCELLED` — organiser-driven states,
  distinct from admin `SUSPENDED` and the natural `CLOSED`.
- `events.cancelled_at timestamptz NULL`, `events.cancel_reason text NULL`.
  (`events.updated_at` already exists; edits emit existing audit events rather
  than a new table.)
- New `event_team_members (id, event_id, user_id, role text CHECK (role IN
  ('MANAGER','FINANCE')), granted_by, created_at)` created **now** so the
  `authorizeManage` helper is stable from phase 1 (table stays empty until the
  phase-4 endpoints populate it). Mirrors `event_stewards`.

### Phase 2 — Ticketing depth
- `event_ticket_tiers`: `sales_start_at timestamptz NULL`,
  `sales_end_at timestamptz NULL` (NULL = no window);
  `min_per_order int NOT NULL DEFAULT 1`,
  `max_per_order int NOT NULL DEFAULT 0` (0 = unlimited);
  `description text NOT NULL DEFAULT ''`;
  `invite_only boolean NOT NULL DEFAULT false`.
- `event_promo_codes`: `tier_id uuid NULL REFERENCES event_ticket_tiers`
  (NULL = whole event, preserves current behaviour);
  `amount_off_kobo bigint NULL CHECK (amount_off_kobo >= 0)` (fixed-amount
  alternative to `percent_off`; exactly one of the two is set);
  `starts_at`/`ends_at timestamptz NULL` (validity window);
  `per_user_limit int NOT NULL DEFAULT 0` (0 = unlimited).
- New `event_promo_redemptions (id, promo_id, user_id, order_id, created_at)` to
  enforce the per-user cap.

### Phase 3 — Comp & attendees
- `event_orders.kind text NOT NULL DEFAULT 'PAID' CHECK (kind IN ('PAID','COMP'))`;
  comp orders are `total_kobo = 0`.
- `event_tickets.kind text NOT NULL DEFAULT 'PAID'`,
  `event_tickets.issued_by uuid NULL`, `event_tickets.comp_note text NULL`.
  Comp tickets are `price_paid_kobo = 0`, state `ISSUED`, with a real credential.
- New `event_announcements (id, event_id, sender_id, channel, subject, body,
  recipient_count, created_at)` — history + idempotency for organiser→attendee
  messages.

### Phase 4 — Team roles
- No new tables (the grant table is created in phase 1). Phase 4 adds the
  endpoints that populate `event_team_members`.

## 4. API surface

New endpoints hang off the existing member base `/api/finance/events/*`; the
admin base `/api/events/admin/*` is untouched. Every path is added to the events
section of `contracts/openapi.yaml` **spec-first**, before implementation. Go
request structs use **snake_case json tags** (the mobile client deep-snakes
request bodies; camelCase tags would never bind — the bidirectional
case-transform trap).

### Phase 1
- `PATCH /events/:id` — partial edit, enforces tiered lock (§6). Time changes
  (allowed only before any sale; see §6) emit a buyer notification + audit event.
- `POST /events/:id/duplicate` — clones event + tiers + promos (not
  tickets/orders) into a fresh `DRAFT` owned by the caller.
- `POST /events/:id/pause` (LIVE→PAUSED) / `POST /events/:id/resume`
  (PAUSED→LIVE). Pause blocks new purchases.
- `POST /events/:id/cancel` — any pre-`CLOSED` state → `CANCELLED`; drives the
  refund loop (§5). **Requires `Idempotency-Key`.**

### Phase 2
- `PATCH /events/:id/tiers/:tierId` — name/description/active, price (locked if
  sold), capacity (≥ sold), sales window, min/max per order, invite_only.
- `PATCH /events/:id/promos/:promoId` + extended create body (tier scope,
  `amount_off_kobo`, validity window, per-user cap).
- `Purchase` modified (no new route) to enforce sales windows, min/max per
  order, per-user promo cap, invite-only block, and `LIVE`-only (so `PAUSED`
  blocks buys).

### Phase 3
- `POST /events/:id/comps` — `{tier_id, recipients[], note}`: issues comp
  ticket(s) (§5). **Requires `Idempotency-Key`** (prevents duplicate issuance
  even though free).
- `GET /events/:id/attendees?format=csv` — export (extends existing attendees
  read).
- `POST /events/:id/announcements` — push + email to ticket holders;
  rate-limited, audit-logged, recorded in `event_announcements`.

### Phase 4
- `POST /events/:id/team` `{user_handle, role}`, `GET /events/:id/team`,
  `DELETE /events/:id/team/:userId` — mirrors the steward endpoints.

### Authorization matrix

Object-level, via a new `authorizeManage(callerID, eventID)` helper
= organiser (owner) OR a qualifying `event_team_members` row.

| Action | Organiser | MANAGER | FINANCE | Steward | Admin |
|---|---|---|---|---|---|
| Edit / tiers / promos / duplicate / pause-resume | ✓ | ✓ | — | — | — |
| **Cancel + refunds** | ✓ | — | — | — | — |
| Issue comps | ✓ | ✓ | — | — | — |
| Attendee export / announcements | ✓ | ✓ | read-only export | — | — |
| View settlement / payouts | ✓ | — | ✓ | — | ✓ |
| Grant/revoke team & stewards | ✓ | — | — | — | — |
| Scan tickets | ✓ | ✓ | — | ✓ | — |
| Approve / suspend / settle | — | — | — | — | ✓ |

The two highest-trust actions — **cancel-with-refunds** and **granting team
access** — are owner-only, never delegated.

## 5. Money paths (governed by the iron ledger rules)

Background: at purchase, `wal.Debit` moves the full **payable** (price − promo)
from the buyer's **main wallet** into a standing **escrow** account; the
platform fee is not taken at purchase. Escrow holds the whole amount until
settlement.

### Comp issuance (zero-value, no ledger)
Create a `kind=COMP` order at `total_kobo = 0` (status `PAID` directly, no
debit), issue a `kind=COMP` ticket at `price_paid_kobo = 0` with a real QR
credential, bump `sold`. **No `wal.Debit`, no ledger entry, no commission/earning
row.** Idempotent on a per-issuance key. Satisfies "no money moved → no posting."
Invite-only tiers can be filled this way. Comps are counted separately so they
never inflate gross sales.

### Cancel + refund (reversing entries only, 90/10 split)
On `cancel`: set event `CANCELLED` first, then drive refunds idempotently
(resumable — the pending-order reconciler pattern is extended to cover
cancellations). For each PAID, non-refunded, **non-comp** ticket with payable `P`:
- `fee = P * fee_bps / 10000` (integer floor); `refund = P - fee` (the
  remainder, so `refund + fee == P` exactly — no rounding leak).
- Credit `refund` to the **order's `buyer_id`** main wallet from escrow via a
  **reversing** ledger entry (ledger is immutable; corrections are reversals,
  never edits), keyed per-ticket (`cancel:<eventID>:<ticketID>`).
- Move `fee` from escrow → platform revenue (balanced leg).
- Retry safety consults `ledger.Posted(...)`, **not** the error type (the
  debit-retry hazard: a `Debit`/post error does not prove nothing posted).
- Ticket → `REFUNDED`, order → `REFUNDED`, credential revoked.

Comp tickets on a cancelled event: just `REFUNDED` + credential revoked; no money.

Refund targets **whoever paid** (the order's `buyer_id`), not a later gift
recipient.

## 6. Edit-lock + validation rules

Centralised in one `editability(event, hasSoldTickets)` helper so every edit
path and the contract agree.

**Event edits (`PATCH /events/:id`)**
- Blocked entirely in `CLOSED` and `CANCELLED`.
- Soft fields — `title`, `description`, `venue`, `category` — editable in
  `DRAFT`/`SUBMITTED`/`APPROVED`/`LIVE`/`PAUSED`.
- Hard fields — `starts_at`, `ends_at` — editable freely while **no ticket is
  sold**; once any ticket (paid or comp) exists they lock, and a time change is
  accepted **only** in `DRAFT` (no buyers by definition); otherwise rejected
  with a clear "cancel instead" error. Any accepted time change emits a buyer
  notification + audit event.
- `starts_at < ends_at` always; a time edit never moves start into the past when
  tickets are sold.

**Tier edits (`PATCH .../tiers/:tierId`)**
- `price_kobo`: editable only while that tier's `sold == 0`; locked after first
  sale.
- `capacity`: may rise anytime; may fall only to `>= sold`.
- `name`, `description`, `active`, `sales_start_at`, `sales_end_at`,
  `min_per_order`, `max_per_order`, `invite_only`: editable while the event is
  non-terminal. `active=false` stops new sales but keeps issued tickets valid.
- Validation: `min_per_order >= 1`; `max_per_order == 0 || max_per_order >=
  min_per_order`; `sales_start_at < sales_end_at` when both set.

**Promo edits** — code/scope/value editable while `used == 0`; after first use,
only `active` (deactivate) and raising `max_uses` are allowed. Exactly one of
`percent_off` / `amount_off_kobo` is set.

**Purchase-time enforcement** (modifies existing `Purchase`): reject if tier
inactive, outside `[sales_start_at, sales_end_at]`, event not `LIVE`, quantity
outside `[min,max]_per_order`, promo outside its window or over `per_user_limit`,
or tier is `invite_only`.

## 7. Mobile (React Native)

Builds on `app/events/organiser/{create,dashboard,attendees}` and
`src/features/events/{api,types,hooks,components}`.

- **Phase 1** — make `organiser/create.tsx` dual-mode (create + edit); dashboard
  row actions **Edit / Duplicate / Pause-Resume / Cancel** (cancel behind a
  confirm modal showing refund impact: "N tickets, ₦X refunded at 90%"). New
  states reflect live via the existing `useEventsRealtime` SSE channel.
- **Phase 2** — `organiser/tiers/[id].tsx` (price-lock indicator when sold,
  windows, min/max, invite-only) and `organiser/promos/[id].tsx`.
- **Phase 3** — `organiser/comps/[id].tsx`; `attendees.tsx` gains **Export**
  (share-sheet CSV) and an **Announcement** composer.
- **Phase 4** — `organiser/team/[id].tsx`, mirroring the steward-management
  screen.

Each phase adds matching functions in `api.ts`, types in `types.ts`, and
react-query hooks in `hooks.ts`.

**Mobile guardrails (repo lessons):**
- Events default to **mock ON** (`EXPO_PUBLIC_EVENT_USE_MOCK` default true). New
  organiser **writes** (edit, cancel, comp, team) must **throw in fixture mode**,
  never fake success (the #698 election pattern). Reads may keep a mock fallback.
  Live verification runs with the flag set false on staging.
- Go request structs use snake_case json tags (case-transform trap).
- This worktree's mobile browser-preview is known-unreliable; verify mobile via
  `tsc --noEmit` + code review against proven screens, not a live preview chase.

## 8. Testing & delivery

**Testing discipline (repo rules):**
- Money-path code (cancel/refund, comp issuance, fee split) gets **failing tests
  first** (delegate to `test-engineer`), then implement to green. Live-DB Go
  tests gated on `TEST_DATABASE_URL`; `t.Cleanup` for pool close.
- Before any money-path PR is marked done, request **`ledger-auditor`** review
  (the 90/10 reversing split and zero-value comps). Request
  **`security-reviewer`** on the authz changes.
- `npm run test:regression` (golden path) and `npm run test:money` stay green
  before and after each PR; `contract:check` must pass.

**Phasing — four flag-gated PRs**, spec-first each
(contract slice → that phase's additive migration → backend → mobile → tests).
Flags are defined for **both** planes (backend `FEATURE_*`, mobile
`EXPO_PUBLIC_*` — the two planes read different var names):

1. `FEATURE_EVENTS_EDIT_LIFECYCLE` — edit, duplicate, pause/resume, cancel+refund;
   creates `event_team_members` + `authorizeManage`; state-CHECK widening.
   ADR for the 90/10 cancel split.
2. `FEATURE_EVENTS_TICKETING_DEPTH` — tier edit + windows + min/max + invite_only;
   richer/per-tier promos + redemptions table.
3. `FEATURE_EVENTS_COMPS` — comp issuance (ADR for zero-value issuance), attendee
   CSV export, announcements. **Depends on phase 2's `invite_only` column.**
4. `FEATURE_EVENTS_TEAM_ROLES` — team endpoints + mobile screen that populate the
   phase-1 table.

Order: 1 → 2 → 3 → 4. ADR files named `ADR-PR<pr-number>-<slug>.md`, cited as
`ADR-PR<pr-number>`; the real number is assigned on merge (never hand-picked).

## 9. Success criteria

On staging in live mode:
- An organiser can edit (within lock rules), duplicate, pause/resume, and
  cancel-with-90%-refund an event end to end.
- Tier sale windows / min-max / invite-only are enforced at purchase.
- Comps produce real scannable QR tickets with **zero** ledger movement.
- Cancel posts balanced 90/10 reversing entries, with `ledger-auditor` sign-off.
- Managers/finance act within their scoped grants; cancel + team-grant remain
  owner-only.
- Golden-path regression + money-invariants + contract checks are green.
