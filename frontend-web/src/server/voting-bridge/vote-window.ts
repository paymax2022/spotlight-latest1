// Timezone-correct day-bucket + reset math for free voting.
//
// The protected free-vote.service.ts computes its daily bucket in UTC
// (getVoteDateUTC), which rolls the "day" at 00:00 UTC and therefore resets
// free votes at the wrong wall-clock time for any non-UTC contest (defect
// D-001 → FV-003, EC-001, EC-002). The voting-bridge computes the day bucket
// HERE, in the contest's configured timezone, and passes it into the atomic
// claim RPC so both the cap check and the reset boundary are correct.
//
// Uses the Intl timezone database, so DST transitions are handled correctly.

/** Local calendar date ('YYYY-MM-DD') for `at` in `timeZone`. Falls back to UTC
 *  when the timezone is empty or invalid (never throws). */
export function resolveVoteDate(at: Date, timeZone: string | null | undefined): string {
  if (timeZone) {
    try {
      // en-CA renders as YYYY-MM-DD.
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(at);
    } catch {
      // Invalid timeZone → fall through to UTC.
    }
  }
  return at.toISOString().split('T')[0];
}

/** Milliseconds to add to a UTC instant to get wall-clock time in `timeZone`
 *  at that instant (i.e. the zone's offset, DST-aware). 0 on invalid zone. */
function timeZoneOffsetMs(at: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(at);

    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;

    const asUtc = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second),
    );
    return asUtc - at.getTime();
  } catch {
    return 0;
  }
}

/** The instant of the next local midnight strictly after `at`, as an ISO string.
 *  This is the free-vote reset boundary the client shows the voter (FV-003). */
export function nextLocalMidnightIso(at: Date, timeZone: string | null | undefined): string {
  const dateStr = resolveVoteDate(at, timeZone); // local Y-M-D of `at`
  const [y, m, d] = dateStr.split('-').map(Number);

  // Refine the offset at the target instant so DST transition days are correct.
  let offset = timeZone ? timeZoneOffsetMs(at, timeZone) : 0;
  let nextMidnightUtc = Date.UTC(y, m - 1, d + 1, 0, 0, 0) - offset;
  if (timeZone) {
    offset = timeZoneOffsetMs(new Date(nextMidnightUtc), timeZone);
    nextMidnightUtc = Date.UTC(y, m - 1, d + 1, 0, 0, 0) - offset;
  }
  return new Date(nextMidnightUtc).toISOString();
}
