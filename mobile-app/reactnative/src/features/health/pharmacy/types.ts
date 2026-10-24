// Vertical types for the Pharmacy module, built on the shared health platform
// (src/features/health/types.ts). IRON RULES:
//  • All monetary amounts are integers in minor units (kobo). Never floats.
//  • HL-3 prescription discipline: POM (Rx-required) needs a pharmacist-verified
//  • HL-5 NAFDAC-only catalog: every product carries a NAFDAC registration ref.
//  • HL-9 money held → released → refunded (escrow), idempotent on order/checkout.

import type { CredentialStatus, ProviderCredential } from '../types';

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

export interface CartLine {
  productId: string;
  /** The pharmacy that sells this line. One order = one pharmacy: CreateOrder
   *  re-checks every line against the order's pharmacy_provider_id. */
  pharmacyId: string;
  pharmacyName: string;
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
  /** The pharmacy's own courier fare. Informational only: the order the server
   *  creates is priced at goods alone, so this is never part of totalKobo. */
  deliveryFeeKobo: number;
  /** Amount actually held at checkout — the goods subtotal (see deliveryFeeKobo). */
  totalKobo: number;
  /** True if any line is Rx-required (drives the verified-Rx gate at checkout). */
  requiresRx: boolean;
  /** The single pharmacy every line belongs to ('' while the cart is empty). */
  pharmacyId: string;
  pharmacyName: string;
}

// Backend lifecycle: ISSUED → SENT_TO_PHARMACY → VERIFYING → VERIFIED|REJECTED →
// DISPENSED. 'issued' is the patient's own state — the e-Rx exists but has not been
// sent to a pharmacy yet, so "send it" is the action offered there.
// 'clarification' has no backend equivalent (mock only); see decideRx.
export type RxStatus = 'issued' | 'verifying' | 'verified' | 'rejected' | 'clarification' | 'dispensed';

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
  /** DP-004 refill authority carried by the e-Rx itself. A refill is spent by the
   *  pharmacist at the counter, so the patient's only action is to ask for one —
   *  these counters say whether asking is even possible. */
  refillsAuthorized?: number;
  refillsUsed?: number;
}

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

export type FulfilmentType = 'delivery' | 'pickup';

// PharmacyOrder state machine (HEALTH-BUILD §5):
// CREATED → [RX_PENDING] → CONFIRMED → DISPENSED → IN_DELIVERY|READY_FOR_PICKUP
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
  /** Patient-supplied dropoff, captured at checkout (delivery orders only). */
  deliveryAddress?: string;
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
  /**
   * Delivery dropoff — REQUIRED when fulfilment === 'delivery' (the backend
   * fails the order closed without it; Dispatch can never resolve a courier
   * route otherwise). Unused for pickup.
   */
  deliveryAddress?: string;
  deliveryLat?: number;
  deliveryLng?: number;
}

/** A medicine the patient has been prescribed, derived from their own e-Rx history.
 * The backend tracks neither adherence nor days of supply, so this carries only what
 * a prescription record actually states: the drug, the prescriber's directions, and
 * the refill authority still left on it (DP-004). */
export interface MedicationItem {
  /** rxId + drug index — one key per prescribed medicine. */
  id: string;
  /** The prescription this line came from; a refill is spent against it. */
  rxId: string;
  name: string;
  /** Prescriber directions, e.g. "10mg · 30 tablets". '' when the read omits them. */
  schedule: string;
  status: RxStatus;
  refillsAuthorized: number;
  refillsUsed: number;
}

/** GET /pharmacy/refills — the patient's e-Rxs that still have authorized refills
 * unused (DP-004). The counters live on the prescription; a refill is spent by the
 * pharmacist at the counter, so there is nothing for the patient to schedule. */
export interface PrescriptionRefill {
  rxId: string;
  drugs: string[];
  refillsAuthorized: number;
  refillsUsed: number;
  lastDispensedAt?: string;
}

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

export interface PharmacistConsultMessage {
  id: string;
  fromPharmacist: boolean;
  author: string;
  body: string;
  at: string;
}

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

/** One line of the pharmacy owner's own shelf (GET /pharmacy/products/mine).
 *  Unlike the customer catalog this includes lines patients cannot buy, so the
 *  owner can see and fix whatever took itself off sale. */
export interface CatalogStockItem {
  productId: string;
  /** The health_providers row this line belongs to — required to add or edit a
   *  product, since POST /products is scoped by pharmacy owner (HL-2). */
  pharmacyProviderId: string;
  pharmacyName: string;
  name: string;
  form: string;
  priceKobo: number;
  nafdacReg: string;
  /** HL-5: only REGISTERED products reach patients; anything else is listed but
   *  unbuyable until the registration catches up. */
  nafdacStatus: string;
  rxRequired: boolean;
  /** Tracked units on the shelf. 0 does NOT mean empty: it means the owner never
   *  opted this product into inventory tracking, so it is unlimited. Availability
   *  is carried by inStock, which the server flips false when a tracked product
   *  actually sells out. */
  stock: number;
  inStock: boolean;
  active: boolean;
}

/** The signed-in user's own pharmacy, resolved from their provider application. */
export interface MyPharmacy {
  /** '' until an admin approves the application — the health_providers row (and
   *  with it product writes, review reads and earnings scope) only exists then. */
  providerId: string;
  businessName: string;
  approved: boolean;
}

/** POST /pharmacy/products (HL-2 owner-scoped write, HL-5 NAFDAC gate). Passing an
 *  `id` edits that line; the owner shelf is the only place it can come from. */
export interface UpsertProductInput {
  id?: string;
  name: string;
  nafdacReg: string;
  priceKobo: number;
  rxRequired: boolean;
  /** Units to track. 0 lists the product without inventory tracking. */
  stockQty: number;
  active: boolean;
}

/** A product the pharmacy owns that patients cannot currently buy. Derived from
 *  the owner shelf: the schema has no per-product reorder threshold, so this
 *  reports why the line is unbuyable instead of inventing a low-stock alert. */
export interface StockAlert {
  productId: string;
  name: string;
  stock: number;
  reason: 'sold_out' | 'deactivated' | 'nafdac_pending';
}

/** One e-Rx in the pharmacist's work queue (GET /pharmacy/prescriptions/queue). */
export interface ProviderRxQueueItem {
  rxId: string;
  patientName: string;
  /** Empty on the live read — the queue row carries the prescriber's id, not a name. */
  prescriberName?: string;
  uploadedAt: string;
  itemCount: number;
  /** Drug names on the prescription, so the pharmacist sees what is being asked
   *  for before opening it. */
  drugs: string[];
  refillsAuthorized?: number;
  refillsUsed?: number;
  status: RxStatus;
}

export type RxDecision = 'approve' | 'clarify' | 'reject';

/** GET /pharmacy/earnings — the owner's money, scoped server-side to the pharmacies
 *  they own. The backend exposes exactly these figures: everything a customer
 *  paid is either still held on an open order or already released, and payout is
 *  automatic on order completion, so there is no ledger of requests to list. */
export interface ProviderEarnings {
  /** Money already released out of escrow to this owner (live: released_kobo). */
  availableKobo: number;
  /** Customer money still held: paid, not yet released (live: held_kobo). */
  pendingKobo: number;
  /** Count of released orders (live: orders_paid) — makes the money figure readable. */
  ordersPaid: number;
}
