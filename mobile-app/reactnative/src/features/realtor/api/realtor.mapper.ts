// ── Spotlight Realtor — Supabase row mappers ─────────────────────────────────
// Maps realtor_* table rows (snake_case, joined graph) → domain types used by
// the screens. Mirrors src/api/mappers/*.mapper.ts. Money columns are BIGINT
// minor units (kobo) and pass through unchanged.

import type {
  Listing,
  ListingCard,
  AgentRef,
  InspectionBooking,
  RentalApplication,
  Amenity,
  PropertyType,
  Furnishing,
  TransactionMode,
  VerificationLevel,
  ListingStatus,
} from '../types/realtor.types';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DEFAULT_AGENT: AgentRef = { id: '', name: 'Listing agent', verified: false, rating: 0, reviewCount: 0 };

function mapAgent(row: any): AgentRef {
  if (!row) return DEFAULT_AGENT;
  return {
    id: row.id ?? row.agent_id ?? '',
    name: row.full_name ?? row.name ?? 'Listing agent',
    avatarUrl: row.avatar_url ?? undefined,
    verified: Boolean(row.verified),
    rating: Number(row.rating ?? 0),
    reviewCount: Number(row.review_count ?? 0),
    responseTime: row.response_time ?? undefined,
  };
}

/** A listing row with `unit:realtor_units(property:realtor_properties(*))` joined. */
export function mapListing(row: any): Listing {
  const unit = row.unit ?? {};
  const property = unit.property ?? {};
  const media: string[] = Array.isArray(row.media) ? row.media : [];
  return {
    id: row.id,
    unitId: row.unit_id,
    propertyId: unit.property_id ?? property.id ?? '',
    title: row.title,
    mode: row.mode as TransactionMode,
    propertyType: (unit.property_type ?? property.property_type ?? 'apartment') as PropertyType,
    status: row.status as ListingStatus,
    verification: row.verification as VerificationLevel,
    escrowProtected: Boolean(row.escrow_protected),
    price: Number(row.price_kobo ?? 0),
    currency: 'NGN',
    rentSchedule: row.rent_schedule ?? undefined,
    nightlyPrice: row.nightly_kobo != null ? Number(row.nightly_kobo) : undefined,
    cautionDeposit: row.caution_kobo != null ? Number(row.caution_kobo) : undefined,
    serviceCharge: row.service_charge_kobo != null ? Number(row.service_charge_kobo) : undefined,
    fees: Array.isArray(row.fees)
      ? row.fees.map((f: any) => ({ label: f.label, amount: Number(f.amount_kobo ?? f.amount ?? 0), refundable: f.refundable }))
      : [],
    bedrooms: Number(unit.bedrooms ?? 0),
    bathrooms: Number(unit.bathrooms ?? 0),
    toilets: Number(unit.toilets ?? 0),
    sizeSqm: unit.size_sqm != null ? Number(unit.size_sqm) : undefined,
    furnishing: (unit.furnishing ?? 'unfurnished') as Furnishing,
    area: property.area ?? '',
    city: property.city ?? '',
    state: property.state ?? '',
    geo: property.geo_lat != null ? { lat: Number(property.geo_lat), lng: Number(property.geo_lng) } : undefined,
    amenities: (Array.isArray(property.amenities) ? property.amenities : []) as Amenity[],
    description: row.description ?? '',
    media,
    agent: mapAgent(row.agent),
    inspectionRequired: Boolean(row.inspection_required),
    inspectionFee: row.inspection_fee_kobo != null ? Number(row.inspection_fee_kobo) : undefined,
    applicationRequired: Boolean(row.application_required),
    featured: Boolean(row.featured),
    priceDropFrom: row.price_drop_from_kobo != null ? Number(row.price_drop_from_kobo) : undefined,
    createdAt: row.created_at,
    viewCount: Number(row.view_count ?? 0),
  };
}

export function listingToCard(l: Listing): ListingCard {
  return {
    id: l.id,
    title: l.title,
    mode: l.mode,
    propertyType: l.propertyType,
    price: l.price,
    rentSchedule: l.rentSchedule,
    nightlyPrice: l.nightlyPrice,
    verification: l.verification,
    escrowProtected: l.escrowProtected,
    bedrooms: l.bedrooms,
    bathrooms: l.bathrooms,
    area: l.area,
    city: l.city,
    coverUrl: l.media[0] ?? '',
    featured: l.featured,
    priceDropFrom: l.priceDropFrom,
    agentVerified: l.agent.verified,
  };
}

export function mapInspection(row: any): InspectionBooking {
  const listing = row.listing ?? {};
  return {
    id: row.id,
    listingId: row.listing_id,
    listingTitle: listing.title ?? 'Property',
    listingCoverUrl: Array.isArray(listing.media) ? (listing.media[0] ?? '') : '',
    area: row.area ?? '',
    city: row.city ?? '',
    address: row.address ?? '',
    geo: row.geo_lat != null ? { lat: Number(row.geo_lat), lng: Number(row.geo_lng) } : undefined,
    status: row.status,
    viewingMode: row.viewing_mode,
    date: row.scheduled_date,
    time: row.scheduled_time,
    attendeeName: row.attendee_name,
    attendeePhone: row.attendee_phone,
    note: row.note ?? undefined,
    agent: mapAgent(row.agent),
    fee: row.fee_kobo != null ? Number(row.fee_kobo) : undefined,
    canConvertToApplication: row.status === 'completed',
    createdAt: row.created_at,
  };
}

export function mapApplication(row: any): RentalApplication {
  const listing = row.listing ?? {};
  return {
    id: row.id,
    listingId: row.listing_id,
    listingTitle: listing.title ?? 'Property',
    listingCoverUrl: Array.isArray(listing.media) ? (listing.media[0] ?? '') : '',
    area: row.area ?? '',
    city: row.city ?? '',
    inspectionId: row.inspection_id ?? undefined,
    status: row.status,
    rentSchedule: row.rent_schedule ?? listing.rent_schedule ?? 'annual',
    rent: Number(listing.price_kobo ?? row.rent_kobo ?? 0),
    cautionDeposit: Number(listing.caution_kobo ?? row.caution_kobo ?? 0),
    applicant: { fullName: row.full_name, email: row.email, phone: row.phone },
    monthlyIncome: Number(row.monthly_income_kobo ?? 0),
    documents: Array.isArray(row.documents) ? row.documents : [],
    timeline: Array.isArray(row.timeline) ? row.timeline : [],
    reviewNote: row.review_note ?? undefined,
    createdAt: row.created_at,
    agent: mapAgent(row.agent),
  };
}

/** Nested-select string for a listing joined to its unit + property + agent. */
export const LISTING_SELECT = `
  *,
  unit:realtor_units!unit_id(*, property:realtor_properties!property_id(*)),
  agent:user_profiles!agent_id(id, full_name, avatar_url)
`.trim();
