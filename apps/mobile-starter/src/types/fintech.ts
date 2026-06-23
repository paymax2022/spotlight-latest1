// ─── KYC ───────────────────────────────────────────────────────────────────
export type KycStatus = 'none' | 'pending' | 'submitted' | 'verified' | 'failed';

export interface KycProfile {
  user_id: string;
  kyc_tier: number;
  kyc_status: KycStatus;
  kyc_submitted_at: string | null;
  kyc_verified_at: string | null;
  phone_verified: boolean;
  document_type: string | null;
  requested_tier: number | null;
}

// ─── Transfers ─────────────────────────────────────────────────────────────
export interface TransferPayload {
  recipient_account: string;
  recipient_bank_code: string;
  amount_kobo: number;
  narration?: string;
}

export interface TransferResult {
  transfer_id: string;
  reference: string;
  status: 'pending' | 'success' | 'failed';
  amount_kobo: number;
  fee_kobo: number;
}

// ─── Disputes ──────────────────────────────────────────────────────────────
export type DisputeStatus = 'open' | 'investigating' | 'resolved' | 'closed';
export type DisputeResolution = 'refund' | 'partial_refund' | 'no_action';

export interface Dispute {
  id: string;
  user_id: string;
  reference: string;
  module_type: string;
  type: string;
  description: string;
  status: DisputeStatus;
  resolution: DisputeResolution | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpenDisputePayload {
  reference: string;
  module_type: string;
  type: string;
  description: string;
}

// ─── Restaurant ────────────────────────────────────────────────────────────
export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  rating: number;
  review_count: number;
  delivery_time_min: number;
  delivery_fee_kobo: number;
  min_order_kobo: number;
  image_url: string;
  is_open: boolean;
  distance_km: number;
  tags: string[];
}

export interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price_kobo: number;
  image_url: string;
  available: boolean;
}

export interface RestaurantDetail extends Restaurant {
  description: string;
  address: string;
  phone: string;
  menu: MenuCategory[];
}

export interface CartItem {
  item: MenuItem;
  quantity: number;
}

export interface RestaurantOrder {
  restaurant_id: string;
  items: { menu_item_id: string; quantity: number }[];
  delivery_address: string;
  notes?: string;
}

export interface OrderResult {
  order_id: string;
  reference: string;
  status: string;
  total_kobo: number;
  estimated_delivery_min: number;
}

// ─── Telemedicine / Pharmacy ────────────────────────────────────────────────
export interface Provider {
  id: string;
  name: string;
  specialty: string;
  rating: number;
  review_count: number;
  price_kobo: number;
  image_url: string;
  available: boolean;
  type: 'doctor' | 'pharmacy' | 'lab';
  distance_km?: number;
  address?: string;
}

export interface Appointment {
  id: string;
  provider_id: string;
  provider_name: string;
  date: string;
  time: string;
  type: 'video' | 'in_person';
  status: 'scheduled' | 'completed' | 'cancelled';
  notes?: string;
  fee_kobo: number;
}

// ─── Transport ─────────────────────────────────────────────────────────────
export interface RideEstimate {
  vehicle_type: string;
  price_kobo: number;
  eta_min: number;
  currency: string;
}

export interface RideBooking {
  booking_id: string;
  driver_name: string;
  vehicle: string;
  plate: string;
  eta_min: number;
  status: string;
}

// ─── Events ────────────────────────────────────────────────────────────────
export interface Event {
  id: string;
  title: string;
  description: string;
  venue: string;
  date: string;
  start_time: string;
  image_url: string;
  category: string;
  ticket_price_kobo: number;
  available_seats: number;
  organizer: string;
}

// ─── Crowdfunding ──────────────────────────────────────────────────────────
export interface Campaign {
  id: string;
  title: string;
  description: string;
  creator_name: string;
  goal_kobo: number;
  raised_kobo: number;
  backer_count: number;
  days_left: number;
  image_url: string;
  category: string;
}

// ─── Groups ────────────────────────────────────────────────────────────────
export interface Group {
  id: string;
  name: string;
  description: string;
  member_count: number;
  is_private: boolean;
  category: string;
  image_url: string;
  balance_kobo?: number;
}

export interface GroupContribution {
  group_id: string;
  amount_kobo: number;
}

// ─── Support ───────────────────────────────────────────────────────────────
export interface SupportTicket {
  id: string;
  subject: string;
  message: string;
  status: 'open' | 'pending' | 'resolved';
  created_at: string;
}

// ─── Order Tracking ────────────────────────────────────────────────────────
export interface OrderTracking {
  order_id: string;
  status: 'placed' | 'confirmed' | 'preparing' | 'picked_up' | 'delivered';
  restaurant_name: string;
  items_count: number;
  total_kobo: number;
  estimated_delivery_min: number;
  rider_name?: string;
  rider_phone?: string;
  created_at: string;
}
