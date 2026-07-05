// Paymax Connect — Unified Profile types (PRD §10.4 PR-*).
//
// Self-contained profile slice. Mirrors the agent-owned PrivacyPrefs / ConnectMode
// shapes locally so this slice never hard-depends on those beyond a read-only
// import where convenient. Money is never handled here.
//
// SAFETY INVARIANTS upheld here (docs/prd/dating/CLAUDE.md):
//  §3 location approximate-by-default — PrivacySettings.locationPrecision defaults
//     to 'approximate'.
//  Romantic (date) vs professional (network) profiles are SEPARATE surfaces —
//     their bios, headlines, intents and photos must NEVER be merged. Each mode
//     has its own ModeProfile and its own visibility wall.

// Re-declared locally so the slice stays self-contained.
export type ConnectMode = 'date' | 'network';

// A single per-mode profile. Date and Network each own one of these; they are
// never blended. `visible` is the per-mode discovery wall (SAFETY: a hidden mode
// is undiscoverable in that surface regardless of the other mode's state).
export interface ModeProfile {
  mode: ConnectMode;
  visible: boolean;
  intent: string;        // romantic intent (date) OR professional intent (network)
  headline: string;
  bio: string;
  photos: string[];      // remote URIs (primary = index 0)
  interests: string[];
}

// The unified account view. Identity (name/age) is shared; everything else that
// is mode-specific lives behind dateProfile / networkProfile.
export interface UnifiedProfile {
  id: string;
  displayName: string;
  age: number;
  dateProfile: ModeProfile;
  networkProfile: ModeProfile;
  verification: {
    selfie: boolean;
    identity: boolean;
    photo: boolean;
  };
}

// Privacy settings mirror the agent-owned PrivacyPrefs shape (connect.types).
export interface PrivacySettings {
  dateVisible: boolean;
  networkVisible: boolean;
  locationPrecision: 'approximate' | 'precise'; // approximate by default (§3)
  showOnlineStatus: boolean;
  showDistance: boolean;
  readReceipts: boolean;
}

export type VerificationBadgeState = 'verified' | 'pending' | 'unverified';

export interface VerificationBadge {
  kind: 'selfie' | 'identity' | 'photo';
  label: string;
  state: VerificationBadgeState;
  description: string;
}

// Payload for editing one mode's profile. Mode is required so the server can
// never accidentally write date copy into the network profile or vice-versa.
export interface EditProfileInput {
  mode: ConnectMode;
  headline: string;
  bio: string;
  intent: string;
  interests: string[];
}
