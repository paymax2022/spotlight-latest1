// ── Doctor — Batch 2 · Section I · audio & video consultation hooks ────────────
// Rich call session (provider, network quality, device check, participant +
// control state), pre-call checklist, duration summary, feedback, dispute,
// technical-issue report. Reconnecting/dropped/disconnected/poor-network and the
// Agora → VideoSDK fallback are STATES read from `CallSessionRich`, not separate
// hooks. REUSES Phase 1 `useCallSession` from `useConsultation` and
// `useUpdateAppointmentStatus` from `useAppointments` — not re-declared here.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCallSessionRich,
  getPreCallCheck,
  getCallDisputes,
  runDeviceCheck,
  joinCall,
  leaveCall,
  switchProvider,
  submitCallFeedback,
  raiseCallDispute,
  reportTechnicalIssue,
  DEMO_CALL_SESSION_RICH,
  DEMO_PRECALL_CHECK,
  DEMO_CALL_DISPUTES,
} from '@/api/doctor.batch2.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  RunDeviceCheckInput,
  JoinCallInput,
  LeaveCallInput,
  SwitchProviderInput,
  SubmitCallFeedbackInput,
  RaiseCallDisputeInput,
  ReportTechnicalIssueInput,
} from '@/types/doctor.batch2';

// ─── Reads ───────────────────────────────────────────────────────────────────

export function useCallSessionRich(appointmentId: string) {
  return useQuery({
    queryKey:        ['doctor', 'call-rich', appointmentId],
    queryFn:         () => getCallSessionRich(appointmentId),
    enabled:         !!appointmentId,
    placeholderData: DEMO_CALL_SESSION_RICH,
    staleTime:       3_000,
  });
}

export function usePreCallCheck(appointmentId: string) {
  return useQuery({
    queryKey:        ['doctor', 'precall-check', appointmentId],
    queryFn:         () => getPreCallCheck(appointmentId),
    enabled:         !!appointmentId,
    placeholderData: DEMO_PRECALL_CHECK,
    staleTime:       5_000,
  });
}

export function useCallDisputes() {
  return useQuery({
    queryKey:        ['doctor', 'call-disputes'],
    queryFn:         getCallDisputes,
    placeholderData: DEMO_CALL_DISPUTES,
    staleTime:       30_000,
  });
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

export function useRunDeviceCheck() {
  return useMutation({
    mutationFn: (input: Omit<RunDeviceCheckInput, 'idempotencyKey'>) =>
      runDeviceCheck({ ...input, idempotencyKey: generateIdempotencyKey() }),
  });
}

export function useJoinCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<JoinCallInput, 'idempotencyKey'>) =>
      joinCall({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'call-rich', vars.appointmentId] });
    },
  });
}

export function useLeaveCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<LeaveCallInput, 'idempotencyKey'>) =>
      leaveCall({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'call-rich', vars.appointmentId] });
    },
  });
}

export function useSwitchProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SwitchProviderInput, 'idempotencyKey'>) =>
      switchProvider({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'call-rich', vars.appointmentId] });
    },
  });
}

export function useSubmitCallFeedback() {
  return useMutation({
    mutationFn: (input: Omit<SubmitCallFeedbackInput, 'idempotencyKey'>) =>
      submitCallFeedback({ ...input, idempotencyKey: generateIdempotencyKey() }),
  });
}

export function useRaiseCallDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RaiseCallDisputeInput, 'idempotencyKey'>) =>
      raiseCallDispute({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'call-disputes'] });
    },
  });
}

export function useReportTechnicalIssue() {
  return useMutation({
    mutationFn: (input: Omit<ReportTechnicalIssueInput, 'idempotencyKey'>) =>
      reportTechnicalIssue({ ...input, idempotencyKey: generateIdempotencyKey() }),
  });
}
