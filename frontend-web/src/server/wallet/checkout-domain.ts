/**
 * What a checkout top-up was actually buying.
 *
 * The card rail funds the wallet and then spends it (ADR-041), so without this
 * every module checkout lands in the ledger as "Wallet top-up via Paystack" and
 * a statement cannot tell a vote purchase from a food order from someone simply
 * adding money to their wallet.
 */

/** Human labels for the domains that exist today. Unknown domains still work. */
const DOMAIN_LABELS: Record<string, string> = {
  // The domains the app actually passes to usePurchasePayment today.
  vote_purchase:       'vote purchase',
  food_order:          'food order',
  ride:                'ride',
  bills:               'bill payment',
  crowdfunding:        'crowdfunding pledge',
  arena_support:       'arena support',
  marketplace_boost:   'marketplace boost',
  connect_boost:       'profile boost',
  connect_premium:     'premium subscription',
  connect_season_pass: 'season pass',
  // Reached through module-specific card flows rather than the sheet's default
  // rail, but labelled here so they read correctly if they ever route through it.
  academy_tuition:     'Film Academy tuition',
  academy_application: 'Film Academy application fee',
};
/**
 * Accepts a domain only in the shape the app emits — a short lowercase slug.
 *
 * NOT a whitelist: the set of domains grows with every module, and rejecting an
 * unrecognised one would fail a payment over a label. This bounds what can be
 * written and later rendered, nothing more. Anything unusable becomes null,
 * which simply means "unlabelled", never an error.
 */
export function sanitiseCheckoutDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  if (!slug || slug.length > 48) return null;
  return /^[a-z][a-z0-9_]*$/.test(slug) ? slug : null;
}

/** "vote purchase" for a known domain; a readable fallback for anything else. */
export function checkoutDomainLabel(domain: string | null | undefined): string | null {
  if (!domain) return null;
  return DOMAIN_LABELS[domain] ?? domain.replace(/_/g, ' ');
}

/**
 * The description written onto the ledger entry. A funded purchase says what it
 * funded; a standalone top-up keeps the wording it has always had, so existing
 * statements stay consistent.
 */
export function topupDescription(domain: string | null | undefined): string {
  const label = checkoutDomainLabel(domain);
  return label ? `Wallet funding for ${label}` : 'Wallet top-up via Paystack';
}
