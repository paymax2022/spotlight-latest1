// Pure-logic tests for the seller-contact links on a marketplace listing.
// The important behaviours: Nigerian numbers in every format sellers type resolve to
// ONE wa.me number, and a mistyped number is refused instead of opening a chat with
// someone else.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { whatsappNumber, whatsappUrl, dialUrl } from '@/features/marketplace/contactLinks';

describe('whatsappNumber', () => {
  const NG = '2348031234567';
  it('normalises every common Nigerian format to the same number', () => {
    for (const raw of ['+2348031234567', '+234 803 123 4567', '2348031234567', '08031234567', '0803 123 4567',
      '0803-123-4567', '8031234567', '002348031234567', '(0803) 123 4567']) {
      assert.equal(whatsappNumber(raw), NG, raw);
    }
  });
  it('keeps a foreign number that carries its own +', () => {
    assert.equal(whatsappNumber('+44 7700 900123'), '447700900123');
  });
  it('refuses things that cannot be a phone number', () => {
    for (const raw of [null, undefined, '', '   ', 'call me', '12', '+', '0', '1'.repeat(16)]) {
      assert.equal(whatsappNumber(raw as string | null | undefined), null, String(raw));
    }
  });
  it('refuses a mistyped Nigerian number rather than guessing', () => {
    assert.equal(whatsappNumber('0803123456'), null); // one digit short
    assert.equal(whatsappNumber('080312345678'), null); // one digit long
    assert.equal(whatsappNumber('+234803123456'), null);
  });
});

describe('whatsappUrl', () => {
  it('builds a wa.me link', () => {
    assert.equal(whatsappUrl('08031234567'), 'https://wa.me/2348031234567');
  });
  it('encodes the pre-filled message', () => {
    assert.equal(
      whatsappUrl('08031234567', 'Hi, is "iPhone 13 & case" still available?'),
      'https://wa.me/2348031234567?text=Hi%2C%20is%20%22iPhone%2013%20%26%20case%22%20still%20available%3F',
    );
  });
  it('omits an empty / whitespace message', () => {
    assert.equal(whatsappUrl('08031234567', '   '), 'https://wa.me/2348031234567');
  });
  it('is null for a bad number', () => {
    assert.equal(whatsappUrl('nope', 'hi'), null);
  });
});

describe('dialUrl', () => {
  it('keeps digits and a leading +, drops formatting', () => {
    assert.equal(dialUrl('+234 (803) 123-4567'), 'tel:+2348031234567');
    assert.equal(dialUrl('0803 123 4567'), 'tel:08031234567');
  });
  it('is null when nothing is dialable', () => {
    assert.equal(dialUrl(''), null);
    assert.equal(dialUrl('n/a'), null);
    assert.equal(dialUrl('+'), null);
    assert.equal(dialUrl(null), null);
  });
});
