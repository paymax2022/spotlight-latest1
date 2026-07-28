// ── Spotlight Academy — EdTech School-Fees module · Domain types ─────────────
// Source of truth for the data layer the PA-/SA- screens code against. Mirrors
// the /api/finance/academy/fees + /competition contract. Money is ALWAYS integers
// in minor units (kobo). Reward points/scores are plain non-monetary integers.
//
// This EXTENDS the existing academy domain (guardian/student identity, savings
// pots, scholarships, leaderboards all already exist — see REUSE-MAP.md §1). The
// genuinely-new entities are Invoice (derived-balance, SF-2), the Installment
// plan (SF-6 disclosure), Hardship request (SF-9), Sponsorship, and the
// cross-school Competition surface.

// ═══════════════════════════════════════════════════════════════════════════════
// PARENT — family, children, invoices, payments (PA-01 … PA-16)
// ═══════════════════════════════════════════════════════════════════════════════

/** A child linked to the guardian (reuses academy guardian-link identity). */
export interface FeesChild {
  id: string;
  firstName: string;
  lastName: string;
  /** School the child attends (fee-facing school, edupay `academy_schools`). */
  schoolId: string;
  schoolName: string;
  classLabel: string;         // "JSS 2"
  admissionNumber: string;
  avatarColorKey: string;
  /** minor_flag — always true pre-18; drives SF-7 minor-safe display. */
  isMinor: boolean;
  /** Active guardian link — gates all fee actions (fail-closed). */
  linked: boolean;
  /** Outstanding balance across all open invoices, kobo (SF-2 derived). */
  outstandingKobo: number;
  /** Next due date across open invoices (ISO), if any. */
  nextDueDate?: string;
}

export type InvoiceStatus =
  | 'draft' | 'issued' | 'part_paid' | 'paid' | 'overdue' | 'waived' | 'cancelled';

export interface InvoiceLineItem {
  id: string;
  label: string;              // "Tuition", "PTA levy", "Uniform"
  amountKobo: number;
  /** Optional mandatory/optional flag surfaced on the detail screen. */
  optional?: boolean;
}

export interface Invoice {
  id: string;
  childId: string;
  childName: string;
  schoolId: string;
  schoolName: string;
  term: string;               // "First Term 2025/26"
  classLabel: string;
  reference: string;          // human-readable ledger reference
  items: InvoiceLineItem[];
  /** Immutable total once issued (SF-1). */
  totalKobo: number;
  /** Sum of settled payment events, kobo (SF-2: balance is derived). */
  paidKobo: number;
  status: InvoiceStatus;
  issuedAt: string;
  dueDate: string;
  /** True once an installment plan is active for this invoice. */
  hasInstallmentPlan: boolean;
  /** Whether the school allows an installment plan on this invoice. */
  installmentEligible: boolean;
}

export type InstallmentStatus = 'scheduled' | 'due' | 'paid' | 'overdue';

export interface Installment {
  id: string;
  seq: number;                // 1-based order in the plan
  amountKobo: number;
  dueDate: string;
  status: InstallmentStatus;
  paidAt?: string;
}

export interface InstallmentPlan {
  id: string;
  invoiceId: string;
  /** Locked at creation (SF-6). Count matches installments.length. */
  count: number;
  totalKobo: number;
  installments: Installment[];
  /** SF-6: disclosure acknowledged before first installment. */
  disclosureAcceptedAt?: string;
  createdAt: string;
}

export type PayMethod = 'wallet' | 'card' | 'transfer';

export interface PaymentResult {
  id: string;
  invoiceId: string;
  amountKobo: number;
  method: PayMethod;
  status: 'paid' | 'pending';
  paidAt: string;
  receiptUrl: string;
  /** New derived invoice balance after this payment (kobo). */
  newBalanceKobo: number;
  /** Provider auth URL for card/transfer (mock string). */
  authorizationUrl?: string;
}

export interface Receipt {
  id: string;
  invoiceId: string;
  childName: string;
  schoolName: string;
  term: string;
  amountKobo: number;
  method: PayMethod;
  paidAt: string;
  reference: string;
  receiptUrl: string;
}

// ── Fees Vault (SF-5: purpose-segregated savings — extends academy pots) ─────
export interface FeesVault {
  id: string;
  name: string;
  childId?: string;
  childName?: string;
  targetKobo: number;
  savedKobo: number;
  /** Linked invoice the vault is earmarked for (optional). */
  invoiceId?: string;
  schoolName?: string;
  createdAt: string;
  /** Auto-save cadence label. */
  cadence: 'manual' | 'weekly' | 'monthly';
  /** Recurring auto-save amount, kobo (0 when manual). */
  autoSaveKobo: number;
}

export interface AutoSaveRule {
  vaultId: string;
  cadence: 'manual' | 'weekly' | 'monthly';
  amountKobo: number;
  /** Next scheduled run (ISO), if active. */
  nextRunAt?: string;
  enabled: boolean;
}

// ── Hardship request (SF-9: human-reviewed, never auto-decisioned) ───────────
export type HardshipStatus = 'submitted' | 'approved' | 'declined' | 'needs_info';

export interface HardshipRequest {
  id: string;
  invoiceId: string;
  childName: string;
  schoolName: string;
  reason: string;
  requestedRelief: 'installments' | 'extension' | 'partial_waiver' | 'scholarship_referral';
  note: string;
  status: HardshipStatus;
  submittedAt: string;
  /** School/admin response copy once reviewed. */
  responseNote?: string;
}

// ── Sponsor-a-student (PA-14: extends academy scholarships) ───────────────────
export interface SponsorshipOpportunity {
  id: string;
  studentFirstName: string;    // minor-safe: first name only (SF-7)
  schoolName: string;
  classLabel: string;
  story: string;
  targetKobo: number;
  raisedKobo: number;
  sponsorCount: number;
  /** True once the current user has pledged. */
  sponsored: boolean;
  icon: string;
}

export interface SponsorshipPledge {
  id: string;
  opportunityId: string;
  amountKobo: number;
  status: 'pledged' | 'settled';
  ts: string;
  receiptUrl: string;
}

// ── School directory + trust score (PA-16) ────────────────────────────────────
export interface DirectorySchool {
  id: string;
  name: string;
  lga: string;
  state: string;
  logoColorKey: string;
  verified: boolean;
  /** 0–100 platform trust score (verification tier + settlement history). */
  trustScore: number;
  studentCount: number;
  /** Whether the guardian already has a child linked here. */
  linked: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STUDENT — cross-school competition (SA-121 … SA-126)
// Extends academy gamification (money-free by design). SF-4: never gated by fees.
// SF-7: minor-safe serialization by default.
// ═══════════════════════════════════════════════════════════════════════════════

export type LeaderboardScope = 'class' | 'school' | 'city' | 'state' | 'national';

export interface CompetitionLeaderboardEntry {
  rank: number;
  /** Minor-safe: first name + school unless consentGiven (SF-7). */
  displayName: string;
  schoolName: string;
  score: number;
  /** True when guardian consent recorded → full name/avatar may show. */
  consentGiven: boolean;
  avatarColorKey?: string;
  isMe: boolean;
  /** Rank movement vs previous period. */
  delta: number;
}

export interface CompetitionLeaderboard {
  scope: LeaderboardScope;
  scopeLabel: string;          // "Lagos State", "SS3 nationwide"
  period: string;              // "This week"
  myRank?: number;
  entries: CompetitionLeaderboardEntry[];
  /** SF-7 flag echoed so the UI can render the minor-safe banner. */
  minorSafe: boolean;
}

export type TournamentStatus = 'upcoming' | 'live' | 'ended';

export interface Tournament {
  id: string;
  title: string;
  subject: string;             // curriculum subject reference (NERDC spine)
  scope: LeaderboardScope;
  scopeLabel: string;
  status: TournamentStatus;
  startsAt: string;
  endsAt: string;
  participantCount: number;
  schoolCount: number;
  /** Reward points (non-monetary) for finishing well — via rewards, not money. */
  rewardPoints: number;
  /** Sponsor label, if sponsored (display only). */
  sponsor?: string;
  /** True once the student has joined. */
  joined: boolean;
  icon: string;
}

export type ChallengeMode = 'blitz' | 'duel' | 'daily';

export interface CompetitionChallenge {
  id: string;
  mode: ChallengeMode;
  title: string;
  subject: string;
  /** Question count for the round. */
  questionCount: number;
  durationSec: number;
  rewardPoints: number;
  /** Opponent label for duel mode (minor-safe first-name only). */
  opponent?: string;
  status: 'available' | 'in_progress' | 'completed';
}

export interface ChallengeResult {
  challengeId: string;
  scorePct: number;
  correct: number;
  total: number;
  rank?: number;
  pointsEarned: number;
  /** Whether a badge was unlocked by this result. */
  badgeUnlocked?: string;
}

export interface CompetitionBadge {
  id: string;
  name: string;
  description: string;
  icon: string;
  tier: 'bronze' | 'silver' | 'gold';
  earned: boolean;
  earnedAt?: string;
  /** 0–100 progress toward earning (for locked badges). */
  progressPct: number;
}

export interface CompetitionReward {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Points cost — reward points are NON-monetary (never cash). */
  pointsCost: number;
  category: 'airtime' | 'data' | 'voucher' | 'badge' | 'merch';
  redeemed: boolean;
}

/** Student competition hub summary (SA-122). */
export interface CompetitionProfile {
  studentFirstName: string;
  schoolName: string;
  classLabel: string;
  totalPoints: number;
  /** National rank (minor-safe: computed, no PII leaked). */
  nationalRank?: number;
  badgesEarned: number;
  tournamentsJoined: number;
  /** Guardian consent flag — controls whether full identity may show (SF-7). */
  consentGiven: boolean;
}
