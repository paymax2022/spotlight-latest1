# ADR-PR98 — The Next.js wallet plane posts balanced double-entry into the shared ledger

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** money-path (wallet / finance)
- **Supersedes:** nothing
- **Related:** ADR-024 (top5events money-path durability), ADR-029 (the same class
  of defect in the FX orchestration ledger, PR #95), `docs/architecture/audit.md`

## Context

`public.ledger_entries` has **two independent writers**:

| Plane | Code | Account types | Posting style |
| --- | --- | --- | --- |
| Go finance ledger | `backend/internal/finance/ledger` | `user_wallet`, `escrow`, `provider_clearing`, `settlement`, … | Always a **balanced DR/CR pair**, one `reference`, leg keys suffixed `:debit` / `:credit` |
| Next.js wallet | `frontend-web/src/server/wallet` | `wallet` | **One leg per event** |

Both write to the *same* table and the *same* `ledger_accounts` table. (The two
user-facing pots — `type='wallet'` vs `type='user_wallet'` — are the known
dual-wallet split; `getBalance` already sums both for display.)

Because the Next.js plane posted only one leg, the table did not conserve value.
Observed on the local database (`:54322`) on 2026-08-13: the global signed sum
was exactly `0` after a mobility trip settlement, then became `+500000` when a
Paystack top-up webhook ran — the row `TOPUP:TOPUP_C2379AC8A0474D06`,
`CREDIT 500000`, `description 'Wallet top-up via Paystack'`, with **no offsetting
DEBIT anywhere**.

The full inventory of writers that could not conserve value:

| # | Writer | Defect |
| --- | --- | --- |
| 1 | `wallet/service.ts` `creditWallet` | bare `CREDIT` (top-ups, virtual-account inflow, referral rewards, admin credits) |
| 2 | `wallet/service.ts` `reverseWalletDebit` | bare `REVERSAL_DEBIT` (utility refunds, vote reversals) |
| 3 | `wallet/service.ts` legacy-balance migration | bare `CREDIT` |
| 4 | `transfers/bank-webhook.ts` | bare `REVERSAL_DEBIT` (failed bank-transfer refund) |
| 5 | `debit_wallet_atomic` RPC | bare `DEBIT` (votes, estate dues, utility) |
| 6 | `reserve_for_bank_transfer` RPC | bare `DEBIT` |
| 7 | `transfer_wallet_atomic` RPC | two legs, but DR `amount+fee` vs CR `amount` — leaked exactly `fee_kobo` per fee-bearing transfer |

This violates the CLAUDE.md iron rule — *"Every money mutation MUST … post
balanced double-entry ledger entries"* — and, because the table is shared, it
means **no conservation invariant can be asserted over the table at all** while
any of these paths exist. A regression in the Go plane would be invisible under
the noise.

## Decision

**Option (a): give the wallet plane counter-legs on the same chart of accounts
the Go ledger uses, so the shared table balances globally.**

Every money movement in the Next.js plane now posts a balanced journal:

| Movement | Journal |
| --- | --- |
| Top-up / virtual-account inflow | DR `provider_clearing` → CR wallet |
| Referral reward | DR `referral_reward_expense` → CR wallet |
| Admin credit / debit | DR/CR `settlement` ↔ wallet |
| Legacy mobile opening balance | DR `settlement` → CR wallet |
| Generic wallet debit (`debit_wallet_atomic`) | DR wallet → CR `settlement` |
| Bank-transfer reserve | DR wallet (amount+fee) → CR `provider_clearing` |
| Bank-transfer refund | REVERSAL_DEBIT wallet → REVERSAL_CREDIT `provider_clearing` |
| Wallet-to-wallet transfer | DR sender (amount+fee) → CR receiver (amount) + CR `paymax_revenue` (fee) |

The invariant that now holds, and is asserted in CI:

> `SUM(signed amount_kobo) = 0` over the **whole** of `public.ledger_entries`,
> where `CREDIT`/`REVERSAL_DEBIT` are positive and `DEBIT`/`REVERSAL_CREDIT`
> negative — the same sign rule as the `wallet_balance` view.

### Rejected: option (b), formally separate the planes

Separating the planes (distinct tables, or a marked account class with a
per-plane invariant) was rejected because:

- It formalises a **permanent violation** of the iron rule rather than fixing it.
  The wallet plane would still be single-entry; it would just be single-entry
  with paperwork.
- Moving the wallet plane to its own table is not additive — it means migrating
  live rows that other modules already reference by `ledger_entries.id`
  (`bank_transfers.sender_entry_id`, `wallet_transfers.sender_entry_id`, …).
- It would make the dual-wallet unification (`wallet` + `user_wallet`) strictly
  harder, and the two pots must eventually reconcile.
- The counterparty accounts option (a) needs — `provider_clearing`,
  `settlement`, `paymax_revenue`, `referral_reward_expense` — **already exist**
  and are already admitted by `ledger_accounts_type_check`. Option (a) is the
  cheaper change *and* the more correct one.

## Design details that are load-bearing

### 1. The primary leg keeps the caller's idempotency key verbatim

The Go convention suffixes **both** legs (`:debit` / `:credit`). We deliberately
do **not** follow it here. The wallet leg keeps the caller's key exactly as it
was, and only the counter-leg is suffixed (`:counter`).

Entries written before this ADR carry the **un-suffixed** key, and
`checkIdempotencyKey` looks that exact string up. Had we moved the wallet leg to
a suffixed key, a replayed webhook for a pre-ADR event would miss the dedup check
and **double-credit the user**. This is the single most dangerous thing to change
in this design.

### 2. Both legs go in one insert

App-side: `supabase.from('ledger_entries').insert([legA, legB])` — PostgREST
executes a multi-row insert as one statement, so it is all-or-nothing. A unique
violation on either leg rolls back both; there is no half-journal state, and
`alreadyProcessed` keeps meaning "this exact event was already posted".

SQL-side: the counter-leg is inserted inside the existing PL/pgSQL function,
already one transaction under the existing lock.

### 3. The RPC signatures did not change

`debit_wallet_atomic`, `reserve_for_bank_transfer` and `transfer_wallet_atomic`
keep byte-for-byte identical argument lists; the counter-account is resolved
*inside* the function via the new `ledger_standing_account(text)` helper. This
avoids PostgREST overload ambiguity, needs no caller edit, and makes omitting the
counter-leg impossible by construction rather than by discipline.

### 4. `provider_clearing`, not `failed_transfer_suspense`, for bank reserves

The Go transfers module reserves into `failed_transfer_suspense` and drains it on
the provider outcome. This plane has **no settle step on success**, so a suspense
pot here would only ever grow. `provider_clearing` is accurate at reserve time
(funds in flight to the PSP), correct on success (the money did leave), and the
refund's `REVERSAL_CREDIT` drains the same account on failure — complete without
an extra posting.

### 5. Historical rows are backfilled, not rewritten

Migration `20261207000200` posts one **reconstructed contra-leg** per unbalanced
`reference` group onto a dedicated `legacy_wallet_contra` standing account. It is
INSERT-only — the ledger stays immutable and corrections remain entries, exactly
as the base migration promised. A dedicated account type (rather than reusing
`settlement`) quarantines reconstructed legs from observed ones, so finance
reporting can exclude them and their total is the exact size of the pre-ADR gap.
User balances are untouched: contra-legs land on a standing account
(`user_id IS NULL`), which no user's balance projection reads.

The `CHECK`-constraint widening that admits `legacy_wallet_contra` is split into
its own migration (`20261207000100`): `ALTER TABLE … ADD CONSTRAINT` takes an
`ACCESS EXCLUSIVE` lock on `ledger_accounts` and holds it to `COMMIT`, and the
backfill scans `ledger_entries` whole — running both in one transaction would
block every wallet read and write for the duration of the scan.

### 6. Deploy order matters

The migrations must land **with or after** the `frontend-web` build carrying this
change. If the old single-leg `creditWallet` is still serving when the backfill
runs, it keeps writing bare `CREDIT`s and re-opens the gap. This is stated at the
top of `20261207000200` too.

### 7. Standing accounts are platform pots, not customer money

Anything that aggregates over `wallet_balance` or `ledger_entries` without
filtering must now exclude `user_id IS NULL` accounts. The admin
Payments & Finance page is updated accordingly — otherwise its "Wallet Balance"
tile would move the *wrong way* on a spend (the user's wallet drops, the
`settlement` pot rises by the same amount).

## Consequences

**Positive**

- Global conservation over the shared table is now a real, assertable invariant —
  and it covers **both** planes, so a future single-sided writer in *either* one
  fails CI.
- Wallet-transfer fees are now recognised as income instead of vanishing.
- The two planes share one chart of accounts, which is the precondition for ever
  reconciling or merging the `wallet` / `user_wallet` pots.

**Negative / accepted**

- Roughly 2× the rows in `ledger_entries` for wallet-plane events, plus one extra
  `SELECT` per app-side mutation to resolve the standing account. Both are
  acceptable at current volume; the resolver is a single indexed lookup.
- Counter-account attribution is coarse for RPC-driven debits: everything through
  `debit_wallet_atomic` lands on `settlement` rather than distinguishing revenue
  (paid votes) from pass-through (utility bills). Conservation is unaffected.
  Refining this is follow-up work, most cleanly done by moving those callers onto
  the app-level journal helper, which already takes an explicit `counterAccount`.
- `legacy_wallet_contra` is a permanent scar in the chart of accounts recording
  exactly how much history predates this ADR. That is intentional.

## Verification

- `frontend-web/tests/unit/finance/ledger-conservation.spec.ts` — pure-logic
  invariant over the journal builder: every wallet primitive's legs sum to zero,
  the counter-side mapping is a true involution, the wallet leg keeps the
  un-suffixed key, and `postJournal` refuses an unbalanced set.
- `backend/tests/ledger/global_conservation_live_db_test.go` — asserts
  `ledger_conservation_check.residual_kobo = 0` against a live database (gated on
  `TEST_DATABASE_URL`), which is the cross-plane assertion.
- Migration `20261207000100` re-checks conservation before `COMMIT` and fails the
  migration if the backfill did not achieve it.

## Follow-ups (not in this change)

- `backend/internal/orchestration/repository.go` `ApplyConversion` has an
  analogous single-sided-per-currency problem in the **FX orchestration** ledger
  (`orch_ledger_entries`) — it posts a DEBIT in the source currency and a CREDIT
  in the destination currency, so the pair balances by row count but neither
  currency does. Same class of defect, different table. **Now fixed** by ADR-029
  (PR #95, writers) and PR #100 (historical backfill + whole-table invariant),
  both merged; this change deliberately does not touch that plane.
- Finer counter-account attribution for `debit_wallet_atomic` callers (see above).
