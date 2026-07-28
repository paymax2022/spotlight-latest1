// ── Fractional Real Estate — Constants ───────────────────────────────────────

import { Colors } from '@/constants/colors';
import type { OfferingKind, RiskBand, PayoutFrequency } from './types';

/** Mandatory SEC-style risk disclosure shown on home / marketplace / subscription. */
export const RISK_DISCLOSURE_RIBBON =
  'Investments in real estate fractions carry risk, including possible loss of capital. ' +
  'Projected returns are not guaranteed. Read the offer documents before you invest.';

export const RISK_DISCLOSURE_SHORT =
  'Capital at risk. Returns are projected, not guaranteed.';

/** Long-form master risk disclosure for activation consent (scroll-gated). */
export const MASTER_RISK_DISCLOSURE = [
  'This platform offers fractional interests in real estate assets and real-estate-backed debt issued through special purpose vehicles (SPVs). These are not bank deposits and are not insured.',
  'The value of your investment can go down as well as up. You may lose some or all of the money you invest.',
  'Projected yields, rental income and exit values are estimates based on current assumptions. Actual returns may differ materially and are not guaranteed.',
  'Fractional interests are illiquid. A secondary market may exist but there is no guarantee a buyer will be available at the price you want, or at all.',
  'Real estate is exposed to market, tenant, vacancy, regulatory, title and construction risks. Development-debt offerings additionally carry borrower-default risk.',
  'You should only invest money you can afford to lock up for the full tenor and potentially lose. Diversify and seek independent advice where appropriate.',
  'By proceeding you confirm you have read and understood these risks and that any investment decision is your own.',
].join('\n\n');

export const KIND_LABEL: Record<OfferingKind, string> = {
  income_property:  'Income Property',
  development_debt: 'Development Debt',
  land:             'Land',
};

export const KIND_ICON: Record<OfferingKind, string> = {
  income_property:  'Building2',
  development_debt: 'HardHat',
  land:             'TreePine',
};

export const RISK_BAND_LABEL: Record<RiskBand, string> = {
  conservative: 'Conservative',
  balanced:     'Balanced',
  growth:       'Growth',
  speculative:  'Speculative',
};

export const RISK_BAND_COLOR: Record<RiskBand, string> = {
  conservative: Colors.teal,
  balanced:     Colors.secondary,
  growth:       Colors.gold,
  speculative:  Colors.error,
};

export const KIND_COLOR: Record<OfferingKind, string> = {
  income_property:  Colors.secondary,
  development_debt: Colors.gold,
  land:             Colors.teal,
};

export const PAYOUT_FREQ_LABEL: Record<PayoutFrequency, string> = {
  monthly:  'Monthly',
  quarterly: 'Quarterly',
  biannual: 'Twice a year',
  annual:   'Annually',
  on_exit:  'On exit',
};

/** Payouts per year for each frequency (drives the returns calculator preview). */
export const PAYOUTS_PER_YEAR: Record<PayoutFrequency, number> = {
  monthly:  12,
  quarterly: 4,
  biannual: 2,
  annual:   1,
  on_exit:  0,
};

/** Default retail annual subscription limit (kobo) — server is authoritative. */
export const DEFAULT_RETAIL_ANNUAL_LIMIT_KOBO = 10_000_000_00; // ₦10,000,000

/** Value carousel slides for onboarding intro (§8.A.2). */
export const VALUE_SLIDES = [
  { icon: 'Building2',   title: 'Own a slice of real estate',   body: 'Invest from as little as one unit in income properties, land and development projects.' },
  { icon: 'Coins',       title: 'Earn rental & interest income', body: 'Receive periodic payouts straight to your Paymax wallet as your assets perform.' },
  { icon: 'ShieldCheck', title: 'Title-verified, SPV-held',      body: 'Each offering is held in a special purpose vehicle with verified title documents.' },
  { icon: 'TrendingUp',  title: 'Grow & exit',                   body: 'Track performance, reinvest payouts, or list your fraction on the secondary market.' },
];

export const TRUST_MARKERS = ['SEC-aligned disclosures', 'Title verified', 'SPV-structured', 'Audited statements'];

/** Learn hub topics (§8.I.1). */
export const LEARN_TOPICS = [
  { id: 'how-it-works', icon: 'BookOpen',    title: 'How fractional real estate works', minutes: 4 },
  { id: 'risk',         icon: 'AlertTriangle', title: 'Understanding the risks',          minutes: 5 },
  { id: 'returns',      icon: 'Calculator',  title: 'How returns & payouts are calculated', minutes: 3 },
  { id: 'secondary',    icon: 'ArrowLeftRight', title: 'Selling on the secondary market', minutes: 3 },
  { id: 'tax',          icon: 'ReceiptText', title: 'Tax & statements explained',         minutes: 4 },
];
