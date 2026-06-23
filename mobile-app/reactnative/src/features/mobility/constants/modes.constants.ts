// ── Paymax Mobility — Multi-mode constants ───────────────────────────────────
// Display labels + per-mode feature flags for parcel · bus · towing · movers ·
// car-hire. Pricing values are NEVER hard-coded for use — fares come from the
// backend at runtime. These are display labels and feature flags only.

import type {
  ParcelCategory,
  ParcelSize,
  ParcelSpeed,
  ParcelPhase,
  BusTicketPhase,
  TowingServiceType,
  TowingIssue,
  TowingVehicleType,
  TowingPhase,
  TruckSize,
  MoverPhase,
  HireType,
  VehicleClass,
  CarHirePhase,
} from '../types/modes.types';
import type {
  DeliveryStatus,
  DeliverySize,
  BatchStatus,
  InvoiceStatus,
} from '../types/logistics.types';
import type {
  EventOfferType,
  OfferStatus,
  BookingStatus,
} from '../types/event.types';

// ─── React Query namespaces (siblings of MOBILITY_KEY) ─────────────────────────
export const PARCEL_KEY = 'parcel';
export const BUS_KEY = 'bus';
export const TOWING_KEY = 'towing';
export const MOVERS_KEY = 'movers';
export const CARHIRE_KEY = 'carhire';
export const LOGISTICS_KEY = 'logistics';
export const EVENT_KEY = 'event';

// ─── Per-mode feature flags (default ON in mock; gate per BUILD-CONTRACT-MODES) ──
const flag = (env: string | undefined, fallback = 'true') =>
  (env ?? fallback).toLowerCase() !== 'false';

export const PARCEL_ENABLED = flag(process.env.EXPO_PUBLIC_PARCEL_ENABLED);
export const BUS_ENABLED = flag(process.env.EXPO_PUBLIC_BUS_ENABLED);
export const TOWING_ENABLED = flag(process.env.EXPO_PUBLIC_TOWING_ENABLED);
export const MOVERS_ENABLED = flag(process.env.EXPO_PUBLIC_MOVERS_ENABLED);
export const CARHIRE_ENABLED = flag(process.env.EXPO_PUBLIC_CARHIRE_ENABLED);
export const LOGISTICS_ENABLED = flag(process.env.EXPO_PUBLIC_LOGISTICS_ENABLED);
export const EVENT_ENABLED = flag(process.env.EXPO_PUBLIC_EVENT_ENABLED);

// ─── Mobility-home service tiles (the new modes appear alongside Ride) ─────────
export interface ModeTile {
  id: string;
  label: string;
  description: string;
  icon: string;       // lucide name
  route: string;
  enabled: boolean;
}

export const MODE_TILES: ModeTile[] = [
  { id: 'parcel',  label: 'Send parcel', description: 'Door-to-door courier', icon: 'Package',     route: '/mobility/parcel',  enabled: PARCEL_ENABLED },
  { id: 'bus',     label: 'Book a bus',  description: 'Intercity & intracity', icon: 'BusFront',   route: '/mobility/bus',     enabled: BUS_ENABLED },
  { id: 'towing',  label: 'Tow & rescue', description: 'Roadside assistance',   icon: 'Truck',      route: '/mobility/towing',  enabled: TOWING_ENABLED },
  { id: 'movers',  label: 'Movers',      description: 'Hire a moving truck',    icon: 'PackageOpen', route: '/mobility/movers', enabled: MOVERS_ENABLED },
  { id: 'carhire', label: 'Car hire',    description: 'Rent with/without driver', icon: 'CarFront', route: '/mobility/carhire', enabled: CARHIRE_ENABLED },
  { id: 'business', label: 'Business logistics', description: 'Bulk & tracked deliveries', icon: 'PackageCheck', route: '/mobility/business', enabled: LOGISTICS_ENABLED },
  { id: 'events',   label: 'Event transport',    description: 'Rides, fan bus & shuttles',  icon: 'Ticket',       route: '/mobility/events',   enabled: EVENT_ENABLED },
];

// ═══════════════════════════════════════════════════════════════════════════════
// PARCEL
// ═══════════════════════════════════════════════════════════════════════════════
export const PARCEL_CATEGORIES: { value: ParcelCategory; label: string; icon: string }[] = [
  { value: 'documents',   label: 'Documents',   icon: 'FileText' },
  { value: 'electronics', label: 'Electronics', icon: 'Smartphone' },
  { value: 'food',        label: 'Food',        icon: 'UtensilsCrossed' },
  { value: 'clothing',    label: 'Clothing',    icon: 'Shirt' },
  { value: 'fragile',     label: 'Fragile',     icon: 'Wine' },
  { value: 'other',       label: 'Other',       icon: 'Box' },
];

export const PARCEL_SIZES: { value: ParcelSize; label: string; hint: string }[] = [
  { value: 'small',  label: 'Small',  hint: 'Fits in a hand (≤ 2kg)' },
  { value: 'medium', label: 'Medium', hint: 'Backpack size (≤ 8kg)' },
  { value: 'large',  label: 'Large',  hint: 'Box size (≤ 25kg)' },
];

export const PARCEL_SPEEDS: { value: ParcelSpeed; label: string; hint: string }[] = [
  { value: 'standard', label: 'Standard', hint: 'Within the day' },
  { value: 'express',  label: 'Express',  hint: '2–3 hours' },
  { value: 'same_day', label: 'Priority', hint: 'ASAP, dedicated courier' },
];

export const PROHIBITED_ITEMS = [
  'Cash, cheques or bank instruments',
  'Weapons, ammunition or explosives',
  'Illegal drugs or controlled substances',
  'Live animals',
  'Flammable or hazardous materials',
];

export const PARCEL_PHASE_LABEL: Record<ParcelPhase, string> = {
  created: 'Finding a courier',
  courier_assigned: 'Courier assigned',
  pickup_pin_verified: 'Pickup confirmed',
  picked_up: 'Picked up',
  in_transit: 'In transit',
  dropoff_verified: 'At destination',
  delivered: 'Delivered',
  failed: 'Failed',
  disputed: 'Disputed',
  cancelled: 'Cancelled',
};

// ═══════════════════════════════════════════════════════════════════════════════
// BUS
// ═══════════════════════════════════════════════════════════════════════════════
export const BUS_PHASE_LABEL: Record<BusTicketPhase, string> = {
  booked: 'Booked',
  issued: 'Ticket issued',
  boarding: 'Boarding',
  boarded: 'On board',
  completed: 'Completed',
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

// ═══════════════════════════════════════════════════════════════════════════════
// TOWING
// ═══════════════════════════════════════════════════════════════════════════════
export const TOWING_SERVICES: { value: TowingServiceType; label: string; hint: string; icon: string }[] = [
  { value: 'flatbed',    label: 'Flatbed tow',  hint: 'Safest for most cars', icon: 'Truck' },
  { value: 'wheel_lift', label: 'Wheel-lift',   hint: 'Quick short-distance', icon: 'Truck' },
  { value: 'heavy_duty', label: 'Heavy duty',   hint: 'Vans, trucks, buses',  icon: 'Truck' },
  { value: 'roadside',   label: 'Roadside only', hint: 'No tow, on-spot help', icon: 'Wrench' },
];

export const TOWING_ISSUES: { value: TowingIssue; label: string; icon: string }[] = [
  { value: 'breakdown', label: 'Breakdown',   icon: 'AlertTriangle' },
  { value: 'accident',  label: 'Accident',    icon: 'CarFront' },
  { value: 'flat_tyre', label: 'Flat tyre',   icon: 'CircleDot' },
  { value: 'no_fuel',   label: 'Out of fuel', icon: 'Fuel' },
  { value: 'battery',   label: 'Battery',     icon: 'BatteryWarning' },
  { value: 'locked_out', label: 'Locked out', icon: 'KeyRound' },
];

export const TOWING_VEHICLE_TYPES: { value: TowingVehicleType; label: string }[] = [
  { value: 'sedan',      label: 'Sedan' },
  { value: 'suv',        label: 'SUV' },
  { value: 'van',        label: 'Van' },
  { value: 'truck',      label: 'Truck' },
  { value: 'motorcycle', label: 'Motorcycle' },
];

export const TOWING_PHASE_LABEL: Record<TowingPhase, string> = {
  requested: 'Finding an operator',
  operator_accepted: 'Operator assigned',
  operator_en_route: 'Operator en route',
  pin_verified: 'PIN verified',
  in_progress: 'Towing in progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// ═══════════════════════════════════════════════════════════════════════════════
// MOVERS
// ═══════════════════════════════════════════════════════════════════════════════
export const TRUCK_SIZES: { value: TruckSize; label: string; hint: string }[] = [
  { value: 'pickup',      label: 'Pickup',      hint: 'Few items, studio' },
  { value: 'small_van',   label: 'Small van',   hint: '1-bedroom' },
  { value: 'box_truck',   label: 'Box truck',   hint: '2–3 bedroom' },
  { value: 'large_truck', label: 'Large truck', hint: '4+ bedroom / office' },
];

export const MOVER_INVENTORY_PRESETS = [
  'Bed & mattress',
  'Wardrobe',
  'Sofa set',
  'Dining set',
  'Fridge / freezer',
  'Washing machine',
  'TV & electronics',
  'Boxes / cartons',
  'Office desks',
];

export const MOVER_PHASE_LABEL: Record<MoverPhase, string> = {
  quote_requested: 'Awaiting bids',
  bids_received: 'Bids received',
  bid_accepted: 'Bid accepted',
  crew_assigned: 'Crew assigned',
  in_progress: 'Move in progress',
  completion_confirmed: 'Completed',
  disputed: 'Disputed',
  cancelled: 'Cancelled',
};

// ═══════════════════════════════════════════════════════════════════════════════
// CAR HIRE
// ═══════════════════════════════════════════════════════════════════════════════
export const HIRE_TYPES: { value: HireType; label: string; hint: string; icon: string }[] = [
  { value: 'hourly', label: 'Hourly',  hint: 'Pay by the hour',     icon: 'Clock' },
  { value: 'daily',  label: 'Daily',   hint: 'Full-day rental',     icon: 'CalendarDays' },
  { value: 'airport', label: 'Airport', hint: 'Airport pickup/drop', icon: 'Plane' },
  { value: 'event',  label: 'Event',   hint: 'Weddings, occasions', icon: 'PartyPopper' },
];

export const VEHICLE_CLASSES: { value: VehicleClass; label: string; hint: string }[] = [
  { value: 'economy',   label: 'Economy',   hint: 'Corolla, Camry' },
  { value: 'executive', label: 'Executive', hint: 'Accord, E-Class' },
  { value: 'suv',       label: 'SUV',       hint: 'Prado, Highlander' },
  { value: 'luxury',    label: 'Luxury',    hint: 'S-Class, Range Rover' },
  { value: 'van',       label: 'Van / Bus', hint: 'Sienna, Hiace' },
];

export const CARHIRE_PHASE_LABEL: Record<CarHirePhase, string> = {
  requested: 'Requested',
  quoted: 'Quote ready',
  confirmed: 'Confirmed',
  active: 'Active hire',
  extended: 'Extended',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// ═══════════════════════════════════════════════════════════════════════════════
// BUSINESS LOGISTICS
// ═══════════════════════════════════════════════════════════════════════════════
export const LOGISTICS_SIZES: { value: DeliverySize; label: string; hint: string }[] = [
  { value: 'small',  label: 'Small',  hint: 'Envelope / small parcel (≤ 5kg)' },
  { value: 'medium', label: 'Medium', hint: 'Carton size (≤ 15kg)' },
  { value: 'large',  label: 'Large',  hint: 'Bulky / multi-box (≤ 40kg)' },
];

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  created: 'Created',
  assigned: 'Courier assigned',
  picked_up: 'Picked up',
  delivered: 'Delivered',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  created: 'Created',
  dispatched: 'Dispatched',
  in_progress: 'In progress',
  completed: 'Completed',
  partially_failed: 'Partially failed',
};

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  open: 'Open',
  issued: 'Issued',
  paid: 'Paid',
  overdue: 'Overdue',
};

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT TRANSPORT
// ═══════════════════════════════════════════════════════════════════════════════
export const EVENT_OFFER_TYPES: { value: EventOfferType; label: string; icon: string }[] = [
  { value: 'group_ride',    label: 'Group ride',    icon: 'Users' },
  { value: 'fan_bus',       label: 'Fan bus',       icon: 'BusFront' },
  { value: 'shuttle',       label: 'Shuttle',       icon: 'Bus' },
  { value: 'artist',        label: 'Artist',        icon: 'Star' },
  { value: 'crew',          label: 'Crew',          icon: 'Wrench' },
  { value: 'equipment_van', label: 'Equipment van', icon: 'Truck' },
];

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  full: 'Full',
  departed: 'Departed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  booked: 'Booked',
  confirmed: 'Confirmed',
  boarded: 'Boarded',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};
