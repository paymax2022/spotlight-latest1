// Instalment compliance — is this learner up to date, or in arrears?
//
// Derived on read, never stored. A stored "overdue" flag becomes wrong the
// moment a due date passes with nobody looking at it, and the repair job for
// that is worse than the computation.
//
// Money note: academy amounts are NAIRA (these tables predate the kobo
// convention used across finance). Nothing here is multiplied by 100.

export type ComplianceState = 'paid_up' | 'on_track' | 'due_soon' | 'overdue' | 'no_schedule';

export interface InstalmentLike {
  installment_number?: number | null;
  amount_ngn?: number | string | null;
  due_date?: string | null;
  paid_at?: string | null;
  status?: string | null;
}

export interface ComplianceSummary {
  state: ComplianceState;
  /** Instalments past their due date and still unsettled. */
  overdueCount: number;
  /** Naira still owed across every unsettled instalment. */
  outstandingNgn: number;
  /** Naira owed on the OVERDUE ones only — the arrears figure. */
  arrearsNgn: number;
  /** Days past due on the oldest unpaid instalment; 0 when nothing is late. */
  daysLate: number;
  /** The next instalment falling due, if any. */
  nextDueDate: string | null;
  nextDueNgn: number;
  paidCount: number;
  totalCount: number;
}

/** 'waived' settles an instalment without payment — an admin decision, not a debt. */
const SETTLED = new Set(['paid', 'waived']);

const DAY = 24 * 60 * 60 * 1000;

/** Whole days between two dates, floored, never negative. */
function daysBetween(later: number, earlier: number): number {
  return Math.max(0, Math.floor((later - earlier) / DAY));
}

/**
 * `now` is injected rather than read from the clock so this is testable and so a
 * caller can ask "what did compliance look like on the invoice date".
 */
export function summariseCompliance(
  payments: InstalmentLike[],
  now: Date = new Date(),
): ComplianceSummary {
  const total = payments.length;
  if (total === 0) {
    return {
      state: 'no_schedule', overdueCount: 0, outstandingNgn: 0, arrearsNgn: 0,
      daysLate: 0, nextDueDate: null, nextDueNgn: 0, paidCount: 0, totalCount: 0,
    };
  }

  const settled = payments.filter((p) => SETTLED.has(String(p.status ?? '')));
  const unsettled = payments
    .filter((p) => !SETTLED.has(String(p.status ?? '')))
    .sort((a, b) => Number(a.installment_number ?? 0) - Number(b.installment_number ?? 0));

  if (unsettled.length === 0) {
    return {
      state: 'paid_up', overdueCount: 0, outstandingNgn: 0, arrearsNgn: 0,
      daysLate: 0, nextDueDate: null, nextDueNgn: 0,
      paidCount: settled.length, totalCount: total,
    };
  }

  const nowMs = now.getTime();
  const amount = (p: InstalmentLike) => Number(p.amount_ngn ?? 0);

  // An instalment with no due date cannot be late — treat it as scheduled, not
  // overdue, rather than inventing a deadline nobody agreed to.
  const dueMs = (p: InstalmentLike) => {
    if (!p.due_date) return null;
    const t = new Date(p.due_date).getTime();
    return Number.isNaN(t) ? null : t;
  };

  const overdue = unsettled.filter((p) => {
    const d = dueMs(p);
    return d !== null && d < nowMs;
  });

  const outstandingNgn = unsettled.reduce((n, p) => n + amount(p), 0);
  const arrearsNgn = overdue.reduce((n, p) => n + amount(p), 0);

  const oldestOverdueMs = overdue
    .map(dueMs)
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b)[0];

  const next = unsettled[0];
  const nextMs = dueMs(next);

  let state: ComplianceState;
  if (overdue.length > 0) {
    state = 'overdue';
  } else if (nextMs !== null && nextMs - nowMs <= 7 * DAY) {
    // A week's notice: enough to act on, short enough to still mean something.
    state = 'due_soon';
  } else {
    state = 'on_track';
  }

  return {
    state,
    overdueCount: overdue.length,
    outstandingNgn: Math.round(outstandingNgn * 100) / 100,
    arrearsNgn: Math.round(arrearsNgn * 100) / 100,
    daysLate: oldestOverdueMs === undefined ? 0 : daysBetween(nowMs, oldestOverdueMs),
    nextDueDate: next.due_date ?? null,
    nextDueNgn: amount(next),
    paidCount: settled.length,
    totalCount: total,
  };
}
