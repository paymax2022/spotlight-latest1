// Paymax Crypto admin console — domain types.
// Mirrors backend/internal/crypto/model.go. Admin routes are mounted at
// /api/v1/admin/crypto (member routes at /api/v1/crypto), gated by
// FEATURE_CRYPTO_ENABLED and RBAC guard(crypto.admin) — see
// backend/internal/app/finance_routes.go and backend/internal/crypto/routes.go.
// Backend RBAC is authoritative — permission gates in the UI are UX-only.
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

// Mirrors backend/internal/crypto/model_ext.go Withdrawal + its guarded state
// machine (WithdrawalRequested → Pending → Broadcast → Confirmed | Failed).
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
  aml_score?: number;
  created_at: string;
  updated_at: string;
}

// POST /admin/crypto/withdrawals/:id/decision body.
export interface CryptoWithdrawalDecisionRequest {
  decision: 'approve' | 'reject';
  note: string;
}

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

// Mirrors backend/internal/cryptosvc/admin.go AdminReviewSwap — a swap from the NEW
// provider-driven BUY swap pipeline (table crypto_swaps) that the pipeline could not
// auto-resolve and parked in needs_review with the user's NGN still held in the ledger.
// DISTINCT from CryptoSwapOrder above, which is the LEGACY crypto_swap_orders asset→asset
// swap read off /admin/crypto/swaps. This one comes from /admin/crypto/swaps/review.
// Money fields are integer kobo — never floats, format-only via formatKobo().
export interface CryptoReviewSwap {
  id: string;
  user_id: string;
  status: string;            // always 'needs_review'
  asset: string;             // crypto bought (to-currency)
  ngn_kobo: number;
  fee_kobo: number;
  held_kobo: number;         // ngn_kobo + fee_kobo — NGN held from the wallet
  provider: string;
  provider_swap_id?: string; // absent when the provider never returned one
  has_provider_id: boolean;  // false ⇒ provider outcome unknown; only release is safe (follow-up)
  updated_at?: string;       // when the swap was parked
  age_seconds: number;       // how long the swap has been parked
}

// POST /admin/crypto/swaps/:id/resolve body. State-dependent, enforced server-side:
//  - 'retry'   is valid only when has_provider_id (re-poll the provider).
//  - 'release' is valid only when NOT has_provider_id (reverse the hold to the user).
// There is deliberately no manual settle — see ADR-PR728.
export interface CryptoSwapResolveRequest {
  decision: 'release' | 'retry';
  note: string;
}

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

// GET/PUT /admin/crypto/fee-schedule — the swap markup in integer basis points (never money,
// never floats). version 0 is the configured default (nothing stored yet).
export interface CryptoFeeScheduleVersion {
  version: number;
  major_bps: number;
  other_bps: number;
  majors: string[];
  overrides: Record<string, number>;
  reason: string;
  created_by: string;
  created_at: string;
}

export interface CryptoFeeScheduleResponse {
  current: CryptoFeeScheduleVersion;
  ceiling_bps: number;
  history: CryptoFeeScheduleVersion[];
}

export interface CryptoFeeScheduleUpdate {
  expected_version: number;
  major_bps: number;
  other_bps: number;
  majors: string[];
  overrides: Record<string, number>;
  reason: string;
}

// GET /admin/crypto/reconciler — the swap reconciler's state. `replica` is in-process state of
// the replica that answered (only the elected leader works; resets on restart); `backlog` is read
// from the database. Counts and integer kobo only; no swap or user identifiers.
export interface CryptoReconcilerAlert {
  at: string;
  kind: string;
  message: string;
}

export interface CryptoReconcilerStatus {
  success: boolean;
  note: string;
  replica: {
    started_at: string;
    runs: number;
    led_runs: number;
    skipped_runs: number;
    last_run_at: string;
    last_led_at: string;
    last_led: boolean;
    last_error: string;
    last_result: { resolved: number; released: number; parked: number; expired: number; errors: number; clearing_negative: boolean };
    totals: { resolved: number; released: number; parked: number; expired: number; errors: number; clearing_negative_runs: number };
    recent_alerts: CryptoReconcilerAlert[];
  };
  backlog: CryptoReconcilerBacklog[];
}

export interface CryptoReconcilerBacklog {
  state: 'needs_review' | 'confirming' | 'processing' | 'quoted' | string;
  count: number;
  held_kobo: number;
  oldest_updated_at?: string;
  oldest_age_seconds: number;
}

// GET /admin/crypto/deposits — settled money-IN credits (backend/internal/crypto, table
// crypto_deposits). A row exists ONLY once a transfer cleared its confirmation floor and was
// credited exactly once, so this is a money-IN history, not an exception queue. units are integer
// asset-minor-units; render via fmtUnits(units, minor_unit_scale, symbol).
export interface CryptoDeposit {
  id: string;
  provider: string;
  provider_op_id: string;
  user_id: string;
  symbol: string;
  network: string;
  address?: string;
  units: number;
  minor_unit_scale: number;
  confirmations: number;
  required_confs: number;
  tx_hash?: string;
  created_at: string;
  credited_at: string;
}

// GET /admin/crypto/deposits/reconciler — the money-IN safety net's in-process state
// (backend/internal/cryptosvc DepositReconciler). Counts + alert text only.
export interface CryptoDepositReconcilerStatus {
  success: boolean;
  note: string;
  replica: {
    started_at: string;
    runs: number;
    led_runs: number;
    skipped_runs: number;
    last_run_at: string;
    last_led_at: string;
    last_led: boolean;
    last_error: string;
    last_result: { accounts: number; scanned: number; settled: number; duplicates: number; awaiting: number; ignored: number; truncated: boolean; errors: number };
    totals: { settled: number; duplicates: number; awaiting: number; ignored: number; errors: number };
    recent_alerts: CryptoReconcilerAlert[];
  };
}
