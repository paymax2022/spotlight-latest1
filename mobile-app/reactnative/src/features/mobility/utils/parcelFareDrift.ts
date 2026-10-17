// Wallet parcel booking: the fare the customer confirmed is sent as
// expected_fare_kobo, and the server refuses with 409 FARE_CHANGED (before any
// money moves) if its live fare differs. Pure helpers, no RN imports, so they
// run under node --test.

/**
 * The amount to pin on the booking: the estimate's FARE. Not totalKobo — the
 * indicative insurance premium is never charged at booking, and the server
 * escrows the fare only.
 */
export function expectedFareFor(est: { fareKobo: number } | undefined): number | undefined {
  return est ? est.fareKobo : undefined;
}

/** The live fare from a 409 FARE_CHANGED, or null for any other error. */
export function fareChangedFrom(err: unknown): { fareKobo: number; expectedFareKobo: number | null } | null {
  const e = err as { response?: { status?: number; data?: Record<string, unknown> } } | undefined;
  const data = e?.response?.data;
  if (e?.response?.status !== 409 || data?.code !== 'FARE_CHANGED') return null;
  const fare = data.fare_kobo;
  if (typeof fare !== 'number' || !Number.isSafeInteger(fare) || fare < 0) return null;
  const expected = data.expected_fare_kobo;
  return { fareKobo: fare, expectedFareKobo: typeof expected === 'number' ? expected : null };
}

export function fareChangedMessage(newFareKobo: number): string {
  const naira = Math.round(newFareKobo / 100).toLocaleString('en-NG');
  return `The delivery price changed to ₦${naira}. You were not charged — check the new price and tap Book again.`;
}
