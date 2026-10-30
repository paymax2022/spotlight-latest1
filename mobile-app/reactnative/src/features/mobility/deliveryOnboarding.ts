// Delivery-provider onboarding (Slice A): pure helpers + canonical fallback
// lists. No React/RN imports so it unit-tests under node --test. The server
// owns the authoritative option lists (GET /driver/onboarding-options); these
// are the offline fallback, and the service icons are mapped here by value.

import type { DocType } from '@/features/mobility/types/mobility.types';
import { NIGERIA_STATES } from '@/data/nigeria';

export type VehicleType = 'car' | 'motorcycle' | 'bicycle';

export interface Option {
  value: string;
  label: string;
}

export interface ServiceOption extends Option {
  icon: string;
}

/** A coverage area is always scoped to one state. */
export interface AreaOption extends Option {
  state: string;
}

export const SERVICE_INTERESTS: ServiceOption[] = [
  { value: 'rides', label: 'Rides', icon: 'Car' },
  { value: 'parcel_delivery', label: 'Parcel delivery', icon: 'Package' },
  { value: 'bus_services', label: 'Bus services', icon: 'Bus' },
  { value: 'car_bus_hire', label: 'Car / bus hire', icon: 'KeyRound' },
  { value: 'movers', label: 'Movers', icon: 'Truck' },
  { value: 'bulk_goods_delivery', label: 'Bulk goods delivery', icon: 'PackageCheck' },
  { value: 'bus_shuttle', label: 'Bus hailing / shuttle', icon: 'Route' },
];

// Same rule as the Go server's areaSlug (backend/internal/transport/
// service_profile.go). Both sides derive their ids from this one dataset, so a
// drift here means the server rejects values the app just offered.
export function areaSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export const STATE_OPTIONS: Option[] = NIGERIA_STATES.map((s) => ({
  value: areaSlug(s.name),
  label: s.name,
}));

// Coverage ids are namespaced "<state>/<lga>" because six LGA names repeat
// across states (e.g. Bassa in Kogi and Plateau); a bare name is ambiguous.
export const COVERAGE_FALLBACK: AreaOption[] = NIGERIA_STATES.flatMap((s) => {
  const state = areaSlug(s.name);
  return s.lgas.map((lga) => ({ value: `${state}/${areaSlug(lga)}`, label: lga, state }));
});

/** The cities of one state. Empty until a state is picked. */
export function areasForState(areas: AreaOption[], state: string): AreaOption[] {
  return state ? areas.filter((a) => a.state === state) : [];
}

/** State slug of a stored coverage value; '' for a legacy unqualified value. */
export function coverageStateOf(value: string): string {
  const i = value.indexOf('/');
  return i > 0 ? value.slice(0, i) : '';
}

/** Human label for a stored coverage value, including legacy bare slugs. */
export function coverageAreaLabel(value: string, areas: AreaOption[]): string {
  const exact = areas.find((a) => a.value === value);
  if (exact) return exact.label;
  const lga = value.slice(value.indexOf('/') + 1);
  return areas.find((a) => a.value.endsWith('/' + lga))?.label ?? value;
}

// Step 4 is identity-first: NIN and driver's licence are proven by a provider
// data-match (no scan uploads), proof of address is the one uploaded file, and
// the guarantor's signed document is issued AFTER onboarding. Vehicle papers
// (insurance, roadworthiness) are not part of this gate.
export interface IdentityDocRequirement {
  docType: 'nin' | 'drivers_licence';
  label: string;
  hint: string;
  placeholder: string;
  /** NIN is exactly 11 digits; a licence number is 5–20 alphanumerics. */
  validate: (value: string) => boolean;
}

export const NIN_REQUIREMENT: IdentityDocRequirement = {
  docType: 'nin',
  label: 'NIN',
  hint: 'Your 11-digit National Identification Number',
  placeholder: '12345678901',
  validate: (v) => /^\d{11}$/.test(v.trim()),
};

export const LICENCE_REQUIREMENT: IdentityDocRequirement = {
  docType: 'drivers_licence',
  label: "Driver's Licence",
  hint: 'The number on your driver’s licence',
  placeholder: 'ABC123456789',
  validate: (v) => /^[A-Za-z0-9/-]{5,20}$/.test(v.trim()),
};

/** A bicycle courier has no licence; every motorised driver needs both. */
export function identityDocsFor(vehicleType: VehicleType): IdentityDocRequirement[] {
  return vehicleType === 'bicycle' ? [NIN_REQUIREMENT] : [NIN_REQUIREMENT, LICENCE_REQUIREMENT];
}

export const PROOF_OF_ADDRESS_DOC = {
  docType: 'proof_of_address' as DocType,
  label: 'Proof of Address',
  hint: 'Utility bill from the last 3 months',
};

export const GUARANTOR_RELATIONSHIPS = [
  'Parent', 'Sibling', 'Spouse', 'Relative', 'Friend', 'Colleague', 'Employer', 'Other',
];

// approved = provider matched; submitted = provider was unavailable and ops will
// review. Both let the driver continue — otherwise a provider outage would trap
// them on a step they cannot influence.
const IDENTITY_READY_STATUSES = new Set(['approved', 'submitted', 'verified', 'uploaded']);

export function identityReady(status: string | undefined | null): boolean {
  return !!status && IDENTITY_READY_STATUSES.has(status);
}

export function guarantorComplete(
  g: { fullName?: string | null; phone?: string | null; relationship?: string | null } | null | undefined,
): boolean {
  return !!g && (g.fullName ?? '').trim().length >= 3 && (g.phone ?? '').trim().length >= 7 && !!g.relationship;
}

// The documents step still collects uploads against this set: the app has no
// client call to the identity/guarantor endpoints yet, so the data-match model
// above is not reachable from the UI.
const DOCS_BY_VEHICLE: Record<VehicleType, DocType[]> = {
  bicycle: ['government_id', 'proof_of_address'],
  motorcycle: ['government_id', 'proof_of_address', 'drivers_licence'],
  car: ['government_id', 'proof_of_address', 'drivers_licence', 'vehicle_insurance', 'roadworthiness'],
};

export function requiredDocumentsFor(vehicleType: VehicleType): DocType[] {
  return DOCS_BY_VEHICLE[vehicleType] ?? DOCS_BY_VEHICLE.car;
}

/** What still stands between the driver and Submit, in the order shown. */
export function missingOnboardingItems(
  vehicleType: VehicleType,
  docs: readonly { docType: string; status: string }[],
  guarantor: { fullName?: string | null; phone?: string | null; relationship?: string | null } | null | undefined,
): string[] {
  const byType = new Map(docs.map((d) => [d.docType, d.status]));
  const missing: string[] = [];
  for (const req of identityDocsFor(vehicleType)) {
    if (!identityReady(byType.get(req.docType))) missing.push(req.label);
  }
  if (!byType.has(PROOF_OF_ADDRESS_DOC.docType)) missing.push(PROOF_OF_ADDRESS_DOC.label);
  if (!guarantorComplete(guarantor)) missing.push('Guarantor details');
  return missing;
}

export function canContinueServicesStep(interests: string[], areas: string[]): boolean {
  return interests.length > 0 && areas.length > 0;
}

// Read a string[] from a raw API object under any of the given keys. The Go
// /driver/me response is snake_case and the mobility axios client does not
// camelize, so a camelCase-only read would silently miss service_interests /
// coverage_areas. Returns [] when absent.
export function pickStringArray(raw: Record<string, unknown> | null | undefined, ...keys: string[]): string[] {
  if (!raw) return [];
  for (const k of keys) {
    const v = raw[k];
    if (Array.isArray(v)) return v as string[];
  }
  return [];
}

export interface OnboardingOptions {
  services: ServiceOption[];
  states: Option[];
  coverageAreas: AreaOption[];
}

// Return the server options when the fetch succeeds and is non-empty; otherwise
// the built-in fallback, so a provider can always complete onboarding offline.
export async function resolveOnboardingOptions(
  fetcher: () => Promise<OnboardingOptions>,
): Promise<OnboardingOptions> {
  try {
    const r = await fetcher();
    if (
      r &&
      Array.isArray(r.services) && r.services.length > 0 &&
      Array.isArray(r.states) && r.states.length > 0 &&
      Array.isArray(r.coverageAreas) && r.coverageAreas.length > 0
    ) {
      return r;
    }
  } catch {
    // fall through to the fallback
  }
  return { services: SERVICE_INTERESTS, states: STATE_OPTIONS, coverageAreas: COVERAGE_FALLBACK };
}
