// ── Association — Admin content-authoring contract ────────────────────────────
//
// Mirrors backend/internal/association/model_content.go. These are the WRITE
// bodies for the tables that used to have read endpoints and no writer at all
// (assoc_announcements / meetings / documents / events / tasks / dues_invoices
// / devices), plus the uniform admin listing row those org-scoped GETs return.
//
// IRON RULE: every *Kobo field is an INTEGER in minor units. Never a float,
// never a string carried into arithmetic.

import type { Chapter, MembershipCategory } from './association.types';
import type { DocCategory, MeetingMode, MeetingState, TaskPriority } from './engagement.types';

/** `POST` create responses are uniformly `{ id }` (HTTP 201). */
export interface CreatedId { id: string }

/**
 * One row of any admin content listing.
 *
 * The six org-scoped listings share this shape deliberately so a single list
 * screen renders all of them; type-specific detail lives in `meta`, which is
 * whatever `jsonb_build_object` the server chose for that content type.
 *
 * `at` / `createdAt` arrive as Postgres `::text` timestamps, which are NOT
 * always RFC3339 ("2026-08-29 19:08:00+00"), and either can be null. Never feed
 * them to `new Date()` directly — use `formatDateSafe` / `formatDateTimeSafe`.
 */
export interface AdminContentRow {
  id:        string;
  title:     string;
  subtitle:  string;
  status:    string;
  at:        string | null;
  createdAt: string | null;
  meta:      Record<string, unknown>;
}

export interface AdminListParams {
  limit?:  number;
  offset?: number;
}

/**
 * The slice of `GET /admin/organisations/:id` the authoring forms need: the
 * chapter / committee / dues-tier lists the pickers offer, so an admin picks a
 * name instead of pasting a uuid. Every other field of that DTO is deliberately
 * left out — this module does not edit the organisation itself.
 */
export interface OrgPickerLists {
  id:         string;
  name:       string;
  chapters:   Chapter[];
  committees: { id: string; name: string; memberCount?: number }[];
  categories: MembershipCategory[];
}

// ─── Announcements ────────────────────────────────────────────────────────────

export interface AnnouncementInput {
  title:        string;
  body?:        string | null;
  audience?:    string | null;
  urgent:       boolean;
  requiresAck:  boolean;
  /** Fans the announcement out to EVERY ACTIVE member. Create only. */
  notify?:      boolean;
}

// ─── Meetings ─────────────────────────────────────────────────────────────────

export interface MeetingInput {
  title:        string;
  description?: string | null;
  mode:         MeetingMode;
  /** RFC3339. */
  startsAt:     string;
  endsAt?:      string | null;
  location?:    string | null;
  state:        MeetingState;
  agenda:       string[];
  /** Issues a short check-in code members scan/enter at the meeting. */
  generateAttendanceCode?: boolean;
  notify?:      boolean;
}

// ─── Documents ────────────────────────────────────────────────────────────────

export type DocKind = 'pdf' | 'image' | 'doc';

export interface DocumentInput {
  title:        string;
  category:     DocCategory;
  kind:         DocKind;
  /** Object key of the already-uploaded file; the vault entry is metadata only. */
  storageKey?:  string | null;
  sizeLabel?:   string | null;
  version:      string;
  restricted:   boolean;
  requiresAck:  boolean;
  aiSummary?:   string | null;
  notify?:      boolean;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface EventInput {
  title:        string;
  description?: string | null;
  /** RFC3339. */
  startsAt:     string;
  endsAt?:      string | null;
  location?:    string | null;
  /** Paid REQUIRES feeKobo > 0; a free event REQUIRES feeKobo === 0. */
  paid:         boolean;
  feeKobo:      number;
  capacity?:    number | null;
  organiser?:   string | null;
  coverUrl?:    string | null;
  notify?:      boolean;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

/**
 * The admin authoring surface can set states the member-facing lifecycle never
 * produces (DRAFT / REJECTED / REOPENED / CANCELLED), so this is a superset of
 * `TaskStatus` in engagement.types rather than the same union.
 */
export type AdminTaskStatus =
  | 'DRAFT' | 'ASSIGNED' | 'ACCEPTED' | 'IN_PROGRESS' | 'BLOCKED'
  | 'AWAITING_REVIEW' | 'COMPLETED' | 'REJECTED' | 'REOPENED'
  | 'CANCELLED' | 'OVERDUE';

export interface TaskInput {
  title:        string;
  description?: string | null;
  status:       AdminTaskStatus;
  priority:     TaskPriority;
  /** RFC3339 or null. */
  dueDate?:     string | null;
  /** A MEMBERSHIP id in the same organisation — a foreign one is refused 403. */
  assigneeId?:  string | null;
  committeeId?: string | null;
  meetingId?:   string | null;
  checklist:    string[];
  /** Notifies the ASSIGNEE only (not the whole organisation). */
  notify?:      boolean;
}

// ─── Dues runs (money path) ───────────────────────────────────────────────────

export type InvoiceScope = 'NATIONAL' | 'STATE' | 'LOCAL' | 'COMMITTEE';

export interface DuesRunInput {
  title:       string;
  scope:       InvoiceScope;
  /** RFC3339 or null — an open-ended run raises invoices with no due date. */
  dueDate?:    string | null;
  /** Restrict the run to one dues tier; omit for every tier. */
  categoryId?: string | null;
  /** Restrict the run to one chapter. */
  chapterId?:  string | null;
  notify?:     boolean;
}

/**
 * What a dues run raised.
 *
 * `alreadyRaised` is the replay answer: the Idempotency-Key was seen before, so
 * the ORIGINAL run's numbers are echoed back and NOTHING new was billed. The UI
 * must say that plainly — reading these counts as fresh invoices would tell an
 * admin they had just billed a roster twice.
 */
export interface DuesRunResult {
  runId:         string;
  invoiced:      number;
  skipped:       number;
  totalKobo:     number;
  alreadyRaised: boolean;
}

// ─── Devices (member self-service) ────────────────────────────────────────────

export interface DeviceInput {
  name:      string;
  platform:  string;
  location?: string | null;
}

// ─── Option tables for the authoring forms ────────────────────────────────────
// Kept in lockstep with the backend's validation maps (service_content.go).

export const MEETING_MODE_OPTIONS: { value: MeetingMode; label: string }[] = [
  { value: 'PHYSICAL', label: 'In person' },
  { value: 'VIRTUAL',  label: 'Virtual' },
  { value: 'HYBRID',   label: 'Hybrid' },
];

export const MEETING_STATE_OPTIONS: { value: MeetingState; label: string }[] = [
  { value: 'UPCOMING',  label: 'Upcoming' },
  { value: 'LIVE',      label: 'Live' },
  { value: 'PAST',      label: 'Past' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const DOC_CATEGORY_OPTIONS: { value: DocCategory; label: string }[] = [
  { value: 'constitution',  label: 'Constitution' },
  { value: 'minutes',       label: 'Minutes' },
  { value: 'financial',     label: 'Financial' },
  { value: 'reports',       label: 'Reports' },
  { value: 'certificates',  label: 'Certificates' },
  { value: 'policy',        label: 'Policy' },
];

export const DOC_KIND_OPTIONS: { value: DocKind; label: string }[] = [
  { value: 'pdf',   label: 'PDF' },
  { value: 'doc',   label: 'Document' },
  { value: 'image', label: 'Image' },
];

export const TASK_STATUS_OPTIONS: { value: AdminTaskStatus; label: string }[] = [
  { value: 'DRAFT',           label: 'Draft' },
  { value: 'ASSIGNED',        label: 'Assigned' },
  { value: 'IN_PROGRESS',     label: 'In progress' },
  { value: 'BLOCKED',         label: 'Blocked' },
  { value: 'AWAITING_REVIEW', label: 'Awaiting review' },
  { value: 'COMPLETED',       label: 'Completed' },
  { value: 'CANCELLED',       label: 'Cancelled' },
];

export const TASK_PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'LOW',    label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH',   label: 'High' },
];

export const INVOICE_SCOPE_OPTIONS: { value: InvoiceScope; label: string }[] = [
  { value: 'NATIONAL',  label: 'National' },
  { value: 'STATE',     label: 'State' },
  { value: 'LOCAL',     label: 'Local' },
  { value: 'COMMITTEE', label: 'Committee' },
];
