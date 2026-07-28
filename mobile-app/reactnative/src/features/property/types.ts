// ── Property Management — domain types ───────────────────────────────────────
// The Property Management super-module spans four pillars (Marketplace, Stays,
// Rent & Tenancy, Estate & Visitor Access). A user may hold roles across several
// contexts (estates, owned properties, agencies, orgs); the active context scopes
// what they see. Types here are shared by the mock + live API paths.

export type ContextType = 'estate' | 'property' | 'agency' | 'org';

export type PropertyRole =
  | 'tenant'
  | 'landlord'
  | 'host'
  | 'guest'
  | 'agent'
  | 'guard'
  | 'estate_admin'
  | 'vendor'
  | 'resident';

export interface PropertyContext {
  type:  ContextType;
  id:    string;
  name:  string;
  roles: PropertyRole[];
}

export interface ActiveContextRef {
  type: ContextType;
  id:   string;
}

export interface ContextEnvelope {
  activeContext: ActiveContextRef | null;
  contexts:      PropertyContext[];
}

export interface SwitchContextInput {
  contextType: ContextType;
  contextId:   string;
}

// ── Rent Passport (M-RTN-05) — portable, cross-landlord tenancy reputation ────
export interface RentPassportPayment {
  id:         string;
  paidAt:     string;  // ISO date
  amountKobo: number;  // minor units — never floats
  onTime:     boolean;
  propertyName?: string;
}

export interface RentPassport {
  userId:        string;
  score:         number;   // 0–100 portable score
  onTimeRate:    number;   // 0–1
  totalPaidKobo: number;   // minor units
  paymentsCount: number;
  recentPayments: RentPassportPayment[];
}

// ── Stay gate pass — auto-issued visitor pass for a confirmed stay ────────────
export interface StayGatePass {
  bookingId:  string;
  guestName:  string;
  estateName?: string;
  qrPayload:  string;   // QR encoding (scanned at the gate)
  pin:        string;   // numeric fallback
  validFrom:  string;   // ISO
  validTo:    string;   // ISO
}
