# ADR-024 — Top-5 Events money-path crash durability (post-first, mark-last)

**Date:** 2026-07-05  
**Status:** Accepted  
**Deciders:** Platform team · Finance/Ledger · (pending) ledger-auditor sign-off  
**Scope:** `backend/internal/top5events/` (SettleVendor, CloseWallet, Purchase) and a
small read-only addition to `backend/internal/finance/ledger/`. Migration:
`supabase/migrations/20260911000000_events_purchase_durability.sql`.

## Context

A ledger-auditor pass on the Events module flagged four points. Two were confirmed
**safe as-designed** and left unchanged:

- **Fee truncation** (`fee = gross*bps/10000`, integer) rounds the platform fee down
  so the vendor keeps the sub-kobo remainder. `net + fee == gross` exactly (asserted
  in `service_money_test.go`) — value-conserving, no leak. Policy confirmed: favour
  the payee.
- **Event-wallet REFUND direction** — `TOPUP` credits, `CHARGE`/`REFUND` debit the
  projection; `CloseWallet` appends `REFUND(residual)` to zero the balance. Escrow
  conserves per event (topups in = vendor gross out + residual out). Correct.

The other two — plus a third instance the review did not name — were real **crash
durability defects**. All three shared one shape: the module **committed the DB row
that marks the operation final BEFORE posting the cross-module ledger leg**, and the
ledger/wallet services expose **no transaction-scoped API** (their `Credit`/`Debit`/
`PostJournal` open their own tx), so the state change and the money leg could not be
made atomic. A crash in the gap:

- **SettleVendor** — `vendor_float.settled=true` committed, vendor never paid, and
  un-re-settleable (`SUM(settled=false)=0`). Two ledger legs also non-atomic with
  each other → escrow could be left imbalanced.
- **CloseWallet** — wallet `CLOSED` + `REFUND` committed, residual never credited to
  the attendee's main wallet; idempotent early-return then guarantees no re-credit.
- **Purchase** — order committed `status='PAID'` before the debit → a crash yielded a
  paid-looking **free ticket**, unrecoverable (retry collides on `uq_event_orders_idem`).

## Decision

**Invariant: post the idempotent ledger leg FIRST, mark the DB state final LAST.**
On a crash between the two, the state is still non-final, so a same-idempotency-key
retry re-posts (dedup, not double-move) and then finalizes. Concretely:

1. **`alreadyApplied(err)`** helper — treats a ledger post as *durably done* when it
   returns `nil`, `ledger.ErrDuplicate` (Redis fast-path), or a Postgres `23505`
   unique-violation (DB fallback). This is the re-post-tolerance that makes recovery
   safe. A genuine failure (insufficient funds, connection error) still returns false.

2. **SettleVendor / CloseWallet** — post the `ledger.Credit`/`PostJournal` legs
   (dup-tolerant) *before* the `settled=true` / `CLOSED` mark, holding the `FOR UPDATE`
   lock across the posts; commit the mark last. `ledger.Credit` has no balance check,
   so its replay is cleanly duplicate-signalled — no ambiguity.

3. **Purchase** — reshaped to `PENDING → debit → PAID → ticket`. Reservation +
   `PENDING` order commit first (a crash here is a *resumable* order, not a free
   ticket); `finalizePurchase` then debits, flips `PAID`, and issues the ticket. A
   same-idemKey retry (or the sweep) resumes via `orderByIdem`. `PAID` is **not** an
   early-return — ticket issuance always runs, so a crash between the `PAID` flip and
   the ticket insert still mints the missing ticket (idempotent via
   `uq_event_tickets_order`).

4. **`ledger.Posted(baseIdemKey)`** (new, read-only) — `wallet.Debit` runs its
   balance check *before* the `ON CONFLICT` dedup, so replaying an already-applied
   debit can surface `ErrInsufficientFunds` (the prior debit drained the balance)
   rather than a duplicate whenever Redis didn't catch it. Trusting the error type
   would wrongly expire a *paid* order. `finalizePurchase` therefore consults the
   ledger of record and **expires a seat only when the debit definitively never
   posted** — Redis-independent.

5. **`ReconcilePendingOrders` + `StartPendingOrderReconciler`** — a background ticker
   (house pattern) sweeps `PENDING` orders past a grace window: finalizes buyers who
   can pay, expires + releases the seat for those who can't. Idempotent and
   multi-instance safe.

**Migration** (additive-only): widen `event_orders.status` to add `PENDING`/`EXPIRED`,
add nullable `event_orders.tier_id` (so a resume can mint the right ticket), and
`uq_event_tickets_order` (one ticket per order).

### Alternatives considered

- **Tx-scoped ledger API** (`DebitTx(tx, …)`) so the money leg commits atomically
  with the state change. Rejected for now: a large, high-blast-radius change to the
  shared money spine touching every caller. The post-first/mark-last + idempotency
  pattern achieves the same exactly-once guarantee without it.
- **Trust the Redis idempotency cache** for replay detection. Rejected: Redis is
  optional and may be flushed/unavailable across the very crash we are recovering
  from — defeats the purpose. Hence `ledger.Posted` reads the DB of record.

## Consequences

### Positive
- Crash between state-mark and ledger post no longer strands, loses, or double-moves
  money; a same-idemKey retry converges to exactly-once. Covered by DB-free mirror
  tests in `service_durability_test.go` (crash injected at every step).
- No change to the shared ledger/wallet transactional API; the only ledger addition is
  read-only.

### Negative / trade-offs
- **Caller contract:** recovery requires the *same* `Idempotency-Key` on retry. A
  client that generates a fresh key for a resumed checkout/settlement could double-post.
- SettleVendor/CloseWallet hold a row lock across the (separate-connection) ledger
  calls — slightly longer connection hold; acceptable at settlement/close frequency.
- A crash between `cred.Issue` and the ticket insert orphans a single-use credential
  (harmless; expires). Ticket issuance is not credential-idempotent by design.
- **Deploy ordering:** the migration must run before the new binary (Purchase now
  writes `status='PENDING'` + `tier_id`); until then the reconciler logs a non-fatal
  sweep error each tick.

### Follow-up
- ledger-auditor human sign-off on the `alreadyApplied` re-post tolerance and the
  `ledger.Posted` expire-decision — the one spot where a wrong call moves money.
