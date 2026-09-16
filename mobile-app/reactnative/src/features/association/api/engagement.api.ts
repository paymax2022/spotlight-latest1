// ── Association — Engagement API wrapper ──────────────────────────────────────
// Mock-flagged data layer for announcements, notifications, meetings, tasks,
// documents. Mirrors association.api.ts. Flip USE_MOCK (constants) when real
// endpoints land.

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK, ASSOCIATION_API_BASE as BASE } from '../constants/association.constants';
import type {
  Announcement,
  AnnouncementSummary,
  AppNotification,
  Meeting,
  MeetingSummary,
  MeetingApprovalStatus,
  MeetingProposalInput,
  MeetingProposalResult,
  PendingMeeting,
  RsvpStatus,
  Task,
  TaskSummary,
  TaskScope,
  TaskStatus,
  DocumentSummary,
  DocumentDetail,
} from '../types/engagement.types';
import {
  MOCK_ANNOUNCEMENTS,
  MOCK_NOTIFICATIONS,
  MOCK_MEETINGS,
  MOCK_TASKS,
  MOCK_DOCUMENTS,
} from './engagement.mock';

const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// Every write below has a real live endpoint (verified against
// backend/internal/association/routes.go and a full green run of
// backend/tests/association), so fixture mode has nothing to add and refuses
// loudly instead of reporting a write it did not perform — mirrors
// frontend-admin's crowdfundingAdminService.ts NOT_IN_FIXTURE_MODE pattern.
const notInFixtureMode = (action: string) =>
  new Error(`${action} is unavailable in fixture mode: this app will not report a write it did not perform. Set EXPO_PUBLIC_ASSOCIATION_USE_MOCK=false to send this against the live backend.`);

// ─── Announcements ────────────────────────────────────────────────────────────

const toAnnSummary = (a: Announcement): AnnouncementSummary => {
  const { id, title, preview, audience, postedAt, author, urgent, read, requiresAck, acknowledged } = a;
  return { id, title, preview, audience, postedAt, author, urgent, read, requiresAck, acknowledged };
};

export async function getAnnouncements(): Promise<AnnouncementSummary[]> {
  if (USE_MOCK) { await delay(); return MOCK_ANNOUNCEMENTS.map(toAnnSummary); }
  const { data } = await api.get(`${BASE}/announcements`);
  return data;
}

export async function getAnnouncement(id: string): Promise<Announcement> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_ANNOUNCEMENTS.find((a) => a.id === id);
    if (!found) throw new Error('Announcement not found');
    return found;
  }
  const { data } = await api.get(`${BASE}/announcements/${id}`);
  return data;
}

export async function acknowledgeAnnouncement(id: string): Promise<{ ok: true }> {
  if (USE_MOCK) throw notInFixtureMode('Acknowledging an announcement');
  const { data } = await api.post(`${BASE}/announcements/${id}/acknowledge`, {}, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function getNotifications(): Promise<AppNotification[]> {
  if (USE_MOCK) { await delay(); return MOCK_NOTIFICATIONS; }
  const { data } = await api.get(`${BASE}/notifications`);
  return data;
}

export async function markNotificationsRead(): Promise<{ ok: true }> {
  if (USE_MOCK) throw notInFixtureMode('Marking notifications read');
  const { data } = await api.post(`${BASE}/notifications/read`, {});
  return data;
}

// ─── Meetings ─────────────────────────────────────────────────────────────────

const toMeetingSummary = (m: Meeting): MeetingSummary => {
  const { id, title, mode, startsAt, endsAt, location, state, rsvp, attendeeCount } = m;
  return { id, title, mode, startsAt, endsAt, location, state, rsvp, attendeeCount };
};

export async function getMeetings(): Promise<MeetingSummary[]> {
  if (USE_MOCK) { await delay(); return MOCK_MEETINGS.map(toMeetingSummary); }
  const { data } = await api.get(`${BASE}/meetings`);
  return data;
}

/**
 * The Go meeting-detail DTO names the caller's own RSVP `myRsvp`; the screens
 * read `rsvp`. Normalise at the seam so the UI keeps one field name. The list
 * DTO already carries `rsvp` and is left untouched.
 */
function normaliseMeeting(dto: (Meeting & { myRsvp?: RsvpStatus }) | null | undefined): Meeting {
  const raw = (dto ?? {}) as Meeting & { myRsvp?: RsvpStatus };
  const { myRsvp, ...rest } = raw;
  return { ...rest, rsvp: rest.rsvp ?? myRsvp ?? null } as Meeting;
}

export async function getMeeting(id: string): Promise<Meeting> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_MEETINGS.find((m) => m.id === id);
    if (!found) throw new Error('Meeting not found');
    return found;
  }
  const { data } = await api.get(`${BASE}/meetings/${id}`);
  return normaliseMeeting(data);
}

export async function rsvpMeeting(id: string, status: RsvpStatus): Promise<{ ok: true }> {
  if (USE_MOCK) throw notInFixtureMode('Submitting a meeting RSVP');
  const { data } = await api.post(`${BASE}/meetings/${id}/rsvp`, { status });
  return data;
}

/**
 * Put a meeting forward.
 *
 * The SERVER decides whether this schedules or queues: an admin's proposal is
 * approved on insert, a member's starts pending. The client cannot be the one
 * to decide that — it would only be guessing at the caller's role, and a client
 * that guessed "approved" would show a meeting on the calendar that nobody else
 * can see. Render the returned approvalStatus.
 */
export async function proposeMeeting(input: MeetingProposalInput): Promise<MeetingProposalResult> {
  if (USE_MOCK) throw notInFixtureMode('Proposing a meeting');
  const { data } = await api.post(`${BASE}/meetings`, input, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return (data?.data ?? data) as MeetingProposalResult;
}

/** The admin approval queue for an organisation. */
export async function getPendingMeetings(orgId: string): Promise<PendingMeeting[]> {
  if (USE_MOCK) { await delay(); return []; }
  const { data } = await api.get(`${BASE}/admin/organisations/${orgId}/meetings/pending`);
  return (data?.data ?? data ?? []) as PendingMeeting[];
}

/** Approve or reject a proposed meeting. Admins only; the server enforces it. */
export async function decideMeeting(id: string, approve: boolean, note?: string): Promise<MeetingApprovalStatus> {
  if (USE_MOCK) throw notInFixtureMode('Deciding a meeting proposal');
  const { data } = await api.post(`${BASE}/admin/meetings/${id}/decision`, { approve, note: note ?? '' });
  return ((data?.data ?? data)?.approvalStatus ?? (approve ? 'APPROVED' : 'REJECTED')) as MeetingApprovalStatus;
}

export async function checkInMeeting(id: string): Promise<{ ok: true }> {
  if (USE_MOCK) throw notInFixtureMode('Checking in to a meeting');
  const { data } = await api.post(`${BASE}/meetings/${id}/attendance`, {}, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

const toTaskSummary = (t: Task): TaskSummary => {
  const { id, title, status, priority, dueDate, assigneeName, committee } = t;
  return { id, title, status, priority, dueDate, assigneeName, committee };
};

export async function getTasks(scope: TaskScope = 'mine'): Promise<TaskSummary[]> {
  if (USE_MOCK) {
    await delay();
    let list = MOCK_TASKS;
    if (scope === 'overdue') list = list.filter((t) => t.status === 'OVERDUE');
    else if (scope === 'completed') list = list.filter((t) => t.status === 'COMPLETED');
    else if (scope === 'mine' || scope === 'assigned') list = list.filter((t) => t.status !== 'COMPLETED');
    return list.map(toTaskSummary);
  }
  const { data } = await api.get(`${BASE}/tasks`, { params: { scope } });
  return data;
}

export async function getTask(id: string): Promise<Task> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_TASKS.find((t) => t.id === id);
    if (!found) throw new Error('Task not found');
    return found;
  }
  const { data } = await api.get(`${BASE}/tasks/${id}`);
  return data;
}

export async function updateTaskStatus(id: string, status: TaskStatus): Promise<{ ok: true }> {
  if (USE_MOCK) throw notInFixtureMode('Updating a task status');
  const { data } = await api.patch(`${BASE}/tasks/${id}`, { status });
  return data;
}

// ─── Documents ────────────────────────────────────────────────────────────────

const toDocSummary = (d: DocumentDetail): DocumentSummary => {
  const { id, title, category, kind, sizeLabel, updatedAt, restricted, requiresAck, acknowledged } = d;
  return { id, title, category, kind, sizeLabel, updatedAt, restricted, requiresAck, acknowledged };
};

export async function getDocuments(): Promise<DocumentSummary[]> {
  if (USE_MOCK) { await delay(); return MOCK_DOCUMENTS.map(toDocSummary); }
  const { data } = await api.get(`${BASE}/documents`);
  return data;
}

export async function getDocument(id: string): Promise<DocumentDetail> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_DOCUMENTS.find((d) => d.id === id);
    if (!found) throw new Error('Document not found');
    return found;
  }
  const { data } = await api.get(`${BASE}/documents/${id}`);
  return data;
}

export async function acknowledgeDocument(id: string): Promise<{ ok: true }> {
  if (USE_MOCK) throw notInFixtureMode('Acknowledging a document');
  const { data } = await api.post(`${BASE}/documents/${id}/acknowledge`, {}, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}
