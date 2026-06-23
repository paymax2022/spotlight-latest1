// ── Paymax Mobility — Types ──────────────────────────────────────────────────
// Mirrors docs/prd/transportation/BUILD-CONTRACT.md payloads.
// IRON RULES: all money is integer minor units (kobo). Never floats for money.
// Fare floors/ceilings are server-computed — the client only *displays* them.

// ─── Money ──────────────────────────────────────────────────────────────────
/** Integer kobo (1 NGN = 100 kobo). Never a float, never a string for math. */
export type Kobo = number;

// ─── Geo ────────────────────────────────────────────────────────────────────
export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place extends LatLng {
  address: string;
  label?: string;        // e.g. "Home", "Work"
}

export interface SavedPlace {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  icon?: string;         // lucide name
}

// ─── Service types & pricing ──────────────────────────────────────────────────
export type ServiceType = 'economy' | 'comfort' | 'premium' | 'xl';

export type PricingMode = 'instant' | 'offer';

export type PaymentMethod = 'wallet' | 'card' | 'cash';

/** Active pricing config for a zone+service. Client renders the fare range from
 *  these — it NEVER computes the floor/ceiling itself. */
export interface PricingConfig {
  zone: string;
  serviceType: ServiceType;
  currency: 'NGN';
  baseFareKobo: Kobo;
  perKmKobo: Kobo;
  perMinKobo: Kobo;
  minFareKobo: Kobo;
  surgeMultiplier: number;        // display-only; backend applies it
  fareFloorPct: number;           // e.g. 0.85
  fareCeilingPct: number;         // e.g. 1.25
  serviceAvailable: boolean;      // false → service-unavailable-in-city state
}

// ─── Estimate ─────────────────────────────────────────────────────────────────
export interface RideEstimateRequest {
  pickup: Place;
  dest: Place;
  serviceType: ServiceType;
}

export interface RideEstimate {
  distanceM: number;
  durationS: number;
  systemFareKobo: Kobo;
  offerMinKobo: Kobo;             // floor — server computed
  offerMaxKobo: Kobo;            // ceiling — server computed
  surgeMultiplier: number;
  currency: 'NGN';
  polyline: string;
}

// ─── Trip ─────────────────────────────────────────────────────────────────────
export type TripPhase =
  | 'requested'
  | 'fare_negotiating'
  | 'driver_assigned'
  | 'driver_arriving'
  | 'pin_verified'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'safety_hold';

export type TripStatus =
  | 'requested'
  | 'accepted'
  | 'picked_up'
  | 'completed'
  | 'cancelled';

export interface Driver {
  id: string;
  name: string;
  photoUrl: string | null;
  rating: number;
  tripsCount: number;
  verified: boolean;
  phoneMasked: string | null;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  color: string;
  plateNumber: string;
  category: ServiceType;
  capacity: number;
}

export type FareOfferStatus = 'pending' | 'countered' | 'accepted' | 'rejected' | 'expired';

export interface FareOffer {
  id: string;
  tripId: string;
  riderOfferKobo: Kobo;
  driverCounterKobo: Kobo | null;
  status: FareOfferStatus;
  createdAt: string;
}

export interface RideRequest {
  pickup: Place;
  dest: Place;
  serviceType: ServiceType;
  pricingMode: PricingMode;
  offerKobo?: Kobo;               // required when pricingMode = 'offer'
  paymentMethod: PaymentMethod;
  idempotencyKey: string;
}

export interface Trip {
  id: string;
  phase: TripPhase;
  status: TripStatus;
  serviceType: ServiceType;
  pricingMode: PricingMode;
  pickup: Place;
  dest: Place;
  distanceM: number;
  durationS: number;
  fareKobo: Kobo;                 // current agreed/escrowed fare
  systemFareKobo: Kobo;
  surgeMultiplier: number;
  currency: 'NGN';
  paymentMethod: PaymentMethod;
  paymentStatus: 'escrowed' | 'pending' | 'settled' | 'refunded' | 'failed';
  tripPin: string | null;         // 4-digit; shown to rider, verified by driver
  driver: Driver | null;
  vehicle: Vehicle | null;
  fareOffer: FareOffer | null;
  driverEtaS: number | null;      // ETA to pickup when arriving
  polyline: string;
  shareToken: string | null;
  safetyHold: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  rated: boolean;
}

export interface TripEvent {
  phase: TripPhase;
  at: string;
  note?: string;
}

// ─── Home ─────────────────────────────────────────────────────────────────────
export interface QuickTile {
  id: string;
  label: string;
  icon: string;                   // lucide name
  serviceType?: ServiceType;
  route?: string;
  enabled: boolean;
}

export interface MobilityHome {
  walletBalanceKobo: Kobo;
  currency: 'NGN';
  activeTrip: Trip | null;
  quickTiles: QuickTile[];
  savedPlaces: SavedPlace[];
  recentPlaces: Place[];
  safetyReminder: string;
  serviceAvailable: boolean;      // city-level availability
}

// ─── Rating ───────────────────────────────────────────────────────────────────
export interface RateDraft {
  stars: number;                  // 1..5
  comment?: string;
  tipKobo?: Kobo;
}

export interface Rating {
  id: string;
  tripId: string;
  stars: number;
  comment: string | null;
  tipKobo: Kobo;
  createdAt: string;
}

// ─── Safety ───────────────────────────────────────────────────────────────────
export interface TrustedContact {
  id: string;
  name: string;
  phone: string;
}

export type SafetyIncidentType = 'sos' | 'route_deviation' | 'unexpected_stop' | 'report';

export interface SafetyIncident {
  id: string;
  tripId: string | null;
  type: SafetyIncidentType;
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt: string;
}

export interface ShareLink {
  token: string;
  url: string;
  expiresAt: string;
}

// ─── Driver ───────────────────────────────────────────────────────────────────
export type VerificationStatus =
  | 'not_started'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'suspended';

export type DocType = 'drivers_licence' | 'government_id' | 'proof_of_address' | 'vehicle_insurance' | 'roadworthiness';

export type DocStatus = 'pending' | 'uploaded' | 'verified' | 'rejected' | 'expired';

export interface DriverDocument {
  id: string;
  docType: DocType;
  fileUrl: string | null;
  status: DocStatus;
  expiryDate: string | null;
}

export type CommissionTier = 'standard' | 'silver' | 'gold' | 'platinum';

export interface CommissionInfo {
  tier: CommissionTier;
  platformPct: number;            // e.g. 20 for 80/20
  driverPct: number;              // e.g. 80
}

export interface DriverProfile {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  photoUrl: string | null;
  verificationStatus: VerificationStatus;
  rejectionReason: string | null;
  online: boolean;
  serviceCategories: ServiceType[];
  commission: CommissionInfo;
  documents: DriverDocument[];
  vehicle: Vehicle | null;
  rating: number;
}

export interface OnboardingSubmitDraft {
  phone: string;
  email: string;
  photoUrl?: string;
  serviceCategories: ServiceType[];
}

export interface VehicleDraft {
  plateNumber: string;
  make: string;
  model: string;
  year: number;
  color: string;
  category: ServiceType;
  capacity: number;
}

export interface DocumentDraft {
  docType: DocType;
  fileUrl: string;
  expiryDate?: string;
}

/** A dispatch candidate the driver sees in their requests feed. */
export interface DriverRideRequest {
  tripId: string;
  pickup: Place;
  dest: Place;
  distanceM: number;
  durationS: number;
  pickupDistanceM: number;        // how far the pickup is from the driver
  serviceType: ServiceType;
  pricingMode: PricingMode;
  systemFareKobo: Kobo;
  riderOfferKobo: Kobo | null;    // present when rider made an offer
  /** Min counter the driver may make (respects driver-profit floor). */
  counterMinKobo: Kobo;
  counterMaxKobo: Kobo;
  estDriverNetKobo: Kobo;         // after commission, at current fare
  currency: 'NGN';
  rider: { name: string; rating: number };
  expiresAt: string;
}

export interface DriverEarnings {
  grossKobo: Kobo;
  platformFeeKobo: Kobo;
  netKobo: Kobo;
  tripsCompleted: number;
  cancelRatePct: number;
  commission: CommissionInfo;
  currency: 'NGN';
  today: { grossKobo: Kobo; tripsCompleted: number };
  recentTrips: DriverTripSummary[];
}

export interface DriverTripSummary {
  tripId: string;
  completedAt: string;
  fareKobo: Kobo;
  netKobo: Kobo;
  pickupLabel: string;
  destLabel: string;
}

// ─── API error shape ─────────────────────────────────────────────────────────
export type MobilityErrorCode =
  | 'FARE_BELOW_FLOOR'
  | 'FARE_ABOVE_CEILING'
  | 'DRIVER_PROFIT_FLOOR'
  | 'NO_DRIVER_FOUND'
  | 'SERVICE_UNAVAILABLE'
  | 'PAYMENT_FAILED'
  | 'INVALID_STATE'
  | 'NOT_PERMITTED'
  | 'RESTRICTED'
  | 'INVALID_PIN';

export interface MobilityError extends Error {
  code?: MobilityErrorCode;
  status?: number;
}
