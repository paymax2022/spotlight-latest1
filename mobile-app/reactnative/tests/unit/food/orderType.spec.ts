// FOOD-UAT-D-007 order-type UX logic. Backend dependency: W6-B order_type
// foundation (backend/internal/restaurant/order_types.go); network calls are not
// exercised here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  availableChoices, buildPickupSlots, canSignalArrival, dineInTableNumber, fulfilmentHeadline,
  isSlotValid, merchantActions, toOrderType, validateDineIn, SLOT_WINDOW_MS,
} from '@/features/food/orderType';
import { mapOrder } from '@/features/food/normalize';

const now = new Date('2026-10-20T10:07:00.000Z');

describe('availableChoices / toOrderType', () => {
  it('hides dine-in unless enabled', () => {
    assert.deepEqual(availableChoices({}), ['delivery', 'pickup']);
    assert.deepEqual(availableChoices({ dineInEnabled: true }), ['delivery', 'pickup', 'dine_in']);
  });
  it('maps choices to wire order types', () => {
    assert.equal(toOrderType('delivery', false), 'delivery');
    assert.equal(toOrderType('pickup', false), 'pickup_now');
    assert.equal(toOrderType('pickup', true), 'pickup_scheduled');
    assert.equal(toOrderType('dine_in', true), 'dine_in');
  });
});

describe('buildPickupSlots', () => {
  const slots = buildPickupSlots(now);
  it('uses 15-minute increments with a lead time, within 24h', () => {
    assert.ok(slots.length > 90);
    assert.ok(slots.every((d) => d.getTime() % (15 * 60_000) === 0));
    assert.ok(slots[0].getTime() >= now.getTime() + 15 * 60_000);
    assert.ok(slots.every((d) => isSlotValid(d, now)));
    assert.ok(slots[slots.length - 1].getTime() <= now.getTime() + SLOT_WINDOW_MS);
  });
  it('respects store hours', () => {
    const open = buildPickupSlots(now, (d) => d.getUTCHours() >= 12 && d.getUTCHours() < 14);
    assert.ok(open.length > 0 && open.every((d) => d.getUTCHours() === 12 || d.getUTCHours() === 13));
  });
  it('rejects past and >24h slots', () => {
    assert.equal(isSlotValid(new Date(now.getTime() - 1), now), false);
    assert.equal(isSlotValid(new Date(now.getTime() + SLOT_WINDOW_MS + 1), now), false);
  });
});

describe('dine-in', () => {
  it('validates party size', () => {
    assert.equal(validateDineIn({ partySize: 2 }), null);
    assert.ok(validateDineIn({ partySize: 0 }));
    assert.ok(validateDineIn({ partySize: 99 }));
  });
  it('always yields a non-empty table_number within 20 chars', () => {
    assert.equal(dineInTableNumber({ partySize: 4 }), 'Party of 4');
    assert.equal(dineInTableNumber({ partySize: 4, tablePreference: ' patio ' }), 'patio');
    assert.ok(dineInTableNumber({ partySize: 4, tablePreference: 'x'.repeat(40) }).length <= 20);
  });
  it('headlines table assignment', () => {
    assert.equal(fulfilmentHeadline({ orderType: 'dine_in', status: 'accepted', tableNumber: '7' }), 'Table assigned: 7');
  });
});

describe('merchantActions', () => {
  it('pickup: verify only when ready, no rider', () => {
    assert.equal(merchantActions({ orderType: 'pickup_now', status: 'ready' }).canVerifyCode, true);
    assert.equal(merchantActions({ orderType: 'pickup_now', status: 'preparing' }).canVerifyCode, false);
    assert.equal(merchantActions({ orderType: 'pickup_scheduled', status: 'ready' }).showRider, false);
  });
  it('dine-in: serve then close', () => {
    assert.equal(merchantActions({ orderType: 'dine_in', status: 'preparing' }).canServe, true);
    assert.equal(merchantActions({ orderType: 'dine_in', status: 'served' }).canClose, true);
    assert.equal(merchantActions({ orderType: 'dine_in', status: 'closed' }).canAssignTable, false);
  });
  it('delivery keeps the rider workflow and none of the new actions', () => {
    const a = merchantActions({ orderType: 'delivery', status: 'ready' });
    assert.deepEqual([a.canVerifyCode, a.canAssignTable, a.canServe, a.canClose, a.showRider], [false, false, false, false, true]);
  });
});

describe('canSignalArrival / mapOrder', () => {
  it('only for pickup orders not yet signalled', () => {
    assert.equal(canSignalArrival({ orderType: 'pickup_now', status: 'ready' }), true);
    assert.equal(canSignalArrival({ orderType: 'pickup_now', status: 'ready', arrivedAt: 'x' }), false);
    assert.equal(canSignalArrival({ orderType: 'delivery', status: 'ready' }), false);
  });
  it('maps snake_case order-type fields and defaults to delivery', () => {
    const o = mapOrder({ order_type: 'dine_in', table_number: '7', scheduled_for: null });
    assert.equal(o.orderType, 'dine_in');
    assert.equal(o.tableNumber, '7');
    assert.equal(mapOrder({}).orderType, 'delivery');
  });
});
