// ── Spotlight Realtor — Hotel + channel sync data layer (V3) ─────────────────
// Mock by default (REALTOR_USE_MOCK). Real branch hits the hotel tables in
// migration 20260620040000 + realtor_book_hotel_room RPC (availability-safe).

import { createSupabaseClient } from '@/lib/supabase';
import { REALTOR_USE_MOCK } from './realtorEnv';
import { newIdempotencyKey } from '../utils/realtorFormatters';
import type {
  HotelCard, Hotel, RoomType, HotelReservation, HotelBookingDraft,
  HotelDeskSummary, HotelArrival, RoomBoardItem, ChannelSyncState, ChannelKey,
} from '../types/realtor.hotel.types';

const USE_MOCK = REALTOR_USE_MOCK;
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const IMG = (s: string) => `https://picsum.photos/seed/${s}/800/600`;

/* eslint-disable @typescript-eslint/no-explicit-any */

const HOTELS: Hotel[] = [
  {
    id: 'ht_1', name: 'The Lekki Grand', area: 'Lekki Phase 1', city: 'Lagos', coverUrl: IMG('hotel1'),
    starRating: 5, fromNightly: 95_000_00, reviewScore: 9.1,
    description: 'A contemporary 5-star hotel moments from the waterfront, with a rooftop pool, spa and 24/7 power.',
    amenities: ['pool', 'gym', 'wifi', 'power_backup', 'parking', 'air_conditioning', 'security'],
    media: [IMG('hotel1a'), IMG('hotel1b'), IMG('hotel1c')],
    roomTypes: [
      { id: 'rt_1', hotelId: 'ht_1', name: 'Deluxe King', capacity: 2, totalRooms: 12, availableRooms: 5, amenities: ['wifi', 'air_conditioning'], photoUrl: IMG('room1'),
        ratePlans: [
          { id: 'rp_1', name: 'Room only', nightly: 95_000_00, refundable: false, includesBreakfast: false },
          { id: 'rp_2', name: 'Bed & breakfast', nightly: 110_000_00, refundable: true, includesBreakfast: true },
        ] },
      { id: 'rt_2', hotelId: 'ht_1', name: 'Executive Suite', capacity: 3, totalRooms: 6, availableRooms: 2, amenities: ['wifi', 'air_conditioning', 'pool'], photoUrl: IMG('room2'),
        ratePlans: [
          { id: 'rp_3', name: 'Flexible', nightly: 180_000_00, refundable: true, includesBreakfast: true },
        ] },
    ],
  },
  {
    id: 'ht_2', name: 'Maitama Suites', area: 'Maitama', city: 'Abuja', coverUrl: IMG('hotel2'),
    starRating: 4, fromNightly: 60_000_00, reviewScore: 8.6,
    description: 'Quiet serviced suites in the heart of Maitama, ideal for business stays.',
    amenities: ['wifi', 'power_backup', 'parking', 'gym', 'security'],
    media: [IMG('hotel2a'), IMG('hotel2b')],
    roomTypes: [
      { id: 'rt_3', hotelId: 'ht_2', name: 'Studio Suite', capacity: 2, totalRooms: 20, availableRooms: 9, amenities: ['wifi', 'air_conditioning'], photoUrl: IMG('room3'),
        ratePlans: [{ id: 'rp_4', name: 'Room only', nightly: 60_000_00, refundable: false, includesBreakfast: false }] },
    ],
  },
];

const reservations: Record<string, HotelReservation> = {};

const ROOM_BOARD: RoomBoardItem[] = [
  { id: 'rm1', number: '201', roomTypeName: 'Deluxe King', status: 'occupied', guestName: 'A. Okonkwo', checkoutDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) },
  { id: 'rm2', number: '202', roomTypeName: 'Deluxe King', status: 'dirty' },
  { id: 'rm3', number: '203', roomTypeName: 'Deluxe King', status: 'available' },
  { id: 'rm4', number: '301', roomTypeName: 'Executive Suite', status: 'cleaning' },
  { id: 'rm5', number: '302', roomTypeName: 'Executive Suite', status: 'inspected' },
  { id: 'rm6', number: '303', roomTypeName: 'Executive Suite', status: 'out_of_service' },
];

const CHANNELS: ChannelSyncState = {
  lastFullSyncAt: new Date(Date.now() - 3_600_000).toISOString(),
  connections: [
    { key: 'airbnb', name: 'Airbnb', connected: true, lastSyncAt: new Date(Date.now() - 3_600_000).toISOString(), mappedUnits: 8, status: 'ok' },
    { key: 'booking_com', name: 'Booking.com', connected: true, lastSyncAt: new Date(Date.now() - 7_200_000).toISOString(), mappedUnits: 6, status: 'error' },
    { key: 'expedia', name: 'Expedia', connected: false, mappedUnits: 0, status: 'idle' },
  ],
  conflicts: [
    { id: 'cf1', unitOrRoom: 'Deluxe King 202', channel: 'booking_com', date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), reason: 'Double booking' },
  ],
};

function nightsBetween(a: string, b: string) { return Math.max(1, Math.round((+new Date(b) - +new Date(a)) / 86_400_000)); }

// ── Guest API ────────────────────────────────────────────────────────────────
export async function searchHotels(query?: string): Promise<HotelCard[]> {
  if (USE_MOCK) {
    await delay();
    const q = (query ?? '').trim().toLowerCase();
    return HOTELS.filter((h) => !q || h.name.toLowerCase().includes(q) || h.area.toLowerCase().includes(q) || h.city.toLowerCase().includes(q))
      .map(({ roomTypes, media, description, amenities, ...card }) => card);
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_hotels').select('*').limit(40);
  if (error) throw error;
  return (data ?? []).map((h: any) => ({ id: h.id, name: h.name, area: h.area, city: h.city, coverUrl: Array.isArray(h.media) ? h.media[0] : '', starRating: h.star_rating, fromNightly: Number(h.from_nightly_kobo ?? 0), reviewScore: Number(h.review_score ?? 0) }));
}

export async function getHotel(id: string): Promise<Hotel> {
  if (USE_MOCK) { await delay(220); const h = HOTELS.find((x) => x.id === id); if (!h) throw new Error('Hotel not found'); return h; }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_hotels').select('*, room_types:realtor_room_types(*)').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Hotel not found');
  return {
    id: data.id, name: data.name, area: data.area, city: data.city, coverUrl: Array.isArray(data.media) ? data.media[0] : '',
    starRating: data.star_rating, fromNightly: Number(data.from_nightly_kobo ?? 0), reviewScore: Number(data.review_score ?? 0),
    description: data.description ?? '', amenities: data.amenities ?? [], media: data.media ?? [],
    roomTypes: (data.room_types ?? []).map((rt: any) => ({
      id: rt.id, hotelId: rt.hotel_id, name: rt.name, capacity: rt.capacity, totalRooms: rt.total_rooms,
      availableRooms: rt.available_rooms, ratePlans: rt.rate_plans ?? [], amenities: rt.amenities ?? [], photoUrl: rt.photo_url ?? '',
    })),
  };
}

export async function bookHotel(draft: HotelBookingDraft): Promise<HotelReservation> {
  if (USE_MOCK) {
    await delay(640);
    const hotel = HOTELS.find((h) => h.id === draft.hotelId);
    const rt = hotel?.roomTypes.find((t) => t.id === draft.roomTypeId);
    const rp = rt?.ratePlans.find((p) => p.id === draft.ratePlanId) ?? rt?.ratePlans[0];
    const nights = nightsBetween(draft.checkIn, draft.checkOut);
    const id = `hr_${Date.now().toString(36)}`;
    const res: HotelReservation = {
      id, hotelId: draft.hotelId, hotelName: hotel?.name ?? 'Hotel', roomTypeName: rt?.name ?? 'Room',
      ratePlanName: rp?.name ?? 'Room only', checkIn: draft.checkIn, checkOut: draft.checkOut, nights, guests: draft.guests,
      total: (rp?.nightly ?? 0) * nights, status: 'confirmed',
      confirmationCode: newIdempotencyKey().slice(3, 11).toUpperCase(), createdAt: new Date().toISOString(),
    };
    reservations[id] = res;
    return res;
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.rpc('realtor_book_hotel_room', {
    p_hotel_id: draft.hotelId, p_room_type_id: draft.roomTypeId, p_rate_plan_id: draft.ratePlanId,
    p_check_in: draft.checkIn, p_check_out: draft.checkOut, p_guests: draft.guests,
    p_guest_name: draft.guestName, p_guest_phone: draft.guestPhone, p_special_request: draft.specialRequest ?? null,
    p_client_ref: newIdempotencyKey(),
  });
  if (error) {
    if (String(error.message).includes('sold_out')) throw new Error('That room type is sold out for those dates.');
    throw error;
  }
  return mapReservation(data);
}

function mapReservation(row: any): HotelReservation {
  return {
    id: row.id, hotelId: row.hotel_id, hotelName: row.hotel_name ?? 'Hotel', roomTypeName: row.room_type_name ?? 'Room',
    ratePlanName: row.rate_plan_name ?? '', checkIn: row.check_in, checkOut: row.check_out, nights: Number(row.nights),
    guests: Number(row.guests), total: Number(row.total_kobo), status: row.status,
    confirmationCode: row.confirmation_code ?? '', roomNumber: row.room_number ?? undefined, createdAt: row.created_at,
  };
}

export async function getReservation(id: string): Promise<HotelReservation> {
  if (USE_MOCK) { await delay(200); const r = reservations[id]; if (!r) throw new Error('Reservation not found'); return r; }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_hotel_reservations').select('*, hotel:realtor_hotels!hotel_id(name)').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Reservation not found');
  return mapReservation({ ...data, hotel_name: (data as any).hotel?.name });
}

// ── Front desk / housekeeping ────────────────────────────────────────────────
export async function getDeskSummary(): Promise<HotelDeskSummary> {
  if (USE_MOCK) {
    await delay(260);
    const occupied = ROOM_BOARD.filter((r) => r.status === 'occupied').length;
    return { arrivalsToday: 7, departuresToday: 4, occupancyPct: Math.round((occupied / ROOM_BOARD.length) * 100), dirtyRooms: ROOM_BOARD.filter((r) => r.status === 'dirty').length, available: ROOM_BOARD.filter((r) => r.status === 'available').length, revenueTodayKobo: 1_240_000_00 };
  }
  // Real: aggregate from realtor_hotel_rooms + today's reservations (kept simple).
  const supabase = createSupabaseClient();
  const { data } = await supabase.from('realtor_hotel_rooms').select('status');
  const rooms = data ?? [];
  const occupied = rooms.filter((r: any) => r.status === 'occupied').length;
  return { arrivalsToday: 0, departuresToday: 0, occupancyPct: rooms.length ? Math.round((occupied / rooms.length) * 100) : 0, dirtyRooms: rooms.filter((r: any) => r.status === 'dirty').length, available: rooms.filter((r: any) => r.status === 'available').length, revenueTodayKobo: 0 };
}

export async function getArrivals(): Promise<HotelArrival[]> {
  if (USE_MOCK) {
    await delay(220);
    return [
      { reservationId: 'a1', guestName: 'Chidi Eze', roomTypeName: 'Deluxe King', nights: 2, status: 'confirmed' },
      { reservationId: 'a2', guestName: 'Funmi Bello', roomTypeName: 'Executive Suite', nights: 4, status: 'confirmed' },
      { reservationId: 'a3', guestName: 'Ola Smith', roomTypeName: 'Deluxe King', nights: 1, status: 'confirmed' },
    ];
  }
  const supabase = createSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.from('realtor_hotel_reservations').select('id, guest_name, room_type_name, nights, status').eq('check_in', today);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ reservationId: r.id, guestName: r.guest_name, roomTypeName: r.room_type_name, nights: r.nights, status: r.status }));
}

export async function getRoomBoard(): Promise<RoomBoardItem[]> {
  if (USE_MOCK) { await delay(200); return [...ROOM_BOARD]; }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_hotel_rooms').select('*').order('number');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, number: r.number, roomTypeName: r.room_type_name, status: r.status, guestName: r.guest_name ?? undefined, checkoutDate: r.checkout_date ?? undefined }));
}

export async function setRoomStatus(roomId: string, status: RoomBoardItem['status']): Promise<RoomBoardItem> {
  if (USE_MOCK) {
    await delay(180);
    const r = ROOM_BOARD.find((x) => x.id === roomId); if (!r) throw new Error('Room not found');
    r.status = status; if (status === 'available') { r.guestName = undefined; r.checkoutDate = undefined; }
    return r;
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_hotel_rooms').update({ status }).eq('id', roomId).select('*').single();
  if (error) throw error;
  return { id: data.id, number: data.number, roomTypeName: data.room_type_name, status: data.status, guestName: data.guest_name ?? undefined, checkoutDate: data.checkout_date ?? undefined };
}

// ── Channel sync ─────────────────────────────────────────────────────────────
export async function getChannelSync(): Promise<ChannelSyncState> {
  if (USE_MOCK) { await delay(240); return JSON.parse(JSON.stringify(CHANNELS)); }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_channel_connections').select('*');
  if (error) throw error;
  return {
    connections: (data ?? []).map((c: any) => ({ key: c.channel, name: c.name, connected: c.connected, lastSyncAt: c.last_sync_at ?? undefined, mappedUnits: c.mapped_units ?? 0, status: c.status })),
    conflicts: [],
  };
}

export async function runChannelSync(): Promise<ChannelSyncState> {
  if (USE_MOCK) {
    await delay(600);
    CHANNELS.lastFullSyncAt = new Date().toISOString();
    CHANNELS.connections = CHANNELS.connections.map((c) => c.connected ? { ...c, lastSyncAt: CHANNELS.lastFullSyncAt, status: 'ok' as const } : c);
    return JSON.parse(JSON.stringify(CHANNELS));
  }
  const supabase = createSupabaseClient();
  await supabase.from('realtor_channel_connections').update({ last_sync_at: new Date().toISOString(), status: 'ok' }).eq('connected', true);
  return getChannelSync();
}

export async function toggleChannel(key: ChannelKey, connected: boolean): Promise<ChannelSyncState> {
  if (USE_MOCK) {
    await delay(300);
    CHANNELS.connections = CHANNELS.connections.map((c) => c.key === key ? { ...c, connected, status: connected ? 'ok' : 'idle' } : c);
    return JSON.parse(JSON.stringify(CHANNELS));
  }
  const supabase = createSupabaseClient();
  await supabase.from('realtor_channel_connections').update({ connected, status: connected ? 'ok' : 'idle' }).eq('channel', key);
  return getChannelSync();
}
