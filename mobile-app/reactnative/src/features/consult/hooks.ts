// Polling and mutations for one consult session. React Query v5.
//
// The session poll is the source of truth for the timer and the ended state;
// chat polls on a shorter interval because it is the whole product in chat
// mode. Everything stops once the session is ended or cancelled.

import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  decideConsultExtension,
  getConsultSession,
  joinConsultSession,
  listConsultExtensions,
  listConsultMessages,
  payConsultExtension,
  postConsultMessage,
  requestConsultExtension,
} from './api';

export const CONSULT_POLL_MS = 15_000;
export const CONSULT_MESSAGE_POLL_MS = 5_000;

const KEYS = {
  session: (id: string) => ['consult', 'session', id] as const,
  extensions: (id: string) => ['consult', 'extensions', id] as const,
  messages: (id: string) => ['consult', 'messages', id] as const,
};

export function useConsultSession(sessionId?: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEYS.session(sessionId ?? ''),
    queryFn: () => getConsultSession(sessionId as string),
    enabled: Boolean(sessionId),
    staleTime: 0,
    refetchInterval: (q) => {
      const session = q.state.data;
      return session && (session.state === 'ended' || session.state === 'cancelled') ? false : CONSULT_POLL_MS;
    },
  });

  // A phone that was asleep resumes with a stale countdown; read the server
  // again the moment the app is foregrounded.
  useEffect(() => {
    if (!sessionId) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void qc.invalidateQueries({ queryKey: KEYS.session(sessionId) });
    });
    return () => sub.remove();
  }, [qc, sessionId]);

  return query;
}

export function useConsultExtensions(sessionId?: string, enabled = true, poll = enabled) {
  return useQuery({
    queryKey: KEYS.extensions(sessionId ?? ''),
    queryFn: () => listConsultExtensions(sessionId as string),
    enabled: Boolean(sessionId) && enabled,
    staleTime: 0,
    refetchInterval: poll ? CONSULT_POLL_MS : false,
  });
}

export function useConsultMessages(sessionId?: string, enabled = true, poll = enabled) {
  return useQuery({
    queryKey: KEYS.messages(sessionId ?? ''),
    queryFn: () => listConsultMessages(sessionId as string),
    enabled: Boolean(sessionId) && enabled,
    staleTime: 0,
    refetchInterval: poll ? CONSULT_MESSAGE_POLL_MS : false,
  });
}

/** A fresh LiveKit token for the session. Call again to rejoin after a drop. */
export function useConsultJoin(sessionId?: string) {
  return useMutation({
    mutationFn: () => joinConsultSession(sessionId as string),
  });
}

export function useSendConsultMessage(sessionId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => postConsultMessage(sessionId as string, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.messages(sessionId ?? '') }),
  });
}

export function useRequestConsultExtension(sessionId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (minutes: number) => requestConsultExtension(sessionId as string, minutes),
    onSuccess: () => {
      // A provider's extension is granted immediately and moves `ends_at`.
      qc.invalidateQueries({ queryKey: KEYS.extensions(sessionId ?? '') });
      qc.invalidateQueries({ queryKey: KEYS.session(sessionId ?? '') });
    },
  });
}

export function useDecideConsultExtension(sessionId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { extensionId: string; approve: boolean; reason?: string }) =>
      decideConsultExtension(sessionId as string, input.extensionId, input.approve, input.reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.extensions(sessionId ?? '') });
      qc.invalidateQueries({ queryKey: KEYS.session(sessionId ?? '') });
    },
  });
}

export function usePayConsultExtension(sessionId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (extensionId: string) => payConsultExtension(sessionId as string, extensionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.extensions(sessionId ?? '') });
      qc.invalidateQueries({ queryKey: KEYS.session(sessionId ?? '') });
    },
  });
}
