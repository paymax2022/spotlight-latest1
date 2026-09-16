// ── Association — Group chat hooks (I) ────────────────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getThreads, getThread, sendMessage, muteThread, reactToMessage } from '../api/chat.api';
import type { ChatThread, ChatMessage } from '../types/chat.types';

const KEY = 'association';

export function useChatThreads() {
  return useQuery({ queryKey: [KEY, 'chatThreads'], queryFn: getThreads, staleTime: 15_000 });
}

export function useChatThread(id?: string) {
  return useQuery({
    queryKey: [KEY, 'chatThread', id],
    queryFn: () => getThread(id as string),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useSendMessage(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, imageUrl }: { body: string; imageUrl?: string | null }) => sendMessage(threadId, body, imageUrl),
    onSuccess: (msg) => {
      qc.setQueryData<ChatThread>([KEY, 'chatThread', threadId], (prev) =>
        prev ? { ...prev, messages: [...prev.messages, msg], lastMessage: msg.imageUrl && !msg.body ? '📷 Photo' : msg.body, lastAt: msg.createdAt } : prev,
      );
      qc.invalidateQueries({ queryKey: [KEY, 'chatThreads'] });
    },
  });
}

export function useMuteThread(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (muted: boolean) => muteThread(threadId, muted),
    onMutate: (muted) => {
      qc.setQueryData<ChatThread>([KEY, 'chatThread', threadId], (prev) => (prev ? { ...prev, muted } : prev));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'chatThreads'] }),
  });
}

export function useReactMessage(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) => reactToMessage(threadId, messageId, emoji),
    onMutate: ({ messageId, emoji }) => {
      // Optimistic toggle of the caller's reaction on the cached message.
      qc.setQueryData<ChatThread>([KEY, 'chatThread', threadId], (prev) => {
        if (!prev) return prev;
        const messages = prev.messages.map((m): ChatMessage => {
          if (m.id !== messageId) return m;
          // `reactions` is optional on the live DTO — treat a missing array as empty.
          const current = m.reactions ?? [];
          const existing = current.find((r) => r.emoji === emoji);
          let reactions;
          if (existing) {
            const nextCount = existing.count + (existing.mine ? -1 : 1);
            reactions = nextCount <= 0
              ? current.filter((r) => r.emoji !== emoji)
              : current.map((r) => (r.emoji === emoji ? { ...r, count: nextCount, mine: !existing.mine } : r));
          } else {
            reactions = [...current, { emoji, count: 1, mine: true }];
          }
          return { ...m, reactions };
        });
        return { ...prev, messages };
      });
    },
  });
}
