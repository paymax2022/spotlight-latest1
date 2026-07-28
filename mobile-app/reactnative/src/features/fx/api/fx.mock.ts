// ── FX Exchange — Mock seed data ─────────────────────────────────────────────
// Realistic deterministic fixtures so loading/empty/populated states render in
// USE_MOCK mode. All money is minor units (integer). Flip USE_MOCK=false in
// fx.api.ts once the real /v1 endpoints land.

import type {
  WalletBalance,
  Beneficiary,
  VirtualAccount,
  CollectionEvent,
  TransactionDetail,
  RateAlert,
  IndicativeRate,
} from '../types/fx.types';
import { midRate } from '../utils/fxFormatters';

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

// ─── Balances ─────────────────────────────────────────────────────────────────

export const MOCK_BALANCES: WalletBalance[] = [
  { currency: 'NGN', available: 2_450_000_00, ledger: 2_450_000_00 },
  { currency: 'USD', available: 3_420_00,     ledger: 3_620_00 },     // $200 pending hold
  { currency: 'EUR', available: 1_180_00,     ledger: 1_180_00 },
  { currency: 'GBP', available: 0,            ledger: 0 },
];

// ─── Indicative rates (display / ticker / alerts only) ────────────────────────

export const MOCK_RATES: IndicativeRate[] = [
  { pair: 'USD-NGN', from: 'USD', to: 'NGN', mid: midRate('USD', 'NGN'), sell: 1581.43, change24hPct: 0.42,  updatedAt: iso(60_000) },
  { pair: 'EUR-NGN', from: 'EUR', to: 'NGN', mid: midRate('EUR', 'NGN'), sell: 1712.05, change24hPct: -0.18, updatedAt: iso(60_000) },
  { pair: 'GBP-NGN', from: 'GBP', to: 'NGN', mid: midRate('GBP', 'NGN'), sell: 1998.60, change24hPct: 0.65,  updatedAt: iso(60_000) },
  { pair: 'USD-GHS', from: 'USD', to: 'GHS', mid: midRate('USD', 'GHS'), sell: 14.72,   change24hPct: 0.10,  updatedAt: iso(60_000) },
  { pair: 'USD-KES', from: 'USD', to: 'KES', mid: midRate('USD', 'KES'), sell: 128.90,  change24hPct: -0.32, updatedAt: iso(60_000) },
];

// ─── Beneficiaries ────────────────────────────────────────────────────────────

export const MOCK_BENEFICIARIES: Beneficiary[] = [
  {
    id: 'ben_1', name: 'John Snow', rail: 'mobile_money', scheme: 'MOBILEMONEY',
    currency: 'XAF', accountNumber: '237670000000', bankName: 'MTN MoMo',
    countryCode: 'CM', validated: true, favorite: true, createdAt: iso(86_400_000 * 12),
  },
  {
    id: 'ben_2', name: 'Amara Okafor', rail: 'bank_transfer', scheme: 'BANK',
    currency: 'NGN', accountNumber: '0123456789', bankName: 'GTBank',
    countryCode: 'NG', validated: true, favorite: true, createdAt: iso(86_400_000 * 30),
  },
  {
    id: 'ben_3', name: 'Acme Ltd', rail: 'iban', scheme: 'IBAN',
    currency: 'EUR', accountNumber: 'DE89370400440532013000', bankName: 'Deutsche Bank',
    countryCode: 'DE', validated: true, favorite: false, createdAt: iso(86_400_000 * 5),
  },
  {
    id: 'ben_4', name: 'Kwame Mensah', rail: 'mobile_money', scheme: 'MOBILEMONEY',
    currency: 'GHS', accountNumber: '233240000000', bankName: 'Vodafone Cash',
    countryCode: 'GH', validated: false, favorite: false, createdAt: iso(86_400_000 * 2),
  },
  {
    id: 'ben_5', name: 'My USDC wallet', rail: 'stablecoin', scheme: 'STABLECOIN',
    currency: 'USDC', accountNumber: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', bankName: null,
    countryCode: 'US', validated: true, favorite: false, createdAt: iso(86_400_000 * 8),
  },
];

// ─── Virtual accounts (collections) ───────────────────────────────────────────

export const MOCK_VIRTUAL_ACCOUNTS: VirtualAccount[] = [
  {
    id: 'va_ngn_1', currency: 'NGN', type: 'virtual_account', status: 'active',
    provider: 'maplerad', createdAt: iso(86_400_000 * 40),
    details: {
      accountName: 'Paymax / Spotlight User', accountNumber: '9901234567',
      bankName: 'Providus Bank', reference: 'PMX-COL-NGN',
    },
  },
  {
    id: 'va_usd_1', currency: 'USD', type: 'iban', status: 'active',
    provider: 'eversend', createdAt: iso(86_400_000 * 20),
    details: {
      accountName: 'Paymax / Spotlight User', iban: 'GB29NWBK60161331926819',
      bic: 'NWBKGB2L', rails: ['ACH', 'SEPA'], reference: 'PMX-COL-USD',
    },
  },
];

export const MOCK_COLLECTIONS: CollectionEvent[] = [
  { id: 'col_1', virtualAccountId: 'va_usd_1', amount: { amount: 1_200_00, currency: 'USD' }, senderName: 'Stripe Payouts', reference: 'INV-2031', createdAt: iso(86_400_000 * 1) },
  { id: 'col_2', virtualAccountId: 'va_ngn_1', amount: { amount: 350_000_00, currency: 'NGN' }, senderName: 'Adaeze Nwosu', reference: 'Rent', createdAt: iso(86_400_000 * 3) },
  { id: 'col_3', virtualAccountId: 'va_usd_1', amount: { amount: 500_00, currency: 'USD' }, senderName: 'Upwork', reference: 'Milestone 4', createdAt: iso(86_400_000 * 9) },
];

// ─── Rate alerts ────────────────────────────────────────────────────────────────

export const MOCK_RATE_ALERTS: RateAlert[] = [
  { id: 'al_1', pair: 'USD-NGN', from: 'USD', to: 'NGN', direction: 'above', target: 1650, active: true, createdAt: iso(86_400_000 * 4), triggeredAt: null },
  { id: 'al_2', pair: 'GBP-NGN', from: 'GBP', to: 'NGN', direction: 'below', target: 1950, active: true, createdAt: iso(86_400_000 * 6), triggeredAt: null },
  { id: 'al_3', pair: 'EUR-NGN', from: 'EUR', to: 'NGN', direction: 'above', target: 1700, active: false, createdAt: iso(86_400_000 * 20), triggeredAt: iso(86_400_000 * 2) },
];

// ─── Transactions (unified ledger) ────────────────────────────────────────────

export const MOCK_TRANSACTIONS: TransactionDetail[] = [
  {
    id: 'tx_1', reference: 'PMX-CV-90021', type: 'conversion', status: 'successful',
    title: 'USD → NGN', direction: 'in',
    source: { amount: 1_000_00, currency: 'USD' }, destination: { amount: 158_143_000, currency: 'NGN' },
    createdAt: iso(3_600_000 * 2),
    route: { provider: 'eversend', corridor: 'USD-NGN', rail: 'wallet' },
    quotedRate: 1598.2, executedRate: 1581.43,
    fees: [
      { type: 'provider_fee', amount: { amount: 2_50, currency: 'USD' } },
      { type: 'paymax_spread', amount: { amount: 10_50, currency: 'USD' } },
    ],
    providerRef: 'evs_8841aa', counterparty: null, narration: null,
    statusHistory: [
      { status: 'pending', at: iso(3_600_000 * 2 + 4_000) },
      { status: 'settled', at: iso(3_600_000 * 2) },
    ],
  },
  {
    id: 'tx_2', reference: 'PMX-TR-77810', type: 'transfer', status: 'successful',
    title: 'Payout to John Snow', direction: 'out',
    source: { amount: 100_00, currency: 'USD' }, destination: { amount: 60_250_00, currency: 'XAF' },
    createdAt: iso(86_400_000 * 1),
    route: { provider: 'maplerad', corridor: 'USD-XAF', rail: 'mobile_money' },
    quotedRate: 602.5, executedRate: 600.1,
    fees: [
      { type: 'provider_fee', amount: { amount: 25, currency: 'USD' } },
      { type: 'rail_fee', amount: { amount: 0, currency: 'USD' } },
      { type: 'paymax_spread', amount: { amount: 1_05, currency: 'USD' } },
    ],
    providerRef: 'mpl_5521cd', counterparty: 'John Snow · MTN MoMo', narration: 'Vendor settlement',
    statusHistory: [
      { status: 'queued', at: iso(86_400_000 * 1 + 30_000) },
      { status: 'processing', at: iso(86_400_000 * 1 + 12_000) },
      { status: 'paid', at: iso(86_400_000 * 1) },
    ],
  },
  {
    id: 'tx_3', reference: 'PMX-COL-44120', type: 'collection', status: 'successful',
    title: 'Collection from Stripe Payouts', direction: 'in',
    source: { amount: 1_200_00, currency: 'USD' }, destination: { amount: 1_200_00, currency: 'USD' },
    createdAt: iso(86_400_000 * 1 + 3_600_000),
    route: { provider: 'eversend', corridor: 'USD-USD', rail: 'iban' },
    quotedRate: null, executedRate: null, fees: [],
    providerRef: 'evs_col_2031', counterparty: 'Stripe Payouts (ACH)', narration: 'INV-2031',
    statusHistory: [{ status: 'received', at: iso(86_400_000 * 1 + 3_600_000) }],
  },
  {
    id: 'tx_4', reference: 'PMX-TR-77744', type: 'transfer', status: 'failed',
    title: 'Payout to Kwame Mensah', direction: 'out',
    source: { amount: 50_00, currency: 'USD' }, destination: { amount: 740_00, currency: 'GHS' },
    createdAt: iso(86_400_000 * 3),
    route: { provider: 'eversend', corridor: 'USD-GHS', rail: 'mobile_money' },
    quotedRate: 14.8, executedRate: null,
    fees: [{ type: 'paymax_spread', amount: { amount: 52, currency: 'USD' } }],
    providerRef: 'evs_fail_8830', counterparty: 'Kwame Mensah · Vodafone Cash', narration: 'Refund',
    statusHistory: [
      { status: 'queued', at: iso(86_400_000 * 3 + 20_000) },
      { status: 'failed', at: iso(86_400_000 * 3) },
    ],
    failureReason: 'Beneficiary wallet could not be validated by the provider.',
  },
  {
    id: 'tx_5', reference: 'PMX-CV-90008', type: 'conversion', status: 'successful',
    title: 'NGN → USD', direction: 'out',
    source: { amount: 800_000_00, currency: 'NGN' }, destination: { amount: 498_00, currency: 'USD' },
    createdAt: iso(86_400_000 * 5),
    route: { provider: 'eversend', corridor: 'NGN-USD', rail: 'wallet' },
    quotedRate: 0.000626, executedRate: 0.000622,
    fees: [{ type: 'paymax_spread', amount: { amount: 8_400_00, currency: 'NGN' } }],
    providerRef: 'evs_77120', counterparty: null, narration: null,
    statusHistory: [{ status: 'settled', at: iso(86_400_000 * 5) }],
  },
];
