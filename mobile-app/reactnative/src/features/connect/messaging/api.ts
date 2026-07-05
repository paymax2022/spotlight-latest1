// Paymax Connect — Messaging API (PRD §10.5 MS-*).
// Mock-first (USE_MOCK). Live path hits `${CONNECT_API_BASE}/messaging/...`.
//
// SAFETY:
//  §4 sendMessage REJECTS Date-mode threads whose gate !== 'matched'.
//  §7 reportUser / blockUser ALWAYS resolve with a caseId — never fail silently.

import { api } from '@/api/client';
import { USE_MOCK, CONNECT_API_BASE } from '../constants/connect.constants';
import type {
  InboxThread,
  ThreadDetail,
  Message,
  ConnectionRequest,
  Icebreaker,
  SafetyCaseResult,
  ReportReason,
  CallKind,
  CallSession,
} from './types';

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

const AV = (seed: string) => `https://images.unsplash.com/${seed}?auto=format&fit=crop&w=200&q=60`;

// ── Mock inbox ───────────────────────────────────────────────────────────────
const MOCK_THREADS: InboxThread[] = [
  { id: 'thread_p1', peerId: 'p1', peerName: 'Zainab', peerAvatar: AV('photo-1494790108377-be9c29b29330'), mode: 'date', gate: 'matched', lastMessage: 'That gallery in Ikoyi was unreal 😍', lastAt: new Date(Date.now() - 1800000).toISOString(), unread: 2, peerVerified: true, peerOnline: true },
  { id: 'thread_n3', peerId: 'n3', peerName: 'Aisha Bello', peerAvatar: AV('photo-1573164713988-8665fc963095'), mode: 'network', gate: 'matched', lastMessage: 'Happy to review your roadmap this week.', lastAt: new Date(Date.now() - 7200000).toISOString(), unread: 0, peerVerified: true, peerOnline: false },
  { id: 'thread_p3', peerId: 'p3', peerName: 'Amaka', peerAvatar: AV('photo-1534528741775-53994a69daeb'), mode: 'date', gate: 'matched', lastMessage: 'Icebreaker sent — say hi!', lastAt: new Date(Date.now() - 26 * 3600000).toISOString(), unread: 0, peerVerified: true, peerOnline: false },
];

const MOCK_MESSAGES: Record<string, Message[]> = {
  thread_p1: [
    { id: 'm1', threadId: 'thread_p1', fromMe: false, kind: 'system', body: "You matched with Zainab — say hello!", createdAt: new Date(Date.now() - 90000000).toISOString() },
    { id: 'm2', threadId: 'thread_p1', fromMe: true, kind: 'icebreaker', body: 'If you could redesign one everyday app, which one?', createdAt: new Date(Date.now() - 89000000).toISOString() },
    { id: 'm3', threadId: 'thread_p1', fromMe: false, kind: 'text', body: 'Easily the banking apps here — so much friction!', createdAt: new Date(Date.now() - 88000000).toISOString() },
    { id: 'm4', threadId: 'thread_p1', fromMe: false, kind: 'text', body: 'That gallery in Ikoyi was unreal 😍', createdAt: new Date(Date.now() - 1800000).toISOString() },
  ],
  thread_n3: [
    { id: 'm1', threadId: 'thread_n3', fromMe: false, kind: 'system', body: 'You are now connected with Aisha Bello.', createdAt: new Date(Date.now() - 80000000).toISOString() },
    { id: 'm2', threadId: 'thread_n3', fromMe: true, kind: 'text', body: 'Thanks for accepting! Would love your eyes on our discovery flow.', createdAt: new Date(Date.now() - 79000000).toISOString() },
    { id: 'm3', threadId: 'thread_n3', fromMe: false, kind: 'text', body: 'Happy to review your roadmap this week.', createdAt: new Date(Date.now() - 7200000).toISOString() },
  ],
  thread_p3: [
    { id: 'm1', threadId: 'thread_p3', fromMe: false, kind: 'system', body: 'You matched with Amaka — say hello!', createdAt: new Date(Date.now() - 100000000).toISOString() },
  ],
};

// ── Inbox (MS-01) ────────────────────────────────────────────────────────────
export async function getInbox(): Promise<InboxThread[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_THREADS.map((t) => ({ ...t }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/messaging/threads`);
  return unwrap<InboxThread[]>(res);
}

// ── Thread (MS-02) ───────────────────────────────────────────────────────────
export async function getThread(threadId: string): Promise<ThreadDetail> {
  if (USE_MOCK) {
    await delay(200);
    const row = MOCK_THREADS.find((t) => t.id === threadId) ?? MOCK_THREADS[0];
    return {
      id: row.id,
      peerId: row.peerId,
      peerName: row.peerName,
      peerAvatar: row.peerAvatar,
      mode: row.mode,
      gate: row.gate,
      peerVerified: row.peerVerified,
      peerOnline: row.peerOnline,
      messages: (MOCK_MESSAGES[threadId] ?? []).map((m) => ({ ...m })),
    };
  }
  const res = await api.get(`${CONNECT_API_BASE}/messaging/threads/${threadId}`);
  return unwrap<ThreadDetail>(res);
}

// ── Send (MS-02) — SAFETY §4: Date thread must be matched ─────────────────────
export async function sendMessage(
  thread: Pick<ThreadDetail, 'id' | 'mode' | 'gate'>,
  body: string,
  kind: Message['kind'] = 'text',
  locationLabel?: string,
): Promise<Message> {
  // Fail-closed gate check (mirrors the server). A Date thread that is not a
  // confirmed mutual match can NEVER receive a message (§4).
  if (thread.mode === 'date' && thread.gate !== 'matched') {
    throw new Error('You can only message after you both match.');
  }
  if (thread.gate === 'pending') {
    throw new Error('This request is still pending acceptance.');
  }
  if (USE_MOCK) {
    await delay(180);
    return {
      id: `m_${Date.now()}`,
      threadId: thread.id,
      fromMe: true,
      kind,
      body,
      createdAt: new Date().toISOString(),
      locationLabel,
    };
  }
  const res = await api.post(`${CONNECT_API_BASE}/messaging/threads/${thread.id}/messages`, { body, kind, locationLabel });
  return unwrap<Message>(res);
}

// ── Requests (MS-03) ─────────────────────────────────────────────────────────
const MOCK_REQUESTS: ConnectionRequest[] = [
  { id: 'rq1', fromId: 'n2', fromName: 'David Mensah', fromAvatar: AV('photo-1519085360753-af0119f7cbe7'), mode: 'network', kind: 'connect', note: "Loved your talk on payments infra — would value your perspective as we scale AgriPay.", createdAt: new Date(Date.now() - 3600000).toISOString(), mutualConnections: 3, verified: true },
  { id: 'rq2', fromId: 'p4', fromName: 'Kelechi', fromAvatar: AV('photo-1463453091185-61582044d556'), mode: 'date', kind: 'message', note: undefined, createdAt: new Date(Date.now() - 12 * 3600000).toISOString(), verified: true },
];

export async function getRequests(): Promise<ConnectionRequest[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_REQUESTS.map((r) => ({ ...r }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/messaging/requests`);
  return unwrap<ConnectionRequest[]>(res);
}

export async function respondToRequest(requestId: string, accept: boolean): Promise<{ ok: true; threadId?: string }> {
  if (USE_MOCK) {
    await delay(260);
    // Accepting a request is the ONLY way it becomes a messageable thread (§5).
    return { ok: true, threadId: accept ? `thread_${requestId}` : undefined };
  }
  const res = await api.post(`${CONNECT_API_BASE}/messaging/requests/${requestId}/${accept ? 'accept' : 'decline'}`);
  return unwrap<{ ok: true; threadId?: string }>(res);
}

// ── Icebreakers (MS-04) ──────────────────────────────────────────────────────
export const ICEBREAKERS: Icebreaker[] = [
  { id: 'ib1', text: 'If you could redesign one everyday app, which one?' },
  { id: 'ib2', text: "What's the best meal you've had in the last month?" },
  { id: 'ib3', text: 'Two truths and a lie — go!' },
  { id: 'ib4', text: "What's a project you're proud of right now?" },
  { id: 'ib5', text: 'Beach day or city adventure?' },
  { id: 'ib6', text: 'Who do you most want to learn from this year?' },
];

export async function getIcebreakers(): Promise<Icebreaker[]> {
  if (USE_MOCK) {
    await delay(120);
    return ICEBREAKERS.map((i) => ({ ...i }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/messaging/icebreakers`);
  return unwrap<Icebreaker[]>(res);
}

// ── Safety (MS-07) — SAFETY §7: always returns a caseId ──────────────────────
export const REPORT_REASONS: ReportReason[] = [
  { code: 'harassment', label: 'Harassment or bullying' },
  { code: 'scam', label: 'Scam or fraud' },
  { code: 'fake', label: 'Fake profile or impersonation' },
  { code: 'inappropriate', label: 'Inappropriate content' },
  { code: 'underage', label: 'User appears underage' },
  { code: 'other', label: 'Something else' },
];

export async function reportUser(peerId: string, reasonCode: string, details?: string): Promise<SafetyCaseResult> {
  if (USE_MOCK) {
    await delay(400);
    return {
      ok: true,
      caseId: `CASE-${Date.now().toString(36).toUpperCase()}`,
      action: 'report',
      message: 'Thanks — our safety team will review this report. You will not be matched with them again.',
    };
  }
  const res = await api.post(`${CONNECT_API_BASE}/safety/reports`, { targetUserId: peerId, reason: reasonCode, details });
  return unwrap<SafetyCaseResult>(res);
}

export async function blockUser(peerId: string): Promise<SafetyCaseResult> {
  if (USE_MOCK) {
    await delay(360);
    return {
      ok: true,
      caseId: `CASE-${Date.now().toString(36).toUpperCase()}`,
      action: 'block',
      message: 'User blocked. They can no longer see your profile or contact you.',
    };
  }
  const res = await api.post(`${CONNECT_API_BASE}/safety/blocks`, { targetUserId: peerId });
  return unwrap<SafetyCaseResult>(res);
}

export async function unmatch(threadId: string, peerId: string): Promise<SafetyCaseResult> {
  if (USE_MOCK) {
    await delay(300);
    return {
      ok: true,
      caseId: `CASE-${Date.now().toString(36).toUpperCase()}`,
      action: 'unmatch',
      message: 'You have unmatched. This conversation has been removed.',
    };
  }
  const res = await api.post(`${CONNECT_API_BASE}/messaging/threads/${threadId}/unmatch`, { peerId });
  return unwrap<SafetyCaseResult>(res);
}

// ── Calls (MS-08 / MS-09) ────────────────────────────────────────────────────
export async function startCall(threadId: string, peerName: string, kind: CallKind, peerAvatar?: string): Promise<CallSession> {
  if (USE_MOCK) {
    await delay(220);
    return {
      id: `call_${Date.now()}`,
      threadId,
      peerName,
      peerAvatar,
      kind,
      status: 'ringing',
      startedAt: new Date().toISOString(),
    };
  }
  const res = await api.post(`${CONNECT_API_BASE}/messaging/threads/${threadId}/calls`, { kind });
  return unwrap<CallSession>(res);
}
