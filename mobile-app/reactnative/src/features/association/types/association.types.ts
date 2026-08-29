// ── Association (Group / Membership Management) — Type contract ───────────────
// Source of truth the screens code against. Mirrors the voting/crowdfunding
// feature contracts. IRON RULE: all monetary amounts are integers in minor
// units (kobo) — never floats, never strings for math.

// ─── Organisation discovery ───────────────────────────────────────────────────

export type GroupType = 'OPEN' | 'CLOSED' | 'INVITE_ONLY' | 'CODE_BASED' | 'PAID';

export interface OrganisationSummary {
  id:            string;
  name:          string;
  acronym:       string | null;
  category:      string;          // e.g. "Professional body"
  logoUrl:       string | null;
  coverUrl:      string | null;
  groupType:     GroupType;
  memberCount:   number;
  chapterCount:  number;
  verified:      boolean;
  location:      string | null;   // HQ / primary location
  tagline:       string | null;
}

export interface Organisation extends OrganisationSummary {
  description:        string;
  foundedYear:       number | null;
  requiresPayment:    boolean;
  registrationFeeKobo: number;     // 0 when free
  approvalSummary?:   string;      // human-readable approval path
  membershipCategories: MembershipCategory[];
  chapters:           Chapter[];
  /** Every collection below is optional — the live DTO returns a subset. */
  requirements?:      JoinRequirement[];
  rules?:             string[];    // group rules the applicant must accept
  website:            string | null;
  branches?:          string[];        // local branches under the selected chapter (B12)
  committeeOptions?:  string[];        // committees a joiner can express interest in (B13)
}

export interface MembershipCategory {
  id:           string;
  label:        string;            // "Full member", "Student member"…
  description:  string | null;
  duesKobo:     number;            // annual dues for this category
  duesCadence:  DuesCadence;
}

export interface Chapter {
  id:       string;
  name:     string;                // "Lagos State Chapter"
  level:    'REGION' | 'STATE' | 'LOCAL' | 'BRANCH';
  parentId: string | null;
  memberCount: number;
}

export interface JoinRequirement {
  id:       string;
  label:    string;                // "Upload valid ID"
  type:     'DOCUMENT' | 'SPONSOR' | 'PAYMENT' | 'INFO';
  required: boolean;
}

// ─── Join / application flow ──────────────────────────────────────────────────

export interface JoinDraft {
  organisationId: string;
  categoryId:     string | null;
  chapterId:      string | null;
  localBranch:    string | null;       // B12
  committeeInterests: string[];        // B13
  sponsorName:    string | null;
  documents:      { requirementId: string; uri: string; name: string }[];
  acceptedRules:  boolean;
}

export type ApplicationStatus =
  | 'SUBMITTED'
  | 'PENDING_CHAPTER'
  | 'PENDING_NATIONAL'
  | 'PENDING_PAYMENT'
  | 'APPROVED'
  | 'REJECTED'
  | 'INFO_REQUESTED';

export interface ApplicationResult {
  applicationId: string;
  status:        ApplicationStatus;
  organisationName: string;
  submittedAt:   string;           // ISO
  message:       string;           // status explainer
  nextStep:      string | null;
}

// ─── Member identity ──────────────────────────────────────────────────────────

export type MemberStatus =
  | 'ACTIVE'
  | 'PENDING'
  | 'INACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'RESTRICTED';      // payment-gated

export type PaymentStanding = 'PAID' | 'DUE' | 'OVERDUE';

export interface MembershipCard {
  memberId:      string;           // formatted, e.g. "NMA/LA/2024/0192"
  fullName:      string;
  photoUrl:      string | null;
  organisationName: string;
  organisationAcronym: string | null;
  categoryLabel: string;
  chapterName:   string | null;
  status:        MemberStatus;
  paymentStanding: PaymentStanding;
  verified:      boolean;
  /**
   * ISO date, and NULLABLE — the live DTO omits it for a card with no expiry.
   * It was typed non-null, so the card formatted `undefined` as a date and read
   * "Valid thru 1 Jan 1970". Guard before formatting.
   */
  validThrough:  string | null;
  qrPayload:     string;           // opaque verification token
}

/** Result of scanning + verifying a membership-card QR (POST /cards/verify). */
export interface CardVerification {
  valid:                boolean;
  reason?:              string;     // when invalid: INVALID_SIGNATURE | NOT_FOUND | SUSPENDED | EXPIRED | REVOKED | ARREARS
  memberId?:            string;
  fullName?:            string;
  organisationName?:    string;
  organisationAcronym?: string | null;
  categoryLabel?:       string;
  status?:              string;
  paymentStanding?:     string;
  validThrough?:        string | null;
  verifiedAt:           string;     // ISO timestamp
}

export interface MemberProfileSummary {
  id:            string;
  fullName:      string;
  memberId:      string;
  photoUrl:      string | null;
  categoryLabel: string;
  chapterName:   string | null;
  status:        MemberStatus;
  profession:    string | null;
  committees?:   string[];
  /** Present on the live DTO; used to resolve the member's organisation. */
  organisationId?: string | null;
}

export interface MemberProfile extends MemberProfileSummary {
  email:        string | null;     // null when privacy-restricted
  phone:        string | null;     // null when privacy-restricted
  location:     string | null;
  joinedAt:     string;
  paymentStanding: PaymentStanding;
  bio:          string | null;
  contactRestricted: boolean;      // true → contact details hidden by privacy
}

export interface MemberDirectoryQuery {
  search?:   string;
  chapterId?: string;
  category?: string;
  status?:   MemberStatus;
}

// ─── Member dashboard ─────────────────────────────────────────────────────────

export interface MemberDashboard {
  card:          MembershipCard;
  outstandingKobo: number;
  nextDueDate:   string | null;    // ISO
  unreadAnnouncements: number;
  openTasks:     number;
  nextMeeting:   { id: string; title: string; startsAt: string; location: string | null } | null;
  latestAnnouncement: { id: string; title: string; postedAt: string; urgent: boolean } | null;
  restriction:   AccessRestriction | null;   // present when status === RESTRICTED
}

export interface AccessRestriction {
  reason:        string;           // human readable
  amountDueKobo: number;
  disabledFeatures: string[];      // ["Voting", "Event registration"…]
  graceEndsAt:   string | null;    // ISO; null when grace elapsed
}

// ─── Dues & payments ──────────────────────────────────────────────────────────

export type DuesCadence = 'ONE_OFF' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'LIFETIME';

export type InvoiceStatus = 'PAID' | 'DUE' | 'OVERDUE' | 'PROCESSING';

export interface DuesInvoice {
  id:          string;
  title:       string;             // "2026 Annual dues"
  description: string | null;
  amountKobo:  number;
  cadence:     DuesCadence;
  status:      InvoiceStatus;
  /**
   * ISO, and NULLABLE: an ad-hoc or open-ended invoice — an event registration,
   * for one — carries no due date. Never format it without a null guard;
   * `new Date(null)` is 1 Jan 1970, not an error.
   */
  dueDate:     string | null;
  scope:       'NATIONAL' | 'STATE' | 'LOCAL' | 'COMMITTEE';
  /**
   * Authoritative revenue split, computed server-side. The client never
   * invents percentages — when this is absent the breakdown is not shown.
   */
  split?:      RevenueSplitLine[];
}

export interface RevenueSplitLine {
  label:      string;              // "National body"
  amountKobo: number;
}

export interface DuesSummary {
  outstandingKobo: number;
  paidThisYearKobo: number;
  standing:    PaymentStanding;
  invoices:    DuesInvoice[];
}

export interface PaymentReceipt {
  id:           string;
  reference:    string;
  invoiceTitle: string;
  amountKobo:   number;
  method:       'WALLET' | 'PAYSTACK';
  paidAt:       string;            // ISO
  memberName:   string;
  organisationName: string;
  split:        RevenueSplitLine[];
}

export interface PayInvoiceResult {
  receiptId: string;
  status:    'SUCCESS' | 'PENDING' | 'FAILED';
}

// ─── Edge / restriction states (for app/association/edge/[type]) ──────────────

export type AssociationEdgeType =
  | 'payment-required'
  | 'suspended'
  | 'pending-approval'
  | 'rejected'
  | 'no-organisations'
  | 'invite-invalid'
  | 'offline'
  | 'error';

// ─── Elections (TS-13) — wired to /associations/elections ─────────────────────

export type ElectionStatus = 'DRAFT' | 'NOMINATION' | 'VOTING' | 'CLOSED' | 'PUBLISHED' | 'CANCELLED';

export interface ElectionSummary {
  id:             string;
  title:          string;
  status:         ElectionStatus;
  votingOpensAt:  string | null;
  votingClosesAt: string | null;
  positionCount:  number;
}

export interface ElectionCandidate {
  id:        string;
  name:      string;
  manifesto: string;
  status:    string;
}

export interface ElectionPosition {
  id:         string;
  title:      string;
  seats:      number;
  candidates: ElectionCandidate[];
  hasVoted:   boolean;
}

export interface CandidateResult {
  candidateId: string;
  name:        string;
  votes:       number;
  isWinner:    boolean;
}

export interface PositionResult {
  positionId:  string;
  title:       string;
  seats:       number;
  ballotsCast: number;
  results:     CandidateResult[];
  checksum?:   string;
}

export interface ElectionDetail {
  id:                string;
  title:             string;
  description:       string;
  status:            ElectionStatus;
  votingOpensAt:     string | null;
  votingClosesAt:    string | null;
  eligible:          boolean;
  eligibilityReason?: string;
  sealedResults:     boolean;
  positions:         ElectionPosition[];
  results?:          PositionResult[];   // only when PUBLISHED
}

export interface VoteReceipt {
  receipt:     string;
  positionId:  string;
  confirmedAt: string;
  alreadyCast: boolean;
}
