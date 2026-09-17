// ── Admin — Property Management Suite types ─────────────────────────────────
// Mirrors backend/internal/property/{context.go,rentpassport.go}. All money is
// integer minor units (kobo). See docs/qa/modules/property.md for the full
// endpoint contract this was derived from.

export type PropertyContextType = 'estate' | 'property' | 'agency' | 'org';

export interface PropertyContextRef {
  type: PropertyContextType;
  id: string;
}

export interface PropertyContextEntity {
  type: PropertyContextType;
  id: string;
  name: string;
  roles: string[];
}

export interface PropertyContextResponse {
  activeContext: PropertyContextRef | null;
  contexts: PropertyContextEntity[];
}

export type RentPaymentSource = 'estate' | 'realtor';
export type RentPaymentCategory = 'rent' | 'service_charge' | 'lease' | 'other';

export interface RentRecentPayment {
  source: RentPaymentSource;
  amountKobo: number;
  category: RentPaymentCategory;
  onTime: boolean;
  paidAt: string;
}

export interface RentPassport {
  userId: string;
  score: number;
  onTimeRate: number;
  totalPaidKobo: number;
  paymentsCount: number;
  oldestTenancy?: string | null;
  recentPayments: RentRecentPayment[];
}
