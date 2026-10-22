# Crypto Trading (Quidax) — Gap Backlog

Prioritised gaps found against the 648-case / 34-workstream / 40-journey scope. Status uses the
UAT vocabulary; nothing that has not genuinely run is marked Pass. The module's **trading/swap
money path is built and fully green** (see `run-log.md`: 281 tests, incl. live-DB money
invariants). The gaps below are ordered by blast radius.

## P0 — money-critical, credential-free buildable (start here)

### GAP-DEP-01 — Inbound crypto-deposit settlement (workstream DEP; E2E-05, 10, 27, 29)
**State:** Slice 1 + 2 + 2b built + verified; Slice 3 read surfaces delivered, exception-queue
persistence + address ownership still blocked (Option A approved 2026-10-21). **Owner:** Backend / Ledger.

**Progress — Slice 1 DONE (`internal/crypto/deposit`):** the money-IN settlement core —
`Settler` (finality gate, once-only, owner-resolved-from-`crypto_accounts`, positivity) +
`PGStore` (additive `crypto_deposits` journal, `UNIQUE(provider_op_id)`, atomically upserts
the existing `crypto_holdings` projection — no second balance plane, no `finance/ledger` DDL)
+ `DBResolver` + `ConfirmationPolicy`. Migration `20271086000000_crypto_deposits.sql`. 13 tests
green (8 domain, 5 live-DB) incl. a 16-way concurrent same-op-id race → exactly one credit.

**Progress — Slice 2 DONE (webhook → settle, money-IN reaches the engine):**
- `cryptoprov` gains a `DepositProvider` capability (`GetDeposit` re-query + `ListDeposits`),
  a `Deposit`/`DepositStatus` model (amount in WHOLE units — minor-unit conversion is ours,
  using the resolved asset scale), and `Event.Account` to locate the re-query. `Mock` and the
  Quidax adapter both implement it; the adapter stamps the re-query's sub-account onto the
  result so ownership resolves.
- `cryptosvc.Ingest` routes `deposit.*` / `transaction.*` events (behind an injected
  `DepositSettler` seam, so the webhook layer never imports the deposit engine) to a provider
  re-query then settle — value comes ONLY from `GetDeposit`, never the payload. Unknown types
  still return `OutcomeIgnored`; the swap routing and all existing swap tests are untouched.
- `app` bridges the seam to `deposit.Settler` over the live pool and a configurable
  confirmation floor (`CRYPTO_DEPOSIT_CONFIRMATIONS`, default 3, validated 1..144), mounted on
  the same `/api/v1/webhooks/crypto/:provider` endpoint under `FEATURE_CRYPTO_SWAPS_ENABLED`.
- `deposit.Settler.SettleDeposit` converts the decimal amount to integer minor units and runs
  the same four invariants (fails closed on sub-minor dust / non-positive / overflow).
- Tests added: 8 deposit domain (conversion/status/dust/unmapped/replay/error-propagation),
  6 `cryptosvc` routing (re-query-then-settle, payload-never-trusted, dedupe, unwired→ignore,
  error releases the dedupe row), 6 Quidax (re-query scope, conservative status map, account on
  event/list), 2 live-DB (`SettleDeposit` credits 0.005 BTC = 500000 units once + replay; dust/
  pending/orphan credit nobody). Full backend suite green (262 packages).

**Remaining to close the gap (Not Run until built):**
- **Slice 2b DELIVERED — deposit reconciler/fallback:** `cryptosvc/deposit_reconciler.go` now
  sweeps provider `ListDeposits` per `crypto_accounts` sub-account and re-submits every transfer
  into the SAME once-only, confirmation-gated `DepositSettler` the webhook uses, so a missed
  webhook is finally settled, an under-confirmed one settles once it reaches the floor, and an
  already-settled one is a structural no-op (`crypto_deposits.provider_op_id` UNIQUE). Single
  leader across replicas on its own advisory-lock key (`cryptodeposit:reconciler`), per-pass
  bounds (Batch 100/account, MaxAccounts 500, HandleTimeout 20s) with a Truncated flag, telemetry
  and an admin status view (`GET /admin/crypto/deposits/reconciler`). Started from `cryptosvc.Wire`
  only when `WireDeps.DepositSettler` is passed; the app now builds the bridge before `Wire` and
  shares it between webhook and sweep. Verified: 10 domain tests (mock provider, DB-free) +
  3 admin-view tests + 2 live-DB tests over the real schema (credits 0.005 BTC once + replay =
  0 movement; under-floor parks as awaiting then settles past the floor). E2E-05 is now settled
  against the mock + local Postgres — still **Partial against a live Quidax delivery** (below).
- **Slice 3 PARTIALLY DELIVERED — read surfaces only; exception-queue persistence stays blocked:**
  - **Admin credited-deposit history** — `crypto` package adds `AdminListDeposits`/`Deposits`/`Deposit`
    over `crypto_deposits` (JOIN `crypto_assets` for `minor_unit_scale`), routes admin
    `GET /admin/crypto/deposits` (PermAdmin) and member owner-scoped `GET /deposits` +
    `GET /deposits/:id` (PermView). Live-DB tests: owner sees only own rows (foreign id →
    `ErrNotFound`); admin exposes `user_id`; units 500000 / scale 1e8; confirmations surfaced.
  - **Admin Deposits console tab** (`app/admin/crypto/deposits/page.tsx`) — reconciler KPI strip +
    per-asset credited totals + symbol filter + table + paging, wired to the real endpoint
    (`USE_MOCK` defaults live). Vitest 6/6 green; tsc clean.
  - **Mobile pending→credited** — `app/crypto/deposit/pending.tsx` rewritten to poll
    `useDeposits(symbol)`, match by address, and flip from "watching" to a credited receipt
    (amount/confirmations/network/tx/credited-at) the moment a credit lands. RN `tsc` exit 0.
  - **NOT delivered — the true exception queue.** `crypto_deposits` has NO status/pending column:
    a row is written ONLY for a settled credit, so awaiting/unmapped/rejected transfers are not
    persisted anywhere (the webhook dedupe row is deleted on failure). The admin page and member
    receipt therefore show **credited money-IN history**, and the page's `DisclosureNote` states
    plainly that awaiting/unmapped are **not** listed here. A real review queue needs an additive
    migration + persistence (a money-state-adjacent design that has NOT been approved) — so this
    sub-part is deliberately left undone rather than faked. The reconciler + member poll close the
    "missed webhook" gap for settled funds; they do not make an unmapped/under-confirmed transfer
    reviewable in the DB.
  - **Still open in Slice 3:** address-generation ownership (guaranteeing a mapped sub-account /
    address per customer) is NOT built, and the awaiting/unmapped persistence above. Both remain
    the design gate below.
- **Live-contract blockers (standing):** the exact Quidax deposit event name (`deposit.*` vs
  `transaction.*`), whether the deposit object exposes a per-transfer `confirmations` count, and
  the status vocabulary are UNVERIFIED against the TEST sandbox; the confirmation floor is a
  provisional risk default pending the risk owner. The webhook→settle path, the reconciler sweep,
  and the admin/mobile surfaces are proven only against the mock + the local Postgres schema, NOT
  a live Quidax delivery. RN/mobile and admin surfaces were verified via `tsc` + vitest
  (mocked/live-DB), NOT a live browser/device run; the admin repo's ESLint is mid-migration
  (v10, no flat config) so no lint gate was runnable.


What is missing: nothing turns an on-chain inbound transfer into a customer balance credit.
- `cryptoprov` has no `ListDeposits` capability and the webhook `Event` model carries swap events
  only.
- `cryptosvc.Ingest.isSwapEvent` routes only `swap_transaction.*` / `trade.*`; a deposit event is
  ignored.
- No confirmation-count gate, no once-only credit, no deposit journal, no admin deposit queue, no
  mobile "deposit pending → credited" resolution.

**Required behaviour (acceptance invariants):**
1. Address/network + customer mapping: credit only the wallet whose mapped deposit address the
   transfer hit; unknown/mis-mapped → exception queue, never auto-credit.
2. Confirmation threshold: credit only at required confirms for that network (reorg-safe);
   pending → visible "awaiting confirmations".
3. Once-only: exactly one ledger credit per unique provider deposit operation id (idempotency +
   webhook dedupe), even under a duplicate/replayed webhook storm (E2E-10).
4. Double-entry: debit custody/crypto-clearing, credit the customer's crypto-unit holding; balance
   deltas reconcile to the custody on-chain total.
5. Unsigned/forged deposit event rejected (reuse HMAC verify); no funds appear.
6. Per-asset reconciliation vs `GET /deposits` provider list; exceptions surface in admin.

**Blocking design decision (must be approved before code):** customer crypto holdings currently
live in the legacy `crypto` plane (`crypto_holdings`, integer asset minor units), NOT as per-asset
crypto accounts in `finance/ledger`. So either (A) extend `finance/ledger` with per-asset crypto
unit accounts and post deposits there (clean, matches ADR-002 double-entry, larger change), or
(B) credit the legacy `crypto_holdings` table with its own idempotency + a reconciliation job vs
custody. Both are money-IN; neither should be guessed. This is why the code was not written
speculatively this session.

**Vertical-slice plan once the account model is chosen (TDD, mock provider, no live funds):**
failing invariants test → deposit `Event` + `ListDeposits` on `WalletProvider` + mock →
`DepositSettler` domain (confirmations + once-only + double-entry, in-mem store) → route
`isSwapEvent`→`routeEvent` for deposits in `Ingest` → pgx store + migration (additive) →
admin `GET /admin/crypto/deposits` + decision → mobile `deposit/[id]` pending→credited → live-DB
concurrency/duplicate tests → traceability update.

## P1 — functional completeness

### GAP-FILL-01 — Limit orders: partial fills & cancel-residual release (workstream ORD/FILL; E2E-02, 09)
The trading surface executes market buy/sell and the swap two-leg. Order-side partial-fill
accumulation and cancel-and-release-of-unfilled-reserve are not evidenced and are the two
highest-value missing order behaviours. Terminal-state FSM is solid; the residual-hold accounting
is the gap.

### GAP-MKT-01 — Orderbook endpoint (workstream MKT; E2E-23)
`GET /assets` and `GET /assets/:id/chart` exist; there is **no orderbook** route and the Quidax
ticker is not surfaced to the client. The orderbook UI has no authoritative source in live mode.

### GAP-RISK-01 — Sanctions screening / geofence / velocity (workstream RISK; E2E-13, 26)
KYC-tier and per-debit limits are enforced; the named risk patterns (sanctions flag hold, geofence,
velocity, impossible-travel, recipient policy) are not evidenced as crypto code paths.

### GAP-ADM-01 — Maker-checker on privileged actions (workstream ADM; E2E-15, 16)
Admin resolve/release safety (no-double-credit) and fee-schedule versioning are green. A
two-persona maker-checker pairing on irreversible payouts and an emergency market/withdrawal
kill-switch (E2E-16) are not evidenced.

### GAP-REP-01 — Customer statement & P&L export (workstream REP; E2E-20, 39)
Admin reconciliation view exists; signed customer statement and accounting-basis P&L export are
not built.

### GAP-DEP-02 — Provider-balance mismatch alerting (workstream REC/RISK; E2E-15)
Custody on-chain balance is ingested but not compared to the internal sum to alert + freeze risky
payouts.

### GAP-UIX-01 — Asset detail endpoint (low)
`GET /crypto/assets/:id` is absent; mobile `getAsset` filters the list client-side (works, but the
single-asset screen has no dedicated authoritative route). Small, safe, non-money fix.

## Blocked — needs external resources (cannot be truthfully run here; never faked)

| Gap | Why blocked | Needed to unblock |
| --- | --- | --- |
| Live Quidax sandbox contract (QDX/DEP/WDR/SUB) | No permitted test credentials in env; BR-18 | Approved TEST tenant creds + `CRYPTO_PROVIDER=quidax` |
| VAPT VAPI/VMOB/VINF (E2E-24,32) | BR-18 forbids unsanctioned scanning; no authorized staging/tools | Written scope + staging + ASVS/API-Top10/MASVS harness |
| PERF / RES chaos / DB failover / queue replay (E2E-17,18,31) | Owner must set numeric SLO/RTO/RPO; no fault-injection lab | Staging topology + owner-set SLOs + chaos tooling |
| REG golden-dataset / prior-build diff (E2E-19,29) | No golden prod-equivalent dataset / previous build | Fixture dataset + previous candidate build |
| PRV privacy/retention/legal (E2E-38) | Legal counsel gate | Counsel-reviewed privacy notice / DPA / retention |
| Conditional products RAMP/XFER/corporate/P&L (E2E-33..40) | Separate products, not enabled | Contract entitlement + explicit enable |
