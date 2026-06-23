import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateIdempotencyKey } from '@/utils/idempotency';
import * as api from '../api/meetings.api';
import type { CreateMeetingInput, RsvpResponse } from '../types/meetings.types';

export const meetingKeys = {
  all: ['meetings'] as const,
  list: () => [...meetingKeys.all, 'list'] as const,
  detail: (id: string) => [...meetingKeys.all, 'detail', id] as const,
  minutes: (id: string) => [...meetingKeys.all, 'minutes', id] as const,
};

export function useMeetings() {
  return useQuery({ queryKey: meetingKeys.list(), queryFn: api.listMeetings });
}

export function useMeeting(id: string) {
  return useQuery({ queryKey: meetingKeys.detail(id), queryFn: () => api.getMeeting(id), enabled: !!id });
}

export function useMeetingMinutes(id: string) {
  return useQuery({ queryKey: meetingKeys.minutes(id), queryFn: () => api.getMeetingMinutes(id), enabled: !!id });
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateMeetingInput, 'idempotencyKey'>) =>
      api.createMeeting({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meetingKeys.list() }),
  });
}

export function useRsvp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { meetingId: string; response: RsvpResponse }) =>
      api.rsvpMeeting({ ...vars, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: meetingKeys.list() });
      qc.invalidateQueries({ queryKey: meetingKeys.detail(m.id) });
    },
  });
}
