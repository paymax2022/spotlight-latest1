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

export interface CommitteeMember {
  id:    string;
  name:  string;
  role:  string;                  // "Chairperson" | "Secretary" | "Member"
  photoUrl: string | null;
}

export interface Committee extends CommitteeSummary {
  description:  string;
  chair:        string;
  secretary:    string;
  members:      CommitteeMember[];
  meetingsCount: number;
  tasksCount:   number;
  docsCount:    number;
  chatThreadId: string | null;
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
  documents:    { id: string; name: string }[];
  ticketCode:   string;          // QR payload once registered
  checkedIn:    boolean;
  feedbackSubmitted: boolean;
}
