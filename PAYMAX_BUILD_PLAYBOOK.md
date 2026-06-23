# Paymax × Spotlight — Build Playbook v2

> **This document is the authoritative source of truth for the build sequence.**  
> It supersedes `docs/build-playbook.md` (v1). v1 remains for historical reference and per-block detail.  
> Architecture audit: `docs/architecture/audit.md`.  
> API spec: `contracts/openapi.yaml`.

---

## Project overview

Spotlight is a live contest/voting platform being transformed into a **fintech super app** on top of the existing Spotlight brownfield codebase.

**Rule:** One block per branch. Each block must leave all tests green and the feature flagged off before merge. Blocks are strictly ordered where marked with a dependency.

---

## Completed blocks (feat/tiers-and-limits branch)

| Block | Name | Status |
|-------|------|--------|
| 0 | Golden-path E2E baseline | ✅ DONE |
| 1 | Platform scaffold (feature flags, env contract, OpenAPI stub) | ✅ DONE |
| 2 | KYC schema (migrations + state machine + API routes) | ✅ DONE |
| 3 | Double-entry ledger schema | ✅ DONE |
| 4 | Wallet service (balance, topup, transactions) | ✅ DONE |
| 5 | Paystack DVA provisioning + inbound transfer credit | ✅ DONE |
| 6 | Vote bridge (idempotent, KYC-gated, outbox) | ✅ DONE |
| 7 | Per-tier daily limits + atomic debit RPC | ✅ DONE |
| 8 | Referral reward (at-most-once, 50,000 kobo = ₦500) | ✅ DONE |
| 9 | Fintech admin RBAC (maker/checker, adjustments) | ✅ DONE |
| 10 | Wallet-to-Wallet transfer (atomic RPC, fee schedule) | ✅ DONE |
| 11 | Wallet-to-Bank transfer (Paystack payout, webhook lifecycle) | ✅ DONE |
| 12 | Beneficiary management (save, nickname, last_used_at) | ✅ DONE |
| 22b | Association / Group Membership (dues, RBAC, ledger, bulk import, CI) | ✅ DONE |

### Go backend modules (all in `backend/internal/`)

All 51 packages pass `go test ./...`. `go vet ./...` and `go build ./...` are clean.

| Module | Package | Status |
|--------|---------|--------|
| Double-entry ledger | `finance/ledger` | ✅ |
| Wallet service | `finance/wallet` | ✅ |
| KYC state machine | `finance/kyc` | ✅ |
| Tier limits | `finance/tiers` | ✅ |
| Outbound transfers | `finance/transfers` | ✅ |
| Settlement lifecycle | `finance/settlement` | ✅ |
| Referrals | `finance/referrals` | ✅ |
| Virtual accounts (DVA) | `finance/va` | ✅ |
| FX / Maplerad | `finance/fx` | ✅ |
| Dispute management | `finance/disputes` | ✅ (handler + migration + routes) |
| Ratings | `finance/ratings` | ✅ (handler + migration + routes) |
| Vote bridge adapter | `votebridge` | ✅ |
| Telemedicine | `telemedicine` | ✅ |
| Transport | `transport` | ✅ |
| Restaurant delivery | `restaurant` | ✅ |
| Events & ticketing | `events` | ✅ |
| Crowdfunding | `crowdfunding` | ✅ |
| Estate management | `estate` | ✅ |
| Group savings | `groups` | ✅ |
| AI Care | `aicare` | ✅ |
| Notifications (queue) | `notifications` | ✅ |
| Payment providers | `provider`, `provider/paystack`, `provider/maplerad` | ✅ |
| Webhooks | `webhooks` | ✅ |
| Association / Group Membership | `association` | ✅ (37 routes, ledger posting, real RBAC, bulk import, committee members) |

### Admin dashboard (`frontend-admin/`)

Finance admin pages at `/admin/finance/`:
- **Hub** — overview cards for KYC, wallets, adjustments
- **KYC Queue** — list pending submissions; approve (with tier) / reject
- **Wallet Lookup** — search by user ID, view balance + transaction history

Admin routes in Go backend: `/api/finance/admin/kyc/...` and `/api/finance/admin/wallets/...`

---

## Iron rules — never violate

### Money handling
- All monetary amounts are **integers in minor units (kobo)**. Never floats. Never strings for math.
- Every money mutation MUST: (1) require an `Idempotency-Key`, (2) post balanced double-entry ledger entries, (3) emit an audit event, (4) pass tier-limit checks fail-closed.
- Wallet balances are **projections of the ledger** — never UPDATE a balance column directly.
- Ledger entries are immutable. Corrections = reversing entries only.

### Brownfield safety
- **NEVER modify files in the existing Spotlight modules** (contests, voting, applicants, legacy auth). Wrap them via adapters (see `vote-bridge` skill).
- All DB migrations are **additive-only**: no DROP, no column renames, no type narrowing.

### Workflow
- API changes start in `contracts/openapi.yaml` — spec PR first, then implementation.
- New module = run `/new-module` command.
- Feature-flag every new module. No flag, no merge.
- Conventional Commits. PRs < 400 lines where possible.

---

## Next blocks (not yet started)

### Block 13 — Telemedicine booking & settlement
**Flag:** `FEATURE_TELEMEDICINE_ENABLED`

Deliverables:
- Supabase migration: `appointments` table (patient_id, doctor_id, slot, status, settlement_id)
- Go service: `backend/internal/telemedicine/service.go` — `Book()`, `Confirm()`, `Cancel()`, `Settle()` (85% doctor / 15% platform)
- Settlement via `settlement.Service.Settle()` then `Refund()` on cancellation
- API routes: `POST /api/v1/telemedicine/appointments`, `POST /api/v1/telemedicine/appointments/:id/confirm`
- Feature flag: `FEATURE_TELEMEDICINE_ENABLED`

Acceptance criteria:
- [ ] Booking debits patient wallet (atomic, idempotent)
- [ ] Settlement: doctor receives 85%, platform 15% of `ConsultationFeeKobo`
- [ ] Cancellation refunds patient minus any penalty
- [ ] Double-booking same slot → 409
- [ ] All money mutations produce balanced ledger entries
- [ ] `go test ./internal/telemedicine/...` green

---

### Block 14 — Transport (ride-hailing) booking & settlement
**Flag:** `FEATURE_TRANSPORT_ENABLED`

Deliverables:
- Supabase migration: `rides` table (rider_id, driver_id, status, fare_kobo, settlement_id)
- Go service: `backend/internal/transport/service.go` — `RequestRide()`, `AcceptRide()`, `CompleteRide()`, `CancelRide()`
- Base fare: `150,000 kobo` (₦1,500); surge multiplier via `SurgeMultiplier float64`
- Split: `ProviderPct + PlatformPct + RiderPct = 1.0` (driver gets `RiderPct`)
- Settlement: `CompleteRide()` calls `settlement.Service.Settle()` with split
- API routes: `/api/v1/transport/rides`

Acceptance criteria:
- [ ] `ProviderPct + PlatformPct + RiderPct = 1.0` enforced at ride creation
- [ ] Concurrent `AcceptRide` on same ride → only one driver wins (Redlock)
- [ ] Fare in kobo integer — no float arithmetic
- [ ] Cancel before match → full refund; cancel after match → partial refund
- [ ] `go test ./internal/transport/...` green

---

### Block 15 — Restaurant delivery
**Flag:** `FEATURE_RESTAURANT_ENABLED`

Deliverables:
- Supabase migration: `restaurant_orders` (items JSONB, total_kobo, delivery_fee_kobo, status, settlement_id)
- Go service: `backend/internal/restaurant/service.go` — `PlaceOrder()`, `ConfirmOrder()`, `DeliverOrder()`, `CancelOrder()`
- Delivery fee: `50,000 kobo` (₦500) flat; total = sum(items) + delivery_fee
- Split: restaurant 70% / rider 20% / platform 10% of items; full delivery fee to rider
- Rating prompt on `DeliverOrder()`

Acceptance criteria:
- [ ] `TotalKobo = ItemsTotalKobo + DeliveryFeeKobo`
- [ ] Order settle: balanced ledger entries for restaurant + rider + platform splits
- [ ] Cancel before preparation: full refund; cancel during: partial
- [ ] `go test ./internal/restaurant/...` green

---

### Block 16 — Estate management
**Flag:** `FEATURE_ESTATE_ENABLED`

Deliverables:
- Go service: `backend/internal/estate/service.go` — `IssueVisitorPass()`, `ScanPass()`, `RevokePass()`, `CreateElection()`, `CastVote()`, `CloseElection()`
- Visitor QR: UUID generated at INSERT, immutable
- Election: UNIQUE(election_id, voter_id) + Redlock for at-most-once voting
- Dues payment: `PayDues()` debits wallet, credits estate account via ledger

Acceptance criteria:
- [ ] Duplicate vote → 409 (UNIQUE constraint)
- [ ] Expired pass scan → 403
- [ ] Dues payment idempotent on `IdempotencyKey`
- [ ] Election with < 2 candidates → 422
- [ ] `go test ./internal/estate/...` green

---

### Block 17 — Crowdfunding
**Flag:** `FEATURE_CROWDFUNDING_ENABLED`

- Go service: `backend/internal/crowdfunding/service.go` — `CreateCampaign()`, `Contribute()`, `FundCampaign()` (settle all contributions), `FailCampaign()` (refund all)
- `GoalKobo` minimum 100 (₦1); contributions minimum 100 kobo
- On `GoalKobo` reached: auto-settle all held contributions
- On deadline without goal: auto-refund all contributions

---

### Block 18 — Events & ticketing
**Flag:** `FEATURE_EVENTS_ENABLED`

- Go service: `backend/internal/events/service.go` — `CreateEvent()`, `PurchaseTicket()`, `ScanTicket()`, `RefundTicket()`, `CancelEvent()`
- QR code: UUID, immutable at INSERT
- Paid tickets: debit via wallet, idempotent on `IdempotencyKey`
- `CancelEvent()` → bulk refund all non-scanned tickets

---

### Block 19 — Group savings (Ajo / Esusu)
**Flag:** `FEATURE_GROUPS_ENABLED`

- Go service: `backend/internal/groups/service.go` — `CreateGroup()`, `InviteMember()`, `PayDues()`, `DistributePot()`
- Dues payment idempotent on `PlanID + IdempotencyKey`
- `DistributePot()` uses settlement.Service to credit current cycle recipient

---

### Block 20 — AI Care (async health AI)
**Flag:** `FEATURE_AICARE_ENABLED`

- Go service: `backend/internal/aicare/service.go` — `StartSession()`, `SendMessage()`, `EscalateToAgent()`, `ResolveSession()`
- Charges per consultation deducted from wallet; `SessionResolved` is terminal
- Human escalation (`SessionEscalated`) triggers notification to on-call agent

---

### Block 21 — Ratings ✅ DONE
**Flag:** `FEATURE_RATINGS_ENABLED`

- Go service: `backend/internal/finance/ratings/service.go` — `Create()`, `GetSummary()`
- Handler: `Create` (POST), `GetSummary` (GET /:entity_id?type=) — wired into `/api/finance/ratings`
- Migration: `ratings` table, UNIQUE(rater_id, transaction_ref), score CHECK 1.0–5.0, RLS
- 9 entity types: doctor, pharmacy, restaurant, rider, driver, bus_operator, event_organiser, campaign, group_admin

---

### Block 22 — Disputes ✅ DONE
**Flag:** `FEATURE_DISPUTES_ENABLED`

- Go service: `backend/internal/finance/disputes/service.go` — `Open()`, `List()`, `Resolve()`
- Handler: `Open`, `List`, `AdminResolve` — wired into `/api/finance/disputes` + `/api/finance/admin/disputes/:id/resolve`
- Migration: `disputes` table, RLS, status/resolution CHECK constraints
- `DisputeType` covers: transfer, topup, vote, order, ticket, ride, contribution
- Resolution: `refund` | `partial_refund` | `no_action` (refund settlement hook: next block)

---

### Block 22b — Association / Group Membership ✅ DONE
**Flag:** `FEATURE_ASSOCIATION_ENABLED` (frontend-web) · `EXPO_PUBLIC_ASSOCIATION_USE_MOCK=false` (mobile)

Full-stack group/association membership module — dues, directory, meetings, tasks, documents, committees, events, chat, AI notes, bulk import, RBAC.

#### Backend (`backend/internal/association/`)
- **7-file package** — `model.go`, `service.go`, `service_actions.go`, `handler.go`, `handler_actions.go`, `routes.go`, `model_test.go`; build/vet/test all clean (`go test ./internal/association/...` 3/3 PASS)
- **37 routes** mounted at `/api/v1/finance/associations` via `finance_routes.go`
- **Money path** (`PayInvoice`): Idempotency-Key required, ledger `Debit` (wallet → settlement), revenue split 50/30/15/5 (national/state/local/platform), receipt row, audit log — all in one atomic tx
- **Offline payment approval** (`DecideOfflinePayment`): requires `Idempotency-Key` on approve path; posts DR `provider_clearing` → CR `settlement` via new `ledger.PostJournal`; commit DB first, then ledger (separate atomic txs)
- **Real RBAC** (`requireCap`): fetches caller's highest-privilege role (SUPER_ADMIN > NATIONAL_ADMIN > FINANCE_ADMIN > CHAPTER_ADMIN > SECRETARY) via single query; checks typed capability flag — `ManageFinance` gates offline approval; `ManageMembers` gates suspend/restore/transfer; `ManageMembers && ManageFinance` gates role assignment (SUPER_ADMIN / NATIONAL_ADMIN only); `ImportMembers` gates bulk CSV import
- **Bulk CSV import** (`BulkImportMembers`): multipart `POST /admin/members/import?org_id=`, resolves rows via `auth.users.email`, looks up category + chapter by label, inserts `ACTIVE` memberships idempotently, single `BULK_IMPORT` audit row
- **Committee join** (`RequestJoinCommittee`): writes `PENDING` row to `assoc_committee_members` + audit log in one tx

#### Migrations
- `supabase/migrations/20260628000000_association_module.sql` — full schema: orgs, chapters, committees, categories, memberships, member_roles, applications, dues_invoices, payments, revenue_splits, meeting_attendance, announcements, notifications, tasks, documents, events, audit_log + RLS policies
- `supabase/migrations/20260629000000_assoc_committee_members.sql` — `assoc_committee_members` table (PENDING/ACTIVE/DECLINED/REMOVED), RLS; additive-only guard passed

#### Proxy & feature flag (frontend-web)
- `frontend-web/src/app/api/associations/[...path]/route.ts` — catch-all Next.js proxy reconciling mobile's bare `/associations/*` calls to Go's `/api/v1/finance/associations/*`; forwards `Authorization` + `Idempotency-Key` headers; 503 when flag off
- `frontend-web/src/lib/feature-flags.ts` + `.env.example` — `FEATURE_ASSOCIATION_ENABLED` flag

#### Mobile (`mobile-app/reactnative/`)
- `EXPO_PUBLIC_ASSOCIATION_USE_MOCK=false` flipped in `.env.example`
- `tsconfig.associationcheck.json` — scoped typecheck for the association feature slice

#### CI (`.github/workflows/association-ci.yml`)
Five-job gate triggered on association paths:
1. **backend** — `go build ./...` (whole backend), `go vet + test ./internal/association/...`, `go test ./... -count=1`
2. **admin-typecheck** — `npm run type-check` in `frontend-admin`
3. **web-typecheck** — `npx tsc --noEmit` in `frontend-web`
4. **mobile-typecheck** — scoped `tsconfig.associationcheck.json` then full `tsconfig.json`
5. **migration-guard** — rejects destructive DDL in `*assoc*.sql` migrations

#### Acceptance criteria
- [x] `go build ./...` clean (51 packages)
- [x] `go vet ./internal/association/...` clean
- [x] `go test ./internal/association/...` — 3/3 PASS (RevenueSplit sums exactly, proportions, PayInvoice idempotency key required)
- [x] `go test ./... -count=1` — all 51 packages ok, zero failures
- [x] Mobile scoped typecheck clean (`tsconfig.associationcheck.json`)
- [x] DDL guard passes on both association migrations
- [x] Ledger posting is balanced (DR provider_clearing / CR settlement) for offline approvals
- [x] `EXPO_PUBLIC_ASSOCIATION_USE_MOCK=false` — mobile routes to live proxy
- [ ] `supabase db push` to cloud (pending `supabase link` to project ref)

---

### Block 23 — Estate mobile UI screens ✅ DONE
**Flag:** `FEATURE_ESTATE_ENABLED`

Deliverables:
- API client: `apps/mobile-starter/src/api/estate.api.ts` — typed wrappers for all estate endpoints
- Hub screen: `apps/mobile-starter/app/(protected)/estate/index.tsx` — my estate dashboard (active passes, upcoming elections, quick actions)
- Visitor passes screen: `apps/mobile-starter/app/(protected)/estate/passes.tsx` — issue new visitor passes, view active/used/expired passes with QR display
- Elections screen: `apps/mobile-starter/app/(protected)/estate/elections.tsx` — list open elections, view candidates, cast vote (idempotent)
- Home screen: added "Estate" service tile to services grid (`(tabs)/index.tsx`)
- More screen: added "Estate Management" entry to Marketplace section (`(tabs)/more.tsx`)

API routes (under `/api/finance/estate/...`):
- `POST /api/finance/estate` — create estate
- `POST /api/finance/estate/:id/passes` — issue visitor pass (returns QR UUID)
- `POST /api/finance/estate/:id/passes/scan` — scan a pass QR
- `POST /api/finance/estate/:id/elections` — create election (≥2 candidates)
- `POST /api/finance/estate/:id/elections/:electionId/vote` — cast vote (UNIQUE enforced → 409 on dupe)
- `GET /api/finance/estate/:id/elections/:electionId/results` — get results

Acceptance criteria:
- [x] Visitor pass displays QR UUID and status badge (active / used / expired / revoked)
- [x] Issue pass form validates visitor_name, valid_from, valid_until
- [x] Elections list shows status chip (draft / open / closed / tallied)
- [x] Cast vote button disabled when election not open or already voted
- [x] Duplicate vote → 409 shown as user-readable error
- [x] Estate tile visible on home grid and More → Marketplace

---

### Block 24 — Estate: Onboarding & Property Selection ✅ DONE
**Flag:** `FEATURE_ESTATE_ONBOARDING_ENABLED`

> Covers screen group B. Skip anything already in Block 23 (basic estate create).

Backend deliverables:
- Migration: `estate_invite_codes` table (code UUID, estate_id, created_by, expires_at, max_uses, used_count)
- Migration: `estate_join_requests` table (user_id, estate_id, status: pending|approved|rejected, reviewed_by, reviewed_at)
- Migration: `estate_properties` table (estate_id, unit_label, property_type: apartment|house|commercial, floor, block, occupancy_status: vacant|occupied)
- Migration: `property_ownership_claims` table (property_id, user_id, status, ownership_doc_url, verified_by, verified_at)
- Migration: `tenancy_requests` table (property_id, tenant_id, landlord_id, status, lease_start, lease_end, agreement_url)
- Go service: `backend/internal/estate/service.go` additions — `GenerateInviteCode()`, `JoinWithInviteCode()`, `JoinWithQR()`, `RequestAccess()`, `ApproveJoinRequest()`, `RejectJoinRequest()`, `AddProperty()`, `ClaimOwnership()`, `VerifyOwnership()`, `CreateTenancyRequest()`, `ApproveTenancy()`
- API routes (`/api/finance/estate/:id/...`):
  - `POST /invite-codes` — generate invite code
  - `POST /join/invite` — join with invite code
  - `POST /join/qr` — join with QR scan
  - `POST /access-request` — request access
  - `POST /access-request/:reqId/approve|reject` — admin approve/reject
  - `POST /properties` — add property/unit
  - `POST /properties/:pid/claim` — claim ownership
  - `POST /properties/:pid/tenancy` — create tenancy request
  - `POST /properties/:pid/tenancy/:tid/approve|reject` — landlord action
  - `GET /properties` — list estate properties

Mobile screens (`apps/mobile-starter/app/(protected)/estate/`):
- `join/index.tsx` — select estate / search estates
- `join/invite.tsx` — join with invite code (text entry)
- `join/qr.tsx` — join with QR scan (camera)
- `join/request.tsx` — request access form
- `join/pending.tsx` — access pending approval
- `join/approved.tsx` — access approved confirmation
- `join/rejected.tsx` — access rejected screen
- `properties/index.tsx` — select / switch property or unit
- `properties/add.tsx` — add property/unit
- `properties/claim.tsx` — claim ownership + upload doc
- `properties/tenancy.tsx` — tenant occupancy request form
- `properties/pending.tsx` — property verification pending
- `switcher.tsx` — multiple estate / property switcher

Acceptance criteria:
- [ ] Invite code expires at `expires_at` and enforces `max_uses`
- [ ] Access request → push notification to estate admin
- [ ] `ClaimOwnership()` requires document upload URL before insert
- [ ] `ApproveTenancy()` creates resident record with role `tenant`
- [ ] `go test ./internal/estate/...` green

---

### Block 25 — Estate: Resident Profile System ✅ DONE
**Flag:** `FEATURE_ESTATE_PROFILES_ENABLED`

> Covers screen group C.

Backend deliverables:
- Migration: `resident_profiles` table (resident_id, bio, profile_photo_url, contact, emergency_contact, next_of_kin JSONB, occupancy_type: resident|tenant|homeowner|landlord, lease_start, lease_end)
- Migration: `household_members` table (resident_id, name, relationship, dob, id_type, id_number)
- Migration: `domestic_staff` table (resident_id, name, role, photo_url, id_type, id_number, status: active|suspended)
- Migration: `resident_vehicles` table (resident_id, plate, make, model, color, doc_url, verified: bool)
- Go service additions: `UpdateProfile()`, `AddHouseholdMember()`, `AddDomesticStaff()`, `AddVehicle()`, `VerifyVehicle()`, `GetResidentCard()`
- API routes: `GET|PATCH /api/finance/estate/profile`, `POST /household-members`, `POST /domestic-staff`, `POST /vehicles`, `POST /vehicles/:vid/verify`

Mobile screens (`apps/mobile-starter/app/(protected)/estate/profile/`):
- `index.tsx` — resident profile dashboard
- `edit.tsx` — edit personal profile + upload photo
- `contacts.tsx` — contact & emergency contact
- `family.tsx` — household members list + add
- `staff.tsx` — domestic staff list + add
- `vehicles/index.tsx` — vehicle list
- `vehicles/add.tsx` — add vehicle + upload doc
- `id-card.tsx` — resident ID card (QR + details)
- `occupancy.tsx` — occupancy details, lease dates, upload agreement
- `privacy.tsx` — privacy & access permissions

Acceptance criteria:
- [ ] Profile photo upload goes to Cloudflare R2 (presigned PUT URL)
- [ ] Resident ID card QR encodes `estate_id + resident_id`
- [ ] Vehicle verification sets `verified=true` (admin only)
- [ ] `go test ./internal/estate/...` green after additions

---

### Block 26 — Estate: Resident Home Dashboard ✅ DONE
**Flag:** `FEATURE_ESTATE_DASHBOARD_ENABLED`

> Covers screen group D.

Backend deliverables:
- API route: `GET /api/finance/estate/:id/dashboard` — returns aggregated payload:
  - `active_visitor_codes` count
  - `pending_payment` summary (amount_kobo, due_date)
  - `upcoming_meetings` (next 2)
  - `open_elections` count
  - `repair_requests` open count
  - `announcements` (latest 3)
  - `security_alerts` (last 24 h)
- Go service: `GetDashboard(ctx, estateID, userID)` — single DB fan-out query

Mobile screens:
- `estate/dashboard.tsx` — full resident dashboard with announcement card, active visitor code card, payment alert, meeting reminder, election alert, repair status card, security alert card, dues summary, property status, quick-action row (invite visitor, pay dues, report issue, book facility, vote, meeting, task, AI notes, emergency)

Acceptance criteria:
- [ ] Dashboard responds < 300 ms (single query, no N+1)
- [ ] Payment alert shows kobo amount formatted as ₦
- [ ] Quick-action icons deep-link to correct estate sub-screens

---

### Block 27 — Estate: Visitor Access Code Management (Extended) ✅ DONE
**Flag:** `FEATURE_ESTATE_VISITOR_CODES_ENABLED`

> Extends the basic visitor pass from Block 23. Covers screen group E.

Backend deliverables:
- Migration: `visitor_access_codes` table (estate_id, issued_by, visitor_name, visitor_phone, vehicle_plate, purpose, code_type: one_time|recurring|multi_day|delivery|ridehailing|staff|contractor|event_guest|family, numeric_code VARCHAR(6), qr_code UUID, valid_from, valid_until, recurrence JSONB, used_count, max_uses, status, blacklisted: bool)
- Migration: `visitor_checkins` table (code_id, guard_id, gate_id, event: arrived|checked_out, captured_at, photo_url)
- Go service: `GenerateAccessCode()` (numeric 6-digit + QR UUID), `RevokeCode()`, `ExtendCode()`, `BlacklistVisitor()`, `GetCheckinHistory()`, `ListActiveCodes()`, `BulkUploadGuests()`
- API routes:
  - `POST /api/finance/estate/:id/access-codes` — create any code type
  - `GET /api/finance/estate/:id/access-codes` — list (filter: active|expired|revoked)
  - `POST /api/finance/estate/:id/access-codes/:cid/revoke`
  - `POST /api/finance/estate/:id/access-codes/:cid/extend`
  - `GET /api/finance/estate/:id/access-codes/:cid/history`

Mobile screens (`apps/mobile-starter/app/(protected)/estate/visitors/`):
- `index.tsx` — visitor management dashboard (active codes count, quick create buttons)
- `create.tsx` — create access code: code type selector → visitor details form (name, phone, vehicle, purpose, arrival time, date range) → review → issue
- `code.tsx` — show QR + numeric code with share buttons (WhatsApp / SMS / email via `expo-sharing` + `expo-sms`)
- `list.tsx` — active / expired / revoked tabs with search
- `history.tsx` — visitor arrival/checkout history per code
- `blacklist.tsx` — blacklisted visitor warning screen

Acceptance criteria:
- [ ] Numeric code is always exactly 6 digits, unique per estate per active window
- [ ] Recurring codes store recurrence JSONB (days_of_week, time_range)
- [ ] Blacklist flag prevents gate scan approval
- [ ] Share via WhatsApp opens deep link with code pre-filled
- [ ] `go test ./internal/estate/...` green

---

### Block 28 — Estate: Security Gate / Guard App ✅ DONE
**Flag:** `FEATURE_ESTATE_GUARD_ENABLED`

> Covers screen group F. Guard is a separate user role (`estate_security`).

Backend deliverables:
- Migration: `estate_gates` table (estate_id, name, type: pedestrian|vehicle|service)
- Migration: `guard_shifts` table (guard_id, gate_id, started_at, ended_at, handover_notes)
- Migration: `gate_incident_reports` table (guard_id, gate_id, incident_type, description, evidence_url, escalated: bool, created_at)
- Go service: `CheckInVisitor()`, `CheckOutVisitor()`, `LookupResident()`, `LookupCode()`, `LogVehicleEntry()`, `SubmitIncidentReport()`, `HandoverShift()`, `SyncOfflineLogs()`
- API routes:
  - `GET /api/finance/estate/:id/guard/expected-visitors` — upcoming expected arrivals
  - `POST /api/finance/estate/:id/guard/checkin` — scan / manual entry → returns visitor details
  - `POST /api/finance/estate/:id/guard/checkout`
  - `POST /api/finance/estate/:id/guard/incident`
  - `POST /api/finance/estate/:id/guard/shift-handover`
  - `POST /api/finance/estate/:id/guard/sync` — offline log sync (idempotent)

Mobile screens (`apps/mobile-starter/app/(protected)/estate/guard/`):
- `index.tsx` — guard dashboard (gate selector, expected visitors count, quick scan)
- `scan.tsx` — QR scanner (camera) → confirm entry/denial
- `manual.tsx` — manual code entry → lookup
- `visitor-confirm.tsx` — visitor details, call resident, approve / deny buttons
- `capture.tsx` — capture photo, ID, plate number before entry
- `vehicle-log.tsx` — vehicle entry log
- `expected.tsx` — expected visitors list with filters
- `walkin.tsx` — walk-in request (call resident for approval)
- `incident.tsx` — incident report form + evidence upload
- `blacklist-alert.tsx` — blacklisted visitor screen
- `handover.tsx` — shift handover notes
- `offline.tsx` — offline mode indicator + sync pending notice
- `gate-log.tsx` — gate activity log

Acceptance criteria:
- [ ] Scan → checkin round-trip < 2 s on average
- [ ] Offline logs stored in AsyncStorage, synced via `POST /guard/sync` on reconnect
- [ ] Blacklisted visitor triggers red alert screen and blocks approval
- [ ] Incident report uploads evidence to R2 (presigned PUT)

---

### Block 29 — Estate: Property Management
**Flag:** `FEATURE_ESTATE_PROPERTY_MGMT_ENABLED`

> Covers screen group G.

Backend deliverables:
- Go service additions: `ListProperties()`, `GetProperty()`, `UpdateProperty()`, `AssignLandlord()`, `AssignTenant()`, `SetOccupancyStatus()`, `RequestPropertyTransfer()`, `ArchiveProperty()`, `GetPropertyAnalytics()`
- API routes:
  - `GET /api/finance/estate/:id/properties`
  - `GET|PATCH /api/finance/estate/:id/properties/:pid`
  - `POST /api/finance/estate/:id/properties/:pid/transfer-request`
  - `POST /api/finance/estate/:id/properties/:pid/archive`
  - `GET /api/finance/estate/:id/properties/:pid/analytics`

Mobile screens (`apps/mobile-starter/app/(protected)/estate/properties/`):
- `index.tsx` — property listing with occupancy status chips
- `[id].tsx` — property detail (type, floor, landlord, tenant, docs, status)
- `edit.tsx` — edit property details
- `documents.tsx` — lease + ownership doc upload
- `inspection.tsx` — inspection report form
- `maintenance-history.tsx` — maintenance history list
- `transfer.tsx` — property transfer request form
- `analytics.tsx` — property analytics (occupancy, revenue, repairs)

---

### Block 30 — Estate: Dues, Rent & Subscription Payments
**Flag:** `FEATURE_ESTATE_PAYMENTS_ENABLED`

> Covers screen groups H and I.

Backend deliverables:
- Migration: `estate_levy_types` table (estate_id, name, frequency: monthly|quarterly|annual, amount_kobo, grace_period_days, late_fee_kobo)
- Migration: `estate_payment_schedules` table (property_id, levy_type_id, due_date, amount_kobo, status: pending|paid|overdue|waived, paid_at, receipt_url)
- Migration: `estate_payment_restrictions` table (resident_id, estate_id, restriction_type: soft|hard, reason, lifted_at)
- Migration: `payment_proofs` table (schedule_id, resident_id, proof_url, status: pending|approved|rejected, reviewed_by, reviewed_at)
- Migration: `payment_waivers` table (resident_id, estate_id, reason, amount_kobo, approved_by, approved_at)
- Go service (`backend/internal/estate/payment_service.go`): `PayDues()` (debits wallet, posts balanced ledger entry, idempotent), `PayRent()`, `GetOutstandingBalance()`, `IssueReceipt()`, `ApplyRestriction()`, `LiftRestriction()`, `SubmitPaymentProof()`, `ApproveProof()`, `RequestWaiver()`, `ApproveWaiver()`
- API routes:
  - `GET /api/finance/estate/:id/levies`
  - `GET /api/finance/estate/:id/payments/outstanding`
  - `POST /api/finance/estate/:id/payments/pay` (Idempotency-Key required)
  - `GET /api/finance/estate/:id/payments/history`
  - `GET /api/finance/estate/:id/payments/receipt/:id`
  - `POST /api/finance/estate/:id/payments/proof`
  - `POST /api/finance/estate/:id/payments/waiver-request`
  - `GET /api/finance/estate/:id/residents/:uid/restriction`

Mobile screens (`apps/mobile-starter/app/(protected)/estate/payments/`):
- `index.tsx` — subscription/dues dashboard (outstanding, due date, auto-renewal)
- `breakdown.tsx` — service charge, security levy, waste, water breakdown
- `pay.tsx` — pay now (method selector: wallet, card, bank transfer, USSD)
- `history.tsx` — payment history with receipt download
- `receipt/[id].tsx` — receipt detail + download
- `overdue.tsx` — overdue notice with penalty amount
- `restriction.tsx` — soft restriction warning (features limited)
- `banned.tsx` — hard ban screen (visitor/voting/facility access disabled)
- `restore.tsx` — pay to restore access flow
- `proof.tsx` — upload proof of payment form
- `proof-review.tsx` — proof under review / rejected / approved states
- `waiver.tsx` — exemption / waiver request form
- `waiver-status.tsx` — waiver pending / approved / rejected
- `plans.tsx` — subscription plan selector (monthly/quarterly/annual)

Acceptance criteria:
- [ ] `PayDues()` posts balanced double-entry ledger (debit resident wallet, credit estate account)
- [ ] `PayDues()` requires `Idempotency-Key`
- [ ] `ApplyRestriction(soft)` → visitor codes still work, voting/facility blocked
- [ ] `ApplyRestriction(hard)` → all estate features blocked
- [ ] Receipt is immutable and stored in R2
- [ ] `go test ./internal/estate/...` green

---

### Block 31 — Estate: Elections — Extended System
**Flag:** `FEATURE_ESTATE_ELECTIONS_EXTENDED_ENABLED`

> Extends Block 23 elections. Covers screen group J.

Backend deliverables:
- Migration: `election_nominations` table (election_id, nominee_id, submitted_by, status: pending|approved|rejected, manifesto, media_urls JSONB)
- Migration: `election_eligibility_rules` table (election_id, require_kyc: bool, require_payment: bool, resident_types text[])
- Migration: `election_disputes` table (election_id, filed_by, description, status: open|resolved)
- Go service additions: `NominateCandidate()`, `ApproveNomination()`, `CheckVoterEligibility()` (KYC + payment gating), `GetLiveResults()`, `AnnounceFinalResult()`, `FileElectionDispute()`
- API routes:
  - `POST /api/finance/estate/:id/elections/:eid/nominations`
  - `POST /api/finance/estate/:id/elections/:eid/nominations/:nid/approve|reject`
  - `GET /api/finance/estate/:id/elections/:eid/eligibility`
  - `GET /api/finance/estate/:id/elections/:eid/live-results`
  - `POST /api/finance/estate/:id/elections/:eid/disputes`

Mobile screens (`apps/mobile-starter/app/(protected)/estate/elections/`):
- `[id].tsx` — election detail (rules, countdown, eligibility status)
- `[id]/candidates.tsx` — candidate list with profiles and manifestos
- `[id]/nominate.tsx` — nomination form + manifesto upload
- `[id]/vote.tsx` — extended vote screen (eligibility check first)
- `[id]/live-results.tsx` — live results (if enabled by admin)
- `[id]/final-results.tsx` — final result + breakdown by position
- `[id]/dispute.tsx` — file election dispute
- `ineligible.tsx` — ineligible voter screen (payment / KYC reason)
- `upcoming.tsx` — upcoming elections list
- `past.tsx` — past elections list

---

### Block 32 — Estate: Meeting Management
**Flag:** `FEATURE_ESTATE_MEETINGS_ENABLED`

Backend deliverables:
- Migration: `estate_meetings` table (estate_id, title, agenda JSONB, date_time, location, meeting_type: physical|virtual|hybrid, status: scheduled|live|ended|cancelled, recording_url)
- Migration: `meeting_rsvps` table (meeting_id, resident_id, response: yes|no|maybe, rsvped_at)
- Migration: `meeting_attendees` table (meeting_id, resident_id, checked_in_at, method: qr|manual)
- Migration: `meeting_minutes` table (meeting_id, content_md, action_items JSONB, decisions JSONB, approved_by, approved_at)
- Migration: `meeting_documents` table (meeting_id, uploaded_by, name, url, size_bytes)
- Go service (`backend/internal/estate/meeting_service.go`): `CreateMeeting()`, `RSVP()`, `StartMeeting()`, `CheckInAttendee()`, `UploadMinutes()`, `ApproveMinutes()`, `AddDocument()`, `CancelMeeting()`, `RescheduleMeeting()`
- API routes: `/api/finance/estate/:id/meetings` (CRUD), `/meetings/:mid/rsvp`, `/meetings/:mid/checkin`, `/meetings/:mid/minutes`, `/meetings/:mid/documents`

Mobile screens (`apps/mobile-starter/app/(protected)/estate/meetings/`):
- `index.tsx` — meeting dashboard (upcoming, past, calendar view)
- `[id].tsx` — meeting detail (agenda, attendees, documents, RSVP)
- `[id]/checkin.tsx` — QR attendance check-in
- `[id]/live.tsx` — live meeting screen (notes, polls, attendance)
- `[id]/minutes.tsx` — meeting minutes view + approve/reject
- `[id]/documents.tsx` — document list + upload
- `create.tsx` — create meeting form (title, agenda items, date/time, location type, invite attendees)

---

### Block 33 — Estate: AI Note-Taking
**Flag:** `FEATURE_ESTATE_AI_NOTES_ENABLED`

Backend deliverables:
- Migration: `ai_note_sessions` table (meeting_id, estate_id, initiated_by, audio_url, transcript_md, summary_md, action_items JSONB, decisions JSONB, status: processing|complete|failed)
- Go service (`backend/internal/estate/ainotes_service.go`): `StartSession()`, `UploadAudio()`, `ProcessTranscript()` (calls Claude API — `claude-sonnet-4-6`), `GenerateSummary()`, `ExtractActionItems()`, `ApproveNotes()`, `RejectNotes()`, `ExportPDF()`, `TranslateNotes()`
- API routes: `POST /api/finance/estate/:id/meetings/:mid/ai-notes`, `GET .../ai-notes/:sid`, `POST .../ai-notes/:sid/approve`, `GET .../ai-notes/:sid/export`

Mobile screens (`apps/mobile-starter/app/(protected)/estate/ai-notes/`):
- `index.tsx` — AI note dashboard (sessions list)
- `record.tsx` — record meeting audio + upload
- `processing.tsx` — AI processing indicator
- `[id].tsx` — AI summary, action items, decisions, attendees extracted
- `[id]/edit.tsx` — edit / correct AI-generated notes
- `[id]/export.tsx` — export as PDF + share

Notes: Use `claude-sonnet-4-6` for transcript summarisation. Prompt must include: meeting title, agenda, participant names. Output: summary (≤300 words), action items with assignee + due date, decisions, unresolved issues.

---

### Block 34 — Estate: Task Management
**Flag:** `FEATURE_ESTATE_TASKS_ENABLED`

Backend deliverables:
- Migration: `estate_tasks` table (estate_id, title, description, assigned_to UUID[], created_by, priority: low|medium|high|urgent, status: todo|in_progress|done|overdue|cancelled, due_date, source: manual|meeting|repair, source_ref_id, checklist JSONB, attachments JSONB)
- Migration: `task_comments` table (task_id, author_id, body, created_at)
- Go service: `CreateTask()`, `AssignTask()`, `UpdateStatus()`, `AddComment()`, `EscalateTask()`, `ApproveTaskCompletion()`, `GetTasksByMeeting()`
- API routes: `/api/finance/estate/:id/tasks` (CRUD), `/tasks/:tid/comments`, `/tasks/:tid/escalate`

Mobile screens (`apps/mobile-starter/app/(protected)/estate/tasks/`):
- `index.tsx` — task dashboard (my tasks, assigned, estate tasks, by status)
- `[id].tsx` — task detail (description, checklist, comments, attachments, status timeline)
- `create.tsx` — create task form (title, assignees, priority, due date, checklist)
- `calendar.tsx` — task calendar view

---

### Block 35 — Estate: Repair & Maintenance
**Flag:** `FEATURE_ESTATE_REPAIRS_ENABLED`

Backend deliverables:
- Migration: `repair_requests` table (estate_id, property_id, reported_by, category: plumbing|electrical|gate|generator|elevator|water|waste|road|pest|facility|other, title, description, photos JSONB, location, urgency: low|medium|high|emergency, status: pending|inspecting|assigned|in_progress|completed|reopened|cancelled, vendor_id, cost_estimate_kobo, quote_approved: bool, settlement_id)
- Migration: `repair_vendors` table (name, contact, specialties text[], verified: bool, rating FLOAT4)
- Migration: `repair_evidence` table (request_id, uploader_id, upload_type: before|quote|invoice|completion, url, uploaded_at)
- Go service: `SubmitRepairRequest()`, `AssignVendor()`, `SubmitQuote()`, `ApproveQuote()` (debits wallet, idempotent), `MarkComplete()`, `ConfirmCompletion()`, `ReopenRequest()`, `SchedulePreventiveMaintenance()`
- API routes: `/api/finance/estate/:id/repairs` (CRUD), `/repairs/:rid/assign`, `/repairs/:rid/quote`, `/repairs/:rid/complete`, `/repairs/:rid/confirm`

Mobile screens (`apps/mobile-starter/app/(protected)/estate/repairs/`):
- `index.tsx` — repair dashboard (open, in-progress, completed counts)
- `report.tsx` — multi-step report form (category → photos → location → urgency → submit)
- `[id].tsx` — ticket detail + status timeline + vendor info
- `[id]/quote.tsx` — cost estimate with approve/reject
- `[id]/rate.tsx` — rate repair service
- `schedule.tsx` — preventive maintenance calendar

---

### Block 36 — Estate: Facility / Amenity Booking
**Flag:** `FEATURE_ESTATE_FACILITIES_ENABLED`

Backend deliverables:
- Migration: `estate_facilities` table (estate_id, name, type: clubhouse|event_hall|pool|gym|tennis|football|bbq, capacity, booking_fee_kobo, rules_md, status: available|unavailable|maintenance)
- Migration: `facility_bookings` table (facility_id, booked_by, starts_at, ends_at, status: pending|confirmed|cancelled|refunded, amount_kobo, settlement_id, qr_code UUID)
- Go service: `ListFacilities()`, `BookFacility()` (debit wallet, idempotent), `CancelBooking()` (refund), `ScanBookingQR()`
- API routes: `/api/finance/estate/:id/facilities`, `/facilities/:fid/bookings`, `/bookings/:bid/cancel`, `/bookings/:bid/scan`

Mobile screens (`apps/mobile-starter/app/(protected)/estate/facilities/`):
- `index.tsx` — facility list with availability indicators
- `[id].tsx` — facility detail (rules, capacity, booking fee, calendar)
- `book.tsx` — date/time slot selector → payment → confirmation
- `confirmation.tsx` — booking QR pass
- `history.tsx` — booking history

---

### Block 37 — Estate: Announcements & Community
**Flag:** `FEATURE_ESTATE_COMMUNITY_ENABLED`

Backend deliverables:
- Migration: `estate_announcements` table (estate_id, created_by, title, body_md, type: general|emergency|security|payment|maintenance|meeting|election, attachment_url, audience: all|residents|landlords|tenants|committee, push_sent: bool)
- Migration: `community_posts` table (estate_id, author_id, body, attachment_url, status: active|removed)
- Migration: `post_comments` table (post_id, author_id, body)
- Go service: `PublishAnnouncement()` (sends push via notifications queue), `CreatePost()`, `CommentOnPost()`, `ReportPost()`, `ModeratePost()`
- API routes: `/api/finance/estate/:id/announcements` (CRUD), `/community/posts`, `/posts/:pid/comments`, `/posts/:pid/report`

Mobile screens (`apps/mobile-starter/app/(protected)/estate/community/`):
- `announcements.tsx` — announcements list (type filter, unread badge)
- `[id].tsx` — announcement detail
- `forum.tsx` — community forum feed
- `post/create.tsx` — create post + attachment
- `post/[id].tsx` — post detail with comments

---

### Block 38 — Estate: Emergency & Security Incidents
**Flag:** `FEATURE_ESTATE_EMERGENCY_ENABLED`

Backend deliverables:
- Migration: `security_incidents` table (estate_id, reported_by, type: suspicious_activity|noise|domestic|theft|medical|fire|other, description, evidence_url, anonymous: bool, status: open|escalated|resolved, response_notes, resolved_at)
- Go service: `ReportIncident()`, `EscalateIncident()` (notifies security staff + admin), `ResolveIncident()`
- API routes: `/api/finance/estate/:id/incidents` (POST, GET list, GET detail, PATCH status)

Mobile screens (`apps/mobile-starter/app/(protected)/estate/emergency/`):
- `index.tsx` — emergency dashboard with panic button
- `panic.tsx` — panic button screen (tap → calls estate security, logs incident)
- `report.tsx` — incident report form (type, description, evidence upload, anonymous toggle)
- `[id].tsx` — incident tracking (status, response notes)
- `history.tsx` — incident history

---

### Block 39 — Estate: Document Management
**Flag:** `FEATURE_ESTATE_DOCUMENTS_ENABLED`

Backend deliverables:
- Migration: `estate_documents` table (estate_id, uploaded_by, category: constitution|rules|service_charge|minutes|election|property|lease|repair|receipt, name, url, restricted: bool, approved: bool)
- Go service: `UploadDocument()` (R2 presigned PUT), `ApproveDocument()`, `ListDocuments()`, `GetDownloadURL()` (presigned GET, 60 min TTL)
- API routes: `/api/finance/estate/:id/documents` (GET list, POST upload), `/documents/:did/approve`, `/documents/:did/download-url`

Mobile screens (`apps/mobile-starter/app/(protected)/estate/documents/`):
- `index.tsx` — document dashboard (categories, recent uploads)
- `[category].tsx` — category document list
- `upload.tsx` — upload document (category, name, file picker)
- `[id].tsx` — document viewer + download + share

---

### Block 40 — Estate: Finance & Wallet Dashboard
**Flag:** `FEATURE_ESTATE_FINANCE_ENABLED`

Backend deliverables:
- Go service: `GetEstateRevenueSummary()` (levy collection, facility revenue, repair payments), `GetResidentLedger()`, `ExportFinanceReport()` (CSV), `ReconcilePayments()`, `ProcessRefund()` (reversed ledger entry)
- API routes: `/api/finance/estate/:id/finance/summary`, `/finance/resident-ledger/:uid`, `/finance/export`, `/finance/reconcile`

Mobile screens (`apps/mobile-starter/app/(protected)/estate/finance/`):
- `index.tsx` — estate revenue dashboard (admin-only) with levy, facility, repair revenue cards
- `ledger.tsx` — per-resident payment ledger
- `defaulters.tsx` — payment defaulters list
- `export.tsx` — export report (date range, format: CSV/PDF)
- `refund.tsx` — refund request form

---

### Block 41 — Estate: Admin Panel & Configuration
**Flag:** `FEATURE_ESTATE_ADMIN_ENABLED`

Backend deliverables:
- Go service: `GetAdminDashboard()`, `SetEstateRules()` (visitor rules, voting rules, ban rules, meeting rules), `ConfigureSubscriptionPlan()`, `BanResident()`, `RestoreResident()`, `GetAuditLog()`, `GetEstateAnalytics()`
- API routes: `/api/finance/estate/:id/admin/...` (dashboard, rules, residents, bans, audit-log, analytics)

Mobile screens (`apps/mobile-starter/app/(protected)/estate/admin/`):
- `index.tsx` — admin dashboard (resident count, pending approvals, defaulters, open incidents)
- `residents.tsx` — resident list with role filter + pending approvals
- `bans.tsx` — ban / restrict resident + restore
- `rules.tsx` — configure visitor rules, voting rules, ban thresholds
- `plans.tsx` — configure subscription plans and levy amounts
- `audit-log.tsx` — audit log (who did what, when)
- `analytics.tsx` — estate analytics overview

Mobile screens — Landlord (`apps/mobile-starter/app/(protected)/estate/landlord/`):
- `index.tsx` — landlord dashboard (properties, tenants, rent status)
- `tenants.tsx` — tenant list per property
- `rent.tsx` — rent collection dashboard + send notice
- `income.tsx` — property income report

---

### Block 42 — Estate: Vendor / Contractor App
**Flag:** `FEATURE_ESTATE_VENDOR_ENABLED`

Backend deliverables:
- Migration: `vendor_profiles` table (user_id, business_name, specialties, bank_account JSONB, rating FLOAT4, verified: bool)
- Go service: `OnboardVendor()`, `GetAssignedJobs()`, `AcceptJob()`, `RejectJob()`, `CheckInAtGate()`, `SubmitQuote()`, `SubmitInvoice()`, `UploadCompletionEvidence()`, `MarkJobComplete()`, `RequestPayout()` (wallet credit)
- API routes: `/api/finance/estate/vendor/...` (profile, jobs, checkin, quote, invoice, complete, payout)

Mobile screens (`apps/mobile-starter/app/(protected)/estate/vendor/`):
- `index.tsx` — vendor dashboard (available jobs, assigned jobs, earnings summary)
- `onboarding.tsx` — vendor onboarding form (profile, specialties, bank details, upload ID)
- `jobs/index.tsx` — job list (available, assigned, completed)
- `jobs/[id].tsx` — job detail (property, issue, resident contact, location)
- `jobs/[id]/quote.tsx` — upload quote PDF
- `jobs/[id]/complete.tsx` — upload completion photos + mark done
- `earnings.tsx` — earnings history + payout request
- `profile.tsx` — vendor profile + rating

---

### Block 43 — Estate: Notification Types
**Flag:** `FEATURE_ESTATE_NOTIFICATIONS_ENABLED`

Backend deliverables:
- Extend `backend/internal/notifications/` with estate notification types: `visitor_arrived`, `visitor_denied`, `visitor_overstayed`, `payment_due`, `payment_overdue`, `restriction_applied`, `restriction_lifted`, `meeting_reminder`, `task_assigned`, `task_overdue`, `repair_update`, `vendor_assigned`, `election_reminder`, `election_result`, `announcement`, `emergency_alert`, `facility_booking_confirmed`, `admin_approval_required`
- Each type uses the asynq queue (`platform/queue`) and sends via Expo push token (stored on user profile)

Mobile screens:
- `apps/mobile-starter/app/(protected)/notifications/index.tsx` — notification center (already exists as part of mobile app; extend with estate notification cards and deep-link routing)

---

### Block 44 — Estate: Reports & Analytics
**Flag:** `FEATURE_ESTATE_ANALYTICS_ENABLED`

Backend deliverables:
- Go service: `GetVisitorAnalytics()`, `GetGateAnalytics()`, `GetPaymentAnalytics()`, `GetRepairAnalytics()`, `GetFacilityAnalytics()`, `GetMeetingAttendanceAnalytics()`, `GetElectionTurnoutAnalytics()`, `GetSecurityAnalytics()`, `GetVendorPerformance()`
- API routes: `/api/finance/estate/:id/analytics/:type?from=&to=`

Mobile screens (`apps/mobile-starter/app/(protected)/estate/analytics/`):
- `index.tsx` — analytics hub (tabs: visitors, payments, repairs, facilities, meetings, elections, security)
- Each tab renders a bar/line chart (use `react-native-chart-kit` or `victory-native`) + summary stats

---

### Block 45 — Estate: Settings & Account
**Flag:** N/A — ships with all estate flags

Backend deliverables:
- API routes: `PATCH /api/finance/estate/profile/settings` (notification preferences, privacy, biometric flag), `POST /api/finance/estate/profile/change-password`, `DELETE /api/finance/estate/profile` (soft delete — anonymises PII)

Mobile screens (`apps/mobile-starter/app/(protected)/estate/settings/`):
- `index.tsx` — settings hub
- `notifications.tsx` — per-event notification toggles
- `privacy.tsx` — who can see my unit, my vehicle, my profile
- `security.tsx` — change password, biometric, 2FA, active devices
- `household.tsx` — household member preferences
- `visitor-defaults.tsx` — default visitor access duration and code type

---

### Block 46 — Estate: Empty, Error & Edge States
**Flag:** N/A — ships alongside each feature block

> All estate screens must handle these states without crashing. Implement a shared `EstateEmptyState` component and `EstateErrorBoundary`.

Mobile deliverables:
- `apps/mobile-starter/src/components/estate/EstateEmptyState.tsx` — reusable empty state (icon, title, subtitle, optional CTA)
- `apps/mobile-starter/src/components/estate/EstateErrorBoundary.tsx` — React error boundary with retry button
- Per-screen empty states: no visitors, no active codes, no payments, no meetings, no tasks, no repairs, no elections, no properties, no announcements, no documents
- Per-screen error states: server error, no internet, session expired, access denied, maintenance mode, app update required
- Code states: QR expired, invalid code, code already used, voting closed, voting already submitted, subscription expired, property not verified, resident ineligible, admin approval required

Acceptance criteria:
- [ ] No estate screen renders a blank white screen on empty data
- [ ] Network errors show retry button that re-triggers the query
- [ ] Expired QR codes show expiry timestamp and "Request new code" CTA

---

### Block 47 — Estate: Production Hardening, QA & Launch Readiness
**Flag:** All Estate flags stay default-off until this block passes

> This is the final release gate after Blocks 24-46. It does not add new product scope; it proves the Estate product is production ready.

Backend deliverables:
- Security review: role/permission matrix tests for resident, homeowner, tenant, landlord, estate admin, property manager, security guard, exco, vendor, and finance/admin.
- Data protection: PII inventory for profiles, vehicles, documents, visitor logs, incident evidence, AI notes, and payment records; add retention and soft-delete behavior where missing.
- Audit coverage: immutable audit events for approvals, denials, scans, payments, refunds, bans, waivers, document access, admin config changes, and exports.
- Observability: structured logs, metrics, and trace IDs for all Estate routes; alerting for payment failures, queue failures, notification failures, scan latency, and failed uploads.
- Performance: indexes and query plans for dashboard, guard expected-visitors, access-code lookup, payment outstanding, resident search, property search, and analytics endpoints.
- Background jobs: recurring jobs for visitor overstay detection, payment overdue checks, restriction application/restoration, meeting reminders, task reminders, repair SLA escalation, subscription expiry, and analytics rollups.
- Disaster recovery: backup/restore runbook for Estate tables, R2 buckets, and notification queues.

Mobile deliverables:
- End-to-end smoke scripts for each actor app: resident, estate admin, security guard, landlord, property manager, exco, and vendor.
- App startup bootstrap: fetch active estate, active property, role, restrictions, feature flags, unread notifications, and pending approvals in one stable sequence.
- Deep-link validation: every notification type opens the expected screen or a safe fallback if the target record is unavailable.
- Accessibility pass: labels for QR scanner controls, form fields, buttons, status chips, payment actions, and destructive/admin actions.
- Device QA: verify camera, file upload, share, SMS, WhatsApp, push notification, offline guard sync, and payment callback flows on iOS and Android.
- Store readiness: privacy copy, permission strings, app update requirement handling, maintenance mode, support contact, and account deletion flow.

Release acceptance criteria:
- [ ] `go test ./...` green.
- [ ] Mobile typecheck and lint green.
- [ ] OpenAPI validates and covers all Estate routes.
- [ ] All Estate feature flags default to off and can be enabled per environment.
- [ ] No live Estate screen depends on placeholder data.
- [ ] All money flows reconcile ledger entries, receipts, and payment schedules.
- [ ] All upload flows use presigned R2 URLs and enforce file type/size limits.
- [ ] Role-based access tests prove users cannot access another estate, property, tenant, resident, visitor, document, payment, or incident.
- [ ] Launch runbook documents rollback, flag disable, incident escalation, and support handoff.

---

## Estate production integration plan

> Use this section for every Estate block from 24 through 46. Do not rebuild Block 23 screens or endpoints unless an acceptance test proves the existing implementation is incomplete.

### Existing Estate assets to reuse

Before starting any Estate block, inspect these files and extend them in place:

| Asset | Reuse rule |
|-------|------------|
| `backend/internal/estate/model.go` | Add Estate domain structs and request/response models here unless a file is already split by capability. |
| `backend/internal/estate/service.go` | Keep core Estate flows here; add scoped service files only when a capability is large enough to justify separation. |
| `backend/internal/estate/handler.go` | Add handlers beside existing Estate handlers; do not create a second Estate router stack. |
| `backend/internal/app/finance_routes.go` | Wire all Estate routes under the existing `/api/finance/estate` group. |
| `contracts/openapi.yaml` | Extend the existing OpenAPI spec; route names, schema names, and error formats must match backend handlers. |
| `apps/mobile-starter/src/api/estate.api.ts` | Extend the existing typed Estate client and mappers; do not create parallel clients per feature block. |
| `apps/mobile-starter/app/(protected)/estate/` | Reuse the existing Estate route tree and screens from Block 23; add nested routes for new flows. |

Existing Block 23 routes and mobile flows are the baseline:
- `POST /api/finance/estate`
- `GET|POST /api/finance/estate/:id/passes`
- `POST /api/finance/estate/:id/passes/scan`
- `GET|POST /api/finance/estate/:id/elections`
- `POST /api/finance/estate/:id/elections/:electionId/vote`
- `GET /api/finance/estate/:id/elections/:electionId/results`

Any replacement of those routes requires a failing acceptance test and a migration note in the block PR.

### API naming contract

Use one consistent route family so mobile, backend, and OpenAPI stay aligned:

| Resource | Route pattern |
|----------|---------------|
| Estate collection | `/api/finance/estate` |
| Estate-scoped resources | `/api/finance/estate/:estateId/{resource}` |
| Nested resource detail | `/api/finance/estate/:estateId/{resource}/:resourceId` |
| Actor workflows | `/api/finance/estate/:estateId/{actor}/{action}` such as `/guard/checkin` |
| Current-user profile/context | `/api/finance/estate/profile` and `/api/finance/estate/context` |
| Vendor global onboarding | `/api/finance/estate/vendor/...` only when the vendor is not yet attached to an estate |

Conventions:
- Use `:estateId`, `:propertyId`, `:residentId`, `:accessCodeId`, `:electionId`, `:meetingId`, `:taskId`, `:repairId`, `:facilityId`, and `:documentId` consistently in code and docs.
- Prefer state-transition endpoints such as `/review`, `/approve`, `/reject`, `/revoke`, `/extend`, `/cancel`, `/restore`, and `/sync` over ambiguous generic `update` endpoints.
- All mutation responses return the updated resource plus a stable `status` field.
- List endpoints use `limit`, `cursor`, `status`, `from`, `to`, and `search` consistently.
- Conflicts return 409, validation failures return 422, forbidden role access returns 403, and missing records return 404.
- Any endpoint that changes money, approval state, scan/check-in state, upload finalization, or offline sync requires `Idempotency-Key`.

### Execution order for each Estate block

Use this order inside each feature branch:

1. Update `contracts/openapi.yaml` and request/response schemas.
2. Add migrations, RLS, indexes, constraints, and seed data if needed.
3. Implement backend service methods, handlers, routes, auth checks, and tests.
4. Update `apps/mobile-starter/src/api/estate.api.ts` with typed API functions and mappers.
5. Build mobile screens and route entries using existing app components.
6. Wire TanStack Query hooks, mutation invalidation, loading/error/empty states, and feature flag checks.
7. Add notifications, audit events, storage upload finalization, and deep links where the workflow crosses actors.
8. Run backend tests, mobile typecheck, and manual smoke tests for the primary path and the approval/rejection path.

### Per-block delivery contract

Every Estate block must ship the same four layers:

1. **Contract first**
   - Add or update `contracts/openapi.yaml` for every new endpoint before backend work.
   - Include request/response schemas, auth requirements, error responses, pagination, filters, and idempotency headers where required.
   - Regenerate or manually update mobile API types in `apps/mobile-starter/src/api/estate.api.ts`; do not leave raw `any` payloads.

2. **Backend endpoint**
   - Add additive-only Supabase migrations with RLS, CHECK constraints, FK constraints, unique indexes, and audit fields.
   - Implement Go service methods under `backend/internal/estate/` or a scoped file such as `payment_service.go`, `meeting_service.go`, or `analytics_service.go`.
   - Wire handlers in `backend/internal/estate/handler.go` and routes in `backend/internal/app/finance_routes.go`.
   - Enforce role permissions server-side for resident, tenant, homeowner, landlord, estate admin, security guard, property manager, exco, vendor, and finance/admin users.
   - For money flows, use kobo integers, `Idempotency-Key`, ledger-backed debit/credit, audit events, and existing settlement/refund services.

3. **Mobile UI development**
   - Build screens only for routes listed in the relevant block and reuse existing `AppScreen`, `AppCard`, `AppButton`, `AppInput`, `ChoiceList`, theme tokens, and Estate empty/error components.
   - Add route guards and role-aware navigation. Hidden tabs are not security; backend role checks are still required.
   - Use TanStack Query for all reads and mutations, with optimistic updates only where rollback is implemented.
   - Include loading, empty, error, offline, permission-denied, approval-pending, and feature-flag-off states.
   - Upload photos, PDFs, audio, IDs, receipts, and evidence through presigned R2 flows; never send large base64 payloads through JSON endpoints.

4. **Integration and release readiness**
   - Add integration tests for every endpoint: success, validation failure, unauthorized, forbidden role, not found, conflict, and idempotent retry.
   - Add mobile smoke tests or component tests for each critical flow: submit, approval, rejection, payment, scan, upload, and deep-link navigation.
   - Add analytics/audit events for admin actions, money actions, access decisions, security incidents, document approvals, and profile restrictions.
   - Add notification jobs and deep-link targets for flows that require another actor to respond.
   - Update `.env.example` files for new feature flags, storage buckets, queue names, provider keys, and callback URLs.

### Backend endpoint checklist by capability

| Capability | Required endpoint behavior |
|------------|----------------------------|
| Estate onboarding | Search estates, join by invite/QR, request access, approve/reject, and return current membership/property context in one bootstrap response. |
| Resident profile | CRUD profile, household, staff, vehicles, documents, privacy settings, ID card payload, and verification status. |
| Dashboard | Single aggregate endpoint per estate/user, cacheable for short TTL, with counts and next actions for cards. |
| Visitors | Create/revoke/extend/share access codes, list active/expired/revoked, check-in/out, blacklist, bulk event guests, and overstay detection. |
| Guard | Scan QR, manual lookup, resident lookup, expected visitors, approve/deny entry, capture evidence, offline sync, shift handover, and incident escalation. |
| Property | List/detail/update properties, assign landlord/tenant, transfer, archive, upload docs/photos, inspection report, maintenance history, and analytics. |
| Payments | Levies, rent schedules, invoices, payment methods, wallet/card/bank/USSD initiation, receipt, proof review, waiver, restriction, restoration, refund, and reconciliation. |
| Elections | Eligibility, nominations, candidate approval, voting, duplicate-vote conflict, live/final results, audit log, observer access, and disputes. |
| Meetings | CRUD meetings, RSVP, agenda, documents, QR/manual attendance, live notes, minutes, decisions, action items, cancellation, and reschedule notices. |
| AI notes | Audio upload, processing status, transcript, summary, action item extraction, approval/rejection, regeneration, translation, PDF export, and consent logging. |
| Tasks | CRUD tasks, assignment, checklist, comments, status transitions, approvals/rejections, reminders, escalation, calendar, and analytics. |
| Repairs | Report issue, upload evidence, assign vendor, quote approval, repair payment, status tracking, completion evidence, resident confirmation, rating, and warranty. |
| Facilities | Availability, rules, booking payment, QR pass, cancellation, refund, restricted-access checks, history, and admin facility management. |
| Community | Announcements, read receipts, forum posts, comments, reports, moderation, group chat entry points, and targeted push delivery. |
| Emergency | Panic request, incident report, evidence upload, anonymous option, escalation, response status, resolution, and history. |
| Documents | Category list, upload, approval, restricted access checks, presigned download, archive, and share metadata. |
| Finance | Revenue summary, resident/property ledgers, failed payment recovery, reconciliation, refunds, exports, and defaulter reports. |
| Admin | Estate overview, residents, approvals, security staff, vendors, committee roles, permissions, rules, dues, repair categories, facilities, audit logs, reports, and export. |
| Landlord | Properties, tenant requests, move-in/out approvals, rent status/history, notices, repairs, inspections, and income reports. |
| Vendor | Onboarding, verification, available/assigned jobs, accept/reject, gate check-in, quote, invoice, completion photos, earnings, payout, rating, and support. |
| Notifications | Persisted notification center plus Expo push with typed deep links for every actor handoff. |
| Analytics | Date-filtered analytics for residents, visitors, gates, payments, subscriptions, defaulters, repairs, facilities, meetings, tasks, elections, occupancy, incidents, vendors, and AI usage. |
| Settings | Profile, household, property, visitor defaults, payments, subscriptions, notifications, privacy, security, password, biometric, 2FA, devices, language, theme, support, legal, delete account, and logout confirmation. |

### Mobile integration checklist by capability

| Capability | UI integration tasks |
|------------|----------------------|
| Estate onboarding | Persist selected `estate_id` and `property_id`; bootstrap app context after login and after switching estate/property. |
| Role navigation | Implement the recommended bottom navigation by `estate_role`; use deep links from notifications to open the correct stack. |
| Camera flows | Request permissions before QR/ID/plate/photo screens; show camera-denied state with settings CTA. |
| Upload flows | Use document/image/audio pickers, presigned PUT, progress UI, retry, and server-side finalize endpoint. |
| Payment flows | Reuse existing wallet/payment clients, show pending/failed/successful states, verify callbacks, and refresh restrictions after payment. |
| Approval flows | Every pending approval screen must poll or refetch on push notification and show approved/rejected reasons. |
| Offline gate mode | Store guard scans/checkins in AsyncStorage with client-generated idempotency keys and sync status badges. |
| Sharing flows | Use native share, SMS, email, and WhatsApp deep links; never expose admin-only metadata in shared text. |
| Charts and reports | Use one chart library consistently and include empty, loading, and export states. |
| Access restrictions | Centralize restriction checks so visitor, voting, facility, meeting, repair, and community screens show the correct limited-access state. |

### Role and permission matrix

Server-side checks are mandatory. Mobile tab visibility is only a usability layer.

| Role | Allowed capabilities | Explicitly denied |
|------|----------------------|-------------------|
| `resident` | Dashboard, profile, visitors, payments, meetings, tasks assigned to self, repairs, facilities, community, documents visible to residents, emergency, notifications, settings. | Admin approvals, rule changes, other residents' private data, finance exports, guard scans. |
| `tenant` | Resident capabilities plus tenancy documents, lease dates, rent schedule, tenant repair requests, move-out request. | Ownership transfer, landlord income, tenant approval, admin billing setup. |
| `homeowner` | Resident capabilities plus ownership documents, property profile, property repairs, property payment ledger, tenant request review when also landlord. | Estate-wide admin actions unless assigned admin role. |
| `landlord` | Property dashboard, tenant list/profile, rent collection, tenant request approval, lease documents, property repairs/cost approval, income report. | Guard operations, estate-wide resident bans, estate rule configuration unless assigned admin role. |
| `estate_admin` | Estate overview, residents, properties, approvals, rules, dues, facilities, announcements, audit logs, analytics, bans/restores, security staff and vendor management. | Ledger mutation outside approved money services, direct wallet balance updates, self-approval where maker/checker applies. |
| `property_manager` | Property listing/detail/edit, occupancy, tenant assignment, inspections, maintenance history, property analytics, property reports. | Finance refunds, resident bans, election administration unless granted. |
| `estate_security` | Guard dashboard, scan/manual lookup, expected visitors, check-in/out, vehicle logs, incident reports, shift handover, offline sync. | Resident financial data, document downloads, voting, admin settings. |
| `exco` | Meetings, elections, tasks, announcements, reports scoped to committee permissions. | Payment refunds, vendor payouts, security check-ins unless separately granted. |
| `vendor` | Vendor profile, assigned/available repair jobs, quotes, invoices, completion evidence, earnings, payout request, support. | Resident directory, property financials beyond assigned job, estate admin settings. |
| `finance_admin` | Payment reconciliation, refunds, receipts, outstanding debt reports, finance exports, waivers where approved. | Security scans, resident private profile edits, election vote mutation. |

Permission tests required per block:
- Same-estate allowed and cross-estate denied.
- Same-property allowed and other-property denied where property scoped.
- Role allowed action succeeds; adjacent role gets 403.
- Maker/checker flows reject self-approval.
- Soft-deleted, archived, revoked, expired, or suspended records cannot be mutated except by explicit restore/reopen flows.

### Data, storage, and audit contract

| Data class | Storage rule | Audit rule |
|------------|--------------|------------|
| Profile PII | Store only required fields; soft delete/anonymise on account deletion. | Audit profile verification and admin edits, not every self-edit. |
| Identity, vehicle, ownership, lease, receipt, proof, quote, invoice, incident, and repair evidence files | Upload with presigned R2 PUT, store object key and metadata only, enforce file type and size, serve with presigned GET. | Audit upload finalization, download of restricted files, approval/rejection, archive. |
| Visitor access codes and check-ins | Store QR UUID and numeric code hash where possible; keep scan logs immutable. | Audit create, share intent, revoke, extend, check-in, checkout, denial, blacklist hit, overstay. |
| Payment schedules, receipts, refunds, restrictions, waivers | Kobo integers only; ledger-backed mutations; immutable receipts. | Audit every state transition and actor ID. |
| Elections and votes | Votes immutable; duplicate vote protected by DB uniqueness and service idempotency. | Audit eligibility checks, nominations, approvals, vote attempts, result publication, disputes. |
| AI notes and transcripts | Store consent, source audio object key, transcript, summary, and approval status; allow admin-controlled retention. | Audit start, upload, processing result, approval/rejection, export, translation. |
| Emergency and incident reports | Treat as sensitive; restrict by estate and role; anonymous reports must hide reporter outside trusted admin/security roles. | Audit every view, escalation, response update, and resolution. |

Migration requirements:
- Every table has `id`, `created_at`, and where mutable, `updated_at`.
- Estate-scoped tables include `estate_id` and indexes for common filters.
- User-owned tables include `created_by` or role-specific actor IDs.
- Status fields use CHECK constraints or typed enums with explicit allowed transitions in service code.
- Add UNIQUE constraints for idempotent workflows: invite usage, votes, active visitor codes, payment references, offline sync IDs, and receipt references.
- RLS must deny by default and be backed by service-level role checks.

### Notification and deep-link contract

Every notification emitted by Estate code must include:
- `type`
- `estate_id`
- `target_type`
- `target_id`
- `recipient_user_id`
- `actor_user_id` where applicable
- `title`
- `body`
- `deep_link`
- `created_at`

| Notification type | Trigger | Deep-link target |
|-------------------|---------|------------------|
| `admin_approval_required` | Access, property, tenant, proof, waiver, vendor, or document needs review. | Admin pending approvals screen filtered by target type. |
| `visitor_arrived` | Guard checks in a visitor. | Visitor code detail/history. |
| `visitor_denied` | Guard denies entry or blacklist blocks scan. | Visitor denied detail. |
| `visitor_overstayed` | Overstay background job detects expired active visit. | Visitor history / guard alert. |
| `payment_due` / `payment_overdue` | Schedule due or overdue job runs. | Payment outstanding screen. |
| `payment_successful` | Payment schedule marked paid. | Receipt detail. |
| `restriction_applied` / `restriction_lifted` | Payment restriction state changes. | Restriction or restored confirmation screen. |
| `meeting_reminder` | Meeting reminder job. | Meeting detail. |
| `task_assigned` / `task_overdue` | Task assignment or overdue job. | Task detail. |
| `repair_update` | Repair status, quote, vendor, or completion state changes. | Repair ticket detail. |
| `vendor_assigned` | Vendor is assigned to a repair. | Vendor job detail. |
| `election_reminder` / `election_result` | Election starts, nears close, or results publish. | Election detail or results. |
| `announcement` | Announcement published. | Announcement detail. |
| `emergency_alert` | Panic or emergency incident escalates. | Incident detail / security alert. |
| `facility_booking_confirmed` | Facility payment/booking confirmed. | Booking QR pass. |

Deep-link fallback: if the target record is missing, forbidden, archived, or belongs to another estate, route to the relevant dashboard with a user-readable unavailable state.

### Test matrix

Each Estate block must add focused tests at the correct layer:

| Layer | Required coverage |
|-------|-------------------|
| OpenAPI | New routes validate, schemas include success and error responses, `Idempotency-Key` documented for required mutations. |
| Migration | Additive-only, constraints enforce status/amount/uniqueness, RLS denies cross-estate access. |
| Go service | Happy path, validation, forbidden role, conflict/idempotency, expired/revoked/archived records, state transition rules. |
| Go handler | JSON binding errors, auth missing, role denied, status codes, response shape, idempotency header handling. |
| Mobile API client | Typed request/response, path correctness, mapper behavior, user-readable error mapping. |
| Mobile UI | Loading, empty, error, success, approval pending/rejected, feature-flag-off, permission denied, retry. |
| Integration | Primary actor action creates notification for secondary actor; secondary approval/rejection updates original actor view. |
| Money flows | Ledger balance, receipt, schedule status, refund/reversal, restriction restoration, duplicate idempotency retry. |
| Offline flows | Guard actions persist locally, sync once, retry safely, and show conflict states. |
| Upload flows | Presign, PUT, finalize, invalid type, too-large file, retry, restricted download. |

### Required verification before marking any Estate block done

- [ ] `contracts/openapi.yaml` includes all new/changed routes.
- [ ] `go test ./internal/estate/...` passes.
- [ ] `go test ./internal/notifications/...` passes when notifications are touched.
- [ ] `go test ./...` passes before merge.
- [ ] `cd apps/mobile-starter && npm run typecheck` or the repo-equivalent TypeScript check passes.
- [ ] Manual mobile smoke path completed for the primary actor and secondary approval actor.
- [ ] Feature flag defaults to off in `.env.example`.
- [ ] No screen depends on demo placeholder data once the backend endpoint exists.

---

## Estate screen-group traceability

This maps the requested screen groups to build blocks. Block 23 is already done and must be reused, not rebuilt.

| Requested group | Build block | Coverage status | Notes |
|-----------------|-------------|-----------------|-------|
| B. Estate / Property Selection | Block 24 | Planned | Estate search, invite/QR join, access request states, property selection, ownership claim, tenancy request, and estate/property switchers. |
| C. Resident / Homeowner / Tenant Profile | Block 25 | Planned | Resident profile, contacts, next of kin, household, domestic staff, driver/vehicle, ID card, occupancy, lease, documents, verification, and privacy. |
| D. Home Dashboard | Block 26 | Planned | Resident dashboard cards, dues/property summaries, alerts, reminders, quick actions, optional weather/community update. |
| E. Visitor / Guest Access Codes | Block 27 | Extends Block 23 | Advanced visitor code types, QR/numeric codes, sharing, revoke/extend, arrival/checkout notifications, event guests, bulk upload, VIP/emergency access, denied access. |
| F. Security Gate / Guard | Block 28 | Planned | Guard login/dashboard, gate selection, QR/manual scan, visitor/resident lookup, approvals/denials, capture, offline sync, incident report, analytics summary. |
| G. Property Management | Block 29 | Planned | Listing/detail/edit, unit setup, landlord/tenant assignment, status, docs/photos, inspection, maintenance history, billing/compliance, transfer, archive, analytics. |
| H. Rent, Dues & Subscription | Block 30 | Planned | Dues, levies, rent schedules, invoices, balances, reminders, payment methods, receipts, plans, auto-renewal, disputes/extensions, debt recovery. |
| I. Payment Restrictions / Bans | Block 30 | Planned | Soft/hard restrictions, feature-specific lockouts, restoration, proof review, appeal, waiver, and audit trail. |
| J. Election Contest / Voting | Block 31 | Extends Block 23 | Election lifecycle, eligibility, nominations, candidates, campaigns, voting, receipts, live/final results, audit, disputes, admin setup. |
| K. Meeting Management | Block 32 | Planned | Meeting dashboard, calendar, create, invite, RSVP, detail, documents, attendance, live notes, minutes, decisions, actions, polls, archive, cancellation/reschedule. |
| L. AI Note-Taking | Block 33 | Planned | Audio upload/recording, live/async transcription, speakers, summaries, minutes, action items, decisions, approval/rejection, regeneration, translation, PDF export. |
| M. Task Management | Block 34 | Planned | My/assigned/created/estate tasks, meeting actions, create, assign, priority, attachments, checklist, comments, status, reminders, escalation, approval, calendar, analytics. |
| N. Repair / Maintenance | Block 35 | Planned | Repair reporting, category/location/urgency, evidence, tracking, inspection, vendor assignment, quote approval, payment, warranty, rating, vendor dashboards, preventive maintenance. |
| O. Facility / Amenity Booking | Block 36 | Planned | Facility list/detail, date/time, rules, payment, confirmation QR, cancellation/refund, history, unavailable/restricted states. |
| P. Announcements & Community | Block 37 | Planned | Announcements, alerts, reminders, read receipts, forum, comments, reports, moderation, direct/group chat entry points. |
| Q. Emergency & Security Incidents | Block 38 | Planned | Panic, emergency calls, incident forms, evidence, tracking, anonymous reports, escalation, history. |
| R. Document Management | Block 39 | Planned | Document dashboard, estate/rules/payment/meeting/election/property/lease/repair/receipt docs, upload/view/download/share/approve/archive/restrict. |
| S. Wallet, Billing & Finance | Block 40 | Planned | Estate revenue, levy/subscription/repair/facility revenue, eligibility reports, debt, ledgers, exports, reconciliation, refunds, failed payment recovery. |
| T. Admin / Estate Manager | Block 41 | Planned | Admin dashboard, resident/property/security/vendor/committee management, roles, approvals, defaulters, rules, dues, categories, facilities, announcements, audit, reports, export, settings. |
| U. Landlord / Property Owner | Block 41 | Planned | Landlord dashboard, properties, tenants, rent, lease, tenant approvals, move-in/out, repairs, cost approval, notices, inspection, income, outstanding payments. |
| V. Vendor / Artisan / Contractor | Block 42 | Planned | Onboarding, verification, jobs, accept/reject, route, gate check-in, quote, invoice, completion evidence, earnings, payout, rating, support. |
| W. Notifications | Block 43 | Planned | Notification center and typed deep links for visitor, payment, restriction, meeting, task, repair, vendor, election, announcement, emergency, facility, and admin approvals. |
| X. Reports & Analytics | Block 44 | Planned | Resident, visitor, gate, payment, subscription, defaulter, repair, facility, meeting, task, election, occupancy, incident, vendor, and AI notes analytics. |
| Y. Settings | Block 45 | Planned | Profile, household, property, visitor, payment, subscription, notification, privacy, security, password, biometric, 2FA, devices, language, theme, help/legal/delete/logout. |
| Z. Empty, Error & Edge States | Block 46 | Planned | Network/server/session/access/camera/location/payment/proof/account/restriction empty/error states and no-data screens. |
| Production hardening | Block 47 | Planned | Security, PII, audit, observability, performance, background jobs, QA, launch runbook, and rollback readiness. |

---

## Recommended bottom navigation (per user role)

| App | Tab 1 | Tab 2 | Tab 3 | Tab 4 | Tab 5 |
|-----|-------|-------|-------|-------|-------|
| Resident / Homeowner / Tenant | Home | Visitors | Payments | Community | More |
| Estate Admin | Dashboard | Residents | Payments | Security | More |
| Security Guard | Scan | Visitors | Residents | Incidents | Profile |
| Property Manager | Properties | Repairs | Payments | Tenants | More |
| Exco / Association | Meetings | Elections | Tasks | Announcements | Reports |
| Vendor / Artisan | Jobs | Schedule | Earnings | Messages | Profile |

> Implement role-based tab switching in `apps/mobile-starter/app/(protected)/(tabs)/_layout.tsx` gated on `user.estate_role`.

---

## Feature flag registry

All flags default to `false`. Set in environment to enable.

| Flag | Module |
|------|--------|
| `FEATURE_KYC_ENABLED` | KYC state machine |
| `FEATURE_WALLET_ENABLED` | Wallet + ledger |
| `FEATURE_VIRTUAL_ACCOUNTS_ENABLED` | DVA provisioning |
| `FEATURE_TIER_LIMITS_ENABLED` | Per-tier daily limits |
| `FEATURE_REFERRALS_ENABLED` | Referral rewards |
| `VOTES_BRIDGE_ENABLED` | Vote bridge |
| `FEATURE_WALLET_TRANSFERS_ENABLED` | Wallet-to-wallet |
| `FEATURE_BANK_TRANSFERS_ENABLED` | Wallet-to-bank |
| `FEATURE_BENEFICIARIES_ENABLED` | Saved beneficiaries |
| `FEATURE_FINTECH_ADMIN_ENABLED` | Finance admin dashboard |
| `FEATURE_TELEMEDICINE_ENABLED` | Telemedicine |
| `FEATURE_PHARMACY_ENABLED` | Pharmacy product catalogue and cart |
| `FEATURE_TRANSPORT_ENABLED` | Transport / ride-hailing |
| `FEATURE_RESTAURANT_ENABLED` | Restaurant delivery |
| `FEATURE_EVENTS_ENABLED` | Events & ticketing |
| `FEATURE_CROWDFUNDING_ENABLED` | Crowdfunding |
| `FEATURE_ESTATE_ENABLED` | Estate management (core) |
| `FEATURE_ESTATE_ONBOARDING_ENABLED` | Estate onboarding, invite codes, property selection |
| `FEATURE_ESTATE_PROFILES_ENABLED` | Resident profiles, household, vehicles |
| `FEATURE_ESTATE_DASHBOARD_ENABLED` | Resident home dashboard aggregation |
| `FEATURE_ESTATE_VISITOR_CODES_ENABLED` | Extended visitor access code system |
| `FEATURE_ESTATE_GUARD_ENABLED` | Security gate / guard app |
| `FEATURE_ESTATE_PROPERTY_MGMT_ENABLED` | Property management (landlord/tenant) |
| `FEATURE_ESTATE_PAYMENTS_ENABLED` | Dues, rent, subscriptions, payment restrictions |
| `FEATURE_ESTATE_ELECTIONS_EXTENDED_ENABLED` | Extended elections (nominations, eligibility, disputes) |
| `FEATURE_ESTATE_MEETINGS_ENABLED` | Meeting management, RSVP, attendance, minutes |
| `FEATURE_ESTATE_AI_NOTES_ENABLED` | AI meeting note-taking (Claude-powered) |
| `FEATURE_ESTATE_TASKS_ENABLED` | Task management |
| `FEATURE_ESTATE_REPAIRS_ENABLED` | Repair & maintenance requests |
| `FEATURE_ESTATE_FACILITIES_ENABLED` | Facility / amenity booking |
| `FEATURE_ESTATE_COMMUNITY_ENABLED` | Announcements & community forum |
| `FEATURE_ESTATE_EMERGENCY_ENABLED` | Emergency & security incident reporting |
| `FEATURE_ESTATE_DOCUMENTS_ENABLED` | Document management |
| `FEATURE_ESTATE_FINANCE_ENABLED` | Estate finance & wallet dashboard |
| `FEATURE_ESTATE_ADMIN_ENABLED` | Admin panel & estate configuration |
| `FEATURE_ESTATE_VENDOR_ENABLED` | Vendor / contractor app |
| `FEATURE_ESTATE_NOTIFICATIONS_ENABLED` | Estate notification types |
| `FEATURE_ESTATE_ANALYTICS_ENABLED` | Reports & analytics |
| `FEATURE_GROUPS_ENABLED` | Group savings |
| `FEATURE_AICARE_ENABLED` | AI Care |
| `FEATURE_RATINGS_ENABLED` | Ratings |
| `FEATURE_DISPUTES_ENABLED` | Disputes |
| `FEATURE_FX_ENABLED` | FX / currency conversion |

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend API | Go 1.23, Gin v1.10 — NOT Chi |
| DB access (money path) | pgx pool (`backend/internal/platform/db/`) |
| DB access (Spotlight) | Supabase REST + SQL RPCs |
| Queue | Redis via asynq (`backend/internal/platform/queue/`) |
| Cache / Redlock | Redis (`backend/internal/platform/redis/`) |
| Payments | Paystack (HMAC-SHA512 webhook) |
| FX | Maplerad |
| Frontend web | Next.js 14.2, TypeScript, Supabase SSR |
| Frontend admin | Next.js 15.1, port 4030 |
| Mobile | Expo Router (React Native) |
| Auth | Supabase Auth (JWT/HS256) |
| Storage | Cloudflare R2 |
| Email | Resend |

## Key financial constants

| Constant | Value | Notes |
|----------|-------|-------|
| Referral reward | 50,000 kobo (₦500) | at-most-once via UNIQUE(referrer_id, referred_id) |
| Transport base fare | 150,000 kobo (₦1,500) | before surge multiplier |
| Restaurant delivery fee | 50,000 kobo (₦500) | flat fee |
| Telemedicine split | 85% doctor / 15% platform | settled via settlement.Service |
| Wallet transfer fee bands | ₦0–₦5k: free; ₦5k–₦50k: ₦10; >₦50k: ₦25 | |
| Bank transfer fee bands | ₦0–₦5k: ₦10; ₦5k–₦50k: ₦25; >₦50k: ₦50 | min transfer ₦1,000 |
| Admin adjustment auto-execute | < 100,000,000 kobo (₦1,000,000) | ≥ this requires checker |
