// ── Paymax Invest · Settings — Mock dataset ──────────────────────────────────
// In-memory fixtures the mock API mutates so add/remove/revoke/create flows feel
// live. Mirrors crypto.mock.ts: plain exported arrays + a few seed records.

import type {
  Device,
  InvestProfile,
  LinkedBank,
  Statement,
  SupportTicket,
} from '../types/settings.types';

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const hours = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

export const MOCK_PROFILE: InvestProfile = {
  name: 'Adaeze Okafor',
  email: 'adaeze.okafor@example.com',
  phone: '+234 803 555 0142',
  kycTier: 2,
  riskCategory: 'balanced',
};

export const MOCK_BANKS: LinkedBank[] = [
  { id: 'bank_1', bankName: 'Guaranty Trust Bank', accountMasked: '•••• 4821', primary: true },
  { id: 'bank_2', bankName: 'Access Bank', accountMasked: '•••• 9037', primary: false },
];

export const MOCK_STATEMENTS: Statement[] = [
  { id: 'stmt_1', period: 'May 2026', createdAt: days(24), kind: 'monthly' },
  { id: 'stmt_2', period: 'April 2026', createdAt: days(55), kind: 'monthly' },
  { id: 'stmt_3', period: 'March 2026', createdAt: days(86), kind: 'monthly' },
  { id: 'stmt_4', period: 'FY 2025', createdAt: days(140), kind: 'annual' },
  { id: 'stmt_5', period: 'Tax Year 2025', createdAt: days(140), kind: 'tax' },
];

export const MOCK_DEVICES: Device[] = [
  { id: 'dev_1', name: 'iPhone 15 Pro · Lagos', lastActive: hours(0.2), current: true },
  { id: 'dev_2', name: 'MacBook Air · Lagos', lastActive: hours(6), current: false },
  { id: 'dev_3', name: 'Pixel 7 · Abuja', lastActive: days(4), current: false },
];

export const MOCK_TICKETS: SupportTicket[] = [
  {
    id: 'tkt_1',
    subject: 'Crypto withdrawal still pending review',
    status: 'pending',
    createdAt: hours(20),
    messages: [
      { from: 'user', body: 'My BTC withdrawal has been pending for a few hours. Can you check?', at: hours(20) },
      { from: 'agent', body: 'Thanks for reaching out — your withdrawal is in compliance review and should clear within 30 minutes.', at: hours(19) },
    ],
  },
  {
    id: 'tkt_2',
    subject: 'How do I upgrade to KYC Tier 3?',
    status: 'resolved',
    createdAt: days(6),
    messages: [
      { from: 'user', body: 'I want to increase my limits. How do I get to Tier 3?', at: days(6) },
      { from: 'agent', body: 'You can upgrade from Profile → KYC details. You\'ll need a proof of address document.', at: days(6) },
      { from: 'user', body: 'Got it, thank you!', at: days(5) },
    ],
  },
];
