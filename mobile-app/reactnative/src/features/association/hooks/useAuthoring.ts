// ── Association — Admin content-authoring hooks ───────────────────────────────

import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAdminAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  listAdminMeetings, createMeeting, updateMeeting, deleteMeeting, publishMeetingMinutes,
  listAdminDocuments, createDocument, updateDocument, deleteDocument,
  listAdminEvents, createEvent, updateEvent, deleteEvent,
  listAdminTasks, createTask, updateTask, deleteTask,
  listAdminDuesRuns, runDues,
  listOrgMembers, getOrgPickerLists, registerDevice,
} from '../api/authoring.api';
import { describeThisDevice } from '../utils/deviceIdentity';
import type {
  AnnouncementInput, DocumentInput, DuesRunInput, EventInput, MeetingInput, TaskInput,
} from '../types/authoring.types';

const KEY = 'association';

/** One listing kind — also the react-query cache segment. */
export type ContentKind = 'announcements' | 'meetings' | 'documents' | 'events' | 'tasks' | 'duesRuns';

const LISTERS = {
  announcements: listAdminAnnouncements,
  meetings:      listAdminMeetings,
  documents:     listAdminDocuments,
  events:        listAdminEvents,
  tasks:         listAdminTasks,
  duesRuns:      listAdminDuesRuns,
} as const;

/**
 * One org-scoped admin listing.
 *
 * Disabled until the org id is known: the id comes from `getMyAdminAccess()`,
 * and firing the request with `undefined` in the path would hit
 * `/admin/organisations/undefined/…` and report a confusing 4xx as if the
 * content were unavailable.
 */
export function useAdminContent(kind: ContentKind, orgId?: string | null) {
  return useQuery({
    queryKey: [KEY, 'adminContent', kind, orgId],
    queryFn: () => LISTERS[kind](orgId as string),
    enabled: Boolean(orgId),
    staleTime: 15_000,
  });
}

/**
 * One row of a listing, for the edit screens.
 *
 * There is no per-item admin GET — the listings carry every field an edit form
 * needs inside `meta` — so the row is read out of the listing the console
 * already fetched rather than inventing an endpoint that does not exist.
 */
export function useAdminContentRow(kind: ContentKind, orgId?: string | null, id?: string) {
  const list = useAdminContent(kind, orgId);
  return { ...list, row: list.data?.find((r) => r.id === id) ?? null };
}

/** Invalidate one listing plus the member-facing view it feeds. */
function useContentInvalidator(kind: ContentKind) {
  const qc = useQueryClient();
  const memberKey: Record<ContentKind, string | null> = {
    announcements: 'announcements',
    meetings:      'meetings',
    documents:     'documents',
    events:        'events',
    tasks:         'tasks',
    duesRuns:      'dues',
  };
  return () => {
    qc.invalidateQueries({ queryKey: [KEY, 'adminContent', kind] });
    const mk = memberKey[kind];
    if (mk) qc.invalidateQueries({ queryKey: [KEY, mk] });
    qc.invalidateQueries({ queryKey: [KEY, 'notifications'] });
  };
}

// ─── Announcements ────────────────────────────────────────────────────────────

export function useCreateAnnouncement(orgId?: string | null) {
  const invalidate = useContentInvalidator('announcements');
  return useMutation({
    mutationFn: (input: AnnouncementInput) => createAnnouncement(orgId as string, input),
    onSuccess: invalidate,
  });
}
export function useUpdateAnnouncement() {
  const invalidate = useContentInvalidator('announcements');
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AnnouncementInput }) => updateAnnouncement(id, input),
    onSuccess: invalidate,
  });
}
export function useDeleteAnnouncement() {
  const invalidate = useContentInvalidator('announcements');
  return useMutation({ mutationFn: (id: string) => deleteAnnouncement(id), onSuccess: invalidate });
}

// ─── Meetings ─────────────────────────────────────────────────────────────────

export function useCreateMeeting(orgId?: string | null) {
  const invalidate = useContentInvalidator('meetings');
  return useMutation({
    mutationFn: (input: MeetingInput) => createMeeting(orgId as string, input),
    onSuccess: invalidate,
  });
}
export function useUpdateMeeting() {
  const invalidate = useContentInvalidator('meetings');
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MeetingInput }) => updateMeeting(id, input),
    onSuccess: invalidate,
  });
}
export function useDeleteMeeting() {
  const invalidate = useContentInvalidator('meetings');
  return useMutation({ mutationFn: (id: string) => deleteMeeting(id), onSuccess: invalidate });
}
export function usePublishMinutes() {
  const invalidate = useContentInvalidator('meetings');
  return useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) => publishMeetingMinutes(id, published),
    onSuccess: invalidate,
  });
}

// ─── Documents ────────────────────────────────────────────────────────────────

export function useCreateDocument(orgId?: string | null) {
  const invalidate = useContentInvalidator('documents');
  return useMutation({
    mutationFn: (input: DocumentInput) => createDocument(orgId as string, input),
    onSuccess: invalidate,
  });
}
export function useUpdateDocument() {
  const invalidate = useContentInvalidator('documents');
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: DocumentInput }) => updateDocument(id, input),
    onSuccess: invalidate,
  });
}
export function useDeleteDocument() {
  const invalidate = useContentInvalidator('documents');
  return useMutation({ mutationFn: (id: string) => deleteDocument(id), onSuccess: invalidate });
}

// ─── Events ───────────────────────────────────────────────────────────────────

export function useCreateEvent(orgId?: string | null) {
  const invalidate = useContentInvalidator('events');
  return useMutation({
    mutationFn: (input: EventInput) => createEvent(orgId as string, input),
    onSuccess: invalidate,
  });
}
export function useUpdateEvent() {
  const invalidate = useContentInvalidator('events');
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: EventInput }) => updateEvent(id, input),
    onSuccess: invalidate,
  });
}
export function useDeleteEvent() {
  const invalidate = useContentInvalidator('events');
  return useMutation({ mutationFn: (id: string) => deleteEvent(id), onSuccess: invalidate });
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export function useCreateTask(orgId?: string | null) {
  const invalidate = useContentInvalidator('tasks');
  return useMutation({
    mutationFn: (input: TaskInput) => createTask(orgId as string, input),
    onSuccess: invalidate,
  });
}
export function useUpdateTask() {
  const invalidate = useContentInvalidator('tasks');
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaskInput }) => updateTask(id, input),
    onSuccess: invalidate,
  });
}
export function useDeleteTask() {
  const invalidate = useContentInvalidator('tasks');
  return useMutation({ mutationFn: (id: string) => deleteTask(id), onSuccess: invalidate });
}

// ─── Dues run (money path) ────────────────────────────────────────────────────

/**
 * Raise dues for a roster.
 *
 * The Idempotency-Key is a required argument rather than something this hook
 * mints, so a retry of the SAME intended run reuses the SAME key. A fresh key
 * per attempt is what would let a timed-out-but-committed run be billed twice.
 */
export function useRunDues(orgId?: string | null) {
  const invalidate = useContentInvalidator('duesRuns');
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: DuesRunInput; idempotencyKey: string }) =>
      runDues(orgId as string, input, idempotencyKey),
    onSuccess: () => {
      invalidate();
      // The run changes what the finance dashboard and the member dues screen
      // are looking at, not just the run list.
    },
  });
}

// ─── Pickers ──────────────────────────────────────────────────────────────────

export function useOrgMembers(orgId?: string | null, search?: string) {
  return useQuery({
    queryKey: [KEY, 'orgMembers', orgId, search ?? ''],
    queryFn: () => listOrgMembers(orgId as string, search),
    enabled: Boolean(orgId),
    staleTime: 60_000,
  });
}

export function useOrgPickerLists(orgId?: string | null) {
  return useQuery({
    queryKey: [KEY, 'orgPickerLists', orgId],
    queryFn: () => getOrgPickerLists(orgId as string),
    enabled: Boolean(orgId),
    staleTime: 5 * 60_000,
  });
}

// ─── Device registration ──────────────────────────────────────────────────────

/**
 * Register this device once per app session.
 *
 * `assoc_devices` had no writer at all, so the settings screen listed nothing
 * and the revoke endpoint had no row to act on. The call is idempotent server
 * side on (user, name, platform), so re-running it only touches `last_active`.
 * Failures are swallowed deliberately: this is background bookkeeping and must
 * never surface an error over the screen the member actually opened.
 */
export function useRegisterThisDevice(enabled = true) {
  const qc = useQueryClient();
  const done = useRef(false);

  useEffect(() => {
    if (!enabled || done.current) return;
    done.current = true;
    let cancelled = false;
    registerDevice(describeThisDevice())
      .then(() => { if (!cancelled) qc.invalidateQueries({ queryKey: [KEY, 'devices'] }); })
      .catch(() => { /* background bookkeeping — never surfaced */ });
    return () => { cancelled = true; };
  }, [enabled, qc]);
}
