// ── Association — Engagement type contract ────────────────────────────────────
// Announcements, Notifications, Meetings, Tasks, Documents.
// IRON RULE: any monetary amount is an integer in minor units (kobo).

// ─── Announcements (J) ────────────────────────────────────────────────────────

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

// ─── Notifications (X) ────────────────────────────────────────────────────────

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

// ─── Meetings (K) ─────────────────────────────────────────────────────────────

export type MeetingMode = 'PHYSICAL' | 'VIRTUAL' | 'HYBRID';
export type RsvpStatus = 'YES' | 'NO' | 'MAYBE' | null;
export type MeetingState = 'UPCOMING' | 'LIVE' | 'PAST' | 'CANCELLED';

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

// ─── Tasks (M) ────────────────────────────────────────────────────────────────

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

export type TaskScope = 'mine' | 'assigned' | 'overdue' | 'completed';

// ─── Documents (P) ────────────────────────────────────────────────────────────

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
