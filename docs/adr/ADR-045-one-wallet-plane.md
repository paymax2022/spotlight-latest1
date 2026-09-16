# ADR-045 — One wallet plane: the Next.js wallet mutates `user_wallet`

- **Status:** Accepted
- **Date:** 2026-08-14
- **Related:** [ADR-040](ADR-040-wallet-plane-double-entry.md) (made the Next.js
  plane post balanced pairs into the shared ledger — this finishes the job by
  removing the second plane), [ADR-041](ADR-041-card-rail-tops-up-the-wallet.md)
  (the card rail whose money landed in the wrong pot)

## Context

A user had **two spendable ledger accounts**:

| Plane | Written by | Type |
|---|---|---|
| Next.js wallet | `frontend-web/src/server/wallet` | `ledger_accounts.type = 'wallet'` |
| Go finance ledger | `backend/internal/finance/ledger` | `ledger_accounts.type = 'user_wallet'` |

This was an accident of sequencing, not a design. The base migration restricted
`type` to `'wallet'`, so the Next.js wallet created that. The Go ledger creates
`'user_wallet'`, and `20260912000001` widened the CHECK to admit both **rather than
unifying them** — the pragmatic fix at the time, since without it a fresh
`db reset` failed on every account creation.

Nothing moved value between the planes. `getBalance` summed both, so the displayed
figure was right and the split stayed invisible — right up until money had to cross
it.

It crossed when ADR-041 rerouted the card rail through a wallet top-up. The top-up
credited `'wallet'`; the Go module escrow debited `'user_wallet'`. A ledger-auditor
review traced it: a card-paid checkout was **charged at the PSP, credited, and then
refused for insufficient funds** — and for a Tier-0 customer the residue was
unspendable and unwithdrawable.

The split had a second, quieter consequence. `enforceWalletLimit` projects a user's
daily spend from the account it resolves; it resolved `'wallet'` while the debit it
was gating could land on `'user_wallet'`. An empty projection returns a daily total
of **0**, so the tier limit silently never bound.

## Decision

**`user_wallet` is the single plane. The Next.js wallet mutates it.**

`user_wallet` wins rather than `'wallet'` because the Go ledger is the money-path
authority for every marketplace vertical (escrow, settlement, transfers, referral
rewards, crypto), and it upserts on `ON CONFLICT (user_id, type)` against
`ledger_accounts_user_type_key` — the same arbiter the Next.js resolver now uses, so
both processes converge on one row rather than racing to create two.

### One constant, because the bug was four string literals

`WALLET_ACCOUNT_TYPE` in `src/server/wallet/account-type.ts` is the only place the
type is named. Every resolver imports it:

- `wallet/service.ts` — `getOrCreateAccount`, the chokepoint for every credit and
  debit (`debit_wallet_atomic` takes an `account_id`, so it follows automatically).
- `tiers/service.ts` — the daily-spend projection. **Not cosmetic:** pointed at the
  wrong plane it under-reports to zero and the limit stops binding.
- `transfers/bank-webhook.ts` — the failed-transfer refund, which must land in the
  account the debit came from.

A test asserts the constant equals the Go `AccountUserWallet`, and scans those three
files for a re-typed literal. The defect was not a wrong decision; it was the same
string typed in several places and then drifting.

### Reads still see both planes

`getBalance` continues to sum `'wallet'` and `'user_wallet'`
(`SPENDABLE_WALLET_TYPES`). Residue the sweep has not moved — or anything credited
in the window between the migration and the deploy — stays **visible** rather than
appearing to vanish. Once the legacy plane is empty this is a no-op.

### The sweep is a balanced transfer, not a credit

`20261209000100` moves each non-zero legacy balance with a DR legacy / CR
`user_wallet` pair, keyed `wallet-plane-consolidate:<account_id>` and idempotent on
`ledger_entries.idempotency_key`. Value is conserved to the kobo: this is a transfer
between two accounts of the same user, so global conservation (ADR-040) and every
user's total spendable balance are both unchanged. A lone credit would have minted
money and left the old plane holding a phantom balance.

It is deliberately **not** re-runnable for a *later* balance on the same account:
after this, no code writes to the legacy plane, so a second balance cannot accrue.

**Verified by execution, not by reading.** The migration was run twice against a
real PostgreSQL instance over fixtures covering all four shapes — legacy-only,
both-planes, `user_wallet`-only, and legacy-with-zero-balance:

| user | before | after (`user_wallet` / `wallet`) |
|---|---|---|
| legacy only | 367 500 | 367 500 / 0 |
| both planes | 450 000 | 450 000 / 0 |
| `user_wallet` only | 900 000 | 900 000 / — |
| legacy, zero balance | 0 | untouched, no account created |

Per-user totals unchanged, legacy plane swept to zero, second run inserted 0 rows,
and the signed sum of every consolidation entry is 0.

## Consequences

**Good**

- ADR-041's card rail works: a top-up credits the pot the module escrow debits.
- The tier daily-spend limit actually binds, on every tier. That was silently open.
- One pot per user, so "spendable balance" needs no summing to be true.
- New users only ever get `user_wallet`; the legacy plane is read-only residue.

**Costs / risks**

- `'wallet'` stays in the type CHECK domain and legacy rows persist. They must —
  their history is immutable. The plane is empty, not gone.
- **Deploy order matters.** Migration first, then the app. If the app ships first it
  writes `user_wallet` for everyone while legacy balances sit unswept; they stay
  visible (the read sums both) and the next migration run moves them — but a user
  could briefly see a balance they cannot spend. Shipping the migration first
  reduces the window to anything credited between the two.
- Anything outside this repo that resolves `ledger_accounts` by `type = 'wallet'`
  will now read an empty account. Nothing in-repo does — verified by sweep — but an
  external reporting query or dashboard might.

**Not addressed here**

- Retiring `'wallet'` from the CHECK domain. Ledger history is immutable, so the
  type must remain valid; a later ADR could mark it non-creatable.
- The remaining ledger-auditor findings on the checkout allowance (concurrency on
  the funding cap, `purpose` binding, cash-out paths with no tier gate at all).
  `FEATURE_CHECKOUT_TOPUP_TIER0` stays **off**; this fixes the plane split, which
  was the blocker that made the feature non-functional, not the whole list.
