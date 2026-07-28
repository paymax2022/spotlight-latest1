// Estate Facilities / Amenities (Block 33) — types + dual mock/live api + constants.
import { api } from '@/api/client';
import { Colors } from '@/constants/colors';
import { generateIdempotencyKey } from '@/utils/idempotency';

export type FacilityKind = 'hall' | 'pool' | 'gym' | 'court' | 'park' | 'bbq' | 'parking' | 'other';
export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'refunded';

export interface Facility { id: string; estateId: string; name: string; kind: FacilityKind; capacity?: number; feeKobo: number; }
export interface FacilityBooking {
  id: string; estateId: string; facilityId: string; facilityName?: string; residentId: string;
  startsAt: string; endsAt: string; status: BookingStatus; amountKobo: number; createdAt: string;
}
export interface CreateBookingInput { facilityId: string; startsAt: string; endsAt: string; idempotencyKey: string; }

export const USE_MOCK = (process.env.EXPO_PUBLIC_FACILITIES_USE_MOCK ?? 'true') !== 'false';
export const FACILITIES_API_BASE = '/api/v1/estate/facilities';

export const KIND_META: Record<FacilityKind, { label: string; icon: string }> = {
  hall:    { label: 'Event Hall', icon: 'PartyPopper' },
  pool:    { label: 'Swimming Pool', icon: 'Waves' },
  gym:     { label: 'Gym', icon: 'Dumbbell' },
  court:   { label: 'Sports Court', icon: 'Volleyball' },
  park:    { label: 'Park', icon: 'Trees' },
  bbq:     { label: 'BBQ Area', icon: 'Flame' },
  parking: { label: 'Parking', icon: 'CircleParking' },
  other:   { label: 'Facility', icon: 'Building2' },
};
export const BOOKING_STATUS_META: Record<BookingStatus, { label: string; color: string; bg: string }> = {
  pending:   { label: 'Pending',   color: '#B26B00',      bg: 'rgba(245,158,11,0.12)' },
  confirmed: { label: 'Confirmed', color: '#16A34A',      bg: 'rgba(22,163,74,0.12)' },
  cancelled: { label: 'Cancelled', color: Colors.outline, bg: Colors.surfaceContainerLow },
  refunded:  { label: 'Refunded',  color: Colors.secondary, bg: Colors.iconBgBlue },
};

const H = 3_600_000, iso = (o: number) => new Date(Date.now() + o).toISOString();
const facilities: Facility[] = [
  { id: 'f1', estateId: 'est_amber_court', name: 'Amber Clubhouse', kind: 'hall', capacity: 120, feeKobo: 5_000_000 },
  { id: 'f2', estateId: 'est_amber_court', name: 'Estate Pool', kind: 'pool', capacity: 30, feeKobo: 0 },
  { id: 'f3', estateId: 'est_amber_court', name: 'Tennis Court', kind: 'court', capacity: 4, feeKobo: 1_500_000 },
  { id: 'f4', estateId: 'est_amber_court', name: 'Fitness Gym', kind: 'gym', capacity: 20, feeKobo: 0 },
];
let bookings: FacilityBooking[] = [
  { id: 'b1', estateId: 'est_amber_court', facilityId: 'f1', facilityName: 'Amber Clubhouse', residentId: 'res_demo', startsAt: iso(72 * H), endsAt: iso(78 * H), status: 'confirmed', amountKobo: 5_000_000, createdAt: iso(-20 * H) },
];
const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const idem = (k?: string) => ({ headers: { 'Idempotency-Key': k ?? generateIdempotencyKey() } });

export async function listFacilities(): Promise<Facility[]> {
  if (USE_MOCK) { await latency(); return facilities.slice(); }
  const { data } = await api.get<Facility[]>(FACILITIES_API_BASE); return data;
}
export async function listMyBookings(): Promise<FacilityBooking[]> {
  if (USE_MOCK) { await latency(); return bookings.slice().sort((a, b) => +new Date(b.startsAt) - +new Date(a.startsAt)); }
  const { data } = await api.get<FacilityBooking[]>(`${FACILITIES_API_BASE}/bookings`); return data;
}
export async function createBooking(input: CreateBookingInput): Promise<FacilityBooking> {
  if (USE_MOCK) {
    await latency(450); const f = facilities.find((x) => x.id === input.facilityId); if (!f) throw new Error('Facility not found');
    const b: FacilityBooking = { id: `b_${Date.now()}`, estateId: 'est_amber_court', facilityId: f.id, facilityName: f.name, residentId: 'res_demo', startsAt: input.startsAt, endsAt: input.endsAt, status: f.feeKobo > 0 ? 'pending' : 'confirmed', amountKobo: f.feeKobo, createdAt: new Date().toISOString() };
    bookings = [b, ...bookings]; return { ...b };
  }
  const { data } = await api.post<FacilityBooking>(`${FACILITIES_API_BASE}/bookings`, input, idem(input.idempotencyKey)); return data;
}
export async function cancelBooking(id: string): Promise<FacilityBooking> {
  if (USE_MOCK) { await latency(250); const b = bookings.find((x) => x.id === id); if (!b) throw new Error('Not found'); b.status = 'cancelled'; return { ...b }; }
  const { data } = await api.post<FacilityBooking>(`${FACILITIES_API_BASE}/bookings/${id}/cancel`, {}, idem()); return data;
}
