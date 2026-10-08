// Pure-logic unit test for the CAR HIRE card-direct helpers — run with:
//   node --experimental-strip-types --test src/features/mobility/utils/__tests__/carhireCardDirect.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCarHireCardDirectBody,
  canCancelCarHire,
  canEndCarHire,
  canExtendCarHire,
  carHireCardDirectResolverRoute,
  carHireCardDirectStatusPath,
  carHireDepositCopy,
  carHireRefundCopy,
  normalizeCarHireBooking,
  normalizeCarHireStatus,
  CARHIRE_CARD_DIRECT_BASE,
} from '../carhireCardDirect.ts';
import { CARD_DIRECT_KEY_RE } from '../cardDirect.ts';

const base = {
  hireType: 'daily',
  vehicleClass: 'executive',
  startAt: '2026-11-01T08:00:00.000Z',
  durationHours: 8,
  chauffeur: true,
} as const;

test('the card-direct body NEVER carries an amount — the server owns fare + deposit', () => {
  const body = buildCarHireCardDirectBody({ ...base, email: 'a@b.test', callbackUrl: 'https://cb', pickupAddress: 'Ikeja' });
  for (const k of Object.keys(body)) {
    assert.ok(!/amount|total|fare|price|kobo|deposit/i.test(k), `unexpected money field "${k}"`);
  }
  assert.equal('payment_method' in body, false);
  assert.equal('idempotency_key' in body, false, 'the key is a header, never a body field');
});

test('body is snake_case with the BACKEND names', () => {
  const body = buildCarHireCardDirectBody(base);
  assert.deepEqual(Object.keys(body).sort(), ['chauffeur', 'duration_hours', 'hire_type', 'start_at', 'vehicle_class']);
  assert.equal(body.hire_type, 'daily');
  assert.equal(body.vehicle_class, 'executive');
  assert.equal(body.duration_hours, 8);
  assert.equal(body.start_at, '2026-11-01T08:00:00.000Z');
});

test('gateway-only and optional fields appear only when given', () => {
  const body = buildCarHireCardDirectBody({ ...base, email: 'a@b.test', callbackUrl: 'https://cb', pickupAddress: 'Ikeja', specialRequest: 'child seat' });
  assert.equal(body.email, 'a@b.test');
  assert.equal(body.callback_url, 'https://cb');
  assert.equal(body.pickup_address, 'Ikeja');
  assert.equal(body.special_request, 'child seat');
});

test('the body builder refuses what the server would refuse (before a gateway round trip)', () => {
  assert.throws(() => buildCarHireCardDirectBody({ ...base, durationHours: 0 }));
  assert.throws(() => buildCarHireCardDirectBody({ ...base, durationHours: 721 }));
  assert.throws(() => buildCarHireCardDirectBody({ ...base, durationHours: 2.5 }));
  assert.throws(() => buildCarHireCardDirectBody({ ...base, startAt: 'tomorrow' }));
  assert.throws(() => buildCarHireCardDirectBody({ ...base, hireType: 'weekly' as never }));
});

test('paths and resolver route are service-specific and URL-safe', () => {
  assert.equal(CARHIRE_CARD_DIRECT_BASE, '/mobility/car-hire/paystack');
  assert.equal(carHireCardDirectStatusPath('carhireorder:abc'), '/mobility/car-hire/paystack/carhireorder%3Aabc/status');
  assert.equal(carHireCardDirectResolverRoute('carhireorder:abc'), '/mobility/paystack/carhire/carhireorder%3Aabc');
  assert.ok(CARD_DIRECT_KEY_RE.test('carhire-paystack-1700000000-abcd1234'));
});

test('server status → client status ("bookingId" is the car-hire entity key)', () => {
  assert.deepEqual(
    normalizeCarHireStatus({ reference: 'r', status: 'confirmed', amountKobo: 5, bookingId: 'b1' }),
    { reference: 'r', status: 'confirmed', amountKobo: 5, bookingId: 'b1' },
  );
});

test('a card-funded booking can never be extended; a wallet (or unknown-rail) one keeps its behaviour', () => {
  assert.equal(canExtendCarHire({ phase: 'active', fundingRail: 'card' }), false);
  assert.equal(canExtendCarHire({ phase: 'extended', fundingRail: 'card' }), false);
  assert.equal(canExtendCarHire({ phase: 'confirmed', fundingRail: 'card' }), false);
  assert.equal(canExtendCarHire({ phase: 'active', fundingRail: 'wallet' }), true);
  assert.equal(canExtendCarHire({ phase: 'active' }), true);
  assert.equal(canExtendCarHire({ phase: 'completed', fundingRail: 'wallet' }), false);
});

test('cancel is offered only before activation', () => {
  assert.equal(canCancelCarHire({ phase: 'confirmed' }), true);
  for (const p of ['active', 'extended', 'completed', 'cancelled'] as const) {
    assert.equal(canCancelCarHire({ phase: p }), false, p);
  }
});

test('deposit copy never claims the money is back until the backend says so', () => {
  const claims = /refunded|has been returned|is back|returned to your/i;
  for (const depositStatus of ['held', 'returning'] as const) {
    for (const phase of ['confirmed', 'active', 'completed'] as const) {
      const t = carHireDepositCopy({ fundingRail: 'card', phase, depositStatus, depositKobo: 500_000 });
      assert.ok(!claims.test(t), `"${t}" (${phase}/${depositStatus}) claims money is back`);
    }
  }
  // 'returning' on a completed card booking says it is on its way, honestly.
  const returning = carHireDepositCopy({ fundingRail: 'card', phase: 'completed', depositStatus: 'returning', depositKobo: 500_000 });
  assert.match(returning, /on its way|being returned|being sent/i);
  // 'returned' = the refund was SENT; banks take days.
  const sent = carHireDepositCopy({ fundingRail: 'card', phase: 'completed', depositStatus: 'returned', depositKobo: 500_000 });
  assert.match(sent, /sent back to your card/i);
  assert.match(sent, /days/i);
  assert.ok(!/wallet/i.test(sent), 'a card refund must never say wallet');
  // Card deposits are never described as wallet money, in any state.
  for (const ds of ['held', 'returning', 'returned'] as const) {
    assert.ok(!/wallet/i.test(carHireDepositCopy({ fundingRail: 'card', phase: 'completed', depositStatus: ds, depositKobo: 1 })), ds);
  }
  // wallet keeps its historical wording
  assert.match(carHireDepositCopy({ fundingRail: 'wallet', phase: 'completed', depositStatus: 'returned', depositKobo: 1 }), /wallet/i);
});

test('the held-deposit line says it is returned to the SAME CARD on completion', () => {
  const t = carHireDepositCopy({ fundingRail: 'card', phase: 'active', depositStatus: 'held', depositKobo: 500_000 });
  assert.match(t, /card/i);
  assert.match(t, /₦5,000|5,000/);
});

test('cancelled copy: pending is "being refunded", refunded says sent to the card + days', () => {
  assert.match(carHireRefundCopy('pending', 'card'), /being refunded|on its way|being processed/i);
  assert.ok(!/has been refunded|is back/i.test(carHireRefundCopy('pending', 'card')));
  const done = carHireRefundCopy('refunded', 'card');
  assert.match(done, /card/i);
  assert.match(done, /days/i);
  assert.equal(carHireRefundCopy('none', 'card'), '');
  assert.match(carHireRefundCopy('refunded', 'wallet'), /wallet/i);
});

test('server booking detail is normalised to the screen model (status → phase, rail/deposit state kept)', () => {
  const b = normalizeCarHireBooking({
    id: 'b1', status: 'completed', hireType: 'daily', vehicleClass: 'suv', startAt: '2026-11-01T08:00:00Z',
    durationHours: 8, chauffeur: true, fareKobo: 564_000, depositKobo: 500_000, createdAt: '2026-10-30T00:00:00Z',
    fundingRail: 'card', depositStatus: 'returning', refundStatus: 'none',
  });
  assert.equal(b.phase, 'completed');
  assert.equal(b.fundingRail, 'card');
  assert.equal(b.depositStatus, 'returning');
  assert.equal(b.chauffeurKobo, 0);
  assert.equal(b.currency, 'NGN');
  // already-shaped (mock) bookings pass through untouched
  const m = normalizeCarHireBooking({ id: 'm', phase: 'active', fareKobo: 1, depositKobo: 1, chauffeurKobo: 5 });
  assert.equal(m.phase, 'active');
  assert.equal(m.chauffeurKobo, 5);
});

test('"End hire" on a card hire is offered only once it has started (the server refuses it from confirmed)', () => {
  assert.equal(canEndCarHire({ phase: 'confirmed', fundingRail: 'card' }), false);
  assert.equal(canEndCarHire({ phase: 'active', fundingRail: 'card' }), true);
  assert.equal(canEndCarHire({ phase: 'extended', fundingRail: 'card' }), true);
  assert.equal(canEndCarHire({ phase: 'confirmed', fundingRail: 'wallet' }), true);
  assert.equal(canEndCarHire({ phase: 'completed', fundingRail: 'wallet' }), false);
});
