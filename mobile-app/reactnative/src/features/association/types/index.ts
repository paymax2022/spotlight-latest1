import type { GroupType, DuesCadence } from './association.types';

// Invite codes, group/chapter access codes, and required-document uploads.

export type CodeKind = 'INVITE' | 'ACCESS';

export interface CodeValidation {
  valid:            boolean;
  kind:             CodeKind;
  expired:          boolean;
  organisationId:   string | null;
  organisationName: string | null;
  organisationAcronym: string | null;
  chapterName:      string | null;    // code may be tied to a chapter
  categoryLabel:    string | null;    // or to a membership category
  message:          string;           // human-readable result
}

/** A picked file pending upload during the join flow. */
export interface PickedDocument {
  requirementId: string;
  uri:           string;
  name:          string;
  sizeLabel:     string;
}

// IRON RULE: monetary amounts are integers in minor units (kobo).


export type ApprovalRule =
  | 'AUTO'              // open — join instantly
  | 'ADMIN'            // single admin approval
  | 'CHAPTER_THEN_NATIONAL' // multi-level
  | 'PAYMENT_FIRST';   // pay before activation

export interface DraftChapter {
  id:    string;
  name:  string;
  level: 'REGION' | 'STATE' | 'LOCAL';
}

// Leadership structure: a single central body, or state chapters each with an
// appointed leader who may be mandated to approve members in their state.
export type StructureType = 'SINGLE' | 'STATEWIDE';

export interface DraftStateLeader {
  id:                string;
  state:             string;   // one of the 36 states + FCT
  leaderName:        string;
  leaderContact:     string;   // phone / email (optional)
  canApproveMembers: boolean;  // mandate to act & approve members in this state
}

export interface DraftCategory {
  id:        string;
  label:     string;
  duesKobo:  number;
  cadence:   DuesCadence;
}

export interface DraftCommittee {
  id:   string;
  name: string;
}

export interface RestrictionConfig {
  graceDays:        number;
  disableVoting:    boolean;
  disableEvents:    boolean;
  disableChat:      boolean;
  disableCard:      boolean;
}

export interface OrgDraft {
  name:        string;
  acronym:     string;          // optional
  category:    string;
  description: string;
  location:    string;          // optional — e.g. "Lagos, Nigeria"
  website:     string;          // optional — e.g. "https://nma.org.ng"
  /**
   * Founded year, held as the raw text the founder typed so the field can be
   * partially entered without the store fighting the keyboard. Converted to a
   * number at publish; the server rejects anything outside 1800→this year.
   */
  foundedYear: string;          // REQUIRED
  /**
   * Logo, REQUIRED. Holds the value that is SUBMITTED: either a pasted URL or,
   * for a picked image, the R2 object key returned by the upload. Never a
   * device-local file:// URI — that was the old behaviour, and it stored a
   * path that resolved on the founder's phone and nowhere else.
   */
  logoUri:     string | null;
  /**
   * Local file URI of a just-picked image, for preview only. Never submitted.
   * The uploaded object is not publicly fetchable (the backend signs it on
   * read), so without this the founder would upload a logo and then see an
   * empty badge for the rest of the wizard.
   */
  logoPreviewUri: string | null;
  groupType:   GroupType | null;
  approvalRule: ApprovalRule | null;
  registrationFeeKobo: number;
  structureType: StructureType;      // single central body vs state chapters
  stateLeaders: DraftStateLeader[];
  chapters:    DraftChapter[];
  committees:  DraftCommittee[];
  categories:  DraftCategory[];
  rules:       string[];             // group rules an applicant must accept
  restrictions: RestrictionConfig;
  acceptedTerms: boolean;
}

export interface PublishResult {
  organisationId: string;
  name: string;
}

export interface EmergencyContact { name: string; phone: string }
export interface NextOfKin { name: string; relationship: string; phone: string }

export interface MyProfile {
  fullName:    string;
  memberId:    string;
  photoUrl:    string | null;
  email:       string;
  phone:       string;
  profession:  string;
  location:    string;
  dob:         string | null;        // ISO date, optional
  bio:         string;
  emergency:   EmergencyContact;
  nextOfKin:   NextOfKin;
  categoryLabel: string;
  chapterName: string | null;
}

/** Editable subset submitted from the edit screen. */
export interface ProfileEdit {
  fullName:   string;
  phone:      string;
  email:      string;
  profession: string;
  location:   string;
  dob:        string | null;
  bio:        string;
  emergency:  EmergencyContact;
  nextOfKin:  NextOfKin;
  photoUrl:   string | null;
}

export interface PrivacySettings {
  showPhone:       boolean;
  showEmail:       boolean;
  showInDirectory: boolean;
  showProfession:  boolean;
}

export interface CompletionItem { key: string; label: string; done: boolean }

export interface ProfileCompletion {
  percent: number;          // 0-100
  items:   CompletionItem[];
}

export type ActivityType = 'payment' | 'meeting' | 'task' | 'document' | 'membership' | 'profile';

export interface ActivityEntry {
  id:    string;
  type:  ActivityType;
  text:  string;
  at:    string;            // ISO
}

export interface NotificationPrefs {
  announcements: boolean;
  duesReminders: boolean;
  meetings:      boolean;
  tasks:         boolean;
  chat:          boolean;
  events:        boolean;
}

export interface SecuritySettings {
  biometricEnabled: boolean;
  twoFactorEnabled: boolean;
}

export type ThemePref = 'LIGHT' | 'DARK' | 'SYSTEM';

export interface Preferences {
  language: string;   // e.g. 'English'
  theme:    ThemePref;
}

export const LANGUAGE_OPTIONS = ['English', 'Hausa', 'Yoruba', 'Igbo', 'French', 'Pidgin'];

export interface Device {
  id:        string;
  name:      string;          // "iPhone 14 Pro"
  platform:  string;          // "iOS 18.2"
  lastActive: string;         // ISO
  current:   boolean;
  location:  string | null;
}

export interface FaqItem { id: string; question: string; answer: string }

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
export type TicketCategory = 'MEMBERSHIP' | 'PAYMENT' | 'TECHNICAL' | 'OTHER';

export interface TicketMessage {
  id:       string;
  author:   string;
  fromSupport: boolean;
  body:     string;
  createdAt: string;
}

export interface SupportTicketSummary {
  id:        string;
  subject:   string;
  category:  TicketCategory;
  status:    TicketStatus;
  updatedAt: string;
}

export interface SupportTicket extends SupportTicketSummary {
  messages: TicketMessage[];
}

export interface CreateTicketInput {
  subject:  string;
  category: TicketCategory;
  message:  string;
}

// ── Association — AI note-taking type contract (L) ────────────────────────────
// AI assists, humans approve. Minutes are not final until approved (PRD §17.5).
// IRON RULE: monetary amounts are integers in minor units (kobo).

export type AiNoteSource = 'RECORD' | 'AUDIO' | 'VIDEO' | 'TRANSCRIPT';

export type AiNoteStatus =
  | 'PROCESSING'   // transcription/extraction running
  | 'READY'        // AI output ready for human review
  | 'APPROVED'     // secretary/chair approved (not yet published)
  | 'PUBLISHED'    // minutes published to members
  | 'FAILED';

export interface AiNoteSummary {
  id:           string;
  meetingTitle: string;
  status:       AiNoteStatus;
  source:       AiNoteSource;
  createdAt:    string;        // ISO
  durationLabel: string;       // "1h 12m"
}

export interface AiDecision { id: string; text: string }

export interface AiActionItem {
  id:        string;
  title:     string;
  owner:     string;
  dueLabel:  string;           // "in 7 days" / "no date"
  convertedTaskId: string | null;
}

export interface AiFinancialCommitment {
  id:        string;
  label:     string;
  amountKobo: number;
}

export interface AiAttendee { id: string; name: string; present: boolean }

export interface AiNote extends AiNoteSummary {
  summary:      string;        // editable executive summary
  minutes:      string;        // full minutes (markdown-ish plain text)
  /** All collections are optional: a PROCESSING note carries none of them. */
  decisions?:   AiDecision[];
  actionItems?: AiActionItem[];
  unresolved?:  string[];
  financialCommitments?: AiFinancialCommitment[];
  attendees?:   AiAttendee[];
  transcriptPreview?: string;
  meetingId:    string | null;
}

export interface CreateAiNoteInput {
  source:       AiNoteSource;
  meetingTitle: string;
  meetingId?:   string | null;
}

export type ChatScope =
  | 'ORG'           // organisation-wide
  | 'CHAPTER'
  | 'STATE'
  | 'COMMITTEE'
  | 'EXECUTIVE'
  | 'EVENT'
  | 'TASK'
  | 'MEETING'
  | 'DIRECT'        // one-to-one
  | 'ANNOUNCEMENT'; // announcement-only (read-only feed)

/** Why a member can't post into a thread (null = can post). */
export type ChatPostingBlock =
  | 'ANNOUNCEMENT_ONLY'   // read-only channel
  | 'ROLE_RESTRICTED'     // exec-only etc.
  | 'PAYMENT_RESTRICTED'  // unpaid dues gate
  | 'ARCHIVED'
  | null;

export interface ChatThreadSummary {
  id:          string;
  title:       string;
  scope:       ChatScope;
  lastMessage: string;
  lastAt:      string;        // ISO
  unreadCount: number;
  muted:       boolean;
  memberCount: number;        // 0 for DIRECT
  postingBlock: ChatPostingBlock;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  mine:  boolean;
}

export interface ChatMessage {
  id:        string;
  threadId:  string;
  authorId:  string;
  authorName: string;
  authorRole: string | null;  // "Secretary" etc., shown in group chats
  body:      string;
  imageUrl:  string | null;   // attachment (image)
  createdAt: string;          // ISO
  mine:      boolean;
  system:    boolean;         // system/notice line, centered
  pinned:    boolean;
  /** Optional: the live DTO omits the array entirely when there are none. */
  reactions?: MessageReaction[];
}

export interface ChatThread extends ChatThreadSummary {
  description: string | null;
  messages:    ChatMessage[];
}

// IRON RULE: monetary amounts are integers in minor units (kobo).

export type CommitteeJoinStatus = 'NONE' | 'PENDING' | 'MEMBER';

export interface CommitteeSummary {
  id:          string;
  name:        string;
  purpose:     string;
  memberCount: number;
  joinStatus:  CommitteeJoinStatus;
  myRole:      string | null;     // "Member" | "Chairperson" | "Secretary"
}

/**
 * A committee member as rendered by the app.
 *
 * The Go DTO and the mock fixtures disagree on the field names: the mock sends
 * `name`, the live DTO sends `fullName` (plus `membershipId`). Both shapes are
 * accepted here and normalised at the render site rather than crashing on the
 * one that happens to be missing.
 */
export interface CommitteeMember {
  id:        string;
  name?:     string;
  fullName?: string;              // live DTO
  membershipId?: string;          // live DTO
  role?:     string;              // "Chairperson" | "Secretary" | "Member"
  /**
   * PENDING while a join request is unanswered, ACTIVE once accepted. The live
   * DTO has always carried it; it had no field here, so a request awaiting a
   * decision rendered exactly like a full member.
   */
  status?:   'PENDING' | 'ACTIVE' | string;
  photoUrl?: string | null;
}

export interface Committee extends CommitteeSummary {
  description:  string;
  chair?:       string;
  secretary?:   string;
  members?:     CommitteeMember[];
  meetingsCount?: number;
  tasksCount?:  number;
  docsCount?:   number;
  chatThreadId?: string | null;
}

export type EventState = 'UPCOMING' | 'PAST';
export type EventRsvp = 'GOING' | 'NOT_GOING' | null;

export interface EventSummary {
  id:        string;
  title:     string;
  startsAt:  string;          // ISO
  location:  string;
  state:     EventState;
  paid:      boolean;
  feeKobo:   number;          // 0 when free
  registered: boolean;
  rsvp:      EventRsvp;
  coverUrl:  string | null;
  /**
   * True when this member was explicitly invited rather than finding the event
   * in the list. Invitation and RSVP live on the same registration row, so being
   * invited says nothing about whether they have responded.
   */
  invited?:  boolean;
}

/**
 * Outcome of `POST /events/:id/register`.
 *
 * A PAID event no longer hands back a free ticket. It raises an invoice and
 * returns `registered: false`, `paymentRequired: true` and the `invoiceId` to
 * settle; `ticketCode` stays null until that invoice is PAID. A FREE event
 * still registers immediately and issues the ticket on the spot.
 */
export interface EventRegistrationResult {
  ok:              boolean;
  registered:      boolean;
  paymentRequired: boolean;
  ticketCode:      string | null;
  invoiceId:       string | null;
  /** Integer minor units (kobo); 0 for a free event. */
  amountKobo:      number;
}

export interface Event extends EventSummary {
  description:  string;
  endsAt:       string | null;
  organiser:    string;
  attendeeCount: number;
  capacity:     number | null;
  documents?:   { id: string; name: string }[];
  ticketCode?:  string;          // QR payload once registered
  checkedIn:    boolean;
  feedbackSubmitted: boolean;
}

export type AdminRole =
  | 'NONE'
  | 'CHAPTER_ADMIN'
  | 'FINANCE_ADMIN'
  | 'SECRETARY'
  | 'NATIONAL_ADMIN'
  | 'SUPER_ADMIN';

export interface AdminAccess {
  isAdmin:      boolean;
  role:         AdminRole;
  roleLabel:    string;
  jurisdiction: 'CHAPTER' | 'NATIONAL' | 'GLOBAL';
  /**
   * The organisation this admin administers, when the DTO reports it. Every
   * org-scoped admin call is scoped with this — the client never guesses an
   * org id.
   */
  organisationId?: string | null;
  /** Display name for that organisation, when the DTO reports it. */
  organisationName?: string | null;
  /** Coarse capability flags the UI gates on. */
  can: {
    approveMembers: boolean;
    manageMembers:  boolean;     // suspend/restore/transfer/assign-role
    manageFinance:  boolean;
    importMembers:  boolean;
    /**
     * Committee LIFECYCLE — create, rename, delete. Narrower than
     * manageMembers on purpose: running a committee's roster stays with
     * manageMembers so a chapter admin can do the day-to-day work, while
     * creating or destroying a committee is the organisation owner's call.
     * Older backends omit this; treat a missing value as false.
     */
    manageCommittees?: boolean;
  };
}

export type MemberAdminAction = 'SUSPEND' | 'RESTORE' | 'TRANSFER' | 'ASSIGN_ROLE';

export interface MemberActionResult {
  ok: true;
}

/** Roles that can be assigned to a member from the admin member screen. */
export const ASSIGNABLE_ROLES: { value: AdminRole; label: string }[] = [
  { value: 'NONE', label: 'Member (no admin role)' },
  { value: 'SECRETARY', label: 'Secretary' },
  { value: 'FINANCE_ADMIN', label: 'Finance admin' },
  { value: 'CHAPTER_ADMIN', label: 'Chapter admin' },
];

// IRON RULE: monetary amounts are integers in minor units (kobo).

export interface AdminKpis {
  totalMembers:     number;
  activeMembers:    number;
  pendingApprovals: number;
  unpaidMembers:    number;
  duesCollectedKobo: number;
  duesOutstandingKobo: number;
}

export type ApplicationJurisdiction = 'CHAPTER' | 'NATIONAL';
export type ApplicationReviewStatus = 'PENDING' | 'INFO_REQUESTED';
export type ApprovalDecision = 'APPROVE' | 'REJECT' | 'REQUEST_INFO';

export interface ApplicationDoc { id: string; name: string; verified: boolean }

export interface AdminApplicationSummary {
  id:           string;
  applicantName: string;
  category:     string;
  chapter:      string;
  submittedAt:  string;        // ISO
  status:       ApplicationReviewStatus;
  jurisdiction: ApplicationJurisdiction;
  paid:         boolean;
}

export interface AdminApplication extends AdminApplicationSummary {
  email:     string;
  phone:     string;
  profession: string;
  sponsor:   string | null;
  /** Optional: the live DTO omits it while document capture is being built. */
  documents?: ApplicationDoc[];
  registrationFeeKobo: number;
  /**
   * Hours left on the review SLA; negative when breached.
   * Optional because the live DTO does not always compute it — rendering
   * `undefined` here produced a literal "NaNh left to review".
   */
  slaHoursLeft?: number;
}

export interface RevenueLine { label: string; amountKobo: number }

export interface FinanceSummary {
  collectedKobo:   number;
  outstandingKobo: number;
  paidMembers:     number;
  unpaidMembers:   number;
  /** Optional: the live DTO omits the breakdowns until reporting is wired. */
  byChapter?:      RevenueLine[];
  byCategory?:     RevenueLine[];
  offlinePending:  number;
}

export type OfflineStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface OfflinePayment {
  id:          string;
  memberName:  string;
  memberId:    string;
  amountKobo:  number;
  method:      string;          // "Bank transfer" | "Cash"
  reference:   string;
  forItem:     string;          // "2026 Annual dues"
  submittedAt: string;          // ISO
  status:      OfflineStatus;
}

export type ImportIssue = null | 'duplicate' | 'invalid_phone' | 'invalid_email' | 'missing_field';

export interface ImportRow {
  rowNum: number;
  name:   string;
  phone:  string;
  email:  string;
  chapter: string;
  issue:  ImportIssue;
}

export interface ImportPreview {
  fileName:   string;
  total:      number;
  valid:      number;
  duplicates: number;
  invalid:    number;
  rows:       ImportRow[];
}

export interface ImportResult {
  imported:  number;
  skipped:   number;
  invited:   number;
  batchId:   string;
}

export type AuditAction =
  | 'APPROVAL_DECISION'
  | 'MEMBER_SUSPEND'
  | 'MEMBER_RESTORE'
  | 'MEMBER_TRANSFER'
  | 'ROLE_ASSIGN'
  | 'OFFLINE_PAYMENT'
  | 'DUES_PAY'
  | 'IMPORT'
  | 'ANNOUNCEMENT'
  | 'MINUTES_PUBLISH';

export interface AuditEntry {
  id:          string;
  action:      AuditAction;
  actorName:   string;
  summary:     string;       // human-readable line
  subject:     string | null;
  at:          string;       // ISO
}

// Announcements, Notifications, Meetings, Tasks, Documents.
// IRON RULE: any monetary amount is an integer in minor units (kobo).

export interface AnnouncementAttachment {
  id:    string;
  name:  string;
  sizeLabel: string;        // "240 KB"
  kind:  'pdf' | 'image' | 'doc' | 'other';
}

export interface AnnouncementSummary {
  id:        string;
  title:     string;
  preview:   string;
  audience:  string;          // "All members · Lagos Chapter"
  postedAt:  string;          // ISO
  author:    string;
  urgent:    boolean;
  read:      boolean;
  requiresAck: boolean;
  acknowledged: boolean;
}

export interface Announcement extends AnnouncementSummary {
  body:        string;
  /** Optional: absent from the live DTO until attachments are wired. */
  attachments?: AnnouncementAttachment[];
  /** Optional: read receipts are not returned by every deployment. */
  readCount?:   number;
  totalRecipients?: number;
}

export type NotificationKind =
  | 'membership'
  | 'payment'
  | 'meeting'
  | 'task'
  | 'announcement'
  | 'document'
  | 'admin';

export interface AppNotification {
  id:       string;
  kind:     NotificationKind;
  title:    string;
  body:     string;
  createdAt: string;          // ISO
  read:     boolean;
  route:    string | null;    // deep link target
}

export type MeetingMode = 'PHYSICAL' | 'VIRTUAL' | 'HYBRID';
export type RsvpStatus = 'YES' | 'NO' | 'MAYBE' | null;
export type MeetingState = 'UPCOMING' | 'LIVE' | 'PAST' | 'CANCELLED';

/**
 * Whether a meeting is on the organisation's calendar.
 *
 * A member's proposal starts PENDING and is visible only to them until an admin
 * decides; an admin scheduling a meeting gets APPROVED on insert. Distinct from
 * MeetingState, which is lifecycle (upcoming/live/past/cancelled) — a proposal
 * awaiting approval is still UPCOMING.
 */
export type MeetingApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface MeetingSummary {
  id:        string;
  title:     string;
  mode:      MeetingMode;
  startsAt:  string;          // ISO
  endsAt:    string | null;
  location:  string | null;   // physical address or join label
  state:     MeetingState;
  rsvp:      RsvpStatus;
  attendeeCount: number;
  approvalStatus?: MeetingApprovalStatus;
}

/** A member's meeting proposal, as the client submits it. */
export interface MeetingProposalInput {
  title:       string;
  description?: string | null;
  mode:        MeetingMode;
  startsAt:    string;        // ISO
  endsAt?:     string | null;
  location?:   string | null;
  agenda?:     string[];
}

export interface MeetingProposalResult {
  id: string;
  approvalStatus: MeetingApprovalStatus;
}

/** One row of the admin approval queue. */
export interface PendingMeeting {
  id:             string;
  title:          string;
  mode:           MeetingMode;
  startsAt:       string;
  endsAt:         string | null;
  location:       string | null;
  proposedByName: string;
  proposedAt:     string;
}

export interface AgendaItem { id: string; order: number; title: string; durationMin: number | null }

export interface Meeting extends MeetingSummary {
  description: string;
  agenda?:     AgendaItem[];
  documents?:  { id: string; name: string }[];
  checkedIn:   boolean;
  minutesPublished?: boolean;
  /** QR payload for check-in. Absent until the meeting opens for attendance. */
  attendanceCode?: string;
}

export type TaskStatus =
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'AWAITING_REVIEW'
  | 'COMPLETED'
  | 'OVERDUE';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ChecklistItem { id: string; label: string; done: boolean }

export interface TaskSummary {
  id:        string;
  title:     string;
  status:    TaskStatus;
  priority:  TaskPriority;
  dueDate:   string | null;   // ISO
  assigneeName: string;
  committee: string | null;
  /**
   * Derived server-side from dueDate — NOT read from `status`. The backend has
   * an OVERDUE status value that nothing writes, so a late task still reports
   * ASSIGNED; this is the field to trust.
   */
  overdue?: boolean;
}

export interface TaskComment { id: string; author: string; body: string; createdAt: string }

export interface Task extends TaskSummary {
  description: string;
  checklist?:  ChecklistItem[];
  comments?:   TaskComment[];
  createdBy:   string;
  meetingId:   string | null;  // links back to meeting minutes
  meetingTitle?: string | null;
}

/**
 * Which tasks to list. Everything but 'org' is filtered to the caller's own
 * assignments; 'org' is the admin-only tracking view over the whole
 * organisation, including tasks assigned to nobody and work already closed.
 */
export type TaskScope = 'mine' | 'assigned' | 'overdue' | 'completed' | 'org';

export type DocCategory =
  | 'constitution'
  | 'minutes'
  | 'financial'
  | 'reports'
  | 'certificates'
  | 'policy';

export interface DocumentSummary {
  id:        string;
  title:     string;
  category:  DocCategory;
  kind:      'pdf' | 'image' | 'doc';
  sizeLabel: string;
  updatedAt: string;          // ISO
  restricted: boolean;        // access-gated for this member
  requiresAck: boolean;
  acknowledged: boolean;
}

export interface DocumentDetail extends DocumentSummary {
  description?: string | null;
  version:      string;        // "v3"
  versionHistory?: { version: string; date: string; note: string }[];
  aiSummary?:   string | null;
  uploadedBy?:  string;
}
