// ── Paymax Mobility — Multi-mode types ───────────────────────────────────────
// Types for the 5 new mobility modes: parcel · bus · towing · movers · car-hire.
// Mirrors docs/prd/transportation/BUILD-CONTRACT-MODES.md payloads.
//
// IRON RULES: all money is integer minor units (kobo). Never floats for money.
// Fares/deposits/bids are server-computed — the client only *displays* them.

import type { Kobo, Place } from './mobility.types';

// Re-exported so mode screens can import the shared error helpers from one place.
export type { Kobo, Place } from './mobility.types';

// ═══════════════════════════════════════════════════════════════════════════════
// PARCEL DELIVERY
// ═══════════════════════════════════════════════════════════════════════════════
export type ParcelCategory = 'documents' | 'electronics' | 'food' | 'clothing' | 'fragile' | 'other';
export type ParcelSize = 'small' | 'medium' | 'large';
export type ParcelSpeed = 'standard' | 'express' | 'same_day';

export type ParcelPhase =
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

export interface ParcelEstimateRequest {
  pickup: Place;
  dropoff: Place;
  category: ParcelCategory;
  size: ParcelSize;
  speed: ParcelSpeed;
  declaredValueKobo: Kobo;
}

export interface ParcelEstimate {
  distanceM: number;
  durationS: number;
  fareKobo: Kobo;            // distance × size × speed (server)
  insuranceKobo: Kobo;       // based on declared value
  totalKobo: Kobo;
  currency: 'NGN';
}

export interface ParcelBookRequest {
  pickup: Place;
  dropoff: Place;
  category: ParcelCategory;
  size: ParcelSize;
  speed: ParcelSpeed;
  declaredValueKobo: Kobo;
  receiverName: string;
  receiverPhone: string;
  photoUrl?: string;
  prohibitedAck: boolean;    // required true
  paymentMethod: 'wallet' | 'card';
  idempotencyKey: string;
}

export interface Courier {
  id: string;
  name: string;
  photoUrl: string | null;
  rating: number;
  vehicle: string;          // e.g. "Bike • LND-238-KJA"
  phoneMasked: string | null;
}

export interface Parcel {
  id: string;
  phase: ParcelPhase;
  pickup: Place;
  dropoff: Place;
  category: ParcelCategory;
  size: ParcelSize;
  speed: ParcelSpeed;
  declaredValueKobo: Kobo;
  fareKobo: Kobo;
  currency: 'NGN';
  receiverName: string;
  receiverPhone: string;
  photoUrl: string | null;
  pickupPin: string | null;   // sender sees this
  dropoffPin: string | null;  // sender sees this
  proofUrl: string | null;
  courier: Courier | null;
  paymentStatus: 'escrowed' | 'settled' | 'refunded' | 'failed';
  createdAt: string;
  deliveredAt: string | null;
  rated: boolean;
}

/** Courier-side dispatch candidate. */
export interface CourierParcelRequest {
  parcelId: string;
  pickup: Place;
  dropoff: Place;
  category: ParcelCategory;
  size: ParcelSize;
  speed: ParcelSpeed;
  distanceM: number;
  fareKobo: Kobo;
  estCourierNetKobo: Kobo;
  currency: 'NGN';
  expiresAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUS BOOKING
// ═══════════════════════════════════════════════════════════════════════════════
export type BusTicketPhase = 'booked' | 'issued' | 'boarding' | 'boarded' | 'completed' | 'rescheduled' | 'cancelled' | 'refunded';

export interface BusRoute {
  id: string;
  origin: string;
  originTerminal: string;
  dest: string;
  destTerminal: string;
  operatorName: string;
  operatorRating: number;
  durationS: number;
  fromKobo: Kobo;           // lowest available fare
  currency: 'NGN';
}

export interface BusSchedule {
  id: string;
  routeId: string;
  departAt: string;
  arriveAt: string;
  operatorName: string;
  busType: string;          // e.g. "18-seater Coaster"
  fareKobo: Kobo;
  seatsLeft: number;
  totalSeats: number;
  currency: 'NGN';
}

export interface BusSeat {
  number: string;           // e.g. "A1"
  available: boolean;
}

export interface BusSeatMap {
  scheduleId: string;
  columns: number;          // seats per row layout
  seats: BusSeat[];
  fareKobo: Kobo;
  currency: 'NGN';
}

export interface BusBookRequest {
  scheduleId: string;
  seatNumber: string;
  passengerName: string;
  passengerPhone: string;
  idempotencyKey: string;
}

export interface BusTicket {
  id: string;
  phase: BusTicketPhase;
  routeLabel: string;       // "Lagos → Abuja"
  originTerminal: string;
  destTerminal: string;
  operatorName: string;
  departAt: string;
  arriveAt: string;
  seatNumber: string;
  passengerName: string;
  fareKobo: Kobo;
  currency: 'NGN';
  qrCode: string | null;    // QR payload once issued
  paymentStatus: 'settled' | 'refunded' | 'failed';
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOWING
// ═══════════════════════════════════════════════════════════════════════════════
export type TowingServiceType = 'flatbed' | 'wheel_lift' | 'heavy_duty' | 'roadside';
export type TowingIssue = 'breakdown' | 'accident' | 'flat_tyre' | 'no_fuel' | 'battery' | 'locked_out';
export type TowingVehicleType = 'sedan' | 'suv' | 'van' | 'truck' | 'motorcycle';

export type TowingPhase =
  | 'requested'
  | 'operator_accepted'
  | 'operator_en_route'
  | 'pin_verified'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface TowingEstimateRequest {
  serviceType: TowingServiceType;
  issue: TowingIssue;
  pickup: Place;
  dest: Place | null;       // null for roadside-only
  vehicleType: TowingVehicleType;
}

export interface TowingEstimate {
  calloutKobo: Kobo;
  distanceKobo: Kobo;
  totalKobo: Kobo;
  distanceM: number;
  etaS: number;
  currency: 'NGN';
}

export interface TowingBookRequest {
  serviceType: TowingServiceType;
  issue: TowingIssue;
  pickup: Place;
  dest: Place | null;
  vehicleType: TowingVehicleType;
  photoUrl?: string;
  paymentMethod: 'wallet' | 'card';
  idempotencyKey: string;
}

export interface TowingOperator {
  id: string;
  name: string;
  photoUrl: string | null;
  rating: number;
  truck: string;
  phoneMasked: string | null;
}

export interface TowingJob {
  id: string;
  phase: TowingPhase;
  serviceType: TowingServiceType;
  issue: TowingIssue;
  vehicleType: TowingVehicleType;
  pickup: Place;
  dest: Place | null;
  fareKobo: Kobo;
  currency: 'NGN';
  photoUrl: string | null;
  towPin: string | null;
  operator: TowingOperator | null;
  operatorEtaS: number | null;
  paymentStatus: 'escrowed' | 'settled' | 'refunded' | 'failed';
  createdAt: string;
  completedAt: string | null;
  rated: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOVERS
// ═══════════════════════════════════════════════════════════════════════════════
export type TruckSize = 'pickup' | 'small_van' | 'box_truck' | 'large_truck';

export type MoverPhase =
  | 'quote_requested'
  | 'bids_received'
  | 'bid_accepted'
  | 'crew_assigned'
  | 'in_progress'
  | 'completion_confirmed'
  | 'disputed'
  | 'cancelled';

export interface MoverQuoteRequest {
  pickup: Place;
  dropoff: Place;
  truckSize: TruckSize;
  helpers: number;
  inventory: string[];
  moveAt: string;           // ISO datetime
}

export interface MoverBid {
  id: string;
  providerName: string;
  providerRating: number;
  reviews: number;
  amountKobo: Kobo;
  etaNote: string;          // e.g. "Available your date · 4-man crew"
  currency: 'NGN';
  createdAt: string;
}

export interface MoverJob {
  id: string;
  phase: MoverPhase;
  pickup: Place;
  dropoff: Place;
  truckSize: TruckSize;
  helpers: number;
  inventory: string[];
  moveAt: string;
  bids: MoverBid[];
  acceptedBid: MoverBid | null;
  fareKobo: Kobo | null;    // set once a bid is accepted (escrow funded)
  currency: 'NGN';
  paymentStatus: 'none' | 'escrowed' | 'settled' | 'refunded' | 'failed';
  createdAt: string;
  completedAt: string | null;
  rated: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAR HIRE
// ═══════════════════════════════════════════════════════════════════════════════
export type HireType = 'hourly' | 'daily' | 'airport' | 'event';
export type VehicleClass = 'economy' | 'executive' | 'suv' | 'luxury' | 'van';

export type CarHirePhase =
  | 'requested'
  | 'quoted'
  | 'confirmed'
  | 'active'
  | 'extended'
  | 'completed'
  | 'cancelled';

export interface CarHireQuoteRequest {
  hireType: HireType;
  vehicleClass: VehicleClass;
  startAt: string;          // ISO datetime
  durationHours: number;
  chauffeur: boolean;
}

export interface CarHireQuote {
  fareKobo: Kobo;
  depositKobo: Kobo;
  chauffeurKobo: Kobo;
  totalKobo: Kobo;          // fare + chauffeur + deposit (escrowed)
  currency: 'NGN';
}

export interface CarHireBookRequest {
  hireType: HireType;
  vehicleClass: VehicleClass;
  startAt: string;
  durationHours: number;
  chauffeur: boolean;
  paymentMethod: 'wallet' | 'card';
  idempotencyKey: string;
}

export interface CarHireBooking {
  id: string;
  phase: CarHirePhase;
  hireType: HireType;
  vehicleClass: VehicleClass;
  startAt: string;
  durationHours: number;
  chauffeur: boolean;
  fareKobo: Kobo;
  depositKobo: Kobo;
  chauffeurKobo: Kobo;
  currency: 'NGN';
  vehicleLabel: string;     // e.g. "Toyota Prado 2022 • Black"
  plateNumber: string | null;
  driverName: string | null;
  paymentStatus: 'escrowed' | 'settled' | 'refunded' | 'failed';
  createdAt: string;
  completedAt: string | null;
}

export interface CarHireExtendRequest {
  extraHours: number;
  idempotencyKey: string;
}
