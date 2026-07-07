// Paymax Connect — Discovery & Matching API (PRD §10.2 DC-*).
// Mock-first (USE_MOCK). Live path hits `${CONNECT_API_BASE}/discovery/...` on
// the Go backend. Money is ALWAYS kobo. Reports/blocks are owned by the
// messaging slice; discovery only matches.

import { api } from '@/api/client';
import { USE_MOCK, CONNECT_API_BASE } from '../constants/connect.constants';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  DiscoveryProfile,
  DiscoveryFilters,
  DiscoveryMode,
  SwipeAction,
  SwipeDirection,
  SwipeResult,
  LikesYouResponse,
  DailyPick,
  Boost,
  BoostOffer,
  BoostPurchaseResult,
  RewindResult,
  DiscoveryTierStatus,
} from './types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

// Thrown when the backend rejects a discovery read because the signed-in user has
// no Connect profile yet (HTTP 400 "create your profile first", stack.go ErrNoProfile).
// The UI catches this to route into onboarding rather than showing a generic error.
export class ProfileRequiredError extends Error {
  constructor() {
    super('connect: profile required');
    this.name = 'ProfileRequiredError';
  }
}

// Detects the "no Connect profile" rejection from an axios error. The backend
// returns { error: "create your profile first" } with status 400.
function isProfileRequired(err: unknown): boolean {
  const e = err as { response?: { status?: number; data?: { error?: string } } };
  const status = e?.response?.status;
  const msg = (e?.response?.data?.error ?? '').toLowerCase();
  return status === 400 && msg.includes('profile');
}

// Some secondary discovery reads (tier, daily-picks) are not yet implemented on the
// Go backend and 404. For these DISPLAY-ONLY reads, degrade to a safe default rather
// than throwing so the screen still renders. Auth/5xx errors still surface.
async function liveOrDefault<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === undefined || status === 404 || status === 405 || status === 501) {
      return fallback;
    }
    throw e;
  }
}

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

// Backend responses are camelCase and wrap collections in { profiles }. This
// helper pulls the profiles array whether the server returns the envelope or a
// bare array (defensive; the contract is { profiles }).
function unwrapProfiles(res: { data?: unknown }): DiscoveryProfile[] {
  const body = (res.data as { data?: unknown })?.data ?? res.data;
  if (Array.isArray(body)) return body as DiscoveryProfile[];
  return ((body as { profiles?: DiscoveryProfile[] })?.profiles ?? []) as DiscoveryProfile[];
}

// UI intent → contract wire value. Backend expects 'like' | 'pass' | 'superlike'.
function toDirection(action: SwipeAction): SwipeDirection {
  return action === 'super' ? 'superlike' : action;
}

const PHOTO = (seed: string) => `https://images.unsplash.com/${seed}?auto=format&fit=crop&w=800&q=60`;

// ── Mock candidates ──────────────────────────────────────────────────────────
const MOCK_PROFILES: DiscoveryProfile[] = [
  {
    id: 'p1',
    displayName: 'Zainab',
    age: 27,
    headline: 'Product designer · Lagos',
    bio: 'Design systems by day, jollof debates by night. Looking for someone curious and kind.',
    photos: [PHOTO('photo-1494790108377-be9c29b29330'), PHOTO('photo-1517841905240-472988babdf9')],
    interests: ['Design', 'Art', 'Hiking', 'Afrobeats'],
    prompts: [
      { prompt: 'A perfect Sunday', answer: 'Slow brunch, a gallery, then suya at night.' },
      { prompt: 'I geek out on', answer: 'Typography and good UX writing.' },
    ],
    distanceLabel: '~3 km away',
    distanceBucket: 'near',
    verified: ['selfie', 'identity'],
    likedYou: true,
    occupation: 'Product Designer',
    company: 'Paystack',
    mutualConnections: 4,
  },
  {
    id: 'p2',
    displayName: 'Tobi',
    age: 30,
    headline: 'Backend engineer · Abuja',
    bio: 'Go, coffee, and long bike rides. Building fintech rails.',
    photos: [PHOTO('photo-1500648767791-00dcc994a43e'), PHOTO('photo-1506794778202-cad84cf45f1d')],
    interests: ['Cycling', 'Coffee', 'Tech', 'Chess'],
    prompts: [
      { prompt: 'Two truths and a lie', answer: 'I have run a marathon, I speak 3 languages, I hate jollof.' },
    ],
    distanceLabel: '~8 km away',
    distanceBucket: 'city',
    verified: ['selfie', 'identity', 'photo'],
    likedYou: false,
    occupation: 'Software Engineer',
    company: 'Flutterwave',
    mutualConnections: 2,
  },
  {
    id: 'p3',
    displayName: 'Amaka',
    age: 25,
    headline: 'Doctor · Enugu',
    bio: 'Paediatrics resident. Plant mum. Always down for live music.',
    photos: [PHOTO('photo-1534528741775-53994a69daeb')],
    interests: ['Music', 'Wellness', 'Travel', 'Cooking'],
    prompts: [{ prompt: 'Green flags I look for', answer: 'Emotional intelligence and good follow-through.' }],
    distanceLabel: '~12 km away',
    distanceBucket: 'city',
    verified: ['selfie'],
    likedYou: true,
    occupation: 'Medical Doctor',
    mutualConnections: 1,
  },
  {
    id: 'p4',
    displayName: 'Kelechi',
    age: 32,
    headline: 'Founder · Lagos',
    bio: 'Early-stage founder. Tennis on weekends. Looking to grow my network.',
    photos: [PHOTO('photo-1519085360753-af0119f7cbe7'), PHOTO('photo-1463453091185-61582044d556')],
    interests: ['Startups', 'Tennis', 'Reading', 'Wine'],
    prompts: [{ prompt: 'My current obsession', answer: 'AI safety and African payments.' }],
    distanceLabel: '~5 km away',
    distanceBucket: 'near',
    verified: ['selfie', 'identity'],
    likedYou: false,
    occupation: 'Founder & CEO',
    company: 'Stealth',
    mutualConnections: 7,
  },
];

const MOCK_TIER: DiscoveryTierStatus = {
  tier: 1,
  label: 'Tier 1',
  dailyLimitKobo: 3_000_000, // ₦30,000
  remainingKobo: 1_850_000,  // ₦18,500 left today
};

// ── Stack / candidates (DC-01) ───────────────────────────────────────────────
// GET /discovery/stack?limit= → { profiles: [ProfileCard...] }. ProfileCard has
// NO raw lat/lng — only distanceLabel/distanceBucket. `limit` is the only query
// param the contract defines; the rest of the filters shape the client stack.
export async function getDiscoveryStack(filters: DiscoveryFilters): Promise<DiscoveryProfile[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PROFILES.filter((p) => {
      if (p.age < filters.minAge || p.age > filters.maxAge) return false;
      if (filters.verifiedOnly && p.verified.length === 0) return false;
      return true;
    }).map((p) => ({ ...p }));
  }
  try {
    const res = await api.get(`${CONNECT_API_BASE}/discovery/stack`, {
      params: { limit: DISCOVERY_STACK_LIMIT },
    });
    return unwrapProfiles(res);
  } catch (err) {
    if (isProfileRequired(err)) throw new ProfileRequiredError();
    throw err;
  }
}

// Default page size for the swipe stack (server caps this).
const DISCOVERY_STACK_LIMIT = 20;

export async function getProfileDetail(id: string): Promise<DiscoveryProfile> {
  if (USE_MOCK) {
    await delay(180);
    const found = MOCK_PROFILES.find((p) => p.id === id) ?? MOCK_PROFILES[0];
    return { ...found };
  }
  const res = await api.get(`${CONNECT_API_BASE}/discovery/profiles/${id}`);
  return unwrap<DiscoveryProfile>(res);
}

// ── Swipe (DC-01 / DC-06) ────────────────────────────────────────────────────
// A `like` on someone who already liked you yields a mutual match → unlocks
// chat (SAFETY INVARIANT §4: chat ONLY after a mutual match). `pass` never matches.
export async function swipe(profileId: string, action: SwipeAction): Promise<SwipeResult> {
  if (USE_MOCK) {
    await delay(220);
    const profile = MOCK_PROFILES.find((p) => p.id === profileId) ?? MOCK_PROFILES[0];
    const matched = action !== 'pass' && !!profile.likedYou;
    return {
      matched,
      matchId: matched ? `match_${profileId}` : undefined,
      threadId: matched ? `thread_${profileId}` : undefined,
      profile: { ...profile },
    };
  }
  // Contract: POST { targetId, direction } → { match: boolean, matchId?: string }.
  const res = await api.post(`${CONNECT_API_BASE}/discovery/swipe`, {
    targetId: profileId,
    direction: toDirection(action),
  });
  const body = unwrap<{ match?: boolean; matchId?: string }>(res);
  const matched = !!body.match;
  const profile = MOCK_PROFILES.find((p) => p.id === profileId);
  return {
    matched,
    matchId: body.matchId,
    // The thread opens on the match; the backend keys it by matchId.
    threadId: matched ? body.matchId : undefined,
    profile: profile ? { ...profile } : undefined,
  };
}

// ── Likes-you (DC-05) — premium-gated ────────────────────────────────────────
export async function getLikesYou(premium: boolean): Promise<LikesYouResponse> {
  if (USE_MOCK) {
    await delay();
    const likers = MOCK_PROFILES.filter((p) => p.likedYou);
    if (!premium) {
      return { locked: true, count: likers.length, entries: [] };
    }
    return {
      locked: false,
      count: likers.length,
      entries: likers.map((p, i) => ({
        id: `like_${p.id}`,
        profile: { ...p },
        likedAt: new Date(Date.now() - i * 3600_000).toISOString(),
        isSuper: i === 0,
      })),
    };
  }
  // Contract: GET /discovery/likes-you → { profiles: [...] }. Premium gating is
  // enforced server-side (non-premium callers get a blurred/limited set); the
  // client mirrors that into its locked/entries shape. When not premium we show
  // the upsell with a count and never render identities.
  const res = await api.get(`${CONNECT_API_BASE}/discovery/likes-you`);
  const profiles = unwrapProfiles(res);
  if (!premium) {
    return { locked: true, count: profiles.length, entries: [] };
  }
  return {
    locked: false,
    count: profiles.length,
    entries: profiles.map((p, i) => ({
      id: `like_${p.id}`,
      profile: p,
      likedAt: new Date(Date.now() - i * 3600_000).toISOString(),
      isSuper: false,
    })),
  };
}

// ── Daily picks (DC-07) ──────────────────────────────────────────────────────
export async function getDailyPicks(): Promise<DailyPick[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PROFILES.slice(0, 3).map((p, i) => ({
      id: `pick_${p.id}`,
      profile: { ...p },
      reason: ['Shared 4 interests', 'Near you & verified', 'Active recently'][i] ?? 'Recommended for you',
    }));
  }
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/discovery/daily-picks`);
    return unwrap<DailyPick[]>(res);
  }, []);
}

// ── Map nearby (DC-04) ───────────────────────────────────────────────────────
// Contract: GET /discovery/nearby → { profiles: [{ ...ProfileCard, distanceBucket }] }.
// The backend returns ONLY a coarse distanceBucket (no coordinates) — the client
// groups by bucket rather than plotting a precise pin (SAFETY INVARIANT §3).
export async function getNearby(mode: DiscoveryMode): Promise<DiscoveryProfile[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PROFILES.map((p) => ({ ...p }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/discovery/nearby`, { params: { mode } });
  return unwrapProfiles(res);
}

// ── Boost / Spotlight (DC-08) — wallet-funded ────────────────────────────────
// Contract: GET /discovery/boosts → { activeBoost?, priceKobo, durationMinutes }.
const MOCK_BOOST_OFFER: BoostOffer = {
  priceKobo: 99_000, // ₦990
  durationMinutes: 30,
};

export async function getBoostOffer(): Promise<BoostOffer> {
  if (USE_MOCK) {
    await delay(160);
    return { ...MOCK_BOOST_OFFER };
  }
  const res = await api.get(`${CONNECT_API_BASE}/discovery/boosts`);
  return unwrap<BoostOffer>(res);
}

export async function getDiscoveryTier(): Promise<DiscoveryTierStatus> {
  if (USE_MOCK) {
    await delay(140);
    return { ...MOCK_TIER };
  }
  return liveOrDefault(async () => {
    const res = await api.get(`${CONNECT_API_BASE}/me/tier`);
    return unwrap<DiscoveryTierStatus>(res);
  }, { tier: 0, label: 'Tier 0', dailyLimitKobo: 0, remainingKobo: 0 });
}

// Wallet-funded purchase (DC-08). CHARGES the wallet in kobo, so it MUST carry a
// fresh Idempotency-Key (iron rule: every money mutation is idempotent). The
// server validates the tier limit fail-closed and returns the created boost.
// Contract: POST /discovery/boosts (Idempotency-Key header) → { boost }.
export async function purchaseBoost(idempotencyKey?: string): Promise<BoostPurchaseResult> {
  if (USE_MOCK) {
    await delay(600);
    const remaining = (MOCK_TIER.remainingKobo ?? 0) - MOCK_BOOST_OFFER.priceKobo;
    if (remaining < 0) {
      throw new Error('Daily limit exceeded. Upgrade your tier to spend more today.');
    }
    const now = Date.now();
    const boost: Boost = {
      id: `boost_${now}`,
      startsAt: new Date(now).toISOString(),
      expiresAt: new Date(now + MOCK_BOOST_OFFER.durationMinutes * 60_000).toISOString(),
    };
    return { boost };
  }
  const res = await api.post(
    `${CONNECT_API_BASE}/discovery/boosts`,
    {},
    { headers: { 'Idempotency-Key': idempotencyKey ?? generateIdempotencyKey() } },
  );
  return unwrap<BoostPurchaseResult>(res);
}

// ── Rewind / undo (DC-09) — premium ──────────────────────────────────────────
// Contract: POST /discovery/rewind → undo last swipe (premium). A 200 means the
// last swipe was undone; a 403 (non-premium) surfaces as an error the caller
// maps to the upsell. The body may echo the restored profile or be empty.
export async function rewind(premium: boolean): Promise<RewindResult> {
  if (USE_MOCK) {
    await delay(200);
    if (!premium) {
      return { ok: false, reason: 'Rewind is a Connect Plus feature.' };
    }
    return { ok: true, restored: { ...MOCK_PROFILES[0] } };
  }
  const res = await api.post(`${CONNECT_API_BASE}/discovery/rewind`, {});
  const body = unwrap<{ profile?: DiscoveryProfile } | RewindResult | undefined>(res);
  const restored =
    body && 'restored' in body
      ? body.restored
      : (body as { profile?: DiscoveryProfile } | undefined)?.profile;
  return { ok: true, restored };
}
