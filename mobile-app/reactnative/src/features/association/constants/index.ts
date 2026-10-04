import type { AiNoteSource, AiNoteStatus, ApprovalRule, ChatPostingBlock, ChatScope, DocCategory, MeetingMode, NotificationKind, TaskPriority, TaskStatus, TicketCategory, TicketStatus } from '../types';
import type { DuesCadence, GroupType, InvoiceStatus, MemberStatus, PaymentStanding } from '../types/association.types';
import { mockAllowed } from '@/config/mockPolicy';
import { Colors } from '@/constants/tokens';


// ── Association — AI note-taking constants (L) ────────────────────────────────

export const AI_STATUS_STYLE: Record<AiNoteStatus, { label: string; color: string; bg: string }> = {
  PROCESSING: { label: 'Processing', color: Colors.secondary, bg: Colors.iconBgBlue },
  READY:      { label: 'Ready for review', color: Colors.onWarning, bg: Colors.iconBgGold },
  APPROVED:   { label: 'Approved', color: Colors.primary, bg: Colors.iconBgPurple },
  PUBLISHED:  { label: 'Published', color: Colors.teal, bg: Colors.iconBgTeal },
  FAILED:     { label: 'Failed', color: Colors.error, bg: Colors.errorContainer },
};

export const AI_SOURCE_META: Record<AiNoteSource, { label: string; icon: string }> = {
  RECORD:     { label: 'Record audio',     icon: 'Mic' },
  AUDIO:      { label: 'Upload audio',     icon: 'FileAudio' },
  VIDEO:      { label: 'Upload video',     icon: 'FileVideo' },
  TRANSCRIPT: { label: 'Upload transcript', icon: 'FileText' },
};

/** Review tab segments. */
export const AI_REVIEW_SEGMENTS = [
  { value: 'summary',   label: 'Summary' },
  { value: 'minutes',   label: 'Minutes' },
  { value: 'decisions', label: 'Decisions' },
  { value: 'actions',   label: 'Actions' },
  { value: 'people',    label: 'People' },
] as const;

/**
 * Mock-vs-live data source. Env-driven so the build can switch to the real
 * /associations endpoints without code changes — set
 *   EXPO_PUBLIC_ASSOCIATION_USE_MOCK=true
 * to force fixtures locally (default is LIVE).
 *
 * Migrated to defaultWhenUnset=false (mockPolicy.ts's own documented contract
 * for "modules whose live endpoints exist") now that the Go backend is
 * confirmed live and correct: a full green run of backend/tests/association
 * (96 live-DB tests covering money paths, IDOR scoping, elections, offline
 * payments, dues) plus every route in routes.go independently verified
 * against this module's API surface. A forgotten flag now fails visibly
 * against the real backend instead of silently serving fabricated data —
 * mirrors the same migration already done for insurance/merchant/registration/
 * voting once each of those was similarly confirmed live.
 *
 * Live endpoints are served under the API client's baseURL (see src/api/client.ts)
 * at the paths documented in contracts/associations.openapi.yaml.
 */
export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_ASSOCIATION_USE_MOCK, false);

/**
 * Live API base path for the association module.
 *
 * The Go backend mounts the association router under the finance group:
 *   finance := r.Group("/api/finance")
 *   association.RegisterRoutes(finance.Group("/associations"), h)
 * → every endpoint lives at `/api/finance/associations/...`.
 *
 * The shared axios client (`src/api/client.ts`) has baseURL = frontend-web
 * (http://localhost:3000 in dev), which proxies `/api/*` to the Go backend —
 * the same convention the wallet / mobility modules use (`/api/v1`, `/api/finance/...`).
 *
 * Every live path in this module's api/*.ts is built as `${ASSOCIATION_API_BASE}/...`.
 * Keep the mock branches (`if (USE_MOCK)`) intact as the offline fallback.
 */
export const ASSOCIATION_API_BASE = '/api/finance/associations';

export const GROUP_TYPE_LABEL: Record<GroupType, string> = {
  OPEN:        'Open · join instantly',
  CLOSED:      'Closed · approval required',
  INVITE_ONLY: 'Invite-only',
  CODE_BASED:  'Access code',
  PAID:        'Paid membership',
};

/** Status chip styling — pill text + 10% tint background per DESIGN-Mobile.md. */
export const MEMBER_STATUS_STYLE: Record<
  MemberStatus,
  { label: string; color: string; bg: string }
> = {
  ACTIVE:     { label: 'Active',     color: Colors.teal,      bg: Colors.iconBgTeal },
  PENDING:    { label: 'Pending',    color: Colors.onWarning, bg: Colors.iconBgGold },
  INACTIVE:   { label: 'Inactive',   color: Colors.outline,   bg: Colors.surfaceContainerHigh },
  SUSPENDED:  { label: 'Suspended',  color: Colors.error,     bg: Colors.errorContainer },
  EXPIRED:    { label: 'Expired',    color: Colors.error,     bg: Colors.errorContainer },
  RESTRICTED: { label: 'Restricted', color: Colors.onWarning, bg: Colors.iconBgGold },
};

export const PAYMENT_STANDING_STYLE: Record<
  PaymentStanding,
  { label: string; color: string; bg: string }
> = {
  PAID:    { label: 'Paid up',  color: Colors.teal,  bg: Colors.iconBgTeal },
  DUE:     { label: 'Due',      color: Colors.onWarning,  bg: Colors.iconBgGold },
  OVERDUE: { label: 'Overdue',  color: Colors.error, bg: Colors.errorContainer },
};

export const INVOICE_STATUS_STYLE: Record<
  InvoiceStatus,
  { label: string; color: string; bg: string }
> = {
  PAID:       { label: 'Paid',       color: Colors.teal,      bg: Colors.iconBgTeal },
  DUE:        { label: 'Due',        color: Colors.onWarning, bg: Colors.iconBgGold },
  OVERDUE:    { label: 'Overdue',    color: Colors.error,     bg: Colors.errorContainer },
  PROCESSING: { label: 'Processing', color: Colors.secondary, bg: Colors.iconBgBlue },
};

export const CADENCE_LABEL: Record<DuesCadence, string> = {
  ONE_OFF:   'One-off',
  MONTHLY:   '/month',
  QUARTERLY: '/quarter',
  ANNUAL:    '/year',
  LIFETIME:  'Lifetime',
};

/** Directory filter segments (status). */
export const DIRECTORY_STATUS_SEGMENTS = [
  { value: 'all',       label: 'All' },
  { value: 'ACTIVE',    label: 'Active' },
  { value: 'PENDING',   label: 'Pending' },
  { value: 'SUSPENDED', label: 'Suspended' },
] as const;

/** Dues filter segments. */
export const DUES_SEGMENTS = [
  { value: 'all',     label: 'All' },
  { value: 'DUE',     label: 'Outstanding' },
  { value: 'PAID',    label: 'Paid' },
] as const;

/** Lucide icon name per chat scope (rendered via dynamic Icons lookup). */
export const CHAT_SCOPE_ICON: Record<ChatScope, string> = {
  ORG:          'Building2',
  CHAPTER:      'MapPin',
  STATE:        'Map',
  COMMITTEE:    'Users',
  EXECUTIVE:    'ShieldCheck',
  EVENT:        'Ticket',
  TASK:         'ListTodo',
  MEETING:      'CalendarDays',
  DIRECT:       'User',
  ANNOUNCEMENT: 'Megaphone',
};

export const CHAT_SCOPE_LABEL: Record<ChatScope, string> = {
  ORG:          'Organisation',
  CHAPTER:      'Chapter',
  STATE:        'State',
  COMMITTEE:    'Committee',
  EXECUTIVE:    'Executive',
  EVENT:        'Event',
  TASK:         'Task',
  MEETING:      'Meeting',
  DIRECT:       'Direct',
  ANNOUNCEMENT: 'Announcements',
};

/** Member-facing reason a composer is disabled. */
export const POSTING_BLOCK_NOTICE: Record<Exclude<ChatPostingBlock, null>, string> = {
  ANNOUNCEMENT_ONLY:  'This is an announcement-only channel. Only admins can post.',
  ROLE_RESTRICTED:    'This channel is limited to authorised roles.',
  PAYMENT_RESTRICTED: 'Posting is disabled while your dues are outstanding. Pay to restore access.',
  ARCHIVED:           'This conversation has been archived.',
};

export const TASK_STATUS_STYLE: Record<TaskStatus, { label: string; color: string; bg: string }> = {
  ASSIGNED:        { label: 'Assigned',       color: Colors.secondary, bg: Colors.iconBgBlue },
  ACCEPTED:        { label: 'Accepted',       color: Colors.secondary, bg: Colors.iconBgBlue },
  IN_PROGRESS:     { label: 'In progress',    color: Colors.primary,   bg: Colors.iconBgPurple },
  BLOCKED:         { label: 'Blocked',        color: Colors.error,     bg: Colors.errorContainer },
  AWAITING_REVIEW: { label: 'Awaiting review',color: Colors.onWarning, bg: Colors.iconBgGold },
  COMPLETED:       { label: 'Completed',      color: Colors.teal,      bg: Colors.iconBgTeal },
  OVERDUE:         { label: 'Overdue',        color: Colors.error,     bg: Colors.errorContainer },
};

export const TASK_PRIORITY_STYLE: Record<TaskPriority, { label: string; color: string; bg: string }> = {
  LOW:    { label: 'Low',    color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  MEDIUM: { label: 'Medium', color: Colors.secondary,        bg: Colors.iconBgBlue },
  HIGH:   { label: 'High',   color: Colors.error,            bg: Colors.errorContainer },
};

export const MEETING_MODE_LABEL: Record<MeetingMode, string> = {
  PHYSICAL: 'In person',
  VIRTUAL:  'Virtual',
  HYBRID:   'Hybrid',
};

export const NOTIFICATION_ICON: Record<NotificationKind, string> = {
  membership:   'IdCard',
  payment:      'CreditCard',
  meeting:      'CalendarDays',
  task:         'ListTodo',
  announcement: 'Megaphone',
  document:     'FileText',
  admin:        'ShieldCheck',
};

export const DOC_CATEGORY_LABEL: Record<DocCategory, string> = {
  constitution: 'Constitution & bye-laws',
  minutes:      'Meeting minutes',
  financial:    'Financial reports',
  reports:      'Reports',
  certificates: 'Certificates',
  policy:       'Policies',
};

export const TASK_SEGMENTS = [
  { value: 'mine',      label: 'My tasks' },
  { value: 'overdue',   label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
] as const;

export const MEETING_SEGMENTS = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past',     label: 'Past' },
] as const;

export const DOC_SEGMENTS = [
  { value: 'all',          label: 'All' },
  { value: 'constitution', label: 'Governance' },
  { value: 'minutes',      label: 'Minutes' },
  { value: 'financial',    label: 'Finance' },
  { value: 'certificates', label: 'Certificates' },
  { value: 'policy',       label: 'Policies' },
] as const;

export const WIZARD_STEPS = ['Basics', 'Branding', 'Structure', 'Membership', 'Access', 'Review'] as const;

export const GROUP_TYPE_OPTIONS: { value: GroupType; label: string; help: string }[] = [
  { value: 'OPEN', label: 'Open', help: 'Anyone can join instantly.' },
  { value: 'CLOSED', label: 'Closed', help: 'Admin approval required.' },
  { value: 'INVITE_ONLY', label: 'Invite-only', help: 'Members join via invitation.' },
  { value: 'CODE_BASED', label: 'Access code', help: 'Members join with a code.' },
  { value: 'PAID', label: 'Paid', help: 'Payment required to activate.' },
];

export const APPROVAL_RULE_OPTIONS: { value: ApprovalRule; label: string; help: string }[] = [
  { value: 'AUTO', label: 'Auto-approve', help: 'No review — members are active immediately.' },
  { value: 'ADMIN', label: 'Admin approval', help: 'A single admin reviews each application.' },
  { value: 'CHAPTER_THEN_NATIONAL', label: 'Multi-level', help: 'Chapter admin approves, then national validates.' },
  { value: 'PAYMENT_FIRST', label: 'Payment first', help: 'Registration fee confirmed before activation.' },
];

export const CHAPTER_LEVEL_OPTIONS = ['REGION', 'STATE', 'LOCAL'] as const;
export const CADENCE_OPTIONS = ['ONE_OFF', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'LIFETIME'] as const;

// Leadership structure: one central body, or state chapters with appointed leaders.
export const STRUCTURE_TYPE_OPTIONS: { value: 'SINGLE' | 'STATEWIDE'; label: string; help: string }[] = [
  { value: 'SINGLE', label: 'Single structure', help: 'One central body. No state chapters or state leaders.' },
  { value: 'STATEWIDE', label: 'State chapters', help: 'Operate across states, each with an appointed state leader.' },
];

// Common group rules offered as a multi-select; admins can also add custom rules.
export const GROUP_RULE_OPTIONS = [
  'Members must keep their dues up to date.',
  'Respect all members and observe the code of conduct.',
  'One membership per person — no duplicate accounts.',
  'Attend general meetings and vote where eligible.',
  'No use of the platform for unauthorised solicitation.',
  'Comply with decisions of the executive council.',
  'Provide accurate identity and contact information.',
  'Give notice before withdrawing from the association.',
] as const;

// Common membership categories offered as a dropdown when adding a tier. The
// list is searchable; "Other" lets the admin enter a custom category name.
export const MEMBERSHIP_CATEGORY_OPTIONS = [
  'Full member',
  'Associate member',
  'Ordinary member',
  'Student member',
  'Graduate member',
  'Corporate member',
  'Executive member',
  'Honorary member',
  'Life member',
  'Patron',
  'Other',
] as const;

export const TICKET_STATUS_STYLE: Record<TicketStatus, { label: string; color: string; bg: string }> = {
  OPEN:        { label: 'Open',        color: Colors.onWarning, bg: Colors.iconBgGold },
  IN_PROGRESS: { label: 'In progress', color: Colors.secondary, bg: Colors.iconBgBlue },
  RESOLVED:    { label: 'Resolved',    color: Colors.teal,      bg: Colors.iconBgTeal },
};

export const TICKET_CATEGORY_LABEL: Record<TicketCategory, string> = {
  MEMBERSHIP: 'Membership',
  PAYMENT:    'Payment',
  TECHNICAL:  'Technical',
  OTHER:      'Other',
};

export const TICKET_CATEGORY_OPTIONS: TicketCategory[] = ['MEMBERSHIP', 'PAYMENT', 'TECHNICAL', 'OTHER'];
