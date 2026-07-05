// ── Paymax Invest · Onboarding — Constants ───────────────────────────────────
// Questionnaire definitions, agreement catalogue, ID-doc metadata, risk-category
// styling/copy and disclosures. UI-config only — in production the questionnaire
// + agreements come from the server (GET /suitability/questions, /invest/agreements).
// Design tokens only: never hard-code colours/spacing/fonts.

import { Colors } from '@/constants/colors';
import type {
  Agreement,
  IdDocType,
  RiskCategory,
} from '../types/onboarding.types';

/** Feature flag gating the whole onboarding surface. */
export const ONBOARDING_FEATURE_FLAG = 'invest_onboarding';

// ─── ID document types ────────────────────────────────────────────────────────

export const ID_DOC_TYPES: { value: IdDocType; label: string; hint: string }[] = [
  { value: 'nin',             label: 'National ID (NIN)',  hint: 'Your NIMC slip or card' },
  { value: 'passport',        label: 'Passport',           hint: 'International passport data page' },
  { value: 'drivers_license', label: "Driver's licence",   hint: 'Front and back' },
  { value: 'voters_card',     label: "Voter's card",       hint: 'PVC, front and back' },
];

// ─── Suitability questionnaire ────────────────────────────────────────────────
// Each question scores 1–4; higher = more risk-tolerant / experienced. The total
// maps to a risk category in onboarding.utils.scoreSuitability.

export interface QuestionOption {
  value: string;
  label: string;
  score: number;
}

export interface SuitabilityQuestion {
  id: keyof import('../types/onboarding.types').SuitabilityAnswers;
  label: string;
  help: string;
  options: QuestionOption[];
}

export const SUITABILITY_QUESTIONS: SuitabilityQuestion[] = [
  {
    id: 'experience',
    label: 'How much investing experience do you have?',
    help: "There's no wrong answer — this just helps us match products to you.",
    options: [
      { value: 'none',    label: "I'm completely new to investing", score: 1 },
      { value: 'some',    label: 'I have made a few investments',     score: 2 },
      { value: 'good',    label: 'I invest regularly',                score: 3 },
      { value: 'expert',  label: 'I trade actively and understand risk', score: 4 },
    ],
  },
  {
    id: 'riskTolerance',
    label: 'How do you feel about taking risks with your money?',
    help: 'Higher potential returns usually mean higher risk.',
    options: [
      { value: 'low',      label: 'I want to protect my money above all', score: 1 },
      { value: 'moderate', label: 'I can accept small ups and downs',     score: 2 },
      { value: 'high',     label: 'I am comfortable with larger swings',  score: 3 },
      { value: 'very_high',label: 'I chase the highest possible returns', score: 4 },
    ],
  },
  {
    id: 'lossTolerance',
    label: 'If your investment dropped 20% in a month, what would you do?',
    help: 'Markets fall as well as rise — this is normal.',
    options: [
      { value: 'sell_all',  label: 'Sell everything to avoid more loss', score: 1 },
      { value: 'sell_some', label: 'Sell some to reduce my exposure',    score: 2 },
      { value: 'hold',      label: 'Hold and wait for recovery',         score: 3 },
      { value: 'buy_more',  label: 'Buy more while prices are low',       score: 4 },
    ],
  },
  {
    id: 'objective',
    label: 'What is your main goal for investing?',
    help: 'Your goal shapes the products we suggest.',
    options: [
      { value: 'preserve', label: 'Keep my money safe',          score: 1 },
      { value: 'income',   label: 'Earn steady income',          score: 2 },
      { value: 'growth',   label: 'Grow my money over time',     score: 3 },
      { value: 'maximize', label: 'Maximise growth, accept risk', score: 4 },
    ],
  },
  {
    id: 'timeHorizon',
    label: 'How long do you plan to keep your money invested?',
    help: 'Longer horizons can usually take on more risk.',
    options: [
      { value: 'short',  label: 'Less than 1 year',  score: 1 },
      { value: 'medium', label: '1 to 3 years',      score: 2 },
      { value: 'long',   label: '3 to 7 years',      score: 3 },
      { value: 'vlong',  label: 'More than 7 years', score: 4 },
    ],
  },
  {
    id: 'cryptoKnowledge',
    label: 'How well do you understand crypto assets?',
    help: 'Crypto is volatile and can lose value quickly.',
    options: [
      { value: 'none',  label: "I've never used crypto",            score: 1 },
      { value: 'basic', label: 'I understand the basics',           score: 2 },
      { value: 'good',  label: 'I have held or traded crypto',       score: 3 },
      { value: 'deep',  label: 'I understand wallets, fees and risk', score: 4 },
    ],
  },
  {
    id: 'stockKnowledge',
    label: 'How well do you understand stocks and ETFs?',
    help: 'Stocks can rise and fall with company and market performance.',
    options: [
      { value: 'none',  label: "I've never bought shares",        score: 1 },
      { value: 'basic', label: 'I know what a share is',          score: 2 },
      { value: 'good',  label: 'I have invested in stocks/ETFs',  score: 3 },
      { value: 'deep',  label: 'I understand valuation and risk', score: 4 },
    ],
  },
];

export const SUITABILITY_QUESTION_COUNT = SUITABILITY_QUESTIONS.length;

// ─── Risk category → styling + plain-language copy (design tokens only) ────────

export const RISK_CATEGORY_STYLE: Record<
  RiskCategory,
  { label: string; fg: string; bg: string; tagline: string; description: string; products: string[] }
> = {
  conservative: {
    label: 'Conservative',
    fg: Colors.tertiaryContainer,
    bg: Colors.iconBgTeal,
    tagline: 'Protecting your money comes first',
    description:
      'You prefer stability over big swings. We will steer you toward lower-risk products and clear, simple options.',
    products: ['Stablecoins (USDT, USDC)', 'Money market & bonds', 'Blue-chip ETFs'],
  },
  balanced: {
    label: 'Balanced',
    fg: Colors.secondary,
    bg: Colors.iconBgBlue,
    tagline: 'A steady mix of safety and growth',
    description:
      'You can accept some ups and downs in exchange for moderate growth over time.',
    products: ['Stablecoins', 'Blue-chip stocks & ETFs', 'BTC & ETH (limited)'],
  },
  growth: {
    label: 'Growth',
    fg: Colors.onPrimaryFixedVariant,
    bg: Colors.iconBgPurple,
    tagline: 'Growing your money over the long run',
    description:
      'You are comfortable with meaningful swings to pursue higher long-term returns.',
    products: ['Stocks & ETFs', 'Major crypto (BTC, ETH, SOL)', 'Thematic baskets'],
  },
  aggressive: {
    label: 'Aggressive',
    fg: Colors.error,
    bg: Colors.iconBgRed,
    tagline: 'Chasing the highest potential returns',
    description:
      'You understand and accept high risk, including the possibility of large losses, for the chance of higher returns.',
    products: ['All crypto assets', 'High-volatility stocks', 'Leveraged thematic baskets'],
  },
};

// ─── Agreements catalogue (legal gate) ────────────────────────────────────────

export const AGREEMENTS: Agreement[] = [
  {
    id: 'terms',
    title: 'Investment Terms of Service',
    version: '2026-01',
    required: true,
    summary: 'The rules that govern your Paymax Invest account.',
    body:
      'By accepting, you agree to the Paymax Invest Terms of Service, including how orders are placed, settled and reported, and the fees that may apply. You confirm the information you provided is accurate.',
  },
  {
    id: 'risk_disclosure',
    title: 'Risk Disclosure Statement',
    version: '2026-01',
    required: true,
    summary: 'Investing carries risk — you can lose money.',
    body:
      'The value of investments can go up and down, and you may get back less than you put in. Crypto assets are especially volatile. Past performance is not a guide to future returns. Only invest money you can afford to lose.',
  },
  {
    id: 'no_advice',
    title: 'No Financial Advice Acknowledgement',
    version: '2026-01',
    required: true,
    summary: 'Paymax does not give personal investment advice.',
    body:
      'Paymax provides general information and tools, not personal financial advice or recommendations. Any decision to invest is yours. Consider seeking independent advice if you are unsure.',
  },
  {
    id: 'privacy',
    title: 'Privacy & Data Consent',
    version: '2026-01',
    required: true,
    summary: 'How we collect and use your verification data.',
    body:
      'You consent to Paymax collecting and processing your identity and suitability information to verify you, meet legal obligations and provide the service, as described in our Privacy Policy.',
  },
  {
    id: 'marketing',
    title: 'Market Updates (optional)',
    version: '2026-01',
    required: false,
    summary: 'Occasional educational market updates by email.',
    body:
      'Receive occasional educational content and product updates. This is optional and you can turn it off at any time in settings.',
  },
];

// ─── Education / trust copy (education-first, plain language) ──────────────────

export const ONBOARDING_INTRO_STEPS: { icon: string; title: string; body: string }[] = [
  { icon: 'GraduationCap', title: 'Learn', body: 'Understand the basics before you commit a single naira.' },
  { icon: 'Wallet',        title: 'Fund',  body: 'Add money to your invest wallet when you are ready.' },
  { icon: 'TrendingUp',    title: 'Invest',body: 'Buy crypto and stocks that match your goals.' },
  { icon: 'Sprout',        title: 'Grow',  body: 'Track your portfolio and grow over the long term.' },
];

export const TRUST_MARKERS: string[] = [
  'Bank-grade encryption',
  'Regulated KYC & compliance',
  'Your data is never sold',
];

export const RISK_DISCLOSURE_SHORT =
  'Investing carries risk. The value of your investments can go down as well as up, and you may get back less than you put in.';

export const KYC_PRIVACY_NOTE =
  'Your identity details are encrypted and used only to verify you and meet legal requirements.';

export const SUITABILITY_INTRO =
  'A few quick questions help us understand your goals and recommend products that suit you. There are no wrong answers, and this is not financial advice.';

export const NO_ADVICE_NOTE =
  'This profile is for guidance only and is not financial advice. You can retake the questionnaire any time your circumstances change.';
