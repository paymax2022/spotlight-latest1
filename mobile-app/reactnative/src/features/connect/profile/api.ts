// Paymax Connect — Unified Profile API (PRD §10.4 PR-*).
// Mock-first (USE_MOCK). Live path hits `${CONNECT_API_BASE}/profile/...` on the
// Go backend.
// The backend stores ONE profile per member (details + photos) plus per-mode
// visibility; the Date/Network views are built from that record, with each mode
// keeping its own visibility wall and "intent". Location precision defaults to
// 'approximate' (§3).

import { api } from '@/api/client';
import { USE_MOCK, CONNECT_API_BASE } from '../constants/connect.constants';
import { uploadProfilePhoto } from './upload';
import type {
  UnifiedProfile,
  ProfilePhoto,
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

// ─── Live mapping ────────────────────────────────────────────────────────────
// GET /connect/profile/me returns ONE profile (details + modes + photos). The UI
// still presents a Date and a Network view, so both are built from that single
// record: bio, headline, interests and photos are shared; each mode contributes
// its own visibility and "intent" (stored in profile preferences).
const MODE_SLUG: Record<ConnectMode, string> = { date: 'dating', network: 'professional' };

type ServerPhoto = { id: string; url: string; moderation_status?: string };
type ServerMode = { mode: string; visible?: boolean; intent_tags?: string[] };
type ServerProfile = {
  id: string;
  display_name?: string;
  age?: number;
  gender?: string;
  headline?: string;
  bio?: string;
  city?: string;
  interests?: string[];
  preferences?: Record<string, unknown>;
  verified_badge?: boolean;
  modes?: ServerMode[];
  photos?: ServerPhoto[];
};

function mapPhoto(p: ServerPhoto): ProfilePhoto {
  const st = p.moderation_status;
  return { id: p.id, url: p.url, status: st === 'approved' || st === 'rejected' ? st : 'pending' };
}

function mapProfile(d: ServerProfile): UnifiedProfile {
  const photoItems = (d.photos ?? []).map(mapPhoto);
  const prefs = d.preferences ?? {};
  const build = (mode: ConnectMode): ModeProfile => {
    const m = (d.modes ?? []).find((x) => x.mode === MODE_SLUG[mode]);
    const saved = prefs[`intent_${mode}`];
    return {
      mode,
      visible: m?.visible ?? false,
      intent: typeof saved === 'string' ? saved : '',
      headline: d.headline ?? '',
      bio: d.bio ?? '',
      photos: photoItems.map((p) => p.url),
      interests: d.interests ?? [],
    };
  };
  return {
    id: d.id,
    displayName: d.display_name ?? '',
    age: d.age ?? 0,
    gender: d.gender ?? '',
    city: d.city ?? '',
    photoItems,
    preferences: prefs,
    dateProfile: build('date'),
    networkProfile: build('network'),
    verification: { selfie: !!d.verified_badge, identity: false, photo: false },
  };
}

async function fetchLiveProfile(): Promise<UnifiedProfile> {
  const res = await api.get(`${CONNECT_API_BASE}/profile/me`);
  return mapProfile(unwrap<ServerProfile>(res));
}

// ─── Mock store ──────────────────────────────────────────────────────────────
// A single in-memory profile so edits/reorders/removes persist across calls
// within a session (mock-first). The live backend owns the real store.
const MOCK_PHOTOS: ProfilePhoto[] = [
  { id: 'p1', url: PHOTO('photo-1488426862026-3ee34a7d66df'), status: 'approved' },
  { id: 'p2', url: PHOTO('photo-1524504388940-b1c1722653e1'), status: 'approved' },
  { id: 'p3', url: PHOTO('photo-1517841905240-472988babdf9'), status: 'pending' },
];

const MOCK_PROFILE: UnifiedProfile = {
  id: 'me',
  displayName: 'Ada',
  age: 28,
  gender: 'Female',
  city: 'Lagos',
  photoItems: MOCK_PHOTOS,
  preferences: {},
  dateProfile: {
    mode: 'date',
    visible: true,
    intent: 'Long-term',
    headline: 'Design lead who loves live music',
    bio: 'Lagos-born product designer. Sunday markets, Afrobeats gigs and long beach walks at Tarkwa Bay. Looking for someone warm, curious and kind.',
    photos: MOCK_PHOTOS.map((p) => p.url),
    interests: ['Design', 'Music', 'Travel', 'Food'],
  },
  networkProfile: {
    mode: 'network',
    visible: true,
    intent: 'Mentoring',
    headline: 'Product Design Lead · fintech',
    bio: 'Leading design at a Lagos fintech. Happy to mentor junior designers and trade notes on design systems, research and African payments UX.',
    photos: MOCK_PHOTOS.map((p) => p.url),
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

function syncMockPhotos() {
  const urls = MOCK_PHOTOS.map((p) => p.url);
  MOCK_PROFILE.dateProfile.photos = [...urls];
  MOCK_PROFILE.networkProfile.photos = [...urls];
}

function cloneMock(): UnifiedProfile {
  return {
    ...MOCK_PROFILE,
    photoItems: MOCK_PHOTOS.map((p) => ({ ...p })),
    preferences: { ...MOCK_PROFILE.preferences },
    dateProfile: { ...MOCK_PROFILE.dateProfile, photos: [...MOCK_PROFILE.dateProfile.photos], interests: [...MOCK_PROFILE.dateProfile.interests] },
    networkProfile: { ...MOCK_PROFILE.networkProfile, photos: [...MOCK_PROFILE.networkProfile.photos], interests: [...MOCK_PROFILE.networkProfile.interests] },
    verification: { ...MOCK_PROFILE.verification },
  };
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export async function getUnifiedProfile(): Promise<UnifiedProfile> {
  if (USE_MOCK) {
    await delay();
    return cloneMock();
  }
  return fetchLiveProfile();
}

export async function updateModeProfile(input: EditProfileInput): Promise<ModeProfile> {
  if (USE_MOCK) {
    await delay(360);
    // bio/headline/interests/identity fields are shared; intent is per-mode.
    for (const t of [MOCK_PROFILE.dateProfile, MOCK_PROFILE.networkProfile]) {
      t.headline = input.headline;
      t.bio = input.bio;
      t.interests = [...input.interests];
    }
    if (input.displayName !== undefined) MOCK_PROFILE.displayName = input.displayName;
    if (input.city !== undefined) MOCK_PROFILE.city = input.city;
    if (input.gender !== undefined) MOCK_PROFILE.gender = input.gender;
    modeRef(input.mode).intent = input.intent;
    const t = modeRef(input.mode);
    return { ...t, photos: [...t.photos], interests: [...t.interests] };
  }
  // preferences REPLACES server-side, so merge into what is already saved.
  const current = await fetchLiveProfile();
  const body: Record<string, unknown> = {
    headline: input.headline,
    bio: input.bio,
    interests: input.interests,
    preferences: { ...current.preferences, [`intent_${input.mode}`]: input.intent },
  };
  if (input.displayName !== undefined) body.display_name = input.displayName;
  if (input.city !== undefined) body.city = input.city;
  if (input.gender !== undefined) body.gender = input.gender;
  await api.patch(`${CONNECT_API_BASE}/profile`, body);
  const fresh = await fetchLiveProfile();
  return input.mode === 'date' ? fresh.dateProfile : fresh.networkProfile;
}

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
  await api.patch(`${CONNECT_API_BASE}/profile/modes/${MODE_SLUG[mode]}`, { visible });
  return { ok: true, mode, visible };
}

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

// ─── Photos ──────────────────────────────────────────────────────────────────
// Photos belong to the member's single profile (not to a mode); index 0 is the
// primary. Live: presign → PUT to R2 → register; reorder/delete by photo id.

export async function getPhotos(): Promise<ProfilePhoto[]> {
  if (USE_MOCK) {
    await delay(200);
    return MOCK_PHOTOS.map((p) => ({ ...p }));
  }
  return (await fetchLiveProfile()).photoItems;
}

/** Uploads a picked image and attaches it to the profile. Returns the new list. */
export async function addPhoto(uri: string, mimeHint?: string | null): Promise<ProfilePhoto[]> {
  if (USE_MOCK) {
    await delay(300);
    MOCK_PHOTOS.push({ id: `p${Date.now()}`, url: uri, status: 'pending' });
    syncMockPhotos();
    return MOCK_PHOTOS.map((p) => ({ ...p }));
  }
  await uploadProfilePhoto(uri, mimeHint);
  return (await fetchLiveProfile()).photoItems;
}

export async function reorderPhotos(ids: string[]): Promise<ProfilePhoto[]> {
  if (USE_MOCK) {
    await delay(220);
    const byId = new Map(MOCK_PHOTOS.map((p) => [p.id, p]));
    const next = ids.map((id) => byId.get(id)).filter((p): p is ProfilePhoto => !!p);
    MOCK_PHOTOS.splice(0, MOCK_PHOTOS.length, ...next);
    syncMockPhotos();
    return MOCK_PHOTOS.map((p) => ({ ...p }));
  }
  await api.put(`${CONNECT_API_BASE}/profile/media/order`, { ids });
  return (await fetchLiveProfile()).photoItems;
}

export async function removePhoto(id: string): Promise<ProfilePhoto[]> {
  if (USE_MOCK) {
    await delay(220);
    const i = MOCK_PHOTOS.findIndex((p) => p.id === id);
    if (i >= 0) MOCK_PHOTOS.splice(i, 1);
    syncMockPhotos();
    return MOCK_PHOTOS.map((p) => ({ ...p }));
  }
  await api.delete(`${CONNECT_API_BASE}/profile/media/${id}`);
  return (await fetchLiveProfile()).photoItems;
}

export async function getBadges(): Promise<VerificationBadge[]> {
  if (USE_MOCK) {
    await delay(200);
    const v = MOCK_PROFILE.verification;
    return badgeList(v);
  }
  const p = await fetchLiveProfile();
  return badgeList(p.verification);
}

function badgeList(v: UnifiedProfile['verification']): VerificationBadge[] {
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
