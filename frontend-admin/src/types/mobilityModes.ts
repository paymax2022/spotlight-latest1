// ── Admin — Paymax Mobility multi-modal types ────────────────────────────────
// Parcel · Bus · Towing · Movers · Car hire. All monetary amounts are integers
// in minor units (kobo). Never floats. Mirrors the admin endpoints under
// /api/finance/admin/transport/{parcels,bus,towing,movers,car-hire}.

// ─── Parcel delivery ──────────────────────────────────────────────────────────
// created → courier_assigned → pickup_pin_verified → picked_up → in_transit →
// dropoff_verified → delivered · (failed / disputed / cancelled)
export type ParcelStatus =
  | 'created'
  | 'courier_assigned'
  | 'pickup_pin_verified'
  | 'picked_up'
  | 'in_transit'
  | 'dropoff_verified'
  | 'delivered'
  | 'failed'
  | 'disputed'
  | 'cancelled';

export type PodStatus = 'pending' | 'submitted' | 'approved' | 'rejected';

export interface ParcelRow {
  id: string;
  senderName: string;
  courierName: string | null;
  courierId: string | null;
  status: ParcelStatus;
  category: string;
  size: string;
  speed: string;
  pickupAddress: string;
  dropoffAddress: string;
  zone: string;
  fareKobo: number;
  declaredValueKobo: number;
  podStatus: PodStatus;
  podProofUrl: string | null;
  escrowStatus: EscrowStatus;
  createdAt: string;
  updatedAt: string;
}

// ─── Couriers (drivers w/ parcel service category) ────────────────────────────
export interface CourierRow {
  id: string;
  name: string;
  phone: string;
  zone: string;
  status: 'active' | 'inactive' | 'suspended';
  rating: number;
  activeParcels: number;
  completedParcels: number;
}

// ─── Bus ──────────────────────────────────────────────────────────────────────
export interface BusOperator {
  id: string;
  name: string;
  zone: string;
  status: 'active' | 'inactive' | 'suspended';
  routes: number;
  fleetSize: number;
}

export interface BusRoute {
  id: string;
  operatorId: string;
  operatorName: string;
  origin: string;
  destination: string;
  fareKobo: number;
  fareApproved: boolean;
  active: boolean;
}

export type ScheduleStatus = 'scheduled' | 'boarding' | 'departed' | 'completed' | 'cancelled';

export interface BusSchedule {
  id: string;
  routeId: string;
  routeLabel: string;
  operatorName: string;
  departAt: string;
  fareKobo: number;
  fareApproved: boolean;
  seatsTotal: number;
  seatsBooked: number;
  status: ScheduleStatus;
}

export interface BusManifestRow {
  ticketId: string;
  passengerName: string;
  seatNumber: string;
  status: 'booked' | 'issued' | 'boarding' | 'boarded' | 'completed' | 'cancelled' | 'refunded';
  fareKobo: number;
  bookedAt: string;
}

// ─── Towing ─────────────────────────────────────────────────────────────────--
// requested → operator_accepted → operator_en_route → pin_verified → in_progress
// → completed · (cancelled)
export type TowingStatus =
  | 'requested'
  | 'operator_accepted'
  | 'operator_en_route'
  | 'pin_verified'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface TowingRow {
  id: string;
  customerName: string;
  operatorName: string | null;
  operatorId: string | null;
  status: TowingStatus;
  serviceType: string;
  pickupAddress: string;
  destAddress: string;
  zone: string;
  calloutKobo: number;
  fareKobo: number;
  escrowStatus: EscrowStatus;
  createdAt: string;
  updatedAt: string;
}

// ─── Movers (bidding + escrow) ────────────────────────────────────────────────
// quote_requested → bids_received → bid_accepted(escrow funded) → crew_assigned →
// in_progress → completion_confirmed(escrow released) · (disputed / cancelled)
export type MoverStatus =
  | 'quote_requested'
  | 'bids_received'
  | 'bid_accepted'
  | 'crew_assigned'
  | 'in_progress'
  | 'completion_confirmed'
  | 'disputed'
  | 'cancelled';

export type EscrowStatus = 'none' | 'held' | 'released' | 'refunded';

export interface MoverBid {
  id: string;
  moverName: string;
  moverId: string;
  amountKobo: number;
  crewSize: number;
  accepted: boolean;
  createdAt: string;
}

export interface MoverRow {
  id: string;
  customerName: string;
  status: MoverStatus;
  pickupAddress: string;
  dropoffAddress: string;
  truckSize: string;
  helpers: number;
  moveAt: string;
  acceptedAmountKobo: number | null;
  escrowStatus: EscrowStatus;
  bidsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MoverDetail extends MoverRow {
  inventory: string;
  bids: MoverBid[];
}

// ─── Car hire ─────────────────────────────────────────────────────────────────
// requested → quoted → confirmed → active → (extended) → completed · (cancelled)
export type CarHireStatus =
  | 'requested'
  | 'quoted'
  | 'confirmed'
  | 'active'
  | 'extended'
  | 'completed'
  | 'cancelled';

export interface CarHireRow {
  id: string;
  customerName: string;
  driverName: string | null;
  driverId: string | null;
  status: CarHireStatus;
  hireType: string;
  vehicleClass: string;
  chauffeur: boolean;
  startAt: string;
  durationHours: number;
  fareKobo: number;
  depositKobo: number;
  escrowStatus: EscrowStatus;
  zone: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Business logistics ───────────────────────────────────────────────────────
// Business owner = a Paymax user with a business_accounts row. Billing: prepaid
// wallet (escrow per delivery) or monthly invoice (accrue, settle at close).
export type BusinessAccountStatus = 'active' | 'suspended' | 'closed';

export interface BusinessAccountRow {
  id: string;
  name: string;
  ownerName: string;
  accountType: string;
  billingMode: 'prepaid' | 'invoice';
  codEnabled: boolean;
  status: BusinessAccountStatus;
  walletBalanceKobo: number;
  monthlyVolume: number;
  createdAt: string;
  updatedAt: string;
}

// created → assigned → picked_up → delivered · (failed / cancelled)
export type DeliveryStatus =
  | 'created'
  | 'assigned'
  | 'picked_up'
  | 'delivered'
  | 'failed'
  | 'cancelled';

export interface BusinessDeliveryRow {
  id: string;
  accountName: string;
  accountId: string;
  status: DeliveryStatus;
  size: string;
  pickupAddress: string;
  dropoffAddress: string;
  receiverName: string;
  courierName: string | null;
  fareKobo: number;
  codKobo: number;
  escrowStatus: EscrowStatus;
  podProofUrl: string | null;
  failureReason: string | null;
  batchId: string | null;
  zone: string;
  createdAt: string;
  updatedAt: string;
}

export type BusinessInvoiceStatus = 'open' | 'issued' | 'paid' | 'overdue';

export interface BusinessInvoiceRow {
  id: string;
  accountName: string;
  accountId: string;
  periodLabel: string;
  status: BusinessInvoiceStatus;
  deliveryCount: number;
  amountKobo: number;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
}

// ─── Event transport (Spotlight) ──────────────────────────────────────────────
// Organizer publishes event_transport_offers tied to a Spotlight event_id.
export type EventOfferType =
  | 'group_ride'
  | 'fan_bus'
  | 'shuttle'
  | 'artist'
  | 'crew'
  | 'equipment_van';

// draft → open → full → departed → completed · (cancelled)
export type EventOfferStatus =
  | 'draft'
  | 'open'
  | 'full'
  | 'departed'
  | 'completed'
  | 'cancelled';

export interface EventOfferRow {
  id: string;
  eventId: string;
  organizerName: string;
  type: EventOfferType;
  title: string;
  venue: string;
  capacity: number;
  bookedCount: number;
  fareKobo: number;
  departureTime: string;
  busScheduleId: string | null;
  status: EventOfferStatus;
  createdAt: string;
  updatedAt: string;
}

// booked → confirmed → boarded → completed · (cancelled / refunded)
export type EventBookingStatus =
  | 'booked'
  | 'confirmed'
  | 'boarded'
  | 'completed'
  | 'cancelled'
  | 'refunded';

export interface EventBookingRow {
  id: string;
  offerId: string;
  offerTitle: string;
  riderName: string;
  type: EventOfferType;
  seats: number;
  fareKobo: number;
  totalKobo: number;
  ticketRef: string | null;
  status: EventBookingStatus;
  escrowStatus: EscrowStatus;
  bookedAt: string;
}

// ─── Shared status patch ──────────────────────────────────────────────────────
export interface ModeStatusPatch {
  status: string;
  reason?: string;
}
