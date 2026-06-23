// ── Paymax Mobility — Business Logistics types ───────────────────────────────
// Types for the business-logistics mode: registered business accounts ship
// single deliveries or bulk batches; billing is prepaid wallet or monthly
// invoice. Mirrors docs/prd/transportation/BUILD-CONTRACT-LOGISTICS-EVENT.md.
//
// IRON RULES: all money is integer minor units (kobo). Never floats for money.
// Fares/COD/invoice amounts are server-computed — the client only *displays* them.

import type { Kobo, Place } from './mobility.types';

// Re-exported so logistics screens can import shared geo/money types from one place.
export type { Kobo, Place } from './mobility.types';

// ═══════════════════════════════════════════════════════════════════════════════
// BUSINESS ACCOUNT
// ═══════════════════════════════════════════════════════════════════════════════
export type BillingMode = 'prepaid' | 'invoice';
export type BusinessAccountType = 'merchant' | 'enterprise' | 'sme';

export interface BusinessAccount {
  id: string;
  name: string;
  accountType: BusinessAccountType;
  billingMode: BillingMode;
  codEnabled: boolean;
  walletBalanceKobo: Kobo;   // prepaid escrow float (server projection)
  currency: 'NGN';
  createdAt: string;
}

export interface AccountCreateRequest {
  name: string;
  accountType: BusinessAccountType;
  billingMode: BillingMode;
  codEnabled: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DELIVERY
// ═══════════════════════════════════════════════════════════════════════════════
export type DeliveryStatus =
  | 'created'
  | 'assigned'
  | 'picked_up'
  | 'delivered'
  | 'failed'
  | 'cancelled';

export type DeliverySize = 'small' | 'medium' | 'large';

/** A single drop in a batch (pre-creation shape). */
export interface DeliveryStop {
  pickup: Place;
  dropoff: Place;
  receiverName: string;
  receiverPhone: string;
  size: DeliverySize;
  codKobo: Kobo;
}

export interface DeliveryCreateRequest {
  pickup: Place;
  dropoff: Place;
  receiverName: string;
  receiverPhone: string;
  size: DeliverySize;
  codKobo: Kobo;
  idempotencyKey: string;     // money mutation → escrow/accrue
}

export interface Delivery {
  id: string;
  status: DeliveryStatus;
  pickup: Place;
  dropoff: Place;
  receiverName: string;
  receiverPhone: string;
  size: DeliverySize;
  fareKobo: Kobo;             // server-computed
  codKobo: Kobo;
  currency: 'NGN';
  courierName: string | null;
  proofUrl: string | null;
  dropoffPin: string | null;  // shown to sender, verified by courier
  failureReason: string | null;
  batchId: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH (bulk dispatch)
// ═══════════════════════════════════════════════════════════════════════════════
export type BatchStatus =
  | 'created'
  | 'dispatched'
  | 'in_progress'
  | 'completed'
  | 'partially_failed';

export interface BatchCreateRequest {
  name: string;
  deliveries: DeliveryCreateRequest[];
  idempotencyKey: string;
}

export interface Batch {
  id: string;
  name: string;
  status: BatchStatus;
  stopCount: number;
  completedCount: number;
  failedCount: number;
  totalFareKobo: Kobo;
  currency: 'NGN';
  createdAt: string;
}

export interface BatchDetail extends Batch {
  deliveries: Delivery[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVOICES + ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════
export type InvoiceStatus = 'open' | 'issued' | 'paid' | 'overdue';

export interface BusinessInvoice {
  id: string;
  periodLabel: string;        // e.g. "May 2026"
  status: InvoiceStatus;
  deliveryCount: number;
  amountKobo: Kobo;
  currency: 'NGN';
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
}

export interface BusinessAnalytics {
  totalDeliveries: number;
  successCount: number;
  failedCount: number;
  successRate: number;        // 0..1
  codCollectedKobo: Kobo;
  spendKobo: Kobo;
  currency: 'NGN';
}
