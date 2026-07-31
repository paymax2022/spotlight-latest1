# AI Trading — Go-Live Runbook (§12)

**Status:** the platform is built to **paper / eligibility only**. There is **no venue
adapter** in this codebase, and no code path can place a real order. This runbook is the
procedure to take the AI-trading system from that state toward live capital, one
reversible step at a time. Do not skip a section.

> Owner: Head of Trading + Risk Officer (jointly). Review cadence: before every stage
> promotion, and after any incident. This document is version-controlled; changes are PRs.

---

## 1. Absolute invariants (never violated, no exceptions)

These come from the build brief and are enforced in code + tests. Any change that weakens
one is a **stop-ship**.

1. **No LLM emits a number that moves money.** Sizes, prices, and risk figures are computed
   by deterministic Go (`internal/trading/quant/{risk,regime,signals,backtest,validate}`).
   The LLM committee only *selects among / vetoes / explains* pre-sized, risk-screened
   candidates, behind a schema that discards any out-of-range value
   (`quant/committee.Validate`, `quant/reasoner`). Proven by
   `TestVote_CompromisedLLMCannotForceTrade`.
2. **Risk & Safety hold absolute vetoes.** A hard veto (Risk / Portfolio / Safety) or a
   tripped circuit breaker kills a trade regardless of every other vote or consensus
   (`quant/risk.Screen`, `quant/committee.Decide`). Proven by `TestDecide_VetoIsAbsolute`.
3. **Money is integer kobo, double-entry, idempotent.** All cash moves through the finance
   ledger via the fund wallet (`internal/trading/wallet`); balances are ledger projections;
   every mutation carries an `Idempotency-Key`.
4. **Client funds are segregated** and never used for operating expenses.
5. **Venue API keys, when they exist, are trade-only with withdrawals disabled.** (Not yet
   present — see §8.)
6. **No guaranteed-return language** anywhere, member-facing or internal.
7. **Live trading is gated behind the §12 ladder AND legal sign-off.** Reaching "Live" on the
   ladder is *eligibility*, not execution.
8. **Module KYC is decoupled** from the app's Tier 0–3 (`internal/trading/kyc`); trading
   access is granted only by an `APPROVED` (or unexpired `BYPASSED`) Module-KYC record.

---

## 2. What is built vs. what is NOT

| Layer | State | Location |
|---|---|---|
| Module-KYC (access gate) + admin console | ✅ built, tested | `internal/trading/kyc`, admin `/admin/trading/kyc` |
| Unitized-NAV fund wallet (subscribe/redeem, HWM fees) | ✅ built, twice-audited | `internal/trading/wallet` |
| Deterministic quant core (risk, regime, signals, backtester, validation) | ✅ built, tested | `internal/trading/quant/*` |
| Committee consensus + LLM reasoner/narrator (schema-bounded) | ✅ built, tested | `internal/trading/quant/{committee,reasoner}` |
| End-to-end decision pipeline | ✅ built, tested | `internal/trading/quant/pipeline` |
| §12 promotion ladder (FSM + service + admin + member transparency) | ✅ built, live-DB verified | `internal/trading/ladder`, `internal/trading/promotion` |
| `POST /trading/evaluate` (records nothing, `executed:false`) | ✅ built | `internal/trading/promotion_handler.go` |
| Venue-adapter **contract** (interface + fail-closed envelope + reject-all no-op) | ✅ built, tested | `internal/trading/venue`, `docs/ops/AI_TRADING_VENUE_ADAPTER_SPEC.md` |
| **Venue adapter — real implementation (order execution)** | ❌ **NOT built** | — see §8 |
| **Live market-data feed (validated, point-in-time)** | ❌ **NOT built** | — see §8 |
| **Legal sign-off** | ❌ external | — see §7 |

**Consequence:** the earliest a real order could be placed is *after* §8 (venue adapter) is
built, reviewed, and itself promoted through this same ladder. Everything before that is
paper.

---

## 3. Roles & separation of duties (RBAC)

Seeded in migrations `20261029000200` (KYC) and `20261029000300` (promotion). No single
person can move a strategy toward capital.

| Role (slug) | Permissions | Can |
|---|---|---|
| `trading-kyc-reviewer` | `trading.kyc.review`, `trading.audit.read` | Approve/reject Module-KYC |
| `trading-compliance` | `trading.kyc.bypass.approve`, `trading.audit.read`, `trading.kyc.review` | Second-approve KYC bypass |
| `trading-risk` | `trading.promotion.halt`, `trading.promotion.risk`, `trading.promotion.read` | Provide Risk sign-off; halt/de-risk any strategy |
| `super-admin` / `system-admin` | all `trading.*` | Everything (break-glass) |

**Two-person rules (enforced in the DB, the service, and the pure FSM):**
- **KYC bypass:** maker (`trading.kyc.bypass`) ≠ checker (`trading.kyc.bypass.approve`).
- **Promotion:** the acting admin is the **checker** (`trading.promotion.approve`) and passes
  the **maker** id; they must differ. Enforced by `ladder.CanTransition` + a DB `CHECK`.
- **Canary → Live** additionally requires a **Risk sign-off** and a **legal sign-off** flag.

---

## 4. Feature flags & activation sequence

Two independent, default-OFF flags. Turn them on in order, never together as a first move.

| Flag | Env | Gates | Default |
|---|---|---|---|
| Paper fund | `FEATURE_TRADING_ENABLED` | Module-KYC + fund wallet routes | `false` |
| AI decision surface | `FEATURE_AI_TRADING_ENABLED` | `/trading/evaluate`, `/trading/promotions*`, `/trading/strategies` | `false` |

**Activation order:**
1. `FEATURE_TRADING_ENABLED=true` → members can KYC and hold the paper fund. Observe for a
   soak period. Watch ledger invariants (§10).
2. `FEATURE_AI_TRADING_ENABLED=true` → the decision pipeline + promotion ladder become
   reachable. **Still executes nothing** (`executed:false`). This is when Risk/Trading begin
   walking strategies up the ladder.
3. (Future) venue-execution flag — does not exist yet; introduced only with §8, default OFF,
   and itself gated on a strategy being at `canary`/`live` **and** the operator turning it on
   per-venue.

Rollback is always: set the flag `false` and redeploy — the routes go dark; no data is lost.

---

## 5. The §12 promotion ladder — operational procedure

```
NOT_PROMOTED → PAPER → SHADOW → CANARY → LIVE          (+ HALTED from any active stage)
```

Forward is one rung at a time through gates; **demotion / halt is always allowed**. A tripped
circuit blocks all promotion but never blocks halting. Admin surface:
`/admin/trading/promotions` (console) → backend `/api/v1/admin/trading/promotions/*`.

### Per-stage procedure

**Register** (`trading.promotion.propose`) — add the strategy id → enters `NOT_PROMOTED`.

**→ PAPER** — enter freely (no capital, no track record). The pipeline runs on paper data;
decisions are recorded/observed. **Exit criteria before proposing SHADOW:** the strategy has
a clean paper run and a *passing* validation verdict recorded via **Readiness**
(`trading.promotion.risk`): set `validation_passed=true`, `track_record_days ≥ 30`.

**→ SHADOW** (checker + maker) — gate: passing verdict + ≥ 30 track-record days. The strategy
runs alongside a benchmark; still no money. **Exit before CANARY:** verdict still passing,
`track_record_days ≥ 60`, no unresolved incidents.

**→ CANARY** (checker + maker, maker ≠ checker) — gate: passing verdict + ≥ 60 days +
two-person. Canary is a *tiny capped allocation* — **but execution is stubbed until §8**.
Treat Canary today as "cleared to be first when execution exists." **Exit before LIVE:**
verdict passing, `track_record_days ≥ 90`, Risk sign-off obtained, legal sign-off obtained.

**→ LIVE** (checker + maker + Risk + legal) — gate: passing verdict + ≥ 90 days + two-person +
`risk_signed_off=true` + `legal_signed_off=true`. Full-allocation eligibility. Still
risk/committee-gated on every trade.

**HALT / DE-RISK** (`trading.promotion.halt`) — any admin with the halt permission can drop a
strategy to a lower rung (with a reason) or straight to `HALTED` at any time. Automatic on a
circuit trip (record via Readiness `circuit_tripped=true`, which blocks all promotion).
`HALTED` re-enters only at `PAPER` — a halted strategy must re-prove the whole ladder.

Every transition writes an immutable `trading_promotion_events` row (maker, checker, sign-off
flags, reason). Members see a **sanitized** maturity view (`GET /trading/strategies` →
mobile "How your fund is managed") — stage + eligibility only, never governance internals.

---

## 6. Pre-live gate checklist (must ALL be true before any real capital)

- [ ] Venue adapter built, security-reviewed, and itself promoted through this ladder (§8).
- [ ] Venue keys are **trade-only, withdrawals disabled**, stored per `SECRETS_MANAGEMENT.md`,
      rotation tested.
- [ ] Live, validated, point-in-time market-data feed in place (no look-ahead; stale/anomaly
      data trips the Safety breaker → `DATA_STALE` / `PRICE_ANOMALY`).
- [ ] Strategy at `LIVE` on the ladder with recorded Risk **and** legal sign-off.
- [ ] Segregated client-funds account reconciled; operating funds physically separate.
- [ ] Kill-switch drill rehearsed (§9) with a measured time-to-halt.
- [ ] Monitoring + alerting live (§10) and paging a real on-call rotation.
- [ ] Incident runbook (§11) reviewed by Risk + Eng on-call.
- [ ] Position/loss limits (`serverPolicy()` in `promotion_handler.go`) reviewed by Risk and
      set to conservative go-live values — **server-side only; never client-supplied.**
- [ ] Go/No-Go sheet (§13) signed by Head of Trading, Risk Officer, and Legal.

If any box is unchecked, the answer is **no-go**.

---

## 7. Legal & compliance sign-off (external gate)

Reaching `LIVE` on the ladder **records** a legal-sign-off flag, but the flag is an
attestation, not the work. Before it is set, Legal/Compliance must independently confirm:
the licensing/registration required to manage third-party funds in-jurisdiction; client
disclosures and risk warnings (no guaranteed returns); the segregation-of-funds arrangement;
data-retention and audit obligations; and the AML/KYC posture of the Module-KYC gate. This is
outside engineering and blocks go-live regardless of technical readiness.

---

## 8. Venue adapter — contract (built) + real implementation (still to build)

The one component that turns "Live eligibility" into execution. The **contract** now
exists in code and is tested — `internal/trading/venue` — but there is **no real venue
implementation**, so nothing can transmit. Full spec: `AI_TRADING_VENUE_ADAPTER_SPEC.md`.

**What exists (`internal/trading/venue`, 12 tests):**
- `Adapter` interface — `Name/Enabled/WithdrawalsDisabled/Killed/Kill/Submit/Cancel/Reconcile`.
- `Guard` — the pre-trade re-check run at the edge.
- `Transmit` — the **one** safe entry point. Fail-closed checks IN ORDER: order well-formed →
  `Enabled()` → `!Killed()` → `WithdrawalsDisabled()` → `Guard.PreTradeApprove` → `Submit`.
  Any failure returns a rejected `Fill` and transmits nothing. Trading code must never call
  `Adapter.Submit` directly — always go through `Transmit`.
- `NoopAdapter` — the ONLY adapter that ships: permanently disabled, rejects every order, so
  "executes nothing" is structural.

**What must still be built** — a real adapter, as a **new, separately-reviewed,
ladder-promoted** module satisfying the interface above. Non-negotiable properties (enforced
by `Transmit`, verified in the adapter's own review):
- **Trade-only credentials.** `WithdrawalsDisabled()` must verify the key's scopes at the
  venue, not merely report that the code never calls withdraw.
- **Idempotent `Submit`** on `ClientOrderID`; a retry never double-submits. Reconcile fills
  against the ledger via `Reconcile`.
- **Never sizes or decides** — receives an already-sized, already-approved `Order` from
  `pipeline.Evaluate` → `committee.Decide`; no access to raise a size or bypass a veto.
- **Pre-trade `Guard`** wired to live `risk.Screen` / `committee.Decide` against fresh state.
- **Per-venue kill switch** (`Kill()`/`Killed()`), independent of the ladder and flags.
- **Full audit; no secret in logs.**
- **Its own feature flag**, default OFF, and it must itself climb this ladder (paper → shadow
  → canary → live) before full allocation.

Until a real adapter exists, is reviewed, and is promoted, `NoopAdapter` remains the only one
wired, `executed:false` is the only correct response from `/trading/evaluate`, and no go-live
is possible.

---

## 9. Kill switches & halt procedures

From fastest/narrowest to broadest:

1. **Per-strategy halt** — `POST /admin/trading/promotions/{id}/halt` (or the console "Halt"
   button), `trading.promotion.halt`. Drops the strategy to `HALTED`; it can no longer be
   evaluated. Reason mandatory, audited.
2. **Circuit breaker (automatic)** — stale data, price anomaly, abnormal loss rate/slippage,
   or vol spike trips `quant/risk` breakers, which force the risk `Screen` to veto and (once
   §8 exists) abort transmission. Record `circuit_tripped=true` via Readiness to freeze all
   promotion.
3. **Venue kill switch** (future, §8) — stops all transmission to a venue while leaving the
   rest of the platform up.
4. **Flag off** — `FEATURE_AI_TRADING_ENABLED=false` (decision surface dark) or
   `FEATURE_TRADING_ENABLED=false` (whole module dark). Redeploy. Nuclear option; use for a
   platform-wide incident.

**Target time-to-halt:** rehearse until a single strategy can be halted in < 60s and the
whole module flagged off in < 5 min.

---

## 10. Monitoring & observability

Watch continuously once `FEATURE_TRADING_ENABLED` is on:

- **Ledger invariants** — double-entry balanced; wallet balance == ledger projection; no
  negative units; NAV continuity. Alert on any drift (this is the money-safety tripwire).
- **Promotion events** — every `trading_promotion_events` insert; alert on any `→ live`, any
  `halt`, and any promotion where maker/checker look automated.
- **KYC bypass register** — every bypass; alert on volume spikes.
- **Circuit trips & vetoes** — rate of hard vetoes / circuit trips per strategy.
- **Decision pipeline** — `/trading/evaluate` outcomes distribution (approved vs. blocked and
  why); a sudden shift is a signal.
- **Fees** — HWM performance-fee accruals reconcile to the ledger.

---

## 11. Incident response (abridged)

1. **Detect** — an alert fires (ledger drift, unexpected `→ live`, circuit storm, venue error).
2. **Contain** — halt the affected strategy (§9.1); if platform-wide, flag off (§9.4).
3. **Preserve** — do **not** delete or edit ledger entries or audit events; corrections are
   *reversing entries only*. Snapshot `trading_promotion_events` and relevant ledger refs.
4. **Diagnose** — with Risk + Eng on-call; use the audit trail and the pipeline's recorded
   reasoning (`Result.Evals`, committee `Deliberation`).
5. **Recover** — a halted strategy re-enters at `PAPER` and re-proves the ladder. Never
   re-promote around a gate.
6. **Post-mortem** — blameless; update this runbook and the server-side limits/thresholds if
   warranted.

---

## 12. Rollback

- **Route rollback:** set the relevant feature flag `false` + redeploy. Instant, lossless.
- **Strategy rollback:** halt or de-risk via the ladder (audited).
- **Data:** migrations are additive-only; there is nothing to "roll back" schema-wise. Never
  drop or mutate ledger/audit tables.

---

## 13. Go / No-Go sign-off sheet

| Gate | Owner | Signed | Date |
|---|---|---|---|
| Technical pre-live checklist (§6) complete | Eng on-call | ☐ | |
| Venue adapter built + security-reviewed + ladder-promoted (§8) | Eng + Security | ☐ | |
| Risk limits reviewed & set conservatively (`serverPolicy`) | Risk Officer | ☐ | |
| Strategy at LIVE with Risk sign-off | Risk Officer | ☐ | |
| Legal / compliance sign-off (§7) | Legal | ☐ | |
| Kill-switch drill passed (< 60s / < 5 min) | Eng + Risk | ☐ | |
| Final Go decision | Head of Trading | ☐ | |

**No box unchecked. Any single "no" is a no-go.**

---

## Appendix — reference

**Endpoints** (member `/api/v1/trading`, admin `/api/v1/admin/trading`):
- Member: `GET /kyc/status`, `POST /kyc/submit`, `GET /wallet`, `POST /wallet/subscribe`,
  `POST /wallet/redeem`, `POST /evaluate` *(flag2)*, `GET /strategies` *(flag2)*.
- Admin KYC: `GET /kyc/queue`, `GET /kyc/:id`, `POST /kyc/:id/{review,approve,reject,bypass}`,
  `GET /kyc/bypass-register`.
- Admin ladder *(flag2)*: `GET /promotions`, `GET /promotions/:id`,
  `POST /promotions/:id/{register,readiness,promote,demote,halt}`.

**RBAC slugs:** `trading.kyc.review`, `trading.kyc.bypass`, `trading.kyc.bypass.approve`,
`trading.audit.read`, `trading.promotion.{read,propose,approve,halt,risk}`.

**Migrations:** `20261029000000` ledger accounts · `…000100` wallet · `…000200` KYC ·
`…000300` promotions. All additive-only.

**Env:** `FEATURE_TRADING_ENABLED`, `FEATURE_AI_TRADING_ENABLED`, `TRADING_FEE_BPS`,
`TRADING_HURDLE_BPS`. (Venue-execution env introduced with §8.)

**Key tests to keep green:** `quant/committee` (veto absolute, malformed abstains),
`quant/risk` (veto/circuit), `quant/reasoner` (compromised LLM can't force a trade),
`ladder` (gate matrix), `promotion` live-DB (maker≠checker, Risk+legal for Live), `venue`
(fail-closed Transmit envelope, no-op never trades), and the finance ledger invariant suites.
