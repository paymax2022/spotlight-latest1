// The contest schedule and prize: one pure module between the admin form and
// three Postgres columns that nothing could write before it.
//
// public.contests carries start_date / end_date (TIMESTAMPTZ) and prize_pool
// (TEXT) from 20260404210000, and the bridge trigger 20261223000000 mirrors
// start_date/end_date into connect_contests.opens_at/closes_at — which is
// exactly what mobile's getVotingWindow gates on. So the columns were live in
// the read path while the console had no field for them: every contest an admin
// created had NULL bounds, and a missing bound is unconstrained, which means a
// contest became votable the instant it was published and stayed votable after
// its deadline. The prize column fared worse: /api/v1/contests/:id already
// returns it as `prizePool`, so the web detail screen had a slot no writer
// could ever fill.
//
// Kept free of imports (including the Supabase client) so the rules below are
// unit-testable and the same code can serve the create route, the edit route and
// the definition store without a mock.

/** A schedule as the form states it: instants, or null when a field is empty. */
export interface ContestSchedule {
  startDate: string | null;
  endDate: string | null;
  prizePool: string;
  /** Only present when a sent value could not be parsed — see contestScheduleError. */
  invalid?: Array<'startDate' | 'endDate'>;
}

/** The column names contests actually has. A typo here is silent, not loud. */
export interface ContestScheduleColumns {
  start_date: string | null;
  end_date: string | null;
  prize_pool: string;
}

// A date input yields 'YYYY-MM-DD'; an edit round-trip hands back the stored
// instant. Only the bare form gets day-expanded.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read startDate / endDate / prizePool off a request body or a stored
 * definition.
 *
 * Returns null when none of the three keys is PRESENT — distinct from "present
 * and empty". Callers need that distinction: a PATCH that does not know about
 * the schedule must not wipe dates an admin already set, while a form that
 * submits an empty date field means "no deadline".
 *
 * Within a group that is present, the three fields are read together: send only
 * startDate and prizePool reads as ''. That is why the console posts all three on
 * every save, and why a caller that knows one of them should know all three.
 */
export function readContestSchedule(source: Record<string, unknown>): ContestSchedule | null {
  if (!('startDate' in source) && !('endDate' in source) && !('prizePool' in source)) {
    return null;
  }
  const startDate = toInstant(source.startDate, false);
  const endDate = toInstant(source.endDate, true);
  const schedule: ContestSchedule = {
    startDate: startDate.ok,
    endDate: endDate.ok,
    prizePool: String(source.prizePool ?? '').trim(),
  };
  const bad = (['startDate', 'endDate'] as const).filter((f) => !isParseable(source[f]));
  if (bad.length) schedule.invalid = bad;
  return schedule;
}

/**
 * The human-readable refusal for a schedule, or null when it is usable.
 *
 * Order matters: a bad date must be named before the ordering check, because
 * comparing an unparseable bound to a real one would report "end before start"
 * for what is really a malformed field.
 */
export function contestScheduleError(schedule: ContestSchedule): string | null {
  if (schedule.invalid?.includes('startDate')) return 'Contest start date is not a valid date.';
  if (schedule.invalid?.includes('endDate')) return 'Contest end date is not a valid date.';
  if (schedule.startDate && schedule.endDate && Date.parse(schedule.endDate) < Date.parse(schedule.startDate)) {
    return 'The contest end date must be on or after the start date.';
  }
  return null;
}

/** The row write for a schedule. Dates are null, never '', so the mirror's
 *  COALESCE(voting_start_date, start_date) keeps falling through. */
export function contestScheduleColumns(schedule: ContestSchedule): ContestScheduleColumns {
  return {
    start_date: schedule.startDate,
    end_date: schedule.endDate,
    prize_pool: schedule.prizePool,
  };
}

/**
 * Expand a day into an instant.
 *
 * An end date becomes the LAST INSTANT of its day rather than midnight. The form
 * asks for a day, and "ends 24 December" means the 24th is still open: storing
 * 2026-12-24T00:00:00Z would close voting at the start of Christmas Eve and
 * silently cost every contest its final day. A value that already carries a time
 * is kept verbatim — an edit must not move a deadline the admin set precisely.
 */
function toInstant(raw: unknown, endOfDay: boolean): { ok: string | null } {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { ok: null };
  if (DATE_ONLY.test(value)) {
    // The regex accepts the SHAPE of a date; the calendar decides whether that day
    // exists. This is not pedantry: Date.parse('2026-02-30') does not fail, it
    // rolls over to 2 March, so an admin who mistypes a deadline would get a
    // contest ending on a day nobody wrote down.
    const [year, month, day] = value.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return { ok: null };
    return { ok: endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z` };
  }
  const ms = Date.parse(value);
  return { ok: Number.isNaN(ms) ? null : new Date(ms).toISOString() };
}

function isParseable(raw: unknown): boolean {
  const value = typeof raw === 'string' ? raw.trim() : '';
  // Empty means unset, not invalid. Everything else is held to the same rule the
  // write uses — one predicate, so the refusal and the value can never disagree.
  if (!value) return true;
  return toInstant(value, false).ok !== null;
}
