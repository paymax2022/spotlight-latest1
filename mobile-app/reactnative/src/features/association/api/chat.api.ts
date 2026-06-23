// ── Association — Group chat API wrapper (I) ──────────────────────────────────
// Mock-flagged. Mirrors association.api.ts conventions.

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK } from '../constants/association.constants';
import type {
  ChatThread,
  ChatThreadSummary,
  ChatMessage,
} from '../types/chat.types';
import { MOCK_THREADS } from './chat.mock';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

const toSummary = (t: ChatThread): ChatThreadSummary => {
  const { id, title, scope, lastMessage, lastAt, unreadCount, muted, memberCount, postingBlock } = t;
  return { id, title, scope, lastMessage, lastAt, unreadCount, muted, memberCount, postingBlock };
};

export async function getThreads(): Promise<ChatThreadSummary[]> {
  if (USE_MOCK) { await delay(); return MOCK_THREADS.map(toSummary); }
  const { data } = await api.get('/associations/chat/threads');
  return data;
}

export async function getThread(id: string): Promise<ChatThread> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_THREADS.find((t) => t.id === id);
    if (!found) throw new Error('Thread not found');
    return found;
  }
  const { data } = await api.get(`/associations/chat/threads/${id}`);
  return data;
}

export async function sendMessage(threadId: string, body: string, imageUrl?: string | null): Promise<ChatMessage> {
  if (USE_MOCK) {
    await delay(160);
    return {
      id: `local_${Date.now()}`,
      threadId,
      authorId: 'me',
      authorName: 'You',
      authorRole: null,
      body,
      imageUrl: imageUrl ?? null,
      createdAt: new Date().toISOString(),
      mine: true,
      system: false,
      pinned: false,
      reactions: [],
    };
  }
  const { data } = await api.post(
    `/associations/chat/threads/${threadId}/messages`,
    { body, imageUrl: imageUrl ?? null },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  return data;
}

export async function muteThread(threadId: string, muted: boolean): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(120); return { ok: true }; }
  const { data } = await api.post(`/associations/chat/threads/${threadId}/mute`, { muted });
  return data;
}

export async function reactToMessage(threadId: string, messageId: string, emoji: string): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(80); return { ok: true }; }
  const { data } = await api.post(`/associations/chat/threads/${threadId}/messages/${messageId}/react`, { emoji });
  return data;
}
