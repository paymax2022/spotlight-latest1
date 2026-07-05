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
  if (USE_MOCK) { await delay(); return { ok: true }; }
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
  if (USE_MOCK) { await delay(150); return { ok: true }; }
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

export async function getMeeting(id: string): Promise<Meeting> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_MEETINGS.find((m) => m.id === id);
    if (!found) throw new Error('Meeting not found');
    return found;
  }
  const { data } = await api.get(`${BASE}/meetings/${id}`);
  return data;
}

export async function rsvpMeeting(id: string, status: RsvpStatus): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  const { data } = await api.post(`${BASE}/meetings/${id}/rsvp`, { status });
  return data;
}

export async function checkInMeeting(id: string): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
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
  if (USE_MOCK) { await delay(); return { ok: true }; }
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
  if (USE_MOCK) { await delay(); return { ok: true }; }
  const { data } = await api.post(`${BASE}/documents/${id}/acknowledge`, {}, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}
