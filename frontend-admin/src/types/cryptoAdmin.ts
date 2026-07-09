// Paymax Crypto admin console — domain types.
// Mirrors backend/internal/crypto/model.go. Admin routes are mounted at
// /api/v1/admin/crypto (member routes at /api/v1/crypto), gated by
// FEATURE_CRYPTO_ENABLED and RBAC guard(crypto.admin) — see
// backend/internal/app/finance_routes.go and backend/internal/crypto/routes.go.
// Backend RBAC is authoritative — permission gates in the UI are UX-only.
//
// Money: price_kobo / cash_kobo / value_kobo are integers (NGN kobo). NEVER do
// math on these in floats — format-only via formatKobo() in the service layer.
// `units` / `minor_unit_scale` are integer asset-minor-unit fields (not money).

export type CryptoOrderSide = 'buy' | 'sell';

export type CryptoOrderStatus = 'pending' | 'filled' | 'failed' | 'reversed' | string;

export interface CryptoAsset {
  id: string;
  symbol: string;
  name: string;
  minor_unit_scale: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CryptoOrder {
  id: string;
  user_id: string;
  asset_id: string;
  symbol?: string;
  side: CryptoOrderSide;
  status: CryptoOrderStatus;
  cash_kobo: number;
  units: number;
  price_kobo: number;
  reference?: string;
  created_at: string;
}

// POST /api/v1/admin/crypto/assets body — create or update a catalogue asset.
export interface CryptoAssetConfigRequest {
  symbol: string;
  name: string;
  minor_unit_scale: number;
  is_active: boolean;
}

// ─── Withdrawal / AML oversight ───────────────────────────────────────────────
// Mirrors backend/internal/crypto/model_ext.go Withdrawal + its guarded state
// machine (WithdrawalRequested → Pending → Broadcast → Confirmed | Failed).
// The member-side state machine is authoritative; the admin AML queue drives the
// requested→pending (approve) or requested→failed (reject) transitions. NOTE: the
// admin withdrawal routes below are NOT yet wired server-side (only member routes
// exist today) — the console is mock-first and the live fetch paths target the
// planned /admin/crypto/withdrawals* routes, matching the existing naming.

export type CryptoWithdrawalStatus =
  | 'requested' | 'pending' | 'broadcast' | 'confirmed' | 'failed' | string;

// AML risk flags surfaced on a pending withdrawal (screening + heuristics).
export type CryptoAmlFlag =
  | 'sanctioned_address'
  | 'high_risk_geo'
  | 'velocity'
  | 'first_withdrawal'
  | 'address_age'
  | 'amount_threshold'
  | 'mixer_exposure'
  | string;

export interface CryptoWithdrawal {
  id: string;
  user_id: string;
  asset_id: string;
  symbol?: string;
  address_id: string;
  address?: string;
  network?: string;
  status: CryptoWithdrawalStatus;
  units: number;
  network_fee_units: number;
  fee_kobo: number;
  price_kobo: number;
  value_kobo: number;        // units × price_kobo / minor_unit_scale (server-computed)
  provider: string;
  provider_ref?: string;
  tx_hash?: string;
  failure_reason?: string;
  reference?: string;
  aml_flags?: CryptoAmlFlag[];
  aml_score?: number;        // 0-100 risk score (higher = riskier)
  created_at: string;
  updated_at: string;
}

// POST /admin/crypto/withdrawals/:id/decision body.
export interface CryptoWithdrawalDecisionRequest {
  decision: 'approve' | 'reject';
  note: string;
}

// ─── Swap monitoring ──────────────────────────────────────────────────────────
// Mirrors backend/internal/crypto/model_ext.go SwapOrder.
export interface CryptoSwapOrder {
  id: string;
  user_id: string;
  from_asset_id: string;
  from_symbol?: string;
  to_asset_id: string;
  to_symbol?: string;
  status: string;
  from_units: number;
  to_units: number;
  from_price_kobo: number;
  to_price_kobo: number;
  cash_kobo: number;
  spread_kobo: number;
  spread_bps: number;
  reference?: string;
  anomaly?: string;          // non-empty when flagged (e.g. spread out of band)
  created_at: string;
}

// ─── Address allow-list review ────────────────────────────────────────────────
// Mirrors backend/internal/crypto/model_ext.go Address, plus admin review fields.
export type CryptoAddressReview = 'pending' | 'approved' | 'rejected' | string;

export interface CryptoAddress {
  id: string;
  user_id: string;
  asset_id: string;
  symbol?: string;
  label: string;
  network: string;
  address: string;
  is_active: boolean;
  review_status: CryptoAddressReview;
  screening_result?: string; // sanction/AML screening verdict
  verified_at?: string | null;
  created_at: string;
}

export interface CryptoAddressDecisionRequest {
  decision: 'approve' | 'reject';
  note: string;
}

// ─── Reconciliation (on-chain vs ledger drift) ───────────────────────────────
// Per-asset comparison of the on-chain custodial balance vs the sum of holding
// projections in the finance ledger. Drift ≠ 0 is a break to investigate.
export interface CryptoReconRow {
  asset_id: string;
  symbol: string;
  minor_unit_scale: number;
  ledger_units: number;      // Σ holding projections (integer minor units)
  onchain_units: number;     // custodial/on-chain balance (integer minor units)
  drift_units: number;       // onchain_units − ledger_units (signed)
  price_kobo: number;        // last quote, for cash-equivalent drift
  status: 'ok' | 'break' | string;
  last_checked_at: string;
}

export interface CryptoReconSummary {
  rows: CryptoReconRow[];
  breaks: number;
  as_of: string;
}
