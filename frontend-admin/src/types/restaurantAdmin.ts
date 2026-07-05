// ── Admin — Restaurant & Delivery types (mirror of backend/internal/finance/restaurant) ──
// All monetary amounts are integers in minor units (kobo). Never floats.

export type OrderStatus =
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'assigned'
  | 'picked_up'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | 'no_rider';

export interface Restaurant {
  id: string;
  owner_id: string;
  name: string;
  description?: string;
  address?: string;
  phone?: string;
  cuisine?: string;
  image_url?: string;
  is_open: boolean;
  rating: number;
  rating_count: number;
  created_at: string;
}

export interface OrderItem {
  item_id: string;
  name: string;
  unit_price_kobo: number;
  quantity: number;
  notes?: string;
}

export interface Order {
  id: string;
  restaurant_id: string;
  restaurant_name?: string;
  customer_id: string;
  rider_id?: string | null;
  status: OrderStatus;
  items: OrderItem[];
  subtotal_kobo: number;
  delivery_fee_kobo: number;
  service_fee_kobo: number;
  total_kobo: number;
  delivery_address?: string;
  delivery_lat?: number;
  delivery_lng?: number;
  created_at: string;
  updated_at?: string;
}

export interface OrderMessage {
  id: string;
  order_id: string;
  sender_id: string;
  sender_role: 'customer' | 'restaurant' | 'rider';
  body: string;
  attachment_url?: string | null;
  created_at: string;
}
