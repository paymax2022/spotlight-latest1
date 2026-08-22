import { env } from '@/config/env';
import type { ChatSession, ChatSessionDetail } from '@/types/chat';

export async function listChatSessions(limit = 100): Promise<ChatSession[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/chatbot/sessions`);
  url.searchParams.set('limit', String(limit));

  const headers: Record<string, string> = {};

  const res = await fetch(url.toString(), { cache: 'no-store', credentials: 'include', headers });
  const payload = await res.json();
  if (!res.ok || !payload?.success || !Array.isArray(payload?.chats)) return [];
  return payload.chats as ChatSession[];
}

export async function getChatSessionDetail(sessionId: string): Promise<ChatSessionDetail> {
  const headers: Record<string, string> = {};

  const res = await fetch(`${env.apiBaseUrl}/admin/chatbot/sessions/${encodeURIComponent(sessionId)}`, {
    cache: 'no-store',
    credentials: 'include',
    headers,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success) {
    return { session: null, messages: [], events: [] };
  }
  return {
    session: payload?.session || null,
    messages: Array.isArray(payload?.messages) ? payload.messages : [],
    events: Array.isArray(payload?.events) ? payload.events : [],
  };
}
