// Earn Hub headline counts, mapped from GET /me/dashboard.
//
// invited_count / activated_count are LIVE on the server. active_referral_count is
// the tier input and only changes after the nightly recalc, so it is the fallback
// for an older backend that does not send the live fields, never the first choice:
// the screen used to show only that, so a referral who had just joined and bought
// something never appeared on the referrer's account.

export interface DashboardCountsInput {
  active_referral_count?: number | null;
  invited_count?: number | null;
  activated_count?: number | null;
}

export interface HomeCounts {
  /** People who joined with this referrer's code; null when the backend does not report it. */
  invitesSent: number | null;
  signups: number | null;
  activated: number;
}

const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null;

export function homeCounts(d: DashboardCountsInput): HomeCounts {
  const invited = count(d.invited_count);
  return {
    invitesSent: invited,
    signups: invited,
    activated: count(d.activated_count) ?? count(d.active_referral_count) ?? 0,
  };
}
