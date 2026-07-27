# Compliance & Coverage Tracker

Per-module status of the QA suite. Companion to `traceability-matrix.md` — this view answers
**"what complies and what does not."** Update as cases are executed and specs land.

## Legend

| Symbol | Meaning |
|---|---|
| ⚠️ **PENDING** | Cases authored; **execution/automation not yet run**. Default state — *not* a pass. |
| ❌ **CONFIRMED GAP** | Real deviation **verified against code this session**; has an action point / task. |
| **Auto = PARTIAL** | Some behaviors have committed `*_test.go` (module §3). |
| **Auto = TODO** | No in-package automated tests yet; cases manual until §7 specs land. |
| 💰 | ✔ money-path · ◐ partial · – none |

> ⚠️ is the *baseline* for every module: cases written, not yet run to green. Only ❌ rows are
> known-broken. A module goes ⚠️ → ✅ when its P0 cases pass and §7 specs are committed.

## Rollup

| Metric | Count |
|---|---|
| Modules tracked | 73 |
| Tier 0 / 1 / 2 | 28 / 24 / 21 |
| Some automated coverage (PARTIAL) | 56 |
| No automated coverage yet (TODO) | 17 |
| Module test cases authored | 1744 |
| **Confirmed gaps (❌)** | **6** — crowdfunding, wallet, disputes, spotlightwealth, learn, contest |
| Confirmed gaps with a task started | 2 (task_6fa26cd4, task_a3eacd81) |

## Progress log (updated)

**Done**
- QA suite authored (this directory) → PR #1.
- **11 backend packages given committed, clean-tree-verified unit tests** → PR #2:
  `credential`, `cashtag`, `investai` (advice-refusal guardrail), `academy/assessment`,
  `onboarding`, `points`, `connect/aml` (CBN/NFIU thresholds), `aicare` (provider plumbing),
  `scheduler`, `domain` (`Session.Active`), `connect/gamification`. Of these, 6 are tracked
  modules that moved **zero-coverage → tests** (`credential, cashtag, investai, assessment,
  onboarding, points`); the rest are infra/sub-packages outside the 73-module list.
  → Rollup above reflects this (TODO 16→10, PARTIAL 57→63 for the tracked modules).
- Confirmed non-compliance items 1 & 2 (RBAC gaps; nil audit sink) handed to fix tasks
  `task_6fa26cd4` and `task_a3eacd81` — **in progress in separate sessions**.

**Remaining / blocked**
- **Money-path integration suites vs real Postgres** (gaps G5–G7): blocked on local infra
  (Docker daemon down). Runnable the moment a DB is available:
  `supabase start && cd backend && TEST_DATABASE_URL=… go test ./... -run 'Integration|LiveDB'`.
- **DB-bound FSM / velocity / repo logic**: unit-testable only after a repo-interface refactor
  (a production change requiring review) — not an unattended-swarm edit.
- `academy/platform` test exists and is green locally but is **held out of PR #2** because it
  depends on uncommitted `feature_flags.go`; it lands when that source is committed.
- Leads to validate: `invest` PIN-bypass config, `restaurant` order-row idempotency,
  `notifications` in_app→push double-send, `maps` fail-open (see "Leads" section below).
- Item 3 (`contest`/STEM public unauth mutations) is brownfield → needs a product decision,
  not an autopatch.

## Tier 0 — critical path (money / auth / RBAC)

| Module | 💰 | Cases | FSM | Auto | Status | Action point |
|---|:-:|:-:|:-:|:-:|:-:|---|
| [association](modules/association.md) | ✔ | 24 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [cards](modules/cards.md) | ✔ | 24 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [crowdfunding](modules/crowdfunding.md) | ✔ | 65 | Y | PARTIAL | ❌ | Admin group `/api/crowdfunding/admin` (payouts/refunds/KYC/freeze) gated by `requireUserID()` only → **task_6fa26cd4 (in progress)** |
| [crypto](modules/crypto.md) | ✔ | 36 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [edupay](modules/edupay.md) | ✔ | 24 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [escrow](modules/escrow.md) | ✔ | 18 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [estate](modules/estate.md) | ✔ | 35 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [fees](modules/fees.md) | ✔ | 33 | - | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [fxlegacy](modules/fxlegacy.md) | ✔ | 15 | - | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [fxorch](modules/fxorch.md) | ✔ | 22 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [groups](modules/groups.md) | ✔ | 17 | - | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [insurance](modules/insurance.md) | ✔ | 44 | Y | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [invest](modules/invest.md) | ✔ | 36 | Y | PARTIAL | ⚠️ | Config: assert `FEATURE_INVEST_PIN_DEV_BYPASS` OFF in staging/prod (else any PIN accepted) |
| [ledger](modules/ledger.md) | ✔ | 24 | - | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [restaurant](modules/restaurant.md) | ✔ | 30 | Y | PARTIAL | ⚠️ | `PlaceOrder` order-row not deduped on Idempotency-Key; no KYC/tier gate (money safe) — validate |
| [savings](modules/savings.md) | ✔ | 41 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [settlement](modules/settlement.md) | ✔ | 17 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [social](modules/social.md) | ✔ | 33 | Y | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [spotlightwealth](modules/spotlightwealth.md) | ✔ | 22 | Y | TODO | ❌ | Money-path service wired with **nil audit sink** (no audit on mutation) → **task_a3eacd81 (in progress)** |
| [spray](modules/spray.md) | ✔ | 18 | - | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [stays](modules/stays.md) | ✔ | 36 | Y | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [telemedicine](modules/telemedicine.md) | ✔ | 24 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [top5events](modules/top5events.md) | ✔ | 15 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [transfers](modules/transfers.md) | ✔ | 32 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [transport](modules/transport.md) | ✔ | 37 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [va](modules/va.md) | ✔ | 12 | - | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [votebridge](modules/votebridge.md) | ✔ | 24 | - | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [wallet](modules/wallet.md) | ✔ | 15 | - | PARTIAL | ❌ | Admin wallet reads under `/api/finance/admin` use `requireUserID()` only (IDOR on balances) → **task_6fa26cd4 (in progress)** |

## Tier 1 — money-adjacent / sensitive

| Module | 💰 | Cases | FSM | Auto | Status | Action point |
|---|:-:|:-:|:-:|:-:|:-:|---|
| [academycommerce](modules/academycommerce.md) | ✔ | 27 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [academyplatform](modules/academyplatform.md) | – | 15 | - | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [academyrewards](modules/academyrewards.md) | ✔ | 19 | - | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [aicare](modules/aicare.md) | – | 19 | Y | PARTIAL | ⚠️ | Execute P0 cases; close §7 spec gaps |
| [business](modules/business.md) | ✔ | 29 | Y | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [commission](modules/commission.md) | ✔ | 22 | - | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [contest](modules/contest.md) | – | 31 | Y | PARTIAL | ❌ | Public `/api/v1/<feature>` allows unauth high-impact mutations; no feature flag (brownfield — documented) |
| [creators](modules/creators.md) | ✔ | 12 | - | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [disputes](modules/disputes.md) | – | 14 | Y | PARTIAL | ❌ | `/api/finance/admin/disputes/:id/resolve` gated by `requireUserID()` only → **task_6fa26cd4 (in progress)** |
| [doctor](modules/doctor.md) | ✔ | 17 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [fractionalre](modules/fractionalre.md) | ✔ | 34 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [health](modules/health.md) | ◐ | 18 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [loyalty](modules/loyalty.md) | – | 20 | - | PARTIAL | ⚠️ | Execute P0 cases; close §7 spec gaps |
| [marketplace](modules/marketplace.md) | ✔ | 34 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [nutrition](modules/nutrition.md) | – | 20 | Y | PARTIAL | ⚠️ | Execute P0 cases; close §7 spec gaps |
| [p2pmarket](modules/p2pmarket.md) | ✔ | 17 | Y | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [placement](modules/placement.md) | ✔ | 36 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [property](modules/property.md) | – | 17 | - | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [ratings](modules/ratings.md) | – | 13 | - | PARTIAL | ⚠️ | Execute P0 cases; close §7 spec gaps |
| [realtor](modules/realtor.md) | – | 24 | - | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [referral](modules/referral.md) | ✔ | 42 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [referralsfin](modules/referralsfin.md) | ✔ | 22 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [schools](modules/schools.md) | ✔ | 18 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [tutor](modules/tutor.md) | ✔ | 16 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |

## Tier 2 — content / non-money

| Module | 💰 | Cases | FSM | Auto | Status | Action point |
|---|:-:|:-:|:-:|:-:|:-:|---|
| [academyidentity](modules/academyidentity.md) | – | 16 | Y | PARTIAL | ⚠️ | Execute P0 cases; close §7 spec gaps |
| [academylive](modules/academylive.md) | – | 17 | Y | PARTIAL | ⚠️ | Execute P0 cases; close §7 spec gaps |
| [arena](modules/arena.md) | ✔ | 52 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [assessment](modules/assessment.md) | – | 13 | - | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [cashtag](modules/cashtag.md) | – | 19 | - | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [connect](modules/connect.md) | ◐ | 18 | Y | PARTIAL | ⚠️ | Execute P0 money cases; add live-DB integration (§7 / gaps G5–G7) |
| [content](modules/content.md) | – | 23 | Y | PARTIAL | ⚠️ | Execute P0 cases; close §7 spec gaps |
| [credential](modules/credential.md) | – | 17 | Y | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [credentials](modules/credentials.md) | – | 15 | Y | PARTIAL | ⚠️ | Execute P0 cases; close §7 spec gaps |
| [curriculum](modules/curriculum.md) | – | 13 | Y | PARTIAL | ⚠️ | Execute P0 cases; close §7 spec gaps |
| [exam](modules/exam.md) | – | 19 | Y | PARTIAL | ⚠️ | Execute P0 cases; close §7 spec gaps |
| [investai](modules/investai.md) | – | 16 | - | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [learn](modules/learn.md) | – | 23 | - | PARTIAL | ❌ | `NewService(pool,nil)` nil audit sink (non-money, lower sev) → **task_a3eacd81 (in progress)** |
| [maps](modules/maps.md) | – | 29 | - | PARTIAL | ⚠️ | Rate limiter fails **open** on Redis error; metrics/usage guarded only in-handler |
| [notifications](modules/notifications.md) | – | 26 | Y | PARTIAL | ⚠️ | `in_app` channel maps to a push task; tasks lack dedupe id → possible double-send |
| [onboarding](modules/onboarding.md) | – | 42 | Y | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [parent](modules/parent.md) | – | 15 | Y | PARTIAL | ⚠️ | Execute P0 cases; close §7 spec gaps |
| [pharmacy](modules/pharmacy.md) | – | 14 | - | PARTIAL | ⚠️ | Execute P0 cases; close §7 spec gaps |
| [points](modules/points.md) | – | 16 | - | TODO | ⚠️ | Add automated tests (module §7); execute P0 cases |
| [progression](modules/progression.md) | – | 15 | Y | PARTIAL | ⚠️ | Execute P0 cases; close §7 spec gaps |
| [trade](modules/trade.md) | – | 17 | Y | PARTIAL | ⚠️ | Execute P0 cases; close §7 spec gaps |

## Confirmed non-compliance register (verified against code this session)

| # | Rule violated | Module(s) | Evidence | Tracker |
|---|---|---|---|---|
| 1 | Authz: privileged action must check permission (deny-by-default) | crowdfunding, wallet, disputes | `finance_routes.go` admin groups use `requireUserID()` only (lines ~1240, ~1875, ~1898) | **task_6fa26cd4** — in progress |
| 2 | Money: every money mutation must emit an audit event | spotlightwealth (money), learn (non-money) | `spotlightwealth_routes.go` + `learn_routes.go` pass `nil` Auditor | **task_a3eacd81** — in progress |
| 3 | Flag-gating + auth on mutations (brownfield) | contest (STEM) | public `/api/v1/<feature>` allows unauth mutations; no feature flag | documented (CONTEST-SEC-001/003); needs product decision |

## Leads to validate (reported by authoring, not yet code-confirmed)

| Module | Lead | Verdict so far |
|---|---|---|
| crypto | "no KYC gate; eligibility hardcoded eligible" | **Design, not a defect** — manual compliance review + whitelist/holdings/tier limit at execution |
| savings | "nil audit sink" | **False** — a real `auditor` is passed (`top5_p1_routes.go`) |
| invest | `FEATURE_INVEST_PIN_DEV_BYPASS` accepts any PIN when on | Config — assert OFF in staging/prod |
| restaurant | order-row not deduped on Idempotency-Key | Money safe (escrow reused); data-integrity question |
| notifications | `in_app` → push task; no dedupe id | Plausible double-send; validate |
| maps | rate limiter fails open on Redis error | By design (cost cap); confirm acceptable |

## How a module goes green

1. Execute its **P0** cases on staging (personas + seed data in `environments-and-data.md`).
2. Land the automated specs in its module-file **§7** (Auto: TODO → PARTIAL/AUTOMATED).
3. Close the relevant global gaps **G1–G10** (`TEST_PLAN.md` §13).
4. For ❌ rows: merge the fix + add the regression test, then flip to ✅.
