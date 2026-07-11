// Paymax Connect — Mentorship React Query hooks (Phase 6 §6.6).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as mentorshipApi from './api';
import type { MentorshipOptInInput, MatchResponse } from './types';

export const mentorshipKeys = {
  all: ['connect', 'networking', 'mentorship'] as const,
  me: () => [...mentorshipKeys.all, 'me'] as const,
  discovery: (domain?: string) => [...mentorshipKeys.all, 'discovery', domain ?? ''] as const,
  mentor: (id: string) => [...mentorshipKeys.all, 'mentor', id] as const,
};

export function useMyMentorshipProfile() {
  return useQuery({ queryKey: mentorshipKeys.me(), queryFn: () => mentorshipApi.getMyMentorshipProfile() });
}

export function useOptInMentorship() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MentorshipOptInInput) => mentorshipApi.optInMentorship(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: mentorshipKeys.me() }),
  });
}

export function useMentorDiscovery(domain?: string) {
  return useQuery({ queryKey: mentorshipKeys.discovery(domain), queryFn: () => mentorshipApi.getMentorDiscovery(domain) });
}

export function useMentor(id: string) {
  return useQuery({ queryKey: mentorshipKeys.mentor(id), queryFn: () => mentorshipApi.getMentor(id), enabled: !!id });
}

export function useRequestMentorshipMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { mentorId: string; domain: string; message: string }) =>
      mentorshipApi.requestMentorshipMatch(v.mentorId, v.domain, v.message),
    onSuccess: () => qc.invalidateQueries({ queryKey: mentorshipKeys.all }),
  });
}

export function useRespondMentorshipMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { matchId: string; action: MatchResponse; mentorId?: string }) =>
      mentorshipApi.respondMentorshipMatch(v.matchId, v.action, v.mentorId),
    onSuccess: () => qc.invalidateQueries({ queryKey: mentorshipKeys.all }),
  });
}
