// ── Spotlight Realtor — Maintenance triangle types (V2) ──────────────────────
// The three-party repair SLA: tenant → owner/manager → vendor. Costs flow into
// the owner's financial cockpit. Money is integer minor units (kobo).

import type { Kobo } from './realtor.types';

export type MaintenanceCategory =
  | 'plumbing' | 'electrical' | 'ac_hvac' | 'generator' | 'water' | 'roof_leak'
  | 'door_lock' | 'appliance' | 'pest' | 'painting' | 'furniture' | 'internet'
  | 'security' | 'structural' | 'cleaning' | 'other';

export type Urgency = 'low' | 'normal' | 'high' | 'emergency';

/** The three-party status machine (tenant T / manager M / vendor V). */
export type MaintenanceStatus =
  | 'submitted'           // T reported
  | 'manager_review'      // M reviewing
  | 'vendor_assigned'     // M assigned a vendor
  | 'quote_submitted'     // V submitted a quote
  | 'quote_approved'      // M/owner approved
  | 'quote_rejected'      // M/owner rejected
  | 'in_progress'         // V working
  | 'completed'           // V uploaded evidence
  | 'tenant_confirmed'    // T confirmed
  | 'closed'              // paid + rated
  | 'cancelled';

export interface MaintenanceMedia {
  id: string;
  url: string;
  kind: 'image' | 'video';
}

export interface MaintenanceEvent {
  key: MaintenanceStatus;
  label: string;
  state: 'done' | 'current' | 'upcoming';
  at?: string;
  by?: 'tenant' | 'manager' | 'vendor';
}

export interface VendorRef {
  id: string;
  name: string;
  trade: string;        // "Plumber"
  rating: number;
  avatarUrl?: string;
  phone?: string;
}

export interface MaintenanceRequest {
  id: string;
  unitLabel: string;
  propertyName: string;
  area: string;
  category: MaintenanceCategory;
  urgency: Urgency;
  title: string;
  description: string;
  media: MaintenanceMedia[];
  status: MaintenanceStatus;
  vendor?: VendorRef;
  quoteAmount?: Kobo;
  quoteNote?: string;
  completionEvidence: MaintenanceMedia[];
  timeline: MaintenanceEvent[];
  rating?: number;
  createdAt: string;
  /** Emergency requests bypass the approval gate per the iron-rule exception. */
  emergencyBypass: boolean;
}

export interface NewMaintenanceDraft {
  category: MaintenanceCategory;
  urgency: Urgency;
  title: string;
  description: string;
  mediaUris: string[];
}

// ── Vendor side ──────────────────────────────────────────────────────────────

export interface VendorJob {
  id: string;                 // == request id
  title: string;
  category: MaintenanceCategory;
  urgency: Urgency;
  propertyName: string;
  unitLabel: string;
  area: string;
  status: MaintenanceStatus;
  quoteAmount?: Kobo;
  payout?: Kobo;
  createdAt: string;
}

export interface QuoteDraft {
  requestId: string;
  amount: Kobo;
  note: string;
}
