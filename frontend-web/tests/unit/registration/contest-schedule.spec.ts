// The admin contest form's schedule and prize.
//
// Two columns the schema has always had and nothing could write:
// public.contests.start_date / end_date (TIMESTAMPTZ) and prize_pool (TEXT).
// The bridge trigger 20261223000000 copies start_date/end_date into
// connect_contests.opens_at/closes_at, which is what mobile's getVotingWindow
// reads — so a contest created without them opens for voting the moment it is
// published. These functions are the whole contract between the form and those
// columns, which is why the date semantics below are asserted rather than
// assumed.

import { describe, expect, it } from 'vitest';
import {
  contestScheduleColumns,
  contestScheduleError,
  readContestSchedule,
} from '@/src/server/contests/schedule';

describe('readContestSchedule', () => {
  it('reports nothing sent when no schedule key is present', () => {
    // A caller that omits the keys entirely (an unrelated PATCH, a legacy
    // payload) must not clear dates an admin already set.
    expect(readContestSchedule({ title: 'Rising Star' })).toBeNull();
  });

  it('treats a sent-but-empty field as "no date", not as an invalid one', () => {
    const schedule = readContestSchedule({ startDate: '', endDate: '', prizePool: '' });
    expect(schedule).toEqual({ startDate: null, endDate: null, prizePool: '' });
  });

  it('expands a bare date input to the start of that day', () => {
    expect(readContestSchedule({ startDate: '2026-12-01' }))
      .toEqual(expect.objectContaining({ startDate: '2026-12-01T00:00:00.000Z' }));
  });

  it('expands a bare end date to the LAST INSTANT of that day', () => {
    // The whole point of this function. A date input names a day, not a moment:
    // storing 2026-12-24T00:00:00Z would close voting at the START of Christmas
    // Eve, so a contest "ending 24 December" loses its last day.
    expect(readContestSchedule({ endDate: '2026-12-24' }))
      .toEqual(expect.objectContaining({ endDate: '2026-12-24T23:59:59.999Z' }));
  });

  it('keeps a full timestamp the caller already had', () => {
    // Edit-round-trip: the form receives '2026-12-01T09:30:00Z' and must not
    // silently move it to midnight because it looked like a date.
    const schedule = readContestSchedule({
      startDate: '2026-12-01T09:30:00.000Z',
      endDate: '2026-12-24T18:00:00.000Z',
    });
    expect(schedule).toEqual(expect.objectContaining({
      startDate: '2026-12-01T09:30:00.000Z',
      endDate: '2026-12-24T18:00:00.000Z',
    }));
  });

  it('trims the prize and stores free text verbatim', () => {
    // prize_pool is TEXT in the schema, so a prize can read "₦500,000 + a
    // management deal" and no currency parsing may mangle it.
    expect(readContestSchedule({ prizePool: '  ₦500,000 + a management deal  ' }))
      .toEqual(expect.objectContaining({ prizePool: '₦500,000 + a management deal' }));
  });

  it('rejects a value that is not a date instead of writing Invalid Date', () => {
    // Postgres would answer 22P02 ("invalid input syntax for type timestamp")
    // and the route would surface a 500 for what is a form error.
    const schedule = readContestSchedule({ startDate: 'not a date' });
    expect(schedule?.startDate).toBeNull();
    expect(contestScheduleError(schedule!)).toBe('Contest start date is not a valid date.');
  });

  it('rejects a date-shaped value whose day does not exist', () => {
    // 'YYYY-MM-DD' passes the shape test but Date.parse refuses month 13, and an
    // unvalidated expansion would store 2026-13-45T00:00:00.000Z as if it were a
    // real deadline.
    const schedule = readContestSchedule({ endDate: '2026-13-45' });
    expect(schedule?.endDate).toBeNull();
    expect(contestScheduleError(schedule!)).toBe('Contest end date is not a valid date.');
  });

  it('rejects a day that overflows its own month, which Date.parse silently rolls over', () => {
    // The harder half of the same bug, found by the route spec: Date.parse
    // ('2026-02-30') does NOT return NaN — V8 rolls it to 2 March. Without a real
    // calendar check an admin typing 30 February gets a deadline on a day they
    // never wrote, and the refusal above would only cover month 13.
    const schedule = readContestSchedule({ endDate: '2026-02-30' });
    expect(schedule?.endDate).toBeNull();
    expect(contestScheduleError(schedule!)).toBe('Contest end date is not a valid date.');

    // 2026 is not a leap year, so 29 February overflows too.
    expect(readContestSchedule({ startDate: '2026-02-29' })?.startDate).toBeNull();
    // …while a real 29 February stays valid.
    expect(readContestSchedule({ startDate: '2024-02-29' })?.startDate)
      .toBe('2024-02-29T00:00:00.000Z');
  });
});

describe('contestScheduleError', () => {
  it('accepts a contest that has only one of the two dates', () => {
    // An open-ended deadline (start set, no end) is a legitimate contest; the
    // mobile window code already treats a missing bound as unconstrained.
    expect(contestScheduleError({ startDate: '2026-12-01T00:00:00.000Z', endDate: null, prizePool: '' }))
      .toBeNull();
    expect(contestScheduleError({ startDate: null, endDate: '2026-12-24T23:59:59.999Z', prizePool: '' }))
      .toBeNull();
  });

  it('refuses an end before the start', () => {
    expect(contestScheduleError({
      startDate: '2026-12-24T00:00:00.000Z',
      endDate: '2026-12-01T23:59:59.999Z',
      prizePool: '',
    })).toBe('The contest end date must be on or after the start date.');
  });

  it('allows a contest that starts and ends the same day', () => {
    const day = readContestSchedule({ startDate: '2026-12-24', endDate: '2026-12-24' })!;
    expect(contestScheduleError(day)).toBeNull();
  });

  it('says nothing about a prize — it has no ordering to validate', () => {
    expect(contestScheduleError({ startDate: null, endDate: null, prizePool: '£1' })).toBeNull();
  });
});

describe('contestScheduleColumns', () => {
  it('emits the exact Postgres column names the bridge trigger reads', () => {
    // A typo here is invisible in the admin UI and fatal downstream:
    // 20261223000000 mirrors start_date/end_date into connect_contests, and
    // prize_pool is what /api/v1/contests/:id returns as prizePool.
    expect(contestScheduleColumns({
      startDate: '2026-12-01T00:00:00.000Z',
      endDate: '2026-12-24T23:59:59.999Z',
      prizePool: '₦500,000',
    })).toEqual({
      start_date: '2026-12-01T00:00:00.000Z',
      end_date: '2026-12-24T23:59:59.999Z',
      prize_pool: '₦500,000',
    });
  });

  it('writes NULL rather than an empty string for an unset date', () => {
    // '' is not a TIMESTAMPTZ; null is what leaves the mirror's COALESCE chain
    // (voting_start_date, start_date) falling through to the other bound.
    expect(contestScheduleColumns({ startDate: null, endDate: null, prizePool: '' }))
      .toEqual({ start_date: null, end_date: null, prize_pool: '' });
  });
});
