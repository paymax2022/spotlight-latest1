// The Property Management super-module spans four pillars (Marketplace, Stays,
// Rent & Tenancy, Estate & Visitor Access). A user may hold roles across several
// what they see. Types here are shared by the mock + live API paths.

export type ContextType = 'estate' | 'property' | 'agency' | 'org';

/** Context entity types the server may return. 'role' entities are read-only:
 *  the server refuses to switch into them, so SwitchContextInput excludes it. */
export type ContextEntityType = ContextType | 'role';

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

/** Registrable marketplace roles carried by read-only 'role' context entities. */
export type ProfessionalContextRole = 'estate_manager' | 'developer' | 'agent';

/** Any role slug a context entity may carry. */
export type ContextRole = PropertyRole | ProfessionalContextRole;

export interface PropertyContext {
  type:  ContextEntityType;
  id:    string;
  name:  string;
  roles: ContextRole[];
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

export interface StayGatePass {
  bookingId:  string;
  guestName:  string;
  estateName?: string;
  qrPayload:  string;   // QR encoding (scanned at the gate)
  pin:        string;   // numeric fallback
  validFrom:  string;   // ISO
  validTo:    string;   // ISO
}
