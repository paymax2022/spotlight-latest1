// ── Paymax Invest · Crypto — Constants ───────────────────────────────────────
// Display catalogue + illustrative fee/spread config + UI option lists.
// All money is integer minor units. Fees/spreads here are MOCK defaults only —
// in production every value comes from the server quote/asset payload (Rule 1).

import { Colors } from '@/constants/colors';
import type {
  ChartRange,
  CryptoFeeType,
  FiatCurrency,
  OrderSide,
  RiskRating,
} from '../types/crypto.types';

/** Feature flag gating the whole crypto surface (docs: every risky capability flagged). */
export const CRYPTO_FEATURE_FLAG = 'invest_crypto';

/** Settlement fiat for the MVP (NGN-first). */
export const DEFAULT_FIAT: FiatCurrency = 'NGN';

/** Fiat display metadata. */
export const FIAT_META: Record<FiatCurrency, { symbol: string; decimals: number; flag: string }> = {
  NGN: { symbol: '₦', decimals: 2, flag: '🇳🇬' },
  USD: { symbol: '$', decimals: 2, flag: '🇺🇸' },
};

// ─── Rate-lock / quote ────────────────────────────────────────────────────────

/** Quote-expiry window in seconds (docs/crypto/modules.md → "expiry timer"). */
export const QUOTE_EXPIRY_SECONDS = 60;

// ─── Fee / spread config (transparency line in the quote breakdown) ───────────
// Illustrative basis-point markups — server overrides per asset/tier.

export const PAYMAX_FEE_BPS = 90;       // 0.90% Paymax fee
export const PROVIDER_FEE_BPS = 20;     // 0.20% liquidity-provider fee
export const SPREAD_BPS_BY_RISK: Record<RiskRating, number> = {
  low: 50,      // 0.50% spread on low-risk (e.g. stablecoins, BTC)
  medium: 90,
  high: 140,
};

/** Swap (crypto-to-crypto) markup, in basis points over the mid cross-rate. */
export const SWAP_SPREAD_BPS = 80;     // 0.80%
export const SWAP_FEE_BPS = 30;        // 0.30% swap fee

export const CRYPTO_FEE_LABEL: Record<CryptoFeeType, string> = {
  paymax_fee: 'Paymax fee',
  provider_fee: 'Provider fee',
  spread: 'Spread',
  network_fee: 'Network fee',
};

/** Suggested fiat buy amounts per currency (minor units). "Start with ₦1,000". */
export const SUGGESTED_FIAT_AMOUNTS: Record<FiatCurrency, number[]> = {
  NGN: [1_000_00, 5_000_00, 20_000_00, 100_000_00],   // ₦1k, ₦5k, ₦20k, ₦100k
  USD: [10_00, 50_00, 100_00, 500_00],                // $10, $50, $100, $500
};

// ─── Chart ranges ─────────────────────────────────────────────────────────────

export const CHART_RANGES: { value: ChartRange; label: string }[] = [
  { value: '1H', label: '1H' },
  { value: '1D', label: '1D' },
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '1Y', label: '1Y' },
];

// ─── Risk rating → chip styling (design tokens only) ──────────────────────────

export const RISK_STYLE: Record<RiskRating, { label: string; fg: string; bg: string }> = {
  low:    { label: 'Lower risk',    fg: Colors.tertiaryContainer,     bg: Colors.iconBgTeal },
  medium: { label: 'Medium risk',   fg: Colors.onWarning,             bg: Colors.iconBgGold },
  high:   { label: 'Higher risk',   fg: Colors.error,                 bg: Colors.iconBgRed },
};

// ─── Order / transaction status → chip styling (crypto state machine) ─────────

export const CRYPTO_STATUS_STYLE: Record<
  string,
  { label: string; fg: string; bg: string }
> = {
  Filled:          { label: 'Completed',  fg: Colors.tertiaryContainer,     bg: Colors.iconBgTeal },
  PartiallyFilled: { label: 'Partial',    fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  Processing:      { label: 'Processing', fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  QuoteAccepted:   { label: 'Submitted',  fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  ComplianceHold:  { label: 'On hold',    fg: Colors.onWarning,             bg: Colors.iconBgGold },
  Failed:          { label: 'Failed',     fg: Colors.error,                 bg: Colors.iconBgRed },
  Reversed:        { label: 'Reversed',   fg: Colors.error,                 bg: Colors.iconBgRed },
};

// ─── Trade side display ───────────────────────────────────────────────────────

export const SIDE_LABEL: Record<OrderSide, string> = { buy: 'Buy', sell: 'Sell' };

// ─── Risk / education copy (education-first; docs/crypto/product.md) ───────────

export const VOLATILITY_DISCLOSURE =
  'Crypto prices are highly volatile and can fall sharply. Only invest what you can afford to lose. Paymax never guarantees returns.';

export const NO_ADVICE_DISCLOSURE =
  'This is general information, not financial advice. Paymax does not recommend specific assets.';

// ─── Withdrawal controls (Phase-4; docs/crypto/compliance.md) ─────────────────

/** Min KYC tier required to withdraw crypto. */
export const WITHDRAWAL_MIN_KYC_TIER = 2;

/** Cooling window (hours) after adding a new address / new device. */
export const WITHDRAWAL_COOLING_HOURS = 24;

export const WITHDRAWAL_DISCLOSURE =
  'Crypto withdrawals are irreversible. Always double-check the address and network — funds sent to the wrong address or network cannot be recovered.';

export const WHITELIST_DISCLOSURE =
  'New addresses are whitelisted and screened before first use. A short cooling period applies for your security.';

export const MANUAL_REVIEW_NOTE =
  'For your protection, crypto withdrawals are reviewed by our compliance team before they are broadcast. You\'ll be notified once it\'s approved.';

export const DEPOSIT_DISCLOSURE =
  'Send only this asset on the selected network to this address. Sending any other asset, or using a different network, will result in permanent loss.';
