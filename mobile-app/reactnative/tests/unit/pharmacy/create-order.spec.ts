// createOrder() must unwrap the Go handler's {success, order} envelope and
// map its snake_case Order/OrderLine shape onto the mobile PharmacyOrder/
// CartLine types — see backend/internal/health/pharmacy/handler.go CreateOrder
// and model.go Order/OrderLine. Before this fix, createOrder() typed the
// response as a bare PharmacyOrder and returned the envelope itself, so every
// field a caller read off the "order" (id, status, lines, totals…) was
// undefined at runtime despite payment already being HELD (HL-9).
//
// Run: node --experimental-strip-types --import ./tests/unit/pharmacy/register-pharmacy-test-hooks.mjs --test "tests/unit/pharmacy/*.spec.ts"
// (that entry point sets EXPO_PUBLIC_HEALTH_USE_MOCK=false before this file's
// imports are evaluated — setting it here would be too late, since ESM hoists
// imports above any top-level statement in this file.)

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOrder } from '@/features/health/pharmacy/api';
import type { CreateOrderInput } from '@/features/health/pharmacy/types';
import { __setPost, __reset, __calls } from './stub-api-client';

// prescription_id is non-null here because it must be: HL-3 (service.go
// CreateOrder, ~line 525) rejects any order with an Rx-required line unless a
// PrescriptionID was supplied, so an order carrying a rx_required line can
// never come back with a null prescription_id — encoding that combination
// here would test a state the backend cannot produce.
const BACKEND_ORDER = {
  id: 'ord_abc123',
  patient_id: 'pat_1',
  pharmacy_provider_id: 'ph_9',
  prescription_id: 'rx_verified_1',
  state: 'CONFIRMED',
  fulfilment_method: 'DELIVERY',
  total_kobo: 970000,
  escrow_id: 'esc_1',
  delivery_ref: null,
  pickup_code: null,
  search_event_id: null,
  idempotency_key: 'idem-1',
  lines: [
    {
      id: 'ln_1',
      order_id: 'ord_abc123',
      product_id: 'prod_lisin',
      product_name: 'Lisinopril',
      rx_required: true,
      quantity: 1,
      unit_price_kobo: 420000,
      line_total_kobo: 420000,
    },
    {
      id: 'ln_2',
      order_id: 'ord_abc123',
      product_id: 'prod_para',
      product_name: 'Paracetamol',
      rx_required: false,
      quantity: 2,
      unit_price_kobo: 65000,
      line_total_kobo: 130000,
    },
  ],
  created_at: '2026-09-08T10:00:00.000Z',
};

const INPUT: CreateOrderInput = {
  pharmacyId: 'ph_9',
  fulfilment: 'delivery',
  lines: [
    { productId: 'prod_lisin', name: 'Lisinopril', form: '10mg · 30 tablets', priceKobo: 420000, qty: 1, rxRequired: true, imageColor: '#000' },
    { productId: 'prod_para', name: 'Paracetamol', form: '500mg · 24 tablets', priceKobo: 65000, qty: 2, rxRequired: false, imageColor: '#111' },
  ],
  idempotencyKey: 'idem-1',
  rxId: 'rx_verified_1',
};

describe('createOrder — live envelope unwrap + mapping (HL-9)', () => {
  beforeEach(() => {
    __reset();
  });

  it('does not return the raw {success, order} envelope', async () => {
    __setPost(() => ({ success: true, order: BACKEND_ORDER }));
    const order = await createOrder(INPUT);
    // The bug: `data` (the whole envelope) was returned as-is. Guard against
    // regressing back to that by asserting the envelope's own keys are absent.
    assert.equal((order as unknown as { success?: unknown }).success, undefined);
    assert.equal((order as unknown as { order?: unknown }).order, undefined);
  });

  it('maps every field the order-confirmation and tracking screens read', async () => {
    __setPost(() => ({ success: true, order: BACKEND_ORDER }));
    const order = await createOrder(INPUT);

    assert.equal(order.id, 'ord_abc123');
    assert.equal(order.status, 'confirmed');
    assert.equal(order.fulfilment, 'delivery');
    assert.equal(order.pharmacyId, 'ph_9');
    assert.equal(order.totalKobo, 970000);
    assert.equal(order.paymentHeld, true);
    assert.equal(order.requiresRx, true); // a rx_required line ⇒ prescription_id is always set (HL-3)
    assert.equal(order.createdAt, '2026-09-08T10:00:00.000Z');

    assert.equal(order.lines.length, 2);
    assert.equal(order.lines[0].productId, 'prod_lisin');
    assert.equal(order.lines[0].name, 'Lisinopril');
    assert.equal(order.lines[0].priceKobo, 420000);
    assert.equal(order.lines[0].qty, 1);
    assert.equal(order.lines[0].rxRequired, true);
    assert.equal(order.lines[1].productId, 'prod_para');
    assert.equal(order.lines[1].qty, 2);
  });

  it('throws rather than returning undefined-shaped data when the envelope carries no order', async () => {
    __setPost(() => ({ success: true }));
    await assert.rejects(() => createOrder(INPUT));
  });

  it('still sends the Idempotency-Key header on the real request', async () => {
    __setPost(() => ({ success: true, order: BACKEND_ORDER }));
    await createOrder(INPUT);
    const [call] = __calls();
    assert.equal(call.method, 'post');
    assert.equal((call.config as { headers?: Record<string, string> })?.headers?.['Idempotency-Key'], 'idem-1');
  });
});
