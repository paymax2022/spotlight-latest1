// Paymax Connect — Networking types (PRD §10.3 NW-*).
//
// Self-contained networking slice. Reuses ConnectColors / USE_MOCK /
// CONNECT_API_BASE from ../constants/connect.constants.
//
// SAFETY INVARIANTS upheld here (docs/prd/dating/CLAUDE.md):
//  §5 Network mode is request-to-connect: you send a connection REQUEST with an
//     optional note — a thread is NOT created until the request is accepted.
//  §3 location approximate-by-default — NetworkProfile.distanceLabel is fuzzed.

import type { VerificationFlag } from '../discovery/types';

// A professional profile surfaced in the networking feed (NW-01).
export interface NetworkProfile {
  id: string;
  displayName: string;
  headline: string;            // "Backend engineer · Lagos"
  occupation: string;
  company?: string;
  bio?: string;
  photos: string[];            // remote URIs (primary = index 0)
  skills: string[];
  interests: string[];
  distanceLabel: string;       // approximate copy only (§3)
  verified: VerificationFlag[];
  mutualConnections: number;
  openTo: string[];            // "Mentoring", "Co-founders", "Hiring"
  endorsements: number;
  // request lifecycle relative to the viewer
  connectionState: ConnectionState;
}

export type ConnectionState = 'none' | 'requested' | 'incoming' | 'connected';

export interface NetworkFilters {
  query: string;
  maxDistanceKm: number;
  verifiedOnly: boolean;
  skills: string[];
  openTo: string[];
}

// Result of sending a request-to-connect (NW-04). NEVER returns a threadId —
// messaging is unlocked only after the recipient accepts (§5).
export interface ConnectRequestResult {
  ok: boolean;
  requestId: string;
  state: ConnectionState;       // -> 'requested'
}

// Endorsement of a skill (NW-11).
export interface Endorsement {
  id: string;
  skill: string;
  endorserName: string;
  endorserAvatar?: string;
  endorsedAt: string;
}

export interface EndorsableSkill {
  skill: string;
  count: number;
  endorsedByViewer: boolean;
}

// ── Communities (NW-05..NW-07) ───────────────────────────────────────────────
export interface Community {
  id: string;
  name: string;
  description: string;
  coverUrl?: string;
  category: string;
  memberCount: number;
  isPrivate: boolean;
  joined: boolean;
}

export interface CommunityPost {
  id: string;
  authorName: string;
  authorAvatar?: string;
  body: string;
  createdAt: string;
  likes: number;
  comments: number;
}

export interface CreateCommunityInput {
  name: string;
  description: string;
  category: string;
  isPrivate: boolean;
}

// ── Events (NW-08..NW-10) ────────────────────────────────────────────────────
export type RsvpState = 'none' | 'going' | 'interested';

export interface NetworkEvent {
  id: string;
  title: string;
  description: string;
  coverUrl?: string;
  startsAt: string;            // ISO
  venue: string;
  city: string;
  isOnline: boolean;
  hostName: string;
  attendeeCount: number;
  capacity?: number;
  priceKobo: number;          // 0 => free; money is ALWAYS kobo
  rsvp: RsvpState;
  tags: string[];
}

export interface CreateEventInput {
  title: string;
  description: string;
  startsAt: string;
  venue: string;
  city: string;
  isOnline: boolean;
  priceKobo: number;
}
