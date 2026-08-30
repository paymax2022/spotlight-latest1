// ── Association — Committees (N) & Events (O) type contract ───────────────────
// IRON RULE: monetary amounts are integers in minor units (kobo).

// ─── Committees (N) ───────────────────────────────────────────────────────────

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

// ─── Events (O) ───────────────────────────────────────────────────────────────

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
