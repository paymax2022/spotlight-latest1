// ── Admin — Paymax Savings (Goal Vaults + Ajo/Esusu) ops console types ───────
// Field names mirror the Go JSON (snake_case) from /api/savings/admin/*.
// Money is BIGINT kobo (minor units) throughout.
// Invariants surfaced in the UI: NL-2 (no yield — savings/pools earn zero),
// NL-7 (Ajo is peer rotation; Paymax is ledger/escrow only, never a lender),
// NL-8 (money is a ledger; balances are projections), NL-12 (immutable audit).

export type VaultLockType = 'LOCKED' | 'FLEX';
export type VaultStatus = 'open' | 'locked' | 'flex' | 'matured' | 'closed';
export type CircleStatus = 'forming' | 'active' | 'completed' | 'closed';
export type MemberStatus = 'invited' | 'active' | 'defaulted' | 'exited';
export type DefaultStatus = 'open' | 'grace' | 'make_good' | 'recovered' | 'defaulted' | 'dismissed';
export type ReconStatus = 'balanced' | 'flagged' | 'reconciled';

// ── Dashboard ────────────────────────────────────────────────────────────────
export interface SavingsDashboardActivity {
  id: string;
  kind: string; // vault_matured | force_unlock | ajo_payout | member_defaulted | recon_break | auto_save_run …
  label: string;
  ref?: string | null;
  created_at: string;
}
export interface SavingsDashboard {
  // float liability — total customer money held across all savings products (NL-8)
  total_float_liability_kobo: number;
  ledger_balance_kobo: number;       // sum of ledger projections
  unreconciled_delta_kobo: number;   // ledger vs custody float (should trend to 0)
  // vaults
  vaults_total: number;
  vaults_locked: number;
  vaults_flex: number;
  vault_balance_kobo: number;
  // circles
  circles_total: number;
  circles_active: number;
  circle_collections_30d_kobo: number;
  payout_queue_count: number;
  payout_queue_value_kobo: number;
  // group targets
  targets_total: number;
  target_balance_kobo: number;
  // risk
  defaults_open: number;
  default_exposure_kobo: number;
  force_unlocks_30d: number;
  auto_save_runs_today: number;
  auto_save_failures_today: number;
  product_mix: { product: 'vault' | 'circle' | 'target'; count: number; balance_kobo: number; share_pct: number }[];
  float_trend: { date: string; float_kobo: number }[];
  activity: SavingsDashboardActivity[];
}

// ── Vaults ───────────────────────────────────────────────────────────────────
export interface VaultRecord {
  id: string;
  owner_masked: string;
  name: string;
  lock_type: VaultLockType;
  status: VaultStatus;
  balance_kobo: number;
  target_kobo: number | null;
  yield_kobo: 0;                 // NL-2 — always zero, never accrues
  auto_save_enabled: boolean;
  auto_save_amount_kobo: number;
  auto_save_frequency: 'daily' | 'weekly' | 'monthly' | null;
  locked_until: string | null;
  early_break_requested: boolean;
  created_at: string;
  matured_at: string | null;
}

// ── Float reconciliation ─────────────────────────────────────────────────────
export interface FloatReconLine {
  id: string;
  product: 'vault' | 'circle' | 'target';
  ledger_balance_kobo: number;   // projection of double-entry ledger
  custody_balance_kobo: number;  // bank/VA custody float
  delta_kobo: number;            // custody − ledger (0 == balanced)
  status: ReconStatus;
  as_of: string;
}
export interface FloatRecon {
  generated_at: string;
  total_ledger_kobo: number;
  total_custody_kobo: number;
  total_delta_kobo: number;
  lines: FloatReconLine[];
}

// ── Ajo / Esusu circles ──────────────────────────────────────────────────────
export interface AjoCircleSummary {
  id: string;
  name: string;
  status: CircleStatus;
  contribution_kobo: number;       // per-member per-cycle
  frequency: 'weekly' | 'monthly';
  members_count: number;
  cycle_index: number;             // current cycle 1..total
  total_cycles: number;
  collected_this_cycle_kobo: number;
  expected_this_cycle_kobo: number;
  health: 'healthy' | 'at_risk' | 'defaulted';
  defaults_count: number;
  next_payout_member_masked: string | null;
  next_payout_kobo: number;
  next_payout_date: string | null;
  created_at: string;
}
export interface AjoMember {
  id: string;
  masked_name: string;
  status: MemberStatus;
  payout_position: number;
  paid_cycles: number;
  missed_cycles: number;
  has_received_payout: boolean;
  contributed_kobo: number;
  joined_at: string;
}
export interface AjoCycle {
  cycle_index: number;
  beneficiary_masked: string;
  payout_kobo: number;
  status: 'completed' | 'collecting' | 'scheduled';
  collected_kobo: number;
  expected_kobo: number;
  payout_date: string | null;
}
export interface AjoCircleDetail extends AjoCircleSummary {
  payout_order_locked: boolean;    // NL-7 — rotation is peer-defined, immutable once active
  escrow_held_kobo: number;        // funds held by Paymax escrow only (no lending)
  members: AjoMember[];
  cycles: AjoCycle[];
}

// ── Defaults queue ───────────────────────────────────────────────────────────
export interface DefaultRecord {
  id: string;
  circle_id: string;
  circle_name: string;
  member_masked: string;
  cycle_index: number;
  amount_due_kobo: number;
  days_overdue: number;
  status: DefaultStatus;
  policy: 'grace' | 'make_good' | 'remove'; // configured default policy
  created_at: string;
}
export type DefaultAction = 'grace' | 'make_good' | 'remove' | 'recover' | 'dismiss';
export interface DefaultActionResult {
  id: string;
  status: DefaultStatus;
  audit_id: string;     // immutable audit entry id (NL-12)
  message: string;
}

export interface ForceUnlockResult {
  vault_id: string;
  status: VaultStatus;
  audit_id: string;     // immutable audit entry id (NL-12)
  message: string;
}
