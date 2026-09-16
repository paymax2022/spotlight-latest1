// ── Admin — Paymax Mobility (ride-hailing) types ─────────────────────────────
// All monetary amounts are integers in minor units (kobo). Never floats.
// Mirrors the BUILD-CONTRACT admin endpoints under /api/finance/admin/transport.

export type DriverVerificationStatus =
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'suspended';

export type VehicleStatus = 'active' | 'inactive' | 'suspended';
export type ComplianceStatus = 'valid' | 'pending' | 'expired' | 'failed';

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

export type IncidentType =
  | 'sos'
  | 'route_deviation'
  | 'unexpected_stop'
  | 'unsafe_behavior'
  | 'lost_item'
  | 'accident';
export type IncidentStatus = 'open' | 'investigating' | 'resolved' | 'escalated';
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export type CommissionTier = 'standard' | 'silver' | 'gold' | 'fleet';

// ─── Dashboard ────────────────────────────────────────────────────────────────
export interface MobilityDashboard {
  totalTrips: number;
  completedTrips: number;
  cancelledTrips: number;
  gbvKobo: number; // gross booking value
  platformRevenueKobo: number;
  driverEarningsKobo: number;
  completionRate: number; // %
  cancellationRate: number; // %
  openSafetyIncidents: number;
  activeDrivers: number;
  onlineDrivers: number;
  pendingVerifications: number;
  liveTrips: number;
  topZones: { zone: string; trips: number; gbvKobo: number }[];
}

// ─── Drivers ──────────────────────────────────────────────────────────────────
export interface DriverSummary {
  id: string;
  name: string;
  phone: string;
  email: string;
  verificationStatus: DriverVerificationStatus;
  online: boolean;
  zone: string;
  serviceCategories: string[];
  completedTrips: number;
  rating: number;
  cancelRate: number;
  commissionTier: CommissionTier;
  createdAt: string;
}

export interface DriverDocument {
  id: string;
  type: string;
  label: string;
  fileUrl: string;
  status: ComplianceStatus;
  expiryDate: string | null;
}

export interface DriverVehicle {
  id: string;
  plateNumber: string;
  make: string;
  model: string;
  year: number;
  color: string;
  category: string;
  capacity: number;
  status: VehicleStatus;
  inspectionStatus: ComplianceStatus;
  insuranceStatus: ComplianceStatus;
}

export interface DriverDetail extends DriverSummary {
  photoUrl: string | null;
  documents: DriverDocument[];
  vehicle: DriverVehicle | null;
  grossEarningsKobo: number;
  platformFeeKobo: number;
  netEarningsKobo: number;
  notes: string | null;
}

export interface DriverVerificationDecision {
  status: 'approved' | 'rejected' | 'suspended';
  reason: string;
}

// ─── Vehicles ─────────────────────────────────────────────────────────────────
export interface VehicleComplianceRow {
  id: string;
  driverId: string;
  driverName: string;
  plateNumber: string;
  make: string;
  model: string;
  year: number;
  category: string;
  status: VehicleStatus;
  inspectionStatus: ComplianceStatus;
  insuranceStatus: ComplianceStatus;
  inspectionExpiry: string | null;
  insuranceExpiry: string | null;
}

export interface VehicleStatusPatch {
  status?: VehicleStatus;
  inspectionStatus?: ComplianceStatus;
  insuranceStatus?: ComplianceStatus;
  reason: string;
}

// ─── Trips / Dispatch ─────────────────────────────────────────────────────────
export interface TripRow {
  id: string;
  riderName: string;
  driverName: string | null;
  driverId: string | null;
  phase: TripPhase;
  fareKobo: number;
  pickupAddress: string;
  destAddress: string;
  zone: string;
  serviceType: string;
  sos: boolean;
  stuck: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OnlineDriver {
  id: string;
  name: string;
  zone: string;
  rating: number;
  serviceCategories: string[];
  lat: number;
  lng: number;
  activeTripId: string | null;
}

export interface DispatchLive {
  activeTrips: TripRow[];
  onlineDrivers: OnlineDriver[];
}

// ─── Pricing & Commission ─────────────────────────────────────────────────────
export interface PricingConfig {
  zone: string;
  serviceType: string;
  baseFareKobo: number;
  perKmKobo: number;
  perMinKobo: number;
  minFareKobo: number;
  fareFloorPct: number; // e.g. 0.85
  fareCeilingPct: number; // e.g. 1.25
  driverProfitFloorKobo: number;
  surgeMultiplier: number; // e.g. 1.0
  version: number;
  updatedAt: string;
}

export interface CommissionConfig {
  tier: CommissionTier;
  driverPct: number; // e.g. 80
  platformPct: number; // e.g. 20
  updatedAt: string;
}

// ─── Safety ───────────────────────────────────────────────────────────────────
export interface SafetyIncidentRow {
  id: string;
  type: IncidentType;
  status: IncidentStatus;
  severity: IncidentSeverity;
  tripId: string | null;
  riderName: string;
  driverName: string | null;
  zone: string;
  description: string;
  assignedAdmin: string | null;
  resolutionNote: string | null;
  lat: number | null;
  lng: number | null;
  createdAt: string;
}

export interface SafetyIncidentPatch {
  status?: IncidentStatus;
  assignedAdmin?: string;
  resolutionNote?: string;
}

// ─── Reports ──────────────────────────────────────────────────────────────────
export interface ReportSummary {
  revenueByZone: { zone: string; gbvKobo: number; revenueKobo: number; trips: number }[];
  commissionByTier: { tier: CommissionTier; driverPayoutKobo: number; platformKobo: number; trips: number }[];
  tripsByDay: { date: string; completed: number; cancelled: number; gbvKobo: number }[];
  cancellation: { byRider: number; byDriver: number; bySystem: number; total: number };
}

// ─── Audit ────────────────────────────────────────────────────────────────────
export interface MobilityAuditEntry {
  id: string;
  action: string;
  target: string;
  actor: string;
  reason: string | null;
  createdAt: string;
}
