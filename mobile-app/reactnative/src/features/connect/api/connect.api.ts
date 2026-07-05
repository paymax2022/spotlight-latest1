import { api } from '@/api/client';
import { USE_MOCK, CONNECT_API_BASE } from '../constants/connect.constants';
import { TIER_BENEFITS } from '../constants/connect.constants';
import type {
  ConnectConfig,
  TierStatus,
  TierBenefit,
  WalletSummary,
  OnboardingDraft,
  AgeCheckResult,
  ConnectIntent,
  NotificationPrefs,
  PrivacyPrefs,
  BlockedUser,
  SafetyCase,
  ReportReason,
  DateSafetyState,
  SosContact,
  LanguageOption,
  DataSaverPrefs,
  PremiumPlan,
  PremiumStatus,
  HelpArticle,
  LegalDoc,
  MeProfileSummary,
} from '../types/connect.types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

// Helper: unwrap the envelope the Go backend returns ({ data: ... }).
function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

// Mirrors the public.connect_config seed (visibility='public' rows only).
const MOCK_CONFIG: ConnectConfig = {
  'feature.connect.enabled': true,
  'discovery.daily_match_limit': 20,
  'discovery.daily_like_limit': 50,
  'discovery.super_like_daily_limit': 1,
  'chat.rate_limit_per_min': 20,
  'safety.location_default': 'approximate',
  'verification.required_level_for_chat': 'l1',
};

// getConnectConfig returns the backend-owned, mobile-readable config. The app
// must read these values rather than hard-coding flags/limits.
export async function getConnectConfig(): Promise<ConnectConfig> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300));
    return { ...MOCK_CONFIG };
  }
  const res = await api.get(`${CONNECT_API_BASE}/config`);
  return (res.data?.data ?? res.data) as ConnectConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier / KYC
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_TIER_STATUS: TierStatus = {
  tier: 1,
  label: 'Tier 1',
  dailyLimitKobo: 3_000_000,   // ₦30,000
  remainingKobo: 1_850_000,    // ₦18,500 left today
  canSend: true,
  canReceive: true,
  canWithdraw: false,
  canGoLive: false,
  nextTier: 2,
  nextTierUnlocks: 'Go live, earn, and withdraw up to ₦500,000/day',
};

export async function getTierStatus(): Promise<TierStatus> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_TIER_STATUS };
  }
  const res = await api.get(`${CONNECT_API_BASE}/me/tier`);
  return unwrap<TierStatus>(res);
}

export async function getTierBenefits(): Promise<TierBenefit[]> {
  if (USE_MOCK) {
    await delay(150);
    return TIER_BENEFITS.map((t) => ({ ...t }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/tiers`);
  return unwrap<TierBenefit[]>(res);
}

const MOCK_WALLET: WalletSummary = {
  balanceKobo: 4_250_000,      // ₦42,500
  currency: 'NGN',
  tier: MOCK_TIER_STATUS,
};

export async function getWalletSummary(): Promise<WalletSummary> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_WALLET, tier: { ...MOCK_WALLET.tier } };
  }
  const res = await api.get(`${CONNECT_API_BASE}/me/wallet`);
  return unwrap<WalletSummary>(res);
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding & verification (ON-01..ON-15)
// ─────────────────────────────────────────────────────────────────────────────

function emptyDraft(): OnboardingDraft {
  return {
    intents: [],
    photos: [],
    interests: [],
    preferences: {},
    livenessState: 'not_started',
    identityState: 'not_started',
    underageFlagged: false,
  };
}

let mockDraft: OnboardingDraft = emptyDraft();

export async function getOnboardingDraft(): Promise<OnboardingDraft> {
  if (USE_MOCK) {
    await delay(150);
    return { ...mockDraft };
  }
  const res = await api.get(`${CONNECT_API_BASE}/onboarding/draft`);
  return unwrap<OnboardingDraft>(res);
}

export async function saveOnboardingDraft(
  patch: Partial<OnboardingDraft>,
): Promise<OnboardingDraft> {
  if (USE_MOCK) {
    await delay(180);
    mockDraft = { ...mockDraft, ...patch };
    return { ...mockDraft };
  }
  const res = await api.patch(`${CONNECT_API_BASE}/onboarding/draft`, patch);
  return unwrap<OnboardingDraft>(res);
}

// Compute age locally for instant UX, but the AUTHORITATIVE 18+ decision and the
// underage flag/queueing are owned by the backend (SAFETY INVARIANT §1).
function computeAge(dobIso: string): number {
  const dob = new Date(dobIso);
  if (Number.isNaN(dob.getTime())) return -1;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

// Hard age gate. On suspected minor the backend records an underage flag and
// queues the account to the admin underage review queue.
export async function submitDob(dobIso: string): Promise<AgeCheckResult> {
  const age = computeAge(dobIso);
  const underage = age >= 0 && age < 18;
  if (USE_MOCK) {
    await delay(220);
    mockDraft = { ...mockDraft, dob: dobIso, underageFlagged: underage };
    return { ok: !underage && age >= 18, age, underage };
  }
  const res = await api.post(`${CONNECT_API_BASE}/onboarding/age-check`, { dob: dobIso });
  return unwrap<AgeCheckResult>(res);
}

export async function setIntents(intents: ConnectIntent[]): Promise<OnboardingDraft> {
  return saveOnboardingDraft({ intents });
}

// Liveness capture result (ON-12). Mock returns "passed".
export async function submitLiveness(): Promise<OnboardingDraft> {
  if (USE_MOCK) {
    await delay(900);
    mockDraft = { ...mockDraft, livenessState: 'passed' };
    return { ...mockDraft };
  }
  const res = await api.post(`${CONNECT_API_BASE}/onboarding/liveness`, {});
  return unwrap<OnboardingDraft>(res);
}

// BVN/NIN linkage (ON-13) — real-time NIBSS/NIMC lookup on the backend. No PII
// is logged; mobile only sends the value over TLS to the verified endpoint.
export async function linkIdentity(
  identityType: 'bvn' | 'nin',
  value: string,
): Promise<OnboardingDraft> {
  if (USE_MOCK) {
    await delay(1100);
    const ok = /^\d{11}$/.test(value);
    mockDraft = {
      ...mockDraft,
      identityType,
      identityState: ok ? 'passed' : 'failed',
    };
    if (!ok) throw new Error('Lookup failed. Enter a valid 11-digit BVN or NIN.');
    return { ...mockDraft };
  }
  const res = await api.post(`${CONNECT_API_BASE}/onboarding/identity`, {
    type: identityType,
    value,
  });
  return unwrap<OnboardingDraft>(res);
}

export async function completeOnboarding(): Promise<OnboardingDraft> {
  if (USE_MOCK) {
    await delay(400);
    mockDraft = { ...mockDraft, completedAt: new Date().toISOString() };
    return { ...mockDraft };
  }
  const res = await api.post(`${CONNECT_API_BASE}/onboarding/complete`, {});
  return unwrap<OnboardingDraft>(res);
}

// ─────────────────────────────────────────────────────────────────────────────
// Me hub
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_ME: MeProfileSummary = {
  id: 'me',
  displayName: 'Amara O.',
  headline: 'Product designer · Lagos',
  intents: ['date', 'network'],
  verification: { liveness: 'not_started', identity: 'passed' },
  wallet: MOCK_WALLET,
  gamification: { level: 4, points: 1280, streakDays: 6, badges: 3 },
};

export async function getMeSummary(): Promise<MeProfileSummary> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_ME, wallet: { ...MOCK_ME.wallet, tier: { ...MOCK_ME.wallet.tier } } };
  }
  const res = await api.get(`${CONNECT_API_BASE}/me`);
  return unwrap<MeProfileSummary>(res);
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications settings (ST-05)
// ─────────────────────────────────────────────────────────────────────────────

let mockNotifPrefs: NotificationPrefs = {
  push: true,
  email: true,
  sms: false,
  matches: true,
  messages: true,
  gifts: true,
  liveStreams: false,
  promotions: false,
  safetyAlerts: true,
};

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  if (USE_MOCK) {
    await delay(160);
    return { ...mockNotifPrefs };
  }
  const res = await api.get(`${CONNECT_API_BASE}/me/notifications`);
  return unwrap<NotificationPrefs>(res);
}

export async function updateNotificationPrefs(
  patch: Partial<NotificationPrefs>,
): Promise<NotificationPrefs> {
  if (USE_MOCK) {
    await delay(160);
    // safetyAlerts can never be disabled.
    mockNotifPrefs = { ...mockNotifPrefs, ...patch, safetyAlerts: true };
    return { ...mockNotifPrefs };
  }
  const res = await api.patch(`${CONNECT_API_BASE}/me/notifications`, patch);
  return unwrap<NotificationPrefs>(res);
}

// ─────────────────────────────────────────────────────────────────────────────
// Privacy & visibility (ST-04)
// ─────────────────────────────────────────────────────────────────────────────

let mockPrivacy: PrivacyPrefs = {
  dateVisible: true,
  networkVisible: true,
  locationPrecision: 'approximate', // SAFETY INVARIANT §3
  showOnlineStatus: true,
  showDistance: true,
  readReceipts: true,
};

export async function getPrivacyPrefs(): Promise<PrivacyPrefs> {
  if (USE_MOCK) {
    await delay(160);
    return { ...mockPrivacy };
  }
  const res = await api.get(`${CONNECT_API_BASE}/me/privacy`);
  return unwrap<PrivacyPrefs>(res);
}

export async function updatePrivacyPrefs(patch: Partial<PrivacyPrefs>): Promise<PrivacyPrefs> {
  if (USE_MOCK) {
    await delay(160);
    mockPrivacy = { ...mockPrivacy, ...patch };
    return { ...mockPrivacy };
  }
  const res = await api.patch(`${CONNECT_API_BASE}/me/privacy`, patch);
  return unwrap<PrivacyPrefs>(res);
}

export async function getBlockedUsers(): Promise<BlockedUser[]> {
  if (USE_MOCK) {
    await delay();
    return [
      { id: 'b1', displayName: 'Hidden user', blockedAt: '2026-06-12T10:00:00Z' },
    ];
  }
  const res = await api.get(`${CONNECT_API_BASE}/me/blocked`);
  return unwrap<BlockedUser[]>(res);
}

export async function unblockUser(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(150);
    return;
  }
  await api.delete(`${CONNECT_API_BASE}/me/blocked/${id}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Safety: reports & appeals (ST-06, ST-07, ST-09). Reports MUST create a case
// and never fail silently (SAFETY INVARIANT §7).
// ─────────────────────────────────────────────────────────────────────────────

export const REPORT_REASONS: ReportReason[] = [
  { code: 'fake', label: 'Fake profile or impersonation' },
  { code: 'harassment', label: 'Harassment or hate speech' },
  { code: 'scam', label: 'Scam or financial solicitation', description: 'Asking for money, gift cards, crypto' },
  { code: 'explicit', label: 'Explicit or prohibited content' },
  { code: 'minor', label: 'Suspected minor (under 18)' },
  { code: 'other', label: 'Something else' },
];

export async function getReportReasons(): Promise<ReportReason[]> {
  if (USE_MOCK) {
    await delay(120);
    return REPORT_REASONS.map((r) => ({ ...r }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/safety/report-reasons`);
  return unwrap<ReportReason[]>(res);
}

export async function getSafetyCases(): Promise<SafetyCase[]> {
  if (USE_MOCK) {
    await delay();
    return [
      {
        id: 'case_1024',
        kind: 'report',
        reason: 'Scam or financial solicitation',
        status: 'under_review',
        createdAt: '2026-06-20T08:30:00Z',
        updatedAt: '2026-06-21T09:00:00Z',
      },
    ];
  }
  const res = await api.get(`${CONNECT_API_BASE}/safety/cases`);
  return unwrap<SafetyCase[]>(res);
}

export async function submitReport(input: {
  reason: string;
  details?: string;
  targetUserId?: string;
}): Promise<SafetyCase> {
  if (USE_MOCK) {
    await delay(400);
    const now = new Date().toISOString();
    return {
      id: `case_${Math.floor(Math.random() * 9000 + 1000)}`,
      kind: 'report',
      reason: input.reason,
      details: input.details,
      targetUserId: input.targetUserId,
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
    };
  }
  const res = await api.post(`${CONNECT_API_BASE}/safety/reports`, input);
  return unwrap<SafetyCase>(res);
}

export async function submitAppeal(input: {
  reason: string;
  details?: string;
}): Promise<SafetyCase> {
  if (USE_MOCK) {
    await delay(400);
    const now = new Date().toISOString();
    return {
      id: `appeal_${Math.floor(Math.random() * 9000 + 1000)}`,
      kind: 'appeal',
      reason: input.reason,
      details: input.details,
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
    };
  }
  const res = await api.post(`${CONNECT_API_BASE}/safety/appeals`, input);
  return unwrap<SafetyCase>(res);
}

// ─────────────────────────────────────────────────────────────────────────────
// Date safety / SOS (ST-10)
// ─────────────────────────────────────────────────────────────────────────────

let mockSafety: DateSafetyState = {
  contacts: [{ id: 'c1', name: 'Mum', phone: '0803 000 0000' }],
  checkInEnabled: false,
  tripSharingEnabled: false,
};

export async function getDateSafetyState(): Promise<DateSafetyState> {
  if (USE_MOCK) {
    await delay(160);
    return { ...mockSafety, contacts: mockSafety.contacts.map((c) => ({ ...c })) };
  }
  const res = await api.get(`${CONNECT_API_BASE}/safety/date`);
  return unwrap<DateSafetyState>(res);
}

export async function updateDateSafetyState(
  patch: Partial<Pick<DateSafetyState, 'checkInEnabled' | 'tripSharingEnabled'>>,
): Promise<DateSafetyState> {
  if (USE_MOCK) {
    await delay(160);
    mockSafety = { ...mockSafety, ...patch };
    return { ...mockSafety, contacts: mockSafety.contacts.map((c) => ({ ...c })) };
  }
  const res = await api.patch(`${CONNECT_API_BASE}/safety/date`, patch);
  return unwrap<DateSafetyState>(res);
}

export async function addSosContact(contact: Omit<SosContact, 'id'>): Promise<DateSafetyState> {
  if (USE_MOCK) {
    await delay(200);
    mockSafety = {
      ...mockSafety,
      contacts: [...mockSafety.contacts, { ...contact, id: `c${Date.now()}` }],
    };
    return { ...mockSafety, contacts: mockSafety.contacts.map((c) => ({ ...c })) };
  }
  const res = await api.post(`${CONNECT_API_BASE}/safety/date/contacts`, contact);
  return unwrap<DateSafetyState>(res);
}

// ─────────────────────────────────────────────────────────────────────────────
// Language / Data saver / Premium / Help / Legal
// ─────────────────────────────────────────────────────────────────────────────

export const LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'pcm', label: 'Pidgin' },
  { code: 'ha', label: 'Hausa' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'ig', label: 'Igbo' },
];

let mockLanguage: LanguageOption['code'] = 'en';

export async function getLanguage(): Promise<LanguageOption['code']> {
  if (USE_MOCK) {
    await delay(120);
    return mockLanguage;
  }
  const res = await api.get(`${CONNECT_API_BASE}/me/language`);
  return unwrap<{ code: LanguageOption['code'] }>(res).code;
}

export async function setLanguage(code: LanguageOption['code']): Promise<LanguageOption['code']> {
  if (USE_MOCK) {
    await delay(120);
    mockLanguage = code;
    return code;
  }
  const res = await api.put(`${CONNECT_API_BASE}/me/language`, { code });
  return unwrap<{ code: LanguageOption['code'] }>(res).code;
}

let mockDataSaver: DataSaverPrefs = { level: 'standard', autoplayVideos: false, hdMedia: false };

export async function getDataSaverPrefs(): Promise<DataSaverPrefs> {
  if (USE_MOCK) {
    await delay(120);
    return { ...mockDataSaver };
  }
  const res = await api.get(`${CONNECT_API_BASE}/me/data-saver`);
  return unwrap<DataSaverPrefs>(res);
}

export async function updateDataSaverPrefs(patch: Partial<DataSaverPrefs>): Promise<DataSaverPrefs> {
  if (USE_MOCK) {
    await delay(120);
    mockDataSaver = { ...mockDataSaver, ...patch };
    return { ...mockDataSaver };
  }
  const res = await api.patch(`${CONNECT_API_BASE}/me/data-saver`, patch);
  return unwrap<DataSaverPrefs>(res);
}

export const PREMIUM_PLANS: PremiumPlan[] = [
  {
    id: 'plus_monthly',
    name: 'Connect Plus',
    priceKobo: 350_000, // ₦3,500/mo
    cadence: 'monthly',
    perks: ['See who liked you', 'Unlimited likes', '1 Boost / month', 'Advanced filters'],
  },
  {
    id: 'plus_yearly',
    name: 'Connect Plus (Annual)',
    priceKobo: 3_360_000, // ₦33,600/yr
    cadence: 'yearly',
    perks: ['Everything in Plus', '2 months free', 'Priority support'],
  },
];

export async function getPremiumStatus(): Promise<PremiumStatus> {
  if (USE_MOCK) {
    await delay(160);
    return { active: false };
  }
  const res = await api.get(`${CONNECT_API_BASE}/me/premium`);
  return unwrap<PremiumStatus>(res);
}

export async function getPremiumPlans(): Promise<PremiumPlan[]> {
  if (USE_MOCK) {
    await delay(160);
    return PREMIUM_PLANS.map((p) => ({ ...p }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/premium/plans`);
  return unwrap<PremiumPlan[]>(res);
}

export async function getHelpArticles(): Promise<HelpArticle[]> {
  if (USE_MOCK) {
    await delay(200);
    return [
      { id: 'h1', question: 'How do tier limits work?', answer: 'Each verification tier sets a daily money-movement limit. Higher tiers unlock gifting, withdrawals and going live. Limits are checked on our servers before any transfer.' },
      { id: 'h2', question: 'How do I report someone?', answer: 'Open their profile or chat, tap the menu and choose Report. Every report opens a case our safety team reviews.' },
      { id: 'h3', question: 'Why is my location approximate?', answer: 'For your safety we never show your exact location by default. You can opt in to more precise distance in Privacy settings.' },
      { id: 'h4', question: 'How do I delete my account?', answer: 'Settings → Delete account. This starts a data-deletion flow; some records are retained where law requires.' },
    ];
  }
  const res = await api.get(`${CONNECT_API_BASE}/help/articles`);
  return unwrap<HelpArticle[]>(res);
}

export async function getLegalDocs(): Promise<LegalDoc[]> {
  if (USE_MOCK) {
    await delay(150);
    return [
      { id: 'terms', title: 'Terms of Service', url: 'https://paymax.example/legal/terms', updatedAt: '2026-05-01' },
      { id: 'privacy', title: 'Privacy Policy (NDPA)', url: 'https://paymax.example/legal/privacy', updatedAt: '2026-05-01' },
      { id: 'guidelines', title: 'Community Guidelines', url: 'https://paymax.example/legal/guidelines', updatedAt: '2026-05-01' },
    ];
  }
  const res = await api.get(`${CONNECT_API_BASE}/legal`);
  return unwrap<LegalDoc[]>(res);
}

// Account deletion (ST-16) — starts a data-deletion flow server-side.
export async function requestAccountDeletion(reason?: string): Promise<{ scheduledFor: string }> {
  if (USE_MOCK) {
    await delay(500);
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return { scheduledFor: d.toISOString() };
  }
  const res = await api.post(`${CONNECT_API_BASE}/me/delete`, { reason });
  return unwrap<{ scheduledFor: string }>(res);
}
