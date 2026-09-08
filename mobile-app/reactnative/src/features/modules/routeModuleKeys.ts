// ── Route → registry key ─────────────────────────────────────────────────────
//
// Closes the deep-link gap. Gating the lists (services tab, property hub, home)
// stops a module being DISCOVERED, but a saved link, a push notification or a
// hand-typed URL still lands on the screen. This maps an Expo Router segment path
// onto the module that owns it, so one guard in the root layout covers every
// route instead of 36 per-screen checks.
//
// Matched LONGEST-FIRST, because the tree nests: ['health','lab'] must beat
// ['health'], or publishing the health umbrella would silently publish the lab.
//
// DELIBERATELY PARTIAL, and conservative. A route with no entry is never gated.
// Gating a route wrongly locks users out of a working screen — strictly worse
// than leaving a screen reachable that is merely undiscoverable — so anything
// ambiguous is omitted rather than guessed:
//   • 'services' / '(tabs)' — hubs and navigation, not modules
//   • 'voting', 'arena', 'academy', 'learn', 'invest*', 'crypto', 'stocks',
//     'marketplace', 'connect' — no registry module, or the correspondence is
//     not one-to-one
//   • 'dues', 'properties' — could belong to estate or association; unresolved

/** Segment path → registry key. Order is irrelevant; matching sorts by depth. */
const ROUTE_MODULE_KEYS: { segments: string[]; key: string }[] = [
  // Health — the sub-modules MUST come out ahead of any umbrella entry.
  { segments: ['health', 'pharmacy'], key: 'healthPharmacy' },
  { segments: ['health', 'lab'], key: 'healthLab' },
  { segments: ['health', 'vet'], key: 'healthVet' },
  { segments: ['health', 'consult'], key: 'telemedicine' },
  { segments: ['health', 'triage'], key: 'telemedicine' },

  // Services directory — individual service screens.
  { segments: ['services', 'telemedicine'], key: 'telemedicine' },
  { segments: ['services', 'bills'], key: 'utilityPayments' },
  { segments: ['services', 'airtime'], key: 'utilityPayments' },
  { segments: ['services', 'data'], key: 'utilityPayments' },
  { segments: ['services', 'electricity'], key: 'utilityPayments' },
  { segments: ['services', 'cable-tv'], key: 'utilityPayments' },
  { segments: ['services', 'education'], key: 'utilityPayments' },
  { segments: ['services', 'food'], key: 'restaurant' },
  { segments: ['services', 'fx'], key: 'fx' },
  { segments: ['services', 'transfer'], key: 'walletTransfers' },
  { segments: ['services', 'beneficiaries'], key: 'beneficiaries' },
  { segments: ['services', 'cards'], key: 'virtualAccounts' },

  // Top-level module routes.
  { segments: ['wallet'], key: 'wallet' },
  { segments: ['savings'], key: 'savings' },
  { segments: ['insurance'], key: 'insurance' },
  { segments: ['stays'], key: 'stays' },
  { segments: ['crowdfunding'], key: 'crowdfunding' },
  { segments: ['creators'], key: 'creators' },
  { segments: ['loyalty'], key: 'loyalty' },
  { segments: ['referral'], key: 'referrals' },
  { segments: ['social'], key: 'socialPay' },
  { segments: ['food'], key: 'restaurant' },
  { segments: ['mobility'], key: 'transport' },
  { segments: ['fx'], key: 'fx' },
  { segments: ['realtor'], key: 'realtor' },
  { segments: ['association'], key: 'association' },
  { segments: ['events'], key: 'events' },
  { segments: ['fractionalre'], key: 'realtor' },
];

/** Longest-first, so a nested match always wins over its parent. */
const RANKED = [...ROUTE_MODULE_KEYS].sort((a, b) => b.segments.length - a.segments.length);

/**
 * The registry key owning this route, or null when the route is not gated.
 *
 * Matches on a segment PREFIX, so every screen beneath a mapped route inherits
 * the gate — `/services/telemedicine/book/confirm` is covered by the
 * ['services','telemedicine'] entry without listing each child.
 */
export function moduleKeyForSegments(segments: readonly string[]): string | null {
  for (const entry of RANKED) {
    if (entry.segments.length > segments.length) continue;
    if (entry.segments.every((seg, i) => segments[i] === seg)) return entry.key;
  }
  return null;
}

/** Route the guard sends users to when a module is not published here. */
export const MODULE_UNAVAILABLE_ROUTE = '/module-unavailable';

/**
 * Whether the guard should even look at this location.
 *
 * Excludes the unavailable screen itself (redirecting it to itself is a loop)
 * and the auth/pre-auth stack, where the auth guard already owns navigation and
 * a second redirect would fight it.
 */
export function guardAppliesTo(segments: readonly string[]): boolean {
  const first = segments[0];
  if (!first) return false;
  if (first === 'module-unavailable') return false;
  if (first === '(auth)' || first === 'onboarding') return false;
  return true;
}

/**
 * Human label per registry key, for the unavailable screen. Falls back to a
 * generic phrase, so an unmapped key still yields a readable sentence rather
 * than leaking an internal identifier at the user.
 */
export const MODULE_LABELS: Record<string, string> = {
  wallet: 'Your wallet',
  walletTransfers: 'Transfers',
  walletBankTransfers: 'Bank withdrawals',
  beneficiaries: 'Beneficiaries',
  virtualAccounts: 'Virtual cards',
  fx: 'Currency exchange',
  savings: 'Savings',
  insurance: 'Insurance',
  socialPay: 'Social pay',
  loyalty: 'Loyalty',
  referrals: 'Referrals',
  utilityPayments: 'Bill payments',
  telemedicine: 'Telemedicine',
  healthPharmacy: 'Pharmacy',
  healthLab: 'Lab tests',
  healthVet: 'Veterinary care',
  restaurant: 'Food delivery',
  transport: 'Rides',
  stays: 'Stays',
  creators: 'Creators',
  crowdfunding: 'Crowdfunding',
  realtor: 'Property',
  association: 'Associations',
  events: 'Events',
};
