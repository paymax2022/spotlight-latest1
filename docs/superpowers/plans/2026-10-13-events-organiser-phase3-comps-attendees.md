# Events Organiser Self-Service — Phase 3 (Comp & Attendees) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let organisers issue free comp/guest tickets, export their attendee roster as CSV, and send announcements to ticket holders — behind a feature flag.

**Architecture:** Extend `backend/internal/top5events`. Comp issuance mirrors `finalizePurchase` but at zero value with NO money legs. Announcements go through the existing `backend/internal/notifications` service via a new optional seam (like the realtime seam) + an `event_announcements` history row. One additive migration. Gated by `FEATURE_EVENTS_COMPS`. Contract-first; React Native comp + announcement UI.

**Tech Stack:** Go 1.27 + Gin, pgx, PostgreSQL (additive migrations), `internal/notifications` (asynq), `internal/credential`, `internal/cashtag`, Next.js proxy, React Native/Expo.

**Spec:** `docs/superpowers/specs/2026-10-11-events-organiser-self-service-design.md` (§Comp & attendees).

**Decisions (locked 2026-10-13):** comp recipients are EXISTING users resolved by handle/@cashtag (`s.tags.Resolve`, like GiftTicket); announcements send **push/in-app via the notifications service** + an `event_announcements` record (email is deferred — the repo's email service is OTP-template-only); invite-only tiers (Phase 2) are fillable by comps.

## Global Constraints
- Comp tickets move **NO money**: no `wallet.Debit`, no ledger entry, no commission row. A comp = a `kind=COMP` order at `total_kobo=0` + `kind=COMP` ticket at `price_paid_kobo=0` with a real QR credential. Capacity (`sold`) is still consumed. This honours "no money moved → no posting"; it is the ONLY sanctioned zero-ledger issuance.
- Comp issuance requires an `Idempotency-Key` (prevents duplicate free issuance) and is idempotent on replay.
- Additive-only migration; version strictly greater than main's max on a freshly-fetched `origin/main`; re-check `scripts/ci/check-migration-versions.sh` before merge AND verify no duplicate stamp on main post-merge.
- Object-level authz via `authorizeManage` (owner or MANAGER) for comps/announcements; attendee export read allowed to owner/MANAGER (FINANCE is Phase 4, not here).
- Flag-gate everything: Go `FEATURE_EVENTS_COMPS`, mobile `EXPO_PUBLIC_EVENTS_COMPS`. snake_case Go request tags. Mobile writes refuse fixture mode.
- Integer kobo; Conventional Commits; test-first; live-DB tests gate on `TEST_DATABASE_URL` (DB currently flaky — use `-timeout 60m`, run groups solo).

## Review Focus
- **Comp issuance posts NO ledger/wallet entry** and charges nothing — a stray debit or commission row is a Critical money bug. → Task 2.
- **Comp replay / double-issue:** a retried comp with the same Idempotency-Key must not mint a second ticket/credential or double-consume capacity. → Task 2.
- **Comp into an invite-only or sold-out tier:** invite-only is allowed (that's the point); a comp must still respect capacity (can't oversell). → Task 2.
- **Announcement authz + fan-out:** only owner/MANAGER may announce; it must send to the event's ticket holders only (no cross-event leak), and record once. → Task 4.
- **Attendee export authz:** CSV export must be gated (owner/MANAGER), not public. → Task 3.

---

## File Structure
- Create `backend/internal/top5events/comps.go` — `IssueComp`.
- Create `backend/internal/top5events/announce.go` — `NotificationSender` seam + `Announce`.
- Modify `backend/internal/top5events/organiser_reads.go` — CSV serialization of attendees.
- Modify `service.go`/`model.go` (comp/order kind consts, seam field + setter), `handler*.go`, `app/top5_routes.go`, `config/config.go`, `.env.example`.
- Create `supabase/migrations/<ts>_events_comps_announcements.sql`.
- Modify `contracts/openapi.yaml`.
- Modify `mobile-app/reactnative/src/features/events/{api,types,hooks,constants}` + screens under `app/events/organiser/`.

---

### Task 1: Additive migration
**Files:** Create `supabase/migrations/<ts>_events_comps_announcements.sql`; verify on isolated Postgres.
**Produces:**
- `event_orders.kind text NOT NULL DEFAULT 'PAID' CHECK (kind IN ('PAID','COMP'))`.
- `event_tickets.kind text NOT NULL DEFAULT 'PAID' CHECK (kind IN ('PAID','COMP'))`, `event_tickets.issued_by uuid NULL REFERENCES auth.users(id)`, `event_tickets.comp_note text NULL`.
- New `event_announcements (id uuid PK, event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE, sender_id uuid NOT NULL REFERENCES auth.users(id), channel text NOT NULL, subject text NOT NULL DEFAULT '', body text NOT NULL, recipient_count int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now())`, RLS mirroring `event_team_members`.

- [ ] **Step 1:** Load `db-migrations` skill; `git fetch origin main`; pick a version `>` main's max; name `<ts>_events_comps_announcements.sql`.
- [ ] **Step 2:** Write the additive migration (IF NOT EXISTS; CHECK constraints; RLS on the new table mirroring event_team_members's posture).
- [ ] **Step 3:** `scripts/ci/check-migration-versions.sh` passes.
- [ ] **Step 4:** Apply on a throwaway/isolated Postgres; assert columns/table/defaults/CHECKs exist. (Never the shared DB.)
- [ ] **Step 5:** Commit — `feat(events): additive migration for comps + announcements`

### Task 2: Comp issuance (`IssueComp`) — money-adjacent
**Files:** Create `comps.go`; modify `service.go`/`model.go`; test `comps_live_db_test.go`.
**Interfaces:**
- Consumes: `authorizeManage`; `s.tags.Resolve(ctx, handle)`; `s.cred.Issue(ctx, userID, credential.KindEventTicket, credential.Policy{...})` (see finalizePurchase ~service.go:631); the tier `FOR UPDATE` capacity pattern.
- Produces: `func (s *Service) IssueComp(ctx, callerID, eventID, tierID string, recipientHandles []string, note, idemKey string) ([]Ticket, error)`. Per recipient: resolve handle→userID; in ONE tx create a `kind=COMP` `event_orders` row (`total_kobo=0`, `status='PAID'`), issue a credential, insert a `kind=COMP` `event_tickets` row (`price_paid_kobo=0`, `issued_by=callerID`, `comp_note=note`), and `sold=sold+1` on the tier (respect capacity: reject if `sold+requested > capacity` with `ErrSoldOut`). NO wallet/ledger/commission calls. Idempotent on `idemKey` (derive a per-recipient key, e.g. `idemKey+":"+recipientID`, and use `ON CONFLICT` / an order idem unique).

- [ ] **Step 1: Write failing live-DB tests** `TestLiveDB_IssueComp_*`: a comp issues a zero-value ticket with a real credential to the resolved recipient and consumes capacity; **asserts ZERO ledger rows and ZERO wallet movement** for the issuance (query ledger_entries/wallet_balance delta == 0); a comp can fill an `invite_only` tier; capacity exhaustion → `ErrSoldOut`; a replay with the same idemKey issues exactly one ticket (no duplicate credential); a stranger → `ErrForbidden`; a MANAGER may issue.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement `IssueComp`** mirroring finalizePurchase's order→credential→ticket shape but zero-value and with NO money legs; add `OrderKindComp`/`TicketKindComp` consts and an `ErrSoldOut` sentinel if not present.
- [ ] **Step 4: Run to verify they pass**; run the package.
- [ ] **Step 5: Request a money-path review** (confirm no ledger/wallet/commission side effects) before marking done.
- [ ] **Step 6: Commit** — `feat(events): zero-value comp/guest ticket issuance`

### Task 3: Attendee CSV export
**Files:** Modify `organiser_reads.go` (+ a CSV helper); test `comps_live_db_test.go`.
**Interfaces:**
- Produces: `func (s *Service) AttendeesCSV(ctx, callerID, eventID string) ([]byte, error)` (authorizeManage; reuses AttendeesForEvent; emits a CSV with a header row and columns name,cashtag,tier_name,ticket_id,state,checked_in,checked_in_at). Proper CSV quoting (encoding/csv).

- [ ] **Step 1: Write failing live-DB test** `TestLiveDB_AttendeesCSV` — seed 2 attendees (one checked-in), assert the CSV has a header + 2 rows with correct fields and quoting; a stranger → `ErrForbidden`.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** using `encoding/csv`.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `feat(events): attendee CSV export (organiser/manager)`

### Task 4: Announcements (`Announce` + notifications seam)
**Files:** Create `announce.go`; modify `service.go` (seam field + `SetNotifier`), `app/top5_routes.go` (wire the real notifications service); test `comps_live_db_test.go`.
**Interfaces:**
- Produces: a `NotificationSender` interface (minimal: `Send(ctx, userID, title, body string) error`, satisfied by an adapter over `*notifications.Service`; nil = no-op send so tests/flag-off are safe) + `func (s *Service) SetNotifier(n NotificationSender)`. `func (s *Service) Announce(ctx, callerID, eventID, subject, body, idemKey string) (sent int, err error)`: authorizeManage; load distinct ticket-holder user ids for the event; best-effort `Send` to each (failures don't abort — log + continue); insert one `event_announcements` row (channel, subject, body, recipient_count) idempotent on idemKey.

- [ ] **Step 1: Write failing live-DB tests** `TestLiveDB_Announce_*`: with a FAKE NotificationSender injected, announce to an event with 2 holders → sender called for both distinct holders (not for a different event's holders), one `event_announcements` row written with recipient_count=2; a stranger → `ErrForbidden`; a nil notifier is safe (still records the row).
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the seam + `Announce`; add a thin adapter from `*notifications.Service` (calls `Send(Notification{UserID,Title,Body,Channels:[push/in-app]})`).
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** — `feat(events): organiser announcements to ticket holders (push/in-app) + history`

### Task 5: Handlers, routes, flag
**Files:** `config/config.go` + `.env.example`; new `handler_comps.go`; `app/top5_routes.go`.
**Produces:** `FeatureEventsComps` (env `FEATURE_EVENTS_COMPS`, default false). Flag-gated routes: `POST /events/:id/comps` (requires `Idempotency-Key`; body `{tier_id, recipients[], note}`; 201), `GET /events/:id/attendees?format=csv` (text/csv), `POST /events/:id/announcements` (body `{subject, body}`; requires `Idempotency-Key`; 202). Map `ErrSoldOut`→409, `ErrValidation`→400, plus the existing sentinels. Mirror the Phase-2 `handler_ticketing.go` + `ticketingStatus` pattern. Wire `SetNotifier` with the real notifications service in RegisterEvents (guarded by nil if the service isn't configured).

- [ ] **Step 1:** Add the flag + `.env.example`.
- [ ] **Step 2: Write a failing handler test** — flag on: comps by owner → 201; comps without Idempotency-Key → 400; attendees?format=csv → 200 text/csv; announcements by non-owner → 403. Flag off → 404.
- [ ] **Step 3: Implement** handlers + flag-gated registration + notifier wiring.
- [ ] **Step 4: Run to verify**; `go build ./... && go vet ./... && gofmt -l` (clean).
- [ ] **Step 5: Commit** — `feat(events): comp/export/announcement routes behind FEATURE_EVENTS_COMPS`

### Task 6: OpenAPI contract
**Files:** `contracts/openapi.yaml` (events section).
- [ ] **Step 1:** Add `POST /events/{id}/comps` (Idempotency-Key header, body {tier_id, recipients[], note}, 201/400/403/404/409), `GET /events/{id}/attendees` gaining a `format=csv` query (text/csv response) — or document a sibling CSV response, and `POST /events/{id}/announcements` (Idempotency-Key, body {subject, body}, 202/400/403). **Quote any description containing commas** (redocly parses unquoted flow-map commas as keys — the Phase-2 CI failure). Match surrounding conventions.
- [ ] **Step 2:** `cd frontend-web && npm run contract:check` passes. (If feasible, also run redocly lint to catch what contract:check misses.)
- [ ] **Step 3: Commit** — `docs(contract): events comps/attendees/announcements endpoints`

### Task 7: Mobile api/types/hooks
**Files:** `mobile-app/reactnative/src/features/events/{api,types,hooks,constants/events.constants.ts}`.
**Produces:** `issueComp(eventId, {tier_id, recipients, note}, idemKey)`, `fetchAttendeesCsv(eventId)`, `announce(eventId, {subject, body}, idemKey)` — WRITES (comp/announce) throw in fixture mode (notInFixtureMode); matching types; hooks `useIssueComp`/`useAnnounce` invalidating the organiser/attendees queries; `EVENTS_COMPS_ENABLED` constant (default off).
- [ ] **Step 1:** Add the constant + api fns (writes refuse fixture mode; comp/announce send Idempotency-Key) + types.
- [ ] **Step 2:** Add the hooks.
- [ ] **Step 3:** `npx tsc --noEmit` (0 errors; `--stack-size=10000` if it crashes).
- [ ] **Step 4: Commit** — `feat(events-mobile): comp/export/announce api + hooks (writes refuse fixture mode)`

### Task 8: Mobile screens
**Files:** `app/events/organiser/attendees.tsx` (extend) + a comp-issue + announcement entry (modal or screen).
- [ ] **Step 1:** On the attendees screen (gated by `EVENTS_COMPS_ENABLED`): an **Issue comp** action (pick tier, enter recipient handles, note → `useIssueComp` with a fresh idem key) and an **Export CSV** action (share-sheet the CSV) and an **Announce** composer (subject/body → `useAnnounce`). Map errors via `lifecycleErrorMessage`.
- [ ] **Step 2:** `npx tsc --noEmit` (0 errors). (Mobile preview unreliable — verify via tsc + code review.)
- [ ] **Step 3: Commit** — `feat(events-mobile): organiser comp issuance, CSV export, announcements`

---

## Notes / deliberate scoping
- Comps issue to EXISTING users by handle; email/phone invite-to-claim is a future slice.
- Announcements are push/in-app via the notifications service; **email is deferred** (repo email infra is OTP-template-only).
- FINANCE role / attendee-export delegation to FINANCE is Phase 4 / the payout slice.
