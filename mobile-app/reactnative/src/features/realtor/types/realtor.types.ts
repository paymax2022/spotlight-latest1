// ── Spotlight Realtor — Domain types ─────────────────────────────────────────
// The typed contract the funnel screens code against (Backend role owns this).
//
// Modelled on the "one property graph, many offering modes" thesis:
//   Portfolio → Property(Building) → Unit → Room
// A Unit carries one or more pluggable OfferingModes (for_sale / for_lease /
// long_rent / short_stay). A Listing is the marketplace projection of a Unit in
// one offering mode. The funnel then connects: Listing → InspectionBooking →
// RentalApplication.
//
// IRON RULES honoured here:
//  • all money is integer minor units (kobo) — never floats, never strings;
//  • every status is an explicit union, never a free string;
//  • every funnel entity links back to a property-graph entity id.

// ─── Money & shared primitives ────────────────────────────────────────────────

/** Integer minor units (kobo). ₦250,000 → 25_000_000. */
export type Kobo = number;

export type CurrencyCode = 'NGN';

/** Long-rent is commonly paid yearly in NG; schedules are first-class. */
export type RentSchedule = 'annual' | 'biannual' | 'quarterly' | 'monthly';

export type TransactionMode = 'for_sale' | 'for_lease' | 'long_rent' | 'short_stay';

export type PropertyType =
  | 'apartment'
  | 'flat'
  | 'duplex'
  | 'detached_house'
  | 'terrace'
  | 'studio'
  | 'self_contain'
  | 'bungalow'
  | 'shop'
  | 'office'
  | 'land';

export type Furnishing = 'unfurnished' | 'semi_furnished' | 'furnished' | 'serviced';

export type Amenity =
  | 'parking'
  | 'security'
  | 'power_backup'
  | 'water'
  | 'borehole'
  | 'pool'
  | 'gym'
  | 'cctv'
  | 'elevator'
  | 'air_conditioning'
  | 'furnished'
  | 'wifi'
  | 'gated_estate'
  | 'pet_friendly'
  | 'wardrobe'
  | 'kitchen_fitted';

/** Trust & verification — the anti-scam layer. */
export type VerificationLevel =
  | 'unverified'       // visually marked, low trust
  | 'document_backed'  // ownership documents on file
  | 'inspected'        // physically inspected by platform
  | 'verified';        // fully verified owner + property + documents

export interface GeoPoint {
  lat: number;
  lng: number;
}

// ─── Property graph ───────────────────────────────────────────────────────────

export type UnitStatus =
  | 'vacant'
  | 'listed'
  | 'reserved'
  | 'occupied'
  | 'under_maintenance';

export interface Unit {
  id: string;
  propertyId: string;
  label: string;             // "Flat 3B"
  propertyType: PropertyType;
  bedrooms: number;
  bathrooms: number;
  toilets: number;
  sizeSqm?: number;
  furnishing: Furnishing;
  status: UnitStatus;
  offeringModes: TransactionMode[];
}

export interface Property {
  id: string;
  portfolioId: string;
  name: string;
  type: PropertyType;
  address: string;
  area: string;              // "Lekki Phase 1"
  city: string;
  state: string;
  geo?: GeoPoint;
  amenities: Amenity[];
  unitCount: number;
}

// ─── Listing (marketplace projection of a Unit in one offering mode) ──────────

export type ListingStatus =
  | 'draft'
  | 'pending_verification'
  | 'published'
  | 'unavailable'
  | 'suspended';

/** Transparent fee line shown on listing detail (no hidden charges). */
export interface FeeLine {
  label: string;
  amount: Kobo;
  /** When true, held in escrow / refundable (e.g. caution deposit). */
  refundable?: boolean;
}

export interface AgentRef {
  id: string;
  name: string;
  avatarUrl?: string;
  verified: boolean;
  rating: number;            // 0–5
  reviewCount: number;
  responseTime?: string;     // "~30 min"
}

export interface Listing {
  id: string;
  unitId: string;
  propertyId: string;
  title: string;
  mode: TransactionMode;
  propertyType: PropertyType;
  status: ListingStatus;
  verification: VerificationLevel;
  escrowProtected: boolean;

  // Price — minor units. For long_rent/lease this is the per-schedule rent.
  price: Kobo;
  currency: CurrencyCode;
  rentSchedule?: RentSchedule;       // long_rent / for_lease only
  nightlyPrice?: Kobo;               // short_stay only
  cautionDeposit?: Kobo;             // refundable, escrow-eligible
  serviceCharge?: Kobo;
  fees: FeeLine[];

  // Asset facts (denormalised from Unit/Property for fast cards)
  bedrooms: number;
  bathrooms: number;
  toilets: number;
  sizeSqm?: number;
  furnishing: Furnishing;
  area: string;
  city: string;
  state: string;
  geo?: GeoPoint;
  amenities: Amenity[];
  description: string;

  media: string[];                   // image urls; [0] is cover
  agent: AgentRef;

  inspectionRequired: boolean;
  /** Optional inspection fee (minor units) charged by some premium listings. */
  inspectionFee?: Kobo;
  applicationRequired: boolean;

  featured?: boolean;
  priceDropFrom?: Kobo;              // shows a price-drop chip
  createdAt: string;                // ISO
  viewCount?: number;
}

/** Compact card projection used by feeds/search results. */
export interface ListingCard {
  id: string;
  title: string;
  mode: TransactionMode;
  propertyType: PropertyType;
  price: Kobo;
  rentSchedule?: RentSchedule;
  nightlyPrice?: Kobo;
  verification: VerificationLevel;
  escrowProtected: boolean;
  bedrooms: number;
  bathrooms: number;
  area: string;
  city: string;
  coverUrl: string;
  featured?: boolean;
  priceDropFrom?: Kobo;
  agentVerified: boolean;
}

// ─── Search & filters ─────────────────────────────────────────────────────────

export type SortKey = 'newest' | 'price_asc' | 'price_desc' | 'verified_first' | 'popularity';

export interface ListingFilter {
  query?: string;
  mode?: TransactionMode;
  propertyType?: PropertyType;
  minPrice?: Kobo;
  maxPrice?: Kobo;
  area?: string;
  minBedrooms?: number;
  minBathrooms?: number;
  furnishing?: Furnishing;
  amenities?: Amenity[];
  verifiedOnly?: boolean;
  escrowOnly?: boolean;
  sort?: SortKey;
}

export interface MarketplaceHome {
  featured: ListingCard[];
  verified: ListingCard[];
  nearby: ListingCard[];
  newest: ListingCard[];
  recentlyViewed: ListingCard[];
  popularAreas: { area: string; city: string; listingCount: number }[];
}

// ─── Inspection booking (Listing → viewing) ──────────────────────────────────

export type ViewingMode = 'physical' | 'virtual';

export type InspectionStatus =
  | 'requested'
  | 'confirmed'
  | 'rescheduled'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface InspectionSlot {
  id: string;
  date: string;              // ISO date (yyyy-mm-dd)
  time: string;              // "10:00"
  available: boolean;
}

export interface InspectionDraft {
  listingId: string;
  slotId: string;
  date: string;
  time: string;
  viewingMode: ViewingMode;
  attendeeName: string;
  attendeePhone: string;
  note?: string;
}

export interface InspectionBooking {
  id: string;
  listingId: string;
  listingTitle: string;
  listingCoverUrl: string;
  area: string;
  city: string;
  address: string;
  geo?: GeoPoint;
  status: InspectionStatus;
  viewingMode: ViewingMode;
  date: string;
  time: string;
  attendeeName: string;
  attendeePhone: string;
  note?: string;
  agent: AgentRef;
  /** Optional inspection fee (minor units) — some premium listings charge one. */
  fee?: Kobo;
  /** Set once the inspection completes and the listing accepts applications. */
  canConvertToApplication: boolean;
  createdAt: string;
}

// ─── Rental application (Inspection → application) ────────────────────────────

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'more_info_required'
  | 'approved'
  | 'rejected'
  | 'offer_sent'
  | 'withdrawn';

export type EmploymentStatus =
  | 'employed'
  | 'self_employed'
  | 'business_owner'
  | 'student'
  | 'unemployed';

export interface ApplicationDraft {
  listingId: string;
  inspectionId?: string;
  // Personal
  fullName: string;
  email: string;
  phone: string;
  occupants: number;
  moveInDate: string;
  // Employment & income
  employmentStatus: EmploymentStatus;
  employerName?: string;
  monthlyIncome: Kobo;
  // Guarantor
  guarantorName: string;
  guarantorPhone: string;
  guarantorRelationship: string;
  // Consent
  screeningConsent: boolean;
}

export interface ApplicationDocument {
  id: string;
  label: string;
  uploaded: boolean;
  required: boolean;
}

export interface ApplicationTimelineStep {
  key: ApplicationStatus | 'lease' | 'payment' | 'move_in';
  label: string;
  state: 'done' | 'current' | 'upcoming';
  at?: string;
}

export interface RentalApplication {
  id: string;
  listingId: string;
  listingTitle: string;
  listingCoverUrl: string;
  area: string;
  city: string;
  inspectionId?: string;
  status: ApplicationStatus;
  rentSchedule: RentSchedule;
  rent: Kobo;
  cautionDeposit: Kobo;
  applicant: { fullName: string; email: string; phone: string };
  monthlyIncome: Kobo;
  documents: ApplicationDocument[];
  timeline: ApplicationTimelineStep[];
  reviewNote?: string;       // populated for more_info / rejected
  createdAt: string;
  agent: AgentRef;
}

// ─── Result envelope (mirrors money-mutation contract elsewhere) ──────────────

export interface MutationResult {
  ok: boolean;
  id: string;
}
