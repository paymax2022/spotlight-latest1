// ── Paymax · Admin Console — Mock seed data ──────────────────────────────────
// Rich, deterministic seed data the mock API returns so every admin screen
// renders real-looking content with EXPO_PUBLIC_ADMIN_USE_MOCK=true (default).
// All money is integer minor units.

import type {
  AdminOrder,
  AdminUser,
  Approval,
  AssetControl,
  AuditEntry,
  Dashboard,
  FeatureFlag,
  FeeConfigItem,
  KycCase,
  ProviderHealth,
  ReconReport,
  RiskLimit,
  UserDetail,
  UserSummary,
  WithdrawalReviewItem,
} from '../types/admin.types';

const ngn = (major: number) => Math.round(major * 100);
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

// ─── Dashboard ──────────────────────────────────────────────────────────────--

export const MOCK_DASHBOARD: Dashboard = {
  users: 184_206,
  openKyc: 37,
  pendingWithdrawals: 12,
  failedOrders: 5,
  reconExceptions: 3,
  revenueToday: { amount: ngn(2_480_500), currency: 'NGN' },
  revenueMonth: { amount: ngn(61_905_000), currency: 'NGN' },
  tradingVolume: { amount: ngn(1_204_800_000), currency: 'NGN' },
  providerSummary: [
    { name: 'FireBlocks', kind: 'custody', status: 'healthy', latencyMs: 142 },
    { name: 'B2C2', kind: 'liquidity', status: 'healthy', latencyMs: 88 },
    { name: 'Paystack', kind: 'payments', status: 'degraded', latencyMs: 410 },
    { name: 'Alpaca', kind: 'liquidity', status: 'healthy', latencyMs: 121 },
  ],
};

// ─── Users ──────────────────────────────────────────────────────────────────--

export const MOCK_USERS: UserSummary[] = [
  { id: 'usr_1001', name: 'Adaeze Okafor',   email: 'adaeze@example.com',  status: 'active',    kycTier: 2, createdAt: daysAgo(120) },
  { id: 'usr_1002', name: 'Tunde Bakare',    email: 'tunde@example.com',   status: 'active',    kycTier: 3, createdAt: daysAgo(96) },
  { id: 'usr_1003', name: 'Ngozi Eze',       email: 'ngozi@example.com',   status: 'suspended', kycTier: 1, createdAt: daysAgo(54) },
  { id: 'usr_1004', name: 'Femi Adeyemi',    email: 'femi@example.com',    status: 'pending',   kycTier: 0, createdAt: daysAgo(3) },
  { id: 'usr_1005', name: 'Chidinma Nwosu',  email: 'chidinma@example.com', status: 'active',   kycTier: 2, createdAt: daysAgo(210) },
  { id: 'usr_1006', name: 'Yusuf Ibrahim',   email: 'yusuf@example.com',   status: 'closed',    kycTier: 1, createdAt: daysAgo(330) },
];

export const MOCK_USER_DETAILS: Record<string, UserDetail> = {
  usr_1001: {
    ...MOCK_USERS[0],
    phone: '+234 803 555 0101', country: 'Nigeria', kycStatus: 'approved',
    walletBalance: { amount: ngn(842_500), currency: 'NGN' },
    lifetimeVolume: { amount: ngn(12_400_000), currency: 'NGN' },
    lastActiveAt: ago(35), flags: [],
  },
  usr_1003: {
    ...MOCK_USERS[2],
    phone: '+234 701 555 0103', country: 'Nigeria', kycStatus: 'escalated',
    walletBalance: { amount: ngn(15_200), currency: 'NGN' },
    lifetimeVolume: { amount: ngn(680_000), currency: 'NGN' },
    lastActiveAt: daysAgo(6), flags: ['velocity_alert', 'manual_review'],
  },
};

// ─── KYC queue ────────────────────────────────────────────────────────────────

export const MOCK_KYC: KycCase[] = [
  { id: 'kyc_5001', userId: 'usr_1004', name: 'Femi Adeyemi',   status: 'pending',   tier: 2, submittedAt: ago(40),  riskFlags: ['new_account'] },
  { id: 'kyc_5002', userId: 'usr_1003', name: 'Ngozi Eze',      status: 'escalated', tier: 2, submittedAt: ago(180), riskFlags: ['pep', 'address_mismatch'] },
  { id: 'kyc_5003', userId: 'usr_1007', name: 'Bola Akintola',  status: 'pending',   tier: 3, submittedAt: ago(310), riskFlags: [] },
  { id: 'kyc_5004', userId: 'usr_1008', name: 'Ibrahim Sani',   status: 'pending',   tier: 1, submittedAt: ago(620), riskFlags: ['document_blurry'] },
];

// ─── Asset controls ─────────────────────────────────────────────────────────--

export const MOCK_ASSET_CONTROLS: AssetControl[] = [
  { id: 'ac_btc',  symbol: 'BTC',  kind: 'crypto', buyEnabled: true,  sellEnabled: true,  withdrawalEnabled: true,  status: 'active', feeBps: 90,  minOrder: { amount: ngn(1_000), currency: 'NGN' }, maxOrder: { amount: ngn(5_000_000), currency: 'NGN' } },
  { id: 'ac_eth',  symbol: 'ETH',  kind: 'crypto', buyEnabled: true,  sellEnabled: true,  withdrawalEnabled: false, status: 'active', feeBps: 90,  minOrder: { amount: ngn(1_000), currency: 'NGN' }, maxOrder: { amount: ngn(5_000_000), currency: 'NGN' } },
  { id: 'ac_usdt', symbol: 'USDT', kind: 'crypto', buyEnabled: true,  sellEnabled: true,  withdrawalEnabled: true,  status: 'active', feeBps: 50,  minOrder: { amount: ngn(500),   currency: 'NGN' }, maxOrder: { amount: ngn(10_000_000), currency: 'NGN' } },
  { id: 'ac_sol',  symbol: 'SOL',  kind: 'crypto', buyEnabled: true,  sellEnabled: false, withdrawalEnabled: false, status: 'paused', feeBps: 140, minOrder: { amount: ngn(1_000), currency: 'NGN' }, maxOrder: { amount: ngn(2_000_000), currency: 'NGN' } },
  { id: 'ac_aapl', symbol: 'AAPL', kind: 'stock',  buyEnabled: true,  sellEnabled: true,  withdrawalEnabled: false, status: 'active', feeBps: 25,  minOrder: { amount: ngn(2_000), currency: 'NGN' }, maxOrder: { amount: ngn(8_000_000), currency: 'NGN' } },
  { id: 'ac_tsla', symbol: 'TSLA', kind: 'stock',  buyEnabled: true,  sellEnabled: true,  withdrawalEnabled: false, status: 'active', feeBps: 25,  minOrder: { amount: ngn(2_000), currency: 'NGN' }, maxOrder: { amount: ngn(8_000_000), currency: 'NGN' } },
];

// ─── Orders ───────────────────────────────────────────────────────────────────

export const MOCK_ORDERS: AdminOrder[] = [
  { ref: 'PMX-CR-100231', user: 'Adaeze Okafor',  kind: 'crypto', side: 'buy',  symbol: 'BTC',  status: 'Filled',         amount: { amount: ngn(120_000), currency: 'NGN' }, createdAt: ago(12),  providerRef: 'B2C2-AX91' },
  { ref: 'PMX-CR-100232', user: 'Tunde Bakare',   kind: 'crypto', side: 'sell', symbol: 'ETH',  status: 'Processing',     amount: { amount: ngn(54_000),  currency: 'NGN' }, createdAt: ago(8),   providerRef: 'B2C2-AX92' },
  { ref: 'PMX-ST-100233', user: 'Chidinma Nwosu', kind: 'stock',  side: 'buy',  symbol: 'AAPL', status: 'Filled',         amount: { amount: ngn(310_000), currency: 'NGN' }, createdAt: ago(40),  providerRef: 'ALP-7741' },
  { ref: 'PMX-CR-100234', user: 'Ngozi Eze',      kind: 'crypto', side: 'buy',  symbol: 'SOL',  status: 'Failed',         amount: { amount: ngn(20_000),  currency: 'NGN' }, createdAt: ago(95),  providerRef: 'B2C2-AX93' },
  { ref: 'PMX-CR-100235', user: 'Yusuf Ibrahim',  kind: 'crypto', side: 'sell', symbol: 'USDT', status: 'ComplianceHold', amount: { amount: ngn(880_000), currency: 'NGN' }, createdAt: ago(140), providerRef: 'B2C2-AX94' },
  { ref: 'PMX-ST-100236', user: 'Femi Adeyemi',   kind: 'stock',  side: 'buy',  symbol: 'TSLA', status: 'Pending',        amount: { amount: ngn(45_000),  currency: 'NGN' }, createdAt: ago(5),   providerRef: 'ALP-7742' },
];

// ─── Withdrawal review queue ──────────────────────────────────────────────────

export const MOCK_WITHDRAWALS: WithdrawalReviewItem[] = [
  { reference: 'PMX-WD-200441', user: 'Adaeze Okafor',  symbol: 'BTC',  amount: { amount: 1_250_000, currency: 'BTC' },  address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', network: 'Bitcoin',      riskScore: 18, status: 'pending',   createdAt: ago(22) },
  { reference: 'PMX-WD-200442', user: 'Ngozi Eze',      symbol: 'USDT', amount: { amount: 500_000_000, currency: 'USDT' }, address: 'TJ8s3sB1kY7Yb9aQ2cZx4pN6mWvL1rGq5d',          network: 'Tron (TRC-20)', riskScore: 76, status: 'escalated', createdAt: ago(110) },
  { reference: 'PMX-WD-200443', user: 'Tunde Bakare',   symbol: 'ETH',  amount: { amount: 850_000_000_000_000_000, currency: 'ETH' }, address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', network: 'Ethereum',  riskScore: 42, status: 'pending',   createdAt: ago(58) },
];

// ─── Reconciliation ───────────────────────────────────────────────────────────

export const MOCK_RECON: ReconReport = {
  generatedAt: ago(15),
  exceptions: [
    { id: 'rx_1', asset: 'BTC',  kind: 'amount_mismatch', internal: { amount: 1_250_000, currency: 'BTC' }, external: { amount: 1_249_500, currency: 'BTC' }, delta: { amount: 500, currency: 'BTC' }, detectedAt: ago(30) },
    { id: 'rx_2', asset: 'USDT', kind: 'missing_ledger',  internal: { amount: 0, currency: 'USDT' },         external: { amount: 100_000_000, currency: 'USDT' }, delta: { amount: 100_000_000, currency: 'USDT' }, detectedAt: ago(90) },
    { id: 'rx_3', asset: 'NGN',  kind: 'amount_mismatch', internal: { amount: ngn(5_000_000), currency: 'NGN' }, external: { amount: ngn(4_998_500), currency: 'NGN' }, delta: { amount: ngn(1_500), currency: 'NGN' }, detectedAt: ago(220) },
  ],
};

// ─── Providers ─────────────────────────────────────────────────────────────────

export const MOCK_PROVIDERS: ProviderHealth[] = [
  { name: 'FireBlocks', kind: 'custody',     status: 'healthy',  latencyMs: 142, lastCheck: ago(1) },
  { name: 'B2C2',       kind: 'liquidity',   status: 'healthy',  latencyMs: 88,  lastCheck: ago(1) },
  { name: 'Paystack',   kind: 'payments',    status: 'degraded', latencyMs: 410, lastCheck: ago(2) },
  { name: 'Alpaca',     kind: 'liquidity',   status: 'healthy',  latencyMs: 121, lastCheck: ago(1) },
  { name: 'Chainalysis', kind: 'market-data', status: 'down',    latencyMs: 0,   lastCheck: ago(6) },
];

// ─── Risk limits ───────────────────────────────────────────────────────────────

export const MOCK_RISK_LIMITS: RiskLimit[] = [
  { id: 'rl_1', label: 'Per-user daily withdrawal', scope: 'per_user_daily', valueMinor: ngn(5_000_000),  currency: 'NGN' },
  { id: 'rl_2', label: 'Single transaction cap',    scope: 'per_txn',        valueMinor: ngn(2_000_000),  currency: 'NGN' },
  { id: 'rl_3', label: 'Global 24h crypto outflow',  scope: 'global_24h',     valueMinor: ngn(250_000_000), currency: 'NGN' },
  { id: 'rl_4', label: 'Manual review threshold',   scope: 'per_txn',        valueMinor: ngn(500_000),    currency: 'NGN' },
];

// ─── Fees ───────────────────────────────────────────────────────────────────--

export const MOCK_FEES: FeeConfigItem[] = [
  { id: 'fee_1', label: 'Crypto trade fee',  kind: 'crypto_trade', bps: 90 },
  { id: 'fee_2', label: 'Stock trade fee',   kind: 'stock_trade',  bps: 25 },
  { id: 'fee_3', label: 'Crypto withdrawal', kind: 'withdrawal',   bps: 50 },
  { id: 'fee_4', label: 'Swap fee',          kind: 'swap',         bps: 30 },
];

// ─── Feature flags ───────────────────────────────────────────────────────────-

export const MOCK_FLAGS: FeatureFlag[] = [
  { key: 'invest_crypto',     label: 'Crypto trading',     enabled: true },
  { key: 'invest_stocks',     label: 'Stock trading',      enabled: true },
  { key: 'crypto_withdrawals', label: 'Crypto withdrawals', enabled: true },
  { key: 'crypto_swap',       label: 'Crypto swap',        enabled: false },
  { key: 'referrals',         label: 'Referral programme', enabled: true },
];

// ─── Approvals (maker-checker) ─────────────────────────────────────────────────

export const MOCK_APPROVALS: Approval[] = [
  { id: 'ap_1', type: 'asset.update', summary: 'Pause SOL trading (sell + withdrawal)',           requestedBy: 'Trading Ops', status: 'pending', createdAt: ago(25),  maker: 'tunde.ops@paymax.co' },
  { id: 'ap_2', type: 'risk.update',  summary: 'Raise per-user daily limit to ₦7.5M',             requestedBy: 'Risk',        status: 'pending', createdAt: ago(70),  maker: 'risk.lead@paymax.co' },
  { id: 'ap_3', type: 'fee.update',   summary: 'Reduce crypto trade fee 0.90% → 0.75%',           requestedBy: 'Finance',     status: 'pending', createdAt: ago(160), maker: 'fin.ops@paymax.co' },
];

// ─── Audit log ─────────────────────────────────────────────────────────────────

export const MOCK_AUDIT: AuditEntry[] = [
  { id: 'au_1', actor: 'compliance.lead@paymax.co', action: 'kyc.approve',     entityType: 'kyc_case',   entityId: 'kyc_4990', reason: 'Documents verified', at: ago(18) },
  { id: 'au_2', actor: 'trading.ops@paymax.co',     action: 'asset.update',    entityType: 'asset',      entityId: 'ac_sol',   reason: 'Liquidity provider outage', at: ago(46) },
  { id: 'au_3', actor: 'risk.lead@paymax.co',       action: 'withdrawal.reject', entityType: 'withdrawal', entityId: 'PMX-WD-200399', reason: 'Sanctions screening hit', at: ago(130) },
  { id: 'au_4', actor: 'super.admin@paymax.co',     action: 'admin.create',    entityType: 'admin_user', entityId: 'adm_12',   reason: 'New compliance analyst onboarded', at: daysAgo(2) },
];

// ─── Admin directory ─────────────────────────────────────────────────────────-

export const MOCK_ADMINS: AdminUser[] = [
  { id: 'adm_1',  name: 'Sade Coker',       email: 'super.admin@paymax.co',    role: 'SuperAdmin',      status: 'active' },
  { id: 'adm_2',  name: 'Emeka Obi',        email: 'compliance.lead@paymax.co', role: 'ComplianceAdmin', status: 'active' },
  { id: 'adm_3',  name: 'Tunde Ogun',       email: 'trading.ops@paymax.co',    role: 'TradingOpsAdmin', status: 'active' },
  { id: 'adm_4',  name: 'Aisha Bello',      email: 'risk.lead@paymax.co',      role: 'RiskAdmin',       status: 'active' },
  { id: 'adm_5',  name: 'Kunle Martins',    email: 'fin.ops@paymax.co',        role: 'FinanceAdmin',    status: 'suspended' },
];
