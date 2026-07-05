// Paymax Connect — Messaging types (PRD §10.5 MS-*).
//
// Self-contained messaging slice. Reuses ConnectColors / USE_MOCK /
// CONNECT_API_BASE from ../constants/connect.constants.
//
// SAFETY INVARIANTS upheld here (docs/prd/dating/CLAUDE.md):
//  §4 No message before a mutual MATCH in Date mode — a Date thread carries
//     `gate: 'matched' | 'unmatched'`; the composer is hard-locked unless matched.
//  §5 Network threads originate from an ACCEPTED connection request; pending
//     requests live in the requests tab and cannot be messaged yet.
//  §7 report / block ALWAYS create a case (returns a caseId) and never fail
//     silently; block also tears the thread down.

import type { DiscoveryMode } from '../discovery/types';

export type ThreadGate = 'matched' | 'pending' | 'unmatched';

// Inbox row (MS-01). `gate` decides whether the thread is openable & messageable.
export interface InboxThread {
  id: string;
  peerId: string;
  peerName: string;
  peerAvatar?: string;
  mode: DiscoveryMode;          // 'date' threads enforce the match rule (§4)
  gate: ThreadGate;
  lastMessage?: string;
  lastAt?: string;             // ISO
  unread: number;
  peerVerified: boolean;
  peerOnline: boolean;
}

export type MessageKind = 'text' | 'icebreaker' | 'system' | 'location';

export interface Message {
  id: string;
  threadId: string;
  fromMe: boolean;
  kind: MessageKind;
  body: string;
  createdAt: string;
  // for kind === 'location' — approximate copy only (§3), never raw coords
  locationLabel?: string;
}

// Full thread payload (MS-02). `gate` mirrors the inbox row and gates the composer.
export interface ThreadDetail {
  id: string;
  peerId: string;
  peerName: string;
  peerAvatar?: string;
  mode: DiscoveryMode;
  gate: ThreadGate;
  peerVerified: boolean;
  peerOnline: boolean;
  messages: Message[];
}

// Incoming connection / message requests (MS-03 / NW request inbox).
export type RequestKind = 'connect' | 'message';

export interface ConnectionRequest {
  id: string;
  fromId: string;
  fromName: string;
  fromAvatar?: string;
  mode: DiscoveryMode;
  kind: RequestKind;
  note?: string;               // the request-to-connect note (NW-04)
  createdAt: string;
  mutualConnections?: number;
  verified: boolean;
}

export interface Icebreaker {
  id: string;
  text: string;
}

// ── Safety (MS-07) — report/block/unmatch ────────────────────────────────────
// Every report/block call MUST return a caseId (§7); UI must never swallow it.
export interface SafetyCaseResult {
  ok: boolean;
  caseId: string;
  action: 'report' | 'block' | 'unmatch';
  message: string;             // user-facing confirmation copy
}

export interface ReportReason {
  code: string;
  label: string;
}

// ── Calls (MS-08 / MS-09) ────────────────────────────────────────────────────
export type CallKind = 'voice' | 'video';
export type CallStatus = 'connecting' | 'ringing' | 'active' | 'ended' | 'failed';

export interface CallSession {
  id: string;
  threadId: string;
  peerName: string;
  peerAvatar?: string;
  kind: CallKind;
  status: CallStatus;
  startedAt?: string;
}
