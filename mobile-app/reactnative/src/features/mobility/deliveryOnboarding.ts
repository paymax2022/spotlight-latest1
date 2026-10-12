// Delivery-provider onboarding (Slice A): pure helpers + canonical fallback
// lists. No React/RN imports so it unit-tests under node --test. The server
// owns the authoritative option lists (GET /driver/onboarding-options); these
// are the offline fallback, and the service icons are mapped here by value.

import type { DocType } from '@/features/mobility/types/mobility.types';

export type VehicleType = 'car' | 'motorcycle' | 'bicycle';

export interface Option {
  value: string;
  label: string;
}

export interface ServiceOption extends Option {
  icon: string;
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

export const COVERAGE_FALLBACK: Option[] = [
  { value: 'ikeja', label: 'Ikeja' },
  { value: 'surulere', label: 'Surulere' },
  { value: 'yaba', label: 'Yaba' },
  { value: 'lekki', label: 'Lekki' },
  { value: 'victoria_island', label: 'Victoria Island' },
  { value: 'ikoyi', label: 'Ikoyi' },
  { value: 'lagos_island', label: 'Lagos Island' },
  { value: 'apapa', label: 'Apapa' },
  { value: 'ajah', label: 'Ajah' },
  { value: 'oshodi_isolo', label: 'Oshodi-Isolo' },
  { value: 'alimosho', label: 'Alimosho' },
  { value: 'gbagada', label: 'Gbagada' },
  { value: 'agege', label: 'Agege' },
  { value: 'mushin', label: 'Mushin' },
  { value: 'ikorodu', label: 'Ikorodu' },
  { value: 'badagry', label: 'Badagry' },
  { value: 'epe', label: 'Epe' },
];

const DOCS_BY_VEHICLE: Record<VehicleType, DocType[]> = {
  bicycle: ['government_id', 'proof_of_address'],
  motorcycle: ['government_id', 'proof_of_address', 'drivers_licence'],
  car: ['government_id', 'proof_of_address', 'drivers_licence', 'vehicle_insurance', 'roadworthiness'],
};

export function requiredDocumentsFor(vehicleType: VehicleType): DocType[] {
  return DOCS_BY_VEHICLE[vehicleType] ?? DOCS_BY_VEHICLE.car;
}

export function canContinueServicesStep(interests: string[], areas: string[]): boolean {
  return interests.length > 0 && areas.length > 0;
}

export interface OnboardingOptions {
  services: ServiceOption[];
  coverageAreas: Option[];
}

// Return the server options when the fetch succeeds and is non-empty; otherwise
// the built-in fallback, so a provider can always complete onboarding offline.
export async function resolveOnboardingOptions(
  fetcher: () => Promise<OnboardingOptions>,
): Promise<OnboardingOptions> {
  try {
    const r = await fetcher();
    if (r && Array.isArray(r.services) && r.services.length > 0 && Array.isArray(r.coverageAreas) && r.coverageAreas.length > 0) {
      return r;
    }
  } catch {
    // fall through to the fallback
  }
  return { services: SERVICE_INTERESTS, coverageAreas: COVERAGE_FALLBACK };
}
