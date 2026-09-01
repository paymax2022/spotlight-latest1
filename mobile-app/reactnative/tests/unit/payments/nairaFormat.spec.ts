// Pure-logic unit tests for rendering a kobo amount as Naira.
// Run: npm run test:payments
//
// The defect: PaymentSheet and the wallet tab each carried their own copy of
// this formatter, both with `minimumFractionDigits: 0`. That trims the trailing
// zero, so ₦13,645.20 rendered as "₦13,645.2" — on the screen where the customer
// authorises the charge, while the checkout summary immediately behind it said
// ₦13,645.20. Two different-looking amounts for one payment.
//
// Both now call src/utils/money.ts. These tests pin the rule there, since that is
// the only place a regression can now come from.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatNaira, nairaStringToKobo } from '@/utils/money';

describe('formatNaira', () => {
  it('keeps the trailing zero on a fractional amount', () => {
    // The regression, exactly as it appeared on the payment sheet.
    assert.equal(formatNaira(1364520), '₦13,645.20');
  });

  it('renders both decimal places for every kobo remainder', () => {
    assert.equal(formatNaira(1364521), '₦13,645.21');
    assert.equal(formatNaira(1364505), '₦13,645.05');
    assert.equal(formatNaira(1364500), '₦13,645.00');
  });

  it('pads a whole-naira amount rather than dropping the decimals', () => {
    assert.equal(formatNaira(40000), '₦400.00');
    assert.equal(formatNaira(0), '₦0.00');
  });

  it('groups thousands', () => {
    assert.equal(formatNaira(13603500), '₦136,035.00');
  });

  it('drops the decimals only when asked explicitly', () => {
    assert.equal(formatNaira(1364520, { decimals: false }), '₦13,645');
  });

  it('renders a negative amount without losing a digit', () => {
    // Documents where the sign lands: the ₦ is prefixed before the locale string,
    // so it reads "₦-13,645.20" rather than "-₦13,645.20". Unconventional, but
    // the digits are intact, which is what this suite is about — left as-is
    // rather than changed on the way past, since nothing asked for it.
    assert.equal(formatNaira(-1364520), '₦-13,645.20');
  });

  it('treats a non-finite amount as zero rather than printing NaN', () => {
    assert.equal(formatNaira(Number.NaN), '₦0.00');
    assert.equal(formatNaira(Number.POSITIVE_INFINITY), '₦0.00');
  });

  it('round-trips through the parser it ships beside', () => {
    // 1364520 kobo → "₦13,645.20" → 1364520 kobo. A formatter that drops a digit
    // breaks this, which is what makes the trailing zero more than cosmetic.
    assert.equal(nairaStringToKobo(formatNaira(1364520)), 1364520);
  });
});
