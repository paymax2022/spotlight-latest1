# ADR-PR834: Parcel fares come from a size × speed rate card

**Status:** Accepted · **Date:** 2026-10-17 · **Area:** transport / parcel money path

## Context
A parcel fare was `(base + per_km·km + per_min·min) × size × speed`, using two hardcoded float
multipliers and one minimum fare for every combination. That could not express a simple rule like
"Priority on a large box needs a car, so it needs a higher floor". A short hop priced Priority on a
large box at the same minimum as Standard on an envelope.

The app's Priority option (`same_day`) was missing from the multipliers and from the
`parcels.speed` CHECK, and three of its categories were missing from `parcels.category`. Those
bookings could not be made.

## Decision
1. **One rate-card row per (zone, size, speed).** `transport_parcel_rate_card` stores an integer
   `multiplier_bps` and a `min_fare_kobo`. The distance and time base still comes from
   `transport_pricing_config`, and the effective minimum is the higher of the two.
   - Basis points, not floats, so a stored cell prices the same every time it is read.
   - It is read behind `FEATURE_PARCEL_RATE_CARD_ENABLED`. With the flag off, or for a missing
     cell, the legacy multipliers apply (now including `same_day` at 2.2×).
   - If the card cannot be read, the request fails closed. It never silently falls back to legacy
     prices, because the estimate and the charge must price from the same card.
2. **Card checkouts freeze the cell.** The cell a quote priced from is frozen with the quote
   (`parcelFrozenPricing.Rate`) and replayed at confirm. The live card is never re-read.
   - An admin edit or a flag flip between initiate and confirm cannot cause an amount mismatch.
   - A snapshot with no `Rate` (pre-card intents) reprices with the legacy multipliers.
3. **Validate before escrow.** Size, speed and category are normalised and validated during
   pricing. The wallet path escrows before it inserts the parcel, so a value the table would reject
   must be refused with a 422 before any money moves.
4. **The estimate returns every size × speed** (`options`), so each choice in the app shows its
   own server price. The app never computes a fare.
5. **The indicative insurance premium is floored** at the insurer's minimum
   (`PARCEL_INSURANCE_MIN_PREMIUM_KOBO`, ₦2,000, as seen on a live MyCover quote).
   - The estimate names the cover (On Demand Goods In Transit, Sovereign Trust Insurance via MyCover).
   - It stays display only: nothing is charged at booking.

## Consequences
- Pricing is now an admin decision per cell. The editor UI is #817.
- Switching the flag on changes some prices relative to legacy, e.g. medium Priority goes from
  3.08× to 3.0× and minimums rise with size and speed. Roll it out deliberately.
- The `parcels.speed` and `parcels.category` CHECKs were widened by drop and re-add as supersets.
  Every value accepted before is still accepted.
