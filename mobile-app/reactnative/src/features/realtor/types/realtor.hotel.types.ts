// ── Spotlight Realtor — Hotel + channel sync types (V3) ──────────────────────
// Multi-room hospitality on the same property graph. Money is integer minor units.

import type { Kobo, Amenity } from './realtor.types';

export interface HotelCard {
  id: string;
  name: string;
  area: string;
  city: string;
  coverUrl: string;
  starRating: number;          // 1–5
  fromNightly: Kobo;           // lowest room-type rate
  reviewScore: number;         // 0–10
}

export interface RatePlan {
  id: string;
  name: string;                // "Room only", "Bed & breakfast", "Flexible"
  nightly: Kobo;
  refundable: boolean;
  includesBreakfast: boolean;
}

export interface RoomType {
  id: string;
  hotelId: string;
  name: string;                // "Deluxe King"
  capacity: number;
  totalRooms: number;
  availableRooms: number;
  ratePlans: RatePlan[];
  amenities: Amenity[];
  photoUrl: string;
}

export interface Hotel extends HotelCard {
  description: string;
  amenities: Amenity[];
  media: string[];
  roomTypes: RoomType[];
}

export type HotelReservationStatus =
  | 'pending_payment' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show';

export interface HotelReservation {
  id: string;
  hotelId: string;
  hotelName: string;
  roomTypeName: string;
  ratePlanName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  total: Kobo;
  status: HotelReservationStatus;
  confirmationCode: string;
  roomNumber?: string;
  createdAt: string;
}

export interface HotelBookingDraft {
  hotelId: string;
  roomTypeId: string;
  ratePlanId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  guestName: string;
  guestPhone: string;
  specialRequest?: string;
}

// ── Front desk / housekeeping ────────────────────────────────────────────────

export type RoomStatus =
  | 'available' | 'reserved' | 'occupied' | 'dirty' | 'cleaning' | 'inspected' | 'out_of_service';

export interface RoomBoardItem {
  id: string;
  number: string;              // "204"
  roomTypeName: string;
  status: RoomStatus;
  guestName?: string;
  checkoutDate?: string;
}

export interface HotelDeskSummary {
  arrivalsToday: number;
  departuresToday: number;
  occupancyPct: number;
  dirtyRooms: number;
  available: number;
  revenueTodayKobo: Kobo;
}

export interface HotelArrival {
  reservationId: string;
  guestName: string;
  roomTypeName: string;
  nights: number;
  status: HotelReservationStatus;
}

// ── Channel sync (AB) ────────────────────────────────────────────────────────

export type ChannelKey = 'airbnb' | 'booking_com' | 'expedia';

export interface ChannelConnection {
  key: ChannelKey;
  name: string;
  connected: boolean;
  lastSyncAt?: string;
  mappedUnits: number;
  status: 'idle' | 'syncing' | 'error' | 'ok';
}

export interface ChannelConflict {
  id: string;
  unitOrRoom: string;
  channel: ChannelKey;
  date: string;
  reason: string;              // "Double booking", "Rate mismatch"
}

export interface ChannelSyncState {
  connections: ChannelConnection[];
  conflicts: ChannelConflict[];
  lastFullSyncAt?: string;
}
