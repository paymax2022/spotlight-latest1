# Estate & Visitor Access — UAT Gap Analysis

**Method:** every case in `Estate_Visitor_Access_UAT_Workplan_Test_Cases.md` (443 scenarios, M01–M23) was
compared against the code that actually exists in this monorepo (`backend/internal/estate`,
`backend/internal/app/finance_routes.go` estate block + `estate_admin_routes.go`, `supabase/migrations/*estate*`,
`mobile-app/reactnative/app/{visitor,estate-admin,estate-settings,estate-notifications}`).
Read-only comparison — no code changed to produce this. Per-case rows live in `sections/`.

**Honesty rule (carried from the crypto UAT):** a case is **Implemented** only with route + service logic +
data model + (where the case names a channel) a UI surface, and money/permission cases need *server-side*
enforcement. **Partial** = surface exists but a required invariant/branch is unproven or absent.
**Missing** = the capability is not in the repo. **Not-verifiable-in-repo** = needs a staging/device/load/scan
lab we are not authorized to run; it is *never* Pass. This document cannot and does not certify "100%": see
Release readiness.

## Aggregate (443 cases)

| Group | Cases | Implemented | Partial | Missing | Not-verifiable | Section |
| --- | --- | --- | --- | --- | --- | --- |
| M01–M04 account/estate/property/RBAC | 68 | 10 | 31 | 26 | 1 | `sections/m01-m04.md` |
| M05–M06 **visitor / gate (namesake)** | 47 | 4 | 28 | 15 | 0 | `sections/m05-m06.md` |
| M07–M09 dues/rent/payments | 70 | 11 | 20 | 39 | 0 | `sections/m07-m09.md` |
| M10–M14 meetings/elections/facilities/docs/vendors | 107 | 12 | 41 | 54 | 0 | `sections/m10-m14.md` |
| M15–M18 comms/emergency/reports/notifications | 69 | 5 | 23 | 41 | 0 | `sections/m15-m18.md` |
| M19–M23 integration/privacy/a11y/super-admin/history | 82 | 6 | 27 | 32 | 17 | `sections/m19-m23.md` |
| **Total** | **443** | **48** | **170** | **207** | **18** | |

What is genuinely solid today: cross-estate data isolation in most read paths, the card-payment money path
(settlement/webhook dedup/forgery/replay idempotency/kobo precision, live-DB tested), visitor code CRUD +
estate binding of codes, and the resident mobile visitor surface. The gaps are in **authorization depth,
the guard/gate operational loop, election secrecy, money completeness, and platform guardrails.**

## Cross-cutting risks (appear across modules; ordered by severity)

1. **Privileges are self-grantable.** Any authenticated user can `POST /estate` and become `estate_admin`;
   the merchant/KYC upgrade approval is never consulted on estate routes (`estate/service.go:~52`). No
   delegated officer roles exist — `estate_residents` CHECK allows only `resident`/`estate_admin`
   (`20260616250000_estate.sql`), so Meeting Secretary / Election / Facility / Finance / Gate Officer all
   collapse to `estate_admin`. Undermines M01/M02/M04 and the authorization premise of M05–M14. (P0)
2. **The visitor/gate loop is not enforced where it runs.** The namesake vertical: guard writes gate only on
   "estate member" (`assertResident`), so any resident can check visitors in/out and forge offline logs; the
   mobile admit BFF never re-checks expiry/single-use/max_uses and never increments `used_count`; `gate_sessions`
   is read-only (no way to start a shift → the whole mobile guard channel dead-ends); resident arrival-approval
   is a fire-and-forget notification, not a request/accept/decline; offline mode is storage-only and
   revocations never reach devices; QR is unsigned and 6-digit codes are non-crypto with no rate limit. (M05/M06, P0)
3. **Election ballot secrecy is violated by construction.** `election_votes` stores `voter_id`+`candidate_id`
   in one plaintext row (`service.go:~255`) although `model.go:~61` claims a commitment hash; an officer /
   super-admin can join voter↔choice. A correct anonymous-ballot schema exists only in the unused
   `association` module. No draft→open→close→certify lifecycle, quorum, tie, nomination or recount. (M11/M20/M23, P0)
4. **Money verticals are half-built.** No partial-allocation / multi-creditor model (`service_dues.go:~240`
   rejects any amount ≠ the exact invoice); no refund surface (gateway refund only in failed-checkout
   auto-reversal, `PostReversal` unwired); all estate money sits in one platform `settlement` account —
   vendor bank accounts are stored but never verified or paid, and the vendor self-initiates their own payout
   with no finance approval / three-way match; rent/lease vertical is essentially dates-only (no rent
   invoices/deposits/late fees/renewals); billing is manual single-invoice inserts with no idempotency,
   penalties, waivers/write-offs or locked periods. (M07/M08/M09/M14, P0)
5. **Platform guardrails absent.** No rate limiting on any estate route (incl. SOS/emergency raise) though
   `PerUserRateLimit` infra exists; session revocation unenforced (estate uses plain `RequireAuthContext`);
   no MFA/step-up for finance/estate-admin/super-admin (`two_factor_enabled` stored, never checked); audit
   is fail-open on non-money paths with no before/after values or cross-estate search; document repository
   has no versioning/expiry/legal-hold/e-signature and presign size/type is client-declared; legacy
   documents passthrough raw URLs bypassing presign TTL. (M13/M20/M22, P0)
6. **Comms/emergency/reporting channels are half-wired.** RN announcement/emergency screens hit insert-only
   `frontend-web /api/v1/estate/*` routes; the Go push fan-out is unreachable from them, so SOS/announcements
   notify nobody on the primary client path; notification preferences are stored but never enforced; no
   incident lifecycle model (severity/ack/owner/timeline/evidence/reopen) or escalation scheduler; only live
   JSON aggregates — no CSV/XLSX/PDF export, rent roll, or PII-scoped exports; several reminder notification
   types are dead constants and queue replay has no dedupe key. (M15/M16/M17/M18)

## Decomposition — sub-projects (risk-ranked)

Each SP is independently spec'able, buildable and testable; each gets its own gap-close + E2E pass. Build order
follows dependency then risk: authorization is the substrate most others assert against.

- **SP-01 · Authorization foundation** — merchant/KYC gate on estate routes; delegated officer role model +
  grant/revoke/expiry; server-side role checks on guard/vendor/finance/election/facility/secretary writes;
  close the `ListEstates` cross-estate leak. (M01 M02 M04, underpins M05–M14). Blocks meaningful E2E elsewhere.
- **SP-02 · Visitor/gate operational loop (namesake)** — server-side admit validation (expiry/single-use/
  max_uses/revoked + atomic `used_count`), guard shift lifecycle (`gate_sessions` write), resident
  arrival-approval request/accept/decline/timeout, signed QR + rate-limited codes, gate↔estate binding,
  offline mode + revocation propagation. (M05 M06)
- **SP-03 · Election secrecy + lifecycle** — anonymous-ballot schema (seal voter↔choice, officer cannot join),
  draft→open→close→certify, quorum/tie/nomination/recount, result certification artifact. (M11 M20 M23)
- **SP-04 · Money completeness** — idempotent assessment engine; partial allocation / multi-creditor; refund
  surface with dual control; settlement-to-beneficiary + vendor payout approval (three-way match, verified
  account); rent/lease vertical. (M07 M08 M09 M14)
- **SP-05 · Guardrails & document governance** — mount rate limiting + session-revocation + MFA/step-up on
  finance/admin; fail-closed audit with before/after + cross-estate search; document versioning/retention/
  legal-hold/e-signature + content-verified presign. (M13 M17 M20 M22)
- **SP-06 · Comms / emergency / reporting** — wire mobile→Go notification fan-out + enforce preferences;
  incident lifecycle + escalation SLA; report exports (CSV/XLSX/PDF) with cross-estate isolation; reminders +
  delivery dedupe. (M15 M16 M17 M18)
- **SP-07 · External-lab gates (cannot be closed by repo code)** — VAPT (ASVS/API-Top10/MASVS), accessibility,
  performance/SLO/soak, chaos/DR/reconciliation drills, provider/sandbox integration contract runs. Marked
  **Blocked** until an authorized staging/device/load/scan environment exists.

## SP-01 / SP-02 slice — delivery + verification run-log

Scope approved for this slice: the authorization foundation (SP-01) and the
namesake visitor/gate enforcement loop (SP-02). Delivered as additive backend
code; nothing removed or renamed.

**Built (code, compiles clean — `go build ./...`, `go vet ./internal/estate/...` pass):**

- Migration `20271087000000_estate_delegation.sql` — `estate_staff_grants` (7
  scoped officer roles, expiring/revocable, `estate_admin` deliberately excluded),
  `visitor_access_codes.{require_host_approval,gate_id}`, `visitor_arrival_requests`,
  and the `estate_management` onboarding seed the creation gate checks against.
- `service_delegation.go` — `assertGate` (fail-closed: non-member / banned /
  deleted / no-live-grant all denied; `estate_admin` or a live gate grant passes),
  `GrantRole`/`RevokeRole`/`ListGrants`, `RequestArrival`/`DecideArrival`,
  `latestArrivalStatus`, `EstateMerchantGate` seam.
- `CreateEstate` now fails closed on the (flag-gated, default **off**) merchant gate.
- `ListEstates` scoped to membership-or-live-grant (was an unscoped cross-estate read).
- Guard endpoints (`expected-visitors`, `lookup`, `checkin`, `checkout`,
  `arrival-request`) switched from `assertResident` → `assertGate(gate_officer,
  gate_supervisor)`; `CheckInVisitor` admits via a single atomic conditional
  `UPDATE … WHERE used_count < max_uses` + `RowsAffected==0 → deny`, closing the
  expiry/single-use/max_uses race; host-approval codes stay shut until approved.
- Routes + per-user rate limits (`estate-guard`, `estate-code`) + feature flag
  `FEATURE_ESTATE_MERCHANT_GATE` (default off) wired in `finance_routes.go` / `config.go`.

**Verification:**

- `delegation_test.go` — 8 DB-free domain tests. **PASS** (`go test ./internal/estate/`).
- `delegation_live_db_test.go` — 10 live-DB tests (assertGate fail-closed, grant/
  revoke/expiry, ListEstates isolation, single-use atomic **concurrent race**,
  expiry-deny, guard-authz-on-checkin, arrival gating approve/decline, arrival
  decision authz, full E2E journey). **PASS** against the local Supabase stack
  (`postgresql://…@127.0.0.1:54322/postgres`) with migration
  `20271087000000_estate_delegation.sql` applied; ledger row repaired as applied.
  - The live run surfaced and fixed two bugs the DB-free pass could not:
    (a) `RequestArrival` INSERT bound `gate_id` as text → Postgres rejected the
    uuid column; corrected to `NULLIF($5,'')::uuid`.
    (b) `ListEstates` SELECT read `estates.address` directly, but the column is
    nullable and `Estate.Address string` errored on any matched row; corrected to
    `COALESCE(e.address,'')`. This also closed a latent read bug for any estate
    without an address.
- Wider regression: `go test -p 2 ./internal/estate/...` and `./internal/app`,
  `./internal/config`, `./internal/cryptosvc`, `./internal/onboarding` — all green
  against the live DB. Three packages fail for pre-existing reasons unrelated to
  this slice: `./internal/restaurant` (KYB ON CONFLICT against a missing local
  index), `./tests/ledger` (global conservation over 88k dirty local rows), and
  `./tests/referrals` (a seeded code collision). None touch tables this slice
  creates or alters.

**Not in this slice (honestly still Missing/Partial):** guard `gate_sessions`
shift-lifecycle writes, signed/HMAC QR, offline buffer + revocation propagation,
gate↔estate hard binding, and all of SP-03…SP-07.

## Release readiness — "is this 100% functional?"

**No, and it cannot be certified at 100% this session.** 207 Missing + 170 Partial + 18 lab-only cases, with P0
authorization, election-secrecy, gate-enforcement and money gaps open, means a truthful GO is not available.
Per the standing rule, unresolved items stay Blocked/Partial/Not-run, never Pass. A real GO additionally needs:
owner-ratified business rules (§2.3 of the workplan are illustrative), independent VAPT with no open Crit/High,
numeric SLO/DR gates, and human signoff (§14). Until then the deliverable is the prioritized gap backlog above,
closed slice-by-slice with E2E evidence per slice.
