# Module: Estate (super-app residential estate management)

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_ESTATE_ENABLED` (config field `FeatureEstateEnabled`, default OFF — `backend/internal/config/config.go:146,557`)
**Code:** `backend/internal/estate/` — `handler.go`, `handler_modules.go`, `service.go`, `service_dues.go`, `service_modules.go`, `model.go`, `model_modules.go`, `vendor.go`, `meetings.go`, `election_eligibility.go`, `property_mgmt.go`, `notifications.go`, `settings.go`, `analytics.go`, `ainotes.go`, `admin.go`, `presign.go`, `bridge.go`, `jobs.go`; routes in `backend/internal/app/finance_routes.go` (resident/guard/vendor surface, lines ~946–1129) and `backend/internal/app/estate_admin_routes.go` (platform oversight). Tests: `isolation_test.go`, `restriction_test.go`, `dashboard_test.go`, `admin_test.go`, `ainotes_test.go`, `analytics_test.go`, `meetings_test.go`, `settings_test.go`, `vendor_test.go`, `model_test.go`, `modules_test.go`, `property_mgmt_test.go`, `notifications_test.go`, `election_eligibility_test.go`, `presign_test.go`.
**Slug:** `ESTATE`

## 1. Overview & scope

The Estate module runs residential-estate operations for the super-app: gate security/guard app, visitor access codes and passes, resident/property directory, AGM elections, dues/rent billing and wallet settlement, vendor/contractor jobs and payouts, meetings + AI minutes, facilities booking, announcements/documents, emergencies, per-member settings and analytics. It is a **Tier-0 money-path** module: `PayDues` (service_dues.go) debits a resident's wallet and credits the estate settlement account, and `RequestPayout` (vendor.go) credits a vendor's wallet from settlement — both posting balanced double-entry journals through the finance ledger.

Authorization is **per-estate scoped membership**, not global RBAC: every resident/guard/vendor service method takes `(estateID, userID)` and resolves the caller's row in `estate_residents` via `assertRoles` (`service.go:1487`) — `assertResident` allows `resident|estate_admin`, `assertEstateAdmin` allows `estate_admin` only, and both fail closed on banned/deleted membership. The URL `:id` estate is authoritative and every query carries `WHERE estate_id=$1`, so a caller can never read or mutate another estate's rows. A **separate platform-oversight surface** (`estate_admin_routes.go`, mounted at `/api/finance/estate-admin`) is read-only and authorized purely by seeded `estate.admin.*` global RBAC slugs — it performs no mutations and never moves money. The whole module is gated by `FEATURE_ESTATE_ENABLED`; the sibling admin registrar is wired inside the same flag block and skips when the pgx pool is nil.

Cross-cutting behaviour is **not** re-derived here — see `../cross-cutting/money-invariants.md` (double-entry, idempotency, kobo), `../cross-cutting/authentication.md` + `../cross-cutting/session-and-tokens.md` (`RequireAuthContext`, `user_id` in context), `../cross-cutting/rbac-and-permissions.md` (the `estate.admin.*` slugs and scope-isolation cases RBAC-AUTHZ-005/006/007), `../cross-cutting/kyc-and-tiers.md` (election KYC gate + `EnforceWalletDebitLimit`), and `../cross-cutting/feature-flags-and-audit.md` (flag-off + immutable `estate_audit_log`).

## 2. Services / endpoints in scope

Money-path and authz-critical endpoints are listed individually; high-volume CRUD areas are grouped with a count. All resident routes are under `/api/finance/estate/:id/...` behind `RequireAuthContext`; oversight routes are under `/api/finance/estate-admin/...`.

| Operation | Method + path (or service func) | Auth / permission | Money-path? |
|---|---|---|---|
| Pay dues invoice | `POST /:id/dues/invoices/:invoiceId/pay` → `PayDues` | `assertResident` + owner (`resident_id==payer`) | **yes** |
| Create dues invoice | `POST /:id/dues/invoices` → `CreateInvoice` | `assertEstateAdmin` | yes (bills kobo) |
| List invoices | `GET /:id/dues/invoices` → `ListInvoices` | member; non-admin scoped to own | no |
| Apply dues restriction | `POST /:id/dues/restrictions` → `ApplyRestriction` | `assertEstateAdmin` | no |
| Lift dues restriction | `POST /:id/dues/restrictions/:residentId/lift` → `LiftRestriction` | `assertEstateAdmin` | no |
| Request vendor payout | `POST /:id/vendor/jobs/:jid/payout` → `RequestPayout` | vendor owner (`resolveVendorID`) | **yes** |
| Assign vendor job | `POST /:id/vendor/assign-job` → `AssignJob` | `assertEstateAdmin` | yes (sets amount) |
| Submit vendor quote | `POST /:id/vendor/jobs/:jid/quote` → `SubmitQuote` | vendor owner | yes (sets amount) |
| Vendor job lifecycle (accept/reject/checkin/start/complete/invoice/evidence) | `POST /:id/vendor/jobs/:jid/*` → `jobTransition`/`setJobURL` | vendor owner | no |
| Onboard/get/earnings/list-jobs vendor (4) | `/:id/vendor/*` | vendor self / owner | no |
| Cast vote | `POST /:id/elections/:electionId/vote` → `CastVote` | `assertResident` + not-restricted + eligibility | no |
| Create election | `POST /:id/elections` → `CreateElection` | `assertEstateAdmin` | no |
| Election results | `GET /:id/elections/:electionId/results` → `GetResults` | member (closed/tallied only) | no |
| Voter eligibility get/set (2) | `/:id/elections/:electionId/eligibility` | member / admin (set) | no |
| Issue / scan visitor pass (2) | `POST /:id/passes`, `/:id/passes/scan` | resident / admin | no |
| Access codes (create/list/get/revoke/extend/blacklist/history — 7) | `/:id/access-codes*` | member; blacklist admin | no |
| Guard/gate app (gates/expected/lookup/checkin/checkout/incident/incidents/handover/sync — 9) | `/:id/gates`, `/:id/guard/*` | member/guard/admin | no |
| Meetings + minutes lifecycle (create/list/get/rsvp/checkin/start/end/cancel/reschedule/minutes×3/documents×2 — 14) | `/:id/meetings*` | member; transitions admin | no |
| AI notes (generate/list/get/approve — 4) | `/:id/ai-notes*`, `/:id/meetings/:mid/ai-notes` | admin; LLM fail-closed | no |
| Properties + transfers/claims/tenancy (create/list/get/update/claim/review/landlord/tenant/occupancy/archive/transfer/analytics — ~20) | `/:id/properties*`, `/:id/property-transfers*` | member; mutations admin | no |
| Resident profile/household/staff/vehicles/id-card (~12) | `/:id/profile*` | self / member | no |
| Estate admin console (dashboard/residents/ban/restore/config/rules/subscription-plan/audit-log/run-maintenance — 9) | `/:id/admin/*` | `assertEstateAdmin` | no |
| Member settings + account delete (3) | `/:id/settings`, `/:id/account` | self | no |
| Tasks / repairs / facilities+booking / announcements / emergencies / documents (~20) | `/:id/tasks*`, `/:id/repairs*`, `/:id/facilities*`, `/:id/announcements*`, `/:id/emergencies*`, `/:id/documents*` | member; mutations admin; facility book not-restricted | no |
| Invite codes / join / access-request review (7) | `/:id/invite-codes`, `/join/invite`, `/:id/access-request*` | admin / self | no |
| Presigned upload | `POST /:id/uploads/presign` → `PresignUpload` | member; 503 if R2 unwired | no |
| Dashboard / finance-dashboard / notifications / reports (4) | `/:id/dashboard`, `/:id/finance/dashboard`, `/:id/notifications`, `/:id/reports` | member | no |
| **Oversight: security (gates/incidents/guard-shifts/visitor-logs/emergencies — 5)** | `GET /estate-admin/security/*` | `RequirePermission("estate.admin.security")` | no (read-only) |
| **Oversight: dues (reconciliation/invoices/payments/restrictions — 4)** | `GET /estate-admin/dues/*` | `RequirePermission("estate.admin.dues")` | no (read-only) |
| **Oversight: ops (repairs/tasks/meetings/facilities — 4)** | `GET /estate-admin/ops/*` | `RequirePermission("estate.admin.ops")` | no (read-only) |
| **Oversight: content (announcements/documents — 2)** | `GET /estate-admin/content/*` | `RequirePermission("estate.admin.content")` | no (read-only) |
| **Oversight: elections (list/results/audit — 3)** | `GET /estate-admin/elections*` | `RequirePermission("estate.admin.election")` | no (read-only) |

Total real endpoints enumerated: **~138 resident/guard/vendor/estate-admin routes** (finance_routes.go) **+ 18 platform-oversight routes** (estate_admin_routes.go) = **~156**.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| `PayDues` fails closed without Idempotency-Key | INV | `internal/estate/modules_test.go` (TestPayDuesRequiresIdempotencyKey) + `isolation_test.go` | AUTOMATED |
| `PayDues` fails closed without ledger wired | INV | `internal/estate/isolation_test.go` (TestMoneyPathGuardsPrecedeDataAccess) | AUTOMATED |
| Dues amount must be positive kobo | INV | `internal/estate/modules_test.go` (TestPayDuesRequestAmountInvariant) | PARTIAL (request-shape only) |
| `PayDues` server re-prices to invoice amount; rejects mismatch | INV | — (logic in `service_dues.go:159`) | TODO |
| `PayDues` double-entry DEBIT payer → CREDIT settlement | INV | — (needs live-DB / ledger integration) | TODO |
| `PayDues` idempotent replay returns canonical receipt | INV | — (logic in `service_dues.go:151,229`) | TODO |
| `RequestPayout` fails closed without Idempotency-Key | INV | `internal/estate/vendor_test.go` (TestRequestPayoutRequiresIdempotencyKey) | AUTOMATED |
| `RequestPayout` fails closed without ledger | INV | `internal/estate/vendor_test.go` (TestRequestPayoutRequiresLedger) | AUTOMATED |
| `RequestPayout` requires status=completed; idempotent when paid | FSM | — (logic in `vendor.go:295–327`) | TODO |
| Dues restriction soft/hard action matrix | UNIT | `internal/estate/restriction_test.go` (TestRestrictionMatrix, +unknown-level, +constants) | AUTOMATED |
| Restriction fail-closed on DB lookup error | UNIT | — (logic in `service_dues.go:337`) | TODO |
| Voter eligibility (KYC/payment/resident-type, fail-closed) | UNIT | `internal/estate/election_eligibility_test.go` (TestEvaluateEligibility, TestContainsString) | AUTOMATED |
| One-vote-per-voter replay guard | INV | `internal/estate/model_test.go` (TestOneVotePerResident, documents UNIQUE) | PARTIAL (doc-only; DB-enforced) |
| Election requires ≥2 candidates / lifecycle states | UNIT | `internal/estate/model_test.go` (TestElectionRequiresAtLeastTwoCandidates, TestElectionStatusValues) | PARTIAL |
| Election audit: ballots==distinct voters invariant | INV | — (logic in `estate_admin_routes.go:598` ElectionAudit) | TODO |
| Meeting mode/RSVP/checkin-method validators | UNIT | `internal/estate/meetings_test.go` | AUTOMATED |
| Meeting status transitions (scheduled→live→ended, cancel, reschedule) | FSM | — (logic in `meetings.go:230–295`) | TODO |
| Member-settings partial-update pointer contract | UNIT | `internal/estate/settings_test.go` (TestUpdateMemberSettingsAllPointers, +roundtrip) | AUTOMATED |
| Property occupancy/transfer-type/decision validators | UNIT | `internal/estate/property_mgmt_test.go` | AUTOMATED |
| Notification taxonomy (18 types, category, deep-link) | UNIT | `internal/estate/notifications_test.go` | AUTOMATED |
| Analytics types + date-range resolution | UNIT | `internal/estate/analytics_test.go` | AUTOMATED |
| Emergency-alert severity mapping | UNIT | `internal/estate/dashboard_test.go` (TestAlertSeverity) | AUTOMATED |
| `atoiDefault` helper | UNIT | `internal/estate/admin_test.go` | AUTOMATED |
| AI-notes JSON parse + LLM fail-closed interface | UNIT | `internal/estate/ainotes_test.go` | AUTOMATED |
| Presign: kinds, allowlist, unguessable token, 503-when-unconfigured, doc-download authz, TTL | SEC | `internal/estate/presign_test.go` (all 6 tests incl. TestDocDownloadAllowed) | AUTOMATED |
| Money guards precede any data access (nil-DB service) | AUTHZ | `internal/estate/isolation_test.go` (TestMoneyPathGuardsPrecedeDataAccess) | AUTOMATED |
| Cross-estate isolation contract (URL estate authoritative) | AUTHZ | `internal/estate/isolation_test.go` (TestCrossEstateIsolationContract, doc-level) | PARTIAL (doc; live-DB blocked) |
| Per-estate membership guard rejects non-members | AUTHZ | — (logic in `service.go:1487` assertRoles) | TODO |
| Oversight routes gated by `estate.admin.*` RBAC | AUTHZ | — (registration `estate_admin_routes.go:87–112`) | TODO |
| Feature-flag-off → routes absent | SEC | — (see `../cross-cutting/feature-flags-and-audit.md`) | TODO |
| Contract vs `openapi.yaml` | CON | — | TODO |

## 4. Manual test cases

Money test data is integer kobo; assertions are kobo-exact. Case-IDs are unique + sequential per (module, layer).

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `ESTATE-INT-001` | Resident pays own pending dues invoice from wallet | P0 | Resident member of estate-A with wallet balance ≥ invoice; ledger + tiers wired | `POST /:id/dues/invoices/:invoiceId/pay` with `Idempotency-Key` | invoice `amount_kobo=5_000_000`; wallet ≥ 5_000_000 | 200; receipt `status=successful`, `amount_kobo=5_000_000`; invoice→`paid`; DEBIT payer wallet 5_000_000 / CREDIT settlement 5_000_000 (balanced); audit `DUES_PAY` written |
| `ESTATE-INT-002` | Paying dues lifts an active dues restriction | P0 | Resident has active `hard` restriction + pending invoice | Pay the invoice per ESTATE-INT-001 | `amount_kobo=250_000` | 200; `estate_dues_restrictions.active=FALSE`, `lifted_at` set; resident may now vote/book |
| `ESTATE-INT-003` | Vendor payout credits vendor wallet for completed job | P0 | Vendor owns job in `completed`, `amount_kobo>0`, ledger wired | `POST /:id/vendor/jobs/:jid/payout` with `Idempotency-Key` | `amount_kobo=1_200_000` | 200; job→`paid`, `paid_at`/`payout_ref` set; CREDIT vendor wallet 1_200_000 / DEBIT settlement (balanced); audit `VENDOR_PAYOUT` |
| `ESTATE-VAL-001` | Reject dues payment with zero/negative amount override | P0 | Resident + pending invoice `amount_kobo=250_000` | Pay with `amount_kobo=-100` then `0` | override `-100`, `0` | Invoice-create path rejects non-positive (`CreateInvoice`); on pay, override ≠ invoice amount → error `amount must equal the invoice amount 250000 kobo` |
| `ESTATE-VAL-002` | Reject pay on waived invoice | P1 | Invoice `status=waived` | Pay it with valid key | — | Error `invoice has been waived`; no ledger posting |
| `ESTATE-VAL-003` | Vendor payout rejected when job not completed | P0 | Job in `accepted`/`in_progress` | `POST .../payout` with key | — | Error `job must be completed before payout`; no credit |
| `ESTATE-VAL-004` | Create election with <2 candidates rejected | P2 | Estate admin | `POST /:id/elections` with 1 candidate | 1 candidate | 400 (binding `min=2`) |
| `ESTATE-VAL-005` | Vote rejected when election not open / outside window | P1 | Election `draft` or now outside starts/ends | `POST .../vote` | — | Error `election is not currently open for voting` |
| `ESTATE-AUTHZ-001` | Non-member cannot read/mutate estate data | P0 | Caller authenticated but not in estate-A | Any `/:id/...` call for estate-A | — | Error `not a member of this estate` before any data access (assertRoles) |
| `ESTATE-AUTHZ-002` | Resident cannot perform admin-only action | P0 | Caller role `resident` in estate-A | `POST /:id/dues/invoices` (CreateInvoice) | — | Error `insufficient role` |
| `ESTATE-AUTHZ-003` | Banned / deleted member fails closed | P0 | Member with `banned_at` (then `deleted_at`) set | Any member call | — | `account is banned` / `account has been deleted`; access denied |
| `ESTATE-AUTHZ-004` | Resident cannot pay another resident's invoice (IDOR) | P0 | Resident-X in estate-A; invoice owned by resident-Y in estate-A | Pay invoice-Y with valid key | valid `Idempotency-Key` | Error `cannot pay another resident's invoice`; no ledger posting |
| `ESTATE-AUTHZ-005` | Cross-estate invoice isolation (IDOR by id-guess) | P0 | Resident in estate-A; invoice id belongs to estate-B | Pay estate-B invoice via estate-A URL | — | `invoice not found in this estate` (lookup scoped by `estate_id`). See `../cross-cutting/rbac-and-permissions.md` RBAC-AUTHZ-005 |
| `ESTATE-AUTHZ-006` | Vendor cannot request payout on another vendor's job | P0 | Vendor-user-1; job owned by vendor-2 | `POST .../jobs/:jid/payout` | — | `job not found for this vendor` (scoped by `vendor_id`) |
| `ESTATE-AUTHZ-007` | Oversight route denied without `estate.admin.*` slug | P0 | Authenticated user lacking `estate.admin.dues` | `GET /estate-admin/dues/reconciliation` | — | 403; fail-closed on unseeded/misspelled slug. See `../cross-cutting/rbac-and-permissions.md` RBAC-AUTHZ-006/007 |
| `ESTATE-BND-001` | Oversight list `limit` clamped to 1..500 | P2 | Caller with `estate.admin.security` | `GET /estate-admin/security/gates?limit=0/9999/abc` | 0, 9999, abc | Non-positive/>500/non-numeric → default 200 (`limitOf`) |
| `ESTATE-IDEM-001` | Dues payment replay is idempotent | P0 | Invoice already paid via key `K1` | Re-`POST .../pay` with same `Idempotency-Key=K1` | `K1`, `amount_kobo=250_000` | 200; returns canonical receipt; exactly one `estate_payments` row; no second ledger entry (kobo-exact: settlement CREDIT total unchanged) |
| `ESTATE-IDEM-002` | Vendor payout replay is idempotent | P0 | Job paid via key `K2` | Re-`POST .../payout` with same key | `K2`, `amount_kobo=1_200_000` | 200; job stays `paid`; single ledger credit; earnings total unchanged |
| `ESTATE-CONC-001` | Concurrent double-pay of same invoice → single settlement | P0 | Pending invoice; two simultaneous pays, same key | Fire 2 concurrent `POST .../pay` | shared key, `amount_kobo=500_000` | Exactly one successful receipt; ledger CREDIT settlement = 500_000 once (idempotency + `ON CONFLICT (idempotency_key)`) |
| `ESTATE-CONC-002` | Concurrent duplicate vote → one ballot | P1 | Open election, eligible voter | Fire 2 concurrent `POST .../vote` | same voter/candidate | One ballot recorded; second → `already voted` (Redlock + `UNIQUE(election_id,voter_id)`) |
| `ESTATE-SEC-001` | Feature flag OFF → estate + oversight routes unregistered | P0 | `FEATURE_ESTATE_ENABLED=false` | Call any `/:id/...` and `/estate-admin/...` | — | 404; no handler mounted. See `../cross-cutting/feature-flags-and-audit.md` |
| `ESTATE-SEC-002` | Presign fails closed when R2 unconfigured | P1 | No R2 presigner wired | `POST /:id/uploads/presign` | `{kind:document}` | 503; never a fabricated URL (see `presign_test.go`) |

## 5. State-machine transitions

The module has several status FSMs. Illegal transitions are rejected because the mutating `UPDATE` carries a `status IN (...)`/`status=$from` predicate and returns "not found / not in a valid state" when zero rows match; re-entering a terminal state is a clean idempotent no-op.

**Vendor job** (`vendor.go` — `jobTransition`, `RequestPayout`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| available | AcceptJob | accepted | stamp `accepted_at`; audit | `ESTATE-FSM-001` |
| available | RejectJob | rejected | audit | `ESTATE-FSM-002` |
| accepted | CheckInAtGate | en_route | audit | `ESTATE-FSM-003` |
| accepted/en_route | StartJob | in_progress | audit | `ESTATE-FSM-004` |
| in_progress | MarkJobComplete | completed | stamp `completed_at` | `ESTATE-FSM-005` |
| completed | RequestPayout | paid | ledger CREDIT vendor; `paid_at`/`payout_ref`; audit `VENDOR_PAYOUT` | `ESTATE-FSM-006` |
| paid | RequestPayout (replay) | paid | none (returns canonical row) | `ESTATE-FSM-007` |
| available/in_progress | RequestPayout | — (rejected) | none | `ESTATE-FSM-008` |

**Meeting** (`meetings.go` — `transitionMeeting`, `CancelMeeting`, `RescheduleMeeting`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| scheduled | StartMeeting | live | audit `MEETING_START` | `ESTATE-FSM-009` |
| live | EndMeeting | ended | audit `MEETING_END` | `ESTATE-FSM-010` |
| scheduled/live | CancelMeeting | cancelled | notify members | `ESTATE-FSM-011` |
| not ended/cancelled | RescheduleMeeting | scheduled | notify members | `ESTATE-FSM-012` |
| ended/cancelled | Start/End/Reschedule | — (rejected) | none | `ESTATE-FSM-013` |

**Dues invoice** (`service_dues.go`): `pending → paid` (via PayDues), plus `overdue` (billing/aging) and `waived` (terminal, not payable). **Election** (`service.go`): `draft → open → closed → tallied`; results only when `closed|tallied`, votes only when `open`. Illegal-transition assertions for both belong in the automated specs below.

## 6. Security & abuse cases

Reference the cross-cutting files rather than re-deriving:

- **Authz bypass / role escalation** — resident invoking admin-only mutation; `assertEstateAdmin` fails closed. See ESTATE-AUTHZ-002 and `../cross-cutting/rbac-and-permissions.md`.
- **IDOR / object-level** — paying another resident's invoice (ESTATE-AUTHZ-004), guessing a cross-estate invoice id (ESTATE-AUTHZ-005), payout on another vendor's job (ESTATE-AUTHZ-006). All scoped by `estate_id` + owner id in the query.
- **Cross-estate scope leakage** — the URL `:id` is authoritative and every read/write is `WHERE estate_id=$1`; the oversight surface's optional `?estate_id=` only narrows, never widens (a caller with the slug sees all estates by design — HQ oversight). See `../cross-cutting/rbac-and-permissions.md` RBAC-AUTHZ-005/006/007 and `isolation_test.go`.
- **Missing/invalid Idempotency-Key** — `PayDues`/`RequestPayout` return `ErrIdempotencyRequired` before any DB/ledger access (ESTATE-IDEM-*, `modules_test.go`, `vendor_test.go`). See `../cross-cutting/money-invariants.md`.
- **Amount tampering / server re-pricing** — `PayDues` ignores/validates the client amount against the stored invoice (`amount must equal the invoice amount`); vendor payout amount comes from the stored job row, never the request. See ESTATE-VAL-001/003 and `../cross-cutting/money-invariants.md`.
- **Fail-closed on dependency error** — nil ledger → `ErrLedgerUnavailable`; restriction DB lookup error blocks the gated action (`enforceNotRestricted`); KYC verifier unavailable → election blocked (`ReasonKYCUnavailable`, `election_eligibility_test.go`); R2 unwired → 503 (`presign_test.go`). See `../cross-cutting/kyc-and-tiers.md`.
- **Tier limit** — dues wallet debit passes `EnforceWalletDebitLimit` fail-closed before money moves. See `../cross-cutting/kyc-and-tiers.md`.
- **Upload abuse** — presign allowlists content-type/extension, mints a 32-char unguessable object-key suffix, scopes keys to the caller, and restricts restricted-document downloads to admins (`presign_test.go`). See `../cross-cutting/webhooks-and-providers.md` for R2 presign posture.
- **Audit integrity** — all money + admin mutations append to immutable `estate_audit_log` (in-tx for money). Election integrity: `UNIQUE(election_id, voter_id)` makes double-voting impossible; `ElectionAudit` flags `ballots_cast != distinct_voters` as corruption. See `../cross-cutting/feature-flags-and-audit.md`.

## 7. Automated specs to add

Table-driven Go, package `estate`/`estate_test`, following the existing convention (nil-DB guard tests + pure-logic table tests; live-DB paths gated on `TEST_DATABASE_URL`).

- `internal/estate/service_dues_ledger_test.go` — TODO: live-DB `PayDues` posts balanced DEBIT payer / CREDIT settlement for exact kobo, marks invoice `paid`, lifts restriction, writes audit in one tx; replay with same key yields one receipt + one ledger entry.
- `internal/estate/service_dues_reprice_test.go` — TODO: `PayDues` rejects amount override ≠ invoice amount, rejects `waived`, and re-checks `resident_id==payer` (IDOR) — table-driven on `(status, ownerID, override)`.
- `internal/estate/vendor_payout_fsm_test.go` — TODO: live-DB `RequestPayout` requires `completed`, credits exact kobo once, is idempotent on key; `jobTransition` rejects illegal from-states (table-driven over the FSM matrix in §5).
- `internal/estate/meetings_fsm_test.go` — TODO: table-driven meeting transitions incl. rejected transitions from terminal `ended`/`cancelled`.
- `internal/estate/restriction_enforce_test.go` — TODO: `enforceNotRestricted` blocks fail-closed on DB error and applies the soft/hard matrix at real call sites (CastVote/BookFacility/CreateAccessCode).
- `internal/estate/estate_admin_authz_test.go` — TODO: each `/estate-admin/*` route rejects callers lacking the exact seeded `estate.admin.*` slug (fail-closed) and `limitOf`/`estateFilter` clamp/scope correctly.
- `internal/estate/flag_off_test.go` — TODO: with `FEATURE_ESTATE_ENABLED=false`, neither the estate group nor `RegisterEstateAdmin` mounts any route.
- Contract check: add estate paths to `contracts/openapi.yaml` and wire `npm run contract:check` (CON layer currently TODO).

## 8. Coverage target & exit criteria

Tier-0 floor: **≥ 85% of pure-logic** (restriction matrix, eligibility, validators, notification taxonomy, analytics range, presign helpers, alert severity — already largely AUTOMATED) plus the two money guards (idempotency + ledger) on `PayDues` and `RequestPayout`.

Release-blocking P0 cases that must pass:
- `ESTATE-INT-001/002/003` — dues settlement, restriction lift, vendor payout post correct balanced kobo journals.
- `ESTATE-IDEM-001/002` + `ESTATE-CONC-001` — idempotent + concurrency-safe money paths (single settlement/credit).
- `ESTATE-VAL-001/003` — server-side re-pricing / no under-over-pay, payout only when completed.
- `ESTATE-AUTHZ-001..007` — per-estate membership, role, banned/deleted, IDOR, cross-estate isolation, and oversight-slug fail-closed.
- `ESTATE-SEC-001/002` — flag-off unmounts all routes; presign fails closed.

Blocked/deferred: live-DB cross-estate penetration under PostgREST RLS remains environment-gated (tracked in `docs/estate/SECURITY-RLS-INDEX-AUDIT.md`, Block 47d); the ledger tie-out (payments projection vs finance ledger settlement balance) is a documented TODO in `estate_admin_routes.go` DuesReconciliation and must be closed before the oversight reconciliation report is trusted for release.
