/**
 * The share pair for a user's OWN referral code, built from whatever the rewards
 * dashboard returned.
 *
 * It lives apart from the screen because the two rules are data rules, not layout:
 * an account with no code must produce nothing at all, and the link that goes out has
 * to carry the code that is on screen — the dashboard read and the code can come from
 * different queries, and a stale pair invites people under someone else's attribution.
 */

/** Where a code sends the person who opens it. The web and mobile invite flows agree on this. */
export const REFERRAL_SHARE_BASE = 'https://spotlight.ng/j';

export type ReferralShare = { code: string; link: string };

/**
 * `null` means there is nothing to show and nothing to share. Codes are stored
 * upper-cased and the attribution lookup resolves them that way, so a legacy row that
 * arrived in lower case is presented the way it actually resolves.
 */
export function referralShare(code?: string | null, link?: string | null): ReferralShare | null {
  const value = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!value) return null;
  const href = typeof link === 'string' ? link.trim() : '';
  return { code: value, link: href.includes(value) ? href : `${REFERRAL_SHARE_BASE}/${value}` };
}
