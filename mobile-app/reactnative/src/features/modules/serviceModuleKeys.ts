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

// ── Property hub ─────────────────────────────────────────────────────────────
// A SEPARATE map, not an extension of the one above. The two id-spaces collide:
// 'marketplace' is a lifestyle shopping tile in SERVICE_MODULES and the property
// buy/rent marketplace in PROPERTY_SUBMODULES. Sharing one table would gate the
// shopping tile on the realtor module.
//
// 'marketplace' and 'rent' both map to `realtor` on purpose — listings and leases
// are the same registry module (see FEATURE_REALTOR_ENABLED: "property graph,
// listings, inspections, leases, shortlet"). Unpublishing realtor therefore hides
// both pillars, which is the intended behaviour.
export const PROPERTY_SUBMODULE_REGISTRY_KEY: Record<string, string> = {
  marketplace: 'realtor',
  rent: 'realtor',
  stays: 'stays',
  estate: 'estate',
};

/** Registry key for a property pillar id, or null when it is not registry-gated. */
export function propertyRegistryKeyFor(subModuleId: string): string | null {
  return PROPERTY_SUBMODULE_REGISTRY_KEY[subModuleId] ?? null;
}

// ── Home tab: quick actions ──────────────────────────────────────────────────
// A third id-space. These are wallet SUB-ACTIONS ('add', 'send', 'withdraw',
// 'exchange'), not modules, so they carry their own short ids that mean nothing
// in the other tables — 'withdraw' and 'exchange' are not SERVICE_MODULES tiles,
// which is why the first batch had to drop them.
export const QUICK_ACTION_REGISTRY_KEY: Record<string, string> = {
  add: 'wallet',
  send: 'walletTransfers',
  withdraw: 'walletBankTransfers',
  exchange: 'fx',
};

export function quickActionRegistryKeyFor(actionId: string): string | null {
  return QUICK_ACTION_REGISTRY_KEY[actionId] ?? null;
}

// ── Home tab: featured service cards ─────────────────────────────────────────
// A fourth id-space. 'food-ride' is a featured card only (it has no tile in
// SERVICE_MODULES); 'naija-driver' and 'invest' have no registry module, so they
// are ungated and always render.
export const FEATURED_REGISTRY_KEY: Record<string, string> = {
  bills: 'utilityPayments',
  'food-ride': 'restaurant',
};

export function featuredRegistryKeyFor(featuredId: string): string | null {
  return FEATURED_REGISTRY_KEY[featuredId] ?? null;
}
