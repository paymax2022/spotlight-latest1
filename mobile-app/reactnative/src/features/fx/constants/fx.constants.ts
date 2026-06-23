// ── FX Exchange — Constants ──────────────────────────────────────────────────
// Currency catalogue, corridor catalogue, fee/spread config and UI option lists.
// All money is kobo/cents (integer minor units).

import { Colors } from '@/constants/colors';
import type {
  CurrencyCode,
  CurrencyMeta,
  Rail,
  BeneficiaryScheme,
  RateRange,
  CardBrand,
  CardColor,
} from '../types/fx.types';

export const FX_FEATURE_FLAG = 'fx_exchange';

// ─── Currency catalogue ───────────────────────────────────────────────────────

export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  NGN:  { code: 'NGN',  name: 'Nigerian Naira',  symbol: '₦',  flag: '🇳🇬', decimals: 2, kind: 'fiat' },
  USD:  { code: 'USD',  name: 'US Dollar',       symbol: '$',  flag: '🇺🇸', decimals: 2, kind: 'fiat' },
  EUR:  { code: 'EUR',  name: 'Euro',            symbol: '€',  flag: '🇪🇺', decimals: 2, kind: 'fiat' },
  GBP:  { code: 'GBP',  name: 'British Pound',   symbol: '£',  flag: '🇬🇧', decimals: 2, kind: 'fiat' },
  GHS:  { code: 'GHS',  name: 'Ghanaian Cedi',   symbol: '₵',  flag: '🇬🇭', decimals: 2, kind: 'fiat' },
  KES:  { code: 'KES',  name: 'Kenyan Shilling', symbol: 'KSh',flag: '🇰🇪', decimals: 2, kind: 'fiat' },
  XAF:  { code: 'XAF',  name: 'Central African CFA', symbol: 'FCFA', flag: '🇨🇲', decimals: 2, kind: 'fiat' },
  ZAR:  { code: 'ZAR',  name: 'South African Rand', symbol: 'R', flag: '🇿🇦', decimals: 2, kind: 'fiat' },
  USDC: { code: 'USDC', name: 'USD Coin',        symbol: 'USDC', flag: '🪙', decimals: 2, kind: 'stablecoin' },
  USDT: { code: 'USDT', name: 'Tether USD',      symbol: 'USDT', flag: '🪙', decimals: 2, kind: 'stablecoin' },
};

/** Order currencies appear in wallet lists / pickers. */
export const CURRENCY_ORDER: CurrencyCode[] = [
  'NGN', 'USD', 'EUR', 'GBP', 'GHS', 'KES', 'XAF', 'ZAR', 'USDC', 'USDT',
];

/** Currencies a user can hold a wallet in (excludes stablecoin display wallets at V1). */
export const WALLET_CURRENCIES: CurrencyCode[] = ['NGN', 'USD', 'EUR', 'GBP', 'GHS', 'KES'];

// ─── Rails ────────────────────────────────────────────────────────────────────

export const RAILS: { value: Rail; label: string; icon: string; scheme: BeneficiaryScheme }[] = [
  { value: 'bank_transfer', label: 'Bank account',   icon: 'Landmark',    scheme: 'BANK' },
  { value: 'mobile_money',  label: 'Mobile money',    icon: 'Smartphone',  scheme: 'MOBILEMONEY' },
  { value: 'iban',          label: 'IBAN (SEPA/ACH)', icon: 'Globe',       scheme: 'IBAN' },
  { value: 'wallet',        label: 'Paymax wallet',   icon: 'Wallet',      scheme: 'WALLET' },
  { value: 'stablecoin',    label: 'Stablecoin',      icon: 'Coins',       scheme: 'STABLECOIN' },
];

export const RAIL_LABEL: Record<Rail, string> = {
  bank_transfer: 'Bank account',
  mobile_money: 'Mobile money',
  iban: 'IBAN',
  wallet: 'Paymax wallet',
  stablecoin: 'Stablecoin',
};

// ─── Suggested convert amounts, per source currency (minor units) ─────────────

export const SUGGESTED_AMOUNTS: Partial<Record<CurrencyCode, number[]>> = {
  NGN: [1_000_00, 5_000_00, 10_000_00, 50_000_00],   // ₦1k, ₦5k, ₦10k, ₦50k
  USD: [50_00, 100_00, 500_00, 1_000_00],            // $50, $100, $500, $1,000
  EUR: [50_00, 100_00, 500_00, 1_000_00],
  GBP: [50_00, 100_00, 500_00, 1_000_00],
};

// ─── Fee / spread config (transparency line in quotes) ────────────────────────
// Paymax spread is a markup in basis points over the provider all-in rate.

export const PAYMAX_SPREAD_BPS = 105;       // 1.05% default spread (corridor-configurable)
export const PROVIDER_FEE_BPS = 25;         // 0.25% provider fee (illustrative)
export const RAIL_FEE_FLAT: Partial<Record<Rail, number>> = {
  bank_transfer: 0,
  mobile_money: 0,
  iban: 150,                                 // €1.50 / $1.50 flat for IBAN payouts (cents)
  wallet: 0,
  stablecoin: 50,
};

/** Rate-lock window in seconds (tighter than providers' to bound FX risk, spec §5.8). */
export const RATE_LOCK_SECONDS = 90;

/** Minimum / maximum convert amount in USD-equivalent cents (tier guard, illustrative). */
export const MIN_CONVERT_USD_CENTS = 1_00;          // $1
export const MAX_CONVERT_USD_CENTS = 100_000_00;    // $100,000

// ─── Rate history ranges ──────────────────────────────────────────────────────

export const RATE_RANGES: { value: RateRange; label: string }[] = [
  { value: '1D', label: '1D' },
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '1Y', label: '1Y' },
];

// ─── Status → chip styling (pill chips per DESIGN-Mobile.md) ──────────────────
// fg/bg use design tokens only — no hardcoded colors.

export const TX_STATUS_STYLE: Record<
  string,
  { label: string; fg: string; bg: string }
> = {
  successful: { label: 'Successful', fg: Colors.tertiaryContainer,     bg: Colors.iconBgTeal },
  paid:       { label: 'Paid',       fg: Colors.tertiaryContainer,     bg: Colors.iconBgTeal },
  settled:    { label: 'Settled',    fg: Colors.tertiaryContainer,     bg: Colors.iconBgTeal },
  processing: { label: 'Processing', fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  pending:    { label: 'Pending',    fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  queued:     { label: 'Queued',     fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  failed:     { label: 'Failed',     fg: Colors.error,                 bg: Colors.iconBgRed },
  reversed:   { label: 'Reversed',   fg: Colors.error,                 bg: Colors.iconBgRed },
  expired:    { label: 'Expired',    fg: Colors.onSurfaceVariant,      bg: Colors.surfaceContainerHigh },
  // Card statuses + card-transaction statuses (reuse the same chip component).
  active:     { label: 'Active',     fg: Colors.tertiaryContainer,     bg: Colors.iconBgTeal },
  frozen:     { label: 'Frozen',     fg: Colors.secondary,             bg: Colors.iconBgBlue },
  terminated: { label: 'Terminated', fg: Colors.onSurfaceVariant,      bg: Colors.surfaceContainerHigh },
  approved:   { label: 'Approved',   fg: Colors.tertiaryContainer,     bg: Colors.iconBgTeal },
  declined:   { label: 'Declined',   fg: Colors.error,                 bg: Colors.iconBgRed },
  refunded:   { label: 'Refunded',   fg: Colors.secondary,             bg: Colors.iconBgBlue },
};

// ─── Cards (spec F) ──────────────────────────────────────────────────────────

export const CARD_CURRENCIES: CurrencyCode[] = ['USD', 'NGN', 'EUR', 'GBP'];

export const CARD_BRANDS: { value: CardBrand; label: string }[] = [
  { value: 'visa', label: 'Visa' },
  { value: 'mastercard', label: 'Mastercard' },
  { value: 'verve', label: 'Verve' },
];

/** Card art gradients (use brand-palette tokens; mirror BalanceCard gradient approach).
 *  Typed as tuples so they satisfy expo-linear-gradient's `colors` tuple prop. */
export const CARD_GRADIENTS: Record<CardColor, readonly [string, string, string]> = {
  purple:   ['#340075', '#4C1D95', '#0051D5'],
  blue:     ['#0051D5', '#316BF3', '#1A0050'],
  teal:     ['#00453F', '#002D28', '#0051D5'],
  graphite: ['#213145', '#0B1C30', '#340075'],
};

export const CARD_COLOR_OPTIONS: CardColor[] = ['purple', 'blue', 'teal', 'graphite'];

/** Funding presets per card currency (minor units). */
export const CARD_FUND_PRESETS: Partial<Record<CurrencyCode, number[]>> = {
  USD: [50_00, 100_00, 250_00, 500_00],
  NGN: [10_000_00, 25_000_00, 50_000_00, 100_000_00],
  EUR: [50_00, 100_00, 250_00, 500_00],
  GBP: [50_00, 100_00, 250_00, 500_00],
};

// ─── KYC / KYB (spec A) ──────────────────────────────────────────────────────

export const ID_DOC_TYPES: { value: string; label: string }[] = [
  { value: 'nin', label: 'National ID (NIN)' },
  { value: 'passport', label: 'International Passport' },
  { value: 'drivers_license', label: "Driver's License" },
  { value: 'voters_card', label: "Voter's Card" },
];

export const BUSINESS_TYPES: string[] = [
  'Limited Liability Company',
  'Sole Proprietorship',
  'Partnership',
  'Public Limited Company',
  'NGO / Non-profit',
];

/** Tier → display label + indicative limits copy (spec K: Limits & tier). */
export const TIER_LABELS: Record<number, string> = {
  0: 'Unverified',
  1: 'Tier 1 — Verified',
  2: 'Tier 2 — Enhanced',
  3: 'Tier 3 — Full',
};

// ─── Global edge / error states (spec L) ─────────────────────────────────────

export type EdgeAction = 'retry' | 'login' | 'kyc' | 'home' | 'support' | 'update' | 'status';

export interface EdgeStateDef {
  icon: string;              // lucide name
  kindStyle: 'error' | 'empty';
  title: string;
  message: string;
  primaryLabel: string;
  primaryAction: EdgeAction;
  secondaryLabel?: string;
  secondaryAction?: EdgeAction;
}

export const EDGE_STATES: Record<string, EdgeStateDef> = {
  offline: {
    icon: 'WifiOff', kindStyle: 'error',
    title: 'No internet connection',
    message: "You're offline. Check your connection and try again.",
    primaryLabel: 'Retry', primaryAction: 'retry',
  },
  'server-error': {
    icon: 'ServerCrash', kindStyle: 'error',
    title: 'Something went wrong',
    message: 'We hit an unexpected error on our end. Please try again in a moment.',
    primaryLabel: 'Try again', primaryAction: 'retry',
    secondaryLabel: 'Contact support', secondaryAction: 'support',
  },
  'session-expired': {
    icon: 'LogOut', kindStyle: 'error',
    title: 'Session expired',
    message: 'For your security you\'ve been signed out. Please sign in again to continue.',
    primaryLabel: 'Sign in again', primaryAction: 'login',
  },
  'routing-unavailable': {
    icon: 'Route', kindStyle: 'error',
    title: 'Routing temporarily unavailable',
    message: 'We can\'t route this corridor right now. This is usually brief — please try again shortly.',
    primaryLabel: 'Try again', primaryAction: 'retry',
    secondaryLabel: 'Back to home', secondaryAction: 'home',
  },
  'verification-required': {
    icon: 'ShieldAlert', kindStyle: 'empty',
    title: 'Verification required',
    message: 'You need to verify your account before you can convert, send or hold balances.',
    primaryLabel: 'Verify account', primaryAction: 'kyc',
  },
  'limit-exceeded': {
    icon: 'Gauge', kindStyle: 'error',
    title: 'Limit reached',
    message: 'This transaction exceeds your current tier limit. Upgrade your tier to increase your limits.',
    primaryLabel: 'View tier & limits', primaryAction: 'status',
    secondaryLabel: 'Back to home', secondaryAction: 'home',
  },
  maintenance: {
    icon: 'Wrench', kindStyle: 'empty',
    title: 'We\'ll be right back',
    message: 'FX is briefly down for scheduled maintenance. Thanks for your patience — please check back soon.',
    primaryLabel: 'Retry', primaryAction: 'retry',
  },
  'app-update': {
    icon: 'ArrowUpCircle', kindStyle: 'empty',
    title: 'Update required',
    message: 'A newer version of the app is required to keep using FX. Please update to continue.',
    primaryLabel: 'Update now', primaryAction: 'update',
  },
};

// ─── Announcements (Home, spec B) ─────────────────────────────────────────────

export interface FxAnnouncement {
  id: string;
  title: string;
  body: string;
  icon: string;   // lucide name
  tint: 'purple' | 'blue' | 'teal';
}

export const FX_ANNOUNCEMENTS: FxAnnouncement[] = [
  { id: 'an1', title: 'New corridor: USD → KES', body: 'Send to Kenya with tighter rates and instant mobile-money payout.', icon: 'Sparkles', tint: 'teal' },
  { id: 'an2', title: 'Lower spreads for business tier', body: 'Verified businesses now get reduced spreads on USD-NGN.', icon: 'TrendingDown', tint: 'blue' },
  { id: 'an3', title: 'Schedule recurring payouts', body: 'Automate vendor and payroll transfers on a weekly or monthly cycle.', icon: 'CalendarClock', tint: 'purple' },
];

// ─── Quote fee labels ─────────────────────────────────────────────────────────

export const FEE_LABEL: Record<string, string> = {
  provider_fee: 'Provider fee',
  rail_fee: 'Network fee',
  paymax_spread: 'Paymax spread',
};
