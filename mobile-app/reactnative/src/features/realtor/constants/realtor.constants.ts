// ── Spotlight Realtor — Static config & label maps ───────────────────────────
// Single source of truth for human labels + filter option lists, so screens and
// the data layer never disagree on copy.

import type {
  TransactionMode,
  PropertyType,
  Furnishing,
  Amenity,
  RentSchedule,
  SortKey,
  VerificationLevel,
  ListingStatus,
  InspectionStatus,
  ApplicationStatus,
} from '../types/realtor.types';

export const MODE_LABEL: Record<TransactionMode, string> = {
  for_sale: 'For Sale',
  for_lease: 'For Lease',
  long_rent: 'For Rent',
  short_stay: 'Shortlet',
};

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  apartment: 'Apartment',
  flat: 'Flat',
  duplex: 'Duplex',
  detached_house: 'Detached House',
  terrace: 'Terrace',
  studio: 'Studio',
  self_contain: 'Self Contain',
  bungalow: 'Bungalow',
  shop: 'Shop',
  office: 'Office',
  land: 'Land',
};

export const FURNISHING_LABEL: Record<Furnishing, string> = {
  unfurnished: 'Unfurnished',
  semi_furnished: 'Semi-furnished',
  furnished: 'Furnished',
  serviced: 'Serviced',
};

export const SCHEDULE_LABEL: Record<RentSchedule, string> = {
  annual: 'per year',
  biannual: 'per 6 months',
  quarterly: 'per quarter',
  monthly: 'per month',
};

export const AMENITY_LABEL: Record<Amenity, string> = {
  parking: 'Parking',
  security: 'Security',
  power_backup: 'Power backup',
  water: 'Water supply',
  borehole: 'Borehole',
  pool: 'Swimming pool',
  gym: 'Gym',
  cctv: 'CCTV',
  elevator: 'Elevator',
  air_conditioning: 'Air conditioning',
  furnished: 'Furnished',
  wifi: 'Wi-Fi',
  gated_estate: 'Gated estate',
  pet_friendly: 'Pet friendly',
  wardrobe: 'Fitted wardrobe',
  kitchen_fitted: 'Fitted kitchen',
};

/** Lucide icon name per amenity (rendered dynamically like StateView does). */
export const AMENITY_ICON: Record<Amenity, string> = {
  parking: 'Car',
  security: 'ShieldCheck',
  power_backup: 'Zap',
  water: 'Droplets',
  borehole: 'Waves',
  pool: 'Waves',
  gym: 'Dumbbell',
  cctv: 'Cctv',
  elevator: 'ArrowUpDown',
  air_conditioning: 'Wind',
  furnished: 'Sofa',
  wifi: 'Wifi',
  gated_estate: 'Fence',
  pet_friendly: 'PawPrint',
  wardrobe: 'DoorClosed',
  kitchen_fitted: 'CookingPot',
};

export const SORT_LABEL: Record<SortKey, string> = {
  newest: 'Newest',
  price_asc: 'Price: Low to High',
  price_desc: 'Price: High to Low',
  verified_first: 'Verified first',
  popularity: 'Most popular',
};

/** Verification chip presentation. Colour keys map to Colors.* in components. */
export const VERIFICATION_META: Record<
  VerificationLevel,
  { label: string; icon: string; tone: 'success' | 'info' | 'neutral' | 'warning' }
> = {
  verified: { label: 'Verified', icon: 'BadgeCheck', tone: 'success' },
  inspected: { label: 'Inspected', icon: 'Footprints', tone: 'info' },
  document_backed: { label: 'Document-backed', icon: 'FileCheck', tone: 'info' },
  unverified: { label: 'Unverified', icon: 'ShieldAlert', tone: 'warning' },
};

export const LISTING_STATUS_META: Record<
  ListingStatus,
  { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' | 'error' }
> = {
  published: { label: 'Available', tone: 'success' },
  draft: { label: 'Draft', tone: 'neutral' },
  pending_verification: { label: 'Under verification', tone: 'warning' },
  unavailable: { label: 'Unavailable', tone: 'neutral' },
  suspended: { label: 'Suspended', tone: 'error' },
};

export const INSPECTION_STATUS_META: Record<
  InspectionStatus,
  { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' | 'error' }
> = {
  requested: { label: 'Requested', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  rescheduled: { label: 'Rescheduled', tone: 'info' },
  checked_in: { label: 'Checked in', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'error' },
  no_show: { label: 'No-show', tone: 'error' },
};

export const APPLICATION_STATUS_META: Record<
  ApplicationStatus,
  { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' | 'error' }
> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'info' },
  under_review: { label: 'Under review', tone: 'warning' },
  more_info_required: { label: 'More info needed', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'error' },
  offer_sent: { label: 'Offer sent', tone: 'success' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

// ─── Filter option lists (drive the filter sheet) ─────────────────────────────

export const MODE_OPTIONS: TransactionMode[] = ['long_rent', 'for_sale', 'for_lease', 'short_stay'];

export const PROPERTY_TYPE_OPTIONS: PropertyType[] = [
  'apartment', 'flat', 'self_contain', 'studio', 'duplex', 'terrace',
  'detached_house', 'bungalow', 'shop', 'office', 'land',
];

export const FURNISHING_OPTIONS: Furnishing[] = ['unfurnished', 'semi_furnished', 'furnished', 'serviced'];

export const AMENITY_OPTIONS: Amenity[] = [
  'security', 'power_backup', 'parking', 'water', 'borehole', 'air_conditioning',
  'cctv', 'gated_estate', 'pool', 'gym', 'elevator', 'wifi', 'pet_friendly',
  'furnished', 'wardrobe', 'kitchen_fitted',
];

export const SORT_OPTIONS: SortKey[] = ['newest', 'price_asc', 'price_desc', 'verified_first', 'popularity'];

export const BEDROOM_OPTIONS = [1, 2, 3, 4, 5] as const;

/** Common NG price anchors (minor units) for the price filter quick-picks. */
export const PRICE_ANCHORS_KOBO = [
  500_000_00, 1_000_000_00, 2_500_000_00, 5_000_000_00, 10_000_000_00,
] as const;
