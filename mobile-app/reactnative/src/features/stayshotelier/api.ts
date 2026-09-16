// ── Stays hotelier extranet — API wrapper ────────────────────────────────────
// Owner/manager-facing property & room management against the Go backend
// (BASE /api/v1/stays/extranet, proxied to Go's /api/stays/extranet). Talks
// LIVE by default; set EXPO_PUBLIC_STAYS_HOTELIER_USE_MOCK=true for an offline
// in-memory stub. Mirrors the restaurant merchant module's shape (property ≈
// store, room type ≈ menu category, rate plan ≈ menu item) since the domains
// match closely and that module's self-serve pattern is what this reuses:
// no RBAC role to be granted first — creating a property stamps the caller as
// OWNER server-side, and every subsequent call is checked against that grant.
//
// Backend contract (mapped snake_case → camelCase here):
//   GET  /me/properties                                → my properties (id/name/city/status/role)
//   POST /properties                                    → create property, caller becomes OWNER
//   GET  /properties/:id                                → property content
//   PATCH /properties/:id                                → edit content
//   GET/POST /properties/:id/room-types                 → room types
//   GET/POST /properties/:id/rate-plans                  → rate plans
//   GET  /properties/:id/reservations?state&limit&offset → reservations dashboard

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import type {
  HotelierProperty,
  PropertyDetail,
  RoomType,
  RatePlan,
  HotelierReservation,
  CreatePropertyInput,
  CreateRoomTypeInput,
  CreateRatePlanInput,
  UpdatePropertyDetailsInput,
  UpdatePropertyContentInput,
  PropertyPhoto,
  VerificationStatus,
} from './types';

export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_STAYS_HOTELIER_USE_MOCK, false);

const BASE = '/api/v1/stays/extranet';
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

function mapMyProperty(p: any): HotelierProperty {
  return { id: p.id, name: p.name, city: p.city, status: p.status, role: p.role };
}
function mapDetail(p: any): PropertyDetail {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    address: p.address,
    city: p.city,
    starRating: p.star_rating ?? 0,
    propertyType: p.property_type,
    status: p.status,
    lat: p.lat ?? 0,
    lng: p.lng ?? 0,
    amenities: p.amenities ?? [],
    houseRules: p.house_rules ?? '',
    cancellationPolicy: p.cancellation_policy ?? 'FLEXIBLE',
    checkInFrom: p.check_in_from ?? '14:00',
    checkOutUntil: p.check_out_until ?? '12:00',
    contactPhone: p.contact_phone ?? '',
    contactEmail: p.contact_email ?? '',
  };
}
function mapPhoto(p: any): PropertyPhoto {
  return {
    id: p.id,
    roomTypeId: p.room_type_id || undefined,
    url: p.url ?? '',
    caption: p.caption ?? '',
    isCover: !!p.is_cover,
    sortOrder: p.sort_order ?? 0,
  };
}
function mapRoomType(r: any): RoomType {
  return { id: r.id, name: r.name, occupancy: r.occupancy, bedding: r.bedding ?? '', sizeSqm: r.size_sqm ?? 0 };
}
function mapRatePlan(r: any): RatePlan {
  return {
    id: r.id,
    roomTypeId: r.room_type_id,
    type: r.rate_plan_type,
    board: r.board ?? '',
    refundable: !!r.refundable,
    baseSellRateKobo: r.base_sell_rate_kobo ?? 0,
    currency: r.currency || 'NGN',
  };
}
function mapReservation(r: any): HotelierReservation {
  return {
    id: r.id,
    guestName: r.guest_name ?? '',
    checkIn: r.check_in,
    checkOut: r.check_out,
    state: r.state,
    totalKobo: r.total_kobo ?? 0,
  };
}

// ── Offline stub (only when USE_MOCK) ─────────────────────────────────────────
let mockProperties: PropertyDetail[] = [];
let mockRoomTypes: Record<string, RoomType[]> = {};
let mockRatePlans: Record<string, RatePlan[]> = {};
let mockPhotos: Record<string, PropertyPhoto[]> = {};
let seq = 0;
const nextId = (p: string) => `${p}-${(seq += 1)}`;
const delay = (ms = 220) => new Promise<void>((r) => setTimeout(r, ms));

// ── Properties ─────────────────────────────────────────────────────────────
export async function myProperties(): Promise<HotelierProperty[]> {
  if (USE_MOCK) {
    await delay();
    return mockProperties.map((p) => ({ id: p.id, name: p.name, city: p.city, status: p.status, role: 'OWNER' as const }));
  }
  const res = await api.get(`${BASE}/me/properties`);
  return (unwrap<any[]>(res) ?? []).map(mapMyProperty);
}

export async function createProperty(input: CreatePropertyInput): Promise<{ id: string }> {
  if (USE_MOCK) {
    await delay();
    const id = nextId('p');
    mockProperties.push({
      id, name: input.name, description: '', address: input.address, city: input.city,
      starRating: input.starRating ?? 0, propertyType: input.propertyType, status: 'DRAFT',
      lat: 0, lng: 0, amenities: [], houseRules: '', cancellationPolicy: 'FLEXIBLE',
      checkInFrom: '14:00', checkOutUntil: '12:00', contactPhone: '', contactEmail: '',
    });
    mockRoomTypes[id] = [];
    mockRatePlans[id] = [];
    mockPhotos[id] = [];
    return { id };
  }
  const res = await api.post(`${BASE}/properties`, {
    name: input.name,
    property_type: input.propertyType,
    address: input.address,
    city: input.city,
    star_rating: input.starRating ?? 0,
  });
  return unwrap<{ id: string }>(res);
}

export async function getProperty(propertyId: string): Promise<PropertyDetail> {
  if (USE_MOCK) {
    await delay();
    const p = mockProperties.find((x) => x.id === propertyId);
    if (!p) throw new Error('not found');
    return p;
  }
  const res = await api.get(`${BASE}/properties/${propertyId}`);
  return mapDetail(unwrap(res));
}

export async function updatePropertyContent(propertyId: string, input: UpdatePropertyContentInput): Promise<void> {
  if (USE_MOCK) {
    await delay();
    const p = mockProperties.find((x) => x.id === propertyId);
    if (p) Object.assign(p, input);
    return;
  }
  await api.patch(`${BASE}/properties/${propertyId}`, {
    name: input.name, description: input.description, address: input.address,
    city: input.city, star_rating: input.starRating, property_type: input.propertyType,
  });
}

export async function updatePropertyDetails(propertyId: string, input: UpdatePropertyDetailsInput): Promise<void> {
  if (USE_MOCK) {
    await delay();
    const p = mockProperties.find((x) => x.id === propertyId);
    if (p) Object.assign(p, input);
    return;
  }
  await api.patch(`${BASE}/properties/${propertyId}/details`, {
    lat: input.lat, lng: input.lng, amenities: input.amenities, house_rules: input.houseRules,
    cancellation_policy: input.cancellationPolicy, check_in_from: input.checkInFrom,
    check_out_until: input.checkOutUntil, contact_phone: input.contactPhone, contact_email: input.contactEmail,
  });
}

// ── Photos ─────────────────────────────────────────────────────────────────
// Upload is presign → PUT the picked bytes straight to R2 → confirm (persist the
// row). Mirrors the marketplace Sell composer's image upload exactly
// (src/features/marketplace/api/sell.api.ts uploadListingImage).
export async function listPhotos(propertyId: string): Promise<PropertyPhoto[]> {
  if (USE_MOCK) {
    await delay();
    return mockPhotos[propertyId] ?? [];
  }
  const res = await api.get(`${BASE}/properties/${propertyId}/photos`);
  return (unwrap<any[]>(res) ?? []).map(mapPhoto);
}

/** Full photo upload: presign → PUT the picked file's bytes → confirm. Returns
 *  the persisted photo (with a fetchable, freshly-presigned URL). */
export async function uploadPropertyPhoto(
  propertyId: string,
  file: { uri: string; mimeType: string },
  opts?: { roomTypeId?: string; caption?: string },
): Promise<PropertyPhoto> {
  if (USE_MOCK) {
    await delay();
    const photo: PropertyPhoto = {
      id: nextId('photo'), roomTypeId: opts?.roomTypeId, url: file.uri,
      caption: opts?.caption ?? '', isCover: (mockPhotos[propertyId] ?? []).length === 0,
      sortOrder: (mockPhotos[propertyId] ?? []).length,
    };
    mockPhotos[propertyId] = [...(mockPhotos[propertyId] ?? []), photo];
    return photo;
  }
  const presign = await api.post(`${BASE}/properties/${propertyId}/photos/presign`, { mime_type: file.mimeType });
  const { upload_url: uploadUrl, storage_key: storageKey } = unwrap<{ upload_url: string; storage_key: string }>(presign);
  const blob = await (await fetch(file.uri)).blob();
  const putRes = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': file.mimeType } });
  if (!putRes.ok) throw new Error(`Photo upload failed (${putRes.status})`);
  const created = await api.post(`${BASE}/properties/${propertyId}/photos`, {
    storage_key: storageKey, room_type_id: opts?.roomTypeId ?? '', caption: opts?.caption ?? '',
  });
  return mapPhoto(unwrap(created));
}

export async function setCoverPhoto(propertyId: string, photoId: string): Promise<void> {
  if (USE_MOCK) {
    await delay();
    const list = mockPhotos[propertyId] ?? [];
    mockPhotos[propertyId] = list.map((p) => ({ ...p, isCover: p.id === photoId }));
    return;
  }
  await api.patch(`${BASE}/properties/${propertyId}/photos/${photoId}`, { is_cover: true });
}

export async function updatePhotoCaption(propertyId: string, photoId: string, caption: string): Promise<void> {
  if (USE_MOCK) {
    await delay();
    const p = (mockPhotos[propertyId] ?? []).find((x) => x.id === photoId);
    if (p) p.caption = caption;
    return;
  }
  await api.patch(`${BASE}/properties/${propertyId}/photos/${photoId}`, { caption });
}

export async function deletePhoto(propertyId: string, photoId: string): Promise<void> {
  if (USE_MOCK) {
    await delay();
    const wasCover = (mockPhotos[propertyId] ?? []).find((p) => p.id === photoId)?.isCover;
    mockPhotos[propertyId] = (mockPhotos[propertyId] ?? []).filter((p) => p.id !== photoId);
    if (wasCover && mockPhotos[propertyId]?.length) mockPhotos[propertyId][0].isCover = true;
    return;
  }
  await api.delete(`${BASE}/properties/${propertyId}/photos/${photoId}`);
}

// ── Room types ─────────────────────────────────────────────────────────────
export async function listRoomTypes(propertyId: string): Promise<RoomType[]> {
  if (USE_MOCK) {
    await delay();
    return mockRoomTypes[propertyId] ?? [];
  }
  const res = await api.get(`${BASE}/properties/${propertyId}/room-types`);
  return (unwrap<any[]>(res) ?? []).map(mapRoomType);
}

export async function createRoomType(propertyId: string, input: CreateRoomTypeInput): Promise<{ id: string }> {
  if (USE_MOCK) {
    await delay();
    const id = nextId('rt');
    const rt: RoomType = { id, name: input.name, occupancy: input.occupancy, bedding: input.bedding ?? '', sizeSqm: 0 };
    mockRoomTypes[propertyId] = [...(mockRoomTypes[propertyId] ?? []), rt];
    return { id };
  }
  const res = await api.post(`${BASE}/properties/${propertyId}/room-types`, {
    name: input.name,
    occupancy: input.occupancy,
    bedding: input.bedding ?? '',
  });
  return unwrap<{ id: string }>(res);
}

// ── Rate plans ─────────────────────────────────────────────────────────────
export async function listRatePlans(propertyId: string): Promise<RatePlan[]> {
  if (USE_MOCK) {
    await delay();
    return mockRatePlans[propertyId] ?? [];
  }
  const res = await api.get(`${BASE}/properties/${propertyId}/rate-plans`);
  return (unwrap<any[]>(res) ?? []).map(mapRatePlan);
}

export async function createRatePlan(propertyId: string, input: CreateRatePlanInput): Promise<{ id: string }> {
  if (USE_MOCK) {
    await delay();
    const id = nextId('rp');
    const rp: RatePlan = {
      id, roomTypeId: input.roomTypeId, type: input.type, board: '', refundable: input.refundable,
      baseSellRateKobo: input.baseSellRateKobo, currency: 'NGN',
    };
    mockRatePlans[propertyId] = [...(mockRatePlans[propertyId] ?? []), rp];
    return { id };
  }
  const res = await api.post(`${BASE}/properties/${propertyId}/rate-plans`, {
    room_type_id: input.roomTypeId,
    rate_plan_type: input.type,
    refundable: input.refundable,
    base_sell_rate_kobo: input.baseSellRateKobo,
    currency: 'NGN',
  });
  return unwrap<{ id: string }>(res);
}

// ── Reservations ───────────────────────────────────────────────────────────
export async function listReservations(propertyId: string): Promise<HotelierReservation[]> {
  if (USE_MOCK) {
    await delay();
    return [];
  }
  const res = await api.get(`${BASE}/properties/${propertyId}/reservations`, { params: { limit: 50 } });
  return (unwrap<any[]>(res) ?? []).map(mapReservation);
}

// ── Go-live verification ──────────────────────────────────────────────────
// Not property-scoped: the backend resolves "the caller's primary property"
// (ResolvePrimaryProperty) rather than taking a :propertyId — a hotelier is
// assumed to be onboarding one property at a time.
function mapVerification(v: any): VerificationStatus {
  return {
    propertyId: v.property_id,
    propertyName: v.property_name,
    overall: v.overall,
    goLiveEligible: !!v.go_live_eligible,
    submittedForReviewAt: v.submitted_for_review_at ?? null,
    reviewedAt: v.reviewed_at ?? null,
    reviewerNote: v.reviewer_note ?? null,
    checklist: (v.checklist ?? []).map((c: any) => ({
      key: c.key, label: c.label, stage: c.stage, status: c.status, detail: c.detail, required: !!c.required,
    })),
  };
}

export async function getVerificationStatus(propertyId: string): Promise<VerificationStatus> {
  if (USE_MOCK) {
    await delay();
    const p = mockProperties.find((x) => x.id === propertyId);
    const photos = mockPhotos[propertyId] ?? [];
    const roomTypes = mockRoomTypes[propertyId] ?? [];
    const ratePlans = mockRatePlans[propertyId] ?? [];
    const checklist = [
      { key: 'signup', label: 'Hotelier account created', stage: 'signup', status: 'approved' as const, required: true },
      { key: 'property', label: 'Property registered (name, type, address, city)', stage: 'property', status: p?.address ? 'approved' as const : 'in_progress' as const, required: true },
      { key: 'content', label: 'Property description and at least one room type with a rate plan', stage: 'content', status: (p?.description && roomTypes.length && ratePlans.length) ? 'approved' as const : 'in_progress' as const, required: true },
      { key: 'photos', label: 'At least 8 photos uploaded (cover set)', stage: 'content', status: photos.length >= 8 ? 'approved' as const : 'in_progress' as const, required: true, detail: photos.length >= 8 ? undefined : `You have ${photos.length} — add ${8 - photos.length} more to go live.` },
      { key: 'policies', label: 'Policies configured (check-in/out, cancellation, house rules)', stage: 'policies', status: p?.houseRules ? 'approved' as const : 'in_progress' as const, required: false },
      { key: 'availability', label: 'Availability & rates loaded (next 90 days)', stage: 'go_live', status: 'in_progress' as const, required: true },
    ];
    return {
      propertyId, propertyName: p?.name ?? '', overall: 'pending', goLiveEligible: false, checklist,
    };
  }
  const res = await api.get(`${BASE}/verification`);
  return mapVerification(unwrap(res));
}

export async function submitForReview(): Promise<VerificationStatus> {
  if (USE_MOCK) {
    await delay();
    throw new Error('Submitting for review is unavailable in fixture mode — switch to the live backend.');
  }
  const res = await api.post(`${BASE}/verification/submit`, {});
  return mapVerification(unwrap(res));
}
