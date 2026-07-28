// ── Paymax Invest · Settings — Constants ─────────────────────────────────────
// Display catalogue: fee schedule, help-center FAQ, and status/label styling.
// Styling pulls design tokens only (Colors) — no hard-coded hex (mirrors
// CRYPTO_STATUS_STYLE in the crypto module).

import { Colors } from '@/constants/colors';
import type {
  FaqItem,
  FeeScheduleItem,
  KycTier,
  RiskCategory,
  TicketStatus,
} from '../types/settings.types';

/** Feature flag gating the whole invest-settings surface (mirrors invest_crypto). */
export const SETTINGS_FEATURE_FLAG = 'invest_settings';

// ─── Fee schedule (transparency table; server-config in production) ───────────

export const FEE_SCHEDULE: FeeScheduleItem[] = [
  { label: 'Crypto buy / sell fee', value: '0.90%' },
  { label: 'Liquidity provider fee', value: '0.20%' },
  { label: 'Stocks commission', value: '₦0 (commission-free)' },
  { label: 'FX conversion spread', value: '0.50%' },
  { label: 'Wallet funding (bank transfer)', value: 'Free' },
  { label: 'NGN withdrawal', value: '₦50 flat' },
  { label: 'Crypto network fee', value: 'At cost (varies)' },
  { label: 'Inactivity fee', value: 'None' },
];

// ─── Help center FAQ ──────────────────────────────────────────────────────────

export const FAQ_LIST: FaqItem[] = [
  {
    id: 'faq_kyc',
    question: 'Why do I need to complete KYC?',
    answer:
      'Identity verification is a regulatory requirement for investing. Higher KYC tiers unlock larger limits and additional asset classes.',
  },
  {
    id: 'faq_funding',
    question: 'How do I fund my invest wallet?',
    answer:
      'Link a bank account under Linked banks, then transfer from any bank to your unique Paymax account number. Funds reflect within minutes.',
  },
  {
    id: 'faq_withdrawal',
    question: 'How long do withdrawals take?',
    answer:
      'NGN withdrawals to a linked bank usually settle within a few minutes. Crypto withdrawals are reviewed by compliance before broadcast.',
  },
  {
    id: 'faq_risk',
    question: 'What does my risk profile mean?',
    answer:
      'Your risk category is set from a short suitability questionnaire. It tailors product eligibility and the warnings you see before trading.',
  },
  {
    id: 'faq_security',
    question: 'How do I keep my account secure?',
    answer:
      'Use a unique transaction PIN, review your active devices regularly, and revoke any session you don\'t recognise from the Security center.',
  },
  {
    id: 'faq_statements',
    question: 'Where are my statements and tax documents?',
    answer:
      'Monthly statements and annual tax summaries are available under Statements. You can export any document as a PDF at any time.',
  },
];

// ─── KYC tier display metadata ────────────────────────────────────────────────

export const KYC_TIER_META: Record<KycTier, { label: string; description: string }> = {
  0: { label: 'Unverified', description: 'Complete verification to start investing.' },
  1: { label: 'Tier 1', description: 'Basic verification — limited daily limits.' },
  2: { label: 'Tier 2', description: 'Identity verified — full trading enabled.' },
  3: { label: 'Tier 3', description: 'Enhanced verification — highest limits.' },
};

// ─── Risk category display metadata ───────────────────────────────────────────

export const RISK_CATEGORY_META: Record<RiskCategory, { label: string; description: string }> = {
  conservative: { label: 'Conservative', description: 'Prioritises capital preservation over growth.' },
  balanced: { label: 'Balanced', description: 'A mix of stability and growth potential.' },
  aggressive: { label: 'Aggressive', description: 'Higher risk tolerance for higher potential returns.' },
};

// ─── Status chip styling (design tokens only) ─────────────────────────────────

export interface ChipStyle {
  label: string;
  bg: string;
  fg: string;
}

export const TICKET_STATUS_STYLE: Record<TicketStatus, ChipStyle> = {
  open:     { label: 'Open',     bg: Colors.secondaryFixed, fg: Colors.secondary },
  pending:  { label: 'Pending',  bg: Colors.iconBgGold,     fg: Colors.onWarning },
  resolved: { label: 'Resolved', bg: Colors.tertiaryFixed,  fg: Colors.tertiary },
  closed:   { label: 'Closed',   bg: Colors.surfaceContainerHigh, fg: Colors.onSurfaceVariant },
};
