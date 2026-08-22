# ADR-044 — Telemedicine platform booking fee is additive to the patient

- **Status:** Accepted
- **Date:** 2026-08-14
- **Supersedes:** none
- **Related:** [ADR-034](ADR-034-restaurant-promo-funder-bound.md) (who funds a
  price adjustment), [ADR-030](ADR-030-fx-paymax-markup.md) (markup as a first-class
  ledger leg), [ADR-032](ADR-032-fx-markup-single-source-of-truth.md) (one authority
  for a rate)

## Context

`app/services/telemedicine/book/confirm.tsx` (commit `5de461be`) started rendering
and charging a 5% platform fee, computed **client-side** from the doctor's
consultation fee: `SERVICE_FEE_BPS = 500`, `Math.round(feeKobo * 500 / 10_000)`,
`totalKobo = feeKobo + serviceFeeKobo`.

The Go backend knew nothing about it. `telemedicine.Service.BookAppointment` reads
`doctors.consult_fee_kobo` and escrows exactly that — correctly ignoring the
client-supplied `feeKobo`, because the server must be authoritative for money. The
result was a live-money inconsistency that differs by payment rail:

| Rail | Patient is charged | Server escrows / records | Outcome |
|---|---|---|---|
| Wallet | *displayed* consult + 5% | consult only | patient debited **less** than the screen said |
| Card (Paystack) | consult + 5% (client amount) | consult only | the 5% is collected with **no ledger entry and no settlement row** |

The card case is the serious one: real money arrives at the PSP that the
double-entry ledger has never heard of. It cannot be reconciled, refunded through
the normal path, or attributed to a revenue account. The appointment detail screen
compounded the confusion by showing "Fee paid" from `appointments.fee_kobo` (the
consultation fee alone), which disagrees with what a card payer actually paid.

The module already settles completed consultations 85/15 (doctor/platform) — see
`CompleteAppointment` and the `SUM(fee_kobo * 0.85)` earnings queries in
`service.go`. So making the fee real forces an explicit question the client-side
change never had to answer: **who pays the 5%?**

## Decision

### 1. The 5% is ADDITIVE to the patient. It does not come out of the 85/15 split.

The patient pays `consult + 5%`. The doctor still receives **85% of the
consultation fee they advertised**. The platform receives `15% of consult + the
full 5% fee`.

For a ₦3,500 consultation:

```
patient pays     367_500 kobo   (350_000 consult + 17_500 fee)
doctor receives  297_500 kobo   (85% of 350_000)          ← unchanged by this ADR
platform         70_000 kobo    (15% of 350_000 + 17_500)
                 ─────────────
                 367_500        conserved to the kobo
```

Rejected alternative — **fee carved out of the existing split**: the patient would
pay `consult` only, and the 5% would come off the top, cutting the doctor from 85%
to 80% of their advertised fee. Rejected because:

- It silently re-prices every doctor already on the platform. A doctor who agreed
  to 85% would start receiving 80% with no contract change and no notification.
- It contradicts what the patient is now shown. The UI presents a consultation fee
  and a separate platform fee that sum to a total; a carve-out makes the "Platform
  fee" row a fiction, since the total would equal the consultation fee.
- It would silently falsify the existing doctor-earnings reporting. The dashboard
  queries compute `SUM(fee_kobo * 0.85)`; under a carve-out those would over-report
  every doctor's take by 5% of 85% unless every earnings query were rewritten too.

### 2. `fee_kobo` keeps meaning "consultation fee". The fee gets its own columns.

`appointments.fee_kobo` stays the doctor's consultation fee. Two additive columns
carry the rest: `platform_fee_kobo` and `total_kobo` (what was actually escrowed).

This is deliberate. Overloading `fee_kobo` to mean "total" would be a one-line
change that silently corrupts the two `SUM(fee_kobo * 0.85)` earnings queries —
they would start paying doctors 85% of the platform's fee as well.

### 3. The fee is posted as a 100%-platform settlement leg, not a side transfer.

`settlement.Split` already models exactly this: `ServiceFeeKobo` is a fixed
whole-kobo platform leg that rides **on top of** the percentage split (the mirror
of `TipKobo`, which is 100% rider). `internal/restaurant` already uses it for its
own service fee. Telemedicine now escrows the total and settles with:

```go
settlement.Split{
    ProviderID:     doctorUserID,
    ProviderPct:    0.85,
    PlatformPct:    0.15,
    ServiceFeeKobo: appt.PlatformFeeKobo,
}
```

Working the existing `Settle` algebra through, with `total = consult + fee`:

```
base     = total − tip − serviceFee = consult                    (tip = 0)
gross    = base + discount          = consult                    (discount = 0)
platform = ⌊gross×0.15⌋ + serviceFee = ⌊0.15·consult⌋ + fee
provider = total − platform − rider = consult − ⌊0.15·consult⌋   (rider = 0)
```

The provider leg is `consult − ⌊0.15·consult⌋` — 85% of the consultation fee with
the sub-kobo remainder rounded in the doctor's favour, exactly as before this
change (₦333.33 → 28 334 kobo, not 28 333). "85%" below is that value, not a
separate rounding.

So the doctor leg is provably untouched by the fee, and the platform fee lands in
`AccountPaymaxRevenue` as an ordinary balanced double-entry pair — auditable,
reconcilable, refundable. No new settlement primitive was needed.

**Backward compatibility falls out for free:** appointments escrowed before this
change carry `platform_fee_kobo = 0`, and `ServiceFeeKobo: 0` reproduces the old
pure 85/15 split exactly. Already-escrowed rows settle unchanged.

### 4. The rate lives in Go, in basis points, applied with flooring integer math.

`telemedicine.PlatformFeeBp = 500`, applied as `consultFeeKobo * 500 / 10000`.
Integer division floors, mirroring `restaurant.applyBp` — a derived fee must never
round *up* past its exact fraction, because rounding up charges the patient money
no rule entitles the platform to. (The client's `Math.round` could round up by a
kobo; that discrepancy disappears with the client no longer computing anything.)

### 5. The client renders the server's breakdown. It never computes the rate.

`GET /telemedicine/doctors[/{id}]` returns a computed `booking` quote
(`consult_fee_kobo`, `platform_fee_bp`, `platform_fee_kobo`, `total_kobo`) and the
booked `Appointment` carries `platform_fee_kobo` / `total_kobo`. The confirm screen
renders those numbers; there is no rate constant in the app for the server's rate
to drift from.

When the quote is absent (an older backend), the screen **fails closed**: the total
is not shown and the Pay button is disabled. It does not fall back to a local
calculation or to a fee-free total — either fallback re-creates the exact
display-vs-charge divergence this ADR exists to remove.

### 6. Two guards bound the amount, on the quote and on the replay.

`BookAppointmentRequest.expected_total_kobo` carries the total the client quoted.
When it is non-zero and disagrees with the server's computation, the booking is
rejected. Zero means "client did not quote" and skips the check, so older clients
keep working. It cannot be exploited for gain — the server always escrows its own
computed total regardless — it only enables staleness detection.

`assertEscrowMatchesQuote` guards the replay path, which the first check cannot
see. `Escrow` is idempotent on the Idempotency-Key, so replaying a booking returns
the settlement escrowed on the *first* attempt, while the quote is recomputed from
the doctor's live `consult_fee_kobo` every time. A fee edit between attempts makes
them disagree, and writing the appointment from the fresh quote would record a
price that was never charged: escrow holds 367 500, the doctor raises to ₦5,000,
and the replay records a 525 000 total — a receipt 157 500 too high, a 25 000
platform fee leg against an escrow that received 17 500 of fee, and a dashboard
reporting 425 000 to a doctor actually paid 291 125. The booking now fails closed
against the escrow, which is the money that really moved.

**Scope limit — the guards do not protect the client-side card rail.** On that rail
(`usePurchasePayment`'s built-in Paystack Inline gateway) the PSP charge completes
*before* `charge()` calls this endpoint, so a rejection leaves the patient charged
with nothing booked. That rail has a deeper pre-existing problem this ADR does not
fix: see "Not addressed here".

### 7. The fee is behind `FEATURE_TELEMEDICINE_PLATFORM_FEE_ENABLED`, default OFF.

The flag resolves to a *rate*, not a branch: on → `PlatformFeeBp` (500), off → 0 bp.
A 0-bp quote is arithmetically identical to the pre-ADR-044 world — the patient
pays the consultation fee, that is what gets escrowed, and `Settle` receives
`ServiceFeeKobo: 0`, the pure 85/15 split. There is no second code path to keep
correct.

Default OFF because this is a patient-visible price increase; switching it on is a
deliberate act. `NewService` leaves the rate at 0 and `WithPlatformFeeBp` turns it
on, so a wiring mistake **under**-charges rather than billing every patient a fee
nobody approved — the recoverable direction.

Rollback needs no app release. The client renders whatever quote the server
returns, so flipping the flag off drops the fee row to ₦0 and the escrow back to
the consultation fee on the very next request.

## Consequences

**Good**

- On the wallet rail, every kobo the patient is charged now has a ledger entry and
  a settlement row behind it. The displayed total and the escrowed total are the
  same number by construction.
- The amount escrowed no longer depends on which rail was used, because both
  derive it from the same server computation.
- The doctor's economics are provably unchanged — asserted both by formula and by
  a golden table of literal kobo values for every leg.
- Refunds are automatically correct: `Refund` releases the full escrowed
  `total_kobo`, so a cancelling patient is made whole including the platform fee.

**Costs / risks**

- The patient-visible price of a consultation rises 5%. That is a product decision
  this ADR makes explicit rather than a technical consequence — it is the direct
  implication of "additive", and it is what the shipped UI already told patients.
- Two new columns on `appointments`, and `total_kobo` must be read wherever a
  "what did this cost" figure is displayed. `fee_kobo` remains the doctor-facing
  number; using it as a patient-facing total is now a bug.
- The rate is a compile-time constant. Making it per-doctor or per-tier later means
  a config table plus a migration; the `booking` quote in the API response is
  already shaped to absorb that without a client change.

**Not addressed here**

A ledger-auditor review of this change confirmed the arithmetic and then found
these on the surrounding lifecycle. They are pre-existing and platform-wide — each
needs its own change and its own review — but they bound what this ADR can claim:

- **The client-side card rail double-charges, on every module.**
  `usePurchasePayment` opens the Paystack Inline SDK for `amountKobo` and *then*
  runs the module's `charge()`, which escrows via `ledger.Debit` against the
  patient's **wallet**. The receiving webhook
  (`frontend-web/app/api/webhooks/paystack/gateway-handler.ts`) only writes an
  audit row — crediting the wallet is an explicit `TODO`. So a card payer is
  charged at the PSP *and* debited in-app; if the wallet is short, the PSP money
  is lost with no ledger entry, no settlement and no refund path. This is why the
  "Good" list above is scoped to the wallet rail. Fixing it means a
  server-initiated card flow (initiate → webhook → credit → escrow), not a change
  to this module.
- **`Escrow`'s debit and its settlements row are not atomic, and the amount can
  change between attempts.** A crash between the two, followed by a retry priced
  differently, creates the settlements row at the *new* amount over a debit at the
  *old* one — paying out more than escrow ever received.
  `assertEscrowMatchesQuote` stops telemedicine from *recording* the divergence,
  but the root fix belongs in `settlement.Escrow`: on `ledger.ErrDuplicate`, read
  the already-posted amount back and refuse if it differs.
- **`settlements.idempotency_key` is globally unique and takes raw client input.**
  Reusing a key across modules makes the second `Escrow` a silent no-op that
  returns the *first* module's settlement — a free consultation settled out of
  another vertical's escrow. Keys need per-module namespacing.
- **Deploy ordering.** The migration is additive but must be applied *before* the
  backend ships. If the backend leads, every booking escrows and then fails its
  INSERT on the missing column, stranding the escrow with no appointment row and
  so no cancel path. The feature flag does not cover this — the new columns are
  written whether or not the fee is charged.
- **No tier-limit gate on telemedicine escrow** (restaurant has one — see
  ADR-033). Unchanged by this ADR; still outstanding for this module.
- **The live telemedicine client has no general snake_case→camelCase mapping**, so
  `doctor.feeKobo` was `undefined` in live mode. The money fields and the booking
  request body are mapped as part of this change; the rest of the module's field
  mapping (including `BookAppointmentResult`) remains unaddressed.

One authorization defect the review found *was* fixed here, because it sits
directly on the refund path this ADR enlarges: `CancelAppointment` accepted an
`actorID` and never compared it, so any authenticated user could cancel any
appointment by id — forcing a full refund of a stranger's booking and denying the
doctor their fee. It now permits only the patient or the assigned doctor, failing
closed when the doctor record cannot be resolved.
