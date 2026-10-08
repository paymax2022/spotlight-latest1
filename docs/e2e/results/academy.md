# ACADEMY module — production E2E validation results

Date: 2026-10-04. Lane: academy coverage sweep (est. ~365 uncovered backend paths
+ 27 router paths at kickoff).

**Stack exercised live:** parallel Academy-enabled API `/tmp/paymax-api-acad` on
`:8095` (same Supabase Postgres :54322, Redis :6379, GoTrue :54321, fake rails
:9101 — only env differs), because the campaign API container on :8080 was booted
**without `FEATURE_ACADEMY_ENABLED`** → the whole module was unmounted there
(`/api/finance/academy/*` and `/api/academy/admin/*` all 404). Specs run with:

```bash
E2E_GO_BACKEND_URL=http://127.0.0.1:8095 \
  npx playwright test tests/e2e/academy --reporter=line --project=chromium-desktop
```

Boot log on :8095: **293 academy routes mounted**; platform oversight routes
registered (SU-01..SU-12). `go build ./internal/academy/...` + `go vet` clean;
38 existing `*_test.go` files under `internal/academy/**` kept green.

## Runtime feature flags (authoritative: `public.academy_feature_flags`)

Env on :8095 set every `FEATURE_ACADEMY_*_ENABLED=true`, but
`academyplatform.resolver` resolves the DB flag table — these modules are
**flag-gated OFF at runtime** (routes not registered → 404, verified):

| Flag | Module surfaces gated out |
|------|---------------------------|
| `academy.edupay` | member `/api/finance/academy/edupay/*` + admin `/api/academy/admin/edupay/admin/*` (schools, fee-schedules, link, pay, pots) |
| `academy.credentials` (+ trade) | member+admin `/api/finance/academy/credentials/*`, `/api/finance/academy/trade/*` |
| `academy.live` | member+admin `/api/finance/academy/live/*` (RTC rooms) |
| `academy.schools` | member+admin `/api/finance/academy/schools` institution/B2B2C routes (NOTE: fees also mounts a `/schools` prefix — see E2E-ACAD-007) |
| `academy.tutor` | member+admin `/api/finance/academy/tutor/*` (marketplace, payouts) |

ON: `academy.exam`, `academy.spine`, `academy.fees` + always-on core
(identity/curriculum/learner/gamification/rewards/offlinesync/commerce/tuition
— tuition gated by `FEATURE_ACADEMY_TUITION_ENABLED=true`).

## Specs

| File | Journeys | Result |
|------|----------|--------|
| `tests/e2e/academy/acad-001-identity-learner.spec.ts` | identity me/roles/profile/guardian-link/consent/admin-lookup/revoke; curriculum read spine + admin authoring; learner bookmarks/notes/goal/search/announcements/notifications; wallet proxy read; offlinesync idempotent POST | 5/5 PASS |
| `tests/e2e/academy/acad-002-exam-assessment.spec.ts` | question-bank admin lifecycle + member practice/mastery; mock-exam template → attempt → results; exam arena + blueprint + combo → attempt; placement quiz get/submit | 4/4 PASS |
| `tests/e2e/academy/acad-003-spine.spec.ts` | progression build/read/advance/adaptive/recommendations; CMS productions + publish lifecycle + localizations + member reads; parent layer + child-safety purchase-approval gate; notification templates CRUD | 4/4 PASS |
| `tests/e2e/academy/acad-004-fees-core.spec.ts` | school→verify(two-step SM)→session/class/student/CSV-import/schedule/lock→invoice→record-payment(idempotent); promotion scores→compute→teacher→admin→apply; hardship queue + staff roles; flat AdminAPI + trust-score override + compliance exports + gov opt-ins + SF-10 verified-gate | 4/4 PASS |
| `tests/e2e/academy/acad-005-commerce.spec.ts` | catalog plans/bundles/manifest; order→pay (real wallet debit + no-double-charge) → entitlement → admin refund; order→BNPL→**signed settle webhook reconcile**; access cards generate/allocate/activate (+ replay-by-state + cross-user consumed); subscribe; commerce sync | 4/4 PASS |
| `tests/e2e/academy/acad-006-tuition-webhooks.spec.ts` | admin plan create → member status/validate → member+internal confirm fail-closed (Paystack unreachable) → admin waive/mark-complete; **payout+disburse+billing webhooks** 401/unknown-ref/settle/duplicate with real escrow→settlement ledger legs | 2/2 PASS |
| `tests/e2e/academy/acad-007-sweep.spec.ts` | gamification member+admin; rewards member+admin pool fund; fees vaults create/contribute/lock/unlock/withdraw/apply; scholarship pledge→fund→apply; payment intent/installment (provider seam); competitions create/transition/register/score/leaderboard; class scores+compute; platform SU-01..12; analytics ×6; curriculum admin PATCH/publish; notification/guardian/users reads | 6/6 PASS |

**Total: 29/29 Playwright tests green.**

Helper: `tests/e2e/academy/helpers.ts` — GoTrue bearer via shared fixtures,
`provisionVerifiedUser`, `setKycTier(3)` (tier-0 debit gate), `fundWallet`
(balanced top-up journal), `signRailWebhook`/`postRailWebhook` (HMAC-SHA256
`dev-fake-secret`, `X-Fake-Signature: sha256=<hex>`), `internalFetch`
(service-token routes), `goFetchH` — **header-capable twin of shared goFetch,
which silently drops `opts.headers`** (cross→provider/helpers.go:93-107 has no
headers param; every `Idempotency-Key` was being discarded → 400
`idempotency_key_required` until this was found).

## Per-submodule coverage

| Submodule | Mount(s) | E2E | Unit (existing `*_test.go`) | Internal/webhook | uncovered-reason |
|---|---|---|---|---|---|
| identity | member `/api/finance/academy/{me,roles,profile,guardians/*}`; admin `/api/academy/{admin,academy/admin}/users/*`, `/guardians/*` | ✅ acad-001 | identity tests | — | none |
| curriculum | member `/api/finance/academy/curriculum/*`; admin `/api/academy/admin/curriculum/*` | ✅ acad-001 + acad-007 (PATCH/publish) | curriculum tests | — | none |
| learner | member `/api/finance/academy/learner/*` | ✅ acad-001 | learner tests | — | none |
| commerce | member `/api/finance/academy/commerce/*`; admin `/api/academy/commerce/admin/*` | ✅ acad-003(minor gate)+acad-005 | commerce_test.go | bnpl webhook (acad-006 loop) | none |
| gamification | member `/api/finance/academy/gamification/*`; admin `/api/academy/admin/gamification/*` | ✅ acad-007 | gamification tests | — | none |
| rewards | member `/api/finance/academy/rewards/*`; admin `/api/academy/admin/rewards/*` | ✅ acad-007 | rewards tests | — | none |
| offlinesync | POST `/api/finance/academy/sync` + `/commerce/sync` | ✅ acad-001 + acad-005 | offlinesync tests | — | none |
| wallet proxy | GET `/api/finance/academy/wallet` | ✅ acad-001 (ledger projection match) | — | — | none |
| exam + assessment + mock-exams + analytics | member `/api/finance/academy/{exam,practice,mock-exams}*`; admin `/api/academy/admin/{exam,analytics}/*` | ✅ acad-002 + acad-007 (analytics) | assessment/exam tests | — | E2E-ACAD-001/002 (500s recorded) |
| placement | member `/api/finance/academy/placement` | ✅ acad-002 | — | — | none |
| progression | member `/api/finance/academy/progression/*` | ✅ acad-003 | progression tests | — | none |
| content/CMS | member `/api/finance/academy/content/*`; admin `/api/academy/admin/content/*` | ✅ acad-003 (**items DOA** — E2E-ACAD-003) | content tests | — | none |
| parent | member `/api/finance/academy/parent/*` + admin notification-templates | ✅ acad-003 + acad-007 | parent tests | — | none |
| fees (school/session/class/student/feeschedule/invoice/payment/vault/scholarship/promotion/competition/hardship/roles/trustscore/export/adminapi/platform) | member `/api/finance/academy/{schools,invoices,students,fee-schedules,vaults,scholarship,payments,hardship,competitions}`; admin `/api/academy/admin/{schools,hardship,trust-score,export,fees,competitions,platform}/*` | ✅ acad-004 + acad-007 | ~15 fees test files | disburse+billing webhooks (acad-006) | hardship review **DOA** (E2E-ACAD-004); scholarship apply **DOA** (E2E-ACAD-005) |
| tuition | member `/api/finance/academy/tuition/*`; admin `/api/academy/admin/tuition/*`; internal `/internal/finance/academy/tuition/confirm` | ✅ acad-006 | calculations/statemachine tests | internal confirm probed (service-token gate OK; Paystack verify unreachable) | none |
| rail webhooks | `/internal/webhooks/academy/{bnpl,payout,disburse,billing}` | ✅ acad-005(bnpl)+acad-006(all) — HMAC 401, dedupe "duplicate", non-settle recorded, settle→ledger leg | academy_webhooks_live_db_test.go | ✅ all four | none |
| edupay | — | flag-gated (DB `academy.edupay=false`) | edupay tests | — | **flag-gated** |
| credentials + trade | — | flag-gated (`academy.credentials=false`) | credentials/trade tests | — | **flag-gated** |
| live | — | flag-gated (`academy.live=false`) | live tests | — | **flag-gated** |
| schools (institutions/B2B2C) | — | flag-gated (`academy.schools=false`) | schools tests | — | **flag-gated** |
| tutor | — | flag-gated (`academy.tutor=false`) | tutor tests | payout webhook (acad-006) | **flag-gated** |
| non-academy internals in log (`/internal/referrals/*`, `/internal/webhooks/{mycover,octamile,stays-supplier}`) | — | not academy — other lanes own these | — | — | out-of-lane |

## Findings (reported for orchestrator dispatch — NOT fixed in this lane)

| ID | Severity | Bug |
|----|----------|-----|
| E2E-ACAD-001 | P2 | **Exam arena create: invalid/duplicate `code` → HTTP 500** instead of 400/409. `academy_exam_arenas.code` CHECK enum (CCE/BECE/WASSCE/NECO/UTME/NABTEB) + unique constraint; raw SQLSTATE 23514/23505 bubbles up. Repro: `POST /api/academy/admin/exam/arenas {code:"XYZ"}` → 500; repeat `{code:"UTME"}` → 500. File: `internal/academy/exam/handler.go` + service (no sentinel mapping). |
| E2E-ACAD-002 | P2 | **Mock-exam analytics refresh broken**: `refresh_mock_exam_analytics()` → `cannot refresh materialized view "public.mv_learner_analytics_daily" concurrently` — view lacks a `WHERE`-free unique index required by `REFRESH MATERIALIZED VIEW CONCURRENTLY`. 500 on every refresh. Fix = additive unique-index migration. |
| E2E-ACAD-003 | P2 | **`GET /api/academy/admin/content/items` dead-on-arrival**: `content/repository.go:130` (`lessonCols` incl. `objective_id`) queries `public.academy_lessons`, which has no `objective_id` column (siblings use `academy_edu_lessons`). 500 on every call. |
| E2E-ACAD-004 | P2 | **SF-9 hardship review queue is dead-on-arrival**: `RegisterFeesHardship` builds `NewService(pool, nil, nil)` — the `ReviewerAuthorizer` + `InvoiceFreezer` ports are nil, so `authorizeReview` fails closed and EVERY `POST /api/academy/admin/hardship/admin/:id/{approve,deny}` → 403 (even super-admin). The member queue accepts requests (`POST /hardship` → pending, listable via `GET /hardship/admin?schoolId=`) that **no one can ever review**. Code's own NOTE says "the integration task should re-wire … via NewServiceWithDeps" — never done. `fees/hardship/handler.go:~88-102`, `service.go:182-190`. Fail-closed (not exploitable) but a shipped dead end. |
| E2E-ACAD-005 | P2 | **Scholarship award apply is dead-on-arrival**: `appendAward` runs `ON CONFLICT (idempotency_key) DO NOTHING` but `academy_scholarship_awards` only has a PARTIAL unique index (`uq_academy_scholaward_idem … WHERE idempotency_key IS NOT NULL`) — Postgres → SQLSTATE 42P10 → 500 on every `POST /api/finance/academy/scholarship/pledges/:id/apply`. `fees/scholarship/repository.go:~148-158`. |
| E2E-ACAD-006 | P3 | **Tuition `/validate` returns 500 "internal server error" for user-input validation** (amount ≠ next installment): bare `fmt.Errorf` has no sentinel so `writeErr`/`errMap` maps to 500. `internal/academy/tuition/handler.go:58-77`, `service.go:385-398`. Same class of bug as E2E-ACAD-001. |
| E2E-ACAD-007 | P3 | **Non-UUID path params → 500**: `POST /api/academy/admin/platform/risk/<non-uuid>/action` → 500 `invalid input syntax for type uuid`; `/api/finance/academy/schools/institutions` → 500 (fees `:schoolId` param swallows the reserved word and uuid-parses it). Should be 400/404. |
| E2E-ACAD-008 | P3 | **Access-card replay-by-state**: after activation, the SAME user re-posting `access-cards/activate` with a WRONG PIN gets 200 + the recorded entitlement (PIN verified only on first activation; consumed state bypasses PIN check for the activating user). `commerce/service.go:479-498`. Other users correctly get refused (consumed). Design-adjacent — flagging for product sign-off. |
| E2E-ACAD-009 | P3/infra | Boot warnings `[academy-webhooks] ensure dedupe/outbox table failed: permission denied for schema public` — the `CREATE TABLE IF NOT EXISTS` fallbacks in `newAcademyWebhookHandler` can't run as `postgres`-role-limited user, but the tables DO exist via migrations and all four webhooks reconcile correctly (verified). Benign-but-misleading log; also masks real breakage if tables were ever absent. `internal/app/academy_webhooks.go:70-120`. |

Environment-limited (not findings): `POST /payments/{intent,installment}` reach the
Paystack adapter and fail closed on the dev placeholder key
(`paystack: initialize payment: Invalid key` → 500); tuition `/confirm` member +
`/internal/.../confirm` reach `paymentProvider.VerifyPayment` and correctly
refuse unverifiable references — **the money path never marks anything paid
without provider proof** (verified: installment stays `pending`).

## Proven end-to-end journeys

1. **School onboarding → billing**: school create → two-step verify
   (unverified→pending→verified; skip refused 409) → session/class/student +
   CSV bulk import → fee schedule create/patch/lock → invoice issue (locks
   schedule, SF-1) → record-payment (Idempotency-Key, append-only, derived
   balance) → promotion scores→compute→teacher/admin approve→apply → hardship
   submit (queue lands; review DOA — E2E-ACAD-004) → staff role assign/revoke →
   trust-score compute+override → compliance export after per-category gov
   opt-in (unopted → 403 `data_category_not_opted_in`) → SF-10 school export
   (unverified → 403, verified → 201).
2. **Commerce money loop**: plan/bundle catalog → order checkout → `pay`
   debits wallet (ledger projection verified, entitlement granted, no
   double-charge on fresh-key replay — `service.go:154`) → admin refund; OR
   order → `bnpl` via HTTP fake rail → signed `approved` webhook → order
   `entitled` + reconcile `{"data":"ok"}` + dedupe `"duplicate"` on replay.
3. **Rail settlement**: terminal-state obligations (tutor payout `paid`,
   disbursement `disbursed`, billing `paid`) + signed `settled` webhook →
   escrow→settlement ledger leg posted (`academy-rail:<rail>:<ref>` idem keys,
   rows verified in `ledger_entries`); 401 bad-sig, `no_matching_obligation`
   unknown-ref, `event_not_settle` non-settle verbs.
4. **Tuition**: admin plan create (batch+application fixture) → member
   status/validate → confirm fails closed without Paystack proof → admin
   waive → mark-complete; internal confirm route is service-token gated
   (401 without, reaches service with `dev-service-token`).
5. **Learner**: identity→roles→profile→guardian link/consent/revoke;
   curriculum tree→subject→topic→objective→lesson; learner
   bookmarks/notes/goal/search/announcements/notifications; offline sync
   idempotent; exam practice/mastery; mock-exam attempt→results; arena attempt;
   placement quiz; gamification profile/badges/challenges/leaderboards;
   rewards balance/catalog/history (+ admin pool fund → ledger); vault
   create→contribute(wallet debit)→lock/unlock→withdraw; scholarship
   pledge→fund (apply DOA — E2E-ACAD-005); parent dashboards + minor
   purchase-approval gate (order → `ApprovalRequired` → guardian decide → pay
   proceeds); access-card generate→allocate→activate→entitlement;
   notification templates CRUD; platform oversight SU-01..12 reads +
   flag-toggle/verify/trust-override/risk-action/review/competition-transition
   writes.
