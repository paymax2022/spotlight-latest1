// ── Admin — FX Orchestration types ───────────────────────────────────────────
// Control-plane contract for the Paymax FX console (spec §13). All money is
// integer minor units (kobo/cents). Mirrors the normalized API entities (§11).

export type Provider = 'eversend' | 'maplerad';
export type BreakerState = 'closed' | 'open' | 'half_open';

// ─── A. Overview dashboard ────────────────────────────────────────────────────

export interface ProviderMixRow {
  provider: Provider;
  share: number;          // 0-100 (% of routed volume)
  volumeUsdCents: number;
}

export interface CorridorVolumeRow {
  corridor: string;       // 'USD-NGN'
  volumeUsdCents: number;
  marginUsdCents: number;
  successRate: number;    // 0-100
}

export interface FxOverview {
  gmvUsdCents: number;            // 24h gross money moved (USD-equiv)
  marginUsdCents: number;         // spread captured (USD-equiv)
  txCount24h: number;
  successRate: number;            // 0-100
  failureRate: number;            // 0-100
  reconBreaks: number;
  openIncidents: number;
  floatHealthPct: number;         // 0-100 aggregate
  providerMix: ProviderMixRow[];
  topCorridors: CorridorVolumeRow[];
  breakers: { provider: Provider; state: BreakerState }[];
}

// ─── B. Transactions explorer ─────────────────────────────────────────────────

export type FxTxType = 'conversion' | 'transfer' | 'collection';
export type FxTxStatus = 'pending' | 'processing' | 'successful' | 'failed' | 'reversed';

export interface FxMoney { amountMinor: number; currency: string }

export interface FxFee { type: 'provider_fee' | 'rail_fee' | 'paymax_spread'; amount: FxMoney }

export interface FxStatusEvent { status: string; at: string }

export interface FxTxSummary {
  id: string;
  reference: string;
  type: FxTxType;
  status: FxTxStatus;
  customer: string;
  provider: Provider;
  corridor: string;
  source: FxMoney;
  destination: FxMoney;
  createdAt: string;
}

export interface FxScoreSnapshot {
  provider: Provider;
  chosen: boolean;
  score: number;
  cost: number;
  coverage: number;
  liquidity: number;
  reliability: number;
}

export interface FxTxDetail extends FxTxSummary {
  rail: string;
  quotedRate: number | null;
  executedRate: number | null;
  fees: FxFee[];
  providerRef: string | null;
  customerEmail: string;
  narration: string | null;
  statusHistory: FxStatusEvent[];
  scoring: FxScoreSnapshot[];
  failureReason?: string;
}

export interface FxTxFilter {
  type?: FxTxType;
  status?: FxTxStatus;
  provider?: Provider;
  corridor?: string;
  search?: string;
}

// ─── C. Routing configuration ─────────────────────────────────────────────────

export interface RoutingWeights {
  corridor: string;
  tier: string;          // customer tier label
  wCost: number;         // 0-1
  wCover: number;
  wLiq: number;
  wRel: number;
  enabled: Record<Provider, boolean>;
  bias: Provider | 'auto';
}

export interface RouteSimResult {
  corridor: string;
  amountUsdCents: number;
  ranked: { provider: Provider; allInRate: number; score: number; viable: boolean; note?: string }[];
}

// ─── D. Provider management ───────────────────────────────────────────────────

export interface ProviderConfig {
  provider: Provider;
  displayName: string;
  enabled: boolean;
  corridors: string[];
  rails: string[];
  exposureLimitUsdCents: number;
  exposureUsedUsdCents: number;
  latencyMsP95: number;
  successRate: number;            // 0-100
  breaker: BreakerState;
  adapterStatus: 'live' | 'sandbox' | 'down';
}

// ─── E. Treasury & liquidity ──────────────────────────────────────────────────

export interface FloatBucket {
  provider: Provider;
  currency: string;
  balanceMinor: number;
  lowWaterMinor: number;
  highWaterMinor: number;
  status: 'healthy' | 'low' | 'critical' | 'excess';
}

export interface RebalanceEvent {
  id: string;
  from: Provider;
  to: Provider;
  currency: string;
  amountMinor: number;
  path: 'fiat' | 'stablecoin';
  status: 'completed' | 'pending' | 'failed';
  createdAt: string;
}

// ─── F. Spread & pricing ──────────────────────────────────────────────────────

export interface SpreadRule {
  id: string;
  corridor: string;
  tier: string;
  bps: number;             // markup basis points
  fixedMinor: number;      // fixed fee component
  minBps: number;
  maxBps: number;
  version: number;
  updatedAt: string;
  active: boolean;
}

// ─── I. Reconciliation ────────────────────────────────────────────────────────

export type ReconBreakType = 'amount' | 'rate' | 'fee' | 'timing' | 'missing';
export type ReconBreakStatus = 'open' | 'investigating' | 'resolved' | 'escalated';

export interface ReconRun {
  id: string;
  provider: Provider;
  date: string;
  matched: number;
  breaks: number;
  status: 'clean' | 'breaks' | 'running';
}

export interface ReconBreak {
  id: string;
  runId: string;
  provider: Provider;
  reference: string;
  type: ReconBreakType;
  expectedMinor: number;
  actualMinor: number;
  currency: string;
  status: ReconBreakStatus;
  createdAt: string;
}

// ─── G. Customers (KYC/KYB) ───────────────────────────────────────────────────

export type CustomerType = 'individual' | 'business';
export type CustomerVerification = 'unverified' | 'pending' | 'review' | 'approved' | 'rejected' | 'suspended';

export interface AdminCustomer {
  id: string;
  name: string;
  email: string;
  type: CustomerType;
  verification: CustomerVerification;
  tier: number;
  country: string;
  balanceUsdCents: number;
  createdAt: string;
}

export interface KybDoc { id: string; label: string; type: 'pdf' | 'image'; verified: boolean }

export interface CustomerDetail extends AdminCustomer {
  rcNumber?: string;
  directors?: { name: string; role: string; ownershipPct: string }[];
  documents: KybDoc[];
  riskScore: number;          // 0-100
  notes: string | null;
}

// ─── H. Compliance & Risk ─────────────────────────────────────────────────────

export type ScreeningKind = 'sanctions' | 'pep' | 'aml_rule' | 'velocity';
export type CaseStatus = 'open' | 'in_review' | 'cleared' | 'blocked' | 'sar_filed';

export interface ScreeningAlert {
  id: string;
  customer: string;
  kind: ScreeningKind;
  reference: string | null;
  detail: string;
  severity: 'low' | 'medium' | 'high';
  status: CaseStatus;
  createdAt: string;
}

// ─── L. Webhooks & Developer ──────────────────────────────────────────────────

export type WebhookDeliveryStatus = 'delivered' | 'retrying' | 'failed';

export interface WebhookEndpoint {
  id: string;
  customer: string;
  url: string;
  events: string[];
  enabled: boolean;
  sandbox: boolean;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  event: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseCode: number | null;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  customer: string;
  label: string;
  prefix: string;            // 'sk_live_8x…'
  mode: 'live' | 'sandbox';
  lastUsed: string | null;
  createdAt: string;
}

// ─── M. Analytics & Reports ───────────────────────────────────────────────────

export interface MarginByCorridor {
  corridor: string;
  volumeUsdCents: number;
  marginUsdCents: number;
  marginBps: number;
}

export interface ProviderReliability {
  provider: Provider;
  successRate: number;
  avgLatencyMs: number;
  failovers: number;
  uptime: number;            // 0-100
}

export interface RoutingEfficiency {
  corridor: string;
  chosenVsBestBps: number;   // avg bps gap chosen vs best-possible (lower = better)
  optimalPct: number;        // % of routes that picked best-possible
}

export interface FxAnalytics {
  marginByCorridor: MarginByCorridor[];
  providerReliability: ProviderReliability[];
  routingEfficiency: RoutingEfficiency[];
  retentionCohorts: { cohort: string; m1: number; m2: number; m3: number }[];
}

// ─── J. Beneficiaries & Collections ───────────────────────────────────────────

export interface VirtualAccountReg {
  id: string;
  customer: string;
  currency: string;
  type: 'virtual_account' | 'iban';
  identifier: string;        // account number or IBAN
  provider: Provider;
  status: 'active' | 'closed';
  createdAt: string;
}

export interface AdminCollectionEvent {
  id: string;
  customer: string;
  amountMinor: number;
  currency: string;
  sender: string | null;
  reference: string | null;
  createdAt: string;
}

export interface BeneficiaryValidationIssue {
  id: string;
  corridor: string;
  beneficiary: string;
  rail: string;
  reason: string;
  count: number;
}

// ─── K. Cards ─────────────────────────────────────────────────────────────────

export type IssuedCardStatus = 'active' | 'frozen' | 'terminated';

export interface IssuedCard {
  id: string;
  customer: string;
  brand: 'visa' | 'mastercard' | 'verve';
  currency: string;
  last4: string;
  status: IssuedCardStatus;
  provider: Provider;
  balanceMinor: number;
  spentMinor: number;
  createdAt: string;
}

export interface SuspiciousCardActivity {
  id: string;
  cardId: string;
  customer: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
  createdAt: string;
}

// ─── N. Settings: catalogues + feature flags ──────────────────────────────────

export interface CorridorConfig {
  corridor: string;
  enabled: boolean;
  defaultProvider: Provider | 'auto';
}

export interface CurrencyConfig {
  code: string;
  name: string;
  kind: 'fiat' | 'stablecoin';
  enabled: boolean;
}

export interface RailConfig {
  rail: string;
  label: string;
  enabled: boolean;
}

export interface FeatureFlag {
  key: string;
  label: string;
  enabled: boolean;
}

export interface FxSettingsCatalogue {
  corridors: CorridorConfig[];
  currencies: CurrencyConfig[];
  rails: RailConfig[];
  flags: FeatureFlag[];
}
