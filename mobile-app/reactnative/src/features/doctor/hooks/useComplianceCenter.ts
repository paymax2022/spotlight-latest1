// ── Doctor — Compliance Centre hooks (Batch 7, Section AB) ───────────────────
// Query keys under ['doctor', 'compliance', …]. Mutations auto-generate the
// idempotencyKey. REUSES the Phase 2 useComplianceDashboard / useAcknowledgePolicy
// (useCompliance.ts) for the dashboard / licence / consent / alerts / policy
// screens; this file adds the vet licence, data-privacy settings, scoped audit
// trails, mandatory training, the safety-issue report and the account-review
// notice, plus the privacy / training / safety / data-request mutations. Hook
// names are deliberately distinct from useComplianceDashboard to avoid a barrel
// collision.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getVetLicence,
  getPrivacySettings,
  getAuditTrail,
  getMandatoryTraining,
  getSafetyIssues,
  getAccountReviewNotice,
  updatePrivacySettings,
  completeTrainingModule,
  reportSafetyIssue,
  requestDataExport,
  requestAccountDeletion,
  DEMO_VET_LICENCE,
  DEMO_PRIVACY_SETTINGS,
  DEMO_AUDIT_TRAILS,
  DEMO_MANDATORY_TRAINING,
  DEMO_SAFETY_ISSUES,
} from '@/api/doctor.batch7.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  AuditScope,
  UpdatePrivacySettingsInput,
  CompleteTrainingModuleInput,
  ReportSafetyIssueInput,
  RequestDataExportInput,
  RequestAccountDeletionInput,
} from '@/types/doctor.batch7';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function useVetLicence() {
  return useQuery({
    queryKey:        ['doctor', 'compliance', 'vet-licence'],
    queryFn:         getVetLicence,
    placeholderData: DEMO_VET_LICENCE,
    staleTime:       60_000,
  });
}

export function usePrivacySettings() {
  return useQuery({
    queryKey:        ['doctor', 'compliance', 'privacy'],
    queryFn:         getPrivacySettings,
    placeholderData: DEMO_PRIVACY_SETTINGS,
    staleTime:       60_000,
  });
}

export function useAuditTrail(scope: AuditScope) {
  return useQuery({
    queryKey:        ['doctor', 'compliance', 'audit', scope],
    queryFn:         () => getAuditTrail(scope),
    placeholderData: DEMO_AUDIT_TRAILS[scope],
    staleTime:       30_000,
  });
}

export function useMandatoryTraining() {
  return useQuery({
    queryKey:        ['doctor', 'compliance', 'training'],
    queryFn:         getMandatoryTraining,
    placeholderData: DEMO_MANDATORY_TRAINING,
    staleTime:       60_000,
  });
}

export function useSafetyIssues() {
  return useQuery({
    queryKey:        ['doctor', 'compliance', 'safety-issues'],
    queryFn:         getSafetyIssues,
    placeholderData: DEMO_SAFETY_ISSUES,
    staleTime:       30_000,
  });
}

export function useAccountReviewNotice() {
  return useQuery({
    queryKey:  ['doctor', 'compliance', 'review-notice'],
    queryFn:   getAccountReviewNotice,
    staleTime: 60_000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useUpdatePrivacySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<UpdatePrivacySettingsInput, 'idempotencyKey'>) =>
      updatePrivacySettings({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'compliance', 'privacy'] });
    },
  });
}

export function useCompleteTrainingModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CompleteTrainingModuleInput, 'idempotencyKey'>) =>
      completeTrainingModule({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'compliance', 'training'] });
    },
  });
}

export function useReportSafetyIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ReportSafetyIssueInput, 'idempotencyKey'>) =>
      reportSafetyIssue({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'compliance', 'safety-issues'] });
    },
  });
}

export function useRequestDataExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input?: Omit<RequestDataExportInput, 'idempotencyKey'>) =>
      requestDataExport({ ...(input ?? {}), idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'compliance', 'privacy'] });
    },
  });
}

// CONSOLIDATED: the SINGLE account-deletion mutation, shared by the AB (privacy)
// and AC (settings) screens. Exported here; useSettingsCenter re-exports it so
// callers in either section import the same hook.
export function useRequestAccountDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input?: Omit<RequestAccountDeletionInput, 'idempotencyKey'>) =>
      requestAccountDeletion({ ...(input ?? {}), idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'compliance', 'privacy'] });
    },
  });
}
