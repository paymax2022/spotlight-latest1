import { api } from '@/api/client';
import { USE_MOCK, API_BASE, creatorsIdempotencyKey } from './constants/creators.constants';
import type {
  Creator,
  Storefront,
  SubTier,
  Subscription,
  GatedContent,
  TipInput,
  TipResult,
  SubscribeInput,
  BecomeCreatorInput,
  BecomeCreatorResult,
  CreatorEarnings,
  PayoutInput,
  PayoutResult,
  CreateContentInput,
} from './types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

// ── Mock fixtures ─────────────────────────────────────────────────────────────
const MOCK_CREATORS: Creator[] = [
  { id: 'cr_tope',  handle: '@topebeats', displayName: 'Tope Beats',   bio: 'Afrobeats producer. New packs weekly.', avatarColor: '#0051D5', category: 'Music',     verified: true,  subscriberCount: 1240, fromPriceKobo: 100_000,  acceptsTips: true },
  { id: 'cr_lara',  handle: '@laracooks', displayName: 'Lara Cooks',   bio: 'Naija home cooking, step by step.',      avatarColor: '#16A34A', category: 'Food',      verified: true,  subscriberCount: 8930, fromPriceKobo: 50_000,   acceptsTips: true },
  { id: 'cr_zedd',  handle: '@zeddgames', displayName: 'Zedd Plays',   bio: 'Live gaming + giveaways.',               avatarColor: '#9333EA', category: 'Gaming',    verified: false, subscriberCount: 420,  fromPriceKobo: 200_000,  acceptsTips: true },
  { id: 'cr_amaka', handle: '@amaka',     displayName: 'Amaka Speaks', bio: 'Career coaching & study tips.',          avatarColor: '#EAB308', category: 'Education', verified: true,  subscriberCount: 3110, fromPriceKobo: 150_000,  acceptsTips: true },
  { id: 'cr_dare',  handle: '@darecomedy',displayName: 'Dare Comedy',  bio: 'Skits & stand-up clips. 18+ specials.',  avatarColor: '#DC2626', category: 'Comedy',    verified: false, subscriberCount: 670,  fromPriceKobo: 80_000,   acceptsTips: true },
];

function tiersFor(creatorId: string, base: number): SubTier[] {
  return [
    { id: `${creatorId}_t1`, creatorId, name: 'Fan',       priceKobo: base,         perks: ['Subscriber-only posts', 'Community chat access'] },
    { id: `${creatorId}_t2`, creatorId, name: 'Super Fan', priceKobo: base * 2,     perks: ['Everything in Fan', 'Early access content', 'Monthly shout-out'], popular: true },
    { id: `${creatorId}_t3`, creatorId, name: 'VIP',       priceKobo: base * 4,     perks: ['Everything in Super Fan', '1:1 monthly call', 'Behind-the-scenes'] },
  ];
}

function contentFor(creatorId: string): GatedContent[] {
  return [
    { id: `${creatorId}_c1`, creatorId, title: 'Welcome — start here',     kind: 'video',   gated: false, priceKobo: null,    ageRestricted: false, thumbColor: '#340075', durationLabel: '4:12', publishedAtISO: daysAgo(20), entitled: true },
    { id: `${creatorId}_c2`, creatorId, title: 'Subscriber deep dive',     kind: 'video',   gated: true,  priceKobo: null,    ageRestricted: false, thumbColor: '#0051D5', durationLabel: '18:40', publishedAtISO: daysAgo(8), entitled: false },
    { id: `${creatorId}_c3`, creatorId, title: 'Premium pack (PPV)',       kind: 'audio',   gated: true,  priceKobo: 250_000, ageRestricted: false, thumbColor: '#48B8AC', durationLabel: '32:00', publishedAtISO: daysAgo(3), entitled: false },
    { id: `${creatorId}_c4`, creatorId, title: 'After-dark special (18+)', kind: 'video',   gated: true,  priceKobo: 500_000, ageRestricted: true,  thumbColor: '#DC2626', durationLabel: '12:05', publishedAtISO: daysAgo(1), entitled: false },
  ];
}

const MOCK_SUBSCRIPTIONS: Subscription[] = [
  { id: 'sub_1', creatorId: 'cr_lara', creatorName: 'Lara Cooks', creatorHandle: '@laracooks', avatarColor: '#16A34A', tierId: 'cr_lara_t2', tierName: 'Super Fan', priceKobo: 100_000, status: 'ACTIVE',   renewsAtISO: daysFromNow(12), startedAtISO: daysAgo(48) },
  { id: 'sub_2', creatorId: 'cr_amaka', creatorName: 'Amaka Speaks', creatorHandle: '@amaka', avatarColor: '#EAB308', tierId: 'cr_amaka_t1', tierName: 'Fan', priceKobo: 150_000, status: 'PAST_DUE', renewsAtISO: daysFromNow(2), startedAtISO: daysAgo(90) },
  { id: 'sub_3', creatorId: 'cr_zedd', creatorName: 'Zedd Plays', creatorHandle: '@zeddgames', avatarColor: '#9333EA', tierId: 'cr_zedd_t1', tierName: 'Fan', priceKobo: 200_000, status: 'CANCELLED', renewsAtISO: null, startedAtISO: daysAgo(150) },
];

const MOCK_EARNINGS: CreatorEarnings = {
  availableKobo: 4_250_000,
  pendingKobo:   850_000,
  lifetimeKobo:  18_900_000,
  payoutKycDone: false,
  recent: [
    { id: 'e1', source: 'subscription', label: 'Super Fan renewal — @bisi',  amountKobo: 90_000,  atISO: minsAgo(120) },
    { id: 'e2', source: 'tip',          label: 'Tip from @chidi',            amountKobo: 50_000,  atISO: minsAgo(300) },
    { id: 'e3', source: 'content',      label: 'PPV unlock — Premium pack',  amountKobo: 225_000, atISO: minsAgo(900) },
    { id: 'e4', source: 'subscription', label: 'Fan subscription — @ada',    amountKobo: 45_000,  atISO: minsAgo(1800) },
    { id: 'e5', source: 'tip',          label: 'Tip from @femi',             amountKobo: 100_000, atISO: minsAgo(4000) },
  ],
};

// ── Reads ────────────────────────────────────────────────────────────────────
// MISSING BACKEND ENDPOINT: no creator discovery/list endpoint exists (the
// backend only exposes GET /creators/:creatorId — a single storefront read).
// Falls back to the mock directory so Discover/search still renders.
export async function listCreators(query?: string): Promise<Creator[]> {
  await delay();
  const q = (query ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!q) return MOCK_CREATORS;
  return MOCK_CREATORS.filter(
    (c) => c.handle.includes(q) || c.displayName.toLowerCase().includes(q) || c.category.toLowerCase().includes(q),
  );
}

// Backend: GET /creators/:creatorId → { success, profile }. The backend
// returns only the creator profile — tiers/content/isSubscribed are NOT part
// of this response (MISSING: a combined storefront read). We map the profile
// fields we can and fall back to the mock tiers/content/subscription state so
// the storefront screen still renders sensibly.
export async function getStorefront(id: string): Promise<Storefront> {
  if (USE_MOCK) {
    await delay();
    const creator = MOCK_CREATORS.find((c) => c.id === id);
    if (!creator) throw new Error('Creator not found');
    return {
      creator,
      tiers: tiersFor(creator.id, creator.fromPriceKobo ?? 100_000),
      content: contentFor(creator.id),
      isSubscribed: MOCK_SUBSCRIPTIONS.some((s) => s.creatorId === id && s.status === 'ACTIVE'),
    };
  }
  const res = await api.get(`${API_BASE}/${id}`);
  const profile = (res.data as { profile?: Record<string, unknown> })?.profile ?? {};
  const creator: Creator = {
    id: String(profile.id ?? id),
    handle: String(profile.handle ?? ''),
    displayName: String(profile.display_name ?? profile.handle ?? ''),
    bio: String(profile.bio ?? ''),
    avatarColor: '#340075',
    category: String(profile.category ?? ''),
    verified: !!profile.verified,
    subscriberCount: Number(profile.subscriber_count ?? 0),
    fromPriceKobo: profile.from_price_kobo != null ? Number(profile.from_price_kobo) : null,
    acceptsTips: profile.accepts_tips !== false,
  };
  return {
    creator,
    tiers: tiersFor(creator.id, creator.fromPriceKobo ?? 100_000),
    content: contentFor(creator.id),
    isSubscribed: false,
  };
}

// Backend: GET /creators/content/:contentId → { success, content }.
export async function getContent(id: string): Promise<GatedContent> {
  if (USE_MOCK) {
    await delay();
    for (const c of MOCK_CREATORS) {
      const item = contentFor(c.id).find((x) => x.id === id);
      if (item) return item;
    }
    throw new Error('Content not found');
  }
  const res = await api.get(`${API_BASE}/content/${id}`);
  const content = (res.data as { content?: Record<string, unknown> })?.content ?? {};
  return mapContent(content);
}

function mapContent(c: Record<string, unknown>): GatedContent {
  return {
    id: String(c.id ?? ''),
    creatorId: String(c.creator_id ?? ''),
    title: String(c.title ?? ''),
    kind: (String(c.kind ?? 'video') as GatedContent['kind']),
    gated: c.price_kobo != null && Number(c.price_kobo) > 0,
    priceKobo: c.price_kobo != null ? Number(c.price_kobo) : null,
    ageRestricted: String(c.age_rating ?? '') !== 'GENERAL',
    thumbColor: '#340075',
    publishedAtISO: String(c.created_at ?? new Date().toISOString()),
    entitled: !!c.entitled,
  };
}

// MISSING BACKEND ENDPOINT: no "my content" list endpoint for a creator's own
// catalogue exists (only single-item GET /creators/content/:contentId).
export async function listMyContent(): Promise<GatedContent[]> {
  await delay();
  return contentFor('cr_tope');
}

// MISSING BACKEND ENDPOINT: no "my subscriptions" list endpoint exists (the
// backend only exposes mutation endpoints — Subscribe/CancelSub — no read).
export async function listSubscriptions(): Promise<Subscription[]> {
  await delay();
  return MOCK_SUBSCRIPTIONS;
}

// Backend: GET /creators/earnings/balance → { success, balance_kobo }. Only
// the available balance is returned (no pending/lifetime/recent breakdown —
// MISSING: a full earnings summary). We keep the rest from the mock shape.
export async function getEarnings(): Promise<CreatorEarnings> {
  if (USE_MOCK) { await delay(); return MOCK_EARNINGS; }
  const res = await api.get(`${API_BASE}/earnings/balance`);
  const availableKobo = Number((res.data as { balance_kobo?: number })?.balance_kobo ?? 0);
  return { ...MOCK_EARNINGS, availableKobo };
}

// ── Mutations (each money-path call carries an Idempotency-Key) ──────────────
// Backend: POST /creators/:creatorId/tip expects { amount_kobo } → { success, tip }.
export async function sendTip(input: TipInput): Promise<TipResult> {
  if (USE_MOCK) { await delay(); return { id: `tip_${Date.now()}`, ok: true }; }
  const res = await api.post(
    `${API_BASE}/${input.creatorId}/tip`,
    { amount_kobo: input.amountKobo },
    { headers: { 'Idempotency-Key': creatorsIdempotencyKey() } },
  );
  const tip = (res.data as { tip?: { id?: string } })?.tip;
  return { id: tip?.id ?? `tip_${Date.now()}`, ok: true };
}

// Backend: POST /creators/tiers/:tierId/subscribe (Idempotency-Key) → { success, subscription }.
export async function subscribe(input: SubscribeInput): Promise<Subscription> {
  if (USE_MOCK) {
    await delay();
    const creator = MOCK_CREATORS.find((c) => c.id === input.creatorId);
    const tier = creator ? tiersFor(creator.id, creator.fromPriceKobo ?? 100_000).find((t) => t.id === input.tierId) : undefined;
    return {
      id: `sub_${Date.now()}`,
      creatorId: input.creatorId,
      creatorName: creator?.displayName ?? 'Creator',
      creatorHandle: creator?.handle ?? '@creator',
      avatarColor: creator?.avatarColor ?? '#340075',
      tierId: input.tierId,
      tierName: tier?.name ?? 'Fan',
      priceKobo: tier?.priceKobo ?? 0,
      status: 'ACTIVE',
      renewsAtISO: daysFromNow(30),
      startedAtISO: new Date().toISOString(),
    };
  }
  const res = await api.post(
    `${API_BASE}/tiers/${input.tierId}/subscribe`,
    {},
    { headers: { 'Idempotency-Key': creatorsIdempotencyKey() } },
  );
  const sub = (res.data as { subscription?: Record<string, unknown> })?.subscription ?? {};
  const creator = MOCK_CREATORS.find((c) => c.id === input.creatorId);
  return {
    id: String(sub.id ?? `sub_${Date.now()}`),
    creatorId: input.creatorId,
    creatorName: creator?.displayName ?? 'Creator',
    creatorHandle: creator?.handle ?? '@creator',
    avatarColor: creator?.avatarColor ?? '#340075',
    tierId: input.tierId,
    tierName: String(sub.tier_name ?? 'Fan'),
    priceKobo: Number(sub.price_kobo ?? 0),
    status: (String(sub.status ?? 'ACTIVE') as Subscription['status']),
    renewsAtISO: sub.renews_at ? String(sub.renews_at) : daysFromNow(30),
    startedAtISO: String(sub.started_at ?? new Date().toISOString()),
  };
}

// Backend: POST /creators/subscriptions/:subId/cancel → { success }.
export async function cancelSubscription(subId: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  await api.post(`${API_BASE}/subscriptions/${subId}/cancel`, {});
  return { ok: true };
}

// Backend: POST /creators/content/:contentId/purchase (Idempotency-Key) → { success, entitlement }.
export async function unlockContent(contentId: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  await api.post(
    `${API_BASE}/content/${contentId}/purchase`,
    {},
    { headers: { 'Idempotency-Key': creatorsIdempotencyKey() } },
  );
  return { ok: true };
}

// Backend: POST /creators/apply expects { display_name, bio, handle } → { success, profile }.
export async function becomeCreator(input: BecomeCreatorInput): Promise<BecomeCreatorResult> {
  if (USE_MOCK) { await delay(); return { ok: true, creatorId: `cr_${Date.now()}` }; }
  const res = await api.post(`${API_BASE}/apply`, {
    display_name: input.displayName,
    bio: input.bio,
    handle: input.handle,
  });
  const profile = (res.data as { profile?: { id?: string } })?.profile;
  return { ok: true, creatorId: profile?.id ?? `cr_${Date.now()}` };
  // NOTE: legalName/kycRef/acceptedTerms/category have no backend field on
  // Apply yet (MISSING) — payout KYC is completed separately (see
  // completePayoutKyc below, itself unimplemented server-side).
}

// Backend: POST /creators/payouts expects { amount_kobo } → { success, payout }.
export async function requestPayout(input: PayoutInput): Promise<PayoutResult> {
  if (USE_MOCK) {
    await delay();
    return { ok: true, reference: `po_${Date.now()}`, newAvailableKobo: Math.max(0, MOCK_EARNINGS.availableKobo - input.amountKobo) };
  }
  const res = await api.post(
    `${API_BASE}/payouts`,
    { amount_kobo: input.amountKobo },
    { headers: { 'Idempotency-Key': creatorsIdempotencyKey() } },
  );
  const payout = (res.data as { payout?: { id?: string } })?.payout;
  const balRes = await api.get(`${API_BASE}/earnings/balance`);
  return {
    ok: true,
    reference: payout?.id ?? `po_${Date.now()}`,
    newAvailableKobo: Number((balRes.data as { balance_kobo?: number })?.balance_kobo ?? 0),
  };
}

// MISSING BACKEND ENDPOINT: no payout-KYC submission endpoint exists in the
// creators module (RequestPayout returns ErrPayoutKYC when KYC is
// incomplete, but there is no member-facing endpoint to complete it — KYC is
// owned by finance/kyc and has no creators-specific wiring yet).
export async function completePayoutKyc(legalName: string, kycRef: string): Promise<{ ok: boolean }> {
  await delay();
  return { ok: true };
}

// Backend: POST /creators/content expects { title, body, price_kobo,
// age_rating } → { success, content }. NOTE: `kind`/`ageRestricted` (boolean)
// have no direct backend field — we map ageRestricted to an AgeRating string
// (MATURE/GENERAL) since that's what the backend models.
export async function createContent(input: CreateContentInput): Promise<GatedContent> {
  if (USE_MOCK) {
    await delay();
    return {
      id: `c_${Date.now()}`,
      creatorId: 'cr_tope',
      title: input.title,
      kind: input.kind,
      gated: input.gated,
      priceKobo: input.priceKobo,
      ageRestricted: input.ageRestricted,
      thumbColor: '#340075',
      publishedAtISO: new Date().toISOString(),
      entitled: true,
    };
  }
  const res = await api.post(`${API_BASE}/content`, {
    title: input.title,
    body: '',
    price_kobo: input.priceKobo ?? 0,
    age_rating: input.ageRestricted ? 'MATURE' : 'GENERAL',
  });
  const content = (res.data as { content?: Record<string, unknown> })?.content ?? {};
  return { ...mapContent(content), kind: input.kind, thumbColor: '#340075' };
}
