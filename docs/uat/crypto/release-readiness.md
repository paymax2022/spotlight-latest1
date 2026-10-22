# Crypto Trading (Quidax) — Production Readiness / Go–No-Go

Build under test: `160d8313a3d1` · branch `fix/marketplace-voting-admin-followups` · 2026-10-21.
Method: automated suites only. No live-provider calls, no VAPT, no UI automation, no shared/prod
DB mutation were performed (BR-18). Per BR-20 and spec §13, a module is **not** "100% production
ready" until applicable tests + technical gates + independent VAPT + human approval are complete.

## Decision: **NO-GO** for a production release — GO for continued build & staging test.

This is not a failure of the module: the implemented trading/swap money path is mature and its
automated verification is **fully green (281 tests, 0 fail, incl. live-DB double-spend,
exactly-one-terminal-outcome, conservation, refund, replay-safety, reconciler leader-lock, KYC
gate, subaccount once-only)**. The NO-GO is the *only* honest outcome because several mandatory
release gates cannot be satisfied in this environment and must never be fabricated.

## Gate-by-gate against spec §13

| # | Gate | Status | Evidence / blocker |
| --- | --- | --- | --- |
| 1 | 100% Core P0 pass with evidence | **Not met** | Automated core-P0 (LED/FEE/WEB/ORD/SUB/WDR/REC/RBAC/ABU) green; but DEP(20 P0), partial FILL/RISK/ADM/REP P0 have no passing tests |
| 2 | 100% applicable E2E pass + ≥1 provider-authorized contract run | **Not met** | E2E-05 now wired+tested via mock/live-DB (slice1+2) but Partial/Blocked — no live Quidax webhook run, reconciler + slice-3 surface unbuilt; E2E-27/29 still Blocked; ≥1 live Quidax contract run blocked — no permitted creds |
| 3 | Independent VAPT (ASVS 5.0 / API Top10 2023 / MASVS) with no open Crit/High | **Not met** | Not run (BR-18: no authorized staging/scanning); cannot claim |
| 4 | Approved latency/throughput/queue/RTO/RPO gates | **Not met** | Owner must set numeric SLOs first (spec §11); no load/chaos lab |
| 5 | Zero unexplained balance variance / overspend / dup / cross-account / unresolved VAPT | **Partially proven** | Money invariants hold in-suite; VAPT variance & live reconciliation across full tx set unverified |
| 6 | Independent Finance, Compliance/Legal, Security, QA, Product, SRE signoff | **Not met** | Human approvals out of scope |

## What is DONE and trustworthy (evidence-backed)
- Backend provider abstraction + real Quidax HTTP adapter (retry/rate-budget/secret-safety) +
  deterministic mock + registry + swap FSM + webhook HMAC verify — `cryptoprov` 50 tests green.
- Swap pipeline (quote→confirm→webhook/reconciler→double-entry settle), fee schedules with
  precision guards + versioned audit, reconciliation with leader lock, admin resolve safety
  (no-double-credit), step-up PIN, per-user rate limits, fail-closed wiring — `cryptosvc` green.
- Legacy trading surface (buy/sell/swap/addresses/deposit-address/withdrawals FSM/portfolio) with
  invariants + tier gate + atomicity — `crypto` green.
- Mobile (34 screens) and admin console wired to the real routes, live-by-default in `.env`.

## What MUST be built/tested before any GO (highest first)
1. **GAP-DEP-01** inbound deposit settlement — **slices 1 + 2 (settlement core + webhook
   routing) are now built, wired to the live endpoint and live-tested** (`deposit.*` delivery →
   provider re-query → confirmation-gated, once-only credit; value never taken from the payload).
   Still required: **slice 2 carry-over** (a deposit reconciler polling `ListDeposits` for missed /
   under-confirmed webhooks) and **slice 3** (admin exception queue + mobile pending→credited +
   receipt). Until those run and are exercised against a live Quidax webhook, E2E-05/27/29 remain
   Partial/Blocked.
2. **GAP-FILL-01** limit-order partial-fill + cancel-residual release.
3. **GAP-MKT-01** orderbook endpoint (authoritative live source).
4. **GAP-RISK-01 / GAP-ADM-01** sanctions/velocity/geofence hold; maker-checker + emergency kill-switch.
5. **GAP-REP-01** customer statement / P&L export.

## What MUST be arranged outside the code (cannot be delivered here)
- Permitted Quidax **TEST** tenant for ≥1 authorized contract run of critical schemas (no live funds).
- Authorized **VAPT** engagement + staging; owner-set numeric **SLO/RTO/RPO** + fault/chaos lab;
  golden-dataset **regression**; **privacy/legal** review.
- **Human signoff** from Finance, Compliance/Legal, Security, QA, Product, SRE.

## Bottom line
Implementation completeness of the *trading* plane is high and its money invariants are proven.
The *deposit (money-IN)* plane is now **built and wired to the live webhook endpoint** and
live-tested against the mock provider and the isolated local DB (slice 1 + 2 of GAP-DEP-01): a
confirmed, correctly-resolved inbound transfer credits the owner's holdings exactly once, and the
credit always comes from a provider re-query, never the payload. It is nevertheless **not** release
-ready: the deposit reconciler and the admin/mobile surface (slice 3) are unbuilt, the Quidax
webhook contract (event name, `confirmations` field, status vocabulary) is unverified in the TEST
sandbox, and the release gates that require live credentials, authorized security testing, a
performance/DR lab, and human approval are all **Blocked/Not Run** — recorded as such, never as
Pass. A truthful "100% production ready" claim would misrepresent the system. Next actionable step
that is credential-free and safe: build GAP-DEP-01 **slice 3** (admin exception queue + mobile
pending→credited + receipt) and a deposit reconciler, with failing-assertion-first tests against
the mock provider and the isolated local DB.
