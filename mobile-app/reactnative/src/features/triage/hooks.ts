// ── Paymax AI Symptom Checker — React Query hooks (v5) ───────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getProfiles,
  createProfile,
  createSession,
  submitIntake,
  submitAnswer,
  getSession,
  createReferral,
  payReferral,
  getNearestEmergency,
  saveSessionToRecords,
  submitFeedback,
} from './api';
import type {
  CreateProfileInput,
  CreateSessionInput,
  IntakeInput,
  AnswerInput,
  ReferInput,
  PayReferralInput,
  FeedbackInput,
} from './types';

const KEY = 'triage';

export function useProfiles() {
  return useQuery({
    queryKey: [KEY, 'profiles'],
    queryFn: getProfiles,
    staleTime: 60_000,
  });
}

export function useCreateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProfileInput) => createProfile(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'profiles'] });
    },
  });
}

export function useCreateSession() {
  return useMutation({
    mutationFn: (input: CreateSessionInput) => createSession(input),
  });
}

export function useSubmitIntake(sessionId?: string) {
  return useMutation({
    mutationFn: (input: IntakeInput) => submitIntake(sessionId as string, input),
  });
}

export function useSubmitAnswer(sessionId?: string) {
  return useMutation({
    mutationFn: (input: AnswerInput) => submitAnswer(sessionId as string, input),
  });
}

export function useSession(sessionId?: string) {
  return useQuery({
    queryKey: [KEY, 'session', sessionId],
    queryFn: () => getSession(sessionId as string),
    enabled: Boolean(sessionId),
    staleTime: 30_000,
  });
}

export function useCreateReferral(sessionId?: string) {
  return useMutation({
    mutationFn: (input: ReferInput) => createReferral(sessionId as string, input),
  });
}

export function usePayReferral() {
  return useMutation({
    mutationFn: (input: PayReferralInput) => payReferral(input),
  });
}

export function useNearestEmergency(coords?: { lat?: number; lng?: number }) {
  return useQuery({
    queryKey: [KEY, 'emergency', coords?.lat, coords?.lng],
    queryFn: () => getNearestEmergency(coords?.lat, coords?.lng),
    staleTime: 60_000,
  });
}

export function useSaveToRecords() {
  return useMutation({
    mutationFn: (sessionId: string) => saveSessionToRecords(sessionId),
  });
}

export function useSubmitFeedback() {
  return useMutation({
    mutationFn: (input: FeedbackInput) => submitFeedback(input),
  });
}
