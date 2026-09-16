// ── Association — Group chat API wrapper (I) ──────────────────────────────────
// Mock-flagged. Mirrors association.api.ts conventions.

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK, ASSOCIATION_API_BASE as BASE } from '../constants/association.constants';
import type {
  ChatThread,
  ChatThreadSummary,
  ChatMessage,
} from '../types/chat.types';
import { MOCK_THREADS } from './chat.mock';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

// Every write below has a real live endpoint (verified against
// backend/internal/association/routes.go and a full green run of
// backend/tests/association), so fixture mode has nothing to add and refuses
// loudly instead of reporting a write it did not perform — mirrors
// frontend-admin's crowdfundingAdminService.ts NOT_IN_FIXTURE_MODE pattern.
const notInFixtureMode = (action: string) =>
  new Error(`${action} is unavailable in fixture mode: this app will not report a write it did not perform. Set EXPO_PUBLIC_ASSOCIATION_USE_MOCK=false to send this against the live backend.`);

const toSummary = (t: ChatThread): ChatThreadSummary => {
  const { id, title, scope, lastMessage, lastAt, unreadCount, muted, memberCount, postingBlock } = t;
  return { id, title, scope, lastMessage, lastAt, unreadCount, muted, memberCount, postingBlock };
};

export async function getThreads(): Promise<ChatThreadSummary[]> {
  if (USE_MOCK) { await delay(); return MOCK_THREADS.map(toSummary); }
  const { data } = await api.get(`${BASE}/chat/threads`);
  return data;
}

export async function getThread(id: string): Promise<ChatThread> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_THREADS.find((t) => t.id === id);
    if (!found) throw new Error('Thread not found');
    return found;
  }
  const { data } = await api.get(`${BASE}/chat/threads/${id}`);
  return data;
}

export async function sendMessage(threadId: string, body: string, imageUrl?: string | null): Promise<ChatMessage> {
  if (USE_MOCK) throw notInFixtureMode('Sending a message');
  const { data } = await api.post(
    `${BASE}/chat/threads/${threadId}/messages`,
    { body, imageUrl: imageUrl ?? null },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  return data;
}

export async function muteThread(threadId: string, muted: boolean): Promise<{ ok: true }> {
  if (USE_MOCK) throw notInFixtureMode('Muting a thread');
  const { data } = await api.post(`${BASE}/chat/threads/${threadId}/mute`, { muted });
  return data;
}

export async function reactToMessage(threadId: string, messageId: string, emoji: string): Promise<{ ok: true }> {
  if (USE_MOCK) throw notInFixtureMode('Reacting to a message');
  const { data } = await api.post(`${BASE}/chat/threads/${threadId}/messages/${messageId}/react`, { emoji });
  return data;
}
