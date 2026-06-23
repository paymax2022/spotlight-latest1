// ── Spotlight Realtor — Lease / payment / move-in types (V2) ─────────────────
// Continues the funnel past application approval:
//   lease → e-sign → rent/deposit payment (escrow) → move-in → occupancy.
// Money is integer minor units (kobo).

import type { Kobo, RentSchedule } from './realtor.types';

export type LeaseStatus =
  | 'draft'
  | 'awaiting_tenant_signature'
  | 'awaiting_landlord_signature'
  | 'signed'
  | 'active'
  | 'ended';

export interface LeaseClause {
  heading: string;
  body: string;
}

export interface Lease {
  id: string;
  applicationId: string;
  listingId: string;
  listingTitle: string;
  area: string;
  city: string;
  status: LeaseStatus;
  rentSchedule: RentSchedule;
  rent: Kobo;
  cautionDeposit: Kobo;       // refundable, held in escrow
  serviceCharge?: Kobo;
  startDate: string;          // ISO date
  endDate: string;            // ISO date
  clauses: LeaseClause[];
  tenantSigned: boolean;
  landlordSigned: boolean;
  signedAt?: string;
  /** Invoice generated once the lease is signed (rent + deposit). */
  invoiceId?: string;
}

export interface SignLeaseDraft {
  leaseId: string;
  signatureName: string;      // typed full-name e-signature
  agreed: boolean;
}

// ── Invoice & payment ────────────────────────────────────────────────────────

export type InvoiceStatus = 'pending' | 'processing' | 'paid' | 'failed';

export interface InvoiceLine {
  label: string;
  amount: Kobo;
  refundable?: boolean;       // deposit → escrow
}

export interface RentInvoice {
  id: string;
  leaseId: string;
  listingTitle: string;
  status: InvoiceStatus;
  lines: InvoiceLine[];
  total: Kobo;
  dueDate: string;
  paidAt?: string;
}

export type PaymentChannel = 'WALLET' | 'PAYSTACK';

export interface PayInvoiceDraft {
  invoiceId: string;
  channel: PaymentChannel;
}

export interface PaymentReceipt {
  id: string;
  invoiceId: string;
  status: InvoiceStatus;
  amount: Kobo;
  channel: PaymentChannel;
  reference: string;
  paidAt: string;
  /** Portion routed to escrow (caution/security deposit). */
  escrowHeld: Kobo;
}

// ── Escrow ───────────────────────────────────────────────────────────────────

export type EscrowStatus = 'held' | 'release_requested' | 'released' | 'disputed';

export interface EscrowDeposit {
  id: string;
  leaseId: string;
  amount: Kobo;
  status: EscrowStatus;
  heldSince: string;
  releaseCondition: string;   // e.g. "Released after a clean move-out inspection"
}

// ── Move-in ──────────────────────────────────────────────────────────────────

export interface MoveInChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface MoveIn {
  leaseId: string;
  checklist: MoveInChecklistItem[];
  keysHandedOver: boolean;
  occupancyActivated: boolean;
}
