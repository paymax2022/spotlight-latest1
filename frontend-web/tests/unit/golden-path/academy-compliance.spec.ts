/**
 * Instalment compliance.
 *
 * The arrears figure drives what an applicant is told they owe and what an admin
 * chases, so the edge cases matter more than the happy path: a waived instalment
 * is not a debt, an instalment with no due date cannot be late, and "due soon"
 * must not quietly become "overdue" a day early.
 *
 * `now` is injected throughout — a test that depends on the wall clock is a test
 * that fails at midnight.
 */
import { describe, it, expect } from 'vitest';
import { summariseCompliance } from '@/src/server/services/academy/compliance';

const NOW = new Date('2026-06-15T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString().slice(0, 10);

const inst = (o: Partial<{ n: number; amt: number; due: string | null; status: string }>) => ({
  installment_number: o.n ?? 1,
  amount_ngn: o.amt ?? 10000,
  due_date: o.due === undefined ? day(30) : o.due,
  status: o.status ?? 'pending',
  paid_at: o.status === 'paid' ? NOW.toISOString() : null,
});

describe('summariseCompliance', () => {
  it('reports no_schedule when there are no instalments', () => {
    const c = summariseCompliance([], NOW);
    expect(c.state).toBe('no_schedule');
    expect(c.outstandingNgn).toBe(0);
  });

  it('reports paid_up when everything is settled', () => {
    const c = summariseCompliance(
      [inst({ n: 1, status: 'paid' }), inst({ n: 2, status: 'paid' })], NOW);
    expect(c.state).toBe('paid_up');
    expect(c.outstandingNgn).toBe(0);
    expect(c.paidCount).toBe(2);
  });

  it('treats a WAIVED instalment as settled, not as a debt', () => {
    // Waiving is an admin decision. Counting it as arrears would chase a learner
    // for money the programme already decided not to collect.
    const c = summariseCompliance(
      [inst({ n: 1, status: 'paid' }), inst({ n: 2, status: 'waived', due: day(-30) })], NOW);
    expect(c.state).toBe('paid_up');
    expect(c.arrearsNgn).toBe(0);
    expect(c.overdueCount).toBe(0);
  });

  it('counts only PAST-DUE unsettled instalments as arrears', () => {
    const c = summariseCompliance([
      inst({ n: 1, amt: 30000, due: day(-10), status: 'pending' }), // late
      inst({ n: 2, amt: 30000, due: day(20), status: 'pending' }),  // not yet due
    ], NOW);
    expect(c.state).toBe('overdue');
    expect(c.overdueCount).toBe(1);
    expect(c.arrearsNgn).toBe(30000);       // only the late one
    expect(c.outstandingNgn).toBe(60000);   // everything still owed
    expect(c.daysLate).toBe(10);
  });

  it('measures daysLate from the OLDEST unpaid instalment', () => {
    const c = summariseCompliance([
      inst({ n: 1, due: day(-40), status: 'pending' }),
      inst({ n: 2, due: day(-5), status: 'pending' }),
    ], NOW);
    expect(c.daysLate).toBe(40);
    expect(c.overdueCount).toBe(2);
  });

  it('does not treat an instalment with no due date as late', () => {
    // Inventing a deadline nobody agreed to would put a learner in arrears for
    // a schedule that was never set.
    const c = summariseCompliance([inst({ n: 1, due: null, status: 'pending' })], NOW);
    expect(c.state).not.toBe('overdue');
    expect(c.overdueCount).toBe(0);
    expect(c.daysLate).toBe(0);
  });

  it('warns due_soon inside a week, and only inside it', () => {
    const soon = summariseCompliance([inst({ n: 1, due: day(3), status: 'pending' })], NOW);
    expect(soon.state).toBe('due_soon');

    const later = summariseCompliance([inst({ n: 1, due: day(20), status: 'pending' })], NOW);
    expect(later.state).toBe('on_track');
  });

  it('reports the NEXT instalment, not the largest or the last', () => {
    const c = summariseCompliance([
      inst({ n: 3, amt: 90000, due: day(60), status: 'pending' }),
      inst({ n: 2, amt: 20000, due: day(30), status: 'pending' }),
      inst({ n: 1, amt: 50000, due: day(10), status: 'pending' }),
    ], NOW);
    expect(c.nextDueNgn).toBe(50000);
    expect(c.nextDueDate).toBe(day(10));
  });

  it('never reports a negative daysLate for a future due date', () => {
    const c = summariseCompliance([inst({ n: 1, due: day(5), status: 'pending' })], NOW);
    expect(c.daysLate).toBe(0);
  });
});
