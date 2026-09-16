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

// Several Connect read endpoints (the whole /me/* family, catalogs, settings) are
// not yet implemented on the Go backend and return 404. For DISPLAY-ONLY data we
// degrade gracefully to a safe default instead of throwing, so a missing endpoint
// never breaks the screen. Real auth failures (401/403) and server errors (5xx)
// still surface. Money/write paths never use this.
async function liveOrDefault<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === undefined || status === 404 || status === 405 || status === 501) {
      return fallback;
    }
    throw e;
  }
}

// Honest zero-state defaults for money-facing displays (never fabricate a balance).
const DEFAULT_TIER_STATUS: TierStatus = {
  tier: 0,
  label: 'Tier 0',
  dailyLimitKobo: 0,
  remainingKobo: 0,
  canSend: false,
  canReceive: true,
  canWithdraw: false,
  canGoLive: false,
  nextTier: 1,
  nextTierUnlocks: 'Verify your identity to unlock gifting and higher limits.',
};
const DEFAULT_WALLET: WalletSummary = {
  balanceKobo: 0,
  currency: 'NGN',
  tier: DEFAULT_TIER_STATUS,
};

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
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/me/tier`);
    return unwrap<TierStatus>(res);
  }, DEFAULT_TIER_STATUS);
}

export async function getTierBenefits(): Promise<TierBenefit[]> {
  if (USE_MOCK) {
    await delay(150);
    return TIER_BENEFITS.map((t) => ({ ...t }));
  }
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/tiers`);
    return unwrap<TierBenefit[]>(res);
  }, TIER_BENEFITS.map((t) => ({ ...t })));
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
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/me/wallet`);
    return unwrap<WalletSummary>(res);
  }, { ...DEFAULT_WALLET, tier: { ...DEFAULT_TIER_STATUS } });
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

// The onboarding draft is accumulated CLIENT-SIDE. The Go backend has no
// /onboarding/draft store (only age-gate/consent/status + the profile endpoints),
// so we collect the wizard's answers here and materialise them into the real
// Connect profile in completeOnboarding() via PATCH /profile (+ modes + media).
// This is per-session state; a reload restarts the wizard (acceptable — a partial
// draft was never persisted server-side).
let draft: OnboardingDraft = emptyDraft();

export async function getOnboardingDraft(): Promise<OnboardingDraft> {
  await delay(120);
  return { ...draft };
}

export async function saveOnboardingDraft(
  patch: Partial<OnboardingDraft>,
): Promise<OnboardingDraft> {
  await delay(120);
  draft = { ...draft, ...patch };
  return { ...draft };
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

// Hard age gate (SAFETY INVARIANT §1). The AUTHORITATIVE 18+ decision, the
// underage flag and the admin-review queueing are owned by the backend:
//   POST /onboarding/age-gate { dob: "YYYY-MM-DD" }
//     200 → adult   403 → under 18 (backend has queued the underage flag)
//     400 → invalid/future DOB (surfaced as an error to re-enter)
// In mock mode the age is computed locally so the wizard still runs offline.
export async function submitDob(dobIso: string): Promise<AgeCheckResult> {
  const localAge = computeAge(dobIso);
  if (USE_MOCK) {
    await delay(200);
    const underage = localAge >= 0 && localAge < 18;
    draft = { ...draft, dob: dobIso, underageFlagged: underage };
    return { ok: !underage && localAge >= 18, age: localAge, underage };
  }
  const dob = dobIso.slice(0, 10); // backend expects YYYY-MM-DD
  try {
    const res = await api.post(`${CONNECT_API_BASE}/onboarding/age-gate`, { dob });
    const d = (res.data ?? {}) as { allowed?: boolean; age?: number };
    const age = typeof d.age === 'number' ? d.age : localAge;
    draft = { ...draft, dob: dobIso, underageFlagged: false };
    return { ok: d.allowed !== false, age, underage: false };
  } catch (e) {
    const err = e as { response?: { status?: number; data?: { age?: number; reason?: string } } };
    const status = err.response?.status;
    const age = err.response?.data?.age ?? localAge;
    if (status === 403) {
      // Under 18 — the backend has recorded the underage flag + queued review.
      draft = { ...draft, dob: dobIso, underageFlagged: true };
      return { ok: false, age, underage: true };
    }
    throw e; // 400 invalid DOB (or transport error) → let the screen prompt a retry
  }
}

// Consent (ON-08). The backend requires these kinds accepted (each version 'v1')
// before an account is fully onboarded: POST /onboarding/consent { kind, version }.
const CONSENT_KINDS = ['community_guidelines', 'privacy', 'terms'] as const;
const CONSENT_VERSION = 'v1';

// Records a single consent server-side (idempotent). Mock: no-op.
export async function recordConsent(kind: string, version: string = CONSENT_VERSION): Promise<void> {
  if (USE_MOCK) {
    await delay(60);
    return;
  }
  await api.post(`${CONNECT_API_BASE}/onboarding/consent`, { kind, version });
}

// Records ALL required consents. Best-effort per kind so one failure doesn't wedge
// onboarding; the accept action gates progress but a transient error is logged, not
// fatal (the backend re-checks missing_consents in /onboarding/status).
export async function acceptOnboardingConsents(): Promise<void> {
  if (USE_MOCK) {
    await delay(120);
    return;
  }
  await Promise.all(
    CONSENT_KINDS.map((kind) =>
      api
        .post(`${CONNECT_API_BASE}/onboarding/consent`, { kind, version: CONSENT_VERSION })
        .catch((e: { response?: { status?: number } }) =>
          console.warn('[connect] consent record failed', kind, e?.response?.status),
        ),
    ),
  );
}

export async function setIntents(intents: ConnectIntent[]): Promise<OnboardingDraft> {
  return saveOnboardingDraft({ intents });
}

// BVN/NIN linkage (ON-13). Validated locally for shape; recorded in the draft.
export async function linkIdentity(
  identityType: 'bvn' | 'nin',
  value: string,
): Promise<OnboardingDraft> {
  await delay(700);
  const ok = /^\d{11}$/.test(value);
  draft = { ...draft, identityType, identityState: ok ? 'passed' : 'failed' };
  if (!ok) throw new Error('Lookup failed. Enter a valid 11-digit BVN or NIN.');
  return { ...draft };
}

// Maps the mobile onboarding intents to the backend's profile mode slugs.
const INTENT_TO_MODE: Record<ConnectIntent, string> = {
  date: 'dating',
  network: 'professional',
  discover: 'friendship',
};

// Finalise onboarding by materialising the client-side draft into the real Connect
// profile. PATCH /profile creates the connect_profiles row discovery reads; the
// per-mode + media calls are best-effort and never block completion.
export async function completeOnboarding(): Promise<OnboardingDraft> {
  if (USE_MOCK) {
    await delay(400);
    draft = { ...draft, completedAt: new Date().toISOString() };
    return { ...draft };
  }
  // Essential: create/patch the profile row (backend upserts on first PATCH).
  await api.patch(`${CONNECT_API_BASE}/profile`, {
    display_name: draft.displayName,
    bio: draft.bio,
    city: draft.location,
  });
  // Enable the modes matching the chosen intents (always include 'dating' so the
  // default discovery stack can surface the user). Best-effort per mode.
  const modes = new Set<string>(['dating']);
  for (const it of draft.intents) modes.add(INTENT_TO_MODE[it] ?? 'dating');
  for (const mode of modes) {
    try {
      await api.patch(`${CONNECT_API_BASE}/profile/modes/${mode}`, {
        visible: true,
        intent_tags: draft.interests,
      });
    } catch { /* best-effort — profile already created */ }
  }
  // Register uploaded photos; skip local file:// URIs the server can't fetch.
  for (const url of draft.photos) {
    if (/^https?:\/\//.test(url)) {
      try {
        await api.post(`${CONNECT_API_BASE}/profile/media`, { url, kind: 'photo' });
      } catch { /* best-effort */ }
    }
  }
  draft = { ...draft, completedAt: new Date().toISOString() };
  return { ...draft };
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
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/me`);
    return unwrap<MeProfileSummary>(res);
  }, {
    id: 'me',
    displayName: 'You',
    intents: [],
    verification: { liveness: 'not_started', identity: 'not_started' },
    wallet: { ...DEFAULT_WALLET, tier: { ...DEFAULT_TIER_STATUS } },
    gamification: { level: 1, points: 0, streakDays: 0, badges: 0 },
  });
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
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/me/notifications`);
    return unwrap<NotificationPrefs>(res);
  }, { ...mockNotifPrefs });
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
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/me/privacy`);
    return unwrap<PrivacyPrefs>(res);
  }, { ...mockPrivacy });
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
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/me/blocked`);
    return unwrap<BlockedUser[]>(res);
  }, []);
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
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/safety/report-reasons`);
    return unwrap<ReportReason[]>(res);
  }, REPORT_REASONS.map((r) => ({ ...r })));
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
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/safety/cases`);
    return unwrap<SafetyCase[]>(res);
  }, []);
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
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/safety/date`);
    return unwrap<DateSafetyState>(res);
  }, { contacts: [], checkInEnabled: false, tripSharingEnabled: false });
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
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/me/language`);
    return unwrap<{ code: LanguageOption['code'] }>(res).code;
  }, 'en');
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
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/me/data-saver`);
    return unwrap<DataSaverPrefs>(res);
  }, { ...mockDataSaver });
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

// Mock-only subscription state so subscribe/manage reflect in the UI. The real
// backend owns this; the wallet charge itself runs through the shared checkout
// (usePurchasePayment) which carries the Idempotency-Key.
let MOCK_PREMIUM: PremiumStatus = { active: false };

export async function getPremiumStatus(): Promise<PremiumStatus> {
  if (USE_MOCK) {
    await delay(160);
    return { ...MOCK_PREMIUM };
  }
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/me/premium`);
    return unwrap<PremiumStatus>(res);
  }, { active: false });
}

/** Activate a plan after payment (the charge runs in the checkout layer). */
export async function subscribePremium(planId: string): Promise<PremiumStatus> {
  if (USE_MOCK) {
    await delay(280);
    const plan = PREMIUM_PLANS.find((p) => p.id === planId);
    const days = plan?.cadence === 'yearly' ? 365 : 30;
    MOCK_PREMIUM = { active: true, planId, renewsAt: new Date(Date.now() + days * 86_400_000).toISOString() };
    return { ...MOCK_PREMIUM };
  }
  const res = await api.post(`${CONNECT_API_BASE}/me/premium/subscribe`, { plan_id: planId });
  return unwrap<PremiumStatus>(res);
}

export async function cancelPremium(): Promise<PremiumStatus> {
  if (USE_MOCK) {
    await delay(220);
    MOCK_PREMIUM = { active: false };
    return { ...MOCK_PREMIUM };
  }
  const res = await api.post(`${CONNECT_API_BASE}/me/premium/cancel`, {});
  return unwrap<PremiumStatus>(res);
}

export async function getPremiumPlans(): Promise<PremiumPlan[]> {
  if (USE_MOCK) {
    await delay(160);
    return PREMIUM_PLANS.map((p) => ({ ...p }));
  }
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/premium/plans`);
    return unwrap<PremiumPlan[]>(res);
  }, PREMIUM_PLANS.map((p) => ({ ...p })));
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
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/help/articles`);
    return unwrap<HelpArticle[]>(res);
  }, []);
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
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/legal`);
    return unwrap<LegalDoc[]>(res);
  }, []);
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
