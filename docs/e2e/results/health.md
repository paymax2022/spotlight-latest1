# HEALTH cluster — production E2E validation results

Date: 2026-10-04. Stack exercised live: Go api :8080 (running build), Next dev :3000, admin console :3001, GoTrue via Kong :54321, Postgres `supabase_db_spotlight` :54322, Mailpit :54324. The web product has no health UI (member/provider surfaces are mobile), so every journey ran at the **real mounted Go API surface** — member routes under `/api/finance/health/*` + `/api/finance/support/*` + `/api/finance/nutrition/*`, admin routes under `/api/health/*/admin/*` (RequireAuthContext + per-route RBAC, driven by the admin fixture's GoTrue bearer — no `x-admin-api-key`).

Specs: `frontend-web/tests/e2e/health/` — **6 specs / 16 tests, all green on both projects** (`chromium-desktop` + `mobile-chrome` = 32 runs, ~13s, 5 workers). Go side: `go test ./internal/health/... ./internal/nutrition/... ./internal/aicare/... ./internal/doctor/...` with `TEST_DATABASE_URL` → **all packages ok** (includes the live-DB suites — pharmacy stock/dispatch, lab money/release, vet VCN, triage care). Golden-path regression `npm run test:regression` → **10 files / 131 tests pass**.

Fixture honesty: `psql` is used ONLY for fixture setup (email-confirm, `kyc_tier` seeding — no local KYC provider, the balanced funding journal the top-up webhook posts) and for read-only assertions (ledger sums, provider status) — plus ONE product seed that works around finding E2E-HLT-001, inserted exactly as the service's own live-DB tests do.

## Route inventory (from `docs/e2e/inventory-backend-routes.csv`)

| Submodule | Mounted paths (approx.) | Coverage | Notes |
|-----------|------------------------|----------|-------|
| Shared health core (providers, records, consent, intake, scheduling, consults, rx) | ~54 (`/api/finance/health/*` + `/api/health/admin/*`) | E2E journeyed | KYB SM, records vault, consent gate, intake schemas, scheduling SM, e-Rx SM |
| Pharmacy | 34 | E2E journeyed | KYB→catalog→order→dispense→dispatch→complete + cancel/refund + admin |
| Lab | 22 | E2E journeyed | KYB→catalog→order→collect→handover→accession→results→release + cancel/refund + admin |
| Vet + VCN | 27 | E2E journeyed | VCN Mode-B → service→booking→accept→consult→release + pets/vax/SOS + cancel + admin |
| Triage (core + care + governance + WhatsApp webhook) | ~29 | **flag-gated** `FEATURE_HEALTH_TRIAGE_ENABLED` (routes unmounted — 404 verified) | Unit tests cover the SM; see Notify note |
| AI care | 5 | E2E journeyed | session→message→history→escalate→resolve + IDOR |
| Nutrition | ~16 (9 member + admin) | **flag-gated** `FEATURE_NUTRITION_ENABLED` (404 verified) | model tests only in Go |
| Doctor/telemedicine | ~341 (`/api/v1/doctor/*` + `/api/health/doctor/*`) | **flag-gated** `FEATURE_DOCTOR_ENABLED` (404 verified) | Go unit/integration suites pass |
| Doctor emergency dispatch trio | 3 | **flag-gated** `FEATURE_DOCTOR_EMERGENCY_DISPATCH_ENABLED` (404 verified) | separately flagged inside doctor |
| Pre-consult intake member group | ~10 | **flag-gated** `FEATURE_HEALTH_INTAKE_ENABLED` (404 verified) | base intake schema/response routes are always mounted |
| Pharmacy symptom search | 2 | **flag-gated** `FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED` (404 verified) | |
| Scheduler jobs `health.appointment.reminder`, `health.vet.vaccination.reminder`, `health.vcn.licence_sweep` | — | **unit/live** | licence sweep: real handler (`credential.JobLicenceSweep`); reminders: real delivery handlers in `app/health_reminder_jobs.go` (consume terminal/gone entities, deliver via notifications queue, retry on enqueue failure) — 5 live-DB tests in `health_reminder_jobs_live_test.go` |

Flags verified ON in the running container: `FEATURE_HEALTH_ENABLED`, `FEATURE_HEALTH_PHARMACY_ENABLED`, `FEATURE_HEALTH_LAB_ENABLED`, `FEATURE_HEALTH_VET_ENABLED`, `FEATURE_AICARE_ENABLED` (support sessions live), telemedicine consult surface. Flag-off probes assert **404 (route absent)**, never a misleading 401/5xx — `hlt-006-edge.spec.ts`.

## Verdicts

| ID | Journey | Verdict |
|----|---------|---------|
| HLT-001 | shared platform | **PASS** — provider KYB guarded SM (application→credential→submit→`start_review`→approve / →reject), records vault create→read→docs→access-log→erase with consent enforcement, intake schema publish→validate→submit, scheduling REQUESTED→CONFIRMED→RESCHEDULED→CONFIRMED→CANCELLED, e-Rx ISSUED→SENT→VERIFYING→VERIFIED→DISPENSED (+REJECTED leg). |
| HLT-002 | pharmacy | **PASS WITH P1 + P2 FINDINGS** — full order lifecycle proven with balanced escrow legs (`escrow:pharmacy:<id>` hold; `release:`/`refund:` resolve legs), idempotent replay, wrong-pickup-code refused before money moves, cancel→refund nets to zero. But `POST /products` is dead on schema drift (**E2E-HLT-001**) and `GET /admin/dispense-audit` 500s always (**E2E-HLT-002**). |
| HLT-003 | lab | **PASS** — catalog upsert → order (HELD, idempotent) → schedule → collect (barcode + custody opens) → phlebotomist handover (scientist refused, HL-2) → accession w/ barcode check → validated results → release (escrow RELEASE) → patient reads + admin custody-audit/escalations. Cancel→refund balanced. |
| HLT-004 | vet + VCN | **PASS WITH P1 FINDING** — VCN Mode-B submit → ops queue → reviewer approve (licence_expiry enforced, no-self-approval) → capability minted → service upsert → pet → booking (HELD, idempotent) → accept→confirm→consult start→SOAP complete → escrow release → shared consult lobby authZ. But **evidence-doc attach is broken** (**E2E-HLT-003**). Cancel→refund balanced. |
| HLT-005 | AI care | **PASS** — deterministic mock reply (no Anthropic key), history, escalate, resolve; a second user is refused read AND post (object-level authZ). |
| HLT-006 | edge/auth/flags | **PASS** — anon → 401 on all 15 probed member+admin surfaces; non-admin member → 403 on all admin RBAC surfaces; every flag-off module → 404. |

## Findings

- **E2E-HLT-001 — P1 (defect): `POST /api/finance/health/pharmacy/products` is dead — legacy `category` column violates NOT NULL on every write.**
  `pharmacy_products` is created by the EARLIER migration `supabase/migrations/20260617000000_health_premium.sql:127-140` with `category TEXT NOT NULL CHECK (category IN ('pain','vitamins','first_aid','baby','skincare','devices','prescription','otc'))` and **no default**. The later `20260815000200_health_pharmacy.sql` uses `CREATE TABLE IF NOT EXISTS` (no-op) plus a "collision guard" that adds the new columns but **never relaxes the legacy `category` NOT NULL/CHECK**. The Go `UpsertProduct` INSERT (`backend/internal/health/pharmacy/service.go:310-316`) does not set `category`, so every catalog write fails `23502 not_null_violation` → handler maps to **422 `{"error":"internal server error"}`** (`handler.go:97-104`). Verified live against the running schema (`\d pharmacy_products` shows `category text NOT NULL` no default). Repro: any valid owner POST to `/products`. The module's own live-DB tests never see this because they INSERT products directly with `category='otc'` (`stock_and_dispatch_live_db_test.go:110`) — the real write path is untested. The E2E journey seeds the same row shape after asserting the 422, so downstream order/money coverage still runs.
  Suggested fix shape (for the fixer): `ALTER COLUMN category SET DEFAULT 'otc'` or drop the legacy NOT NULL (additive-safe) AND/OR map `category` into the service INSERT.

- **E2E-HLT-002 — P2 (defect): `GET /api/health/pharmacy/admin/dispense-audit` 500s on EVERY call.**
  `AdminDispenseAudit` binds the optional `pharmacy_provider_id` query param as a text string and compares it to a uuid column: `WHERE ($1 = '' OR o.pharmacy_provider_id = $1)` (`backend/internal/health/pharmacy/admin.go:137`). Postgres rejects `uuid = ''` with `invalid input syntax for type uuid` — verified by replaying the exact SQL in `supabase_db_spotlight`. The empty-string short-circuit does not save it: the comparison arm is evaluated per row regardless. So the HL-12 dispense audit read is dead, filtered or not (verified: 500 both with no param and with `?pharmacy_provider_id=<uuid>` — any text param hits the same type error). Fix shape: `$1::uuid IS NULL OR o.pharmacy_provider_id = $1::uuid` with NULL-bound empty param, or `o.pharmacy_provider_id::text = $1`.

- **E2E-HLT-003 — P1 (defect): VCN assisted-verification evidence docs can never attach — doc-type vocab mismatch vs `cred_type` CHECK.**
  `credential.Submit` accepts doc types `{VCN_CERT, ANNUAL_LICENCE, GOV_ID}` (`backend/internal/health/credential/service.go:124`) and passes each through to `providers.AddCredential` as `cred_type` (`service.go:147-156`). But `health_credential_docs.cred_type` is CHECK-constrained to `{VCN, PCN, MLSCN, NAFDAC, PREMISES, OTHER}` (`supabase/migrations/20260815000100_health_platform.sql:72`, live `\d` verified). Every doc'd submit dies on the CHECK violation → `providers: insert credential` → `credErrMap` default → **400**. Verified live: `POST /api/finance/health/vet/verification/submit` with `docs:[{type:'ANNUAL_LICENCE',...}]` → 400; same payload with `docs:[]` → 201 and the record lands in the ops queue. So Mode-B verification works only with zero evidence attached — the docs a reviewer is meant to inspect can never be filed. Fix shape: map VCN doc types onto the cred_type enum (`ANNUAL_LICENCE→VCN`, `GOV_ID→OTHER`) or extend the CHECK — one of the two vocabularies must win.

## Non-journey classification

- **flag-gated (routes unmounted in this environment; 404 verified per probe):**
  - `FEATURE_HEALTH_TRIAGE_ENABLED` — all 29 triage paths (`/api/finance/health/triage/*`, `/api/health/triage/admin/*`, `/internal/webhooks/triage/whatsapp`).
  - `FEATURE_HEALTH_INTAKE_ENABLED` — pre-consult intake member group (`/api/finance/health/intake/appointments/*` doctor-summary chain). Base schema publish/fetch/respond is always mounted and IS journeyed in HLT-001.
  - `FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED` — `POST /pharmacy/symptom-search` + admin metrics.
  - `FEATURE_NUTRITION_ENABLED` — all nutrition paths (`/api/finance/nutrition/*`, `/api/nutrition/admin/*`).
  - `FEATURE_DOCTOR_ENABLED` — all ~341 doctor paths (`/api/v1/doctor/*`, `/api/health/doctor/*`).
  - `FEATURE_DOCTOR_EMERGENCY_DISPATCH_ENABLED` — emergency dispatch trio (`/emergency/contacts/:patientId/notify`, `/emergency/escalate/ambulance`, `/emergency/escalate/hospital`); emergency-case CRUD rides the doctor flag.
- **internal/webhook:** `POST /internal/webhooks/triage/whatsapp` (flag-gated AND internal — signature-verified webhook, not a member journey). Internal scheduler job types are not HTTP routes.
- **scheduler jobs (not HTTP routes):** `health.vcn.licence_sweep` has a real handler; `health.appointment.reminder` + `health.vet.vaccination.reminder` now deliver through `app/health_reminder_jobs.go` — fire-time entity re-read, terminal/gone entities consumed quietly, enqueue failure retries. Vaccination due-dates ARE created in HLT-004.
- **needs-seed (flag-on environments):** doctor journeys need MDCN-credentialed doctor + consult fixtures; triage needs published governance content/rules; nutrition needs a dish library — all additionally flag-off here, so no E2E attempt was made.
- **SEC-056 carve-out (by design, NOT reported as a leak):** admin-only provider-health endpoints (`/api/health/admin/*`, per-vertical admin groups) intentionally expose raw operational detail (queue internals, custody chains, audit rows) behind RequireAuthContext + granular `health.*` RBAC. Reviewer-only fields like `matched_fields` are admin-shaped; the member-facing `verification/status` returns only a sanitised stage (verified: NDPA minimisation in `credential/service.go`).

## Contract verifications called out by the sweep

- **Triage Notify failure semantics (SC-5): verified.** `CareService.Notify` (`backend/internal/health/triage/care/service.go:316-347`) joins patient+clinician delivery errors and returns BEFORE the `raised→notified` state write — a failed hand-off leaves the case `raised` and a retry is a clean re-call. Covered by `TestNotifyFailureLeavesEscalationRaised` (retry also proven to land `notified`) in the passing `./internal/health/triage/care` suite. E2E path is flag-gated.
- **Money-path invariants:** all order/booking amounts integer kobo (asserted `total_kobo` integers); `Idempotency-Key` required (missing → 4xx; replay → same row, single hold); hold posts `escrow:<module>:<id>` balanced DR wallet/CR escrow legs; release posts `release:<module>:<id>` DR escrow/CR payee; cancel posts `refund:<module>:<id>` — summed legs per reference always `ΣCR = ΣDR` (asserted against `ledger_entries` live). Fail-after-hold compensates (stock race → refund). Payout eligibility fails closed on KYC tier.
- **HL-2 gates verified negatively:** scientist token refused at custody handover (phlebotomist-only); stranger refused vet appointment read (403/404) and consult lobby (403); non-admin refused all admin surfaces (403).
- **Rx begin+decision is one call (semantics note, not a defect):** `POST /prescriptions/:id/verify {begin:true, approve}` runs BeginVerify then the verdict in one request (`rx/service.go:463-489`) — `VERIFYING` is never a returned state. Dispense-once is an idempotent edge: the second call hits the same-state short-circuit → 200 unchanged (partial UNIQUE index on `dispensed_at` is the DB backstop).
- **Scheduling reschedule is atomic (semantics note):** `/appointments/:id/reschedule` does CONFIRMED→RESCHEDULED→CONFIRMED server-side and returns CONFIRMED with the moved slot — `RESCHEDULED` is a transit state only.

## Journey details

### HLT-001 — shared health platform — PASS (5 tests)
Provider KYB: `POST /providers/applications` (PHARMACY/LAB/VET domains) → `POST …/credentials` → `POST …/submit` (DRAFT→SUBMITTED) → admin `POST …/decision {action:start_review}` (→UNDER_REVIEW) → `approve` (mints APPROVED `health_providers` row + `provider_id`) and a second app → `reject` (terminal). Illegal direct `SUBMITTED→APPROVED` → 409 (guarded SM).
Records vault: `POST /records` → GET → `POST /records/:id/docs` → access-log read → consent `POST /consent` grant → revoke → `DELETE /records/:id` (erase); a non-consented cross-user read is refused.
Intake: admin `POST /admin/intake/schemas` → member `GET /intake/:id` → `POST …/responses` — unknown-field answers → 400, valid → 201 with `schema_version` pinned.
Scheduling: `POST /appointments` → `/transition` CONFIRMED → `/reschedule` (lands CONFIRMED, slot moved) → `/transition` CANCELLED.
E-Rx: `POST /prescriptions` → `/send` (pins a real approved pharmacy — the `pharmacy_provider_id` FK rejects placeholders) → `/verify {begin:true,approve:true}` → VERIFIED → `/dispense` → DISPENSED; second Rx → `{begin:true,approve:false,reason}` → REJECTED; double-dispense → 200 idempotent no-op.
Spec: `tests/e2e/health/hlt-001-shared-platform.spec.ts`.

### HLT-002 — pharmacy — PASS w/ findings (2 tests)
Owner KYB → `/pharmacies/:id/profile` → **product write probe 422 (E2E-HLT-001)** → seeded catalog row → discovery `/pharmacies` + detail + `/products?pharmacy_provider_id=` + `/products/:id` + `/products/mine` → patient `POST /orders` (PICKUP, `Idempotency-Key`) → 201 `state=CREATED`, `total_kobo=300000` integer → legs `%pharmacy:<id>%` balanced (DR user_wallet / CR escrow) → replay → same order id → owner `/orders` queue → `/confirm` → `/dispense` → `/dispatch` → `READY_FOR_PICKUP` + pickup code → wrong code refused (409, no release leg) → `/complete` → COLLECTED/CLOSED + release legs → `POST /orders/:id/reviews` + public review feed → `/earnings` → `/prescriptions` → admin dashboard/orders/:id 200 + **dispense-audit 500 (E2E-HLT-002)**. Cancel leg: order→cancel→refund legs net zero.
Spec: `tests/e2e/health/hlt-002-pharmacy.spec.ts`.

### HLT-003 — lab — PASS (2 tests)
Owner KYB (type `lab`) + separate `lab_scientist` + `phlebotomist` capability users via the same real KYB journey → `POST /lab/tests` catalog → patient `POST /orders` (WALK_IN, HELD, idempotent; replay → same id) → provider `/provider/orders?lab_provider_id=` + patient `/orders` → `/schedule` → `/collect` (barcode minted, custody opens) → `/custody` readable → scientist handover → 409 refused (HL-2), phlebotomist handover → HANDED_OVER → accession wrong barcode refused, right barcode → ACCESSIONED → `POST /orders/:id/results` (barcode re-verified) → `/release` → RELEASED/CLOSED (escrow release legs) → patient results + custody chain reads → admin dashboard/orders/custody-audit/escalations 200. Cancel→refund balanced.
Spec: `tests/e2e/health/hlt-003-lab.spec.ts`.

### HLT-004 — vet + VCN — PASS w/ finding (2 tests)
`POST /providers/applications` (VET/vet) → **doc'd verification submit → 400 (E2E-HLT-003)** → doc-less submit → 201 `{stage}` → `GET /verification/status` → admin queue (`items[].record.provider_application_id`) → `GET …/verification/:recordId` → approve without `licence_expiry` → refused → approve `2030-12-31` → VERIFIED → application APPROVED + `provider_id` minted → `POST /vet/services` (TELE) → pet create/list → `POST /pets/:id/vaccinations` (durable reminder job enqueued — real handler in `app/health_reminder_jobs.go`) → `/vet/vets` + `POST /vet/sos` (disclaimer) → `POST /appointments` → HELD + balanced legs, replay → same id → vet `/accept` → `/confirm` → `POST /consults/:apptId/start` → shared `GET /consults/:id/lobby` (owner 200, stranger 403) → `/complete` (SOAP) → COMPLETED → release legs balanced → admin dashboard/appointments/vcn-audit/erx-audit 200. Cancel→refund balanced via plain provider approval.
Spec: `tests/e2e/health/hlt-004-vet.spec.ts`.

### HLT-005 — AI care — PASS (2 tests)
`POST /api/finance/support/sessions` → `POST …/messages` → deterministic mock reply (no ANTHROPIC_API_KEY in env → canned response, not a 5xx) → `GET …/messages` history → `/escalate` → `/resolve` → second user refused on read AND post (object-level authZ, `aicare` IDOR live-DB test also green).
Spec: `tests/e2e/health/hlt-005-aicare.spec.ts`.

### HLT-006 — edge surface — PASS (3 tests)
15 anonymous probes → 401 (member: providers/records/consent/appointments/pharmacy products+orders/lab tests+orders/vet pets+appointments/support sessions; admin: pharmacy+lab orders, vet appointments, intake schemas) → 4 admin probes with a non-admin member token → 403 → 12 flag-off probes → 404 for triage, pre-consult intake, symptom-search, nutrition, doctor, emergency dispatch.
Spec: `tests/e2e/health/hlt-006-edge.spec.ts`.

## Coverage accounting

- **Proven live journeys (E2E):** shared platform (providers/records/consent/intake/scheduling/rx), pharmacy order+money, lab order+custody+money, vet+VCN+money, AI care sessions, auth/flag edges. 16 E2E tests × 2 browser projects.
- **Unit/integration (Go, all passing):** every package under `internal/health/` (clinicalsafety, consent, consult, controlled, credential, insurance, lab, labref, makercheck, pharmacy, phisafe, preconsult, records, rx, scheduling, symptomsearch, triage core/care/governance, vet) + `internal/nutrition` + `internal/aicare` + `internal/doctor`. `internal/health/intake` and `internal/health/providers` have no Go test files — covered E2E-side instead.
- **flag-gated (not covered, unmounted):** triage (~29), pre-consult intake group (~10), symptom-search (2), nutrition (~16), doctor (~341), doctor emergency dispatch (3).
- **internal/webhook:** `/internal/webhooks/triage/whatsapp`.
- **scheduler jobs:** 3 job types, all with real handlers (licence sweep + 2 reminder deliveries via `app/health_reminder_jobs.go`, live-DB tested).
- **needs-seed:** doctor/triage/nutrition journeys beyond flag gating (MDCN credentialing, governance content, dish library).

## Reproduce

```bash
# health E2E (both projects)
cd frontend-web && npx playwright test tests/e2e/health/ --reporter=list

# Go suites (unit + live-DB)
cd backend && TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:54322/postgres" \
  go test ./internal/health/... ./internal/nutrition/... ./internal/aicare/... ./internal/doctor/...

# defect probes (any authed admin/owner token)
curl -i -X POST :8080/api/finance/health/pharmacy/products …      # → 422 (E2E-HLT-001)
curl -i :8080/api/health/pharmacy/admin/dispense-audit            # → 500 (E2E-HLT-002)
curl -i -X POST :8080/api/finance/health/vet/verification/submit  # docs[] → 400 (E2E-HLT-003)
```
