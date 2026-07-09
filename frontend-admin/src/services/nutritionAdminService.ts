import { env } from '@/config/env';
import type {
  CompositionReference,
  CompositionFilters,
  DishLibraryEntry,
  ImplausibleProfile,
  ReresolveScope,
  NutritionistConsult,
  ConsultFilters,
  ConsultStatus,
  PayoutRun,
  PayoutFilters,
} from '@/types/nutritionAdmin';

// The Go nutrition admin routes hang off the /api prefix (same convention as
// usersService / onboardingService): env.apiBaseUrl ends with /api/v1 and admin
// routes live under /api/nutrition/admin/...
function adminApiBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api');
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Mock by default; flip with NEXT_PUBLIC_NUTRITION_ADMIN_USE_MOCK=false once the
// live Go admin endpoints (/api/nutrition/admin/*) are deployed. Matches the
// onboarding/mobility/realtor admin-service convention.
const USE_FIXTURES =
  (process.env.NEXT_PUBLIC_NUTRITION_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

// ── Fixtures ────────────────────────────────────────────────────────────────

const compositionFixture: CompositionReference[] = [
  {
    food_code: 'NG-JOLLOF-001',
    name: 'Jollof Rice (party-style)',
    source: 'WAFCT',
    prep_method: 'stewed',
    energy_kcal: 174,
    protein_g: 3.4,
    carb_g: 27.1,
    sugar_g: 2.1,
    fat_g: 5.8,
    sat_fat_g: 1.2,
    fiber_g: 1.1,
    sodium_mg: 410,
    version: 3,
    updatedAt: '2026-06-20T10:12:00Z',
  },
  {
    food_code: 'NG-EGUSI-001',
    name: 'Egusi Soup',
    source: 'WAFCT',
    prep_method: 'stewed',
    energy_kcal: 212,
    protein_g: 9.7,
    carb_g: 6.4,
    sugar_g: 1.3,
    fat_g: 16.8,
    sat_fat_g: 4.1,
    fiber_g: 2.8,
    sodium_mg: 520,
    version: 2,
    updatedAt: '2026-06-18T08:40:00Z',
  },
  {
    food_code: 'NG-POUNDEDYAM-001',
    name: 'Pounded Yam',
    source: 'NFCT',
    prep_method: 'boiled',
    energy_kcal: 118,
    protein_g: 1.5,
    carb_g: 27.9,
    sugar_g: 0.5,
    fat_g: 0.2,
    sat_fat_g: 0.0,
    fiber_g: 1.4,
    sodium_mg: 8,
    version: 1,
    updatedAt: '2026-06-10T14:05:00Z',
  },
  {
    food_code: 'NG-SUYA-001',
    name: 'Suya (beef skewer)',
    source: 'CUSTOM',
    prep_method: 'grilled',
    energy_kcal: 243,
    protein_g: 26.2,
    carb_g: 3.1,
    sugar_g: 0.4,
    fat_g: 14.0,
    sat_fat_g: 5.2,
    fiber_g: 0.8,
    sodium_mg: 690,
    version: 1,
    updatedAt: '2026-06-22T16:30:00Z',
  },
];

const libraryFixture: DishLibraryEntry[] = [
  {
    slug: 'jollof-rice',
    name: 'Jollof Rice',
    aliases: ['party jollof', 'jellof'],
    standard_portion_g: 350,
    components: [{ food_code: 'NG-JOLLOF-001', name: 'Jollof Rice (party-style)', grams: 350 }],
    per_serving: { energy_kcal: 609, protein_g: 11.9, carb_g: 94.9, fat_g: 20.3 },
    version: 3,
    updatedAt: '2026-06-20T10:14:00Z',
  },
  {
    slug: 'pounded-yam-egusi',
    name: 'Pounded Yam & Egusi',
    aliases: ['poundo and egusi'],
    standard_portion_g: 500,
    components: [
      { food_code: 'NG-POUNDEDYAM-001', name: 'Pounded Yam', grams: 300 },
      { food_code: 'NG-EGUSI-001', name: 'Egusi Soup', grams: 200 },
    ],
    per_serving: { energy_kcal: 778, protein_g: 23.9, carb_g: 96.5, fat_g: 34.2 },
    version: 2,
    updatedAt: '2026-06-18T09:00:00Z',
  },
  {
    slug: 'suya-platter',
    name: 'Suya Platter',
    aliases: ['suya', 'tsire'],
    standard_portion_g: 220,
    components: [{ food_code: 'NG-SUYA-001', name: 'Suya (beef skewer)', grams: 220 }],
    per_serving: { energy_kcal: 535, protein_g: 57.6, carb_g: 6.8, fat_g: 30.8 },
    version: 1,
    updatedAt: '2026-06-22T16:32:00Z',
  },
];

const implausibleFixture: ImplausibleProfile[] = [
  {
    id: 'prof_8f31',
    dish_id: 'dish_amala_ewedu_991',
    name: 'Amala & Ewedu (vendor: Iya Basira)',
    grounding: 'FREE_ESTIMATED',
    confidence: 'LOW',
    status: 'AI_ESTIMATE',
    review_state: 'FLAGGED',
    per_serving: { energy_kcal: 1980, protein_g: 12.0, carb_g: 110.0, fat_g: 9.0 },
    standard_portion_g: 450,
    reason:
      'Energy density 440 kcal/100g exceeds plausible bound for a swallow+soup dish (max 280 kcal/100g). Likely a free-estimate portion-size mismatch.',
    composition_version: 1,
    flaggedAt: '2026-06-27T07:22:00Z',
    reviewedAt: null,
  },
  {
    id: 'prof_2b07',
    dish_id: 'dish_moimoi_ai_440',
    name: 'Moi Moi (AI-resolved)',
    grounding: 'FREE_ESTIMATED',
    confidence: 'LOW',
    status: 'AI_ESTIMATE',
    review_state: 'FLAGGED',
    per_serving: { energy_kcal: 38, protein_g: 0.4, carb_g: 5.1, fat_g: 0.9 },
    standard_portion_g: 180,
    reason:
      'Protein 0.4g/serving below plausible bound for a bean-based dish (min 6g/serving). Free estimate did not match a bean composition row.',
    composition_version: 1,
    flaggedAt: '2026-06-28T11:05:00Z',
    reviewedAt: null,
  },
];

// ── Reads ─────────────────────────────────────────────────────────────────

// GET /nutrition/composition?source=&q=  (public catalog; fixtures by default)
export async function listComposition(
  filters: CompositionFilters = {},
): Promise<CompositionReference[]> {
  if (USE_FIXTURES) {
    return compositionFixture.filter((r) => {
      if (filters.source && r.source !== filters.source) return false;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        if (!r.name.toLowerCase().includes(q) && !r.food_code.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }
  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);
  if (filters.q) params.set('q', filters.q);
  const qs = params.toString();
  const res = await fetch(`${adminApiBase()}/nutrition/composition${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Composition list failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (Array.isArray(data)) return data as CompositionReference[];
  return (data.composition ?? data.data ?? []) as CompositionReference[];
}

// GET /nutrition/library  (public Nigerian Dish Library; fixtures by default)
export async function listLibrary(): Promise<DishLibraryEntry[]> {
  if (USE_FIXTURES) return libraryFixture;
  const res = await fetch(`${adminApiBase()}/nutrition/library`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Library list failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (Array.isArray(data)) return data as DishLibraryEntry[];
  return (data.library ?? data.data ?? []) as DishLibraryEntry[];
}

// GET /nutrition/admin/implausible  (review queue of profiles failing sanity bounds)
export async function listImplausible(): Promise<ImplausibleProfile[]> {
  if (USE_FIXTURES) return implausibleFixture;
  const res = await fetch(`${adminApiBase()}/nutrition/admin/implausible`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Implausible queue failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (Array.isArray(data)) return data as ImplausibleProfile[];
  return (data.profiles ?? data.data ?? []) as ImplausibleProfile[];
}

export async function getImplausible(id: string): Promise<ImplausibleProfile> {
  if (USE_FIXTURES) {
    const found = implausibleFixture.find((p) => p.id === id || p.dish_id === id);
    if (!found) throw new Error('Flagged profile not found.');
    return found;
  }
  const res = await fetch(
    `${adminApiBase()}/nutrition/admin/implausible/${encodeURIComponent(id)}`,
    { cache: 'no-store', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (data.profile ?? data) as ImplausibleProfile;
}

// ── Writes ──────────────────────────────────────────────────────────────────

async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${adminApiBase()}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json().catch(() => ({}));
}

// POST /nutrition/admin/composition  (manage reference, versioned)
export async function upsertComposition(
  body: Omit<CompositionReference, 'updatedAt'>,
): Promise<CompositionReference> {
  if (USE_FIXTURES) {
    await new Promise((r) => setTimeout(r, 300));
    return { ...body, updatedAt: new Date().toISOString() };
  }
  const data = (await post('/nutrition/admin/composition', body)) as Record<string, unknown>;
  return (data.composition ?? data) as CompositionReference;
}

// POST /nutrition/admin/library  (curate Nigerian Dish Library)
export async function upsertLibrary(
  body: Omit<DishLibraryEntry, 'updatedAt'>,
): Promise<DishLibraryEntry> {
  if (USE_FIXTURES) {
    await new Promise((r) => setTimeout(r, 300));
    return { ...body, updatedAt: new Date().toISOString() };
  }
  const data = (await post('/nutrition/admin/library', body)) as Record<string, unknown>;
  return (data.library ?? data) as DishLibraryEntry;
}

// POST /nutrition/admin/reresolve  {scope, composition_version}
// Batch re-resolve; leaves RESTAURANT_CONFIRMED profiles intact.
export async function reresolve(
  scope: ReresolveScope,
  compositionVersion: number,
): Promise<{ requeued: number }> {
  if (USE_FIXTURES) {
    await new Promise((r) => setTimeout(r, 450));
    const requeued =
      scope === 'all'
        ? implausibleFixture.length + libraryFixture.length
        : scope === 'library'
          ? libraryFixture.length
          : implausibleFixture.length;
    return { requeued };
  }
  const data = (await post('/nutrition/admin/reresolve', {
    scope,
    composition_version: compositionVersion,
  })) as Record<string, unknown>;
  return { requeued: Number(data.requeued ?? 0) };
}

// POST /nutrition/admin/resolve  {dish_id}  (force resolve one dish)
export async function resolveDish(dishId: string): Promise<ImplausibleProfile> {
  if (USE_FIXTURES) {
    await new Promise((r) => setTimeout(r, 350));
    const found =
      implausibleFixture.find((p) => p.dish_id === dishId) ?? implausibleFixture[0];
    return {
      ...found,
      review_state: 'RESOLVED',
      confidence: 'MEDIUM',
      composition_version: found.composition_version + 1,
      reviewedAt: new Date().toISOString(),
      reason: `${found.reason}\n\n[Re-resolved against composition v${found.composition_version + 1}; profile now within sanity bounds.]`,
    };
  }
  const data = (await post('/nutrition/admin/resolve', { dish_id: dishId })) as Record<
    string,
    unknown
  >;
  return (data.profile ?? data) as ImplausibleProfile;
}

// Mark a flagged profile as reviewed (accept value as-is). No dedicated backend
// route in scope; this is a local/optimistic state transition in fixtures, and
// posts to resolve with a reviewed hint when live.
export async function markReviewed(id: string, dishId: string): Promise<ImplausibleProfile> {
  if (USE_FIXTURES) {
    await new Promise((r) => setTimeout(r, 250));
    const found =
      implausibleFixture.find((p) => p.id === id || p.dish_id === dishId) ??
      implausibleFixture[0];
    return { ...found, review_state: 'REVIEWED', reviewedAt: new Date().toISOString() };
  }
  const data = (await post('/nutrition/admin/resolve', {
    dish_id: dishId,
    reviewed: true,
  })) as Record<string, unknown>;
  return (data.profile ?? data) as ImplausibleProfile;
}

// ── Nutritionist consults (mock-only review/resolve queue) ───────────────────
// No backend route group exists (see types note). Reads/writes are fixture-backed
// until /api/nutrition/admin/consults/* is delivered; the live branches below
// document the expected shape so the flip is a one-liner.

let consultFixture: NutritionistConsult[] = [
  {
    id: 'nc_7741',
    clientName: 'Adaeze Okonkwo',
    clientUserId: 'usr_ada_88',
    nutritionistName: 'Dr. Bello Musa',
    nutritionistId: 'nut_bello',
    topic: 'Diabetic meal plan review',
    channel: 'video',
    status: 'PENDING_REVIEW',
    priority: 'high',
    summary:
      'Client (Type-2 diabetic) requested a low-GI Nigerian meal plan. Nutritionist proposed swaps (brown rice, unripe plantain). Flagged for clinical review before issue.',
    resolutionNote: null,
    createdAt: '2026-07-08T09:10:00Z',
    updatedAt: '2026-07-08T09:10:00Z',
    resolvedAt: null,
  },
  {
    id: 'nc_7742',
    clientName: 'Tunde Balogun',
    clientUserId: 'usr_tunde_12',
    nutritionistName: 'Ngozi Eze',
    nutritionistId: 'nut_ngozi',
    topic: 'Weight-loss macro split dispute',
    channel: 'chat',
    status: 'PENDING_REVIEW',
    priority: 'normal',
    summary:
      'Client disputes the calorie target in the issued plan. Needs an admin to review the macro calculation and either confirm or re-issue.',
    resolutionNote: null,
    createdAt: '2026-07-07T15:42:00Z',
    updatedAt: '2026-07-07T16:00:00Z',
    resolvedAt: null,
  },
  {
    id: 'nc_7739',
    clientName: 'Fatima Sani',
    clientUserId: 'usr_fatima_03',
    nutritionistName: 'Dr. Bello Musa',
    nutritionistId: 'nut_bello',
    topic: 'Antenatal nutrition guidance',
    channel: 'async',
    status: 'ESCALATED',
    priority: 'high',
    summary:
      'Escalated to a senior nutritionist — client is pregnant with a nut allergy; the initial plan needs allergen re-check against the Nigerian Dish Library.',
    resolutionNote: null,
    createdAt: '2026-07-05T11:20:00Z',
    updatedAt: '2026-07-06T08:15:00Z',
    resolvedAt: null,
  },
];

function filterConsults(
  rows: NutritionistConsult[],
  filters: ConsultFilters,
): NutritionistConsult[] {
  return rows.filter((r) => {
    if (filters.status && r.status !== filters.status) return false;
    if (filters.priority && r.priority !== filters.priority) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      if (
        !r.clientName.toLowerCase().includes(q) &&
        !r.nutritionistName.toLowerCase().includes(q) &&
        !r.topic.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });
}

// GET /nutrition/admin/consults?status=&priority=&q=
export async function listConsults(
  filters: ConsultFilters = {},
): Promise<NutritionistConsult[]> {
  if (USE_FIXTURES) return filterConsults(consultFixture, filters);
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.q) params.set('q', filters.q);
  const qs = params.toString();
  const res = await fetch(`${adminApiBase()}/nutrition/admin/consults${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Consult queue failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (Array.isArray(data)) return data as NutritionistConsult[];
  return (data.consults ?? data.data ?? []) as NutritionistConsult[];
}

export async function getConsult(id: string): Promise<NutritionistConsult> {
  if (USE_FIXTURES) {
    const found = consultFixture.find((c) => c.id === id);
    if (!found) throw new Error('Consult not found.');
    return found;
  }
  const res = await fetch(`${adminApiBase()}/nutrition/admin/consults/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Consult fetch failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (data.consult ?? data) as NutritionistConsult;
}

// Transition a consult (resolve / close / escalate / take under review). Requires
// nutrition.admin.resolve server-side.
export async function transitionConsult(
  id: string,
  next: ConsultStatus,
  note?: string,
): Promise<NutritionistConsult> {
  if (USE_FIXTURES) {
    await new Promise((r) => setTimeout(r, 300));
    const idx = consultFixture.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error('Consult not found.');
    const now = new Date().toISOString();
    const updated: NutritionistConsult = {
      ...consultFixture[idx],
      status: next,
      resolutionNote: note?.trim() ? note.trim() : consultFixture[idx].resolutionNote,
      updatedAt: now,
      resolvedAt: next === 'RESOLVED' || next === 'CLOSED' ? now : consultFixture[idx].resolvedAt,
    };
    consultFixture = consultFixture.map((c, i) => (i === idx ? updated : c));
    return updated;
  }
  // Backend exposes a SINGLE resolve endpoint: POST /consults/:id/resolve with the
  // desired action carried in the body's `resolution` field (see AdminResolveConsult:
  // resolve|accept|close|escalate). Map the console's target status onto that vocab
  // and always post to /resolve; the handler returns { consult:{...} }.
  const resolution =
    next === 'RESOLVED'
      ? 'resolve'
      : next === 'CLOSED'
        ? 'close'
        : next === 'ESCALATED'
          ? 'escalate'
          : 'accept';
  const data = (await post(`/nutrition/admin/consults/${encodeURIComponent(id)}/resolve`, {
    resolution,
    note: note ?? '',
  })) as Record<string, unknown>;
  return (data.consult ?? data) as NutritionistConsult;
}

// ── Nutritionist payouts (mock-only payout runs / reconciliation) ────────────
// Amounts are kobo (money iron-rules). Mock-only until a settlement backend
// exists; the live branches document /api/nutrition/admin/payouts/*.

const payoutFixture: PayoutRun[] = [
  {
    id: 'npr_2026_06',
    period: '2026-06',
    status: 'RECONCILED',
    lineCount: 3,
    totalNetKobo: 4_185_000,
    totalFeeKobo: 465_000,
    reconciledKobo: 4_185_000,
    createdAt: '2026-07-01T00:05:00Z',
    paidAt: '2026-07-02T10:00:00Z',
    lines: [
      { nutritionistId: 'nut_bello', nutritionistName: 'Dr. Bello Musa', consults: 22, grossKobo: 2_200_000, feeKobo: 220_000, netKobo: 1_980_000, status: 'RECONCILED' },
      { nutritionistId: 'nut_ngozi', nutritionistName: 'Ngozi Eze', consults: 18, grossKobo: 1_800_000, feeKobo: 180_000, netKobo: 1_620_000, status: 'RECONCILED' },
      { nutritionistId: 'nut_amina', nutritionistName: 'Amina Yusuf', consults: 7, grossKobo: 650_000, feeKobo: 65_000, netKobo: 585_000, status: 'RECONCILED' },
    ],
  },
  {
    id: 'npr_2026_07',
    period: '2026-07',
    status: 'PENDING',
    lineCount: 3,
    totalNetKobo: 2_313_000,
    totalFeeKobo: 257_000,
    reconciledKobo: 0,
    createdAt: '2026-07-08T00:05:00Z',
    paidAt: null,
    lines: [
      { nutritionistId: 'nut_bello', nutritionistName: 'Dr. Bello Musa', consults: 12, grossKobo: 1_200_000, feeKobo: 120_000, netKobo: 1_080_000, status: 'PENDING' },
      { nutritionistId: 'nut_ngozi', nutritionistName: 'Ngozi Eze', consults: 9, grossKobo: 900_000, feeKobo: 90_000, netKobo: 810_000, status: 'PENDING' },
      { nutritionistId: 'nut_amina', nutritionistName: 'Amina Yusuf', consults: 5, grossKobo: 470_000, feeKobo: 47_000, netKobo: 423_000, status: 'PENDING' },
    ],
  },
];

// GET /nutrition/admin/payouts?status=&period=
export async function listPayoutRuns(filters: PayoutFilters = {}): Promise<PayoutRun[]> {
  if (USE_FIXTURES) {
    return payoutFixture.filter((r) => {
      if (filters.status && r.status !== filters.status) return false;
      if (filters.period && r.period !== filters.period) return false;
      return true;
    });
  }
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.period) params.set('period', filters.period);
  const qs = params.toString();
  const res = await fetch(`${adminApiBase()}/nutrition/admin/payouts${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Payout runs failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (Array.isArray(data)) return data as PayoutRun[];
  return (data.runs ?? data.data ?? []) as PayoutRun[];
}

export async function getPayoutRun(id: string): Promise<PayoutRun> {
  if (USE_FIXTURES) {
    const found = payoutFixture.find((r) => r.id === id);
    if (!found) throw new Error('Payout run not found.');
    return found;
  }
  const res = await fetch(`${adminApiBase()}/nutrition/admin/payouts/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Payout run fetch failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (data.run ?? data) as PayoutRun;
}

// Reconcile a payout run against the ledger settlement account. Requires
// nutrition.admin.resolve server-side; money mutation is backend-only (this UI
// only triggers the run — the Go side posts the balanced double-entry).
export async function reconcilePayoutRun(id: string): Promise<PayoutRun> {
  if (USE_FIXTURES) {
    await new Promise((r) => setTimeout(r, 400));
    const found = payoutFixture.find((r) => r.id === id);
    if (!found) throw new Error('Payout run not found.');
    return {
      ...found,
      status: 'RECONCILED',
      reconciledKobo: found.totalNetKobo,
      paidAt: found.paidAt ?? new Date().toISOString(),
    };
  }
  const data = (await post(`/nutrition/admin/payouts/${encodeURIComponent(id)}/reconcile`, {})) as Record<
    string,
    unknown
  >;
  return (data.run ?? data) as PayoutRun;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Format an integer kobo amount as Naira. Display-only — never used for math.
export function formatKobo(kobo: number): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ageFromNow(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
