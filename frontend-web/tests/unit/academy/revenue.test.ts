import { describe, it, expect } from 'vitest';
import { summariseAcademyRevenue, formatNaira } from '@/src/features/academy/revenue';

// The live row that exposed the gap: Patrick Chig, ₦5,000 application fee plus a
// settled ₦50,000 instalment. Both correct in the database, neither visible in the
// admin console.
const NOW = new Date('2026-08-25T00:00:00Z');

describe('summariseAcademyRevenue', () => {
  it('reports the real ₦55,000 as naira, not kobo', () => {
    const r = summariseAcademyRevenue(
      [{ application_fee_paid: '5000.00' }],
      [{ amount_ngn: '50000.00', status: 'paid' }],
      NOW,
    );
    expect(r.applicationFeesNgn).toBe(5000);
    expect(r.instalmentsPaidNgn).toBe(50000);
    expect(r.collectedNgn).toBe(55000);
    // The trap: applying the kobo convention would report ₦5,500,000.
    expect(r.collectedNgn).not.toBe(5_500_000);
    expect(r.outstandingNgn).toBe(0);
  });

  it('counts a zero fee as unpaid without treating the field as a boolean', () => {
    const r = summariseAcademyRevenue([{ application_fee_paid: 0 }, { application_fee_paid: null }], [], NOW);
    expect(r.applicationFeesNgn).toBe(0);
    expect(r.collectedNgn).toBe(0);
  });

  it('owes what is scheduled and unsettled', () => {
    const r = summariseAcademyRevenue([], [
      { amount_ngn: 25000, status: 'paid' },
      { amount_ngn: 25000, status: 'pending' },
    ], NOW);
    expect(r.instalmentsPaidNgn).toBe(25000);
    expect(r.outstandingNgn).toBe(25000);
  });

  it('does not bill a waived instalment or a cancelled plan', () => {
    const r = summariseAcademyRevenue([], [
      { amount_ngn: 10000, status: 'waived' },
      { amount_ngn: 10000, status: 'pending', planStatus: 'cancelled' },
      { amount_ngn: 10000, status: 'pending', planStatus: 'active' },
    ], NOW);
    // Only the live, active, unforgiven one is owed.
    expect(r.outstandingNgn).toBe(10000);
  });

  it('treats a past-due pending row as overdue even before a job relabels it', () => {
    const r = summariseAcademyRevenue([], [
      { amount_ngn: 30000, status: 'pending', due_date: '2026-08-01' },
      { amount_ngn: 40000, status: 'pending', due_date: '2026-12-01' },
    ], NOW);
    expect(r.outstandingNgn).toBe(70000);
    expect(r.overdueNgn).toBe(30000);   // only the one already past due
  });

  it('never counts overdue money outside outstanding', () => {
    const r = summariseAcademyRevenue([], [
      { amount_ngn: 5000, status: 'overdue', due_date: '2026-01-01' },
    ], NOW);
    expect(r.overdueNgn).toBeLessThanOrEqual(r.outstandingNgn);
  });

  it('survives malformed numerics rather than reporting NaN', () => {
    const r = summariseAcademyRevenue(
      [{ application_fee_paid: 'not-a-number' }],
      [{ amount_ngn: undefined as never, status: 'paid' }],
      NOW,
    );
    expect(r.collectedNgn).toBe(0);
    expect(Number.isNaN(r.collectedNgn)).toBe(false);
  });
});

describe('formatNaira', () => {
  it('renders whole naira', () => {
    expect(formatNaira(55000).replace(/ /g, ' ')).toMatch(/55,000/);
    expect(formatNaira(55000)).not.toMatch(/\.00/);
  });
});
