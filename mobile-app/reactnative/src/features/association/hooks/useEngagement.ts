// ── Association — Engagement data hooks ───────────────────────────────────────
// React Query hooks for announcements, notifications, meetings, tasks, documents.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAnnouncements, getAnnouncement, acknowledgeAnnouncement,
  getNotifications, markNotificationsRead,
  getMeetings, getMeeting, rsvpMeeting, checkInMeeting,
  proposeMeeting, getPendingMeetings, decideMeeting,
  getTasks, getTask, updateTaskStatus,
  getDocuments, getDocument, acknowledgeDocument,
} from '../api/engagement.api';
import type { RsvpStatus, TaskScope, TaskStatus, MeetingProposalInput } from '../types/engagement.types';

const KEY = 'association';

// ─── Announcements ───────────────────────────────────────────────
export function useAnnouncements() {
  return useQuery({ queryKey: [KEY, 'announcements'], queryFn: getAnnouncements, staleTime: 30_000 });
}
export function useAnnouncement(id?: string) {
  return useQuery({ queryKey: [KEY, 'announcement', id], queryFn: () => getAnnouncement(id as string), enabled: Boolean(id), staleTime: 30_000 });
}
export function useAcknowledgeAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => acknowledgeAnnouncement(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'announcement', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'announcements'] });
    },
  });
}

// ─── Notifications ───────────────────────────────────────────────
export function useNotifications() {
  return useQuery({ queryKey: [KEY, 'notifications'], queryFn: getNotifications, staleTime: 15_000 });
}
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'notifications'] }),
  });
}

// ─── Meetings ────────────────────────────────────────────────────
export function useMeetings() {
  return useQuery({ queryKey: [KEY, 'meetings'], queryFn: getMeetings, staleTime: 30_000 });
}
export function useMeeting(id?: string) {
  return useQuery({ queryKey: [KEY, 'meeting', id], queryFn: () => getMeeting(id as string), enabled: Boolean(id), staleTime: 30_000 });
}
export function useRsvpMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: RsvpStatus }) => rsvpMeeting(id, status),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: [KEY, 'meeting', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'meetings'] });
    },
  });
}
export function useProposeMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MeetingProposalInput) => proposeMeeting(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'meetings'] });
      // An admin's own proposal is approved on insert and leaves the queue
      // untouched; a member's adds to it. Invalidating both covers either.
      qc.invalidateQueries({ queryKey: [KEY, 'pendingMeetings'] });
    },
  });
}
export function usePendingMeetings(orgId?: string) {
  return useQuery({
    queryKey: [KEY, 'pendingMeetings', orgId],
    queryFn: () => getPendingMeetings(orgId as string),
    enabled: Boolean(orgId),
    staleTime: 15_000,
  });
}
export function useDecideMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note?: string }) =>
      decideMeeting(id, approve, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'pendingMeetings'] });
      // An approval puts the meeting on the calendar, so the list changes too.
      qc.invalidateQueries({ queryKey: [KEY, 'meetings'] });
    },
  });
}
export function useCheckInMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => checkInMeeting(id),
    onSuccess: (_d, id) => qc.invalidateQueries({ queryKey: [KEY, 'meeting', id] }),
  });
}

// ─── Tasks ───────────────────────────────────────────────────────
export function useTasks(scope: TaskScope = 'mine') {
  return useQuery({ queryKey: [KEY, 'tasks', scope], queryFn: () => getTasks(scope), staleTime: 20_000 });
}
export function useTask(id?: string) {
  return useQuery({ queryKey: [KEY, 'task', id], queryFn: () => getTask(id as string), enabled: Boolean(id), staleTime: 20_000 });
}
export function useUpdateTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => updateTaskStatus(id, status),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: [KEY, 'task', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'tasks'] });
    },
  });
}

// ─── Documents ───────────────────────────────────────────────────
export function useDocuments() {
  return useQuery({ queryKey: [KEY, 'documents'], queryFn: getDocuments, staleTime: 30_000 });
}
export function useDocument(id?: string) {
  return useQuery({ queryKey: [KEY, 'document', id], queryFn: () => getDocument(id as string), enabled: Boolean(id), staleTime: 30_000 });
}
export function useAcknowledgeDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => acknowledgeDocument(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'document', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'documents'] });
    },
  });
}
