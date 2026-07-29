# Traceability Matrix

The coverage ledger for the whole suite. Rows are at **module granularity** (the per-module
files hold the individual ~1,900 case rows; reproducing them here would duplicate, not add).
Each row shows risk tier, whether it touches money, how many cases the module file defines,
whether it has a state machine, and its **automation status today** — the anchor for closing
gaps. Update the Status column as automated specs land.

- **Automation status:** `PARTIAL` = some behaviors have committed Go/Vitest tests (cited in the
  module file's §3); `TODO` = no automated tests in-package yet, all cases manual until specs
  from §7 land. (No *doc-derived* module is fully `AUTOMATED` end-to-end — the legacy money
  path lacks live-DB integration; see global gaps G5–G7 in `TEST_PLAN.md`.) **Exception:** the
  **AI-Trading (§16/§12)** cluster, built tests-first this session, uses two stronger statuses —
  `AUTOMATED` (pure deterministic, fully unit-tested) and `LIVE-DB` (unit + gated live-DB
  integration) — see its own section under Tier 0.
- **Case IDs** live in each `modules/<slug>.md`. Prefixes match the slug uppercased, except
  **marketplace → `MKT`** and **p2pmarket → `P2P`**.

## Totals

| Bucket | Files | Case IDs |
|---|---|---|
| Module files | 73 | ~1,738 |
| Cross-cutting + frontend | 12 | ~168 |
| **Total (doc-derived)** | **85** | **~1,906** |
| AI-Trading (§16/§12) — code-first packages | 13 | ~113 committed Go tests |

## Cross-cutting (apply to every relevant module)

| Doc | Focus | Tier | Key case families |
|---|---|---|---|
| `cross-cutting/authentication.md` | Bearer/Supabase, suspended/locked, session revoke | 0 | AUTH-UNIT/SEC/INT/E2E |
| `cross-cutting/rbac-and-permissions.md` | deny-by-default, scope isolation, critical-perm, last-super-admin | 0 | RBAC-AUTHZ/UNIT/SEC/INV/E2E |
| `cross-cutting/session-and-tokens.md` | session revoke, service-token 503, admin-key | 0 | SESS/SVC/ADMIN-SEC |
| `cross-cutting/money-invariants.md` | I1–I12 (kobo, double-entry, idempotency, reversal, split) | 0 | MONEY-INV |
| `cross-cutting/webhooks-and-providers.md` | HMAC verify, replay-idempotent, adapter contracts | 0 | WH-SEC/INT, PROV-CON |
| `cross-cutting/kyc-and-tiers.md` | tier fail-closed, KYC FSM | 0 | TIERS-UNIT/SEC, KYC-FSM/SEC |
| `cross-cutting/feature-flags-and-audit.md` | flag-off gating, audit-on-mutation | 0/1 | FLAG-SEC, AUDIT-INT |

## Frontend surfaces

| Doc | Prefix | Tier | Notes |
|---|---|---|---|
| `frontend/web-api-routes.md` | WEB | 0 | auth, paystack webhook routing, wallet/utility, 3 voting engines, proxies |
| `frontend/admin-dashboard.md` | ADM | 0 | RBAC grants, KYC/withdrawal review, maker-checker, refund/override, audit |
| `frontend/extranet.md` | EXT | 1 | Stays supplier: go-live gating, overbooking, payout accrual |
| `frontend/mobile-app.md` | MOB | 0 | e2e money journeys, exactly-once, logout, role apps |
| `frontend/trading-backend.md` | TRADE | 0 | server-side re-pricing, idempotent trade/withdraw, AML, JWKS auth, recon |

## Tier 0 — critical path (red = do not ship)

| Module | Prefix | Money | Cases | FSM | Automation status |
|---|---|---|---|---|---|
| ledger | LEDGER | yes | 24 | – | PARTIAL |
| escrow | ESCROW | yes | 18 | Y | PARTIAL |
| settlement | SETTLEMENT | yes | 17 | Y | PARTIAL |
| wallet | WALLET | yes | 15 | – | PARTIAL |
| transfers | TRANSFERS | yes | 22 | Y | PARTIAL |
| va | VA | yes | 12 | – | PARTIAL |
| cards (maplerad WaaS) | CARDS | yes | 21 | Y | PARTIAL |
| fxlegacy | FXLEGACY | yes | 15 | – | PARTIAL |
| fxorch | FXORCH | yes | 22 | Y | PARTIAL |
| crypto | CRYPTO | yes | 36 | Y | PARTIAL |
| invest | INVEST | yes | 36 | Y | PARTIAL |
| savings | SAVINGS | yes | 41 | Y | PARTIAL |
| spotlightwealth | SPOTLIGHTWEALTH | yes | 22 | Y | TODO |
| edupay | EDUPAY | yes | 24 | Y | PARTIAL |
| fees (subtree) | FEES | yes | 33 | Y | PARTIAL |
| restaurant | RESTAURANT | yes | 31 | Y | PARTIAL |
| transport | TRANSPORT | yes | 39 | Y | PARTIAL |
| stays | STAYS | yes | 36 | Y | TODO |
| insurance | INSURANCE | yes | 44 | Y | TODO |
| crowdfunding | CROWDFUNDING | yes | 68 | Y | PARTIAL |
| estate | ESTATE | yes | 35 | Y | PARTIAL |
| association | ASSOCIATION | yes | 24 | Y | PARTIAL |
| social (Social Pay) | SOCIAL | yes | 33 | Y | TODO |
| spray | SPRAY | yes | 18 | – | PARTIAL |
| top5events | TOP5EVENTS | yes | 15 | Y | PARTIAL |
| groups | GROUPS | yes | 17 | – | PARTIAL |
| telemedicine | TELEMEDICINE | yes | 24 | Y | PARTIAL |
| votebridge | VOTEBRIDGE | yes | 24 | – | PARTIAL |

## Tier 0 — AI Trading (§16 / §12) — code-first

Built **tests-first** this session (`backend/internal/trading/*`). Unlike the doc-derived rows
above, these are **code-first**: the committed Go tests *are* the spec (no separate
`modules/*.md` case files), so the "Go tests" column is the committed test-function count.
Two automation statuses apply here, both stronger than `PARTIAL`:
- **`AUTOMATED`** — pure, deterministic package fully covered by in-package unit tests; no I/O
  to integrate. This is where the money-critical decision logic lives.
- **`LIVE-DB`** — unit-tested **plus** a gated live-DB integration test (`DATABASE_URL`),
  exercising persistence + separation-of-duties end to end against Postgres.

**Nothing in this cluster can place a real order:** the only venue adapter is a reject-all
`NoopAdapter`, and `/trading/evaluate` returns `executed:false`. Both flags default OFF
(`FEATURE_TRADING_ENABLED`, `FEATURE_AI_TRADING_ENABLED`).

| Module | Package | Money | Go tests | FSM | Automation status |
|---|---|---|---|---|---|
| Module-KYC (access gate) | `trading/kyc` | access | 14 | Y | LIVE-DB |
| Fund wallet (unitized NAV, HWM fees) | `trading/wallet` | **yes** | 27 | – | LIVE-DB |
| Risk engine (size + hard veto) | `trading/quant/risk` | decision | 13 | – | AUTOMATED |
| Regime detector | `trading/quant/regime` | decision | 5 | – | AUTOMATED |
| Signals (rule-based candidates) | `trading/quant/signals` | decision | 6 | – | AUTOMATED |
| Backtester (conservative costs) | `trading/quant/backtest` | decision | 6 | – | AUTOMATED |
| Validation harness (deflated Sharpe) | `trading/quant/validate` | decision | 6 | – | AUTOMATED |
| Committee consensus + schema boundary | `trading/quant/committee` | decision | 9 | – | AUTOMATED |
| LLM reasoners + explanation narrator | `trading/quant/reasoner` | decision | 7 | – | AUTOMATED |
| End-to-end decision pipeline | `trading/quant/pipeline` | decision | 4 | – | AUTOMATED |
| §12 promotion ladder (pure FSM) | `trading/ladder` | gate | 9 | Y | AUTOMATED |
| §12 promotion service (maker-checker) | `trading/promotion` | gate | 1 | Y | LIVE-DB |
| Venue-adapter contract + envelope | `trading/venue` | exec-boundary | 6 | – | AUTOMATED |

> Key invariants proven here (keep green): `committee` veto-absolute + malformed-abstains;
> `reasoner` compromised-LLM-can't-force-a-trade; `risk` veto/circuit; `ladder` gate matrix;
> `promotion` maker≠checker + Risk+legal-for-Live (live-DB); `venue` fail-closed Transmit +
> no-op-never-trades. Admin console, mobile transparency, and the go-live runbook +
> venue-adapter spec are tracked in the frontend/docs rows and `docs/ops/AI_TRADING_*`.

## Tier 1 — user-money-adjacent / sensitive

| Module | Prefix | Money | Cases | FSM | Automation status |
|---|---|---|---|---|---|
| academycommerce | ACADEMYCOMMERCE | yes | 27 | Y | PARTIAL |
| academyrewards | ACADEMYREWARDS | yes | 19 | – | PARTIAL |
| academyplatform | ACADEMYPLATFORM | no | 15 | – | TODO |
| schools | SCHOOLS | yes | 18 | Y | PARTIAL |
| tutor | TUTOR | yes | 16 | Y | PARTIAL |
| business (CAC) | BUSINESS | yes | 29 | Y | TODO |
| commission | COMMISSION | yes | 22 | – | TODO |
| disputes | DISPUTES | no | 14 | Y | PARTIAL |
| ratings | RATINGS | no | 13 | – | PARTIAL |
| referral | REFERRAL | yes | 42 | Y | PARTIAL |
| referralsfin | REFERRALSFIN | yes | 22 | Y | PARTIAL |
| fractionalre | FRACTIONALRE | yes | 34 | Y | PARTIAL |
| marketplace | MKT | yes | 34 | Y | PARTIAL |
| p2pmarket | P2P | yes | 17 | Y | TODO |
| placement | PLACEMENT | yes | 36 | Y | PARTIAL |
| loyalty | LOYALTY | no | 20 | – | PARTIAL |
| creators | CREATORS | yes | 12 | – | TODO |
| doctor | DOCTOR | yes | 17 | Y | PARTIAL |
| health | HEALTH | partial | 18 | Y | PARTIAL |
| nutrition | NUTRITION | no | 20 | Y | PARTIAL |
| property | PROPERTY | no | 17 | – | TODO |
| realtor | REALTOR | no | 24 | – | TODO |
| aicare | AICARE | no | 19 | Y | PARTIAL |
| contest (brownfield) | CONTEST | no | 32 | Y | PARTIAL |

## Tier 2 — content / non-money

| Module | Prefix | Money | Cases | FSM | Automation status |
|---|---|---|---|---|---|
| connect | CONNECT | partial | 18 | Y | PARTIAL |
| arena | ARENA | yes | 52 | Y | PARTIAL |
| academyidentity | ACADEMYIDENTITY | no | 16 | Y | PARTIAL |
| curriculum | CURRICULUM | no | 13 | Y | PARTIAL |
| content | CONTENT | no | 23 | Y | PARTIAL |
| progression | PROGRESSION | no | 15 | Y | PARTIAL |
| assessment | ASSESSMENT | no | 13 | – | TODO |
| exam | EXAM | no | 19 | Y | PARTIAL |
| credentials (academy) | CREDENTIALS | no | 15 | Y | PARTIAL |
| academylive | ACADEMYLIVE | no | 17 | Y | PARTIAL |
| parent | PARENT | no | 15 | Y | PARTIAL |
| trade | TRADE | no | 17 | Y | PARTIAL |
| learn | LEARN | no | 23 | – | PARTIAL |
| maps | MAPS | no | 29 | – | PARTIAL |
| cashtag | CASHTAG | no | 19 | – | TODO |
| onboarding | ONBOARDING | no | 42 | Y | TODO |
| notifications | NOTIFICATIONS | no | 26 | Y | PARTIAL |
| credential (primitive) | CREDENTIAL | no | 17 | Y | TODO |
| points | POINTS | no | 16 | – | TODO |
| investai | INVESTAI | no | 16 | – | TODO |
| pharmacy | PHARMACY | no | 14 | – | PARTIAL |

## How to drive this to green

1. Execute all **P0** cases in Tier-0 module files + the cross-cutting suites on staging.
2. For `TODO` modules, land the specs listed in each file's §7 — priority order:
   `commission`, `creators`, `spotlightwealth` (nil audit sink), `stays`/`insurance`
   (settlement integration), `p2pmarket`, `business`.
3. Close global gaps **G1–G10** (`TEST_PLAN.md` §13): add `test:regression`, extend
   `contract:check`, add money-path live-DB integration + concurrency, add auth/RBAC e2e.
4. Flip Status → `PARTIAL`/`AUTOMATED` as specs land; keep this matrix current.

## Findings surfaced during authoring (real, code-grounded — route to engineering)

These emerged while grounding cases in code. They are **potential defects**, captured as
security/regression cases in the relevant module files — not fixed here (docs-only deliverable).

| Area | Finding | Where captured |
|---|---|---|
| crowdfunding | `/api/crowdfunding/admin` (payouts, refunds, KYC, freeze) gated by `requireUserID()` only — no RBAC | CROWDFUNDING-SEC-003 |
| wallet / disputes | Admin routes mounted with `requireUserID()` only, no `RequirePermission` | WALLET-AUTHZ-003, DISPUTES-AUTHZ-003 |
| contest (STEM) | Public `/api/v1/<feature>` generation allows unauthenticated high-impact mutations; no feature flag | CONTEST-SEC-001/003 |
| spotlightwealth / savings / learn | Wired with **nil audit sink** — money/privileged mutations emit no audit event | *-SEC-002 / LEARN-SEC-004 |
| crypto | No KYC/tier gate; address "screening" is a length check; client-supplied `fee_kobo` | CRYPTO-SEC-* |
| invest | `FEATURE_INVEST_PIN_DEV_BYPASS` accepts any PIN when on — must be off in prod | INVEST-SEC-002 |
| restaurant | `PlaceOrder` has no KYC/tier gate and order-row not deduped on Idempotency-Key | RESTAURANT-SEC-003 |
| referral / arena / crypto | `Idempotency-Key` presence-checked but **not** length-enforced (≥8, I10) | respective SEC cases |
| notifications | `in_app` channel maps to a push task (no in-app consumer); tasks have no dedupe id → possible double-send | NOTIFICATIONS-INV-001 |
| maps | rate limiter **fails open** on Redis error; metrics/usage guarded only in-handler | MAPS-SEC-* |

> Recommend spinning each confirmed item into its own engineering task; several are Tier-0
> authorization gaps.
