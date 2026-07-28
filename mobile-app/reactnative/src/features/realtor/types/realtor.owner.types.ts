// ── Spotlight Realtor — Owner / landlord types (V2) ──────────────────────────
// The create-side of the property graph + the Owner Financial Cockpit + Void
// Optimization (the signature differentiator). Money is integer minor units.

import type { Kobo, PropertyType, Furnishing, TransactionMode, RentSchedule, UnitStatus } from './realtor.types';
export type { PropertyType, Furnishing } from './realtor.types';

export interface OwnerMetric {
  key: string;
  label: string;
  /** Pre-formatted display value (e.g. "₦4.2M", "92%"). */
  value: string;
  tone?: 'success' | 'warning' | 'error' | 'neutral';
  hint?: string;
}

export interface OwnerPropertySummary {
  id: string;
  name: string;
  area: string;
  city: string;
  coverUrl: string;
  unitCount: number;
  occupiedCount: number;
  monthlyRent: Kobo;
  arrears: Kobo;
}

export interface OwnerDashboard {
  metrics: OwnerMetric[];
  properties: OwnerPropertySummary[];
  voidCandidateCount: number;
}

// ── Property creation ─────────────────────────────────────────────────────────

export interface CreatePropertyDraft {
  name: string;
  type: PropertyType;
  address: string;
  area: string;
  city: string;
  state: string;
}

export interface CreateUnitDraft {
  propertyId: string;
  label: string;
  propertyType: PropertyType;
  bedrooms: number;
  bathrooms: number;
  toilets: number;
  furnishing: Furnishing;
}

// ── Offering mode config ─────────────────────────────────────────────────────

export interface OfferingModeConfig {
  mode: TransactionMode;
  enabled: boolean;
  price: Kobo;                 // sale price OR per-schedule rent
  rentSchedule?: RentSchedule;
  nightlyPrice?: Kobo;
  cautionDeposit?: Kobo;
}

export interface UnitOfferings {
  unitId: string;
  unitLabel: string;
  status: UnitStatus;
  modes: OfferingModeConfig[];
}

// ── Void optimization ─────────────────────────────────────────────────────────

export interface VoidCandidate {
  unitId: string;
  unitLabel: string;
  propertyName: string;
  area: string;
  vacantDays: number;
  monthlyRent: Kobo;
  /** Recommended nightly shortlet price from the demand/seasonality signal. */
  recommendedNightly: Kobo;
  projectedMonthlyVoidRevenue: Kobo;
  shortletEnabled: boolean;
  /** Set when a long-term application is in progress — blocks new shortlet nights. */
  longTermConflict?: boolean;
}
