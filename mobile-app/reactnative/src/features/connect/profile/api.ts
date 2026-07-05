// Paymax Connect — Unified Profile API (PRD §10.4 PR-*).
// Mock-first (USE_MOCK). Live path hits `${CONNECT_API_BASE}/profile/...` on the
// Go backend.
//
// SAFETY: date (romantic) and network (professional) profiles are SEPARATE.
// Their bios/headlines/intents/photos are never merged — every mutation is
// scoped to a single `mode`. Location precision defaults to 'approximate' (§3).

import { api } from '@/api/client';
import { USE_MOCK, CONNECT_API_BASE } from '../constants/connect.constants';
import type {
  UnifiedProfile,
  ModeProfile,
  ConnectMode,
  PrivacySettings,
  VerificationBadge,
  EditProfileInput,
} from './types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

const PHOTO = (seed: string) => `https://images.unsplash.com/${seed}?auto=format&fit=crop&w=800&q=60`;

// ── Mutable mock store ───────────────────────────────────────────────────────
// A single in-memory profile so edits/reorders/removes persist across calls
// within a session (mock-first). The live backend owns the real store.
const MOCK_PROFILE: UnifiedProfile = {
  id: 'me',
  displayName: 'Ada',
  age: 28,
  dateProfile: {
    mode: 'date',
    visible: true,
    intent: 'Long-term',
    headline: 'Design lead who loves live music',
    bio: 'Lagos-born product designer. Sunday markets, Afrobeats gigs and long beach walks at Tarkwa Bay. Looking for someone warm, curious and kind.',
    photos: [
      PHOTO('photo-1488426862026-3ee34a7d66df'),
      PHOTO('photo-1524504388940-b1c1722653e1'),
      PHOTO('photo-1517841905240-472988babdf9'),
    ],
    interests: ['Design', 'Music', 'Travel', 'Food'],
  },
  networkProfile: {
    mode: 'network',
    visible: true,
    intent: 'Mentoring',
    headline: 'Product Design Lead · fintech',
    bio: 'Leading design at a Lagos fintech. Happy to mentor junior designers and trade notes on design systems, research and African payments UX.',
    photos: [
      PHOTO('photo-1573497019940-1c28c88b4f3e'),
      PHOTO('photo-1580489944761-15a19d654956'),
    ],
    interests: ['Design', 'Startups', 'Tech', 'Wellness'],
  },
  verification: {
    selfie: true,
    identity: true,
    photo: false,
  },
};

// SAFETY: approximate-by-default location precision (§3).
const MOCK_PRIVACY: PrivacySettings = {
  dateVisible: true,
  networkVisible: true,
  locationPrecision: 'approximate',
  showOnlineStatus: true,
  showDistance: true,
  readReceipts: true,
};

function modeRef(mode: ConnectMode): ModeProfile {
  return mode === 'date' ? MOCK_PROFILE.dateProfile : MOCK_PROFILE.networkProfile;
}

// ── Unified profile (PR-01) ──────────────────────────────────────────────────
export async function getUnifiedProfile(): Promise<UnifiedProfile> {
  if (USE_MOCK) {
    await delay();
    // deep-ish copy so callers can't mutate the store
    return {
      ...MOCK_PROFILE,
      dateProfile: { ...MOCK_PROFILE.dateProfile, photos: [...MOCK_PROFILE.dateProfile.photos], interests: [...MOCK_PROFILE.dateProfile.interests] },
      networkProfile: { ...MOCK_PROFILE.networkProfile, photos: [...MOCK_PROFILE.networkProfile.photos], interests: [...MOCK_PROFILE.networkProfile.interests] },
      verification: { ...MOCK_PROFILE.verification },
    };
  }
  const res = await api.get(`${CONNECT_API_BASE}/profile`);
  return unwrap<UnifiedProfile>(res);
}

// ── Edit one mode's profile (PR-02). Scoped to a single mode. ────────────────
export async function updateModeProfile(input: EditProfileInput): Promise<ModeProfile> {
  if (USE_MOCK) {
    await delay(360);
    const target = modeRef(input.mode);
    target.headline = input.headline;
    target.bio = input.bio;
    target.intent = input.intent;
    target.interests = [...input.interests];
    return { ...target, photos: [...target.photos], interests: [...target.interests] };
  }
  const res = await api.post(`${CONNECT_API_BASE}/profile/${input.mode}`, input);
  return unwrap<ModeProfile>(res);
}

// ── Per-mode visibility wall (PR-01 / privacy). ──────────────────────────────
export async function setModeVisibility(
  mode: ConnectMode,
  visible: boolean,
): Promise<{ ok: true; mode: ConnectMode; visible: boolean }> {
  if (USE_MOCK) {
    await delay(200);
    modeRef(mode).visible = visible;
    // keep privacy mirror consistent so the privacy screen agrees
    if (mode === 'date') MOCK_PRIVACY.dateVisible = visible;
    else MOCK_PRIVACY.networkVisible = visible;
    return { ok: true, mode, visible };
  }
  const res = await api.post(`${CONNECT_API_BASE}/profile/${mode}/visibility`, { visible });
  return unwrap<{ ok: true; mode: ConnectMode; visible: boolean }>(res);
}

// ── Privacy (PR-04) ──────────────────────────────────────────────────────────
export async function getPrivacy(): Promise<PrivacySettings> {
  if (USE_MOCK) {
    await delay(200);
    return { ...MOCK_PRIVACY };
  }
  const res = await api.get(`${CONNECT_API_BASE}/profile/privacy`);
  return unwrap<PrivacySettings>(res);
}

export async function updatePrivacy(p: PrivacySettings): Promise<PrivacySettings> {
  if (USE_MOCK) {
    await delay(240);
    Object.assign(MOCK_PRIVACY, p);
    // visibility toggles here mirror the per-mode walls
    MOCK_PROFILE.dateProfile.visible = MOCK_PRIVACY.dateVisible;
    MOCK_PROFILE.networkProfile.visible = MOCK_PRIVACY.networkVisible;
    return { ...MOCK_PRIVACY };
  }
  const res = await api.post(`${CONNECT_API_BASE}/profile/privacy`, p);
  return unwrap<PrivacySettings>(res);
}

// ── Photos (PR-03). Photos are per-mode and never shared across modes. ───────
export async function getPhotos(mode: ConnectMode): Promise<string[]> {
  if (USE_MOCK) {
    await delay(200);
    return [...modeRef(mode).photos];
  }
  const res = await api.get(`${CONNECT_API_BASE}/profile/${mode}/photos`);
  return unwrap<string[]>(res);
}

export async function reorderPhotos(mode: ConnectMode, photos: string[]): Promise<string[]> {
  if (USE_MOCK) {
    await delay(220);
    modeRef(mode).photos = [...photos];
    return [...modeRef(mode).photos];
  }
  const res = await api.post(`${CONNECT_API_BASE}/profile/${mode}/photos/reorder`, { photos });
  return unwrap<string[]>(res);
}

export async function removePhoto(mode: ConnectMode, uri: string): Promise<string[]> {
  if (USE_MOCK) {
    await delay(220);
    const target = modeRef(mode);
    target.photos = target.photos.filter((p) => p !== uri);
    return [...target.photos];
  }
  const res = await api.post(`${CONNECT_API_BASE}/profile/${mode}/photos/remove`, { uri });
  return unwrap<string[]>(res);
}

// ── Verification badges (PR-05) ──────────────────────────────────────────────
export async function getBadges(): Promise<VerificationBadge[]> {
  if (USE_MOCK) {
    await delay(200);
    const v = MOCK_PROFILE.verification;
    return [
      {
        kind: 'selfie',
        label: 'Selfie verification',
        state: v.selfie ? 'verified' : 'unverified',
        description: 'A live selfie check confirms you match your photos. This is the badge other people trust most.',
      },
      {
        kind: 'identity',
        label: 'Identity verification',
        state: v.identity ? 'verified' : 'unverified',
        description: 'Your BVN or NIN is linked. Unlocks higher tiers, gifting and withdrawals.',
      },
      {
        kind: 'photo',
        label: 'Photo verification',
        state: v.photo ? 'verified' : 'unverified',
        description: 'Adds a verified badge to your photos so people know they are recent and really you.',
      },
    ];
  }
  const res = await api.get(`${CONNECT_API_BASE}/profile/badges`);
  return unwrap<VerificationBadge[]>(res);
}

// New unsplash placeholder for the "add photo" tile (mock only).
export const PLACEHOLDER_PHOTOS = [
  PHOTO('photo-1506794778202-cad84cf45f1d'),
  PHOTO('photo-1534528741775-53994a69daeb'),
  PHOTO('photo-1519085360753-af0119f7cbe7'),
  PHOTO('photo-1500648767791-00dcc994a43e'),
];
