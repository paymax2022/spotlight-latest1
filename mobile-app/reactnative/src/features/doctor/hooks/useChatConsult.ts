// ── Doctor — Batch 2 · Section H · chat consultation hooks ─────────────────────
// Rich chat (voice notes, attachments, image annotation, shared rx/lab/summary,
// escalation, presence, transcript, report, end-chat). Reads use the DEMO_*
// exports as placeholderData; mutations auto-generate the Idempotency-Key.
// REUSES Phase 1 `useChatThreads`, `useChatMessages`, `useSendChatMessage`
// (plain text) from `useConsultation` — those are not re-declared here.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getRichMessages,
  getThreadState,
  getChatPresence,
  getTranscript,
  sendVoiceNote,
  sendAttachment,
  annotateImage,
  shareInChat,
  escalateToCall,
  reportMessage,
  endChat,
  DEMO_RICH_MESSAGES,
  DEMO_THREAD_STATE,
} from '@/api/doctor.batch2.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  SendVoiceNoteInput,
  SendAttachmentInput,
  AnnotateImageInput,
  ShareInChatInput,
  EscalateToCallInput,
  ReportMessageInput,
  EndChatInput,
} from '@/types/doctor.batch2';

// ─── Reads ───────────────────────────────────────────────────────────────────

export function useRichMessages(threadId: string) {
  return useQuery({
    queryKey:        ['doctor', 'chat-rich-messages', threadId],
    queryFn:         () => getRichMessages(threadId),
    enabled:         !!threadId,
    placeholderData: DEMO_RICH_MESSAGES.filter((m) => m.base.threadId === threadId),
    staleTime:       10_000,
  });
}

export function useThreadState(threadId: string) {
  return useQuery({
    queryKey:        ['doctor', 'chat-thread-state', threadId],
    queryFn:         () => getThreadState(threadId),
    enabled:         !!threadId,
    placeholderData: DEMO_THREAD_STATE,
    staleTime:       5_000,
  });
}

export function useChatPresence(threadId: string) {
  return useQuery({
    queryKey:  ['doctor', 'chat-presence', threadId],
    queryFn:   () => getChatPresence(threadId),
    enabled:   !!threadId,
    staleTime: 3_000,
  });
}

export function useChatTranscript(threadId: string) {
  return useQuery({
    queryKey:  ['doctor', 'chat-transcript', threadId],
    queryFn:   () => getTranscript(threadId),
    enabled:   !!threadId,
    staleTime: 30_000,
  });
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

export function useSendVoiceNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SendVoiceNoteInput, 'idempotencyKey'>) =>
      sendVoiceNote({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'chat-rich-messages', vars.threadId] });
    },
  });
}

export function useSendAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SendAttachmentInput, 'idempotencyKey'>) =>
      sendAttachment({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'chat-rich-messages', vars.threadId] });
    },
  });
}

export function useAnnotateImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AnnotateImageInput, 'idempotencyKey'>) =>
      annotateImage({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'chat-rich-messages'] });
    },
  });
}

export function useShareInChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ShareInChatInput, 'idempotencyKey'>) =>
      shareInChat({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'chat-rich-messages', vars.threadId] });
    },
  });
}

export function useEscalateToCall() {
  return useMutation({
    mutationFn: (input: Omit<EscalateToCallInput, 'idempotencyKey'>) =>
      escalateToCall({ ...input, idempotencyKey: generateIdempotencyKey() }),
  });
}

export function useReportMessage() {
  return useMutation({
    mutationFn: (input: Omit<ReportMessageInput, 'idempotencyKey'>) =>
      reportMessage({ ...input, idempotencyKey: generateIdempotencyKey() }),
  });
}

export function useEndChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<EndChatInput, 'idempotencyKey'>) =>
      endChat({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'chat-thread-state', vars.threadId] });
      qc.invalidateQueries({ queryKey: ['doctor', 'chat-threads'] });
    },
  });
}
