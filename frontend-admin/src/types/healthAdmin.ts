// ── Types — Paymax Health admin (Pharmacy vertical; shared by Lab + Vet later) ──
// Money is BIGINT kobo (minor units) throughout — formatNaira() converts kobo → ₦.
// Surfaces the HEALTH invariants HL-1..HL-12 (HEALTH-BUILD §4):
//  HL-2 credential-gated supply · HL-3 Rx discipline (dispense-once) ·
//  HL-4 controlled substances · HL-5 NAFDAC-only catalog · HL-8 NDPA sensitive data ·
//  HL-9 money held→released→refunded · HL-10 payout KYC gate · HL-12 immutable audit.

// ── A · Dashboard ─────────────────────────────────────────────────────────────
export type PharmacyActivity = {
  id: string;
  kind: string; // pcn_approved | catalog_rejected | rx_verified | order_dispensed | recall_issued | payout_held ...
  label: string;
  ref?: string | null;
  created_at: string;
};

export type PharmacyDashboard = {
  generated_at: string;
  orders_today: number;
  orders_30d: number;
  gmv_today_kobo: number;
  gmv_30d_kobo: number;
  net_revenue_30d_kobo: number;
  take_rate: number;
  avg_order_value_kobo: number;
  rx_pending_verification: number;
  rx_verify_sla_minutes: number; // median pharmacist verify turnaround
  rx_verify_sla_target_minutes: number;
  rx_verify_breaches: number; // orders over SLA
  pcn_pending_review: number;
  catalog_pending_governance: number;
  catalog_unregistered_blocked: number; // HL-5 rejected-at-write count (30d)
  controlled_attempts_blocked: number; // HL-4
  recalls_open: number;
  payouts_kyc_hold: number; // HL-10
  held_balance_kobo: number; // HL-9 escrow held (payment held until delivery/pickup)
  released_30d_kobo: number;
  refunded_30d_kobo: number;
  pharmacies_active: number;
  pharmacies_suspended: number;
  order_mix: { label: string; orders: number; gmv_kobo: number; share_pct: number }[];
  gmv_trend: { date: string; gmv_kobo: number; net_kobo: number }[];
  activity: PharmacyActivity[];
};

// ── B · PCN / premises verification audit queue (HL-2) ─────────────────────────
export type PcnApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'needs_info'
  | 'approved'
  | 'suspended'
  | 'rejected';

export type PcnCredentialDoc = {
  kind: string; // PCN_premises_licence | superintendent_pharmacist | CAC | facility_photo
  reference: string;
  expires_at?: string | null;
  verified: boolean;
};

export type PcnApplication = {
  id: string;
  pharmacy_name: string;
  superintendent_masked: string; // superintendent pharmacist (NDPA — masked)
  pcn_premises_no: string; // PCN premises registration number
  pcn_pharmacist_no: string; // PCN superintendent pharmacist licence number
  cac_rc_no: string;
  state: string;
  lga: string;
  status: PcnApplicationStatus;
  premises_verified: boolean; // PCN premises check passed
  pharmacist_verified: boolean; // PCN pharmacist licence check passed
  licence_expires_at: string | null; // earliest expiry — drives auto-suspend (HL-2)
  docs: PcnCredentialDoc[];
  submitted_at: string | null;
  created_at: string;
};

export type PcnDecision = 'approve' | 'reject' | 'need_info' | 'suspend' | 'reinstate';

export type PcnDecisionResult = {
  id: string;
  status: PcnApplicationStatus;
  capability_granted: boolean; // on approve: idempotent provider capability grant
  audit_id: string;
  message: string;
};

// ── C · Catalog / NAFDAC governance (HL-5) ─────────────────────────────────────
export type CatalogStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export type CatalogItem = {
  id: string;
  product_name: string;
  brand: string;
  pharmacy_masked: string;
  nafdac_reg_no: string | null; // NAFDAC registration number — null/invalid ⇒ reject at write (HL-5)
  nafdac_valid: boolean;
  form: string; // tablet | capsule | syrup | injection ...
  strength: string;
  pom: boolean; // prescription-only medicine (HL-3 gate at order time)
  controlled: boolean; // controlled substance (HL-4 — excluded at MVP)
  price_kobo: number;
  stock: number;
  status: CatalogStatus;
  flagged_reason: string | null; // e.g. "no NAFDAC ref", "banned substance", "controlled"
  created_at: string;
};

export type CatalogGovernanceAction = 'approve' | 'reject' | 'suspend';

export type CatalogGovernanceResult = {
  id: string;
  status: CatalogStatus;
  audit_id: string;
  message: string;
};

// ── D · Rx & controlled-substance audit (HL-3 / HL-4) ──────────────────────────
export type RxStatus =
  | 'issued'
  | 'sent_to_pharmacy'
  | 'verifying'
  | 'verified'
  | 'dispensed'
  | 'fulfilled'
  | 'rejected';

export type RxAuditItem = {
  id: string;
  patient_masked: string; // NDPA — masked subject (HL-8)
  prescriber_masked: string;
  pharmacy_masked: string;
  pharmacist_masked: string | null; // licensed pharmacist who verified (HL-3)
  status: RxStatus;
  pom_items: number;
  controlled_items: number; // should be 0 at MVP (HL-4)
  dispense_once_ok: boolean; // server-side dispense-once invariant held (HL-3)
  verify_minutes: number | null; // verification turnaround
  order_ref: string | null;
  issued_at: string;
  verified_at: string | null;
  dispensed_at: string | null;
};

export type ControlledLogEntry = {
  id: string;
  substance: string;
  schedule: string; // statutory schedule classification
  pharmacy_masked: string;
  attempted_by_masked: string;
  outcome: 'blocked' | 'logged'; // MVP: blocked (HL-4). Statutory register entry if ever enabled.
  reason: string;
  created_at: string;
};

// ── E · Order / delivery oversight ─────────────────────────────────────────────
export type PharmacyOrderStatus =
  | 'created'
  | 'rx_pending_verification'
  | 'confirmed'
  | 'dispensed'
  | 'in_delivery'
  | 'ready_for_pickup'
  | 'delivered'
  | 'collected'
  | 'closed'
  | 'cancelled'
  | 'refunded';

export type PaymentHoldStatus = 'held' | 'released' | 'refunded';

export type PharmacyOrderSummary = {
  id: string;
  patient_masked: string;
  pharmacy_masked: string;
  status: PharmacyOrderStatus;
  fulfilment: 'delivery' | 'pickup';
  has_pom: boolean;
  amount_kobo: number;
  payment_status: PaymentHoldStatus; // HL-9 held→released→refunded
  delivery_ref: string | null; // last-mile transport rail dispatch ref
  created_at: string;
};

export type PharmacyOrderLine = {
  product_name: string;
  nafdac_reg_no: string | null;
  pom: boolean;
  qty: number;
  unit_price_kobo: number;
  line_total_kobo: number;
};

export type PharmacyOrderTimeline = {
  id: string;
  status: string;
  label: string;
  actor_masked: string;
  audit_id: string;
  at: string;
};

export type PharmacyOrderDetail = PharmacyOrderSummary & {
  lines: PharmacyOrderLine[];
  subtotal_kobo: number;
  delivery_fee_kobo: number;
  total_kobo: number;
  rx_ref: string | null;
  pickup_code: string | null;
  timeline: PharmacyOrderTimeline[];
};

// ── F · Pharmacovigilance / recall ─────────────────────────────────────────────
export type RecallSeverity = 'low' | 'medium' | 'high' | 'critical';
export type RecallStatus = 'open' | 'investigating' | 'resolved' | 'closed';

export type RecallRecord = {
  id: string;
  product_name: string;
  nafdac_reg_no: string | null;
  batch_no: string;
  pharmacy_masked: string;
  severity: RecallSeverity;
  status: RecallStatus;
  reason: string;
  units_affected: number;
  patients_notified: number;
  created_at: string;
};

export type CreateRecallInput = {
  product_name: string;
  nafdac_reg_no?: string;
  batch_no: string;
  severity: RecallSeverity;
  reason: string;
};

export type CreateRecallResult = {
  id: string;
  status: RecallStatus;
  audit_id: string;
  message: string;
};

// ── G · Payouts (KYC-gated — HL-10) ────────────────────────────────────────────
export type PayoutStatus = 'pending' | 'approved' | 'paid' | 'kyc_hold' | 'rejected';

export type PayoutRecord = {
  id: string;
  pharmacy_masked: string;
  kyc_tier: string; // tier0..tier3
  kyc_verified: boolean;
  collected_kobo: number; // released-to-provider gross over period (HL-9)
  fees_kobo: number;
  net_payable_kobo: number;
  payout_status: PayoutStatus;
  aml_flag: boolean; // AML check on settlement (HL-10)
  created_at: string;
};

export type PayoutDecision = 'approve' | 'reject';

export type PayoutDecisionResult = {
  id: string;
  payout_status: PayoutStatus;
  audit_id: string;
  message: string;
};

// ── H · Reporting ──────────────────────────────────────────────────────────────
export type ReportingData = {
  generated_at: string;
  period_label: string;
  gmv_kobo: number;
  net_revenue_kobo: number;
  orders: number;
  rx_orders: number;
  otc_orders: number;
  refund_rate: number;
  avg_verify_minutes: number;
  nafdac_block_rate: number; // share of catalog writes rejected for NAFDAC (HL-5)
  controlled_blocked: number; // HL-4
  recalls_issued: number;
  payouts_kyc_hold: number; // HL-10
  by_state: { state: string; orders: number; gmv_kobo: number; share_pct: number }[];
  monthly: { month: string; gmv_kobo: number; net_kobo: number; orders: number }[];
};
