// ── Which routes need a transaction PIN ──────────────────────────────────────
//
// The root layout used to bounce EVERY signed-in PIN-less user to
// /security/set-pin before any route at all — you could not read your contest
// application, an announcement or a lab result without first creating a payment
// credential you had no immediate use for.
//
// THIS LIST IS UX, NOT ENFORCEMENT. Read that twice before editing it.
// Every wallet debit is enforced server-side: POST /transfers/pin/verify answers
// 403 `pin_not_set`, and describePinFailure already renders that as a
// non-retryable "You have not set a transaction PIN yet." So a route missing
// from this list does NOT let anyone move money without a PIN — it only means
// they meet the requirement at the moment of payment rather than on the way in.
// That asymmetry is deliberate: over-listing costs every user an interruption,
// under-listing costs one user one extra tap.
//
// Matched by PREFIX, longest-first, mirroring routeModuleKeys.ts, so a deep link
// straight into a payment step (a push notification, a saved URL) gates even
// when the module around it does not.
//
// The rule for adding an entry: money moves on this screen, or the screen exists
// only to move money. Browsing a menu, a roster or a catalogue is not that.

/** Segment paths that require a transaction PIN. Order is irrelevant. */
const MONEY_ROUTES: string[][] = [
  // ── Surfaces that exist only to hold or move money ────────────────────────
  ['wallet'],
  ['dues'],
  ['savings'],
  ['crypto'],
  ['stocks'],
  ['fx'],
  ['invest'],
  ['investment'],
  ['invest-ai'],
  ['invest-onboarding'],
  ['invest-settings'],
  ['ai-trading'],
  ['fractionalre'],
  ['spotlight-wealth'],
  ['finance'],

  // ── Payment steps inside modules that are otherwise browseable ────────────
  // Reading a menu, a contest or a pharmacy catalogue stays open; paying does not.
  ['association', 'pay'],
  ['association', 'event-pay'],
  ['registration', '[id]', 'payment'],
  ['voting', 'buy-votes'],
  ['voting', 'payment-method'],
  ['events', 'checkout'],
  ['events', 'wallet'],
  ['health', 'pharmacy', 'checkout'],
  ['health', 'lab', 'checkout'],
  ['health', 'vet', 'checkout'],
  ['health', 'triage', 'checkout'],
  ['insurance', 'pay'],
  ['learn', 'academy', 'fees', 'pay'],
  ['learn', 'academy', 'parent', 'edupay', 'pay'],
  ['crowdfunding', 'contribute'],
  ['crowdfunding', 'wallet'],
  ['social', 'escrow'],
  ['connect', 'wallet'],
  ['creators', 'payout'],
  ['referral', 'earnings'],
  ['realtor', 'lease'],
  ['food', 'checkout'],
  ['stays', 'checkout'],
  ['mobility', 'pay'],
  ['marketplace', 'checkout'],
  ['services', 'transfer'],
  ['services', 'bills'],
  ['services', 'airtime'],
  ['services', 'data'],
  ['services', 'electricity'],
  ['services', 'cable-tv'],
  ['services', 'education'],
];

// Longest-first so a specific payment step is considered before any shorter
// prefix, matching how routeModuleKeys.ts resolves nested routes.
const SORTED = [...MONEY_ROUTES].sort((a, b) => b.length - a.length);

/**
 * Expo route GROUPS — `(tabs)`, `(auth)`, `(doctor)` — are organisational only:
 * they structure the file tree and never appear in the URL. Expo still reports
 * them in `segments`, so a table written in URL terms has to drop them first.
 *
 * This is not cosmetic. `/wallet` is `app/(tabs)/wallet.tsx`, so it arrives as
 * ['(tabs)','wallet'] — matching raw segments silently failed to gate the wallet
 * tab, the single most obvious money surface in the app.
 */
function withoutGroups(segments: string[]): string[] {
  return segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
}

/**
 * Whether the given Expo Router segments land on a money path.
 *
 * Expo reports dynamic segments as `[id]`, which is what the table above uses,
 * so `registration/[id]/payment` matches whatever the id happens to be.
 */
export function requiresTransactionPin(segments: string[]): boolean {
  const path = withoutGroups(segments);
  if (path.length === 0) return false;
  return SORTED.some(
    (route) =>
      route.length <= path.length &&
      route.every((part, i) => part === path[i]),
  );
}
