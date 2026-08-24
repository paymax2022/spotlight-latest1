/**
 * Academy money, summarised for the admin console.
 *
 * The admin landing page promised "batches, applications, and training fees" and
 * then showed six tiles of counts and no money at all — a real ₦5,000 application
 * fee and a real ₦50,000 instalment were both recorded correctly and neither was
 * visible anywhere in the console.
 *
 * ── The naira trap ────────────────────────────────────────────────────────────
 * Academy tables predate the platform's kobo convention: `application_fee_paid`,
 * `amount_ngn` and `total_amount_ngn` are all NUMERIC NAIRA. Everything here stays
 * in naira and is never multiplied by 100. Applying the kobo convention would
 * report ₦55,000 as ₦5,500,000.
 *
 * `application_fee_paid` is also NUMERIC (the amount collected), not a boolean —
 * `if (app.application_fee_paid)` is true for any non-zero amount and false for a
 * genuinely free application, which reads like "unpaid".
 */

/** A paid application fee, in naira. `null`/absent means none collected. */
export type FeeRow = { application_fee_paid: number | string | null };

/** One scheduled instalment. Amounts are naira. */
export type InstalmentRow = {
  amount_ngn: number | string | null;
  /** pending | paid | overdue | waived (DB CHECK constraint) */
  status: string | null;
  due_date?: string | null;
  /** active | completed | cancelled — cancelled plans owe nothing. */
  planStatus?: string | null;
};

export type AcademyRevenue = {
  /** Money actually received: application fees + settled instalments. */
  collectedNgn: number;
  applicationFeesNgn: number;
  instalmentsPaidNgn: number;
  /** Still owed: scheduled but unsettled, excluding waived and cancelled plans. */
  outstandingNgn: number;
  /** The part of `outstandingNgn` already past its due date. */
  overdueNgn: number;
};

/** NUMERIC comes back from postgrest as a string; coerce without trusting it. */
function naira(v: number | string | null | undefined): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/**
 * `now` is injected rather than read from the clock so "overdue" is a pure,
 * testable function of the data.
 */
export function summariseAcademyRevenue(
  fees: FeeRow[],
  instalments: InstalmentRow[],
  now: Date = new Date(),
): AcademyRevenue {
  const applicationFeesNgn = fees.reduce((sum, f) => sum + naira(f.application_fee_paid), 0);

  let instalmentsPaidNgn = 0;
  let outstandingNgn = 0;
  let overdueNgn = 0;

  for (const i of instalments) {
    const amount = naira(i.amount_ngn);
    const status = (i.status ?? '').toLowerCase();

    if (status === 'paid') {
      instalmentsPaidNgn += amount;
      continue;
    }
    // Waived is forgiven, not owed; a cancelled plan's schedule is void. Counting
    // either as outstanding would overstate what the academy is actually owed.
    if (status === 'waived') continue;
    if ((i.planStatus ?? '').toLowerCase() === 'cancelled') continue;

    outstandingNgn += amount;
    // Trust the date, not the status: a row only becomes 'overdue' when some job
    // flips it, so a past-due 'pending' row is overdue in fact if not in name.
    if (i.due_date && new Date(i.due_date).getTime() < now.getTime()) overdueNgn += amount;
  }

  return {
    collectedNgn: applicationFeesNgn + instalmentsPaidNgn,
    applicationFeesNgn,
    instalmentsPaidNgn,
    outstandingNgn,
    overdueNgn,
  };
}

/** ₦55,000 — no decimals, since academy amounts are whole naira. */
export function formatNaira(amountNgn: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency', currency: 'NGN', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amountNgn);
}
