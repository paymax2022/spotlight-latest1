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
  lat: number;
  lng: number;
  amenities: string[];
  houseRules: string;
  cancellationPolicy: CancellationPolicy;
  checkInFrom: string; // "HH:MM"
  checkOutUntil: string; // "HH:MM"
  contactPhone: string;
  contactEmail: string;
}

export type CancellationPolicy = 'FLEXIBLE' | 'MODERATE' | 'STRICT' | 'NON_REFUNDABLE';
export const CANCELLATION_POLICIES: { value: CancellationPolicy; label: string; description: string }[] = [
  { value: 'FLEXIBLE', label: 'Flexible', description: 'Full refund up to 24 hours before check-in' },
  { value: 'MODERATE', label: 'Moderate', description: 'Full refund up to 5 days before check-in' },
  { value: 'STRICT', label: 'Strict', description: '50% refund up to 7 days before check-in' },
  { value: 'NON_REFUNDABLE', label: 'Non-refundable', description: 'No refund once booked' },
];

/** Fixed catalog the extranet offers for the amenities toggle grid. The DB
 *  column is a free-form jsonb array, so this is a UI convention (matching
 *  frontend-admin's amenity groups), not an enum enforced server-side. */
export const AMENITY_CATALOG: { group: string; items: { key: string; label: string }[] }[] = [
  { group: 'General', items: [
    { key: 'wifi', label: 'Free Wi-Fi' },
    { key: 'parking', label: 'Free parking' },
    { key: 'ac', label: 'Air conditioning' },
    { key: 'generator', label: '24/7 backup power' },
    { key: 'elevator', label: 'Elevator' },
  ]},
  { group: 'Wellness & leisure', items: [
    { key: 'pool', label: 'Swimming pool' },
    { key: 'gym', label: 'Fitness centre' },
    { key: 'spa', label: 'Spa' },
  ]},
  { group: 'Food & drink', items: [
    { key: 'restaurant', label: 'Restaurant' },
    { key: 'bar', label: 'Bar' },
    { key: 'room_service', label: '24h room service' },
    { key: 'kitchen', label: 'Kitchen / kitchenette' },
  ]},
  { group: 'Services', items: [
    { key: 'airport_shuttle', label: 'Airport shuttle' },
    { key: 'laundry', label: 'Laundry' },
    { key: 'concierge', label: 'Concierge' },
    { key: 'front_desk_24h', label: '24-hour front desk' },
  ]},
];

export interface PropertyPhoto {
  id: string;
  roomTypeId?: string;
  url: string;
  caption: string;
  isCover: boolean;
  sortOrder: number;
}

/** Every field optional — only fields present are changed (see
 *  backend/internal/stays/extranet/repository.go PropertyDetailsPatch). */
export interface UpdatePropertyDetailsInput {
  lat?: number;
  lng?: number;
  amenities?: string[];
  houseRules?: string;
  cancellationPolicy?: CancellationPolicy;
  checkInFrom?: string;
  checkOutUntil?: string;
  contactPhone?: string;
  contactEmail?: string;
}

export type VerificationItemStatus = 'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected' | 'needs_changes';

export interface VerificationChecklistItem {
  key: string;
  label: string;
  stage: string;
  status: VerificationItemStatus;
  detail?: string;
  required: boolean;
}

export interface VerificationStatus {
  propertyId: string;
  propertyName: string;
  overall: VerificationItemStatus;
  goLiveEligible: boolean;
  submittedForReviewAt?: string | null;
  reviewedAt?: string | null;
  reviewerNote?: string | null;
  checklist: VerificationChecklistItem[];
}

export interface UpdatePropertyContentInput {
  name?: string;
  description?: string;
  address?: string;
  city?: string;
  starRating?: number;
  propertyType?: string;
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
