/**
 * Ledger invariant tests — pure math, no Supabase, no DB.
 *
 * These tests lock in the double-entry balance formula and the kobo validation
 * rules. Any change to ledger.ts that breaks these is a money-path regression.
 */
import { describe, it, expect } from 'vitest';
import {
  computeWalletBalance,
  validateAmountKobo,
  buildIdempotencyKey,
  type LedgerEntryRow,
} from '@/src/server/wallet/ledger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entry(
  type: LedgerEntryRow['type'],
  amount_kobo: number,
): Pick<LedgerEntryRow, 'type' | 'amount_kobo'> {
  return { type, amount_kobo };
}

// ---------------------------------------------------------------------------
// computeWalletBalance — balance formula
// ---------------------------------------------------------------------------

describe('computeWalletBalance — balance formula', () => {
  it('returns 0 for an empty ledger', () => {
    expect(computeWalletBalance([])).toBe(0);
  });

  it('CREDIT increases the balance', () => {
    expect(computeWalletBalance([entry('CREDIT', 100_000)])).toBe(100_000);
  });

  it('DEBIT decreases the balance', () => {
    const entries = [
      entry('CREDIT', 100_000),
      entry('DEBIT', 30_000),
    ];
    expect(computeWalletBalance(entries)).toBe(70_000);
  });

  it('REVERSAL_CREDIT reverses a CREDIT (money returned)', () => {
    // User topped up ₦1,000, then the top-up was reversed
    const entries = [
      entry('CREDIT', 100_000),
      entry('REVERSAL_CREDIT', 100_000),
    ];
    expect(computeWalletBalance(entries)).toBe(0);
  });

  it('REVERSAL_DEBIT reverses a DEBIT (money restored)', () => {
    // User spent ₦300, then got a refund
    const entries = [
      entry('CREDIT', 100_000),
      entry('DEBIT', 30_000),
      entry('REVERSAL_DEBIT', 30_000),
    ];
    expect(computeWalletBalance(entries)).toBe(100_000);
  });

  it('computes the correct balance with all four entry types', () => {
    // +₦1,000 top-up
    // -₦300 spend
    // -₦1,000 top-up reversed
    // +₦300 spend refunded
    // Net = 0
    const entries = [
      entry('CREDIT', 100_000),
      entry('DEBIT', 30_000),
      entry('REVERSAL_CREDIT', 100_000),
      entry('REVERSAL_DEBIT', 30_000),
    ];
    expect(computeWalletBalance(entries)).toBe(0);
  });

  it('handles multiple credits and debits correctly', () => {
    // +₦5,000 + +₦2,000 - ₦1,500 - ₦800 = ₦4,700
    const entries = [
      entry('CREDIT', 500_000),
      entry('CREDIT', 200_000),
      entry('DEBIT', 150_000),
      entry('DEBIT', 80_000),
    ];
    expect(computeWalletBalance(entries)).toBe(470_000);
  });

  it('balance can be negative (overdraft scenario — caller must guard against this)', () => {
    // The pure function does not enforce non-negative; the service layer does
    const entries = [
      entry('CREDIT', 10_000),
      entry('DEBIT', 50_000),
    ];
    expect(computeWalletBalance(entries)).toBe(-40_000);
  });

  it('the formula is commutative — order of entries does not affect result', () => {
    const a = [
      entry('CREDIT', 100_000),
      entry('DEBIT', 30_000),
      entry('REVERSAL_DEBIT', 10_000),
    ];
    const b = [
      entry('REVERSAL_DEBIT', 10_000),
      entry('DEBIT', 30_000),
      entry('CREDIT', 100_000),
    ];
    expect(computeWalletBalance(a)).toBe(computeWalletBalance(b));
  });

  it('CREDIT + REVERSAL_CREDIT = net zero (double-entry self-consistency)', () => {
    const amount = 500_000; // ₦5,000
    const entries = [
      entry('CREDIT', amount),
      entry('REVERSAL_CREDIT', amount),
    ];
    expect(computeWalletBalance(entries)).toBe(0);
  });

  it('DEBIT + REVERSAL_DEBIT = net zero (double-entry self-consistency)', () => {
    const amount = 200_000; // ₦2,000
    // Start with a balance so it does not go negative
    const entries = [
      entry('CREDIT', 500_000),
      entry('DEBIT', amount),
      entry('REVERSAL_DEBIT', amount),
    ];
    expect(computeWalletBalance(entries)).toBe(500_000);
  });
});

// ---------------------------------------------------------------------------
// computeWalletBalance — amount validation
// ---------------------------------------------------------------------------

describe('computeWalletBalance — input validation', () => {
  it('throws when amount_kobo is a float', () => {
    expect(() => computeWalletBalance([entry('CREDIT', 99.99)])).toThrow(/integer/i);
  });

  it('throws when amount_kobo is zero', () => {
    expect(() => computeWalletBalance([entry('CREDIT', 0)])).toThrow(/positive/i);
  });

  it('throws when amount_kobo is negative', () => {
    expect(() => computeWalletBalance([entry('DEBIT', -50_000)])).toThrow(/positive/i);
  });

  it('throws on NaN', () => {
    expect(() => computeWalletBalance([entry('CREDIT', NaN)])).toThrow(/integer/i);
  });
});

// ---------------------------------------------------------------------------
// validateAmountKobo — standalone
// ---------------------------------------------------------------------------

describe('validateAmountKobo', () => {
  it('does not throw for valid positive integers', () => {
    expect(() => validateAmountKobo(1)).not.toThrow();
    expect(() => validateAmountKobo(100_000)).not.toThrow();
    expect(() => validateAmountKobo(500_000_000)).not.toThrow(); // ₦5M in kobo
  });

  it('throws for zero', () => {
    expect(() => validateAmountKobo(0)).toThrow(/positive/i);
  });

  it('throws for negative', () => {
    expect(() => validateAmountKobo(-1)).toThrow(/positive/i);
  });

  it('throws for floats', () => {
    expect(() => validateAmountKobo(0.5)).toThrow(/integer/i);
    expect(() => validateAmountKobo(100.01)).toThrow(/integer/i);
  });

  it('throws for NaN', () => {
    expect(() => validateAmountKobo(NaN)).toThrow(/integer/i);
  });

  it('throws for Infinity', () => {
    expect(() => validateAmountKobo(Infinity)).toThrow(/integer/i);
  });
});

// ---------------------------------------------------------------------------
// buildIdempotencyKey
// ---------------------------------------------------------------------------

describe('buildIdempotencyKey', () => {
  it('produces a deterministic key from operation, ref, and side', () => {
    const key = buildIdempotencyKey('topup', 'PAY_ref_abc123', 'CREDIT');
    expect(key).toBe('topup:PAY_ref_abc123:CREDIT');
  });

  it('credit and debit keys for the same reference are distinct', () => {
    const credit = buildIdempotencyKey('topup', 'PAY_ref_001', 'CREDIT');
    const debit = buildIdempotencyKey('topup', 'PAY_ref_001', 'DEBIT');
    expect(credit).not.toBe(debit);
  });

  it('different operations produce different keys', () => {
    const a = buildIdempotencyKey('topup', 'REF001', 'CREDIT');
    const b = buildIdempotencyKey('vote_purchase', 'REF001', 'CREDIT');
    expect(a).not.toBe(b);
  });
});
