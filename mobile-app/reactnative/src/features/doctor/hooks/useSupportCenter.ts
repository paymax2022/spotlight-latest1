// ── Doctor — Support Centre hooks (Batch 7, Section AA) ──────────────────────
// Query keys under ['doctor', 'support', …]. Mutations auto-generate the
// idempotencyKey. REUSES the Phase 1 useSupportTickets / useCreateSupportTicket
// (useAccount.ts) for the ticket list / create flows; this file adds FAQs, help
// articles, disputes, the support message thread and the dispute mutations. Hook
// names are deliberately distinct from useSupportTickets to avoid a barrel
// collision.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getFaqs,
  getHelpArticles,
  getDisputes,
  getDispute,
  getSupportMessages,
  createDispute,
  uploadDisputeEvidence,
  sendSupportMessage,
  DEMO_FAQS,
  DEMO_HELP_ARTICLES,
  DEMO_DISPUTES,
} from '@/api/doctor.batch7.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  CreateDisputeInput,
  UploadDisputeEvidenceInput,
  SendSupportMessageInput,
} from '@/types/doctor.batch7';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function useFaqs() {
  return useQuery({
    queryKey:        ['doctor', 'support', 'faqs'],
    queryFn:         getFaqs,
    placeholderData: DEMO_FAQS,
    staleTime:       300_000,
  });
}

export function useHelpArticles() {
  return useQuery({
    queryKey:        ['doctor', 'support', 'help-articles'],
    queryFn:         getHelpArticles,
    placeholderData: DEMO_HELP_ARTICLES,
    staleTime:       300_000,
  });
}

export function useDisputes() {
  return useQuery({
    queryKey:        ['doctor', 'support', 'disputes'],
    queryFn:         getDisputes,
    placeholderData: DEMO_DISPUTES,
    staleTime:       30_000,
  });
}

export function useDispute(disputeId: string) {
  return useQuery({
    queryKey: ['doctor', 'support', 'disputes', disputeId],
    queryFn:  () => getDispute(disputeId),
    enabled:  !!disputeId,
  });
}

export function useSupportMessages(threadId: string) {
  return useQuery({
    queryKey: ['doctor', 'support', 'messages', threadId],
    queryFn:  () => getSupportMessages(threadId),
    enabled:  !!threadId,
    staleTime: 10_000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useCreateDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateDisputeInput, 'idempotencyKey'>) =>
      createDispute({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'support', 'disputes'] });
    },
  });
}

export function useUploadDisputeEvidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<UploadDisputeEvidenceInput, 'idempotencyKey'>) =>
      uploadDisputeEvidence({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'support', 'disputes', variables.disputeId] });
    },
  });
}

export function useSendSupportMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SendSupportMessageInput, 'idempotencyKey'>) =>
      sendSupportMessage({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'support', 'messages', variables.threadId] });
    },
  });
}
