// Paymax Connect — LIVE STREAMING types (PRD §6.2, §10.6 LV-*, §10.7 LB-*).
// SAFETY: gifts are REAL Naira wallet money (kobo). Media is moderated before
// it is publicly visible. Going live + payouts are tier-gated (Tier 2+).

import type { ConnectTier } from '../types/connect.types';

export type LiveFormat = 'single' | 'multi' | 'pk' | 'audio';

export type LiveCategory =
  | 'all'
  | 'music'
  | 'talk'
  | 'gaming'
  | 'lifestyle'
  | 'events'
  | 'dance';

// A discoverable live stream card (LV-01..LV-03).
export interface LiveStream {
  id: string;
  title: string;
  hostName: string;
  hostId: string;
  hostAvatar: string;
  coverUrl: string;
  category: Exclude<LiveCategory, 'all'>;
  format: LiveFormat;
  viewerCount: number;
  // approximate location label only (SAFETY §3 — never exact by default)
  locationLabel?: string;
  distanceKm?: number;
  isFollowing: boolean;
  // moderation gate: a stream only renders publicly when moderated/approved.
  moderationState: 'approved' | 'pending' | 'flagged';
  startedAtIso: string;
}

// Chat message overlaid on the viewer (LV-04).
export interface LiveChatMessage {
  id: string;
  userId: string;
  userName: string;
  text: string;
  sentAtIso: string;
  isHost?: boolean;
  isSystem?: boolean;
}

// A gift = a wallet amount in kobo (LV-06). Rendered as a gamified item but it
// is REAL money. priceKobo is the actual debit.
export interface LiveGift {
  id: string;
  name: string;       // flower, rose, crown…
  icon: string;       // lucide icon name (verified to exist)
  priceKobo: number;  // integer minor units
  tierMin: ConnectTier; // minimum tier required to send
}

// Result of sending a gift (LV-07).
export interface GiftSendResult {
  ok: boolean;
  giftId: string;
  amountKobo: number;
  newRemainingKobo: number | null; // updated daily allowance (null => unlimited)
  ledgerRef: string;               // audit/ledger entry reference
}

// PK battle scoreboard (LV-05 / LB-05). Scores are gift-revenue totals in kobo.
export interface PkBattle {
  id: string;
  durationSec: number;
  remainingSec: number;
  teamA: PkTeam;
  teamB: PkTeam;
  state: 'live' | 'ended';
}

export interface PkTeam {
  hostId: string;
  hostName: string;
  hostAvatar: string;
  scoreKobo: number;   // total gift value attributed to this side
  topGifter?: string;
}

// Stream leaderboard entry (LV-09). amountKobo for gifters, none for streamers.
export interface LiveLeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  avatar: string;
  amountKobo?: number; // top gifters: real spend
  viewers?: number;    // top streamers: peak viewers
}

// Past stream / replay (LV-10 / LB-09). Replays are moderated VOD.
export interface StreamReplay {
  id: string;
  title: string;
  hostName: string;
  coverUrl: string;
  durationSec: number;
  views: number;
  recordedAtIso: string;
  giftRevenueKobo: number;
}

// Co-host request (LV-05 inbound / LB-04 outbound).
export interface CoHostRequest {
  id: string;
  fromUserId: string;
  fromName: string;
  fromAvatar: string;
  status: 'pending' | 'accepted' | 'declined';
  requestedAtIso: string;
}

// Report a stream (LV-13). Always produces a case id (SAFETY §7 — never silent).
export interface StreamReportReason {
  code: string;
  label: string;
  description?: string;
}

export interface StreamReportResult {
  caseId: string;
  status: 'received';
}

// Broadcaster preflight (LB-02): tier/KYC + device permission gate.
export interface BroadcastPreflight {
  tier: ConnectTier;
  tierLabel: string;
  canGoLive: boolean;       // Tier 2+ required
  cameraGranted: boolean;
  micGranted: boolean;
  networkOk: boolean;
  blockingReason?: string;
}

// Broadcaster live console state (LB-03 / LB-06 / LB-07).
export interface BroadcastSession {
  id: string;
  title: string;
  viewerCount: number;
  peakViewers: number;
  newFollowers: number;
  earningsKobo: number;   // live gift+vote revenue (real money)
  elapsedSec: number;
  coHostName?: string;
  muted: boolean;
}

// A viewer in the broadcaster moderation list (LB-06).
export interface LiveViewer {
  id: string;
  name: string;
  avatar: string;
  isMuted: boolean;
  isCoHost: boolean;
  joinedAtIso: string;
}

// End-of-stream summary (LB-08).
export interface StreamSummary {
  durationSec: number;
  peakViewers: number;
  newFollowers: number;
  giftRevenueKobo: number;
  voteRevenueKobo: number;
  totalEarningsKobo: number;
  topGifters: { name: string; amountKobo: number }[];
}
