// ── FX Exchange — Type Contract ──────────────────────────────────────────────
// Source of truth the screens code against (Backend role owns this file).
// Mirrors the Paymax normalized API (spec §5, §11; Appendix B status machines).
//
// IRON RULE: all monetary amounts are integers in MINOR UNITS (kobo/cents).
// Never floats, never strings for math. A `Money` is always { amount, currency }.

// ─── Money primitive ──────────────────────────────────────────────────────────

/** ISO-4217 currency codes the app supports at V1. */
export type CurrencyCode =
  | 'NGN'
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'GHS'
  | 'KES'
  | 'XAF'
  | 'ZAR'
  | 'USDC'
  | 'USDT';

/** Canonical money object — integer minor units + ISO-4217 currency. */
export interface Money {
  amount: number;     // integer, minor units (e.g. 105000 = NGN 1,050.00)
  currency: CurrencyCode;
}

export interface CurrencyMeta {
  code: CurrencyCode;
  name: string;
  symbol: string;
  flag: string;          // emoji flag (or "₿"-style glyph for stablecoins)
  decimals: number;      // minor-unit exponent (2 for fiat, 6 for stablecoin display→we keep 2 for UI)
  kind: 'fiat' | 'stablecoin';
}

// ─── Balances (spec §5.6 GET /v1/balances) ────────────────────────────────────

export interface WalletBalance {
  currency: CurrencyCode;
  available: number;     // minor units, spendable now
  ledger: number;        // minor units, including pending holds
}

// ─── Rates (spec §5.6 GET /v1/rates — display/alerts only, not executable) ─────

export interface IndicativeRate {
  pair: string;          // 'USD-NGN'
  from: CurrencyCode;
  to: CurrencyCode;
  mid: number;           // indicative mid-market rate
  sell: number;          // Paymax sell rate (what the customer gets)
  change24hPct: number;  // signed % move over 24h
  updatedAt: string;     // ISO
}

export interface RatePoint {
  t: string;             // ISO timestamp
  rate: number;
}

export type RateRange = '1D' | '1W' | '1M' | '3M' | '1Y';

// ─── Rails / corridors (spec §5.4) ────────────────────────────────────────────

export type Rail = 'bank_transfer' | 'mobile_money' | 'iban' | 'wallet' | 'stablecoin';

export type FxIntent = 'conversion' | 'transfer' | 'collection';

// ─── Quotes (spec §5.2 POST /v1/quotes) ───────────────────────────────────────

export type FeeType = 'provider_fee' | 'rail_fee' | 'paymax_spread';

export interface QuoteFee {
  type: FeeType;
  amount: Money;
}

export interface QuoteRoute {
  provider: string;      // 'eversend' | 'maplerad' | …  (opaque to the caller)
  corridor: string;      // 'USD-NGN'
  rail: Rail;
}

export interface QuoteAlternative {
  provider: string;
  corridor: string;
  rail: Rail;
  allInRate: number;
  destination: Money;
}

export type QuoteStatus = 'quoted' | 'locked' | 'consumed' | 'expired';

export interface Quote {
  id: string;                    // 'q_8Kds2'
  status: QuoteStatus;
  amountType: 'source' | 'destination';
  source: Money;
  destination: Money;
  rate: number;                  // headline mid/quoted rate
  allInRate: number;             // effective rate after spread + fees
  fees: QuoteFee[];
  route: QuoteRoute;
  alternatives: QuoteAlternative[];
  locked: boolean;
  expiresAt: string;             // ISO; lock countdown derives from this
  intent: FxIntent;
}

export interface QuoteRequest {
  source: CurrencyCode;
  destination: CurrencyCode;
  amount: number;                // minor units of `amountType` side
  amountType: 'source' | 'destination';
  intent: FxIntent;
  destinationRail?: Rail;
  lock?: boolean;
}

// ─── Conversions (spec §5.3, Appendix B: pending → settled | failed) ──────────

export type ConversionStatus = 'pending' | 'settled' | 'failed';

export interface Conversion {
  id: string;
  reference: string;
  status: ConversionStatus;
  source: Money;
  destination: Money;
  rate: number;
  allInRate: number;
  fees: QuoteFee[];
  route: QuoteRoute;
  transactionId: string;
  createdAt: string;
  failureReason?: string;
}

// ─── Transfers / payouts (spec §5.4; queued→processing→paid|failed|reversed) ──

export type TransferStatus = 'queued' | 'processing' | 'paid' | 'failed' | 'reversed';

export interface Transfer {
  id: string;
  reference: string;
  status: TransferStatus;
  source: Money;
  destination: Money;
  quotedRate: number | null;     // null for same-currency transfer
  executedRate: number | null;
  fees: QuoteFee[];
  route: QuoteRoute;
  beneficiary: BeneficiarySummary;
  narration: string | null;
  transactionId: string;
  createdAt: string;
  statusHistory: StatusEvent[];
  failureReason?: string;
}

export interface StatusEvent {
  status: string;
  at: string;                    // ISO
}

// ─── Beneficiaries (spec §5.6, §11) ───────────────────────────────────────────

export type BeneficiaryScheme =
  | 'BANK'
  | 'MOBILEMONEY'
  | 'IBAN'
  | 'WALLET'
  | 'STABLECOIN';

export interface Beneficiary {
  id: string;
  name: string;
  rail: Rail;
  scheme: BeneficiaryScheme;
  currency: CurrencyCode;
  accountNumber: string;         // account / IBAN / phone / wallet address (masked in lists)
  bankName: string | null;       // or MoMo operator / network label
  countryCode: string;           // ISO-3166 alpha-2
  validated: boolean;
  favorite: boolean;
  createdAt: string;
}

/** Subset embedded inside a Transfer. */
export type BeneficiarySummary = Pick<
  Beneficiary,
  'id' | 'name' | 'rail' | 'scheme' | 'currency' | 'accountNumber' | 'bankName' | 'countryCode'
>;

export interface NewBeneficiaryDraft {
  name: string;
  rail: Rail;
  scheme: BeneficiaryScheme;
  currency: CurrencyCode;
  accountNumber: string;
  bankName?: string | null;
  countryCode: string;
  favorite?: boolean;
}

// ─── Collections (spec §5.5 POST /v1/collections/virtual-accounts) ────────────

export type VirtualAccountType = 'virtual_account' | 'iban';

export interface VirtualAccount {
  id: string;
  currency: CurrencyCode;
  type: VirtualAccountType;
  status: 'active' | 'pending' | 'closed';
  provider: string;
  createdAt: string;
  details: {
    accountName: string;
    accountNumber?: string;      // NGN virtual account
    bankName?: string;
    iban?: string;               // USD/EUR
    bic?: string;
    rails?: string[];            // e.g. ['ACH','SEPA']
    reference?: string;
  };
}

export interface CollectionEvent {
  id: string;
  virtualAccountId: string;
  amount: Money;
  senderName: string | null;
  reference: string | null;
  createdAt: string;
}

// ─── Transactions (unified ledger view, spec §5.6 GET /v1/transactions) ───────

export type TxType = 'conversion' | 'transfer' | 'collection';
export type TxStatus =
  | 'pending'
  | 'processing'
  | 'successful'
  | 'failed'
  | 'reversed';

export interface TransactionSummary {
  id: string;
  reference: string;
  type: TxType;
  status: TxStatus;
  title: string;                 // human label e.g. "USD → NGN" or "Payout to John Snow"
  source: Money;
  destination: Money;
  createdAt: string;
  direction: 'in' | 'out';       // for ± display
}

export interface TransactionDetail extends TransactionSummary {
  route: QuoteRoute;
  quotedRate: number | null;
  executedRate: number | null;
  fees: QuoteFee[];
  providerRef: string | null;
  counterparty: string | null;
  narration: string | null;
  statusHistory: StatusEvent[];
  failureReason?: string;
}

export interface TransactionFilter {
  type?: TxType;
  currency?: CurrencyCode;
  status?: TxStatus;
  search?: string;
}

// ─── KYC / KYB verification (spec A, §16; Appendix B Customer state machine) ──

export type AccountType = 'individual' | 'business';

/** pending → approved | rejected | review (Appendix B). 'unstarted' precedes submit. */
export type VerificationStatus =
  | 'unstarted'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'review';

export type IdDocType = 'nin' | 'passport' | 'drivers_license' | 'voters_card';

export interface KycConsents {
  terms: boolean;
  privacy: boolean;
  fxDisclosure: boolean;
}

export interface KycIdentity {
  docType: IdDocType;
  idNumber: string;
  dateOfBirth: string;          // ISO date
  frontUploaded: boolean;
  backUploaded: boolean;
  selfieUploaded: boolean;
}

export interface KybBusiness {
  legalName: string;
  rcNumber: string;             // registration number
  businessType: string;
  country: string;
  address: string;
}

export interface DirectorUbo {
  name: string;
  role: string;
  ownershipPct: string;
  idNumber: string;
}

export interface Verification {
  status: VerificationStatus;
  accountType: AccountType;
  tier: number;                 // 0 = unverified … 3 = full
  submittedAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
}

export interface KycSubmission {
  accountType: AccountType;
  consents: KycConsents;
  identity: KycIdentity;
  business?: KybBusiness;
  directors?: DirectorUbo[];
  businessDocsUploaded?: boolean;
}

// ─── Cards (spec F; §5.6 POST /v1/cards) ──────────────────────────────────────

export type CardBrand = 'visa' | 'mastercard' | 'verve';
export type CardStatus = 'active' | 'frozen' | 'terminated';
export type CardColor = 'purple' | 'blue' | 'teal' | 'graphite';

export interface SpendingControls {
  monthlyLimit: number | null;   // minor units; null = no limit
  perTxLimit: number | null;     // minor units; null = no limit
  online: boolean;
  atm: boolean;
  international: boolean;
  contactless: boolean;
}

export interface Card {
  id: string;
  label: string;                 // user nickname e.g. "Subscriptions"
  brand: CardBrand;
  currency: CurrencyCode;
  last4: string;
  expMonth: number;
  expYear: number;
  cardholderName: string;
  balance: number;               // funding balance, minor units
  status: CardStatus;
  color: CardColor;
  spentThisMonth: number;        // minor units
  controls: SpendingControls;
  provider: string;
  createdAt: string;
}

/** Sensitive PAN/CVV revealed on demand (PCI-isolated; spec §15). */
export interface CardSensitive {
  pan: string;                   // full 16-digit, grouped
  cvv: string;
  expiry: string;                // MM/YY
}

export type CardTxStatus = 'approved' | 'declined' | 'pending' | 'refunded';

export interface CardTransaction {
  id: string;
  cardId: string;
  merchant: string;
  category: string;              // e.g. 'Subscriptions', 'Travel'
  icon: string;                  // lucide name
  amount: number;                // minor units
  currency: CurrencyCode;
  status: CardTxStatus;
  createdAt: string;
  declineReason?: string;
}

export interface CreateCardDraft {
  label: string;
  brand: CardBrand;
  currency: CurrencyCode;
  color: CardColor;
  fundingAmount: number;         // minor units (initial load)
}

// ─── Rate alerts (spec C: set rate alert / rate alert list) ───────────────────

export type RateAlertDirection = 'above' | 'below';

export interface RateAlert {
  id: string;
  pair: string;
  from: CurrencyCode;
  to: CurrencyCode;
  direction: RateAlertDirection;
  target: number;
  active: boolean;
  createdAt: string;
  triggeredAt: string | null;
}

export interface NewRateAlertDraft {
  from: CurrencyCode;
  to: CurrencyCode;
  direction: RateAlertDirection;
  target: number;
}

// ─── Drafts the screens build up before hitting a mutation ────────────────────

export interface ConvertDraft {
  from: CurrencyCode;
  to: CurrencyCode;
  amount: number;                // minor units
  amountType: 'source' | 'destination';
}

export interface SendDraft {
  beneficiaryId: string | null;
  beneficiary: NewBeneficiaryDraft | null;   // inline for first-time send
  source: CurrencyCode;
  amount: number;                // minor units (source side)
  narration: string | null;
  reference: string | null;
}

// ─── I. Business / Multi-user ─────────────────────────────────────────────────

export type TeamRole = 'OWNER' | 'ADMIN' | 'APPROVER' | 'INITIATOR' | 'VIEWER';
export type MemberStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  status: MemberStatus;
  lastActiveAt: string | null;
}

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ApprovalRequest {
  id: string;
  type: 'transfer' | 'conversion' | 'bulk_payout';
  reference: string;
  amount: Money;
  destination: string;        // beneficiary / corridor summary
  initiator: string;
  createdAt: string;
  status: ApprovalStatus;
  threshold: number;          // minor units that triggered approval
}

export interface ApprovalThreshold {
  id: string;
  label: string;              // e.g. 'Single payout'
  currency: CurrencyCode;
  amount: number;             // minor units; above this requires approval
  approversRequired: number;
}

export interface ActivityEvent {
  id: string;
  actor: string;
  action: string;             // human label
  target: string | null;
  at: string;
  kind: 'auth' | 'payout' | 'config' | 'approval' | 'security';
}

export interface TeamApiKey {
  id: string;
  label: string;
  prefix: string;
  mode: 'live' | 'sandbox';
  createdAt: string;
  lastUsed: string | null;
}

export interface WebhookSetting {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
}

// ─── J. Notifications ──────────────────────────────────────────────────────────

export type NotificationKind =
  | 'rate_alert'
  | 'conversion'
  | 'payout'
  | 'collection'
  | 'card'
  | 'approval'
  | 'verification'
  | 'security';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  deeplink?: string;
}

// ─── K. Settings ───────────────────────────────────────────────────────────────

export interface StablecoinAddress {
  id: string;
  label: string;
  asset: 'USDC' | 'USDT';
  network: string;            // 'Ethereum' | 'Tron' | 'Base'
  address: string;
}

export interface NotificationPrefs {
  payouts: boolean;
  conversions: boolean;
  collections: boolean;
  rateAlerts: boolean;
  security: boolean;
  approvals: boolean;
}

export interface FxSettings {
  defaultCurrency: CurrencyCode;
  displayRate: 'mid' | 'all_in';
  language: string;
  theme: 'system' | 'light' | 'dark';
  biometricEnabled: boolean;
  twoFactorEnabled: boolean;
  notifications: NotificationPrefs;
  stablecoinAddresses: StablecoinAddress[];
}

export interface TierLimits {
  tier: number;
  tierLabel: string;
  dailyConvertUsedMinor: number;
  dailyConvertLimitMinor: number;
  monthlyPayoutUsedMinor: number;
  monthlyPayoutLimitMinor: number;
  perTxLimitMinor: number;
  currency: CurrencyCode;
}

// ─── Disputes (spec H — dispute a transaction) ────────────────────────────────

export type DisputeReason =
  | 'not_received'
  | 'wrong_amount'
  | 'duplicate'
  | 'unauthorized'
  | 'wrong_rate'
  | 'other';

export interface DisputeDraft {
  transactionId: string;
  reference: string;
  reason: DisputeReason;
  note: string;
}

export type DisputeStatus = 'submitted' | 'investigating' | 'resolved' | 'rejected';

export interface Dispute {
  id: string;
  transactionId: string;
  reference: string;
  reason: DisputeReason;
  note: string;
  status: DisputeStatus;
  createdAt: string;
}

// ─── Error envelope (spec §5.1) ───────────────────────────────────────────────

export type FxErrorType =
  | 'invalid_request'
  | 'authentication'
  | 'rate_expired'
  | 'insufficient_float'
  | 'insufficient_balance'
  | 'routing_unavailable'
  | 'provider_error'
  | 'compliance_block'
  | 'conflict'
  | 'rate_limited'
  | 'internal';

export interface FxError {
  type: FxErrorType;
  code: string;
  message: string;
  param?: string | null;
  providerRef?: string | null;
  requestId?: string;
}
