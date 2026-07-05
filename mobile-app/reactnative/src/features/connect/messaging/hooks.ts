// Paymax Connect — Messaging React Query hooks (PRD §10.5 MS-*).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as messagingApi from './api';
import type { ThreadDetail, Message, CallKind } from './types';

export const messagingKeys = {
  all: ['connect', 'messaging'] as const,
  inbox: () => [...messagingKeys.all, 'inbox'] as const,
  thread: (id: string) => [...messagingKeys.all, 'thread', id] as const,
  requests: () => [...messagingKeys.all, 'requests'] as const,
  icebreakers: () => [...messagingKeys.all, 'icebreakers'] as const,
};

export function useInbox() {
  return useQuery({ queryKey: messagingKeys.inbox(), queryFn: messagingApi.getInbox });
}

export function useThread(id: string) {
  return useQuery({ queryKey: messagingKeys.thread(id), queryFn: () => messagingApi.getThread(id), enabled: !!id });
}

export function useSendMessage(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { thread: Pick<ThreadDetail, 'id' | 'mode' | 'gate'>; body: string; kind?: Message['kind']; locationLabel?: string }) =>
      messagingApi.sendMessage(v.thread, v.body, v.kind, v.locationLabel),
    onSuccess: (msg) => {
      qc.setQueryData<ThreadDetail>(messagingKeys.thread(threadId), (prev) =>
        prev ? { ...prev, messages: [...prev.messages, msg] } : prev,
      );
      qc.invalidateQueries({ queryKey: messagingKeys.inbox() });
    },
  });
}

export function useRequests() {
  return useQuery({ queryKey: messagingKeys.requests(), queryFn: messagingApi.getRequests });
}

export function useRespondToRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { requestId: string; accept: boolean }) => messagingApi.respondToRequest(v.requestId, v.accept),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagingKeys.requests() });
      qc.invalidateQueries({ queryKey: messagingKeys.inbox() });
    },
  });
}

export function useIcebreakers() {
  return useQuery({ queryKey: messagingKeys.icebreakers(), queryFn: messagingApi.getIcebreakers });
}

export function useReportUser() {
  return useMutation({
    mutationFn: (v: { peerId: string; reasonCode: string; details?: string }) =>
      messagingApi.reportUser(v.peerId, v.reasonCode, v.details),
  });
}

export function useBlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (peerId: string) => messagingApi.blockUser(peerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.inbox() }),
  });
}

export function useUnmatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { threadId: string; peerId: string }) => messagingApi.unmatch(v.threadId, v.peerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.inbox() }),
  });
}

export function useStartCall() {
  return useMutation({
    mutationFn: (v: { threadId: string; peerName: string; kind: CallKind; peerAvatar?: string }) =>
      messagingApi.startCall(v.threadId, v.peerName, v.kind, v.peerAvatar),
  });
}
