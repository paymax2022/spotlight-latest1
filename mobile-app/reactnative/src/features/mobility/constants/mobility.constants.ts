// NOTE: pricing floors/ceilings/commission are NEVER hard-coded for *use*. The
// values below are display labels and feature flags only — every fare bound and
// commission split is read from backend config at runtime.

import type { ServiceType, CommissionTier, DocType } from '../types/mobility.types';

export const RIDE_NEGOTIATION_ENABLED =
  (process.env.EXPO_PUBLIC_MOBILITY_NEGOTIATION ?? 'true').toLowerCase() !== 'false';

export const DRIVER_MODE_ENABLED =
  (process.env.EXPO_PUBLIC_MOBILITY_DRIVER ?? 'true').toLowerCase() !== 'false';

// React Query namespace
export const MOBILITY_KEY = 'mobility';

export interface ServiceTypeMeta {
  value: ServiceType;
  label: string;
  description: string;
  icon: string;          // lucide name
  seats: number;
}

export const SERVICE_TYPES: ServiceTypeMeta[] = [
  { value: 'economy', label: 'Economy', description: 'Affordable everyday rides', icon: 'Car',       seats: 4 },
  { value: 'comfort', label: 'Comfort', description: 'Newer cars, more legroom',  icon: 'CarFront',  seats: 4 },
  { value: 'premium', label: 'Premium', description: 'Top-rated drivers, premium cars', icon: 'Crown', seats: 4 },
  { value: 'xl',      label: 'XL / SUV', description: 'Up to 6 seats, extra space',     icon: 'Bus',  seats: 6 },
];

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  economy: 'Economy',
  comfort: 'Comfort',
  premium: 'Premium',
  xl: 'XL / SUV',
};

// The backend home payload sends quickTiles as plain string keys
// (e.g. ['ride', 'schedule', 'parcel', 'airport']). The client maps each key to
// its display metadata + destination here. Unknown keys are skipped by the
// ride estimate flow.
export interface QuickTileMeta {
  id: string;
  label: string;
  icon: string;              // lucide name
  route?: string;
  enabled: boolean;
}

export const QUICK_TILE_REGISTRY: Record<string, QuickTileMeta> = {
  ride:     { id: 'ride',     label: 'Ride now',    icon: 'Car',           enabled: true },
  schedule: { id: 'schedule', label: 'Schedule',    icon: 'CalendarClock', enabled: false },
  parcel:   { id: 'parcel',   label: 'Send parcel', icon: 'Package',       route: '/mobility/parcel', enabled: true },
  airport:  { id: 'airport',  label: 'Airport',     icon: 'Plane',         enabled: true },
};

export const PHASE_LABEL: Record<string, string> = {
  requested: 'Finding your driver',
  fare_negotiating: 'Negotiating fare',
  driver_assigned: 'Driver assigned',
  driver_arriving: 'Driver is arriving',
  pin_verified: 'PIN verified',
  in_progress: 'On the way',
  completed: 'Trip completed',
  cancelled: 'Trip cancelled',
  no_show: 'No-show',
  safety_hold: 'Safety hold',
};

export const COMMISSION_TIER_LABEL: Record<CommissionTier, string> = {
  standard: 'Standard',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
};

export interface DocRequirement {
  docType: DocType;
  label: string;
  hint: string;
  requiresExpiry: boolean;
}

export const REQUIRED_DOCUMENTS: DocRequirement[] = [
  { docType: 'drivers_licence',   label: "Driver's Licence",   hint: 'Front of a valid licence', requiresExpiry: true },
  { docType: 'government_id',      label: 'Government ID',       hint: 'NIN, voter card or passport', requiresExpiry: false },
  { docType: 'proof_of_address',  label: 'Proof of Address',    hint: 'Utility bill (last 3 months)', requiresExpiry: false },
  { docType: 'vehicle_insurance', label: 'Vehicle Insurance',   hint: 'Valid insurance certificate', requiresExpiry: true },
  { docType: 'roadworthiness',    label: 'Roadworthiness',      hint: 'Vehicle roadworthiness certificate', requiresExpiry: true },
];

export const CANCEL_REASONS = [
  'Driver taking too long',
  'Booked by mistake',
  'Found another ride',
  'Wrong pickup location',
  'Driver asked to cancel',
  'Other',
] as const;

export const TIP_PRESETS_KOBO = [0, 100_00, 200_00, 500_00, 1_000_00];

export const STATE_COPY = {
  offline: {
    title: 'You appear to be offline',
    message: 'Check your internet connection and try again.',
    icon: 'WifiOff',
  },
  serviceUnavailable: {
    title: 'Not available in your area yet',
    message: 'Mobility is rolling out city by city. We will notify you when it reaches you.',
    icon: 'MapPinOff',
  },
  noDriver: {
    title: 'No drivers found',
    message: 'No drivers are available right now. Try again or adjust your fare offer.',
    icon: 'CarTaxiFront',
  },
  paymentFailed: {
    title: 'Payment could not be completed',
    message: 'Your fare could not be charged. Try another payment method.',
    icon: 'CreditCard',
  },
  restricted: {
    title: 'Action not allowed',
    message: 'You do not have access to this. Complete the required steps first.',
    icon: 'Lock',
  },
  genericError: {
    title: 'Something went wrong',
    message: 'We could not complete that. Please try again.',
    icon: 'CloudOff',
  },
} as const;

// Vehicle make/model options for driver onboarding. Models are scoped to their
// make on purpose: a single flat model list would offer a Corolla under Lexus.
// "Other" is the escape hatch so an unlisted vehicle can still be registered —
// the backend stores make/model as free text, so nothing is rejected.
export interface VehicleMake {
  make: string;
  models: string[];
}

export const VEHICLE_MAKES: VehicleMake[] = [
  { make: 'Toyota', models: ['Corolla', 'Camry', 'Avensis', 'Yaris', 'Sienna', 'Highlander', 'RAV4', 'Land Cruiser', 'Prado', 'Hiace', 'Hilux'] },
  { make: 'Honda', models: ['Accord', 'Civic', 'CR-V', 'City', 'Pilot', 'Odyssey'] },
  { make: 'Lexus', models: ['RX 350', 'RX 450h', 'ES 350', 'GX 460', 'LX 570', 'NX 300'] },
  { make: 'Mercedes-Benz', models: ['C-Class', 'E-Class', 'S-Class', 'GLE', 'GLC', 'ML', 'Sprinter'] },
  { make: 'Nissan', models: ['Almera', 'Altima', 'Sentra', 'X-Trail', 'Pathfinder', 'Navara', 'Urvan'] },
  { make: 'Hyundai', models: ['Elantra', 'Accent', 'Sonata', 'Tucson', 'Santa Fe', 'Creta', 'i10'] },
  { make: 'Kia', models: ['Rio', 'Cerato', 'Optima', 'Sportage', 'Sorento', 'Seltos', 'Picanto'] },
  { make: 'Ford', models: ['Focus', 'Fusion', 'Explorer', 'Escape', 'Ranger', 'Transit'] },
  { make: 'Peugeot', models: ['301', '308', '406', '407', '508', '3008', 'Partner'] },
  { make: 'Volkswagen', models: ['Golf', 'Jetta', 'Passat', 'Tiguan', 'Polo', 'Transporter'] },
  { make: 'BMW', models: ['3 Series', '5 Series', '7 Series', 'X3', 'X5', 'X6'] },
  { make: 'Mitsubishi', models: ['Lancer', 'Outlander', 'Pajero', 'L200', 'Space Wagon'] },
  { make: 'Mazda', models: ['Mazda3', 'Mazda6', 'CX-5', 'CX-7', 'MPV'] },
  { make: 'Chevrolet', models: ['Cruze', 'Malibu', 'Captiva', 'Aveo'] },
  { make: 'Innoson', models: ['IVM G6', 'IVM G4', 'IVM Fox', 'IVM Umu'] },
  { make: 'GAC', models: ['GS3', 'GS4', 'GS8', 'GN8'] },
  { make: 'MG', models: ['MG5', 'MG6', 'ZS', 'HS', 'RX5'] },
  { make: 'Other', models: ['Other'] },
];

export const VEHICLE_COLORS = [
  'Black',
  'Silver',
  'Grey',
  'White',
  'Blue',
  'Red',
  'Green',
  'Brown',
  'Gold',
  'Beige',
  'Orange',
  'Yellow',
  'Purple',
  'Other',
] as const;

/** Model years offered in onboarding: the next model year back to 1990. */
export function vehicleYears(now: number = new Date().getFullYear()): string[] {
  return Array.from({ length: now + 1 - 1990 }, (_, i) => String(now + 1 - i));
}
