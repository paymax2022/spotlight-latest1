export type PropertyStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED';
export type HotelierRole = 'OWNER' | 'MANAGER' | 'FRONT_DESK' | 'FINANCE' | 'READ_ONLY';

/** Property types the create form offers — DB column is free text, so this is a
 *  UI convention, not an enum enforced server-side. */
export const PROPERTY_TYPES = ['hotel', 'apartment', 'shortlet', 'guesthouse', 'villa', 'resort', 'hostel'] as const;
export type PropertyTypeValue = (typeof PROPERTY_TYPES)[number];

export interface HotelierProperty {
  id: string;
  name: string;
  city: string;
  status: PropertyStatus;
  role: HotelierRole;
}

export interface PropertyDetail {
  id: string;
  name: string;
  description: string;
  address: string;
  city: string;
  starRating: number;
  propertyType: string;
  status: PropertyStatus;
}

export interface RoomType {
  id: string;
  name: string;
  occupancy: number;
  bedding: string;
  sizeSqm: number;
}

export interface RatePlan {
  id: string;
  roomTypeId: string;
  type: string;
  board: string;
  refundable: boolean;
  baseSellRateKobo: number;
  currency: string;
}

export interface HotelierReservation {
  id: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  state: string;
  totalKobo: number;
}

export interface CreatePropertyInput {
  name: string;
  propertyType: PropertyTypeValue;
  address: string;
  city: string;
  starRating?: number;
}

export interface CreateRoomTypeInput {
  name: string;
  occupancy: number;
  bedding?: string;
}

export interface CreateRatePlanInput {
  roomTypeId: string;
  type: string;
  refundable: boolean;
  baseSellRateKobo: number;
}
