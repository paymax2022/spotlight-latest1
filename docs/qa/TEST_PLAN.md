# Spotlight Super-App — Master Test Plan

Strategy layer for the whole suite. Read `README.md` first for conventions and the Case-ID
scheme. This document is the contract for **what we test, at which level, and what must be
green before merge and before go-live.** It implements the QA-engineering pyramid for this
repo and builds on `backend/tests/TEST_STRATEGY.md` (do not duplicate — this generalizes it to
every module).

## 1. Scope

**In scope:** every backend module under `backend/internal/**` and
`mobile-app/reactnative/backend/` (standalone trading service); the web app API routes and
key flows (`frontend-web/`); the admin dashboard (`frontend-admin/`) and Stays extranet; the
React Native app (`mobile-app/reactnative/`). Auth and RBAC are treated as cross-cutting and
tested against every protected surface.

**Out of scope:** third-party provider internals (we test our adapter + the contract at the
network edge, in sandbox); marketing/CMS static pages beyond a render smoke check; visual/pixel
regression.

## 2. Guardrails (read before writing or running any test)

- **Brownfield protection.** The legacy Spotlight contest modules — contests, voting,
  applicants, legacy auth — are protected by a PreToolUse hook and must **never be modified**.
  Test them through **observable behavior only**. No test setup may edit a protected path; wrap
  via adapters (see the `vote-bridge` skill / `internal/votebridge`).
- **Additive-only migrations.** No test introduces a DROP / rename / type-narrowing migration.
  Integration tests seed and clean their own rows.
- **Money = integer kobo.** Enforced in every case's test data and assertions. No floats.
- **Synthetic data only.** No production data, no real PII, no live financial credentials.

## 3. The pyramid, mapped to this repo

```
              ╱ e2e ╲            few — whole-journey smoke: login→RBAC op, topup→spend→statement,
            ╱─────────╲                 buy-crypto, book-stay, pay-school-fees
          ╱ integration ╲        some — handler+real Postgres, webhook handlers, provider
        ╱─────────────────╲             adapters mocked at the network edge, FSM against DB
      ╱     unit (most)     ╲     many — ledger projection, fee/split math, tier limits,
    ╱─────────────────────────╲          state-machine transitions, RBAC scope, validation
```

Anti-pattern to avoid: the ice-cream cone (mostly slow e2e). Push logic down. Reserve e2e for
the handful of journeys we cannot afford to break (§8).

| Layer | Runner / where | When it runs |
|---|---|---|
| Unit / Invariant | `go test` (package-local + `backend/tests/`), Vitest (`frontend-web/tests/unit`) | Every PR (per-module lanes + frontend gate) |
| Contract | Go DTO↔openapi (`backend/tests/contract_finance_test.go`), `npm run contract:check` | Every PR |
| Integration (live-DB) | `go test` gated on `TEST_DATABASE_URL` / `DATABASE_URL` | `integration-verify.yml` (postgres:16) |
| E2E | Playwright (`mobile-app/reactnative/tests/e2e`) | Deploy pipeline + nightly |
| Load | k6 (`tools/loadtest/*`) | On demand / pre-go-live |

## 4. Risk tiering (drives priority & coverage target, not documentation depth)

Every module is documented to the same template and depth. **Risk tier sets the P-priority of
its cases and its coverage floor.**

### Tier 0 — critical path. Red = do not ship. Coverage floor ≥ 85% on pure-logic funcs.
Authentication, RBAC/permissions, sessions & tokens, `finance/ledger`, `escrow`,
`finance/settlement`, `finance/transfers`, `finance/wallet`, `finance/va`, `finance/tiers`,
`finance/kyc` + `finance/kycverify`, `finance/maplerad` (cards), `crypto`, `orchestration` (FX),
`invest`, `savings`, `webhooks` + provider adapters, `votebridge`, and the money rails inside
academy (`commerce`, `edupay`, `fees`), transport, restaurant, stays (settlement),
crowdfunding (wallet), insurance (policy/claims), events (cashless), social/spray/groups dues.

### Tier 1 — user-money-adjacent or sensitive data. Red = blocks the feature.
`commission`, `disputes`, `ratings`, `referrals`, `loyalty`/`points`, `creators`,
`fractionalre`, `spotlightwealth`, `p2pmarket`, `marketplace` (deals/boosts), `business`/CAC,
`placement`, `association`, `estate`, `property`/`realtor`, health money paths (consult fee,
pharmacy order, lab payment), `top5events`, `connect` (gifting/voting/payouts), academy
`tutor`/`schools`/`trade`/`rewards`.

### Tier 2 — content / non-money. Red = tracked defect.
`investai` (advice-refusal guardrails — actually P0 for the *refusal* behavior), academy
identity/curriculum/content/progression/assessment/exam/credentials/live/parent/gamification,
health clinical content (triage/intake/records/rx/lab clinical/vet clinical), `arena`, `learn`,
`maps`, `cashtag`, `onboarding`, `notifications`, connect profile/matching/chat/moderation,
legacy contest platform (STEM/voting/reality-tv/open-mic/film-academy/registration —
behavior-only, brownfield).

## 5. What gets the deepest coverage (critical behaviors, everywhere they occur)

1. **Money movement** — topup, wallet/bank transfer, settlement split, reversal, every
   vertical debit/credit. Invariants (see `cross-cutting/money-invariants.md`): balanced
   double-entry; balance == ledger projection (no cached column); no overdraw; **idempotent
   replay**; integer kobo; reversal restores prior balance and never mutates history.
2. **Authorization** — deny-by-default; allowed vs denied caller for every protected action;
   object-level / IDOR (user A cannot act on user B's record); scope isolation (a grant in
   scope A must not leak to scope B); critical-permission assignment restricted to super-admin;
   last-super-admin and system-role/permission protection.
3. **Auth & session** — token validation, suspended/locked/deleted account blocked (403),
   session revocation fail-closed, service-token & admin-key gates.
4. **State machines** — every allowed transition produces the right state + side effects; every
   illegal transition is rejected; re-entering a terminal state is idempotent.
5. **Webhooks** — HMAC/signature verification (forgery rejected); idempotent application of
   provider events (replayed event does not double-post).

## 6. Test types applied per module (the fixed template)

Each module/cross-cutting file carries: overview + risk tier · endpoint/service inventory ·
per-layer coverage matrix (citing existing tests) · **detailed manual cases** (happy /
negative / boundary / authz / idempotency / concurrency) · **state-machine table** where
applicable · **security & abuse cases** · **automated specs to add** · coverage target & exit
criteria.

## 7. Tooling matrix

| Need | Tool / command | Convention to follow |
|---|---|---|
| Go unit/invariant | `cd backend && go test ./... -race -count=1` | table-driven `t.Run`, explicit boundary enumeration, DB-free reference model transcribing the production formula (e.g. `tests/ledger_invariants_test.go`, `tests/settlement_split_test.go`). |
| Go integration | `TEST_DATABASE_URL=… go test ./tests/<vertical>/...` | skip-gate helper `liveDBPool(t)`; self-seed with fresh UUIDs; per-file bring-up note. |
| Go contract | `go test ./backend/tests/ -run Contract` | marshal DTO, assert required JSON keys + enum membership vs `contracts/*.yaml`. |
| Web unit | `cd frontend-web && npx vitest run` | hoisted `vi.mock` before importing the route handler; `makeSupabaseMock()` chainable factory; `makeRequest`/`withAuth`. |
| Web money invariants | `npm run test:money` | kobo-exact, mandatory `Idempotency-Key`, Paystack HMAC-SHA512 verify. |
| Web contract | `npm run contract:check` | currently estate-only — **extend to more contracts (gap G2)**. |
| Mobile e2e | `cd mobile-app/reactnative && npm run test:e2e` | `page.route('**/…')` returns fixture JSON and **captures** request bodies; drive real UI. |
| Load | `make <module>-loadtest` (k6) | `tools/loadtest/{marketplace,transport_scheduled}`. |
| Type/lint | `npx tsc --noEmit`, `npm run lint`, `go vet ./...` | — |

## 8. E2E journeys (the few we protect)

| Journey | Surface | Tier |
|---|---|---|
| Login → suspended-user blocked → valid session | web + backend | 0 |
| Admin login → grant a role → protected op allowed → revoke → denied | admin + backend | 0 |
| Wallet topup → verify → spend → statement reflects ledger | web/mobile + backend | 0 |
| Buy crypto → order fills → portfolio + ledger reconcile | mobile + trading backend | 0 |
| Utility bill pay: insufficient balance blocked; double-click → 1 charge | mobile | 0 |
| Pay school fees (invoice → payment → reconcile) | web/mobile + academy | 0 |
| Book a stay → pay → supplier settlement accrues | mobile + stays | 1 |
| Paid vote via vote-bridge debits wallet exactly once | web + votebridge | 0 |

## 9. CI quality gates

**Block merge** on every PR (this generalizes TEST_STRATEGY.md §CI):

```bash
cd backend && go vet ./... && go build ./...
cd backend && go test ./internal/finance/... ./internal/middleware/... \
                      ./internal/services/... ./tests/...   # + the touched module's lane
cd frontend-web && npx tsc --noEmit && npx vitest run
cd frontend-admin && npm run type-check
npm run test:regression    # golden-path (see gap G1 — script currently missing)
npm run test:money
npm run contract:check
```

**Block deploy** additionally on: a smoke e2e (admin login + one RBAC op + one wallet read),
a dependency/secret scan (`scripts/check-client-secrets.sh`), and the live-DB integration lane
(`integration-verify.yml`).

**Coverage policy:** enforce where it matters — money path (`internal/finance/...`,
`internal/crypto`, `internal/orchestration`) and authorization (`internal/middleware`,
`internal/services` RBAC) ≥ **85%** on pure-logic functions. Do not chase blanket repo %; do
not gate on trivial DTO coverage.

## 10. Defect severity & release rule

| Severity | Definition | Release rule |
|---|---|---|
| **S1 Blocker** | Money incorrect/lost/double-charged; auth bypass; privilege escalation; data corruption; ledger imbalance. | No ship. |
| **S2 Critical** | A Tier-0/1 flow is broken with no workaround. | No ship without sign-off + mitigation. |
| **S3 Major** | Feature broken but has a workaround; incorrect non-money behavior. | Ship with tracked fix + owner. |
| **S4 Minor** | Cosmetic, rare edge, copy. | Backlog. |

Any failing **P0** case ⇒ at least **S2**; a money-invariant or authz failure ⇒ **S1**.

## 11. Entry / exit criteria

**Entry (start a test cycle):** target build deploys to staging; migrations applied cleanly
(additive-only guard green); feature flags set to the intended go-live state; personas & seed
data loaded; provider sandboxes reachable.

**Exit (sign off a cycle):** all P0 cases pass on every in-scope surface; no open S1/S2; the
CI merge gate and deploy gate are green; the go-live checklist (§12) is complete; the
traceability matrix shows no P0 case in `TODO`/`MANUAL`-only where automation was promised.

## 12. Go-live checklist

- [ ] All Tier-0 module files' P0 cases pass (auth, RBAC, ledger, wallet, transfers, va, tiers,
      kyc, crypto, fx, cards, webhooks, votebridge, academy fees, transport, restaurant, stays,
      crowdfunding, insurance, events).
- [ ] `ADMIN_API_KEY` set (admin guard not dev-permissive); `LEDGER_SERVICE_TOKEN` set
      (service guard fail-closed); all `*_PROD` provider toggles correct for the target env;
      `FEATURE_INVEST_PIN_DEV_BYPASS` **off**.
- [ ] Every money mutation confirmed to require `Idempotency-Key`; replay = no-op verified per
      Tier-0 module.
- [ ] Webhook signature verification confirmed for Paystack/Monnify/Maplerad/Eversend and KYC
      providers; replayed event does not double-apply.
- [ ] Reconciliation jobs (crypto, top5events pending-order, transport scheduler, marketplace
      cron) run clean against staging.
- [ ] The 8 E2E journeys (§8) green on staging.
- [ ] Known gaps (§13) either closed or explicitly risk-accepted with an owner.

## 13. Known gaps to close (from TEST_STRATEGY.md §gaps + CI docs)

| ID | Gap | Action |
|---|---|---|
| G1 | `test:regression` script referenced everywhere but **absent** from package.json; CI works around it. | Add `"test:regression": "vitest run tests/unit/golden-path"` to `frontend-web/package.json`. |
| G2 | `contract:check` covers **only** the estate contract; 18 other openapi files unguarded. | Extend `frontend-web/scripts/contract-check.mjs` to walk all `contracts/*.yaml`. |
| G3 | Repo-wide `ci.yml` runs **no** `go test` (only build+vet). Go tests depend on path-filtered per-module lanes + `integration-verify`. | Ensure every module has a CI lane; add a scheduled full `go test` run. |
| G4 | No true e2e for admin RBAC or the wallet topup→spend→statement journey. | Add the §8 journeys as Playwright specs. |
| G5 | DB-integration missing for core money path (ledger/transfers/settlement/tiers) — invariants proven only against the reference model. | Add `live_db_integration_test.go` for these against ephemeral Postgres. |
| G6 | Tier fail-closed at the DB-error seam (`EnforceWalletDebitLimit`) untested with a real erroring pool. | Add integration test with a faked/erroring pool. |
| G7 | Concurrent same-key against the **real** unique constraint + advisory lock untested. | Add N-goroutine integration test. |
| G8 | Money DRIFT: `voting/free-vote.spec.ts` uses ±₦1 naira-float tolerance instead of kobo-exact. | Tighten to kobo-exact once the paid-vote path is reconciled. |
| G9 | Per-vertical settlement integration (telemedicine/estate/transport/restaurant) — only split *math* covered. | Add settlement integration tests as each vertical stabilizes. |
| G10 | Thin provider coverage: `eversend`, `mycover`, `octamile`, `cac` adapters lack signature/webhook tests. | Add adapter contract + webhook-signature tests. |
