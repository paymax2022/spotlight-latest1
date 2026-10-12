# ADR-PR730: Zero-fee crypto buy completion marker — make completion detectable at the ledger independent of fee

- **Status:** Accepted
- **Date:** 2026-10-12
- **Module:** crypto / cryptosvc (settlement primitive, `backend/internal/cryptosvc/settle.go`)
- **Flag:** none — pure defense-in-depth hardening of an existing primitive; flag-off-safe
- **Follow-up to:** ADR-PR710 (buy pipeline: hold before provider), surfaced by the ledger-auditor review of PR #728

## Context

`Settler` posts the NGN legs of crypto BUY swaps to the finance ledger:

- **HoldBuy** — wallet → clearing (principal + platform fee), under the wallet lock.
- **CompleteBuy** (provider confirmed) — recognises the fee clearing → revenue; the
  principal stays parked in clearing (clearing mirrors NGN held at the provider).
- **FailBuy** (provider failed) — reverses the whole hold clearing → wallet (refund).

`completeBuy` returns early with no ledger write when `FeeKobo == 0`
(`if in.FeeKobo == 0 { return nil }`). A zero-fee completion therefore leaves the
ledger in the **exact** state of a still-held, unsettled buy: `:hold` present, no
`:release`, no `:fee`. `failBuy` only refused an already-settled swap when
`in.FeeKobo > 0`. So a **completed zero-fee buy was indistinguishable from a live
hold**, and `FailBuy` would `PostReversal` — refunding NGN for crypto already
delivered (a double spend).

`FeeKobo == 0` is reachable: `fee = floor(ngn_kobo * bps / 10000)` floors to 0 on
small amounts, and a 0-bps fee override is permitted.

Not exploitable via the PR #728 admin resolve path today (a completed swap has a
provider id → `ErrReleaseUnsafe`, and is terminal → `ErrNotParked`). This ADR hardens
the **settlement primitive itself**, which otherwise relies entirely on its callers'
state guards.

## Forcing functions

Two constraints pin the design; neither candidate in the review brief survives them
unmodified:

1. **The completion fact must be written inside the swap lock.** `CompleteBuy` and
   `FailBuy` run inside a per-swap `SwapLocker`, but callers flip swap *state* **after**
   the settler returns, i.e. **outside** the lock (ledger-first, state-last). A racing
   resolver can observe stale swap state. Reading swap state (or the passed-in
   `SwapLedgerInput`) to detect completion is therefore race-unsafe. The only shared
   state mutated inside the lock is the ledger, so the completion signal must be a
   **ledger write made by `completeBuy`**.
2. **A zero-fee completion moves no money.** The finance ledger rejects any
   non-positive amount on every posting path and has exactly four balanced entry types
   (a DB enum); there is no zero-amount or marker entry, and adding one is a schema
   migration with balance-projection fallout. A net-zero economic effect across a
   single balanced journal is only possible when the debit and credit land on the
   **same** account.

## Decision

- **`completeBuy` posts a net-zero completion marker** for the zero-fee case
  (`:complete`, key `crypto:swap:<id>:complete`): a single journal that debits **and**
  credits the clearing account for a positive nominal amount (the parked hold total).
  It moves no money on any account — the principal stays parked exactly as for a
  fee-bearing completion — yet carries the positive amount the ledger requires and a
  deterministic key a racing `FailBuy` reads under the swap lock. It is explicitly
  **not** an economic entry (its `Description` says so).
- **`failBuy` refuses whenever completion is posted** — a recognised fee leg
  (`:fee:credit`) **or** the marker (`:complete:debit`) — read from the ledger, not
  from `in.FeeKobo`. This also closes the sibling gap where a wrong or floored
  `FeeKobo == 0` would have skipped the fee-leg check.

The fee>0 path's journals and balances are **byte-for-byte unchanged**: the marker is
posted only in the zero-fee branch. Both methods remain idempotent — the marker replays
through the same identity-verified `post()` path as every other leg (`ErrDuplicate`
then compare).

## Consequences

- **Positive:** the primitive is now self-protecting against a zero-fee double-refund,
  sequentially and under the race, without depending on caller state guards. Value is
  conserved (the marker is net-zero). The common fee-bearing path is untouched.
- **Negative / accepted:** a zero-fee completed buy carries two extra `ledger_entries`
  rows (a debit and a credit on the same clearing account) that are bookkeeping markers,
  not money movements. This is a deliberate, documented exception to the usual
  "distinct debit/credit accounts" shape, forced by the two constraints above; the
  `Description` and key namespace make it self-identifying to auditors and
  reconciliation. Zero-fee buys are rare (small amounts / 0-bps overrides), so the row
  volume is negligible.

## Alternatives rejected

- **Read swap state in `failBuy`** — race-unsafe (state flips outside the lock) and
  would couple the ledger-only settler to the swap store.
- **Zero-amount / new "marker" entry type** — rejected by the ledger (positive-amount
  invariant, fixed enum); would require a DB migration and balance-projection changes.
- **Move the principal clearing → a "settled" account on completion** — would change the
  fee>0 path's balances (principal must stay parked) and the clearing-mirrors-provider
  model.
- **A journal + its reversal across two accounts** — nets to zero only after two posts,
  with phantom intermediate balances and more idempotency keys; strictly worse than one
  same-account marker.
