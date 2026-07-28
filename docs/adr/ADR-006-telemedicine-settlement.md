# ADR-006 — Telemedicine Consultation Settlement (Escrow → 85/15 Split)

**Status:** Accepted
**Date:** 2026-06-18
**Author:** Engineering (Block 13 — Telemedicine App & Admin Console)

---

## Context

A patient pays a consultation fee up front when booking a doctor. The money must
not reach the doctor until the consult actually happens, and if the appointment
is cancelled the patient must be made whole. The platform takes a commission on
every completed consult.

This is the same escrow-and-split shape already used by the food, transport, and
events modules, so telemedicine reuses the shared `finance/settlement` service
rather than inventing a parallel money path. The only telemedicine-specific
decisions are (a) the split ratio and (b) the lifecycle transitions that trigger
settle vs. refund.

All amounts are integers in minor units (kobo). The doctor's consultation fee is
`doctors.consult_fee_kobo`; the appointment snapshots it into
`appointments.fee_kobo` at booking time so a later fee change does not retro-price
an existing booking.

---

## Decision

Settlement is driven entirely through `settlement.Service`:

1. **Book** (`POST /appointments`) — requires an `Idempotency-Key`. Calls
   `settlement.Escrow(patientID, "appointment:<id>", key, "telemedicine", feeKobo)`.
   This debits the patient wallet and holds the fee in escrow; the returned
   `settlement_id` is stored on the appointment row (which also carries a `UNIQUE`
   idempotency key, so a retried booking can never double-charge).
2. **Complete** (`POST /appointments/:id/complete`, doctor only) — calls
   `settlement.Settle(settlementID, Split{ProviderID: doctorUserID, ProviderPct: 0.85, PlatformPct: 0.15})`.
   The doctor receives **85%**, the platform **15%**.
3. **Cancel** (`POST /appointments/:id/cancel`) — calls
   `settlement.Refund(settlementID, "appointment_cancelled")`, reversing the escrow
   with balanced reversing ledger entries. Completed appointments cannot be
   cancelled.

### Key design choices

**Platform absorbs the rounding remainder.** The doctor share is
`floor(fee_kobo * 0.85)` and the platform takes `fee_kobo - doctorKobo`. The two
parts always sum exactly to `fee_kobo` — no kobo is ever created or lost (verified
by `TestBlock13SettlementSplit` and `TestTelemedicineNoFloatLeak`). Floats are used
only for the percentage multiply and are immediately truncated to int64; balances
themselves are never floats.

**Settle is doctor-gated.** Only the assigned doctor (matched via
`doctors.user_id`) can complete and therefore release funds. This prevents a
patient from self-releasing the escrow.

**Reschedule moves no money.** `POST /appointments/:id/reschedule` only updates
`scheduled_at`; the escrow and `settlement_id` are preserved, so a time change
never re-triggers a debit.

**Reviews are immutable and gate on completion.** A patient may review only a
`completed` appointment, exactly once (enforced by `telemedicine_reviews`
`UNIQUE(appointment_id)`). The doctor's `rating`/`review_count` are a *projection*
recomputed from the reviews table — never incrementally mutated — so they can
always be rebuilt from source.

---

## Alternatives Considered

**Direct wallet-to-wallet transfer at completion (no escrow).** Rejected: the fee
would have to sit in the patient's wallet until the consult, allowing them to spend
it first and leaving the doctor unpaid. Escrow removes that race.

**Configurable split via env var.** Rejected: the 85/15 ratio is a commercial
business rule, not infrastructure tuning. It lives in code where it is visible,
version-controlled, and test-covered. A future per-tier or per-specialty rate can
be introduced as an explicit `Split` lookup without changing the money path.

**Partial refund (cancellation penalty) computed inside `settlement.Refund`.**
Deferred: the shared `Refund` currently reverses the full escrow, and changing its
signature touches a money-path service used by four other modules. The cancellation
*policy/penalty* is surfaced to the patient in the mobile refund-preview UI; wiring
a partial-refund path is tracked as a follow-up that must ship with its own
ledger-auditor review.

---

## Consequences

- Telemedicine adds **no new money primitives** — it is a thin caller of the audited
  `settlement` + `ledger` services, so the double-entry and idempotency guarantees
  hold automatically.
- Every booking, settle, and refund emits the settlement service's existing audit
  events; the admin Settlements view reads from the same `settlements` table.
- `FEATURE_TELEMEDICINE_ENABLED=false` removes all routes, so the money path is
  inert until the flag is on.
- The deferred partial-refund decision means cancellations are currently full
  refunds; this is intentionally conservative (favours the patient) until the
  penalty path is reviewed.
