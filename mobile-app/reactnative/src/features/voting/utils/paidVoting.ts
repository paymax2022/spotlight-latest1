/**
 * Whether a contest has anything a voter can actually BUY.
 *
 * The screen used to gate on `contest.paidVotingEnabled` alone, which the API
 * mapper derives purely from `paid_vote_kobo > 0`. A contest selling only
 * bundles therefore announced "paid voting is unavailable" while its packages
 * were listed on the same screen, and the admin console — which writes a
 * different table entirely — insisted paid voting was switched on.
 *
 * So the question is not "is a flag set" but "is there a price or a package".
 */
export type PaidVotingAvailability = {
  /** `undefined` while packages are still loading — not yet known, not "no". */
  available: boolean | undefined;
  reason: 'per_vote_price' | 'packages' | 'nothing_on_sale' | 'loading';
};

export function getPaidVotingAvailability(
  contest: { paidVotingEnabled?: boolean } | null | undefined,
  packages: unknown[] | null | undefined,
): PaidVotingAvailability {
  if (contest?.paidVotingEnabled === true) {
    return { available: true, reason: 'per_vote_price' };
  }

  // A pending query must not read as "nothing on sale": that flashes a closed
  // banner and then contradicts itself a moment later.
  if (packages === undefined || packages === null) {
    return { available: undefined, reason: 'loading' };
  }

  return packages.length > 0
    ? { available: true, reason: 'packages' }
    : { available: false, reason: 'nothing_on_sale' };
}
