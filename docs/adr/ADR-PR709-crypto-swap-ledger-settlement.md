# ADR-PR709: Crypto swap ledger settlement through a crypto_clearing account

Status: accepted (flag-off; no caller for the buy hold yet)

## Context
Crypto swaps execute at the provider (Quidax) against a per-user custodial sub-account, while the
user's NGN lives in the finance ledger. The ledger has no hold/lien primitive (owner decision 3:
use a clearing account, do not add one). NGN stays integer kobo; crypto amounts never enter the
ledger.

## Decision
- A new standing account `crypto_clearing` mirrors NGN held at the provider on users' behalf
  (`ledger_accounts_type_check` widened, additive). Treasury moves the real NGN; the ledger records
  the obligation.
- **Buy** (confirm): debit wallet principal+fee, credit clearing — tier-gated and balance-checked
  under the wallet lock (`PostJournalGated`). **Completed:** fee clearing -> `paymax_revenue`.
  **Failed:** `PostReversal` of the whole hold. A failure with no hold is a no-op; a release after the
  fee was recognised, or a completion after a release, is refused (`ErrSettlementConflict`).
- **Sell** (completed): clearing -> wallet for `received - fee`, clearing -> revenue for the fee, where
  `received` is the NGN from the provider re-query (never the webhook payload). A fractional-kobo
  amount is refused, not rounded.
- **Fees:** per side, `floor(kobo * bps / 10000)`; bps resolved from a config schedule at quote time and
  stored on the swap (owner pricing: majors 0.75%, other liquid 1.00%, higher-volatility up to 1.50%
  ceiling). Order-book fees (0.15-0.25%) are out of scope here.
- **Keys:** `crypto:swap:<id>:{hold,fee,release,payout}`. Replays are identity-verified: the cache layer
  returns `ErrDuplicate` for any claimed key, so it is resolved by comparing the recorded legs to the
  intended journal. A mismatch is `ErrReplayMismatch`, never success.
- **Ordering:** the ingest runs the settler before the swap state transition; both are idempotent, so a
  crash between them converges on the provider's retry. An unknown swap `side` fails closed.

## Consequences
- Clearing is negative after sells until treasury settles with the provider. That is visible by design;
  an alert threshold and a three-way reconciliation report are the next slice's job.
- The settler is not wired to any route: `HoldBuy` has no caller until the buy pipeline exists.
- The owner's alternative funding path (user pays a Quidax virtual account directly, ledger records only
  the fee) is not built and needs a deposit-webhook slice first.
