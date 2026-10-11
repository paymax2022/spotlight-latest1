# ADR-PR701 — Card-paid utility bills: vend, retry for 30 minutes, then refund

- **Status:** Proposed (flag `FEATURE_UTILITY_CARD_LEDGER`, default off)
- **Amends:** [ADR-PR697](ADR-PR697-card-paid-utility-bills-reach-ledger.md) (resolves its "Known residual")
- **Decision owner:** product/finance (recorded 2026-10-12; supersedes an earlier same-day
  "admin approves every refund" draft of this ADR)

## Context

ADR-PR697 books a card-paid bill as collect (`CARD_COLLECT` credit) then spend
(`DEBIT`), then vends. It left one residual (ledger-auditor MEDIUM): the writer posts
the collect and stalls; the stuck sweeper (>= 10 min) claims the row, sees
collect-without-debit and *retains* the funds; the writer resumes, its spend posts and
its status write loses the CAS. Net `+X -X`: **no vend and no refund**, alert only. A
guard that merely shrinks the window moves the failure to claims landing before the
collect, where the sweeper refunds and the writer then collects: `2x`.

Separately, a failed vend on a card-paid bill refunded instantly, with no second
attempt, even though a provider failure is often transient.

## Decision (owner rule)

**If payment succeeded but the value was not vended and that is confirmed: a cron retries
the vend; after 30 minutes of vending failure the customer is refunded to their wallet;
a customer without an active wallet has the funds held with admin and is emailed to
activate the wallet.**

1. **Open a retry window.** A *confirmed* failed vend (every route returned a definitive
   failure) or a stuck-sweeper recovery with no provider attempt on a card-paid row leaves
   the row `failed` with `metadata.vend_retry = {state: retrying, first_failed_at,
   attempts, last_attempt_at, last_error, basis}`. No money moves. (`utility_transactions.status`
   has a CHECK constraint, so the state lives in metadata rather than a new status.)
2. **Retry.** `POST /api/internal/utility/workers/retry-failed-vends` (worker secret,
   scheduled by `.github/workflows/utility-vend-retry.yml` every 5 minutes, dormant until
   enabled) re-runs the vend with a *new* provider request key per attempt, at most once
   per 5 minutes, only while a spend is posted to vend with. Success completes the bill
   (token, commission, notification); `pending` hands off to the normal provider_pending
   requery; a failure counts the attempt.
3. **Refund at 30 minutes** (`first_failed_at` + 30 min). Active wallet: reverse the spend
   to the wallet (`utility:<tx>:REVERSAL_DEBIT`, or `PAYSTACK_REFUND` when the charge was
   captured but never booked), mark the row `reversed`, notify in-app and by email.
4. **Hold when the wallet is not active.** The credit is not posted. The row becomes
   `vend_retry.state = held` (funds stay in provider clearing / with the processor, i.e. with
   admin), finance is alerted, and the customer is emailed and notified to activate. Each
   worker run re-checks; once active, the funds are released as the same refund, once.
5. **Never retry or refund a vend that may have happened.** Any ambiguous attempt
   (timeout/error), a thrown retry error, or an unreadable retry clock sends the row to
   `manual_review` with a support alert. A human reconciles it.
6. **Close the writer race.** The writer takes a version-checked claim on its row
   (`touchOwnedUtilityRow`) immediately before the collect and again before the spend, and
   yields (`writer_outraced` / `writer_stale_yield`, 5-minute local-clock age) so a late leg
   cannot follow a sweeper claim. Claimed before the collect: nothing posted. Claimed
   between collect and spend: the collect stands, the spend is refused, the funds are
   retained (the customer holds the money).
7. **Go sweeper parity.** `decideStuckPaystack` (ledger evidence + flag) opens the same
   window through a metadata merge that preserves `payment_reference`.
8. **Admin override remains.** The existing reversal can settle any retrying/held/manual row
   by hand, exactly once, and closes the retry state so the worker leaves it alone.
9. **Flag off is unchanged** (immediate automatic refund). A row already in the retry state
   keeps resolving after the flag is turned off, so no customer is stranded.

## "Active wallet" (definition used; confirm)

Wallets are ledger accounts created on first credit; there is no activation state in the
schema, so "active" is defined on the customer's *account* (`platform_users`, looked up by auth
user id first — phone-only customers have no email — then by email):

- **Not active:** `suspended`, `pending`, or deleted.
- **Active:** `active`, and **`locked`**. A login lockout is a brute-force guard on sign-in, can be
  triggered by someone else, and a credit to the customer's own wallet is safe.
- **No row:** cannot be proven inactive, so it counts as active; a data gap never withholds a
  refund. A lookup *error* skips the row for that cycle rather than deciding blind.

It is one function (`hasActiveWallet`) if the product means something else (KYC tier, a provisioned
virtual account).

## Consequences

- A customer whose vend fails waits up to 30 minutes (retrying) before the refund.
- **`FEATURE_UTILITY_CARD_LEDGER` must be set on both the frontend-web and backend services**,
  and `UTILITY_WORKER_SECRET` / the repo variables for the new workflow must be configured.
  A flag mismatch is safe: the Go sweeper keys on ledger evidence, so a collected row is handled
  either way; only a never-collected row differs.
- Held refunds are found by the finance alert and `vend_retry.state = held`; there is no
  dedicated admin screen yet. The "held" email is sent once; there is no reminder cadence.
- Wallet-sourced bills keep their immediate reversal (stricter for the customer).

## Independent review of this rework (no blocker, no high) — findings fixed

- **Late collect then refund = 2X (MEDIUM).** A collect that lands after a sweeper opened the window
  leaves collect-without-spend at refund time; the worker now retains (the customer already holds X)
  like every other compensator.
- **Requery-confirmed failure ended in manual review (MEDIUM).** A real-provider-reference requery that
  says "failed" now records `ambiguity_resolved_through`, so the earlier pending/timeout attempt it
  resolved no longer reads as "may have vended". Attempts made after the verdict still do.
- **"Active wallet" held legitimate customers (MEDIUM).** Looked up by id, and `locked` is active (above).
- **Crash between the settle write and the marker (MEDIUM).** The writer's marker is now in the same
  write as the settle. The sweeper path still writes the marker after its claim; a crash in that
  single gap leaves a `failed` row with no marker (the same hole the pre-PR code had around refunds).
- Also: a sweeper-opened window waits one gap before its first retry; a re-failure keeps the original
  30-minute clock; lookups happen only when the decision needs them, so a failing auth lookup cannot
  block a retry.

## Known residuals (none blocking)

- **Late ledger call (LOW).** A ledger call that itself hangs >= 10 minutes can land one late
  leg after a claim (alerted). Bounding the call with a timeout is a follow-up.
- **Vend after a claim (LOW, pre-existing).** A writer stalled > 10 minutes between
  `wallet_debited` and its first provider attempt can be claimed and then vend;
  `provider_outcome_after_claim` alerts. The retry worker raises the same alert if a retry
  vend lands after an admin settled the row.
- **Label (LOW).** Retained collect-only rows are marked `reversed` though nothing was
  reversed; the `paystack_collected_funds_retained` event is the truth.
- Test gaps: Go `settleFailedTransaction` end to end, a TS-written window resolved after a
  Go sweep, and a flag toggled mid-flight. The worker's `metadata->vend_retry->>state in
  (retrying,held)` selection is unit-tested against a fake and was verified once by hand against
  real PostgREST (it returned exactly the retrying row); it is not in CI.
