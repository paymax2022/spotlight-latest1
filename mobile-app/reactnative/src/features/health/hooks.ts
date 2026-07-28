// ── Paymax Health — React Query hooks (Phase 0) ──────────────────────────────
// Declarative data hooks the shared screens (and verticals) reuse. React Query v5.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getHubSummary,
  getSubjects,
  getRecords,
  getRecord,
  getDocSignedUrl,
  getConsents,
  grantConsent,
  revokeConsent,
  getIntakeSchema,
  getIntakeDraft,
  saveIntakeDraft,
  submitIntake,
  getProviders,
  getProvider,
  getConsult,
  sendConsultMessage,
  getIntake,
  saveIntakeDraftForAppt,
  submitApptIntake,
  getHealthProfile,
  type RecordQuery,
} from './api';
import type { ConsentGrantInput, IntakeResponseValues } from './types';

const KEY = 'health';

// ── Hub ──────────────────────────────────────────────────────────────────────
export function useHubSummary() {
  return useQuery({ queryKey: [KEY, 'hub'], queryFn: getHubSummary, staleTime: 30_000 });
}

// ── Subjects ──────────────────────────────────────────────────────────────────
export function useSubjects() {
  return useQuery({ queryKey: [KEY, 'subjects'], queryFn: getSubjects, staleTime: 5 * 60_000 });
}

// ── Records ───────────────────────────────────────────────────────────────────
export function useRecords(query?: RecordQuery) {
  return useQuery({
    queryKey: [KEY, 'records', query ?? {}],
    queryFn: () => getRecords(query),
    staleTime: 30_000,
  });
}

export function useRecord(id?: string) {
  return useQuery({
    queryKey: [KEY, 'record', id],
    queryFn: () => getRecord(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/** Lazily resolve a signed URL for a document (HL-8). */
export function useDocSignedUrl() {
  return useMutation({
    mutationFn: ({ recordId, docId }: { recordId: string; docId: string }) => getDocSignedUrl(recordId, docId),
  });
}

// ── Consent ───────────────────────────────────────────────────────────────────
export function useConsents(subjectId?: string) {
  return useQuery({
    queryKey: [KEY, 'consents', subjectId ?? 'all'],
    queryFn: () => getConsents(subjectId),
    staleTime: 30_000,
  });
}

export function useGrantConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConsentGrantInput) => grantConsent(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'consents'] });
      qc.invalidateQueries({ queryKey: [KEY, 'hub'] });
    },
  });
}

export function useRevokeConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeConsent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'consents'] }),
  });
}

// ── Intake ────────────────────────────────────────────────────────────────────
export function useIntakeSchema(schemaId?: string) {
  return useQuery({
    queryKey: [KEY, 'intake-schema', schemaId],
    queryFn: () => getIntakeSchema(schemaId as string),
    enabled: Boolean(schemaId),
    staleTime: 5 * 60_000,
  });
}

export function useIntakeDraft(schemaId?: string, subjectId?: string) {
  return useQuery({
    queryKey: [KEY, 'intake-draft', schemaId, subjectId ?? 'none'],
    queryFn: () => getIntakeDraft(schemaId as string, subjectId),
    enabled: Boolean(schemaId),
    staleTime: 0,
  });
}

export function useSaveIntakeDraft() {
  return useMutation({
    mutationFn: (args: {
      schemaId: string;
      schemaVersion: number;
      values: IntakeResponseValues;
      subjectId?: string;
    }) => saveIntakeDraft(args.schemaId, args.schemaVersion, args.values, args.subjectId),
  });
}

export function useSubmitIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      schemaId: string;
      schemaVersion: number;
      values: IntakeResponseValues;
      subjectId?: string;
    }) => submitIntake(args.schemaId, args.schemaVersion, args.values, args.subjectId),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: [KEY, 'intake-draft', vars.schemaId] }),
  });
}

// ── Pre-Consult Intake (telemedicine appointment, M1–M17) ─────────────────────
export function useApptIntake(appointmentId?: string) {
  return useQuery({
    queryKey: [KEY, 'appt-intake', appointmentId],
    queryFn: () => getIntake(appointmentId as string),
    enabled: Boolean(appointmentId),
    staleTime: 0,
  });
}

export function useSaveApptDraft(appointmentId?: string) {
  return useMutation({
    mutationFn: (args: { answers: IntakeResponseValues; consentVersion?: string }) =>
      saveIntakeDraftForAppt(appointmentId as string, args.answers, args.consentVersion),
  });
}

/**
 * Submit the Pre-Consult intake. The mutation result carries an optional
 * `red_flag` the wizard surfaces as the M13 interstitial (never blocks help).
 */
export function useSubmitApptIntake(appointmentId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { answers: IntakeResponseValues; consentVersion: string }) =>
      submitApptIntake(appointmentId as string, args.answers, args.consentVersion),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'appt-intake', appointmentId] });
      qc.invalidateQueries({ queryKey: [KEY, 'health-profile'] });
      qc.invalidateQueries({ queryKey: ['tele-appointment', appointmentId] });
      qc.invalidateQueries({ queryKey: ['tele-appointments'] });
    },
  });
}

export function useHealthProfile() {
  return useQuery({
    queryKey: [KEY, 'health-profile'],
    queryFn: getHealthProfile,
    staleTime: 60_000,
  });
}

// ── Providers ─────────────────────────────────────────────────────────────────
export function useProviders(vertical?: 'pharmacy' | 'lab' | 'vet') {
  return useQuery({
    queryKey: [KEY, 'providers', vertical ?? 'all'],
    queryFn: () => getProviders(vertical),
    staleTime: 60_000,
  });
}

export function useProvider(id?: string) {
  return useQuery({
    queryKey: [KEY, 'provider', id],
    queryFn: () => getProvider(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ── Consult ───────────────────────────────────────────────────────────────────
export function useConsult(id?: string) {
  return useQuery({
    queryKey: [KEY, 'consult', id],
    queryFn: () => getConsult(id as string),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useSendConsultMessage(consultId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => sendConsultMessage(consultId as string, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'consult', consultId] }),
  });
}
