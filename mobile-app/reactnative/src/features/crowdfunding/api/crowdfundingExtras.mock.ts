// ── Crowdfunding — Wallet / support / notifications / rewards mock ────────────
// All money in kobo.

import type {
  CampaignWalletSummary,
  LedgerEntry,
  BankAccount,
  SupportTicket,
  HelpArticle,
  AppNotification,
  RewardBacker,
  NotificationPrefs,
  CampaignComment,
} from '../types/crowdfunding.types';

export const MOCK_WALLET: CampaignWalletSummary = {
  campaignId: 'my1',
  campaignTitle: 'New Borehole for Amaeze Community',
  availableKobo: 96_400_000,
  pendingKobo: 22_800_000,
  escrowKobo: 49_100_000,
  totalRaisedKobo: 168_300_000,
  totalWithdrawnKobo: 40_000_000,
  frozen: false,
};

export const MOCK_LEDGER: LedgerEntry[] = [
  { id: 'l1', type: 'CONTRIBUTION', description: 'Contribution · Chidi Okafor', amountKobo: 500_000, balanceKobo: 96_400_000, reference: 'SPL-CF-2210', status: 'POSTED', createdAt: '2026-06-19T08:10:00Z' },
  { id: 'l2', type: 'PLATFORM_FEE', description: 'Platform fee (2.5%)', amountKobo: -12_500, balanceKobo: 95_900_000, reference: 'SPL-FEE-2210', status: 'POSTED', createdAt: '2026-06-19T08:10:01Z' },
  { id: 'l3', type: 'CONTRIBUTION', description: 'Contribution · Anonymous', amountKobo: 2_000_000, balanceKobo: 95_912_500, reference: 'SPL-CF-2208', status: 'POSTED', createdAt: '2026-06-19T06:42:00Z' },
  { id: 'l4', type: 'WITHDRAWAL', description: 'Withdrawal to GTBank ••• 4821', amountKobo: -40_000_000, balanceKobo: 56_400_000, reference: 'SPL-WD-3001', status: 'POSTED', createdAt: '2026-06-10T10:00:00Z' },
  { id: 'l5', type: 'MILESTONE_RELEASE', description: 'Milestone 1 released from escrow', amountKobo: 30_000_000, balanceKobo: 96_400_000, reference: 'SPL-MS-1001', status: 'POSTED', createdAt: '2026-06-09T12:00:00Z' },
  { id: 'l6', type: 'REFUND', description: 'Refund · contribution reversed', amountKobo: -200_000, balanceKobo: 66_400_000, reference: 'SPL-RF-0090', status: 'POSTED', createdAt: '2026-06-06T09:05:00Z' },
];

export const MOCK_BANK_ACCOUNTS: BankAccount[] = [
  { id: 'ba1', bankName: 'GTBank', accountNumberMasked: '••• 4821', accountName: 'Adaeze Okonkwo', isDefault: true },
  { id: 'ba2', bankName: 'Access Bank', accountNumberMasked: '••• 9930', accountName: 'Adaeze Okonkwo', isDefault: false },
];

export const MOCK_TICKETS: SupportTicket[] = [
  {
    id: 't1', reference: 'SPL-TK-5001', subject: 'My withdrawal is delayed', category: 'WITHDRAWAL',
    status: 'PENDING', createdAt: '2026-06-18T10:00:00Z', updatedAt: '2026-06-19T09:00:00Z',
    messages: [
      { id: 'm1', from: 'user', body: 'I requested a withdrawal 2 days ago but it’s still pending. Can you check?', createdAt: '2026-06-18T10:00:00Z' },
      { id: 'm2', from: 'support', body: 'Thanks for reaching out — your request is in the approval queue and should be processed within 24 hours.', createdAt: '2026-06-18T13:20:00Z' },
      { id: 'm3', from: 'user', body: 'Okay, thank you.', createdAt: '2026-06-18T13:35:00Z' },
    ],
  },
  {
    id: 't2', reference: 'SPL-TK-4980', subject: 'Reward not received', category: 'REWARD',
    status: 'RESOLVED', createdAt: '2026-06-10T14:00:00Z', updatedAt: '2026-06-12T11:00:00Z',
    messages: [
      { id: 'm1', from: 'user', body: 'I backed a project and my reward hasn’t shipped.', createdAt: '2026-06-10T14:00:00Z' },
      { id: 'm2', from: 'support', body: 'The creator has now shipped your reward. Tracking: NGP-44821. Closing this ticket — reopen anytime.', createdAt: '2026-06-12T11:00:00Z' },
    ],
  },
];

export const MOCK_HELP: HelpArticle[] = [
  { id: 'h1', topic: 'Contributing', question: 'How do I know a campaign is genuine?', answer: 'Look for the verified badge, read the budget and updates, and check the creator profile. Verified campaigns have passed KYC/KYB and document review.' },
  { id: 'h2', topic: 'Contributing', question: 'Can I get a refund?', answer: 'Refunds follow each campaign’s refund policy, shown before you pay. You can request one from your contribution detail if eligible.' },
  { id: 'h3', topic: 'Payments', question: 'What are the fees?', answer: 'A 2.5% platform fee plus payment processing is added on top of your contribution so the campaign receives the full amount you intended.' },
  { id: 'h4', topic: 'Creating', question: 'How long does review take?', answer: 'Most campaigns are reviewed within 24–48 hours. You’ll be notified of approval, rejection, or a change request.' },
  { id: 'h5', topic: 'Withdrawals', question: 'When can I withdraw funds?', answer: 'After KYC verification and admin approval. Milestone campaigns release funds per verified milestone; escrow holds until the goal is met.' },
  { id: 'h6', topic: 'Trust & safety', question: 'How do I report a campaign?', answer: 'Open the campaign, tap “Report this campaign”, and choose a reason. Our Trust & Safety team reviews every report.' },
];

export const MOCK_NOTIFICATIONS: AppNotification[] = [
  { id: 'an1', type: 'CONTRIBUTION_RECEIVED', title: 'Contribution confirmed', body: 'Your ₦5,000 to “Help Baby Zara” was successful. Thank you!', createdAt: '2026-06-19T08:12:00Z', read: false, campaignId: 'cf1' },
  { id: 'an2', type: 'CAMPAIGN_UPDATE', title: 'New update posted', body: '“Help Baby Zara” posted: Surgery date confirmed!', createdAt: '2026-06-18T10:00:00Z', read: false, campaignId: 'cf1' },
  { id: 'an3', type: 'GOAL_MILESTONE', title: 'A campaign you back hit 50%', body: '“Àdìre Documentary” is halfway to its goal.', createdAt: '2026-06-17T16:00:00Z', read: true, campaignId: 'cf3' },
  { id: 'an4', type: 'REFUND_STATUS', title: 'Refund approved', body: 'Your refund of ₦2,000 has been approved and is on its way.', createdAt: '2026-06-16T12:00:00Z', read: true, campaignId: 'cf4' },
  { id: 'an5', type: 'SUPPORT_REPLY', title: 'Support replied', body: 'You have a new reply on ticket SPL-TK-5001.', createdAt: '2026-06-18T13:20:00Z', read: true, campaignId: null },
];

export const MOCK_BACKERS: RewardBacker[] = [
  { id: 'rb1', backerName: 'Chidi Okafor', rewardTierTitle: 'Àdìre Scarf', amountKobo: 2_500_000, status: 'SHIPPED', shippingCity: 'Lagos', requiresShipping: true, claimedAt: '2026-06-08T16:40:00Z' },
  { id: 'rb2', backerName: 'Ngozi Adeyemi', rewardTierTitle: 'Àdìre Scarf', amountKobo: 2_500_000, status: 'PENDING_PRODUCTION', shippingCity: 'Abuja', requiresShipping: true, claimedAt: '2026-06-09T10:10:00Z' },
  { id: 'rb3', backerName: 'Tunde Bakare', rewardTierTitle: 'Digital thank-you', amountKobo: 500_000, status: 'DELIVERED', shippingCity: null, requiresShipping: false, claimedAt: '2026-06-07T09:00:00Z' },
  { id: 'rb4', backerName: 'Fatima Sani', rewardTierTitle: 'Producer Credit', amountKobo: 10_000_000, status: 'DELAYED', shippingCity: 'Kano', requiresShipping: true, claimedAt: '2026-06-05T14:30:00Z' },
];

export const MOCK_NOTIFICATION_PREFS: NotificationPrefs = {
  push: true, email: true, sms: false, contributionAlerts: true, campaignUpdates: true, marketing: false,
};

export const MOCK_COMMENTS: CampaignComment[] = [
  {
    id: 'cm1', campaignId: 'cf1', authorName: 'Ngozi Adeyemi', avatarUrl: null,
    body: 'Praying for Zara. Will the surgery be done in Nigeria or abroad?', createdAt: '2026-06-18T19:00:00Z',
    isQuestion: true, isCreator: false, reported: false,
    replies: [
      { id: 'rp1', authorName: 'Aisha Bello', body: 'Thank you 🙏 The surgery is in Chennai, India — referral letter is in the documents section.', createdAt: '2026-06-18T20:10:00Z', isCreator: true },
    ],
  },
  {
    id: 'cm2', campaignId: 'cf1', authorName: 'Emeka Nwosu', avatarUrl: null,
    body: 'Just contributed. Stay strong, little one! ❤️', createdAt: '2026-06-18T15:30:00Z',
    isQuestion: false, isCreator: false, reported: false, replies: [],
  },
  {
    id: 'cm3', campaignId: 'cf1', authorName: 'Anonymous', avatarUrl: null,
    body: 'How will we know the funds were used for the surgery?', createdAt: '2026-06-17T11:00:00Z',
    isQuestion: true, isCreator: false, reported: false,
    replies: [
      { id: 'rp2', authorName: 'Aisha Bello', body: 'Funds release per verified milestone — we upload hospital receipts at each step.', createdAt: '2026-06-17T12:15:00Z', isCreator: true },
    ],
  },
];
