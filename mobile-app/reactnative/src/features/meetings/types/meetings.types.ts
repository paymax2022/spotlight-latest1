// ── Estate Meetings — Type Contract (Block 30) ───────────────────────────────
export type MeetingMode = 'physical' | 'virtual' | 'hybrid';
export type MeetingStatus = 'scheduled' | 'live' | 'ended' | 'cancelled';
export type RsvpResponse = 'yes' | 'no' | 'maybe';

export interface RsvpCounts {
  yes: number;
  no: number;
  maybe: number;
}

export interface Meeting {
  id: string;
  estateId: string;
  title: string;
  agenda?: string;
  mode: MeetingMode;
  location?: string;
  startsAt: string;        // ISO
  endsAt?: string;         // ISO
  status: MeetingStatus;
  createdBy: string;
  createdByName?: string;
  createdAt: string;       // ISO
  myRsvp?: RsvpResponse | null;
  rsvpCounts: RsvpCounts;
}

export interface MeetingMinutes {
  meetingId: string;
  content: string;
  decisions: string[];
  updatedAt?: string;
}

export interface CreateMeetingInput {
  title: string;
  agenda?: string;
  mode: MeetingMode;
  location?: string;
  startsAt: string;        // ISO
  endsAt?: string;         // ISO
  idempotencyKey: string;
}

export interface RsvpInput {
  meetingId: string;
  response: RsvpResponse;
  idempotencyKey: string;
}
