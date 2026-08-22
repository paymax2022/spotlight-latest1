// Pure-logic unit tests for the telemedicine booking price mapping (ADR-040).
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/unit/telemedicine/pricing.spec.ts"
// (node:test + assert — this app has no vitest; matches the other unit suites.)
//
// The bug these guard: the confirm screen used to compute the 5% platform fee
// itself, so it displayed (and the card rail charged) a total the backend never
// escrowed. The client now renders only what the server sent. Every test below
// pins one half of that contract: the server's numbers survive the mapping
// intact, and the client invents nothing when they are absent.
//
// Fixtures are the LITERAL snake_case shapes emitted by
// backend/internal/telemedicine (fee.go BookingQuote, model.go Appointment), so
// these fail if the client and the Go handler drift apart again.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readBookingQuote,
  mapDoctorMoney,
  mapAppointmentMoney,
  withDemoQuote,
  slotToISO,
  DEMO_PLATFORM_FEE_BP,
} from '@/features/telemedicine/pricing';
import type { Doctor } from '@/types/telemedicine';

/** The Go BookingQuote for a ₦3,500 consultation: 350000 + 5% = 367500. */
const SERVER_QUOTE = {
  consult_fee_kobo:  350_000,
  platform_fee_bp:   500,
  platform_fee_kobo: 17_500,
  total_kobo:        367_500,
};

describe('readBookingQuote', () => {
  it('carries the server breakdown through unchanged', () => {
    assert.deepEqual(readBookingQuote({ booking: SERVER_QUOTE }), {
      consultFeeKobo:  350_000,
      platformFeeBp:   500,
      platformFeeKobo: 17_500,
      totalKobo:       367_500,
    });
  });

  it('trusts the server total even when it disagrees with the stated rate', () => {
    // The whole point: the client is not a second opinion. If the backend ever
    // changes the rate, prices per doctor, or waives the fee, the screen follows
    // it — a client that "corrected" this would re-create the drift.
    const waived = { ...SERVER_QUOTE, platform_fee_kobo: 0, total_kobo: 350_000 };
    assert.equal(readBookingQuote({ booking: waived })?.totalKobo, 350_000);
    assert.equal(readBookingQuote({ booking: waived })?.platformFeeKobo, 0);
  });

  it('returns undefined when the server sent no quote — so callers fail closed', () => {
    // A missing quote must NOT degrade to "charge the consultation fee": that is
    // precisely the wallet-rail undercharge this ADR removed.
    assert.equal(readBookingQuote({ consult_fee_kobo: 350_000 }), undefined);
    assert.equal(readBookingQuote(undefined), undefined);
  });

  it('treats an unpriceable (zero/absent total) quote as no quote', () => {
    // Mirrors the backend's Priceable() gate. A zero total must never render as a
    // free consultation the patient can tap Pay on.
    assert.equal(readBookingQuote({ booking: { ...SERVER_QUOTE, total_kobo: 0 } }), undefined);
    assert.equal(readBookingQuote({ booking: {} }), undefined);
  });

  it('ignores non-numeric money — a string total is not a price', () => {
    assert.equal(readBookingQuote({ booking: { ...SERVER_QUOTE, total_kobo: '367500' } }), undefined);
  });
});

describe('mapDoctorMoney', () => {
  it('maps the Go consult_fee_kobo onto feeKobo and attaches the quote', () => {
    // Before this mapping existed the live branch returned raw Go JSON, so
    // `doctor.feeKobo` was undefined and the screen priced the booking at ₦0.
    const d = mapDoctorMoney({ id: 'doc-1', consult_fee_kobo: 350_000, booking: SERVER_QUOTE });
    assert.equal(d.feeKobo, 350_000);
    assert.equal(d.booking?.totalKobo, 367_500);
  });

  it('leaves feeKobo at 0 and booking undefined for an unpriced doctor', () => {
    const d = mapDoctorMoney({ id: 'doc-1' });
    assert.equal(d.feeKobo, 0);
    assert.equal(d.booking, undefined);
  });
});

describe('mapAppointmentMoney', () => {
  it('keeps fee_kobo as the consultation fee and total_kobo as what was paid', () => {
    // fee_kobo is the doctor's number (earnings are 85% of it). Rendering it as
    // "Fee paid" is what made the detail screen disagree with a card payer's
    // receipt.
    const a = mapAppointmentMoney({
      id: 'apt-1', fee_kobo: 350_000, platform_fee_kobo: 17_500, total_kobo: 367_500,
    });
    assert.equal(a.feeKobo, 350_000);
    assert.equal(a.platformFeeKobo, 17_500);
    assert.equal(a.totalKobo, 367_500);
  });

  it('reads a pre-ADR-040 row as having paid the consultation fee, not nothing', () => {
    // Legacy rows escrowed the consultation fee alone. Defaulting the total to 0
    // would show "Total paid ₦0" and, worse, "Refund to wallet ₦0" on the cancel
    // sheet for a patient owed a real refund.
    const a = mapAppointmentMoney({ id: 'apt-legacy', fee_kobo: 350_000 });
    assert.equal(a.platformFeeKobo, 0);
    assert.equal(a.totalKobo, 350_000);
  });

  it('never reports a total below the sum of its parts', () => {
    for (const fee of [1, 19, 33_333, 350_000, 750_000]) {
      for (const plat of [0, 1, 1_666, 17_500]) {
        const a = mapAppointmentMoney({ fee_kobo: fee, platform_fee_kobo: plat });
        const total = a.totalKobo ?? 0;
        assert.ok(total >= a.feeKobo + (a.platformFeeKobo ?? 0),
          `total ${total} < ${fee} + ${plat}`);
      }
    }
  });
});

describe('withDemoQuote (mock mode stands in for the server)', () => {
  it('floors the fee to whole kobo, exactly as the Go backend does', () => {
    // Go: consult * 500 / 10000 with integer division. Math.round here would
    // round UP on a remainder and quote a kobo the backend will not escrow.
    const cases: [number, number][] = [
      [350_000, 17_500],
      [33_333,  1_666],   // exact 1666.65 → floors to 1666
      [19,      0],       // exact 0.95    → floors to 0
      [1,       0],
      [99_991,  4_999],   // exact 4999.55 → floors to 4999
    ];
    for (const [feeKobo, expectedFee] of cases) {
      const d = withDemoQuote({ feeKobo } as Doctor);
      assert.equal(d.booking?.platformFeeKobo, expectedFee, `fee for ${feeKobo}`);
      assert.equal(d.booking?.totalKobo, feeKobo + expectedFee, `total for ${feeKobo}`);
      assert.ok(Number.isInteger(d.booking!.platformFeeKobo), 'fee must be whole kobo');
      // Never charge more than the exact fraction entitles us to.
      assert.ok(d.booking!.platformFeeKobo <= (feeKobo * DEMO_PLATFORM_FEE_BP) / 10_000);
    }
  });

  it('produces a quote the reader accepts, so mock and live behave identically', () => {
    const d = withDemoQuote({ feeKobo: 350_000 } as Doctor);
    const roundTripped = readBookingQuote({
      booking: {
        consult_fee_kobo:  d.booking!.consultFeeKobo,
        platform_fee_bp:   d.booking!.platformFeeBp,
        platform_fee_kobo: d.booking!.platformFeeKobo,
        total_kobo:        d.booking!.totalKobo,
      },
    });
    assert.deepEqual(roundTripped, d.booking);
  });
});

describe('slotToISO', () => {
  it('converts the picked slot to the scheduled_at the backend requires', () => {
    const iso = slotToISO('2026-08-20', '09:00 AM');
    assert.ok(iso);
    const d = new Date(iso!);
    assert.equal(d.getHours(), 9);
    assert.equal(d.getMinutes(), 0);
  });

  it('maps the 12-hour clock correctly at both noon and midnight', () => {
    assert.equal(new Date(slotToISO('2026-08-20', '12:00 PM')!).getHours(), 12);
    assert.equal(new Date(slotToISO('2026-08-20', '12:30 AM')!).getHours(), 0);
    assert.equal(new Date(slotToISO('2026-08-20', '06:00 PM')!).getHours(), 18);
  });

  it('returns undefined rather than inventing a time it cannot parse', () => {
    // An invented scheduled_at would book a consultation at a time nobody chose,
    // and the escrow would already have happened by the time anyone noticed.
    for (const bad of [undefined, '', 'soon', '25:00 AM', '09:00', '13:00 PM', '09:99 AM']) {
      assert.equal(slotToISO('2026-08-20', bad as string | undefined), undefined, `parsed ${bad}`);
    }
    assert.equal(slotToISO(undefined, '09:00 AM'), undefined);
    assert.equal(slotToISO('not-a-date', '09:00 AM'), undefined);
  });
});
