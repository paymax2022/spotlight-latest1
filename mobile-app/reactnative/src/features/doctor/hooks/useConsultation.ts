// ── Doctor — chat, call & SOAP-note hooks ────────────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getChatThreads,
  getChatMessages,
  getCallSession,
  getSoapNote,
  sendChatMessage,
  saveSoapNote,
  DEMO_CHAT_THREADS,
  DEMO_CHAT_MESSAGES,
} from '@/api/doctor.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  SendChatMessageInput,
  SaveSoapNoteInput,
} from '@/types/doctor';

export function useChatThreads() {
  return useQuery({
    queryKey:        ['doctor', 'chat-threads'],
    queryFn:         getChatThreads,
    placeholderData: DEMO_CHAT_THREADS,
    staleTime:       15_000,
  });
}

export function useChatMessages(threadId: string) {
  return useQuery({
    queryKey:        ['doctor', 'chat-messages', threadId],
    queryFn:         () => getChatMessages(threadId),
    enabled:         !!threadId,
    placeholderData: DEMO_CHAT_MESSAGES.filter((m) => m.threadId === threadId),
    staleTime:       10_000,
  });
}

export function useCallSession(appointmentId: string) {
  return useQuery({
    queryKey: ['doctor', 'call', appointmentId],
    queryFn:  () => getCallSession(appointmentId),
    enabled:  !!appointmentId,
    staleTime: 5_000,
  });
}

export function useSoapNote(appointmentId: string) {
  return useQuery({
    queryKey: ['doctor', 'soap-note', appointmentId],
    queryFn:  () => getSoapNote(appointmentId),
    enabled:  !!appointmentId,
    staleTime: 30_000,
  });
}

export function useSendChatMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SendChatMessageInput, 'idempotencyKey'>) =>
      sendChatMessage({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'chat-messages', vars.threadId] });
      qc.invalidateQueries({ queryKey: ['doctor', 'chat-threads'] });
    },
  });
}

export function useSaveSoapNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SaveSoapNoteInput, 'idempotencyKey'>) =>
      saveSoapNote({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'soap-note', vars.appointmentId] });
    },
  });
}
