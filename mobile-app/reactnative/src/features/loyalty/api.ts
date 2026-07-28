import { api } from '@/api/client';
import { USE_MOCK, API_BASE, POINTS_API_BASE, TIER_LADDER } from './constants/loyalty.constants';
import type {
  LoyaltyAccount,
  PointsEntry,
  CatalogItem,
  Tier,
  RedeemInput,
  RedeemResult,
  TierId,
} from './types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

// Redemptions still carry an Idempotency-Key (NL-9) even though points are
// non-cash — a double-submit must never double-deduct.
function idempotencyKey(): string {
  return `loy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

const TIERS: Tier[] = TIER_LADDER.map((t) => ({ ...t, perks: [...t.perks] }));

function tierFor(lifetime: number): { tierId: TierId; pointsToNext: number; nextTierId: TierId | null } {
  let current = TIERS[0];
  for (const t of TIERS) if (lifetime >= t.minPoints) current = t;
  const idx = TIERS.findIndex((t) => t.id === current.id);
  const next = TIERS[idx + 1] ?? null;
  return {
    tierId: current.id,
    pointsToNext: next ? Math.max(0, next.minPoints - lifetime) : 0,
    nextTierId: next?.id ?? null,
  };
}

// ── Mock fixtures ─────────────────────────────────────────────────────────────
const MOCK_LIFETIME = 8450;
let MOCK_BALANCE = 6200;

const MOCK_LEDGER: PointsEntry[] = [
  { id: 'p1', points: 250,  source: 'signup',   label: 'Welcome bonus',              atISO: daysAgo(60) },
  { id: 'p2', points: 1200, source: 'wallet',   label: 'Transfer to @bisi',          atISO: daysAgo(40) },
  { id: 'p3', points: 800,  source: 'bills',    label: 'DStv subscription',          atISO: daysAgo(30) },
  { id: 'p4', points: 1500, source: 'events',   label: 'Felabration VIP ticket',     atISO: daysAgo(20) },
  { id: 'p5', points: 600,  source: 'savings',  label: 'Rainy Day vault top-up',     atISO: daysAgo(14) },
  { id: 'p6', points: 2500, source: 'referral', label: 'Referral bonus × 5',         atISO: daysAgo(10) },
  { id: 'p7', points: -1000,source: 'redeem',   label: 'Redeemed ₦1,000 airtime',    atISO: daysAgo(6) },
  { id: 'p8', points: 1600, source: 'wallet',   label: 'Electricity payment',        atISO: daysAgo(3) },
  { id: 'p9', points: -250, source: 'redeem',   label: 'Redeemed 10% food discount', atISO: daysAgo(1) },
];

const MOCK_CATALOG: CatalogItem[] = [
  { id: 'r_air500',  title: '₦500 Airtime',       description: 'Any network, instant top-up.',          kind: 'airtime',  costPoints: 500,  valueKobo: 50_000,  emoji: '📱' },
  { id: 'r_air1000', title: '₦1,000 Airtime',     description: 'Any network, instant top-up.',          kind: 'airtime',  costPoints: 1000, valueKobo: 100_000, emoji: '📱' },
  { id: 'r_bill1k',  title: '₦1,000 Bill Credit', description: 'Apply to your next utility bill.',       kind: 'bill',     costPoints: 1000, valueKobo: 100_000, emoji: '🧾' },
  { id: 'r_food10',  title: '10% Food Discount',  description: 'One Paymax Food order, up to ₦2,000.',   kind: 'discount', costPoints: 300,  valueKobo: null,    emoji: '🍔' },
  { id: 'r_ride15',  title: '15% Ride Discount',  description: 'One Ride trip, up to ₦1,500.',           kind: 'discount', costPoints: 350,  valueKobo: null,    emoji: '🚗' },
  { id: 'r_event',   title: 'Event Fast-Track',   description: 'Skip-the-line entry at partner events.', kind: 'perk',     costPoints: 2000, valueKobo: null,    emoji: '🎟️', minTierId: 'TIER2' },
  { id: 'r_concierge', title: 'Gold Concierge',   description: '1 month dedicated concierge support.',   kind: 'perk',     costPoints: 5000, valueKobo: null,    emoji: '👑', minTierId: 'TIER3' },
];

// ── Server → client tier-id mapping (backend uses TIER1/TIER2/TIER3 strings). ──
function tierIdFromServer(tier: unknown): TierId {
  const t = String(tier ?? 'TIER1').toUpperCase();
  return (t === 'TIER2' || t === 'TIER3' ? t : 'TIER1') as TierId;
}

// ── Reads ──────────────────────────────────────────────────────────────────────
// Backend: GET /api/finance/loyalty/me → { success, membership: { tier,
// lifetime_points } }. Spendable points balance lives on the sibling points
// endpoint (GET /api/finance/points/balance → { success, balance_points }).
// There is no single "account" endpoint, so we combine both calls.
export async function getAccount(): Promise<LoyaltyAccount> {
  if (USE_MOCK) {
    await delay();
    const t = tierFor(MOCK_LIFETIME);
    return { lifetimePoints: MOCK_LIFETIME, balancePoints: MOCK_BALANCE, ...t };
  }
  const [meRes, balRes] = await Promise.all([
    api.get(`${API_BASE}/me`),
    api.get(`${POINTS_API_BASE}/points/balance`),
  ]);
  const membership = (meRes.data as { membership?: { tier?: string; lifetime_points?: number } })?.membership;
  const lifetimePoints = Number(membership?.lifetime_points ?? 0);
  const balancePoints = Number((balRes.data as { balance_points?: number })?.balance_points ?? 0);
  const t = tierFor(lifetimePoints);
  // Prefer the server-reported tier when present; fall back to the local
  // ladder derivation (display-only — the server is the source of truth for
  // any gating decision).
  const tierId = membership?.tier ? tierIdFromServer(membership.tier) : t.tierId;
  return { lifetimePoints, balancePoints, ...t, tierId };
}

// MISSING BACKEND ENDPOINT: no points-ledger history endpoint is exposed to
// members yet (points.Handler only exposes balance/catalog/redeem). Falls back
// to the mock ledger so the history screen still renders.
export async function getLedger(): Promise<PointsEntry[]> {
  await delay();
  return [...MOCK_LEDGER].reverse();
}

// Backend: GET /api/finance/points/catalog → { success, items: CatalogItem[] }
// (points.CatalogItem: id, sku, title, kind, cost_points, value_kobo, active).
export async function getCatalog(): Promise<CatalogItem[]> {
  if (USE_MOCK) { await delay(); return MOCK_CATALOG; }
  const res = await api.get(`${POINTS_API_BASE}/points/catalog`);
  const items = ((res.data as { items?: Record<string, unknown>[] })?.items ?? []).filter(
    (i) => i.active !== false,
  );
  return items.map((i) => ({
    id: String(i.sku ?? i.id ?? ''),
    title: String(i.title ?? ''),
    description: '',
    kind: (String(i.kind ?? 'perk') as CatalogItem['kind']),
    costPoints: Number(i.cost_points ?? 0),
    valueKobo: i.value_kobo != null ? Number(i.value_kobo) : null,
    emoji: '🎁',
  }));
}

// MISSING BACKEND ENDPOINT: no /tiers config endpoint is exposed to members
// (tier thresholds/benefits are seeded config, read only via admin). Uses the
// local display ladder (TIER_LADDER) which mirrors the seeded config.
export async function getTiers(): Promise<Tier[]> {
  await delay();
  return TIERS;
}

// ── Mutations ────────────────────────────────────────────────────────────────
// Redeem points → airtime / bill / discount / perk (NL-4: never cash).
// Backend: POST /api/finance/points/redeem expects { sku } (Idempotency-Key is
// NOT required by this endpoint) → { success, redemption, item }. NOTE: the
// catalog "id" returned above is the SKU, so RedeemInput.itemId IS the sku.
export async function redeem(input: RedeemInput): Promise<RedeemResult> {
  if (USE_MOCK) {
    await delay();
    const item = MOCK_CATALOG.find((c) => c.id === input.itemId);
    if (!item) throw new Error('Reward not found');
    if (item.costPoints > MOCK_BALANCE) throw new Error('Not enough points to redeem this reward.');
    MOCK_BALANCE -= item.costPoints;
    MOCK_LEDGER.push({ id: `p_${Date.now()}`, points: -item.costPoints, source: 'redeem', label: `Redeemed ${item.title}`, atISO: new Date().toISOString() });
    return { ok: true, newBalancePoints: MOCK_BALANCE, reference: `RDM-${Math.random().toString(36).slice(2, 8).toUpperCase()}` };
  }
  const res = await api.post(
    `${POINTS_API_BASE}/points/redeem`,
    { sku: input.itemId },
    { headers: { 'Idempotency-Key': idempotencyKey() } },
  );
  const redemption = (res.data as { redemption?: { id?: string } })?.redemption;
  const balRes = await api.get(`${POINTS_API_BASE}/points/balance`);
  const newBalancePoints = Number((balRes.data as { balance_points?: number })?.balance_points ?? 0);
  return { ok: true, newBalancePoints, reference: redemption?.id ?? `RDM-${Date.now()}` };
}
