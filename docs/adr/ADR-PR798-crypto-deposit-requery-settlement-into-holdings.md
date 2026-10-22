# ADR-PR798: Crypto deposits settle from a provider re-query into the existing holdings plane, confirmation-gated and once-only

Status: accepted (behind `FEATURE_CRYPTO_SWAPS_ENABLED`; money-IN path)

## Context
The crypto module had a complete money-OUT and convert surface (buy/sell/swap/withdrawal) but no
money-IN path: an on-chain transfer into a custodial sub-account never became a customer balance.
The UAT treats deposit settlement as a P0 money invariant (E2E-05). Three constraints shaped the
design:

- The authoritative crypto-unit balance already lives in `crypto_holdings(user_id, asset_id, units)`
  (CHECK `units >= 0`, `UNIQUE(user_id, asset_id)`). The portfolio, reconciliation (`ReconRow`) and
  the trading fills all read/write it, so it is the single source of truth for units.
- The shared fiat `finance/ledger` cannot hold crypto units: `ledger_accounts` enforces
  `char_length(currency) = 3` (USDT/USDC are 4) and `ledger_entries.amount_kobo` has no per-asset
  minor-unit scale.
- A deposit webhook, like a swap webhook (ADR-PR708), is attacker-influenced until its HMAC signature
  verifies, and even then reports provider state the provider may revise. Quidax's deposit contract
  (event name, whether the object exposes a per-transfer `confirmations` count, status vocabulary) is
  unverified against the TEST sandbox.

## Decision
1. **Reuse the existing `crypto_holdings` projection; add only an append-only journal.** A settled
   credit writes one `crypto_deposits` row (`UNIQUE(provider_op_id)`) and upserts `crypto_holdings`
   in a single transaction — the same id-on-conflict-then-move-holding shape as
   `crypto.Repository.RecordFill` (ADR-PR709/710 lineage). We do **not** create a second balance table
   (that forks the source of truth and split-brains the portfolio) and do **not** DDL the fiat ledger.
   This realises the approved Option A.
2. **Settle only from a provider re-query, never the payload.** The webhook event only *names* a
   deposit (`Event.Ref` = deposit id, `Event.Account` = sub-account). `cryptosvc.Ingest` calls the new
   `cryptoprov.DepositProvider.GetDeposit` and settles from that result: amount, confirmation count,
   status and address all come from the provider read scoped to the sub-account. Routing on the event
   type (`deposit.*` / `transaction.*`) only picks the path; a mis-route costs one read, never a wrong
   credit.
3. **Recipient is resolved server-side, never trusted from the event.** `DBResolver` maps the provider
   sub-account → owner via `crypto_accounts`, and the symbol → an active `crypto_assets` row. Unknown
   sub-account or asset → `Unmapped`, credits nobody. A genuine dependency error returns an error (5xx,
   dedupe row released, provider retries) — it is never silently treated as a rejection.
4. **Confirmation floor is a platform risk decision, not a provider truth.** The transfer must be both
   provider-`confirmed` AND reach `CRYPTO_DEPOSIT_CONFIRMATIONS` (validated 1..144) before crediting.
   Below it → `Awaiting` (credits nothing). The default is provisional pending the risk owner + sandbox.
5. **Amounts convert through the asset's minor-unit scale and fail closed.** The provider reports whole
   units as a decimal; `toMinorUnits` multiplies by the resolved scale and refuses a non-positive
   amount, a scale ≤ 0, sub-minor precision (dust), or an int64 overflow — never rounds, never mints a
   fraction.
6. **Once-only, reusing the swap webhook's dedupe + release-on-failure.** `crypto_deposits.provider_op_id`
   is the idempotency anchor; the `cryptosvc` dedupe row is released if the re-query or settle fails so a
   redelivery re-runs it. A second delivery of the same `provider_op_id` is `Duplicate` with no movement.
7. **Layering: the deposit engine stays provider-only; the webhook layer stays engine-free.** `cryptoprov`
   gains the `Deposit`/`DepositProvider` types; `internal/crypto/deposit` imports `cryptoprov` and owns the
   conversion + invariants; `cryptosvc` defines a narrow `DepositSettler` seam; the `app` package bridges
   them (`cryptoDepositBridge`) and constructs the engine over the live pool. Deposit routing is opt-in
   (`WithDepositSettler`): unwired, deposit events are recorded and `Ignored`, so the swap path and all
   existing tests are untouched.

## Not decided here
- **Deposit reconciler** — `ListDeposits` exists on the capability but nothing polls it yet; a missed or
  delivered-under-confirmed webhook currently waits for a later provider event (the swap path has a
  reconciler, deposits do not). Tracked in GAP-DEP-01 slice 2 carry-over.
- **Admin exception queue + mobile pending→credited + receipt** and guaranteed per-customer deposit
  address ownership (GAP-DEP-01 slice 3).
- **Reorg detection** — Quidax exposes no per-transfer reorg signal; `DepositReorged` is modelled and the
  engine rejects it, but the adapter never produces it. Reorg safety depends on the confirmation floor.

## Consequences
The money-IN vertical slice is built, wired to the live `/api/v1/webhooks/crypto/:provider` endpoint, and
proven against the mock provider and the isolated local DB (once-only under a 16-way same-op-id race,
confirmation gating, cross-tenant isolation, scale conversion, dedupe-release-on-failure). It is **not**
release-ready: the live Quidax webhook contract, the deposit reconciler, and the customer-facing surface
remain — E2E-05 is Partial/Blocked, not Pass.
