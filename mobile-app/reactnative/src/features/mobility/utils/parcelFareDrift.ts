// Wallet parcel booking: the fare the customer confirmed is sent as
// expected_fare_kobo, and the server refuses with 409 FARE_CHANGED (before any
// money moves) if its live fare differs. Pure, no RN imports, so it runs under
// node --test.

/**
 * The amount to pin on the booking: the estimate's FARE. Not totalKobo — an
 * opted-in premium is pinned separately (expected_insurance_kobo, see
 * parcelInsurance.ts) and never enters the fare escrow.
 */
export function expectedFareFor(est: { fareKobo: number } | undefined): number | undefined {
  return est ? est.fareKobo : undefined;
}

// The 409 FARE_CHANGED itself (fare or premium) is read by
// parcelBookingErrorFrom in parcelInsurance.ts.
