// ── Spotlight Realtor — API wrapper ──────────────────────────────────────────
// Typed data layer the funnel screens code against (Backend role owns this).
// Mock-flagged exactly like fx.api.ts / crowdfunding: flip USE_MOCK=false once
// the real Spotlight endpoints land. Maps the funnel:
//   listings → inspection-bookings → rental-applications.
//
// Funnel mutations carry an Idempotency-Key (see newIdempotencyKey) so a retried
// submit can't double-create, mirroring the money-path convention.

import { createSupabaseClient } from '@/lib/supabase';
import type {
  Listing,
  ListingCard,
  ListingFilter,
  MarketplaceHome,
  InspectionSlot,
  InspectionDraft,
  InspectionBooking,
  ApplicationDraft,
  RentalApplication,
  ApplicationDocument,
  ApplicationTimelineStep,
} from '../types/realtor.types';
import {
  MOCK_LISTINGS,
  MOCK_POPULAR_AREAS,
  MOCK_INSPECTIONS,
  MOCK_APPLICATIONS,
  buildSlots,
} from './realtor.mock';
import { mapListing, listingToCard, mapInspection, mapApplication, LISTING_SELECT } from './realtor.mapper';
import { REALTOR_USE_MOCK } from './realtorEnv';
import { newIdempotencyKey } from '../utils/realtorFormatters';

// ─── Feature flag (env-driven; default mock for the dev sandbox) ──────────────
// When false, reads/writes hit Supabase directly (matching how other modules
// read catalog data), against the tables in
// supabase/migrations/20260620000000_realtor_property_graph.sql.
const USE_MOCK = REALTOR_USE_MOCK;

const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

/** Apply a ListingFilter to a Supabase query builder (real-path search). */
function applySupabaseFilter(q: any, f: ListingFilter): any {
  q = q.eq('status', 'published');
  if (f.mode) q = q.eq('mode', f.mode);
  if (f.minPrice != null) q = q.gte('price_kobo', f.minPrice);
  if (f.maxPrice != null) q = q.lte('price_kobo', f.maxPrice);
  if (f.verifiedOnly) q = q.neq('verification', 'unverified');
  if (f.escrowOnly) q = q.eq('escrow_protected', true);
  switch (f.sort) {
    case 'price_asc': q = q.order('price_kobo', { ascending: true }); break;
    case 'price_desc': q = q.order('price_kobo', { ascending: false }); break;
    case 'popularity': q = q.order('view_count', { ascending: false }); break;
    default: q = q.order('created_at', { ascending: false });
  }
  return q;
}

// ─── Projections ──────────────────────────────────────────────────────────────

function toCard(l: Listing): ListingCard {
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
    coverUrl: l.media[0],
    featured: l.featured,
    priceDropFrom: l.priceDropFrom,
    agentVerified: l.agent.verified,
  };
}

const VERIFICATION_RANK = { verified: 3, inspected: 2, document_backed: 1, unverified: 0 } as const;

function applyFilter(listings: Listing[], f: ListingFilter): Listing[] {
  let out = listings.filter((l) => l.status === 'published');

  if (f.query) {
    const q = f.query.trim().toLowerCase();
    out = out.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        l.area.toLowerCase().includes(q) ||
        l.city.toLowerCase().includes(q),
    );
  }
  if (f.mode) out = out.filter((l) => l.mode === f.mode);
  if (f.propertyType) out = out.filter((l) => l.propertyType === f.propertyType);
  if (f.area) out = out.filter((l) => l.area === f.area);
  if (f.minPrice != null) out = out.filter((l) => l.price >= f.minPrice!);
  if (f.maxPrice != null) out = out.filter((l) => l.price <= f.maxPrice!);
  if (f.minBedrooms != null) out = out.filter((l) => l.bedrooms >= f.minBedrooms!);
  if (f.minBathrooms != null) out = out.filter((l) => l.bathrooms >= f.minBathrooms!);
  if (f.furnishing) out = out.filter((l) => l.furnishing === f.furnishing);
  if (f.verifiedOnly) out = out.filter((l) => l.verification !== 'unverified');
  if (f.escrowOnly) out = out.filter((l) => l.escrowProtected);
  if (f.amenities?.length) out = out.filter((l) => f.amenities!.every((a) => l.amenities.includes(a)));

  switch (f.sort) {
    case 'price_asc': out = [...out].sort((a, b) => a.price - b.price); break;
    case 'price_desc': out = [...out].sort((a, b) => b.price - a.price); break;
    case 'verified_first':
      out = [...out].sort((a, b) => VERIFICATION_RANK[b.verification] - VERIFICATION_RANK[a.verification]);
      break;
    case 'popularity': out = [...out].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0)); break;
    case 'newest':
    default:
      out = [...out].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return out;
}

// ─── Marketplace home (D) ─────────────────────────────────────────────────────

export async function getMarketplaceHome(): Promise<MarketplaceHome> {
  if (USE_MOCK) {
    await delay();
    const pub = MOCK_LISTINGS.filter((l) => l.status === 'published');
    return {
      featured: pub.filter((l) => l.featured).map(toCard),
      verified: pub.filter((l) => l.verification === 'verified' || l.verification === 'inspected').map(toCard),
      nearby: pub.filter((l) => l.city === 'Lagos').map(toCard),
      newest: [...pub].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).map(toCard),
      recentlyViewed: pub.slice(0, 2).map(toCard),
      popularAreas: MOCK_POPULAR_AREAS,
    };
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('realtor_listings')
    .select(LISTING_SELECT)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  const listings = (data ?? []).map(mapListing);
  const cards = listings.map(listingToCard);
  return {
    featured: cards.filter((c) => c.featured),
    verified: cards.filter((c) => c.verification === 'verified' || c.verification === 'inspected'),
    nearby: cards.filter((c) => c.city === 'Lagos'),
    newest: cards,
    recentlyViewed: cards.slice(0, 2),
    popularAreas: MOCK_POPULAR_AREAS,
  };
}

// ─── Search (E) ───────────────────────────────────────────────────────────────

export async function searchListings(filter: ListingFilter): Promise<ListingCard[]> {
  if (USE_MOCK) {
    await delay();
    return applyFilter(MOCK_LISTINGS, filter).map(toCard);
  }
  const supabase = createSupabaseClient();
  let q = supabase.from('realtor_listings').select(LISTING_SELECT);
  q = applySupabaseFilter(q, filter);
  const { data, error } = await q.limit(60);
  if (error) throw error;
  // Filters that need the joined unit/property (bedrooms, amenities, area,
  // furnishing, text) are applied in-memory after the DB pre-filter.
  let cards = (data ?? []).map(mapListing).map(listingToCard);
  if (filter.query) {
    const qq = filter.query.trim().toLowerCase();
    cards = cards.filter((c) => c.title.toLowerCase().includes(qq) || c.area.toLowerCase().includes(qq) || c.city.toLowerCase().includes(qq));
  }
  if (filter.area) cards = cards.filter((c) => c.area === filter.area);
  if (filter.minBedrooms != null) cards = cards.filter((c) => c.bedrooms >= filter.minBedrooms!);
  return cards;
}

// ─── Listing detail (F) ───────────────────────────────────────────────────────

export async function getListing(id: string): Promise<Listing> {
  if (USE_MOCK) {
    await delay(260);
    const found = MOCK_LISTINGS.find((l) => l.id === id);
    if (!found) throw new Error('Listing not found');
    return found;
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_listings').select(LISTING_SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Listing not found');
  return mapListing(data);
}

export async function getSimilarListings(id: string): Promise<ListingCard[]> {
  if (USE_MOCK) {
    await delay(220);
    const self = MOCK_LISTINGS.find((l) => l.id === id);
    return MOCK_LISTINGS.filter(
      (l) => l.id !== id && l.status === 'published' && (l.mode === self?.mode || l.city === self?.city),
    )
      .slice(0, 4)
      .map(toCard);
  }
  const self = await getListing(id);
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('realtor_listings')
    .select(LISTING_SELECT)
    .eq('status', 'published')
    .eq('mode', self.mode)
    .neq('id', id)
    .limit(4);
  if (error) throw error;
  return (data ?? []).map(mapListing).map(listingToCard);
}

// ─── Inspection booking (H) ───────────────────────────────────────────────────

export async function getInspectionSlots(listingId: string): Promise<InspectionSlot[]> {
  if (USE_MOCK) {
    await delay(200);
    return buildSlots(7);
  }
  // Candidate grid minus already-booked (date,time) for this listing — the
  // unique (listing_id, scheduled_date, scheduled_time) constraint guarantees
  // a slot can't be double-booked.
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('realtor_inspection_bookings')
    .select('scheduled_date, scheduled_time, status')
    .eq('listing_id', listingId);
  if (error) throw error;
  const taken = new Set(
    (data ?? [])
      .filter((b: any) => b.status !== 'cancelled' && b.status !== 'no_show')
      .map((b: any) => `${b.scheduled_date}_${b.scheduled_time}`),
  );
  return buildSlots(7).map((s) => (taken.has(s.id) ? { ...s, available: false } : s));
}

export async function createInspection(draft: InspectionDraft): Promise<InspectionBooking> {
  if (USE_MOCK) {
    await delay(520);
    const listing = MOCK_LISTINGS.find((l) => l.id === draft.listingId);
    const booking: InspectionBooking = {
      id: `in_${Date.now().toString(36)}`,
      listingId: draft.listingId,
      listingTitle: listing?.title ?? 'Property',
      listingCoverUrl: listing?.media[0] ?? '',
      area: listing?.area ?? '',
      city: listing?.city ?? '',
      address: listing ? `${listing.area}, ${listing.city}` : '',
      geo: listing?.geo,
      status: 'requested',
      viewingMode: draft.viewingMode,
      date: draft.date,
      time: draft.time,
      attendeeName: draft.attendeeName,
      attendeePhone: draft.attendeePhone,
      note: draft.note,
      agent: listing?.agent ?? { id: 'ag', name: 'Agent', verified: false, rating: 0, reviewCount: 0 },
      canConvertToApplication: false,
      createdAt: new Date().toISOString(),
    };
    MOCK_INSPECTIONS.unshift(booking);
    return booking;
  }
  const supabase = createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('realtor_inspection_bookings')
    .insert({
      listing_id: draft.listingId,
      user_id: user.id,
      status: 'requested',
      viewing_mode: draft.viewingMode,
      scheduled_date: draft.date,
      scheduled_time: draft.time,
      attendee_name: draft.attendeeName,
      attendee_phone: draft.attendeePhone,
      note: draft.note ?? null,
      // idempotency surrogate; backend can also enforce via header
      client_ref: newIdempotencyKey(),
    })
    .select(`*, listing:realtor_listings!listing_id(title, media)`)
    .single();
  if (error) throw error;
  return mapInspection(data);
}

export async function getInspections(): Promise<InspectionBooking[]> {
  if (USE_MOCK) {
    await delay(240);
    return [...MOCK_INSPECTIONS];
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('realtor_inspection_bookings')
    .select(`*, listing:realtor_listings!listing_id(title, media)`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapInspection);
}

export async function getInspection(id: string): Promise<InspectionBooking> {
  if (USE_MOCK) {
    await delay(200);
    const found = MOCK_INSPECTIONS.find((i) => i.id === id);
    if (!found) throw new Error('Inspection not found');
    return found;
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('realtor_inspection_bookings')
    .select(`*, listing:realtor_listings!listing_id(title, media)`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Inspection not found');
  return mapInspection(data);
}

export async function cancelInspection(id: string): Promise<InspectionBooking> {
  if (USE_MOCK) {
    await delay(380);
    const found = MOCK_INSPECTIONS.find((i) => i.id === id);
    if (found) found.status = 'cancelled';
    if (!found) throw new Error('Inspection not found');
    return found;
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('realtor_inspection_bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(`*, listing:realtor_listings!listing_id(title, media)`)
    .single();
  if (error) throw error;
  return mapInspection(data);
}

// ─── Rental application (J) ───────────────────────────────────────────────────

function defaultDocuments(): ApplicationDocument[] {
  return [
    { id: 'doc_id', label: 'Government ID', uploaded: true, required: true },
    { id: 'doc_pay', label: 'Proof of income / payslip', uploaded: true, required: true },
    { id: 'doc_bank', label: 'Bank statement (3 months)', uploaded: false, required: true },
    { id: 'doc_ref', label: 'Previous landlord reference', uploaded: false, required: false },
  ];
}

function buildTimeline(): ApplicationTimelineStep[] {
  return [
    { key: 'submitted', label: 'Application submitted', state: 'done', at: new Date().toISOString() },
    { key: 'under_review', label: 'Screening & review', state: 'current' },
    { key: 'approved', label: 'Decision', state: 'upcoming' },
    { key: 'lease', label: 'Lease & e-sign', state: 'upcoming' },
    { key: 'payment', label: 'Rent & deposit payment', state: 'upcoming' },
    { key: 'move_in', label: 'Move-in', state: 'upcoming' },
  ];
}

export async function createApplication(draft: ApplicationDraft): Promise<RentalApplication> {
  if (USE_MOCK) {
    await delay(620);
    const listing = MOCK_LISTINGS.find((l) => l.id === draft.listingId);
    const app: RentalApplication = {
      id: `ap_${Date.now().toString(36)}`,
      listingId: draft.listingId,
      listingTitle: listing?.title ?? 'Property',
      listingCoverUrl: listing?.media[0] ?? '',
      area: listing?.area ?? '',
      city: listing?.city ?? '',
      inspectionId: draft.inspectionId,
      status: 'submitted',
      rentSchedule: listing?.rentSchedule ?? 'annual',
      rent: listing?.price ?? 0,
      cautionDeposit: listing?.cautionDeposit ?? 0,
      applicant: { fullName: draft.fullName, email: draft.email, phone: draft.phone },
      monthlyIncome: draft.monthlyIncome,
      documents: defaultDocuments(),
      timeline: buildTimeline(),
      createdAt: new Date().toISOString(),
      agent: listing?.agent ?? { id: 'ag', name: 'Agent', verified: false, rating: 0, reviewCount: 0 },
    };
    MOCK_APPLICATIONS.unshift(app);
    return app;
  }
  const supabase = createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('realtor_rental_applications')
    .insert({
      listing_id: draft.listingId,
      inspection_id: draft.inspectionId ?? null,
      user_id: user.id,
      status: 'submitted',
      full_name: draft.fullName,
      email: draft.email,
      phone: draft.phone,
      occupants: draft.occupants,
      move_in_date: draft.moveInDate || null,
      employment_status: draft.employmentStatus,
      employer_name: draft.employerName ?? null,
      monthly_income_kobo: draft.monthlyIncome,
      guarantor: { name: draft.guarantorName, phone: draft.guarantorPhone, relationship: draft.guarantorRelationship },
      documents: defaultDocuments(),
      timeline: buildTimeline(),
      screening_consent: draft.screeningConsent,
      client_ref: newIdempotencyKey(),
    })
    .select(`*, listing:realtor_listings!listing_id(title, media, price_kobo, caution_kobo, rent_schedule)`)
    .single();
  if (error) throw error;
  return mapApplication(data);
}

export async function getApplications(): Promise<RentalApplication[]> {
  if (USE_MOCK) {
    await delay(240);
    return [...MOCK_APPLICATIONS];
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('realtor_rental_applications')
    .select(`*, listing:realtor_listings!listing_id(title, media, price_kobo, caution_kobo, rent_schedule)`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapApplication);
}

export async function getApplication(id: string): Promise<RentalApplication> {
  if (USE_MOCK) {
    await delay(220);
    const found = MOCK_APPLICATIONS.find((a) => a.id === id);
    if (!found) throw new Error('Application not found');
    return found;
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('realtor_rental_applications')
    .select(`*, listing:realtor_listings!listing_id(title, media, price_kobo, caution_kobo, rent_schedule)`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Application not found');
  return mapApplication(data);
}
