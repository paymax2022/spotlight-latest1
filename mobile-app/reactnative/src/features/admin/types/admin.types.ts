// Source of truth the admin screens code against. Mirrors the Go admin DTOs
// served under /api/v1/admin/* (Backend role owns the Go side).
// IRON RULES honoured here:
//  • Money is integer MINOR UNITS — fiat in kobo/cents, crypto in the asset's
//    base unit. Never floats. Carried as { amount, currency }.
//    what the role/permission payload allows (maker-checker, audit, approvals).
//  • The selected admin Role is sent on every live request as `X-Admin-Role`.

/** Integer minor-unit money object + ISO-4217 currency (e.g. { 105000, 'NGN' }). */
export interface Money {
  amount: number;
  currency: string; // 'NGN' | 'USD' | a crypto symbol for in-asset amounts
}

/** Admin role taxonomy — mirrors the backend RBAC roles. */
export type Role =
  | 'SuperAdmin'
  | 'ComplianceAdmin'
  | 'TradingOpsAdmin'
  | 'ProductAdmin'
  | 'FinanceAdmin'
  | 'SupportAdmin'
  | 'RiskAdmin'
  | 'ContentAdmin';

/** Permission keys gating privileged actions (mirror the backend policy). */
export type Permission =
  | 'kyc.review'
  | 'asset.config'
  | 'withdrawal.approve'
  | 'order.view'
  | 'risk.config'
  | 'fee.config'
  | 'flag.toggle'
  | 'approval.act'
  | 'recon.view'
  | 'provider.view'
  | 'audit.view'
  | 'admin.manage'
  | 'user.view';

/** A single liquidity/custody/payment provider's roll-up on the dashboard. */
export interface ProviderSummary {
  name: string;
  kind: string; // 'liquidity' | 'custody' | 'payments' | …
  status: ProviderStatus;
  latencyMs: number;
}

/** Top-of-console operational snapshot. Money fields are minor units. */
export interface Dashboard {
  users: number; // total users
  openKyc: number; // KYC cases awaiting review
  pendingWithdrawals: number; // withdrawals awaiting approval
  failedOrders: number; // orders in a failed state (24h)
  reconExceptions: number; // open reconciliation exceptions
  revenueToday: Money;
  revenueMonth: Money;
  tradingVolume: Money; // settled trading volume (period)
  providerSummary: ProviderSummary[];
}

export type UserStatus = 'active' | 'suspended' | 'closed' | 'pending';

/** Row in the users table. */
export interface UserSummary {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  kycTier: number;
  createdAt: string;
}

/** Full user record (drill-down). */
export interface UserDetail extends UserSummary {
  phone: string;
  country: string;
  kycStatus: KycStatus;
  walletBalance: Money;
  lifetimeVolume: Money;
  lastActiveAt: string;
  flags: string[]; // risk/ops flags on the account
}

export type KycStatus = 'pending' | 'approved' | 'rejected' | 'escalated';
export type KycDecision = 'approve' | 'reject' | 'escalate';

export interface KycCase {
  id: string;
  userId: string;
  name: string;
  status: KycStatus;
  tier: number; // KYC tier being requested
  submittedAt: string;
  riskFlags: string[]; // e.g. ['pep', 'address_mismatch']
}

export type AssetKind = 'crypto' | 'stock';
export type AssetControlStatus = 'active' | 'paused' | 'delisted';

/** Admin-set trading controls for one tradable asset. */
export interface AssetControl {
  id: string;
  symbol: string;
  kind: AssetKind;
  buyEnabled: boolean;
  sellEnabled: boolean;
  withdrawalEnabled: boolean;
  status: AssetControlStatus;
  feeBps: number; // trading fee in basis points
  minOrder: Money; // minimum order size (settlement minor units)
  maxOrder: Money; // maximum order size
}

/** Partial patch the asset-config screen sends to PATCH /admin/assets/{id}. */
export interface AssetControlPatch {
  buyEnabled?: boolean;
  sellEnabled?: boolean;
  withdrawalEnabled?: boolean;
  status?: AssetControlStatus;
  feeBps?: number;
  minOrder?: Money;
  maxOrder?: Money;
}

export type AdminOrderStatus =
  | 'Filled'
  | 'PartiallyFilled'
  | 'Processing'
  | 'Pending'
  | 'Failed'
  | 'Reversed'
  | 'ComplianceHold';

export type OrderSide = 'buy' | 'sell';

export interface AdminOrder {
  ref: string; // user-facing reference, e.g. 'PMX-CR-123456'
  user: string; // user display name / id
  kind: AssetKind;
  side: OrderSide;
  symbol: string;
  status: AdminOrderStatus;
  amount: Money;
  createdAt: string;
  providerRef: string; // every order traceable to a provider ref
}

/** Filter passed to GET /admin/orders?filter= */
export type OrderFilter = 'all' | 'failed' | 'pending' | 'crypto' | 'stock';

export type WithdrawalReviewStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'escalated';

export type WithdrawalDecision = 'approve' | 'reject' | 'escalate';

export interface WithdrawalReviewItem {
  reference: string;
  user: string;
  symbol: string;
  amount: Money; // in-asset minor units (currency holds the symbol)
  address: string; // destination address (masked in list, full on detail)
  network: string;
  riskScore: number; // 0–100 pre-broadcast risk score
  status: WithdrawalReviewStatus;
  createdAt: string;
}

export interface ReconException {
  id: string;
  asset: string;
  kind: string; // 'missing_ledger' | 'amount_mismatch' | …
  internal: Money;
  external: Money;
  delta: Money;
  detectedAt: string;
}

/** Loose shape: backend may add per-asset roll-ups; exceptions[] is the core. */
export interface ReconReport {
  asset?: string;
  generatedAt?: string;
  exceptions: ReconException[];
  [key: string]: unknown; // keep flexible for backend additions
}

export type ProviderStatus = 'healthy' | 'degraded' | 'down';

export interface ProviderHealth {
  name: string;
  kind: string; // 'liquidity' | 'custody' | 'payments' | 'market-data'
  status: ProviderStatus;
  latencyMs: number;
  lastCheck: string;
}

export interface RiskLimit {
  id: string;
  label: string;
  scope: string; // 'per_user_daily' | 'per_txn' | 'global_24h' | …
  valueMinor: number; // limit value, minor units
  currency: string;
}

export interface FeeConfigItem {
  id: string;
  label: string;
  kind: string; // 'crypto_trade' | 'stock_trade' | 'withdrawal' | …
  bps: number; // fee in basis points
}

export interface FeatureFlag {
  key: string;
  label: string;
  enabled: boolean;
}

export interface AuditEntry {
  id: string;
  actor: string; // admin who performed the action
  action: string; // 'kyc.approve' | 'asset.update' | …
  entityType: string; // 'kyc_case' | 'asset' | 'withdrawal' | …
  entityId: string;
  reason: string;
  at: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Approval {
  id: string;
  type: string; // 'asset.update' | 'risk.update' | 'fee.update' | …
  summary: string; // human-readable description of the change
  requestedBy: string;
  status: ApprovalStatus;
  createdAt: string;
  maker: string; // who proposed the change
  checker?: string; // who approved/rejected (set once acted on)
}

export type AdminUserStatus = 'active' | 'suspended';

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: AdminUserStatus;
}

export interface AdminApiError {
  type: string;
  code: string;
  message: string;
}
