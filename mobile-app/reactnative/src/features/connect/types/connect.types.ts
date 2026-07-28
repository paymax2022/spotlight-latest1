// Paymax Connect — mobile types (Phase 0 shell + onboarding/me/settings).

// Backend-owned config exposed to mobile (public subset only). Values are kept
// loosely typed because the backend owns the schema; mobile must never hard-code
// these flags/weights/limits. See docs/prd/dating/architecture.md §26.4.
export type ConnectConfig = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// Tiers / KYC (PRD §7). Money is ALWAYS in minor units (kobo). The mobile app
// never computes limits locally — these are projections of backend-owned config
// and verification state, surfaced read-only.
// ─────────────────────────────────────────────────────────────────────────────

export type ConnectTier = 0 | 1 | 2 | 3;

export interface TierBenefit {
  tier: ConnectTier;
  label: string;            // e.g. "Tier 1"
  requirement: string;      // verification required
  dailyLimitKobo: number | null; // null => no fixed limit (Tier 3)
  privileges: string[];     // human-readable privilege bullets
}

// TierStatus is rendered on EVERY money-related surface (PRD §10 note):
// current tier + daily limit + remaining allowance.
export interface TierStatus {
  tier: ConnectTier;
  label: string;
  dailyLimitKobo: number | null; // null => unlimited (Tier 3)
  remainingKobo: number | null;  // null => unlimited
  canSend: boolean;
  canReceive: boolean;
  canWithdraw: boolean;
  canGoLive: boolean;
  nextTier?: ConnectTier;
  nextTierUnlocks?: string;       // short copy: what upgrading unlocks
}

// Wallet summary shown on the Me hub (read-only projection of the ledger).
export interface WalletSummary {
  balanceKobo: number;
  currency: 'NGN';
  tier: TierStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding & verification (PRD §10.1, ON-01..ON-15)
// ─────────────────────────────────────────────────────────────────────────────

export type ConnectIntent = 'date' | 'network' | 'discover';

export type VerificationStep = 'liveness' | 'bvn-nin';
export type VerificationState =
  | 'not_started'
  | 'pending'
  | 'passed'
  | 'failed';

export interface OnboardingDraft {
  intents: ConnectIntent[];
  displayName?: string;
  dob?: string;              // ISO yyyy-mm-dd
  gender?: string;
  location?: string;
  photos: string[];          // local/remote URIs (primary = index 0)
  bio?: string;
  headline?: string;         // networking
  interests: string[];
  // Per-mode discovery preferences (loose: backend owns the schema).
  preferences: Record<string, unknown>;
  livenessState: VerificationState;
  identityState: VerificationState; // BVN/NIN linkage
  identityType?: 'bvn' | 'nin';
  // Hard 18+ gate. When true the account is queued to the admin underage queue
  // and onboarding is blocked (SAFETY INVARIANT §1).
  underageFlagged: boolean;
  completedAt?: string;
}

export interface AgeCheckResult {
  ok: boolean;        // true => 18+, may proceed
  age: number;
  underage: boolean;  // true => routed to underage block + queued server-side
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings / Notifications / Safety / Support (PRD §10.11, §10.12)
// ─────────────────────────────────────────────────────────────────────────────

export interface NotificationPrefs {
  // channel toggles
  push: boolean;
  email: boolean;
  sms: boolean;
  // topic toggles
  matches: boolean;
  messages: boolean;
  gifts: boolean;
  liveStreams: boolean;
  promotions: boolean;
  safetyAlerts: boolean; // cannot be disabled — surfaced read-only/locked
}

export type ConnectMode = 'date' | 'network';

export interface PrivacyPrefs {
  // Per-mode visibility (SAFETY INVARIANT: romantic vs professional separation).
  dateVisible: boolean;
  networkVisible: boolean;
  // Location privacy — approximate by default (SAFETY INVARIANT §3).
  locationPrecision: 'approximate' | 'precise';
  showOnlineStatus: boolean;
  showDistance: boolean;
  readReceipts: boolean;
}

export interface BlockedUser {
  id: string;
  displayName: string;
  blockedAt: string;
}

export type SafetyCaseKind = 'report' | 'appeal';
export type SafetyCaseStatus =
  | 'submitted'
  | 'under_review'
  | 'actioned'
  | 'resolved'
  | 'rejected';

// Every report/appeal creates a case server-side (SAFETY INVARIANT §7) — these
// flows must never fail silently.
export interface SafetyCase {
  id: string;
  kind: SafetyCaseKind;
  reason: string;
  details?: string;
  targetUserId?: string;
  status: SafetyCaseStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ReportReason {
  code: string;
  label: string;
  description?: string;
}

export interface SosContact {
  id: string;
  name: string;
  phone: string;
}

export interface DateSafetyState {
  contacts: SosContact[];
  checkInEnabled: boolean;
  tripSharingEnabled: boolean;
}

export interface LanguageOption {
  code: 'en' | 'pcm' | 'ha' | 'yo' | 'ig';
  label: string;
}

export type DataSaverLevel = 'off' | 'standard' | 'aggressive';

export interface DataSaverPrefs {
  level: DataSaverLevel;
  autoplayVideos: boolean;
  hdMedia: boolean;
}

export interface PremiumPlan {
  id: string;
  name: string;
  priceKobo: number;
  cadence: 'monthly' | 'yearly';
  perks: string[];
}

export interface PremiumStatus {
  active: boolean;
  planId?: string;
  renewsAt?: string;
}

export interface HelpArticle {
  id: string;
  question: string;
  answer: string;
}

export interface LegalDoc {
  id: 'terms' | 'privacy' | 'guidelines';
  title: string;
  url: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gamification entry (Me hub summary only — full screen built by another agent)
// ─────────────────────────────────────────────────────────────────────────────

export interface GamificationSummary {
  level: number;
  points: number;
  streakDays: number;
  badges: number;
}

// Me hub aggregate.
export interface MeProfileSummary {
  id: string;
  displayName: string;
  avatarUrl?: string;
  headline?: string;
  intents: ConnectIntent[];
  verification: {
    liveness: VerificationState;
    identity: VerificationState;
  };
  wallet: WalletSummary;
  gamification: GamificationSummary;
}
