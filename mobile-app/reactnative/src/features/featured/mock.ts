// ── Featured Placement — Mock data ────────────────────────────────────────────
// Lets the whole booking + landing flow run offline
// (EXPO_PUBLIC_FEATURED_USE_MOCK !== 'false'). A tiny in-memory store holds the
// merchant's campaigns so the wizard, My Promotions list, and detail screen all
// see a shared, advancing state. Analytics tick up over time so the detail
// screen shows motion on poll.

import type {
  Zone,
  Campaign,
  CampaignAnalytics,
  CreateDraftRequest,
  EligibleItem,
  LandingResponse,
  Quote,
} from './types';

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

// ─── Zones (placement surfaces a merchant can buy) ───────────────────────────
export const MOCK_ZONES: Zone[] = [
  {
    zone_code: 'home_hero',
    name: 'Home Hero Banner',
    description: 'Full-width banner at the top of the home screen.',
    layout_type: 'hero',
    base_daily_rate_kobo: 1500000, // ₦15,000/day
    slots_total: 3,
    slots_taken: 2,
    creative_spec: {
      headline_max: 48,
      cta_max: 18,
      image_aspect: '16:9',
      image_hint: 'Landscape banner, 1200×675 recommended.',
      cta_suggestions: ['Apply Now', 'Shop Now', 'Learn More', 'Book Now'],
    },
  },
  {
    zone_code: 'home_carousel',
    name: 'Home Featured Carousel',
    description: 'Horizontal carousel of promoted cards on the home screen.',
    layout_type: 'carousel',
    base_daily_rate_kobo: 800000, // ₦8,000/day
    slots_total: 8,
    slots_taken: 3,
    creative_spec: {
      headline_max: 32,
      cta_max: 16,
      image_aspect: '4:3',
      image_hint: 'Card image, 800×600 recommended.',
      cta_suggestions: ['View', 'Order Now', 'Explore'],
    },
  },
  {
    zone_code: 'home_grid',
    name: 'Home Featured Grid',
    description: 'Grid tile in the discovery section of the home screen.',
    layout_type: 'grid',
    base_daily_rate_kobo: 400000, // ₦4,000/day
    slots_total: 12,
    slots_taken: 4,
    creative_spec: {
      headline_max: 28,
      cta_max: 14,
      image_aspect: '1:1',
      image_hint: 'Square thumbnail, 600×600 recommended.',
      cta_suggestions: ['Open', 'See more'],
    },
  },
];

// ─── Eligible items the signed-in merchant can promote ───────────────────────
export const MOCK_ELIGIBLE_ITEMS: EligibleItem[] = [
  {
    subject_type: 'listing',
    subject_id: 'lst_001',
    label: 'Cozy 2-Bed Apartment, Lekki',
    subtitle: 'Short-let listing · ₦85,000/night',
    image_ref: 'https://picsum.photos/seed/lekki/800/600',
    deep_link: '/stays/lst_001',
    default_headline: 'Stay in style at Lekki',
    default_cta: 'Book Now',
  },
  {
    subject_type: 'product',
    subject_id: 'prd_044',
    label: 'Mama Cass — Jollof Combo',
    subtitle: 'Restaurant product · ₦4,500',
    image_ref: 'https://picsum.photos/seed/jollof/800/600',
    deep_link: '/food/restaurant/r1',
    default_headline: 'Smoky Jollof, delivered hot',
    default_cta: 'Order Now',
  },
  {
    subject_type: 'event',
    subject_id: 'evt_210',
    label: 'Lagos Tech Night 2026',
    subtitle: 'Event · Sat 12 Jul',
    image_ref: 'https://picsum.photos/seed/technight/800/600',
    deep_link: '/events/evt_210',
    default_headline: 'Lagos Tech Night is back',
    default_cta: 'Get Tickets',
  },
  {
    subject_type: 'service',
    subject_id: 'svc_777',
    label: 'AC Repair & Servicing',
    subtitle: 'Service · from ₦12,000',
    image_ref: 'https://picsum.photos/seed/acrepair/800/600',
    deep_link: '/repairs/svc_777',
    default_headline: 'Cool again in 24 hours',
    default_cta: 'Book Now',
  },
];

// ─── In-memory campaign store ────────────────────────────────────────────────
interface StoreEntry {
  campaign: Campaign;
  /** Wall-clock anchor used to advance analytics on read. */
  paidAt?: number;
  baseImpressions: number;
}

const store: Record<string, StoreEntry> = {};
let seq = 100;

function seed() {
  if (Object.keys(store).length > 0) return;
  // An already-active promotion so My Promotions isn't empty in demos.
  const start = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const id = 'cmp_seed_01';
  store[id] = {
    campaign: {
      id,
      state: 'ACTIVE',
      subject_type: 'product',
      subject_id: 'prd_044',
      subject_label: 'Mama Cass — Jollof Combo',
      zone_code: 'home_carousel',
      zone_name: 'Home Featured Carousel',
      window_start: start,
      window_end: end,
      creative: {
        headline: 'Smoky Jollof, delivered hot',
        image_ref: 'https://picsum.photos/seed/jollof/800/600',
        cta: 'Order Now',
        deep_link: '/food/restaurant/r1',
      },
      quoted_price_kobo: 5600000,
      rate_version: 'rate_2026_06',
      created_at: start + 'T09:00:00.000Z',
      updated_at: now(),
    },
    paidAt: Date.now() - 2 * 86400000,
    baseImpressions: 1840,
  };
}

function dayCount(startIso: string, endIso: string): number {
  const ms = +new Date(endIso) - +new Date(startIso);
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

// ─── Mock operations ─────────────────────────────────────────────────────────
export function mockListZones(): Zone[] {
  return MOCK_ZONES;
}

export function mockEligibleItems(): EligibleItem[] {
  return MOCK_ELIGIBLE_ITEMS;
}

export function mockListCampaigns(): Campaign[] {
  seed();
  return Object.values(store)
    .map((e) => e.campaign)
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

export function mockGetCampaign(id: string): Campaign {
  seed();
  const e = store[id];
  if (!e) throw new Error('Campaign not found');
  return e.campaign;
}

export function mockCreateDraft(req: CreateDraftRequest): Campaign {
  const id = `cmp_${seq++}`;
  const campaign: Campaign = {
    id,
    state: 'DRAFT',
    subject_type: req.subject_type,
    subject_id: req.subject_id,
    subject_label: req.subject_label,
    zone_code: req.zone_code,
    zone_name: MOCK_ZONES.find((z) => z.zone_code === req.zone_code)?.name,
    window_start: req.window_start,
    window_end: req.window_end,
    creative: req.creative,
    created_at: now(),
    updated_at: now(),
  };
  store[id] = { campaign, baseImpressions: 0 };
  return campaign;
}

export function mockQuote(id: string): Quote {
  const e = store[id];
  if (!e) throw new Error('Campaign not found');
  const zone = MOCK_ZONES.find((z) => z.zone_code === e.campaign.zone_code) ?? MOCK_ZONES[0];
  const days = dayCount(e.campaign.window_start, e.campaign.window_end);
  const base = zone.base_daily_rate_kobo;
  const tierMultiplier = 1.0;
  // Longer bookings earn a discount: 7d→5%, 14d→10%, 30d→15%.
  const discountPct = days >= 30 ? 15 : days >= 14 ? 10 : days >= 7 ? 5 : 0;
  const gross = base * days * tierMultiplier;
  const discounted = Math.round(gross * (1 - discountPct / 100));
  const fees = Math.round(discounted * 0.02); // 2% platform fee
  const total = discounted + fees;
  const quote: Quote = {
    quoted_price_kobo: total,
    rate_version: 'rate_2026_06',
    breakdown: {
      base_daily_rate_kobo: base,
      duration_days: days,
      tier_multiplier: tierMultiplier,
      duration_discount_pct: discountPct,
      fees_kobo: fees,
    },
  };
  e.campaign.quoted_price_kobo = total;
  e.campaign.rate_version = quote.rate_version;
  e.campaign.updated_at = now();
  return quote;
}

export function mockSubmit(id: string): Campaign {
  const e = store[id];
  if (!e) throw new Error('Campaign not found');
  e.campaign.state = 'PENDING_PAYMENT';
  e.campaign.updated_at = now();
  return e.campaign;
}

export function mockPay(id: string): Campaign {
  const e = store[id];
  if (!e) throw new Error('Campaign not found');
  // Starts today → ACTIVE now, future start → SCHEDULED.
  const startsToday = e.campaign.window_start <= today();
  e.campaign.state = startsToday ? 'ACTIVE' : 'SCHEDULED';
  e.paidAt = Date.now();
  e.baseImpressions = 0;
  e.campaign.updated_at = now();
  return e.campaign;
}

export function mockSetState(id: string, state: Campaign['state']): Campaign {
  const e = store[id];
  if (!e) throw new Error('Campaign not found');
  e.campaign.state = state;
  e.campaign.updated_at = now();
  return e.campaign;
}

export function mockAnalytics(id: string): CampaignAnalytics {
  const e = store[id];
  if (!e) throw new Error('Campaign not found');
  const days = dayCount(e.campaign.window_start, e.campaign.window_end);
  // Synthesise growing numbers based on elapsed time since payment.
  const elapsedMs = e.paidAt ? Date.now() - e.paidAt : 0;
  const elapsedDays = Math.max(0, elapsedMs / 86400000);
  const impressions = Math.round(e.baseImpressions + elapsedDays * 920 + (elapsedMs / 1000) * 0.4);
  const taps = Math.round(impressions * 0.064);
  const spend = e.campaign.quoted_price_kobo
    ? Math.min(e.campaign.quoted_price_kobo, Math.round((e.campaign.quoted_price_kobo / days) * elapsedDays))
    : 0;
  return {
    campaign_id: id,
    impressions,
    taps,
    ctr: impressions > 0 ? taps / impressions : 0,
    spend_kobo: spend,
    days_elapsed: Math.min(days, Math.floor(elapsedDays)),
    days_total: days,
  };
}

// ─── Public landing resolver ─────────────────────────────────────────────────
export function mockLanding(): LandingResponse {
  seed();
  const active = Object.values(store)
    .map((e) => e.campaign)
    .filter((c) => c.state === 'ACTIVE');

  // Always include some demo placements so the home screen looks alive even
  // before the merchant has run a campaign.
  const demoHero = {
    campaign_id: 'cmp_demo_hero',
    placement_token: 'tok_demo_hero',
    subject_type: 'event' as const,
    subject_id: 'evt_210',
    creative: {
      headline: 'Lagos Tech Night 2026',
      image_ref: 'https://picsum.photos/seed/technight/1200/675',
      cta: 'Get Tickets',
      deep_link: '/events/evt_210',
    },
    label: 'Lagos Tech Night',
  };
  const demoCards = MOCK_ELIGIBLE_ITEMS.slice(0, 3).map((it, i) => ({
    campaign_id: `cmp_demo_${i}`,
    placement_token: `tok_demo_${i}`,
    subject_type: it.subject_type,
    subject_id: it.subject_id,
    creative: {
      headline: it.default_headline ?? it.label,
      image_ref: it.image_ref ?? '',
      cta: it.default_cta ?? 'View',
      deep_link: it.deep_link,
    },
    label: it.label,
  }));

  const liveCards = active
    .filter((c) => c.zone_code === 'home_carousel' || c.zone_code === 'home_grid')
    .map((c) => ({
      campaign_id: c.id,
      placement_token: `tok_${c.id}`,
      subject_type: c.subject_type,
      subject_id: c.subject_id,
      creative: c.creative,
      label: c.subject_label ?? c.creative.headline,
    }));

  return {
    zones: [
      { zone_code: 'home_hero', layout_type: 'hero', items: [demoHero] },
      {
        zone_code: 'home_carousel',
        layout_type: 'carousel',
        items: [...liveCards, ...demoCards],
      },
      { zone_code: 'home_grid', layout_type: 'grid', items: demoCards },
    ],
  };
}
