// ── Service-grid id → registry key ───────────────────────────────────────────
//
// SERVICE_MODULES ids are route-shaped and kebab-case; platform_modules keys are
// the camelCase feature-flag names. This maps between them for the entries where
// the correspondence is unambiguous.
//
// DELIBERATELY PARTIAL. An id with no entry here is NOT gated by the registry and
// always renders. That is the safe direction: gating a tile against a registry key
// that does not exist would hide it forever, and a missing mapping is far more
// likely than a deliberate omission. Add entries as modules are registered —
// serviceModuleKeys.spec.ts fails if a value here is not a real registry key.

export const SERVICE_MODULE_REGISTRY_KEY: Record<string, string> = {
  // Finance
  wallet: 'wallet',
  transfer: 'walletTransfers',
  'virtual-cards': 'virtualAccounts',
  'fx-exchange': 'fx',
  savings: 'savings',
  insurance: 'insurance',
  'social-pay': 'socialPay',
  loyalty: 'loyalty',
  referral: 'referrals',

  // Utility bills — one registry module backs the whole bill-payment family.
  bills: 'utilityPayments',
  airtime: 'utilityPayments',
  data: 'utilityPayments',
  electricity: 'utilityPayments',
  'cable-tv': 'utilityPayments',

  // Health
  telemedicine: 'telemedicine',
  pharmacy: 'healthPharmacy',
  laboratory: 'healthLab',
  veterinary: 'healthVet',

  // Lifestyle & marketplace
  food: 'restaurant',
  ride: 'transport',
  creators: 'creators',
  events: 'events',

  // Community. NOTE: 'stays', 'estate' and 'rent' are NOT top-level tiles — they
  // are reached from the /property hub, so gating them means gating that hub's own
  // list. Left for the next batch rather than mapped against ids that do not exist.
  associations: 'association',
  crowdfunding: 'crowdfunding',

  // Support
  support: 'aiCare',
};

/**
 * Registry key for a service-grid id, or null when the tile is not registry-gated.
 * Null means "always show" — see the note above.
 */
export function registryKeyFor(serviceId: string): string | null {
  return SERVICE_MODULE_REGISTRY_KEY[serviceId] ?? null;
}
