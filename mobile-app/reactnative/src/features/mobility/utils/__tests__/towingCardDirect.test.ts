// Pure-logic unit test for the TOWING card-direct helpers — run with:
//   node --experimental-strip-types --test src/features/mobility/utils/__tests__/towingCardDirect.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTowingCardDirectBody,
  mapTowingServiceType,
  normalizeTowingStatus,
  towingCardDirectResolverRoute,
  towingCardDirectStatusPath,
  TOWING_CARD_DIRECT_BASE,
} from '../towingCardDirect.ts';
import { CARD_DIRECT_KEY_RE } from '../cardDirect.ts';

const pickup = { address: '3rd Mainland Bridge', lat: 6.5, lng: 3.4 };
const dest = { address: 'AutoWorks Garage, Ikeja', lat: 6.6, lng: 3.35 };
const base = { serviceType: 'flatbed', issue: 'breakdown', vehicleType: 'sedan', pickup, dest } as const;

test('the card-direct body NEVER carries an amount — the server owns the price', () => {
  const body = buildTowingCardDirectBody({ ...base, email: 'a@b.test', callbackUrl: 'https://cb' });
  for (const k of Object.keys(body)) {
    assert.ok(!/amount|total|fare|price|kobo/i.test(k), `unexpected money field "${k}"`);
  }
  assert.equal('payment_method' in body, false);
  assert.equal('photo_url' in body, false);
});

test('body is snake_case and uses the BACKEND field names (issue_type, not issue)', () => {
  const body = buildTowingCardDirectBody(base);
  assert.deepEqual(Object.keys(body).sort(), ['dest', 'issue_type', 'pickup', 'service_type', 'vehicle_type']);
  assert.equal(body.issue_type, 'breakdown');
  assert.equal(body.service_type, 'flatbed');
  assert.equal(body.vehicle_type, 'sedan');
  assert.deepEqual(body.dest, dest);
});

test('gateway-only fields appear only when given', () => {
  const body = buildTowingCardDirectBody(base);
  assert.equal('email' in body, false);
  assert.equal('callback_url' in body, false);
  assert.equal(buildTowingCardDirectBody({ ...base, email: 'a@b.test' }).email, 'a@b.test');
  assert.equal(buildTowingCardDirectBody({ ...base, callbackUrl: 'https://cb' }).callback_url, 'https://cb');
});

test('service types are mapped onto the values the database accepts', () => {
  // towing_jobs.service_type CHECK: tow, flatbed, jumpstart, tire_change, fuel, battery, unlock, mechanic
  const allowed = new Set(['tow', 'flatbed', 'jumpstart', 'tire_change', 'fuel', 'battery', 'unlock', 'mechanic']);
  const issues = ['breakdown', 'accident', 'flat_tyre', 'no_fuel', 'battery', 'locked_out'] as const;
  for (const s of ['flatbed', 'wheel_lift', 'heavy_duty', 'roadside'] as const) {
    for (const i of issues) assert.ok(allowed.has(mapTowingServiceType(s, i)), `${s}/${i}`);
  }
  assert.equal(mapTowingServiceType('flatbed', 'breakdown'), 'flatbed');
  assert.equal(mapTowingServiceType('wheel_lift', 'accident'), 'tow');
  assert.equal(mapTowingServiceType('heavy_duty', 'breakdown'), 'tow');
  assert.equal(mapTowingServiceType('roadside', 'battery'), 'battery');
  assert.equal(mapTowingServiceType('roadside', 'no_fuel'), 'fuel');
  assert.equal(mapTowingServiceType('roadside', 'flat_tyre'), 'tire_change');
  assert.equal(mapTowingServiceType('roadside', 'locked_out'), 'unlock');
  assert.equal(mapTowingServiceType('roadside', 'breakdown'), 'mechanic');
});

test('roadside sends no destination; tow services send one', () => {
  const road = buildTowingCardDirectBody({ ...base, serviceType: 'roadside', issue: 'battery', dest: null });
  assert.equal(road.service_type, 'battery');
  assert.equal(road.dest, null);
  assert.deepEqual(buildTowingCardDirectBody({ ...base, serviceType: 'wheel_lift' }).dest, dest);
});

test('a tow service without a destination is refused client-side (server would 400 after a wasted round trip)', () => {
  assert.throws(() => buildTowingCardDirectBody({ ...base, serviceType: 'flatbed', dest: null }), /destination/i);
  assert.throws(() => buildTowingCardDirectBody({ ...base, serviceType: 'heavy_duty', dest: null }), /destination/i);
});

test('status path url-encodes the reference (it contains a colon) and the resolver route matches the screen', () => {
  assert.equal(TOWING_CARD_DIRECT_BASE, '/mobility/towing/paystack');
  assert.equal(
    towingCardDirectStatusPath('towingorder:towing-paystack-1-abc'),
    '/mobility/towing/paystack/towingorder%3Atowing-paystack-1-abc/status',
  );
  assert.equal(towingCardDirectResolverRoute('towingorder:k'), '/mobility/paystack/towing/towingorder%3Ak');
});

test('the client key shape satisfies the server key pattern', () => {
  const key = `towing-paystack-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  assert.ok(CARD_DIRECT_KEY_RE.test(key), key);
});

test('normalizeTowingStatus exposes the domain entity id as towingJobId', () => {
  const s = normalizeTowingStatus({ reference: 'towingorder:k', status: 'confirmed', amountKobo: 845_000, towingJobId: 'j-1' });
  assert.deepEqual(s, { reference: 'towingorder:k', status: 'confirmed', amountKobo: 845_000, towingJobId: 'j-1' });
});
