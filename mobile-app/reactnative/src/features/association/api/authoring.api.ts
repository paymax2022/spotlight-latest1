// ── Association — Admin content-authoring API wrapper ─────────────────────────
//
// Kept OUT of admin.api.ts on purpose: that file is the admin-lite read/approve
// surface (KPIs, approvals, finance, import, audit). This one is the WRITE side
// for the content tables — announcements, meetings, documents, events, tasks —
// plus the dues run that feeds the money path and the device registration that
// makes the devices screen non-empty.
//
// Every admin call is scoped by the organisation id from `getMyAdminAccess()`
// (`organisationId`). The client never guesses an org id.
//
// IRON RULE: `feeKobo` / `totalKobo` are INTEGER minor units end to end.

import { api } from '@/api/client';
import { USE_MOCK, ASSOCIATION_API_BASE as BASE } from '../constants/association.constants';
import type {
  AdminContentRow, AdminListParams, AnnouncementInput, CreatedId, DeviceInput,
  DocumentInput, DuesRunInput, DuesRunResult, EventInput, MeetingInput,
  OrgPickerLists, TaskInput,
} from '../types/authoring.types';
import type { MemberProfileSummary } from '../types/association.types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

/**
 * Session-scoped store backing the mock branch.
 *
 * Without it the authoring screens would be dead in mock mode: there are no
 * fixtures for admin listings, and returning a fabricated success while the
 * list stayed empty would look exactly like a silently failing save.
 */
type MockKind = 'announcements' | 'meetings' | 'documents' | 'events' | 'tasks' | 'duesRuns';
const mockRows: Record<MockKind, AdminContentRow[]> = {
  announcements: [], meetings: [], documents: [], events: [], tasks: [], duesRuns: [],
};
const mockKeys = new Set<string>();

function mockCreate(kind: MockKind, title: string, subtitle: string, status: string, at: string | null, meta: Record<string, unknown>): CreatedId {
  const id = `mock_${kind}_${Date.now()}`;
  const now = new Date().toISOString();
  mockRows[kind].unshift({ id, title, subtitle, status, at: at ?? now, createdAt: now, meta });
  return { id };
}

function mockPatch(kind: MockKind, id: string, patch: Partial<AdminContentRow>): void {
  const row = mockRows[kind].find((r) => r.id === id);
  if (row) Object.assign(row, patch);
}

function mockDelete(kind: MockKind, id: string): void {
  mockRows[kind] = mockRows[kind].filter((r) => r.id !== id);
}

function listParams(p?: AdminListParams) {
  return { limit: p?.limit ?? 50, offset: p?.offset ?? 0 };
}

// ─── Announcements ────────────────────────────────────────────────────────────

export async function listAdminAnnouncements(orgId: string, p?: AdminListParams): Promise<AdminContentRow[]> {
  if (USE_MOCK) { await delay(); return mockRows.announcements; }
  const { data } = await api.get(`${BASE}/admin/organisations/${orgId}/announcements`, { params: listParams(p) });
  return data;
}

export async function createAnnouncement(orgId: string, input: AnnouncementInput): Promise<CreatedId> {
  if (USE_MOCK) {
    await delay(360);
    return mockCreate('announcements', input.title, input.audience ?? 'All members',
      input.urgent ? 'URGENT' : 'POSTED', null, { ...input });
  }
  const { data } = await api.post(`${BASE}/admin/organisations/${orgId}/announcements`, input);
  return data;
}

export async function updateAnnouncement(id: string, input: AnnouncementInput): Promise<void> {
  if (USE_MOCK) {
    await delay(320);
    mockPatch('announcements', id, { title: input.title, subtitle: input.audience ?? 'All members', status: input.urgent ? 'URGENT' : 'POSTED', meta: { ...input } });
    return;
  }
  await api.patch(`${BASE}/admin/announcements/${id}`, input);
}

export async function deleteAnnouncement(id: string): Promise<void> {
  if (USE_MOCK) { await delay(260); mockDelete('announcements', id); return; }
  await api.delete(`${BASE}/admin/announcements/${id}`);
}

// ─── Meetings ─────────────────────────────────────────────────────────────────

export async function listAdminMeetings(orgId: string, p?: AdminListParams): Promise<AdminContentRow[]> {
  if (USE_MOCK) { await delay(); return mockRows.meetings; }
  const { data } = await api.get(`${BASE}/admin/organisations/${orgId}/meetings`, { params: listParams(p) });
  return data;
}

export async function createMeeting(orgId: string, input: MeetingInput): Promise<CreatedId> {
  if (USE_MOCK) {
    await delay(360);
    return mockCreate('meetings', input.title, input.location ?? '', input.state, input.startsAt, { ...input });
  }
  const { data } = await api.post(`${BASE}/admin/organisations/${orgId}/meetings`, input);
  return data;
}

export async function updateMeeting(id: string, input: MeetingInput): Promise<void> {
  if (USE_MOCK) {
    await delay(320);
    mockPatch('meetings', id, { title: input.title, subtitle: input.location ?? '', status: input.state, at: input.startsAt, meta: { ...input } });
    return;
  }
  await api.patch(`${BASE}/admin/meetings/${id}`, input);
}

export async function deleteMeeting(id: string): Promise<void> {
  if (USE_MOCK) { await delay(260); mockDelete('meetings', id); return; }
  await api.delete(`${BASE}/admin/meetings/${id}`);
}

/** Publish (or retract) the minutes for a meeting. */
export async function publishMeetingMinutes(id: string, published: boolean): Promise<void> {
  if (USE_MOCK) {
    await delay(300);
    const row = mockRows.meetings.find((r) => r.id === id);
    if (row) row.meta = { ...row.meta, minutesPublished: published };
    return;
  }
  await api.post(`${BASE}/admin/meetings/${id}/minutes`, { published });
}

// ─── Documents ────────────────────────────────────────────────────────────────

export async function listAdminDocuments(orgId: string, p?: AdminListParams): Promise<AdminContentRow[]> {
  if (USE_MOCK) { await delay(); return mockRows.documents; }
  const { data } = await api.get(`${BASE}/admin/organisations/${orgId}/documents`, { params: listParams(p) });
  return data;
}

export async function createDocument(orgId: string, input: DocumentInput): Promise<CreatedId> {
  if (USE_MOCK) {
    await delay(360);
    return mockCreate('documents', input.title, input.category, input.restricted ? 'RESTRICTED' : 'OPEN', null, { ...input });
  }
  const { data } = await api.post(`${BASE}/admin/organisations/${orgId}/documents`, input);
  return data;
}

export async function updateDocument(id: string, input: DocumentInput): Promise<void> {
  if (USE_MOCK) {
    await delay(320);
    mockPatch('documents', id, { title: input.title, subtitle: input.category, status: input.restricted ? 'RESTRICTED' : 'OPEN', meta: { ...input } });
    return;
  }
  await api.patch(`${BASE}/admin/documents/${id}`, input);
}

export async function deleteDocument(id: string): Promise<void> {
  if (USE_MOCK) { await delay(260); mockDelete('documents', id); return; }
  await api.delete(`${BASE}/admin/documents/${id}`);
}

// ─── Events ───────────────────────────────────────────────────────────────────

export async function listAdminEvents(orgId: string, p?: AdminListParams): Promise<AdminContentRow[]> {
  if (USE_MOCK) { await delay(); return mockRows.events; }
  const { data } = await api.get(`${BASE}/admin/organisations/${orgId}/events`, { params: listParams(p) });
  return data;
}

export async function createEvent(orgId: string, input: EventInput): Promise<CreatedId> {
  if (USE_MOCK) {
    await delay(360);
    return mockCreate('events', input.title, input.location ?? '', 'UPCOMING', input.startsAt, { ...input });
  }
  const { data } = await api.post(`${BASE}/admin/organisations/${orgId}/events`, input);
  return data;
}

export async function updateEvent(id: string, input: EventInput): Promise<void> {
  if (USE_MOCK) {
    await delay(320);
    mockPatch('events', id, { title: input.title, subtitle: input.location ?? '', at: input.startsAt, meta: { ...input } });
    return;
  }
  await api.patch(`${BASE}/admin/events/${id}`, input);
}

export async function deleteEvent(id: string): Promise<void> {
  if (USE_MOCK) { await delay(260); mockDelete('events', id); return; }
  await api.delete(`${BASE}/admin/events/${id}`);
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function listAdminTasks(orgId: string, p?: AdminListParams): Promise<AdminContentRow[]> {
  if (USE_MOCK) { await delay(); return mockRows.tasks; }
  const { data } = await api.get(`${BASE}/admin/organisations/${orgId}/tasks`, { params: listParams(p) });
  return data;
}

export async function createTask(orgId: string, input: TaskInput): Promise<CreatedId> {
  if (USE_MOCK) {
    await delay(360);
    return mockCreate('tasks', input.title, '', input.status, input.dueDate ?? null, { ...input });
  }
  const { data } = await api.post(`${BASE}/admin/organisations/${orgId}/tasks`, input);
  return data;
}

export async function updateTask(id: string, input: TaskInput): Promise<void> {
  if (USE_MOCK) {
    await delay(320);
    mockPatch('tasks', id, { title: input.title, status: input.status, at: input.dueDate ?? null, meta: { ...input } });
    return;
  }
  await api.patch(`${BASE}/admin/tasks/${id}`, input);
}

export async function deleteTask(id: string): Promise<void> {
  if (USE_MOCK) { await delay(260); mockDelete('tasks', id); return; }
  await api.delete(`${BASE}/admin/tasks/${id}`);
}

// ─── Dues runs (money path) ───────────────────────────────────────────────────

export async function listAdminDuesRuns(orgId: string, p?: AdminListParams): Promise<AdminContentRow[]> {
  if (USE_MOCK) { await delay(); return mockRows.duesRuns; }
  const { data } = await api.get(`${BASE}/admin/organisations/${orgId}/dues/runs`, { params: listParams(p) });
  return data;
}

/**
 * Raise dues invoices for an organisation's roster.
 *
 * The Idempotency-Key is REQUIRED (the server 400s without one) and must be
 * supplied by the caller, not minted here: a key minted per HTTP attempt is
 * worthless, because a retry after a client-side timeout would carry a new key
 * and re-bill the entire roster. The dues-run screen mints one key when the
 * admin commits to the run and reuses it for every attempt, resetting only
 * after a run it accepts as final.
 *
 * A replayed key returns the ORIGINAL run's counts with `alreadyRaised: true`
 * and raises nothing.
 */
export async function runDues(orgId: string, input: DuesRunInput, idempotencyKey: string): Promise<DuesRunResult> {
  if (USE_MOCK) {
    await delay(500);
    if (mockKeys.has(idempotencyKey)) {
      const prior = mockRows.duesRuns[0];
      return {
        runId: prior?.id ?? 'mock_run',
        invoiced: Number(prior?.meta?.invoiced ?? 0),
        skipped: Number(prior?.meta?.skipped ?? 0),
        totalKobo: Number(prior?.meta?.totalKobo ?? 0),
        alreadyRaised: true,
      };
    }
    mockKeys.add(idempotencyKey);
    const result = { invoiced: 24, skipped: 3, totalKobo: 24 * 2_500_000 };
    const { id } = mockCreate('duesRuns', input.title, input.scope, 'RAISED', null, { ...input, ...result });
    return { runId: id, ...result, alreadyRaised: false };
  }
  const { data } = await api.post(
    `${BASE}/admin/organisations/${orgId}/dues/run`,
    input,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return data;
}

// ─── Supporting lookups for the authoring forms ───────────────────────────────

/**
 * The organisation's members, scoped by an explicit org.
 *
 * `GET /members` defaults to "organisations I hold an ACTIVE membership in",
 * which returns nothing for an admin who holds no membership of their own — so
 * the task assignee picker must pass `org_id` explicitly. The returned `id` IS
 * the membership id the task assignee field expects.
 */
export async function listOrgMembers(orgId: string, search?: string): Promise<MemberProfileSummary[]> {
  if (USE_MOCK) {
    const { getDirectory } = await import('./association.api');
    return getDirectory(search ? { search } : undefined);
  }
  const { data } = await api.get(`${BASE}/members`, {
    params: { org_id: orgId, ...(search?.trim() ? { search: search.trim() } : {}) },
  });
  return data;
}

/**
 * The organisation's chapters / committees / dues categories, used by the task
 * and dues-run pickers so the admin selects an id instead of typing a uuid.
 */
export async function getOrgPickerLists(orgId: string): Promise<OrgPickerLists> {
  if (USE_MOCK) {
    await delay();
    return { id: orgId, name: 'Demo organisation', chapters: [], committees: [], categories: [] };
  }
  const { data } = await api.get(`${BASE}/admin/organisations/${orgId}`);
  // Defensive: an older deployment can omit a collection entirely, and a picker
  // that maps over `undefined` takes the whole form down with it.
  return {
    id: data?.id ?? orgId,
    name: data?.name ?? '',
    chapters: data?.chapters ?? [],
    committees: data?.committees ?? [],
    categories: data?.categories ?? [],
  };
}

// ─── Devices (member self-service) ────────────────────────────────────────────

/**
 * Register the current device.
 *
 * Idempotent server-side on (user, name, platform): a repeat call touches
 * `last_active` instead of inserting a duplicate, so this is safe to fire on
 * every visit to the devices screen and needs no Idempotency-Key.
 */
export async function registerDevice(input: DeviceInput): Promise<CreatedId> {
  if (USE_MOCK) {
    const { registerMockDevice } = await import('./settings.api');
    return registerMockDevice(input);
  }
  const { data } = await api.post(`${BASE}/me/devices`, input);
  return data;
}
