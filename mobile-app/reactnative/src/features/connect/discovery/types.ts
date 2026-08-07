// Paymax Connect — Discovery & Matching types (PRD §10.2 DC-*).
//
// Self-contained discovery slice. Reuses ConnectColors / USE_MOCK /
// CONNECT_API_BASE from ../constants/connect.constants and the shared
// ConnectIntent / TierStatus shapes are mirrored locally so this slice never
// imports the agent-owned connect.types beyond what is necessary.
//
// SAFETY INVARIANTS upheld here (docs/prd/dating/CLAUDE.md):
//  §3 location approximate-by-default — Profile.distanceLabel is fuzzed text.
//  §4 no messaging before a mutual match — a swipe/like never opens a thread;
//     only an `it's-a-match` result unlocks chat.

import type { ConnectTier } from '../types/connect.types';

// Discovery operates within one of three modes (PRD §5 / §10.4). Date mode is
// swipe-first and gated by the match rule; Network mode is request-to-connect.
export type DiscoveryMode = 'date' | 'network' | 'discover';

export type VerificationFlag = 'selfie' | 'identity' | 'photo';

export interface ProfilePrompt {
  prompt: string;
  answer: string;
}

// Coarse distance band the backend returns instead of raw coordinates (§3).
// The client NEVER receives lat/lng — proximity is bucketed server-side so a
// precise location can never be reconstructed. `distanceLabel` is the human
// copy; `distanceBucket` drives grouping / ordering on the nearby surface.
export type DistanceBucket = 'here' | 'near' | 'city' | 'far';

// A discovery candidate card (backend ProfileCard, camelCase). Location is
// ALWAYS bucketed/approximate (§3); the backend NEVER sends raw lat/lng.
export interface DiscoveryProfile {
  id: string;
  displayName: string;
  age: number;
  headline?: string;          // networking / discover headline
  bio?: string;
  photos: string[];           // remote URIs (primary = index 0)
  interests: string[];
  prompts: ProfilePrompt[];
  // Approximate distance copy only (e.g. "~3 km away"). Never exact.
  distanceLabel: string;
  // Coarse proximity band (from /discovery/nearby). Optional on the stack.
  distanceBucket?: DistanceBucket;
  // Which verifications this profile has passed (drives the badge row).
  verified: VerificationFlag[];
  // Whether this profile already liked the viewer (powers likes-you + match).
  likedYou?: boolean;
  // Networking-only enrichment.
  occupation?: string;
  company?: string;
  mutualConnections?: number;
  // Which discovery personas this profile surfaces in (date / network / discover).
  // Absent ⇒ treated as all modes (back-compat).
  modes?: DiscoveryMode[];
}

export interface DiscoveryFilters {
  mode: DiscoveryMode;
  minAge: number;
  maxAge: number;
  maxDistanceKm: number;
  verifiedOnly: boolean;
  interests: string[];
}

// UI-facing swipe intent. The API layer maps `super` → the backend's
// `superlike` wire value (contract: direction ∈ 'like'|'pass'|'superlike').
export type SwipeAction = 'like' | 'pass' | 'super';

// Wire value sent to POST /discovery/swipe as { targetId, direction }.
export type SwipeDirection = 'like' | 'pass' | 'superlike';

// Result of a swipe. `matched` is the ONLY way a Date-mode chat is unlocked (§4).
// Backend returns { match: boolean, matchId?: string }; the client re-attaches
// the swiped `profile` (from the local stack) for the it's-a-match modal, and
// derives `threadId` from `matchId` when matched (the thread opens on the match).
export interface SwipeResult {
  matched: boolean;
  matchId?: string;
  threadId?: string;          // present iff matched — gates messaging entry
  profile?: DiscoveryProfile; // echo for the it's-a-match modal (client-attached)
}

export interface LikesYouEntry {
  id: string;
  profile: DiscoveryProfile;
  likedAt: string;
  isSuper: boolean;
}

// Likes-you is premium-gated (DC-05). When locked the server returns blurred
// previews + a count so the UI can render the upsell without leaking identity.
export interface LikesYouResponse {
  locked: boolean;
  count: number;
  entries: LikesYouEntry[];   // empty when locked
}

export interface DailyPick {
  id: string;
  profile: DiscoveryProfile;
  reason: string;             // why we picked them ("Shared 4 interests")
}

// An active or just-purchased boost (backend `Boost`, camelCase).
export interface Boost {
  id: string;
  startsAt: string;           // ISO
  expiresAt: string;          // ISO — used to show the active-boost countdown
  multiplier?: number;        // optional visibility multiplier for display
}

// Boost / Spotlight is wallet-funded (DC-08): the purchase surface MUST render
// tier + remaining daily limit (PRD §10 note). Prices are kobo (minor units).
// Mirrors GET /discovery/boosts → { activeBoost?, priceKobo, durationMinutes }.
export interface BoostOffer {
  activeBoost?: Boost;
  priceKobo: number;
  durationMinutes: number;
}

// POST /discovery/boosts → { boost }. The client re-shapes this into the
// success surface (expiresAt drives the "active until" copy).
export interface BoostPurchaseResult {
  boost: Boost;
}

// Rewind / undo is premium (DC-09). Returns the profile pushed back onto the stack.
export interface RewindResult {
  ok: boolean;
  restored?: DiscoveryProfile;
  reason?: string;            // present when !ok (e.g. premium-required)
}

// Local copy of the tier shape needed by the boost purchase surface so this
// slice does not have to re-fetch the agent-owned wallet hook.
export interface DiscoveryTierStatus {
  tier: ConnectTier;
  label: string;
  dailyLimitKobo: number | null;
  remainingKobo: number | null;
}
