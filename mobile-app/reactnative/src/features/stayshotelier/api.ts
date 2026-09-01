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
    });
    mockRoomTypes[id] = [];
    mockRatePlans[id] = [];
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
