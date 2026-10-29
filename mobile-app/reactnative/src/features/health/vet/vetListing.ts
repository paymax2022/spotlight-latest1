// Maps the backend's vet listing to the app's Vet. Pure: no React Native or '@/'
// imports, so it runs under node:test.
//
// The listing carries no licence number, by design. The app's credential type
// still has a licenseNo field, and nothing on the vet screens displays it, so it
// is set to '' here rather than invented.

import type { Vet } from './types';

export interface ListedVetWire {
  id: string;
  name: string;
  headline?: string;
  bio?: string;
  credential: { authority: string; status: string };
  clinicName?: string;
  address?: string;
  distanceM?: number;
  lat?: number;
  lng?: number;
  consultFeeKobo?: number;
  homeVisitFeeKobo?: number;
  clinicFeeKobo?: number;
  types?: string[];
  species?: string[];
  specialties?: string[];
  rating?: number;
  reviewCount?: number;
  availableNow?: boolean;
  active?: boolean;
}

/** "350 m" under a kilometre, "2.4 km" above. Empty when the distance is unknown. */
export function formatDistance(metres?: number): string {
  if (metres == null || !Number.isFinite(metres)) return '';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

export function mapListedVet(raw: ListedVetWire): Vet {
  return {
    id: raw.id,
    name: raw.name,
    headline: raw.headline ?? '',
    bio: raw.bio ?? '',
    credential: {
      authority: 'VCN',
      licenseNo: '',
      status: (raw.credential?.status === 'verified' ? 'verified' : 'pending') as Vet['credential']['status'],
    },
    rating: raw.rating ?? 0,
    reviewCount: raw.reviewCount ?? 0,
    clinicName: raw.clinicName ?? '',
    address: raw.address ?? '',
    distanceLabel: formatDistance(raw.distanceM),
    lat: raw.lat ?? 0,
    lng: raw.lng ?? 0,
    consultFeeKobo: raw.consultFeeKobo ?? 0,
    homeVisitFeeKobo: raw.homeVisitFeeKobo ?? 0,
    clinicFeeKobo: raw.clinicFeeKobo ?? 0,
    types: (raw.types ?? []) as Vet['types'],
    species: (raw.species ?? []) as Vet['species'],
    specialties: raw.specialties ?? [],
    availableNow: raw.availableNow ?? false,
    active: raw.active ?? true,
  };
}
