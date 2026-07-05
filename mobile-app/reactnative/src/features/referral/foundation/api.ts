// ── Referral foundation API ──────────────────────────────────────────────────
// Mock-first (USE_MOCK). Live path hits `${REFERRAL_API_BASE}/...`.
// §7A: a blank/invalid code NEVER loses the signup — it silently routes the
// referrer side to the house/Super-Admin default. Money is ALWAYS kobo.

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK, REFERRAL_API_BASE, GRACE_WINDOW_HOURS } from '../constants/referral.constants';
import type {
  AttributionState,
  AttributionType,
  CodeResolution,
  AttributeSignupResult,
  ClaimCodeResult,
  RoleContext,
  NotificationPrefs,
  ReferralNotification,
  AccountStanding,
  StandingLevel,
  ConsentState,
} from './types';

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

// ── Backend (gin.H) DTOs ──────────────────────────────────────────────────────
// Bare JSON shapes returned by the Go referral service. Money is integer kobo.
interface BackendAttribution {
  id: string;
  referred_user_id: string;
  referrer_id?: string | null;
  house_account_id?: string | null;
  attribution_type: string;
  code_used?: string | null;
  is_house: boolean;
  risk_flag?: string | null;
  status: string;
  grace_expires_at?: string | null;
}

interface BackendConsent {
  id: string;
  user_id: string;
  disclosure_id?: string | null;
  consent_type: string;
  granted: boolean;
  version?: string | null;
  source?: string | null;
  created_at: string;
}

interface BackendRiskStatus {
  user_id: string;
  standing: string;
  open_alerts: number;
  open_cases: number;
  held_rewards: number;
}

// Map a backend attribution_type string onto the frontend AttributionType union.
function mapAttributionType(raw: string | undefined, isHouse: boolean): AttributionType {
  switch (raw) {
    case 'code':
    case 'deeplink':
    case 'context':
    case 'regional_house':
    case 'global_house':
      return raw;
    default:
      return isHouse ? 'global_house' : 'code';
  }
}

// Map a backend attribution status string onto the frontend union.
function mapAttributionStatus(raw: string | undefined): AttributionState['status'] {
  switch (raw) {
    case 'grace':
    case 'locked':
    case 'unattributed':
      return raw;
    // Common backend synonyms → closest frontend state.
    case 'active':
    case 'confirmed':
      return 'locked';
    case 'pending':
      return 'grace';
    default:
      return 'unattributed';
  }
}

// Map a bare backend Attribution → the frontend AttributionState.
function mapAttribution(a: BackendAttribution): AttributionState {
  const isHouse = Boolean(a.is_house || a.house_account_id);
  return {
    // TODO(referral phase3): backend exposes referrer_id, not a display name.
    referrerName: null,
    attributionType: mapAttributionType(a.attribution_type, isHouse),
    isHouse,
    status: mapAttributionStatus(a.status),
    graceExpiresAt: a.grace_expires_at ?? null,
    codeUsed: a.code_used ?? null,
  };
}

// The house/none default the onboarding flow expects when there is no attribution.
function houseDefaultAttribution(): AttributionState {
  return {
    referrerName: null,
    attributionType: 'global_house',
    isHouse: true,
    status: 'unattributed',
    graceExpiresAt: null,
    codeUsed: null,
  };
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

// ── Mock fixtures ─────────────────────────────────────────────────────────────
const MOCK_VALID_CODES: Record<string, string> = {
  'AMARA10': 'Amara Eze',
  'TUNDE-PAY': 'Tunde Bakare',
  'SPOT-FRIEND': 'Chidi Nwosu',
};
const MOCK_SELF_CODE = 'MY-OWN-CODE';

const MOCK_ATTRIBUTION_HOUSE: AttributionState = {
  referrerName: null,
  attributionType: 'global_house',
  isHouse: true,
  status: 'grace',
  graceExpiresAt: hoursFromNow(GRACE_WINDOW_HOURS - 3),
  codeUsed: null,
};

const MOCK_ROLE_CONTEXT: RoleContext = {
  available: ['referrer', 'ambassador'],
  active: 'referrer',
  lockedUntilVerified: ['agent', 'merchant'],
};

const MOCK_PREFS: NotificationPrefs = {
  signup: true,
  activation: true,
  reward: true,
  vestingUnlock: true,
  payout: true,
  clawback: true,
  rankUp: false,
  channels: { push: true, email: true, sms: false },
};

const MOCK_NOTIFICATIONS: ReferralNotification[] = [
  { id: 'rn1', type: 'reward', title: 'Reward earned', body: 'Amara completed KYC — ₦500 is now vesting.', createdAt: minsAgo(12), read: false, amountKobo: 50_000 },
  { id: 'rn2', type: 'signup', title: 'A friend signed up', body: 'Someone you invited just created an account.', createdAt: minsAgo(140), read: false },
  { id: 'rn3', type: 'vesting_unlock', title: 'Reward unlocked', body: 'Your ₦500 from Tunde is now ready to withdraw.', createdAt: minsAgo(1500), read: true, amountKobo: 50_000 },
  { id: 'rn4', type: 'payout', title: 'Payout sent', body: '₦1,000 paid to your Spotlight wallet.', createdAt: minsAgo(4320), read: true, amountKobo: 100_000 },
  { id: 'rn5', type: 'clawback', title: 'Reward reversed', body: 'A referral was flagged as invalid; ₦500 was reversed.', createdAt: minsAgo(8640), read: true, amountKobo: 50_000 },
];

const MOCK_STANDING: AccountStanding = {
  level: 'good',
  kycTier: 1,
  flags: [
    { id: 'f1', label: 'Verify your identity', detail: 'Link your BVN or NIN to unlock higher earning limits.', severity: 'info', fix: 'Complete KYC' },
  ],
  earnedKobo: 350_000,
  withheldKobo: 0,
};

const MOCK_CONSENT: ConsentState = {
  termsAcceptedAt: null,
  contactsConsentAt: null,
  nudgesConsentAt: null,
};

// ── Attribution / codes ──────────────────────────────────────────────────────
export async function resolveCode(code: string): Promise<CodeResolution> {
  const trimmed = code.trim().toUpperCase();
  if (USE_MOCK) {
    await delay(220);
    if (!trimmed) return { valid: false, reason: 'not_found' };
    if (trimmed === MOCK_SELF_CODE) return { valid: false, reason: 'self_referral' };
    const name = MOCK_VALID_CODES[trimmed];
    if (name) return { valid: true, referrerName: name };
    return { valid: false, reason: 'not_found' };
  }
  // TODO(referral phase3): no backend `/codes/:code/resolve` endpoint exists yet.
  // Return a minimal, unvalidated resolution (no 404 network call). The code is
  // only truly validated server-side on claim/attribution.
  return trimmed ? { valid: true } : { valid: false, reason: 'not_found' };
}

export async function attributeSignup(code: string): Promise<AttributeSignupResult> {
  const trimmed = code.trim().toUpperCase();
  if (USE_MOCK) {
    await delay(320);
    // Blank or invalid → silently route to the house default (§7A.1/§7A.4).
    if (!trimmed || trimmed === MOCK_SELF_CODE || !MOCK_VALID_CODES[trimmed]) {
      return { attribution: { ...MOCK_ATTRIBUTION_HOUSE }, routedToHouse: true };
    }
    return {
      attribution: {
        referrerName: MOCK_VALID_CODES[trimmed],
        attributionType: 'code',
        isHouse: false,
        status: 'locked',
        graceExpiresAt: null,
        codeUsed: trimmed,
      },
      routedToHouse: false,
    };
  }
  // POST /claim-code → bare Attribution. §7A: a blank/invalid code must never
  // lose the signup — route silently to the house default instead of throwing.
  if (!trimmed) {
    return { attribution: houseDefaultAttribution(), routedToHouse: true };
  }
  try {
    const res = await api.post(
      `${REFERRAL_API_BASE}/claim-code`,
      { code: trimmed },
      { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
    );
    const attribution = mapAttribution(unwrap<BackendAttribution>(res));
    return { attribution, routedToHouse: attribution.isHouse };
  } catch {
    // Invalid / rejected code → silent house routing (§7A.1/§7A.4).
    return { attribution: houseDefaultAttribution(), routedToHouse: true };
  }
}

export async function getAttribution(): Promise<AttributionState> {
  if (USE_MOCK) {
    await delay(240);
    return { ...MOCK_ATTRIBUTION_HOUSE };
  }
  // GET /my-attribution → bare Attribution, or 404 {error:"no attribution"}.
  try {
    const res = await api.get(`${REFERRAL_API_BASE}/my-attribution`);
    return mapAttribution(unwrap<BackendAttribution>(res));
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      // No attribution yet → surface the house/none default, never throw.
      return houseDefaultAttribution();
    }
    throw err;
  }
}

export async function claimCode(code: string): Promise<ClaimCodeResult> {
  const trimmed = code.trim().toUpperCase();
  if (USE_MOCK) {
    await delay(360);
    const current = MOCK_ATTRIBUTION_HOUSE;
    if (current.status === 'locked') return { ok: false, error: 'window_closed' };
    if (trimmed === MOCK_SELF_CODE) return { ok: false, error: 'self_referral' };
    const name = MOCK_VALID_CODES[trimmed];
    if (!name) return { ok: false, error: 'invalid' };
    return {
      ok: true,
      attribution: {
        referrerName: name,
        attributionType: 'code',
        isHouse: false,
        status: 'locked',
        graceExpiresAt: null,
        codeUsed: trimmed,
      },
    };
  }
  // POST /claim-code → bare Attribution. Errors map to the frontend reason union:
  // 409 already-claimed / window closed, 403 self-referral, 400 invalid.
  if (!trimmed) return { ok: false, error: 'invalid' };
  try {
    const res = await api.post(
      `${REFERRAL_API_BASE}/claim-code`,
      { code: trimmed },
      { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
    );
    return { ok: true, attribution: mapAttribution(unwrap<BackendAttribution>(res)) };
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    let error: ClaimCodeResult['error'] = 'invalid';
    if (status === 409) error = 'already_claimed';
    else if (status === 403) error = 'self_referral';
    // TODO(referral phase3): backend does not distinguish 'window_closed' from
    // 'already_claimed' — both surface as 409.
    return { ok: false, error };
  }
}

// ── Roles / context ──────────────────────────────────────────────────────────
export async function getRoleContext(): Promise<RoleContext> {
  if (USE_MOCK) {
    await delay(200);
    return { ...MOCK_ROLE_CONTEXT };
  }
  // TODO(referral phase3): no backend `/roles/*` endpoint. Return a safe default
  // context (every user is at least a 'referrer') without a network call.
  return { available: ['referrer'], active: 'referrer', lockedUntilVerified: [] };
}

export async function setActiveRole(role: RoleContext['active']): Promise<RoleContext> {
  if (USE_MOCK) {
    await delay(180);
    return { ...MOCK_ROLE_CONTEXT, active: role };
  }
  // TODO(referral phase3): no backend `/roles/*` endpoint. No-op success —
  // echo the requested role back within the safe default context.
  return { available: ['referrer'], active: role, lockedUntilVerified: [] };
}

// ── Notifications ────────────────────────────────────────────────────────────
export async function getNotifications(): Promise<ReferralNotification[]> {
  if (USE_MOCK) {
    await delay(260);
    return MOCK_NOTIFICATIONS.map((n) => ({ ...n }));
  }
  // TODO(referral phase3): no backend `/notifications/*` endpoint yet.
  return [];
}

export async function markNotificationsRead(): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay(140);
    return { ok: true };
  }
  // TODO(referral phase3): no backend `/notifications/*` endpoint yet — no-op.
  return { ok: true };
}

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  if (USE_MOCK) {
    await delay(200);
    return { ...MOCK_PREFS, channels: { ...MOCK_PREFS.channels } };
  }
  // TODO(referral phase3): no backend `/notifications/*` endpoint yet — return
  // sensible default prefs (all event types on, push+email channels on).
  return {
    signup: true,
    activation: true,
    reward: true,
    vestingUnlock: true,
    payout: true,
    clawback: true,
    rankUp: true,
    channels: { push: true, email: true, sms: false },
  };
}

export async function updateNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs> {
  if (USE_MOCK) {
    await delay(180);
    return { ...prefs };
  }
  // TODO(referral phase3): no backend `/notifications/*` endpoint yet — no-op
  // success, echo the requested prefs back to the caller.
  return { ...prefs, channels: { ...prefs.channels } };
}

// ── Account / fraud standing ─────────────────────────────────────────────────
export async function getStanding(): Promise<AccountStanding> {
  if (USE_MOCK) {
    await delay(240);
    return { ...MOCK_STANDING, flags: MOCK_STANDING.flags.map((f) => ({ ...f })) };
  }
  // GET /risk/my-status → { status: { user_id, standing, open_alerts,
  // open_cases, held_rewards } }. held_rewards is integer kobo.
  const res = await api.get(`${REFERRAL_API_BASE}/risk/my-status`);
  const body = unwrap<{ status: BackendRiskStatus }>(res);
  const s = body.status;
  const level: StandingLevel =
    s.standing === 'good' || s.standing === 'review' ||
    s.standing === 'restricted' || s.standing === 'suspended'
      ? s.standing
      : (s.open_cases > 0 ? 'restricted' : s.open_alerts > 0 ? 'review' : 'good');
  return {
    level,
    // TODO(referral phase3): backend risk status carries no KYC tier.
    kycTier: 0,
    // TODO(referral phase3): backend exposes alert/case counts, not per-flag
    // detail rows — synthesize summary flags from the open counts.
    flags: [
      ...(s.open_alerts > 0
        ? [{ id: 'alerts', label: `${s.open_alerts} open alert${s.open_alerts === 1 ? '' : 's'}`, detail: 'Your account has open risk alerts under review.', severity: 'warn' as const }]
        : []),
      ...(s.open_cases > 0
        ? [{ id: 'cases', label: `${s.open_cases} open case${s.open_cases === 1 ? '' : 's'}`, detail: 'A review case is open on your referral activity.', severity: 'danger' as const }]
        : []),
    ],
    // TODO(referral phase3): backend has no lifetime-earned figure here.
    earnedKobo: 0,
    withheldKobo: s.held_rewards,
  };
}

export interface AbuseReport {
  category: 'fake_signup' | 'paid_to_join' | 'impersonation' | 'other';
  detail: string;
}

export async function reportAbuse(report: AbuseReport): Promise<{ ok: true; ticketId: string }> {
  if (USE_MOCK) {
    await delay(300);
    return { ok: true, ticketId: `RPT-${Math.floor(Math.random() * 9000 + 1000)}` };
  }
  // POST /risk/report-abuse body { target_user_id, reason_code } → { alert: {...} }.
  // TODO(referral phase3): the frontend AbuseReport has no target_user_id field —
  // send an empty target so the backend attributes the report to the caller's
  // most-recent attribution/referrer; category maps to reason_code, detail rides
  // along for context.
  const res = await api.post(
    `${REFERRAL_API_BASE}/risk/report-abuse`,
    {
      target_user_id: '',
      reason_code: report.category,
      detail: report.detail,
    },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  const body = unwrap<{ alert?: { id?: string } }>(res);
  return { ok: true, ticketId: body.alert?.id ?? `RPT-${Date.now()}` };
}

// ── Consent ──────────────────────────────────────────────────────────────────
export async function getConsent(): Promise<ConsentState> {
  if (USE_MOCK) {
    await delay(160);
    return { ...MOCK_CONSENT };
  }
  // GET /compliance/consents → { consents: Consent[] }. Derive the three
  // frontend timestamps from the latest granted consent of each type.
  const res = await api.get(`${REFERRAL_API_BASE}/compliance/consents`);
  const { consents = [] } = unwrap<{ consents: BackendConsent[] }>(res);
  return consentStateFromList(consents);
}

// Reduce a list of backend consents into the frontend ConsentState. For each
// consent_type keep the created_at of the most recent granted record.
function consentStateFromList(consents: BackendConsent[]): ConsentState {
  const latest = (type: string): string | null => {
    let ts: string | null = null;
    for (const c of consents) {
      if (c.consent_type === type && c.granted) {
        if (!ts || c.created_at > ts) ts = c.created_at;
      }
    }
    return ts;
  };
  return {
    termsAcceptedAt: latest('terms'),
    contactsConsentAt: latest('contacts'),
    nudgesConsentAt: latest('nudges'),
  };
}

export type ConsentKind = 'terms' | 'contacts' | 'nudges';

export async function recordConsent(kind: ConsentKind, granted: boolean): Promise<ConsentState> {
  if (USE_MOCK) {
    await delay(160);
    const now = granted ? new Date().toISOString() : null;
    return {
      termsAcceptedAt: kind === 'terms' ? now : MOCK_CONSENT.termsAcceptedAt,
      contactsConsentAt: kind === 'contacts' ? now : MOCK_CONSENT.contactsConsentAt,
      nudgesConsentAt: kind === 'nudges' ? now : MOCK_CONSENT.nudgesConsentAt,
    };
  }
  // POST /compliance/consents body { consent_type, disclosure_id, granted,
  // version, source } → { consent: Consent }. We POST the single toggled record,
  // then re-derive the full ConsentState (the write only returns one consent).
  await api.post(
    `${REFERRAL_API_BASE}/compliance/consents`,
    {
      consent_type: kind,
      // TODO(referral phase3): frontend has no disclosure/version context — send
      // stable defaults so the compliance record is well-formed. version is an
      // int on the backend (ConsentInput.Version int); v1 = 1.
      disclosure_id: null,
      granted,
      version: 1,
      source: 'mobile',
    },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  return getConsent();
}
