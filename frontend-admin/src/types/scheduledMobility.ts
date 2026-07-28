// ── Admin — Paymax Transport Scheduled Bookings types ────────────────────────
// All monetary amounts are integers in minor units (kobo). Never floats.
// Mirrors the Transport Scheduling SWARM_INTEGRATION_CONTRACT admin endpoints
// under /api/finance/admin/transport/scheduled. Response shape is camelCase.

export type ScheduledMode =
  | 'ride_hail'
  | 'ride_share'
  | 'parcel_intra'
  | 'parcel_inter'
  | 'airport_pickup'
  | 'bus';

export type ScheduledStatus =
  | 'scheduled'
  | 'dispatch_pending'
  | 'dispatched'
  | 'completed'
  | 'cancelled'
  | 'failed_no_driver'
  | 'expired';

export interface ScheduledDispatchEvent {
  id: string;
  attempt: number;
  outcome: 'success' | 'failed' | 'pending';
  error: string | null;
  createdAt: string;
}

export interface ScheduledAuditEntry {
  id: string;
  action: string;
  reasonCode: string;
  actor: string;
  createdAt: string;
}

// ─── Ops board row ────────────────────────────────────────────────────────────
export interface ScheduledBookingRow {
  id: string;
  marketId: string;
  userId: string;
  userName: string;
  mode: ScheduledMode;
  status: ScheduledStatus;
  scheduledPickupAt: string;
  leadTimeMinutes: number;
  timezone: string;
  pickupLabel: string | null;
  dropoffLabel: string | null;
  estimatedFareKobo: number | null;
  currency: string;
  dispatchAttempts: number;
  lastDispatchError: string | null;
  materializedRef: string | null;
  materializedKind: 'trip' | 'parcel' | 'bus_ticket' | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Detail ───────────────────────────────────────────────────────────────────
export interface ScheduledBookingDetail extends ScheduledBookingRow {
  pickupGeo: { lat: number; lng: number } | null;
  dropoffGeo: { lat: number; lng: number } | null;
  modePayload: Record<string, unknown>;
  paymentMethod: string;
  settlementId: string | null;
  reminder24hSentAt: string | null;
  reminder1hSentAt: string | null;
  cancelReason: string | null;
  dispatchedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  dispatchHistory: ScheduledDispatchEvent[];
  auditLog: ScheduledAuditEntry[];
}

export interface ScheduledFilter {
  status?: ScheduledStatus | '';
  mode?: ScheduledMode | '';
  from?: string;
  to?: string;
}

// ─── Admin mutation payloads — every mutation REQUIRES reason_code ──────────
export interface ScheduledReasonPayload {
  reasonCode: string;
}

export interface ScheduledReassignPayload extends ScheduledReasonPayload {
  driverId?: string;
}
