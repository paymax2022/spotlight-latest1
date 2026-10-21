// FOOD-UAT-C-007 / C-011: server-quote rows, price_changed detection, promo copy.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { quoteRows, isPriceChangedError, promoErrorMessage, pricingSignature, isQuoteExpired } from '@/features/food/quoteFlow';
import type { OrderQuote } from '@/features/food/types';

const q: OrderQuote = {
  subtotalKobo: 1000000, serviceFeeKobo: 50000, deliveryFeeKobo: 120000, surgeBp: 1000, surgeKobo: 12000,
  packagingKobo: 40000, promoDiscountKobo: 100000, tipKobo: 0, totalKobo: 1122000,
  quoteId: 'q1', expiresAt: '2030-01-01T00:00:00Z',
};

describe('quoteRows', () => {
  it('lists every server component and the total', () => {
    const rows = quoteRows(q);
    assert.deepEqual(rows.map((r) => r.key), ['subtotal', 'service', 'delivery', 'surge', 'packaging', 'promo', 'total']);
    assert.equal(rows.find((r) => r.key === 'promo')!.kobo, -100000);
    assert.equal(rows.find((r) => r.key === 'surge')!.label, 'Surge (10%)');
  });
  it('rows reconcile to the server total', () => {
    const sum = quoteRows(q).filter((r) => r.key !== 'total').reduce((n, r) => n + r.kobo, 0);
    assert.equal(sum, q.totalKobo);
  });
  it('omits zero optional charges', () => {
    const rows = quoteRows({ ...q, serviceFeeKobo: 0, surgeKobo: 0, promoDiscountKobo: 0 });
    assert.deepEqual(rows.map((r) => r.key), ['subtotal', 'delivery', 'packaging', 'total']);
  });
});

describe('isPriceChangedError', () => {
  it('matches the stable code', () => {
    assert.equal(isPriceChangedError({ response: { status: 409, data: { code: 'price_changed' } } }), true);
    assert.equal(isPriceChangedError({ code: 'PRICE_CHANGED' }), true);
  });
  it('matches message text only on a conflict-class status', () => {
    assert.equal(isPriceChangedError({ response: { status: 409, data: { error: 'price changed since quote' } } }), true);
    assert.equal(isPriceChangedError({ response: { status: 500, data: { error: 'price changed' } } }), false);
  });
  it('ignores unrelated errors', () => {
    assert.equal(isPriceChangedError(new Error('network')), false);
    assert.equal(isPriceChangedError(null), false);
  });
});

describe('promoErrorMessage', () => {
  it('maps reasons and is null when valid', () => {
    assert.equal(promoErrorMessage({ valid: true }), null);
    assert.match(promoErrorMessage({ valid: false, reason: 'expired' })!, /expired/);
    assert.match(promoErrorMessage({ valid: false, reason: 'not_eligible' })!, /can't be used/);
    assert.match(promoErrorMessage({ valid: false })!, /not valid/);
  });
});

describe('pricingSignature / expiry', () => {
  const base = { restaurantId: 'r', items: [{ itemId: 'a', qty: 1, modifierIds: ['x', 'y'] }], packageCount: 1 };
  it('is stable across modifier order and changes with promo or qty', () => {
    const a = pricingSignature(base);
    assert.equal(a, pricingSignature({ ...base, items: [{ itemId: 'a', qty: 1, modifierIds: ['y', 'x'] }] }));
    assert.notEqual(a, pricingSignature({ ...base, promoCode: 'SAVE' }));
    assert.notEqual(a, pricingSignature({ ...base, items: [{ itemId: 'a', qty: 2, modifierIds: ['x', 'y'] }] }));
  });
  it('treats a past or garbage expiry as expired', () => {
    assert.equal(isQuoteExpired({ expiresAt: '2000-01-01T00:00:00Z' }), true);
    assert.equal(isQuoteExpired({ expiresAt: 'nope' }), true);
    assert.equal(isQuoteExpired({ expiresAt: '2999-01-01T00:00:00Z' }), false);
  });
});
