// ── Spotlight Wealth — Mock data ─────────────────────────────────────────────
// Rich, education-first fixtures the screens render in mock mode. Money is in
// major units (display reward credit). No profit numbers, no buy-signals — all
// content teaches or rewards learning (docs/crypto/product.md → strict rules).

import { Colors } from '@/constants/colors';
import { DEFAULT_CURRENCY } from '../constants/spotlight.constants';
import type {
  Campaign,
  Challenge,
  FinanceVideo,
  LeaderboardEntry,
  RewardWallet,
} from '../types/spotlight.types';

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const ngn = (amount: number) => ({ amount, currency: DEFAULT_CURRENCY });

// ─── Creator finance videos (education only — no security recommendations) ─────

export const MOCK_VIDEOS: FinanceVideo[] = [
  { id: 'vid_1', title: 'How to build your first budget on any income', creator: 'Ada Talks Money', thumbnailColor: Colors.secondary,     durationMins: 8,  topic: 'budgeting' },
  { id: 'vid_2', title: 'What is an index fund, really?',                creator: 'Tunde Explains',   thumbnailColor: Colors.primaryContainer, durationMins: 11, topic: 'investing-basics' },
  { id: 'vid_3', title: 'Crypto risk 101: volatility, scams & safety',   creator: 'ChainSimple',      thumbnailColor: Colors.gold,           durationMins: 14, topic: 'crypto' },
  { id: 'vid_4', title: 'Reading a stock before you ever buy it',        creator: 'Market Mornings',  thumbnailColor: Colors.teal,           durationMins: 9,  topic: 'stocks' },
  { id: 'vid_5', title: 'The 50/30/20 rule, adapted for Naira earners',  creator: 'Ada Talks Money',  thumbnailColor: Colors.secondary,      durationMins: 6,  topic: 'budgeting' },
  { id: 'vid_6', title: 'Why you can\'t time the market (and what to do)', creator: 'Tunde Explains',   thumbnailColor: Colors.primaryContainer, durationMins: 12, topic: 'investing-basics' },
  { id: 'vid_7', title: 'Building a 3-month emergency fund from zero',    creator: 'Save With Zara',   thumbnailColor: Colors.tertiaryContainer, durationMins: 7,  topic: 'saving' },
  { id: 'vid_8', title: 'Patience, FOMO and your money brain',           creator: 'MindOverMoney',    thumbnailColor: Colors.primary,        durationMins: 10, topic: 'mindset' },
  { id: 'vid_9', title: 'Stablecoins explained without the hype',        creator: 'ChainSimple',      thumbnailColor: Colors.gold,           durationMins: 13, topic: 'crypto' },
  { id: 'vid_10', title: 'Dividends, splits & what corporate actions mean', creator: 'Market Mornings', thumbnailColor: Colors.teal,          durationMins: 15, topic: 'stocks' },
];

// ─── Challenges (learn-and-earn; rewards are wallet credit, never returns) ─────

export const MOCK_CHALLENGES: Challenge[] = [
  {
    id: 'chl_1',
    title: '7-Day Money Habits',
    description: 'Watch one short literacy lesson a day for a week and log a takeaway. Build the habit, earn reward credit — no investing required.',
    reward: ngn(2_500),
    endsAt: hoursFromNow(72),
    joined: false,
    kind: 'literacy',
  },
  {
    id: 'chl_2',
    title: 'Investing Basics Quiz',
    description: 'Answer 10 questions on diversification, risk and fees. Pass to earn reward credit and unlock the next lesson set.',
    reward: ngn(1_500),
    endsAt: hoursFromNow(120),
    joined: true,
    kind: 'quiz',
  },
  {
    id: 'chl_3',
    title: 'Save ₦1,000 Streak',
    description: 'Set aside a small amount toward a goal each day for 14 days. Completing the streak earns reward credit for sticking with it.',
    reward: ngn(3_000),
    endsAt: hoursFromNow(312),
    joined: false,
    kind: 'savings',
  },
  {
    id: 'chl_4',
    title: 'Crypto Safety Challenge',
    description: 'Complete the scam-spotting and wallet-safety lessons, then pass the safety check. Reward credit on completion.',
    reward: ngn(2_000),
    endsAt: hoursFromNow(48),
    joined: false,
    kind: 'literacy',
  },
];

// ─── Learning leaderboard (POINTS from lessons/quizzes — NOT profit) ───────────

export const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  { rank: 1, displayName: 'Chidinma O.',  points: 4_820 },
  { rank: 2, displayName: 'Emeka N.',     points: 4_510 },
  { rank: 3, displayName: 'Fatima A.',    points: 4_205 },
  { rank: 4, displayName: 'Kelvin U.',    points: 3_990 },
  { rank: 5, displayName: 'You',          points: 3_640 },
  { rank: 6, displayName: 'Blessing I.',  points: 3_410 },
  { rank: 7, displayName: 'Sodiq B.',     points: 3_180 },
  { rank: 8, displayName: 'Ngozi C.',     points: 2_905 },
  { rank: 9, displayName: 'David A.',     points: 2_640 },
  { rank: 10, displayName: 'Halima S.',   points: 2_410 },
];

// ─── Reward wallet (credit earned from learning, plus history) ─────────────────

export const MOCK_REWARD_WALLET: RewardWallet = {
  balance: ngn(6_500),
  history: [
    { id: 'rw_1', label: 'Investing Basics Quiz — passed', amount: ngn(1_500),  at: daysAgo(1) },
    { id: 'rw_2', label: '7-Day Money Habits — day 5 bonus', amount: ngn(500),   at: daysAgo(2) },
    { id: 'rw_3', label: 'Redeemed to invest wallet',        amount: ngn(-1_000), at: daysAgo(4) },
    { id: 'rw_4', label: 'Budgeting lesson series — completed', amount: ngn(2_000), at: daysAgo(6) },
    { id: 'rw_5', label: 'Welcome bonus — finished onboarding', amount: ngn(3_500), at: daysAgo(9) },
  ],
};

// ─── Campaigns (creator / event-led education & referral programmes) ───────────

export const MOCK_CAMPAIGNS: Campaign[] = [
  {
    id: 'cmp_1',
    title: 'Spotlight Wealth Academy',
    description: 'A guided track of creator-led lessons covering budgeting, saving and the basics of investing — at your own pace, with reward credit along the way.',
    iconColor: Colors.primary,
    cta: 'Start learning',
  },
  {
    id: 'cmp_2',
    title: 'Bring a Friend to Learn',
    description: 'Invite a friend to complete their first literacy lesson. When they finish, you both receive reward credit. Education-first, no purchase required.',
    iconColor: Colors.secondary,
    cta: 'Invite a friend',
  },
  {
    id: 'cmp_3',
    title: 'Youth Money Week',
    description: 'A week of live creator sessions and short challenges focused on financial literacy for young earners. Join sessions and earn reward credit for participating.',
    iconColor: Colors.teal,
    cta: 'See the schedule',
  },
];
