// ── Paymax Health — Pharmacy types (Phase 1) ─────────────────────────────────
// Vertical types for the Pharmacy module, built on the shared health platform
// (src/features/health/types.ts). IRON RULES:
//  • All monetary amounts are integers in minor units (kobo). Never floats.
//  • HL-3 prescription discipline: POM (Rx-required) needs a pharmacist-verified
//    e-prescription; dispense-once is terminal.
//  • HL-5 NAFDAC-only catalog: every product carries a NAFDAC registration ref.
//  • HL-9 money held → released → refunded (escrow), idempotent on order/checkout.

import type { CredentialStatus, ProviderCredential } from '../types';

// ── Catalog (HL-5 NAFDAC-gated, HL-3 Rx flag) ────────────────────────────────
export type ProductCategory =
  | 'prescription'
  | 'otc'
  | 'wellness'
  | 'first_aid'
  | 'baby'
  | 'devices';

export interface PharmacyProduct {
  id: string;
  /** Owning pharmacy — each product is uploaded and sold by one pharmacy; the
   *  cost is attributed to it at checkout. Maps to backend pharmacy_provider_id
   *  / pharmacy_name. */
  pharmacyId: string;
  pharmacyName: string;
  name: string;
  brand: string;
  /** Strength / pack form line, e.g. "500mg · 20 tablets". */
  form: string;
  category: ProductCategory;
  /** Unit price in kobo. */
  priceKobo: number;
  /** NAFDAC registration number (HL-5) — required to list. */
  nafdacReg: string;
  /** HL-3: prescription-only medicine requires a verified e-Rx before fulfilment. */
  rxRequired: boolean;
  /** Whether it is a controlled substance (HL-4 — excluded/extra controls at MVP). */
  controlled?: boolean;
  imageColor: string; // design-token tint for the product thumbnail placeholder
  description: string;
  /** Whether the item is currently sellable (stock + active). */
  inStock: boolean;
  rating: number;
  reviewCount: number;
  manufacturer: string;
  activeIngredient?: string;
  usage?: string;
  sideEffects?: string;
  storage?: string;
}

// ── Cart ──────────────────────────────────────────────────────────────────────
export interface CartLine {
  productId: string;
  name: string;
  form: string;
  priceKobo: number;
  qty: number;
  rxRequired: boolean;
  imageColor: string;
}

export interface Cart {
  lines: CartLine[];
  /** Sum of line totals, in kobo. */
  subtotalKobo: number;
  deliveryFeeKobo: number;
  /** subtotal + delivery, in kobo. */
  totalKobo: number;
  /** True if any line is Rx-required (drives the verified-Rx gate at checkout). */
  requiresRx: boolean;
}

// ── Prescriptions (HL-3) ─────────────────────────────────────────────────────
// VERIFYING → VERIFIED → (consumed once dispensed); VERIFYING → REJECTED.
export type RxStatus = 'verifying' | 'verified' | 'rejected' | 'clarification' | 'dispensed';

export interface RxItem {
  name: string;
  dosage: string;
  quantity: string;
  /** Maps to a catalog product where available (for one-tap add to cart). */
  productId?: string;
}

export interface Prescription {
  id: string;
  /** Uploaded image / patient-issued reference. */
  source: 'upload' | 'consult';
  status: RxStatus;
  uploadedAt: string;
  verifiedAt?: string;
  /** Pharmacist note on rejection / clarification (HL-3). */
  pharmacistNote?: string;
  /** Verifying pharmacist + pharmacy (shown once verified). */
  pharmacyName?: string;
  pharmacistName?: string;
  patientName: string;
  prescriberName?: string;
  items: RxItem[];
  /** Document thumbnail tint (mock — no signed URL needed for placeholder). */
  docColor: string;
  /** True once dispense-once has consumed it (HL-3 terminal-once). */
  fulfilled?: boolean;
}

// ── Pharmacies (HL-2 PCN+premises verified) ──────────────────────────────────
export interface PharmacyVendor {
  id: string;
  name: string;
  /** PCN credential + premises verification (HL-2). */
  credential: ProviderCredential;
  premisesVerified: boolean;
  address: string;
  distanceKm: number;
  rating: number;
  reviewCount: number;
  /** Estimated delivery window copy, e.g. "30–45 min". */
  etaLabel: string;
  deliveryFeeKobo: number;
  supportsPickup: boolean;
  supportsDelivery: boolean;
  open: boolean;
}

// ── Orders (HL-9 payment HELD → RELEASED → REFUNDED) ─────────────────────────
export type FulfilmentType = 'delivery' | 'pickup';

// PharmacyOrder state machine (HEALTH-BUILD §5):
// CREATED → [RX_PENDING] → CONFIRMED → DISPENSED → IN_DELIVERY|READY_FOR_PICKUP
//   → DELIVERED|COLLECTED → CLOSED ; (any pre-DISPENSED) → CANCELLED → REFUNDED
export type OrderStatus =
  | 'created'
  | 'rx_pending'
  | 'confirmed'
  | 'dispensed'
  | 'in_delivery'
  | 'ready_for_pickup'
  | 'delivered'
  | 'collected'
  | 'closed'
  | 'cancelled'
  | 'refunded';

export interface OrderEvent {
  status: OrderStatus;
  label: string;
  at?: string;
  done: boolean;
}

export interface PharmacyOrder {
  id: string;
  reference: string;
  status: OrderStatus;
  fulfilment: FulfilmentType;
  pharmacyId: string;
  pharmacyName: string;
  lines: CartLine[];
  subtotalKobo: number;
  deliveryFeeKobo: number;
  totalKobo: number;
  /** HL-9: payment captured to a held balance on CREATED, released on completion. */
  paymentHeld: boolean;
  createdAt: string;
  /** Pickup verification code / QR payload (pickup orders). */
  pickupCode?: string;
  /** Live delivery rider context (delivery orders). */
  rider?: { name: string; phone: string; vehicle: string };
  etaLabel?: string;
  /** Whether any line needed an Rx (gates CONFIRMED on verification). */
  requiresRx: boolean;
  rxId?: string;
  timeline: OrderEvent[];
}

export interface CreateOrderInput {
  pharmacyId: string;
  fulfilment: FulfilmentType;
  lines: CartLine[];
  rxId?: string;
  /** Idempotency-Key for the held-payment capture (HL-9 / NL-9). */
  idempotencyKey: string;
  /**
   * Symptom-search event id (uuid) — sent as top-level `search_event_id` so the
   * order links to its symptom context (T1 auto-clears; T2+ opens a pharmacist
   * review case). Omit when the cart didn't come from symptom search.
   */
  searchEventId?: string | null;
}

// ── Refills & medication list ────────────────────────────────────────────────
export interface MedicationItem {
  id: string;
  name: string;
  form: string;
  /** e.g. "1 tablet · twice daily". */
  schedule: string;
  /** Adherence % over the current period. */
  adherence: number;
  /** Days of supply remaining. */
  daysLeft: number;
  rxRequired: boolean;
  productId?: string;
}

export interface Refill {
  id: string;
  medicationName: string;
  form: string;
  /** Next refill due date (ISO). */
  dueAt: string;
  /** True once a refill order has been placed for this cycle. */
  scheduled: boolean;
  autoRefill: boolean;
  rxId?: string;
  productId?: string;
}

// ── Ratings ───────────────────────────────────────────────────────────────────
export interface PharmacyReview {
  id: string;
  author: string;
  rating: number;
  body: string;
  at: string;
  orderRef?: string;
}

export interface SubmitReviewInput {
  pharmacyId: string;
  orderId?: string;
  rating: number;
  body: string;
}

// ── Pharmacist consult ────────────────────────────────────────────────────────
export interface PharmacistConsultMessage {
  id: string;
  fromPharmacist: boolean;
  author: string;
  body: string;
  at: string;
}

// ── Provider side ─────────────────────────────────────────────────────────────
export type ProviderOnboardingStep =
  | 'business'
  | 'pcn'
  | 'premises'
  | 'review';

export interface ProviderOnboardingState {
  status: 'draft' | 'submitted' | 'under_review' | 'needs_info' | 'approved';
  pcnLicenseNo?: string;
  pcnStatus: CredentialStatus;
  premisesVerified: boolean;
  businessName?: string;
}

export interface CatalogStockItem {
  productId: string;
  name: string;
  form: string;
  priceKobo: number;
  nafdacReg: string;
  rxRequired: boolean;
  stock: number;
  /** Threshold under which a low-stock alert fires. */
  reorderLevel: number;
  active: boolean;
}

export interface ProviderRxQueueItem {
  rxId: string;
  patientName: string;
  prescriberName?: string;
  uploadedAt: string;
  itemCount: number;
  status: RxStatus;
}

export type RxDecision = 'approve' | 'clarify' | 'reject';

export interface ControlledLogEntry {
  id: string;
  drugName: string;
  patientName: string;
  quantity: string;
  pharmacistName: string;
  /** Statutory register reference (HL-4). */
  registerRef: string;
  at: string;
}

export interface ProviderEarnings {
  availableKobo: number;
  pendingKobo: number;
  /** Lifetime released, in kobo. */
  lifetimeKobo: number;
  payouts: { id: string; amountKobo: number; at: string; status: 'paid' | 'processing' }[];
  /** Per-order settlement rows (HL-9 held → released). */
  settlements: { orderRef: string; grossKobo: number; feeKobo: number; netKobo: number; status: 'held' | 'released'; at: string }[];
}

export interface StockAlert {
  productId: string;
  name: string;
  stock: number;
  reorderLevel: number;
  severity: 'low' | 'out';
}
