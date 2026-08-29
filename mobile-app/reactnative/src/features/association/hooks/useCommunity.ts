// ── Association — Committees & Events hooks ───────────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCommittees, getCommittee, requestJoinCommittee,
  getEvents, getEvent, rsvpEvent, registerEvent, submitEventFeedback,
} from '../api/community.api';
import type { EventRsvp } from '../types/community.types';

const KEY = 'association';

// ─── Committees ──────────────────────────────────────────────────
export function useCommittees() {
  return useQuery({ queryKey: [KEY, 'committees'], queryFn: getCommittees, staleTime: 30_000 });
}
export function useCommittee(id?: string) {
  return useQuery({
    queryKey: [KEY, 'committee', id],
    queryFn: () => getCommittee(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}
export function useRequestJoinCommittee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => requestJoinCommittee(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'committee', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'committees'] });
    },
  });
}

// ─── Events ──────────────────────────────────────────────────────
export function useEvents() {
  return useQuery({ queryKey: [KEY, 'events'], queryFn: getEvents, staleTime: 30_000 });
}
export function useEvent(id?: string) {
  return useQuery({
    queryKey: [KEY, 'event', id],
    queryFn: () => getEvent(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}
export function useRsvpEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rsvp }: { id: string; rsvp: EventRsvp }) => rsvpEvent(id, rsvp),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: [KEY, 'event', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'events'] });
    },
  });
}
export function useRegisterEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => registerEvent(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'event', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'events'] });
      // Registering for a PAID event raises a dues invoice. The payment screen
      // reads that invoice out of the dues list, so leaving the dues cache
      // stale would send the member to "we couldn't find this invoice" for the
      // invoice that had just been created for them.
      qc.invalidateQueries({ queryKey: [KEY, 'dues'] });
    },
  });
}
export function useSubmitEventFeedback(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rating, comment }: { rating: number; comment: string }) => submitEventFeedback(id, rating, comment),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'event', id] }),
  });
}
