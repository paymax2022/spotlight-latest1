// Registry keys live in the platform_modules table (Go backend internal/modules);
// this maps services-grid tile ids onto them. EXHAUSTIVE since 2026-11-17: every
// SERVICE_MODULES tile id must appear here — tests/unit/modules/serviceModuleKeys.spec.ts
// fails on any unmapped tile, because an unmapped tile renders unconditionally
// and cannot be toggled from /admin/modules.
// Spec: docs/superpowers/specs/2026-11-17-mobile-menu-visibility-design.md

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

  // Investment & learning families plus the remaining tiles. Registered
  // 2026-11-17 so the whole grid is admin-controllable
  // (spec 2026-11-17-mobile-menu-visibility). Keys must exist in
  // platform_modules — migration 20261216000100 seeds them.
  investment: 'investment',
  crypto: 'crypto',
  learn: 'learn',
  'invest-ai': 'investAi',
  'spotlight-wealth': 'spotlightWealth',
  fractionalre: 'fractionalRealEstate',
  'ai-trading': 'aiTrading',
  education: 'education',
  // Contest rides the existing vote bridge module; Property Mgmt rides realtor,
  // matching the documented "unpublishing realtor hides the pillars" coupling.
  contest: 'voteBridge',
  'naija-driver': 'arena',
  'film-academy': 'filmAcademy',
  academy: 'academy',
  property: 'realtor',
  dues: 'dues',
  connect: 'connect',
  marketplace: 'marketplace',
  shopping: 'shopping',
  parcel: 'parcel',
  admin: 'admin',
};

/**
 * Registry key for a service-grid id, or null when the tile is not registry-gated.
 * Null means "always show" — see the note above.
 */
export function registryKeyFor(serviceId: string): string | null {
  return SERVICE_MODULE_REGISTRY_KEY[serviceId] ?? null;
}

// A SEPARATE map, not an extension of the one above. The two id-spaces collide:
// 'marketplace' is a lifestyle shopping tile in SERVICE_MODULES (registry key
// 'marketplace') and the property buy/rent pillar in PROPERTY_SUBMODULES
// (registry key 'realtor'). They are separate maps on purpose: hiding the
// shopping tile must not touch the property pillar.
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

// A fourth id-space. 'food-ride' is a featured card only (it has no tile in
// are ungated and always render.
export const FEATURED_REGISTRY_KEY: Record<string, string> = {
  bills: 'utilityPayments',
  'food-ride': 'restaurant',
  'naija-driver': 'arena',
  invest: 'investment',
};

export function featuredRegistryKeyFor(featuredId: string): string | null {
  return FEATURED_REGISTRY_KEY[featuredId] ?? null;
}
