// Pure-logic unit test for parcel insurance paid at booking (ADR-PR836) — run with:
//   node --experimental-strip-types --test src/features/mobility/utils/__tests__/parcelInsurance.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookingInsuranceFields,
  missingFieldsSentence,
  parcelBookingErrorFrom,
  parcelInsuranceSelection,
  parcelInsuranceStatusView,
} from '../parcelInsurance.ts';

const cover = { productName: 'Goods in Transit' };
const est = { fareKobo: 300000, insuranceKobo: 200000, insurance: cover };
const axiosErr = (status: number, data: Record<string, unknown>) => ({ response: { status, data } });

test('ticked: the pay sheet charges fare + premium and the booking carries insure + the premium seen', () => {
  const sel = parcelInsuranceSelection(est, true);
  assert.equal(sel.insured, true);
  assert.equal(sel.premiumKobo, 200000);
  assert.equal(sel.payableKobo, 500000);
  assert.deepEqual(bookingInsuranceFields(sel), { insure: true, expectedInsuranceKobo: 200000 });
});

test('unticked: fare only, no premium, nothing insurance-related on the booking', () => {
  const sel = parcelInsuranceSelection(est, false);
  assert.equal(sel.insured, false);
  assert.equal(sel.premiumKobo, 0);
  assert.equal(sel.payableKobo, 300000);
  assert.deepEqual(bookingInsuranceFields(sel), {});
});

test('ticked with no item value yet: not insured, fare only, and the screen asks for the value', () => {
  const sel = parcelInsuranceSelection({ ...est, insuranceKobo: 0 }, true);
  assert.equal(sel.insured, false);
  assert.equal(sel.needsDeclaredValue, true);
  assert.equal(sel.payableKobo, 300000);
  assert.deepEqual(bookingInsuranceFields(sel), {});
});

test('no cover on offer: the tick does nothing even if a premium is present', () => {
  const sel = parcelInsuranceSelection({ ...est, insurance: null }, true);
  assert.equal(sel.offered, false);
  assert.equal(sel.insured, false);
  assert.equal(sel.needsDeclaredValue, false);
  assert.equal(sel.payableKobo, 300000);
  assert.equal(parcelInsuranceSelection(undefined, true).payableKobo, 0);
});

test('422 INSURANCE_PROFILE_INCOMPLETE lists the missing fields in words', () => {
  const r = parcelBookingErrorFrom(axiosErr(422, { code: 'INSURANCE_PROFILE_INCOMPLETE', missing: ['gender', 'date_of_birth', 'address'] }));
  assert.equal(r?.kind, 'profile_incomplete');
  assert.deepEqual(r && r.kind === 'profile_incomplete' ? r.missing : null, ['gender', 'date_of_birth', 'address']);
  assert.match(r!.message, /gender, date of birth and home address/);
  assert.match(r!.message, /not charged/);
  // A malformed `missing` degrades to a generic prompt, never a crash.
  const g = parcelBookingErrorFrom(axiosErr(422, { code: 'INSURANCE_PROFILE_INCOMPLETE', missing: 'gender' }));
  assert.equal(g?.kind, 'profile_incomplete');
  assert.match(g!.message, /Complete your profile/);
});

test('missing fields read as a sentence', () => {
  assert.equal(missingFieldsSentence(['gender']), 'gender');
  assert.equal(missingFieldsSentence(['first_name', 'email']), 'first name and email address');
  assert.equal(missingFieldsSentence(['some_new_field']), 'some new field');
  assert.equal(missingFieldsSentence([]), '');
});

test('the other insurance refusals map to their own kinds', () => {
  assert.equal(parcelBookingErrorFrom(axiosErr(422, { code: 'INSURANCE_DECLARED_VALUE_REQUIRED' }))?.kind, 'declared_value_required');
  assert.equal(parcelBookingErrorFrom(axiosErr(422, { code: 'INSURANCE_UNAVAILABLE' }))?.kind, 'insurance_unavailable');
  const card = parcelBookingErrorFrom(axiosErr(422, { code: 'INSURANCE_CARD_NOT_SUPPORTED' }));
  assert.equal(card?.kind, 'card_not_supported');
  assert.match(card!.message, /wallet/);
});

test('402 is insufficient balance, with or without the code', () => {
  assert.equal(parcelBookingErrorFrom(axiosErr(402, { code: 'INSUFFICIENT_FUNDS' }))?.kind, 'insufficient_funds');
  assert.equal(parcelBookingErrorFrom(axiosErr(402, { error: 'insufficient' }))?.kind, 'insufficient_funds');
});

test('409 IDEMPOTENCY_KEY_CONFLICT asks for a fresh tap', () => {
  const r = parcelBookingErrorFrom(axiosErr(409, { code: 'IDEMPOTENCY_KEY_CONFLICT' }));
  assert.equal(r?.kind, 'key_conflict');
  assert.match(r!.message, /tap Book courier again/);
});

test('409 FARE_CHANGED: fare-only, premium-only, and malformed bodies', () => {
  const fare = parcelBookingErrorFrom(axiosErr(409, { code: 'FARE_CHANGED', fare_kobo: 660000, expected_fare_kobo: 300000 }));
  assert.deepEqual(fare && fare.kind === 'fare_changed' ? [fare.fareKobo, fare.insuranceKobo] : null, [660000, null]);
  assert.match(fare!.message, /delivery price changed to ₦6,600/);

  const prem = parcelBookingErrorFrom(axiosErr(409, { code: 'FARE_CHANGED', insurance_kobo: 250000, expected_insurance_kobo: 200000 }));
  assert.deepEqual(prem && prem.kind === 'fare_changed' ? [prem.fareKobo, prem.insuranceKobo] : null, [null, 250000]);
  assert.match(prem!.message, /insurance price changed to ₦2,500/);
  assert.match(prem!.message, /not charged/);

  assert.equal(parcelBookingErrorFrom(axiosErr(409, { code: 'FARE_CHANGED', insurance_kobo: '250000' })), null);
  assert.equal(parcelBookingErrorFrom(axiosErr(409, { code: 'FARE_CHANGED', fare_kobo: 6600.5 })), null);
  assert.equal(parcelBookingErrorFrom(axiosErr(422, { code: 'FARE_CHANGED', fare_kobo: 660000 })), null);
});

test('anything else is not ours', () => {
  assert.equal(parcelBookingErrorFrom(axiosErr(409, { code: 'AMOUNT_MISMATCH' })), null);
  assert.equal(parcelBookingErrorFrom(axiosErr(500, {})), null);
  assert.equal(parcelBookingErrorFrom(new Error('Network Error')), null);
  assert.equal(parcelBookingErrorFrom(undefined), null);
});

test('detail: covered / being arranged / refunded / refund pending', () => {
  const base = { insuranceOpted: true, insurancePaidKobo: 200000, phase: 'in_transit' };
  assert.equal(parcelInsuranceStatusView({ ...base, insuranceStatus: 'bound' })?.title, 'Covered');
  for (const s of ['held', 'binding']) {
    const v = parcelInsuranceStatusView({ ...base, insuranceStatus: s });
    assert.equal(v?.title, 'Cover being arranged');
    assert.match(v!.body, /₦2,000/);
  }
  const refunded = parcelInsuranceStatusView({ ...base, insuranceStatus: 'refunded' });
  assert.equal(refunded?.title, 'Insurance refunded');
  assert.match(refunded!.body, /without insurance/);
  const cancelled = parcelInsuranceStatusView({ ...base, phase: 'cancelled', insuranceStatus: 'refunded' });
  assert.match(cancelled!.body, /cancelled/);
  assert.equal(parcelInsuranceStatusView({ ...base, insuranceStatus: 'refund_failed' })?.tone, 'warning');
});

test('detail: nothing shown when the sender did not buy cover (or an older server)', () => {
  assert.equal(parcelInsuranceStatusView({ insuranceOpted: false, insuranceStatus: 'declined' }), null);
  assert.equal(parcelInsuranceStatusView({ insuranceStatus: 'none' }), null);
  assert.equal(parcelInsuranceStatusView({}), null);
  assert.equal(parcelInsuranceStatusView({ insuranceOpted: true, insuranceStatus: 'something_new' }), null);
});
