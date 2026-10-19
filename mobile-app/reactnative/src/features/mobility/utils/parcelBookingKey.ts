// One Idempotency-Key per parcel BOOKING, not per tap. Minting a fresh key on
// every attempt meant a retry after a lost response (the first booking DID go
// through) booked and debited a second time. The key is kept while the booking
// is unchanged — so the server returns the original parcel — and re-minted the
// moment anything being booked changes (the server refuses a reused key with a
// different body). Pure, no RN imports, so it runs under node --test.

export interface BookingKey {
  key: string;
  fingerprint: string;
}

export function nextBookingKey(prev: BookingKey | null, booking: unknown, mint: () => string): BookingKey {
  const fingerprint = JSON.stringify(booking);
  if (prev && prev.fingerprint === fingerprint) return prev;
  return { key: mint(), fingerprint };
}
