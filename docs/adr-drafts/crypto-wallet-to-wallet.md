# ADR-PR<pr-number>: Crypto wallet-to-wallet transfer between Paymax users

> DRAFT. Move to `docs/adr/ADR-PR<real PR number>-crypto-wallet-to-wallet.md` once the spec PR
> exists, and replace every `<pr-number>` below with it. Never pick a number by hand
> (`adr-guard.yml`). Do not create the file with the literal placeholder in its name: it cannot be
> checked out on Windows.

Status: proposed (flag-off; spec + failing tests only, no implementation)

## Context
Wallet-to-wallet transfers exist for NGN only (`POST /transfers/paymax`). The send screen now
presents Wallet 2 Wallet as NGN or crypto, but the app has no crypto transfer between users: the
crypto API offers on-chain withdrawals to allow-listed addresses and provider-backed swaps only.
Holdings are already per-user, per-asset projections in integer asset minor units
(`MinorUnitScale`, e.g. 1e8), so an internal move needs no provider call and no chain transaction.

## Decision
- New route `POST /transfers/paymax/crypto` (`initiateCryptoWalletToWalletTransfer`), specified in
  `contracts/openapi.yaml` before any implementation.
- **Internal transfer only.** Debit the sender's holding and credit the recipient's in one DB
  transaction. No provider call, no on-chain movement, no withdrawal allow-list involvement.
- **Amounts:** request `units` is a decimal STRING in whole-asset units. The server converts to
  integer asset minor units with exact decimal parsing; exponent forms, negatives, zero, and
  precision finer than the asset scale are refused (422). No float math anywhere.
- **Money-mutation rules (iron rules):** required `Idempotency-Key` scoped to the caller (same key +
  same body replays, same key + different body is 409); balanced ledger pair; immutable rows
  (reversal = new pair); audit event; tier limits fail-closed on the NGN mark taken at execution time
  and stored as `ngn_value_kobo`.
- **PIN:** required in the body. Missing PIN is 400 and never verified (does not count toward
  lockout); wrong PIN is 403 and counts. Same semantics as swap confirm.
- **AML:** screen sender, recipient and amount before any debit; a refusal moves nothing.
- **Recipient resolution:** same rules as the NGN route, including 409 `ambiguous_recipient`.
  Self transfer is 422 `self_transfer`.
- **Gating:** `FEATURE_CRYPTO_ENABLED` and new `FEATURE_CRYPTO_WALLET_TRANSFERS_ENABLED`, both
  default off; either off is 503. Member route, needs `crypto.trade`.
- **Fee:** `fee_units` is "0" until a fee schedule is approved.

## Open questions (need an owner decision before implementation)
1. **AML refusal behaviour:** hard 403 (as specced) or hold for review.
2. **Fee:** zero at launch, or a schedule.
3. **Tier-limit basis:** NGN mark at execution (as specced) vs a separate crypto limit.
4. **Receiver notification** and whether a recipient can decline or must have crypto enabled.

## Ledger shape (decided: balanced asset-unit ledger pair) and what the trade path really does
Owner decision: keep a balanced asset-unit ledger pair. Checked against the internal crypto trade
path (`service.go`, `service_ext.go`, `repository.go` `RecordFill`), which does NOT post an
asset-unit ledger today:
- **Cash leg** is a balanced journal on the finance (NGN, kobo) ledger via `ledger.Service`.
  Crypto amounts never enter it (`ADR-PR709`).
- **Asset leg** is one `crypto_orders` row (idempotency-keyed) plus an in-place
  `UPDATE crypto_holdings SET units = units + delta` guarded by `CHECK (units >= 0)`. The code and the
  `crypto_holdings` DDL comment call this the "asset-unit side of the same balanced movement", but it
  is a mutable projection with no immutable entries and no debit/credit pairing.
- The reconciler's `ledger_units` is `SUM(crypto_holdings.units)` plus units parked in non-terminal
  withdrawals. No `crypto_ledger_entries` table exists in any migration.

So the specced pair is a **new structure, not an existing pattern**. Consequences:
- Add an additive migration for an immutable `crypto_ledger_entries` table (asset minor units, a
  DEBIT and CREDIT row per transfer sharing a `transfer_id`, no UPDATE/DELETE, enforced by trigger),
  and `crypto_wallet_transfers` (idempotency key unique, scoped to the sender).
- The transfer writes the pair and moves both `crypto_holdings` rows in ONE transaction; the pair is
  the record and the holdings are its projection, so this route meets the "never mutate a balance
  without entries" rule even though the trade path still does not.
- Reconciler is unaffected: a transfer leaves `SUM(units)` per asset unchanged. A new invariant
  check should assert `SUM(holdings)` equals the net of `crypto_ledger_entries` for transfer rows.
- Trade fills still update holdings without entries. Backfilling them into the new table is out of
  scope; track it as follow-up so the asset ledger eventually covers every holding movement.

## Consequences
- Users can move crypto between Paymax accounts instantly and free, without custody-provider cost.
- Custody reconciliation is unaffected (internal moves leave per-asset totals unchanged); the
  reconciler's `ok / drift` comparison must keep holding after a transfer.
- Adds a second money-path route to the crypto module; it must go through `ledger-auditor` review
  before the task is marked complete, and `security-reviewer` since it touches PIN handling.

## Alternatives rejected
- **Route through the provider (Quidax sub-account transfer):** adds latency, fees and a failure mode
  for something that is purely a projection move.
- **Reuse the withdrawal route:** it is on-chain, allow-listed and fee-bearing; wrong tool.
- **Extend `/transfers/paymax` with a `currency` field:** couples NGN kobo and decimal-string units in
  one schema and risks a client sending the wrong unit type. A separate route keeps units unambiguous.
