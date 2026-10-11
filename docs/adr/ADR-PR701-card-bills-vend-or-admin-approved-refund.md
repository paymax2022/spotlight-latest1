# ADR-PR701 — Card-paid utility bills: vend, or an admin-approved refund

- **Status:** Proposed (flag `FEATURE_UTILITY_CARD_LEDGER`, default off)
- **Amends:** [ADR-PR697](ADR-PR697-card-paid-utility-bills-reach-ledger.md) (resolves its "Known residual")
- **Decision owner:** product/finance (recorded 2026-10-12)

## Context

ADR-PR697 books a card-paid bill as collect (`CARD_COLLECT` credit) then spend
(`DEBIT`), then vends. It left one residual (ledger-auditor MEDIUM): the writer
posts the collect and stalls; the stuck sweeper (>= 10 min) claims the row, sees
collect-without-debit and *retains* the funds; the writer resumes, its spend posts,
and its status write loses the CAS. Net `+X -X`: **no vend and no refund**, with an
alert only. A guard between collect and spend that merely shrinks the window moves
the failure to claims that land before the collect, where the sweeper refunds and
the writer then collects: `2x`.

Separately, every failed vend on a card-paid bill auto-credited the wallet, so a
refund happened without anyone confirming the vend had really failed.

## Decision

The owner rule: **if payment is received, ensure the service is vended; otherwise
initiate a refund that an admin approves manually.**

1. **No automatic refund on a card-paid row.** A failed vend, a stuck-sweeper
   recovery, or a failed collect leaves the row `failed` with
   `metadata.refund_request = {state: pending_admin, basis, amount_kobo,
   requested_at}`, a `refund_requested` event and a `finance` alert. No money moves.
   Approval is the existing admin reversal: it posts exactly one
   `ADMIN_REVERSAL_PAYSTACK_REFUND`, marks the request `approved`, and a second
   approval is refused. The decision applies whenever the flag is on *or* the row
   already carries a collect leg, so rows written flag-on stay correct if the flag
   is later flipped.
2. **The writer takes its row before it moves money.** A version-checked touch
   (`touchOwnedUtilityRow`: `status = initiated AND updated_at = <owned version>`)
   runs immediately before the collect and immediately before the spend. If it fails
   the writer posts nothing further (`writer_outraced`). A local-clock age check
   (5 min, half the sweep age, immune to DB clock skew) makes a writer that was
   frozen past a safe age yield too (`writer_stale_yield`).
   - Claimed before the collect: nothing posted. No `2x`.
   - Claimed between collect and spend: the collect stands, the spend is refused,
     the sweeper retains the funds (the customer holds the money). No `0x`.
3. **Collect-only rows retain the funds** exactly as before: the customer already
   holds the money, so no refund request is needed.
4. **The Go sweeper applies the same decision** (`decideStuckPaystack`) from ledger
   evidence plus `FEATURE_UTILITY_CARD_LEDGER`, recording the request with a new
   metadata merge on `UpdateTransaction` that preserves `payment_reference` (the
   proof of capture the approval path requires).

## Consequences

- A customer whose card-paid bill fails now waits for admin approval to be made
  whole (the notification says so). This is the product decision.
- **The flag must be set on both services (frontend-web and backend).** A mismatch
  is safe but inconsistent: the Go sweeper still keys on ledger evidence, so a row
  with a collect leg is handled correctly either way; only a never-collected row
  differs (Go auto-refunds when its flag is off).
- Residual: a writer frozen for longer than the sweep age *between* its last
  version check and the ledger call can still land one late leg. The window is the
  gap between two adjacent awaits; it is alerted (`writer_outraced` /
  `writer_stale_yield`) rather than silently retained.
- Admins find requests by `failed` status plus the finance alert; there is no
  dedicated queue screen yet.
- Wallet-sourced bills are unchanged.
