/**
 * Telling a vote purchase apart from a wallet top-up.
 *
 * Since ADR-041 the card rail funds the wallet and then spends it, so without a
 * recorded domain every module checkout lands in the ledger as "Wallet top-up
 * via Paystack" — a customer's statement cannot say where the money went, and
 * neither can an auditor.
 *
 * The rule these protect: a labelled purchase says what it bought, and a
 * genuine top-up is never dressed up as a purchase it was not.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitiseCheckoutDomain,
  checkoutDomainLabel,
  topupDescription,
} from '@/src/server/wallet/checkout-domain';

// Exactly what the app passes to usePurchasePayment today.
const REAL_DOMAINS = [
  'vote_purchase', 'food_order', 'ride', 'bills', 'crowdfunding',
  'arena_support', 'marketplace_boost', 'connect_boost',
  'connect_premium', 'connect_season_pass',
];

describe('sanitiseCheckoutDomain', () => {
  it('accepts every domain the app actually sends', () => {
    for (const d of REAL_DOMAINS) expect(sanitiseCheckoutDomain(d), d).toBe(d);
  });

  it('normalises case and surrounding whitespace', () => {
    expect(sanitiseCheckoutDomain('  Vote_Purchase ')).toBe('vote_purchase');
  });

  it('rejects anything that is not a plain slug, without throwing', () => {
    for (const bad of [
      '', '   ', 'dstv.com', 'vote purchase', '../etc/passwd', '<script>',
      'DROP TABLE', '9lives', '_leading', 'x'.repeat(49),
      null, undefined, 42, {}, [], true,
    ]) {
      expect(sanitiseCheckoutDomain(bad as unknown), JSON.stringify(bad)).toBeNull();
    }
  });

  it('accepts an unknown but well-formed domain — a new module must not fail a payment', () => {
    expect(sanitiseCheckoutDomain('telemedicine_consult')).toBe('telemedicine_consult');
  });
});

describe('topupDescription', () => {
  it('says what a funded purchase bought', () => {
    expect(topupDescription('vote_purchase')).toBe('Wallet funding for vote purchase');
    expect(topupDescription('food_order')).toBe('Wallet funding for food order');
  });

  it('leaves a standalone top-up described exactly as it always was', () => {
    // Existing statements must stay consistent, and money that really is just a
    // top-up must not be labelled as a purchase.
    for (const none of [null, undefined, '']) {
      expect(topupDescription(none)).toBe('Wallet top-up via Paystack');
    }
  });

  it('renders an unknown domain readably rather than dumping the slug', () => {
    expect(topupDescription('telemedicine_consult')).toBe('Wallet funding for telemedicine consult');
  });

  it('gives every real domain a description that names the purchase', () => {
    for (const d of REAL_DOMAINS) {
      const text = topupDescription(d);
      expect(text, d).toMatch(/^Wallet funding for /);
      expect(text, d).not.toBe('Wallet top-up via Paystack');
    }
  });
});

describe('checkoutDomainLabel', () => {
  it('is null when there is no domain, so callers can omit the label entirely', () => {
    expect(checkoutDomainLabel(null)).toBeNull();
    expect(checkoutDomainLabel(undefined)).toBeNull();
  });

  it('labels a vote purchase in words a customer would recognise', () => {
    expect(checkoutDomainLabel('vote_purchase')).toBe('vote purchase');
    expect(checkoutDomainLabel('connect_season_pass')).toBe('season pass');
  });
});
