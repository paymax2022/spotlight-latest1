# AI Trading — Venue Adapter Interface Spec (§8)

The venue adapter is the **only** component that turns "Live eligibility" (§12 ladder)
into a real order. It does not exist in this codebase yet, by design. This spec is the
contract a real adapter must satisfy, and it is **enforced in code** by
`backend/internal/trading/venue` — the interface, a fail-closed `Transmit` envelope,
and a reject-all `NoopAdapter` (the only adapter that ships, so nothing here can trade).

> Build the real adapter as a **separate, security-reviewed module**. It must itself
> climb the §12 promotion ladder (paper → shadow → canary → live) before full
> allocation, exactly like a strategy.

---

## 1. Position in the flow

```
regime → signals → risk.Screen (size + veto) → committee.Decide (consensus + veto)
                                                        │  approved, SIZED order
                                                        ▼
                                          venue.Transmit(adapter, guard, order)
                                          └─ fail-closed envelope ─┐
                                                                   ▼
                                                         Adapter.Submit → venue
```

The adapter is downstream of every deterministic gate. It **receives** an already-sized,
already-approved order and only transmits it. It has no capacity to size, to decide, or
to bypass a veto.

---

## 2. Hard rules (non-negotiable)

1. **Never sizes or decides.** `Order.NotionalKobo` is the risk-approved size; the adapter
   may not raise it, split it into more risk, or originate an order.
2. **Trade-only credentials.** Keys must have withdrawals/transfers **disabled at the
   venue**. `WithdrawalsDisabled()` must *verify the key's scopes*, not merely report that
   the code never calls withdraw. `Transmit` refuses to trade if it returns false.
3. **Idempotent.** `Submit` is idempotent on `ClientOrderID`: a retry returns the prior
   result and never double-submits. The caller generates a unique id per intended order.
4. **Pre-trade re-check at the edge.** `Transmit` calls a `Guard` (wired to
   `risk.Screen` / `committee.Decide` against **fresh** state) immediately before submit;
   any error aborts — the order is never transmitted.
5. **Per-venue kill switch.** `Kill()` engages; `Killed()` reports; `Transmit` refuses once
   engaged. Independent of the ladder and of the feature flags.
6. **No secret in logs.** Credentials live only in the outbound request, never in returned
   values, error strings, or telemetry (mirror `integrations/llm` discipline).
7. **Reconcile against the ledger.** Fills are the source of truth for what actually
   executed; `Reconcile` feeds the reconciliation that keeps wallet balances == ledger
   projections.

---

## 3. The interface (`internal/trading/venue`)

```go
type Adapter interface {
    Name() string
    Enabled() bool               // default OFF
    WithdrawalsDisabled() bool   // attests key scopes cannot withdraw
    Killed() bool
    Kill()
    Submit(ctx, Order) (Fill, error)     // idempotent on ClientOrderID
    Cancel(ctx, clientOrderID) error
    Reconcile(ctx) ([]Fill, error)
}

type Guard interface { PreTradeApprove(ctx, Order) error } // risk veto re-check
```

**`Order`** — `ClientOrderID`, `Strategy`, `Asset`, `Side` (`long`/`short`),
`NotionalKobo` (risk-approved), `StopDistanceBps`. Every field is produced upstream; the
adapter computes none of them.

**`Fill`** — `ClientOrderID`, `VenueOrderID`, `Status`
(`accepted`/`partially_filled`/`filled`/`rejected`/`canceled`), `FilledNotionalKobo`,
`AvgPriceKobo`, `FeeKobo`.

---

## 4. The safety envelope — `venue.Transmit`

Trading code calls **only** `Transmit`, never `Adapter.Submit` directly. `Transmit`
applies the fail-closed checks **in order**, then delegates:

1. order well-formed (id + asset + positive size + valid side) → else `ErrBadOrder`
2. `Enabled()` → else `ErrNotEnabled`
3. `!Killed()` → else `ErrKilled`
4. `WithdrawalsDisabled()` → else `ErrWithdrawalsPossible`
5. `Guard.PreTradeApprove` → else `ErrPreTradeVetoed`

Any failure returns a **rejected** `Fill` and the reason; **nothing is transmitted**. This
is enforced by tests: `TestTransmit_FailClosed` (every path), `TestTransmit_Idempotent`,
`TestTransmit_KillSwitch`, `TestTransmit_WithdrawalsGateIsHard`, and `TestNoop_NeverTrades`
(the shipped adapter refuses).

---

## 5. Order lifecycle

1. Pipeline produces an approved, sized order → caller mints a unique `ClientOrderID`.
2. `Transmit(adapter, guard, order)` runs the envelope; the guard re-checks fresh risk.
3. `Submit` transmits; venue returns accepted/partial/filled/rejected.
4. Fills post to the ledger (double-entry, idempotent) and reconcile via `Reconcile`.
5. On a stop/risk event: `Cancel` the working order; a circuit trip forces halt upstream.
6. On any incident: `Kill()` the venue; escalate per the runbook (§9/§11).

---

## 6. What the implementer must still decide (venue-specific)

Out of scope for this contract; document in the adapter's own module:

- Transport (REST/FIX/WebSocket), auth signing, rate limits, clock sync.
- Order types the venue supports and how a `NotionalKobo` maps to venue units/lots.
- Partial-fill and time-in-force handling; how `AvgPriceKobo`/`FeeKobo` are derived.
- Market-data feed (validated, point-in-time; stale/anomaly → Safety breaker upstream).
- Reconciliation cadence and the drift alert that pages on-call.
- Credential storage + rotation per `SECRETS_MANAGEMENT.md`; the scope check backing
  `WithdrawalsDisabled()`.

---

## 7. Promotion of the adapter itself

The adapter is treated as a strategy on the §12 ladder:

- **Paper/Shadow** — run `Transmit` against a venue **sandbox / testnet** (or a dry-run
  mode), reconciling simulated fills. No production capital.
- **Canary** — real venue, tiny capped allocation, tight limits, heightened monitoring.
- **Live** — full allocation, only after Risk + legal sign-off and a passed kill-switch
  drill (runbook §6/§13).

A new venue-execution feature flag (default OFF) gates transmission and is only turned on
per-venue once its adapter is at canary/live.

---

## 8. Acceptance criteria (before the adapter may carry real capital)

- [ ] Implements `venue.Adapter`; driven exclusively through `venue.Transmit`.
- [ ] `WithdrawalsDisabled()` verifies key scopes at the venue (proven in review).
- [ ] Idempotency proven under retry/duplicate/concurrent submit.
- [ ] Pre-trade `Guard` wired to live `risk.Screen` / `committee.Decide`.
- [ ] Kill switch drilled; time-to-halt measured (< 60s).
- [ ] Fills reconcile to the ledger with a drift alert.
- [ ] No secret in logs/telemetry (verified).
- [ ] Security review passed; adapter promoted through the ladder to at least canary.
- [ ] Go/No-Go sheet (runbook §13) signed.

Until every box is checked, the adapter stays disabled and `NoopAdapter` remains the only
one wired — so the platform continues to execute nothing.
