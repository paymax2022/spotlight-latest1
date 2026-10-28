// Data layer for the Lab vertical. Every call reads or writes the live API
// (HEALTH_API_BASE/lab); nothing here is mocked or cached client-side.
// IRON RULES: kobo only · HL-2 MLSCN gating · HL-6 chain-of-custody · HL-7 critical
// escalation (never silent) · HL-8 consent-gated results · HL-9 held payment
// (order/checkout carry an Idempotency-Key).

import { api } from '@/api/client';
import { HEALTH_API_BASE } from '../constants/health.constants';
import { uploadProviderCredential, addProviderCredential } from '../api';
import { Colors } from '@/constants/tokens';
import type {
  LabTest,
  TestPackage,
  CatalogQuery,
  Lab,
  Phlebotomist,
  LabOrder,
  LabResult,
  LabReview,
  CreateOrderInput,
  SubmitReviewInput,
  ShareResultInput,
  ProviderOnboardingState,
  ProviderOnboardingStatus,
  SubmitOnboardingInput,
  CatalogPriceItem,
  ProviderOrderRow,
  AccessionInput,
  ResultEntryInput,
  ResultReleaseInput,
  ResultStatus,
  AnalyteFlag,
  ProviderEarnings,
  CollectionAssignment,
  CollectionChecklistItem,
  ChainOfCustodyInput,
  ChainOfCustodyEvent,
  TestOffer,
  PackageOffer,
  CollectionMode,
  LabOrderLine,
  OrderQuote,
  DropOffInput,
} from './types';

const LAB_API = `${HEALTH_API_BASE}/lab`;
const PROVIDERS_API = `${HEALTH_API_BASE}/providers`;

// Deterministic thumbnail tint so the same catalog row always renders the same
// colour (the backend catalog carries no image/colour of its own).
const CATALOG_TINTS = [
  Colors.iconBgPurple, Colors.iconBgBlue, Colors.iconBgTeal,
  Colors.iconBgOrange, Colors.iconBgGold, Colors.iconBgGreen,
];
function tintForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) % CATALOG_TINTS.length;
  return CATALOG_TINTS[h];
}

const SAMPLE_TYPE_FROM_SPECIMEN: Record<string, LabTest['sampleType']> = {
  BLOOD: 'blood', URINE: 'urine', STOOL: 'stool', SWAB: 'swab', SALIVA: 'saliva',
};
function tatLabel(hours: number): string {
  if (!hours || hours <= 0) return 'Contact lab';
  if (hours <= 24) return 'Same day';
  if (hours <= 48) return '24-48 hrs';
  return `${Math.ceil(hours / 24)} days`;
}

// healthlab.Test) onto the richer mobile LabTest display shape. The backend
// carries no category, free-text description, home-collection flag, or
// fasting flag — category/homeCollection default to the least presumptive
// value and fastingRequired is inferred from the real prep-instructions text
// (a check, not an invention) rather than left to crash the fasting-prep UI.
const TEST_CATEGORIES: LabTest['category'][] = ['haematology','chemistry','endocrine','infectious','cardiac','wellness'];

function mapTest(raw: any): LabTest {
  const prep: string = raw.prep_instructions ?? '';
  const cat = String(raw.category ?? '');
  return {
    id: raw.id,
    name: raw.name ?? '',
    code: raw.code ?? '',
    category: (TEST_CATEGORIES as string[]).includes(cat) ? (cat as LabTest['category']) : 'wellness',
    priceKobo: raw.price_kobo ?? 0,
    description: raw.description || (raw.ref_range ? `Reference range: ${raw.ref_range}` : ''),
    sampleType: SAMPLE_TYPE_FROM_SPECIMEN[String(raw.specimen ?? '').toUpperCase()] ?? 'blood',
    prep,
    fastingRequired: raw.fasting_required === true || /fast/i.test(prep),
    tat: tatLabel(raw.tat_hours ?? 0),
    homeCollection: raw.home_collection !== false,
    imageColor: tintForId(String(raw.id ?? '')),
  };
}

function distanceLabel(m: unknown): string {
  if (typeof m !== 'number' || !Number.isFinite(m)) return '';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function mapLab(raw: any): Lab {
  const cred = raw.credential ?? {};
  return {
    id: raw.id,
    name: raw.name ?? '',
    headline: raw.headline ?? '',
    credential: {
      authority: 'MLSCN',
      licenseNo: cred.license_no ?? '',
      status: cred.status === 'verified' || cred.status === 'expired' ? cred.status : 'pending',
      ...(cred.expires_at ? { expiresAt: cred.expires_at } : {}),
    },
    rating: Number(raw.rating ?? 0),
    reviewCount: Number(raw.review_count ?? 0),
    address: raw.address ?? '',
    distanceLabel: distanceLabel(raw.distance_m),
    lat: Number(raw.lat ?? 0),
    lng: Number(raw.lng ?? 0),
    supportsHomeCollection: raw.supports_home_collection === true,
    supportsWalkIn: raw.supports_walk_in !== false,
    homeCollectionFeeKobo: Number(raw.home_collection_fee_kobo ?? 0),
    resultEtaLabel: raw.result_eta_label ?? '',
    active: true,
  };
}

function mapReview(raw: any): LabReview {
  return { id: raw.id, author: raw.author ?? 'Patient', rating: Number(raw.rating ?? 0), body: raw.body ?? '', at: raw.created_at ?? '' };
}

function mapPackage(raw: any): TestPackage {
  const prep: string = raw.prep_instructions ?? '';
  const testIds: string[] = raw.test_ids ?? [];
  return {
    id: raw.id,
    name: raw.name ?? '',
    description: raw.description ?? '',
    priceKobo: raw.price_kobo ?? 0,
    listPriceKobo: raw.price_kobo ?? 0,
    testIds,
    testCount: testIds.length,
    tat: tatLabel(raw.tat_hours ?? 0),
    prep,
    fastingRequired: /fast/i.test(prep),
    imageColor: tintForId(String(raw.id ?? '')),
  };
}

export async function getTests(query?: CatalogQuery): Promise<LabTest[]> {
  const { data } = await api.get<{ tests?: unknown[] }>(`${LAB_API}/tests`, { params: query });
  // Tests are per-lab rows, so the browse list collapses each test code to its lowest price.
  const best = new Map<string, LabTest>();
  for (const row of (data.tests ?? []).map(mapTest)) {
    const key = row.code || row.id;
    const cur = best.get(key);
    if (!cur || row.priceKobo < cur.priceKobo) best.set(key, row);
  }
  let rows = [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
  // The server catalog has no free-text search or category filter yet — narrow
  // the already-persisted list here rather than showing stale results.
  if (query?.category) rows = rows.filter((x) => x.category === query.category);
  if (query?.q) {
    const q = query.q.toLowerCase();
    rows = rows.filter((x) => x.name.toLowerCase().includes(q) || x.code.toLowerCase().includes(q));
  }
  return rows;
}

/** Every lab's offer of one test code, so the right lab's test id and price are ordered. */
export async function getTestOffers(code: string): Promise<TestOffer[]> {
  const { data } = await api.get<{ tests?: any[] }>(`${LAB_API}/tests`);
  return (data.tests ?? [])
    .filter((x) => x.code === code)
    .map((x) => ({ labId: x.lab_provider_id, testId: x.id, priceKobo: Number(x.price_kobo ?? 0) }));
}

/** Every lab's offer of a package, matched by package name. */
export async function getPackageOffers(name: string): Promise<PackageOffer[]> {
  const { data } = await api.get<{ packages?: any[] }>(`${LAB_API}/packages`);
  return (data.packages ?? [])
    .filter((p) => p.name === name)
    .map((p) => ({ labId: p.lab_provider_id, packageId: p.id, priceKobo: Number(p.price_kobo ?? 0) }));
}

export async function getTest(id: string): Promise<LabTest> {
  const { data } = await api.get<{ test: unknown }>(`${LAB_API}/tests/${id}`);
  return mapTest(data.test);
}

export async function getPackages(): Promise<TestPackage[]> {
  const { data } = await api.get<{ packages?: unknown[] }>(`${LAB_API}/packages`);
  return (data.packages ?? []).map(mapPackage);
}

export async function getPackage(id: string): Promise<TestPackage> {
  const { data } = await api.get<{ package: unknown }>(`${LAB_API}/packages/${id}`);
  return mapPackage(data.package);
}

export async function getLabs(opts?: { homeCollection?: boolean; lat?: number; lng?: number }): Promise<Lab[]> {
  const { data } = await api.get<{ labs?: unknown[] }>(`${LAB_API}/labs`, {
    params: {
      ...(opts?.homeCollection ? { home_collection: true } : {}),
      ...(opts?.lat !== undefined && opts?.lng !== undefined ? { lat: opts.lat, lng: opts.lng } : {}),
    },
  });
  return (data.labs ?? []).map(mapLab);
}

export async function getLab(id: string): Promise<Lab> {
  const { data } = await api.get<{ lab: unknown }>(`${LAB_API}/labs/${id}`);
  return mapLab(data.lab);
}

export async function getPhlebotomist(orderId: string): Promise<Phlebotomist | null> {
  try {
    const { data } = await api.get<{ phlebotomist: any }>(`${LAB_API}/orders/${orderId}/phlebotomist`);
    const p = data.phlebotomist;
    const cred = p.credential;
    return {
      id: p.id,
      name: p.name ?? '',
      credential: cred
        ? {
            authority: 'MLSCN',
            licenseNo: cred.license_no ?? '',
            status: cred.status === 'verified' || cred.status === 'expired' ? cred.status : 'pending',
          }
        : undefined,
      phone: p.phone || undefined,
      lat: typeof p.lat === 'number' ? p.lat : undefined,
      lng: typeof p.lng === 'number' ? p.lng : undefined,
      locationAt: p.location_at ?? undefined,
      status: p.status ?? 'assigned',
    };
  } catch (e) {
    // 404 = nobody assigned yet. That is a normal state, not a failure.
    if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
    throw e;
  }
}

const COLLECTION_MODE_FROM_METHOD: Record<string, LabOrder['collectionMode']> = {
  HOME: 'home', WALK_IN: 'walk_in',
};
const HELD_STATES = new Set(['CREATED', 'SCHEDULED', 'SAMPLE_COLLECTED', 'IN_TRANSIT', 'ACCESSIONED', 'PROCESSING', 'RESULT_READY', 'ESCALATED']);

// richer mobile LabOrder shape. labName/location/scheduledFor/custody are not
// on this row (they live on the Lab/Sample entities behind their own reads),
// so they default to empty/absent rather than being invented — the home
// screen's active-order card only reads id/status/lines/labName and already
// tolerates an empty labName.
function mapOrder(raw: any, custody: ChainOfCustodyEvent[] = []): LabOrder {
  const lines: any[] = raw.lines ?? [];
  return {
    id: raw.id,
    status: raw.state,
    labId: raw.lab_provider_id ?? '',
    labName: raw.lab_name ?? '',
    collectionMode: COLLECTION_MODE_FROM_METHOD[raw.collection_method] ?? 'walk_in',
    lines: lines.map((l) => ({ refId: l.test_id, kind: 'test', name: l.test_name ?? '', priceKobo: l.unit_price_kobo ?? 0 })),
    subtotalKobo: (raw.total_kobo ?? 0) - (raw.home_fee_kobo ?? 0),
    collectionFeeKobo: raw.home_fee_kobo ?? 0,
    totalKobo: raw.total_kobo ?? 0,
    paymentHeld: !!raw.escrow_id && HELD_STATES.has(raw.state),
    createdAt: raw.created_at,
    location: raw.collection_address ?? '',
    scheduledFor: raw.scheduled_for ?? undefined,
    phlebotomistId: raw.assigned_phlebotomist_id ?? undefined,
    phlebotomistName: raw.assigned_phlebotomist_name || undefined,
    sampleBarcode: raw.sample_barcode ?? undefined,
    hasCritical: raw.state === 'ESCALATED' ? true : undefined,
    resultId: raw.result_record_id ?? undefined,
    custody,
  };
}

const CUSTODY_STEP: Record<string, { step: ChainOfCustodyEvent['step']; label: string; actor: string; breach?: boolean }> = {
  COLLECTED: { step: 'collected', label: 'Sample collected', actor: 'Collector' },
  IN_CUSTODY: { step: 'sealed', label: 'Sample sealed and in custody', actor: 'Collector' },
  HANDED_OVER: { step: 'in_transit', label: 'Handed over to the lab', actor: 'Collector' },
  ACCESSIONED: { step: 'accessioned', label: 'Received and accessioned by the lab', actor: 'Lab' },
  BREACHED: { step: 'breached', label: 'Chain of custody broken', actor: 'Lab', breach: true },
  RECOLLECT_REQUIRED: { step: 'breached', label: 'Recollection required', actor: 'Lab', breach: true },
};

function mapCustody(raw: any): ChainOfCustodyEvent | null {
  const m = CUSTODY_STEP[String(raw.to_state ?? '')];
  if (!m) return null;
  return { id: raw.id, step: m.step, label: m.label, at: raw.occurred_at, actor: m.actor, note: raw.note || undefined, breach: m.breach };
}

export async function getOrders(): Promise<LabOrder[]> {
  const { data } = await api.get<{ orders?: unknown[] }>(`${LAB_API}/orders`);
  return (data.orders ?? []).map((o) => mapOrder(o));
}

export async function getOrder(id: string): Promise<LabOrder> {
  const [orderRes, custodyRes] = await Promise.all([
    api.get<{ order?: unknown }>(`${LAB_API}/orders/${id}`),
    // The trail is supplementary; an order is still readable without it.
    api.get<{ custody?: any[] }>(`${LAB_API}/orders/${id}/custody`).catch(() => ({ data: { custody: [] as any[] } })),
  ]);
  if (!orderRes.data.order) throw new Error('Order not found');
  const custody = (custodyRes.data.custody ?? []).map(mapCustody).filter((e): e is ChainOfCustodyEvent => e !== null);
  return mapOrder(orderRes.data.order, custody);
}

/**
 * The server's price for an order: tests, packages and the lab's home-visit fee.
 * Checkout shows and charges this figure, so it is exactly what is held (HL-9).
 */
export async function quoteOrder(input: {
  labId: string;
  collectionMode: CollectionMode;
  lines: LabOrderLine[];
}): Promise<OrderQuote> {
  const { data } = await api.post<{ quote: any }>(`${LAB_API}/orders/quote`, {
    lab_provider_id: input.labId,
    collection_method: input.collectionMode === 'home' ? 'HOME' : 'WALK_IN',
    test_ids: input.lines.filter((l) => l.kind === 'test').map((l) => l.refId),
    package_ids: input.lines.filter((l) => l.kind === 'package').map((l) => l.refId),
  });
  return {
    subtotalKobo: Number(data.quote.subtotal_kobo ?? 0),
    homeFeeKobo: Number(data.quote.home_fee_kobo ?? 0),
    totalKobo: Number(data.quote.total_kobo ?? 0),
  };
}

export async function createOrder(input: CreateOrderInput): Promise<LabOrder> {
  // POST /health/lab/orders binds {lab_provider_id, collection_method, test_ids,
  // idempotency_key, collection_address, scheduled_for}. The server prices every
  // test from the chosen lab's catalog and holds that exact total (HL-9).
  const collectionMethod = input.collectionMode === 'home' ? 'HOME' : 'WALK_IN';
  const { data } = await api.post<{ order: unknown }>(`${LAB_API}/orders`, {
    lab_provider_id: input.labId,
    collection_method: collectionMethod,
    test_ids: input.lines.filter((l) => l.kind === 'test').map((l) => l.refId),
    package_ids: input.lines.filter((l) => l.kind === 'package').map((l) => l.refId),
    idempotency_key: input.idempotencyKey,
    // The total the patient confirmed: the server refuses (409) if its price changed.
    ...(input.expectedTotalKobo !== undefined ? { expected_total_kobo: input.expectedTotalKobo } : {}),
    ...(collectionMethod === 'HOME'
      ? {
          collection_address: input.location,
          ...(input.scheduledFor ? { scheduled_for: input.scheduledFor } : {}),
        }
      : {}),
  }, {
    headers: { 'Idempotency-Key': input.idempotencyKey },
  });
  return mapOrder(data.order);
}

// ── Results (HL-8 consent-gated · HL-7 critical) ────────────────────────────
function mapResult(raw: any): LabResult {
  const esc = raw.escalation;
  return {
    id: raw.id,
    orderId: raw.order_id ?? raw.id,
    testName: raw.test_name ?? '',
    labName: raw.lab_name ?? '',
    status: raw.status === 'ESCALATED' ? 'ESCALATED' : 'RELEASED',
    releasedBy: raw.released_by_name || undefined,
    releasedAt: raw.released_at ?? undefined,
    collectedAt: raw.collected_at ?? raw.released_at ?? new Date(0).toISOString(),
    analytes: (raw.analytes ?? []).map((a: any) => ({
      id: a.id, name: a.name ?? '', value: a.value ?? '', unit: a.unit ?? '',
      referenceRange: a.reference_range ?? '', flag: a.flag ?? 'abnormal',
    })),
    hasAbnormal: raw.has_abnormal === true,
    hasCritical: raw.has_critical === true,
    analytesWithheld: raw.analytes_withheld === true,
    escalation: esc
      ? {
          status: esc.status ?? 'pending',
          raisedAt: esc.raised_at ?? '',
          analyteName: esc.analyte_name ?? '',
          steps: (esc.steps ?? []).map((s: any) => ({ label: s.label ?? '', at: s.at ?? undefined, done: s.done === true })),
        }
      : undefined,
    docId: raw.has_document ? raw.record_id : undefined,
  };
}

/** A result is one released order; its id is the order id. */
export async function getResult(id: string): Promise<LabResult> {
  const { data } = await api.get<{ result: unknown }>(`${LAB_API}/results/${id}`);
  return mapResult(data.result);
}

export async function getResults(): Promise<LabResult[]> {
  const { data } = await api.get<{ results?: unknown[] }>(`${LAB_API}/results`);
  return (data.results ?? []).map(mapResult);
}

/** HL-8: records the patient's consent acknowledgement; the server refuses the detail read without it. */
export async function acknowledgeResultConsent(resultId: string): Promise<{ acknowledged: boolean }> {
  const { data } = await api.post<{ acknowledged: boolean }>(`${LAB_API}/results/${resultId}/consent`, {});
  return { acknowledged: data.acknowledged === true };
}

/** Short-lived signed URL for the report document; 404 until a report has been issued. */
export async function getResultSignedUrl(resultId: string): Promise<{ url: string; expiresAt: string }> {
  const { data } = await api.get<{ url: string; expires_at: string }>(`${LAB_API}/results/${resultId}/signed-url`);
  return { url: data.url, expiresAt: data.expires_at };
}

/** Grants the recipient's Spotlight account read access via the shared, revocable consent module. */
export async function shareResult(input: ShareResultInput): Promise<{ ok: true }> {
  await api.post(`${LAB_API}/results/${input.resultId}/share`, {
    grantee_email: input.granteeEmail,
    ...(input.days ? { days: input.days } : {}),
  });
  return { ok: true };
}

export async function getReviews(labId: string): Promise<LabReview[]> {
  const { data } = await api.get<{ reviews?: unknown[] }>(`${LAB_API}/labs/${labId}/reviews`);
  return (data.reviews ?? []).map(mapReview);
}

export async function submitReview(input: SubmitReviewInput): Promise<LabReview> {
  // The server derives the lab from the order — only the order id is trusted.
  const { data } = await api.post<{ review: unknown }>(`${LAB_API}/reviews`, {
    order_id: input.orderId,
    rating: input.rating,
    body: input.body,
  });
  return mapReview(data.review);
}

// `${LAB_API}/provider/onboarding` was never implemented backend side —
// backend/internal/app/health_lab_routes.go has no /provider group at all
// (only /tests, /orders, /samples), so both calls 404'd on every non-mock
// request. Same root cause and same fix as pharmacy's identical bug: the
// generic provider-application backend (backend/internal/health/providers/*,
// mounted at /api/finance/health/providers/applications*) already supports
// 'phlebotomist') and was simply never called. Repointed here instead of
// building a duplicate lab-specific onboarding backend.
interface ProviderApplicationWire {
  id: string;
  domain: string;
  provider_type: string;
  display_name: string;
  state: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'NEEDS_INFO' | 'APPROVED' | 'SUSPENDED' | 'REJECTED';
  provider_id?: string;
}

// The lab-scoped reads/writes below (catalog, provider orders, accession,
// results) all need "which lab_provider_id am I" — only known once an
// backend/internal/health/providers/model.go). Resolved via the same
// applications list already wired for onboarding above, not a separate call.
async function resolveMyLabProviderId(): Promise<string | undefined> {
  const app = await findLabApplication();
  return app?.state === 'APPROVED' ? app.provider_id : undefined;
}

function mapApplicationState(state: ProviderApplicationWire['state']): ProviderOnboardingStatus {
  switch (state) {
    case 'DRAFT':        return 'draft';
    case 'SUBMITTED':    return 'submitted';
    case 'UNDER_REVIEW':  return 'under_review';
    case 'APPROVED':      return 'approved';
    case 'NEEDS_INFO':
    case 'SUSPENDED':
    case 'REJECTED':
    default:              return 'needs_info';
  }
}

async function findLabApplication(): Promise<ProviderApplicationWire | undefined> {
  const { data } = await api.get<{ applications: ProviderApplicationWire[] }>(`${PROVIDERS_API}/applications`);
  return data.applications?.find((a) => a.domain === 'LAB');
}

export async function getProviderOnboarding(): Promise<ProviderOnboardingState> {
  const app = await findLabApplication();
  if (!app) return { status: 'draft', businessName: '', mlscnLicenseNo: '', contactName: '' };
  return {
    status: mapApplicationState(app.state),
    businessName: app.display_name,
    mlscnLicenseNo: '',
    contactName: '',
  };
}

// this screen only ever collected the MLSCN licence NUMBER as a text field,
// with no upload step, so AddCredential (which requires a real uploaded
// file's storage_key) could never be called. Now uses the same shared
// presign+upload helper (uploadProviderCredential/addProviderCredential,
// src/features/health/api.ts) already built for pharmacy/vet.
export async function submitProviderOnboarding(input: SubmitOnboardingInput): Promise<ProviderOnboardingState> {
  let app = await findLabApplication();
  if (!app) {
    const created = await api.post<{ application: ProviderApplicationWire }>(`${PROVIDERS_API}/applications`, {
      domain: 'LAB', provider_type: 'lab', display_name: input.businessName,
    });
    app = created.data.application;
  }
  if (input.licenceFile) {
    const storageKey = await uploadProviderCredential(app.id, input.licenceFile);
    await addProviderCredential(app.id, { credType: 'MLSCN', referenceNo: input.mlscnLicenseNo, storageKey });
  }
  if (app.state === 'DRAFT' || app.state === 'NEEDS_INFO') {
    const submitted = await api.post<{ application: ProviderApplicationWire }>(`${PROVIDERS_API}/applications/${app.id}/submit`, {});
    app = submitted.data.application;
  }
  return {
    status: mapApplicationState(app.state),
    businessName: app.display_name,
    mlscnLicenseNo: input.mlscnLicenseNo,
    contactName: input.contactName,
  };
}

// `${LAB_API}/provider/catalog` was never implemented — there is no /provider
// group in health_lab_routes.go. The real catalog read already exists and
// already works (`GET /health/lab/tests`, the same endpoint getTests() above
// correctly calls for the patient-facing browse view) — it just needs the
// caller's own lab_provider_id to scope to "my tests" instead of every lab's.
export async function getProviderCatalog(): Promise<CatalogPriceItem[]> {
  const providerId = await resolveMyLabProviderId();
  if (!providerId) return [];
  const { data } = await api.get<{ tests?: Array<{
    id: string; code: string; name: string; tat_hours: number; price_kobo: number; active: boolean;
  }> }>(`${LAB_API}/tests`, { params: { lab_provider_id: providerId } });
  return (data.tests ?? []).map((t) => ({
    testId: t.id, name: t.name, code: t.code, priceKobo: t.price_kobo, active: t.active, tat: `${t.tat_hours}h`,
  }));
}

// `${LAB_API}/provider/orders` never existed backend side either. Unlike
// catalog, there was no existing scoped read to repoint to — AdminListOrders
// is platform-admin RBAC, not owner-scoped, so using it here would either
// reject every real lab owner (no RBAC grant) or, if it didn't, leak every
// lab's orders to every caller. Added a real endpoint instead:
// GET /health/lab/provider/orders (Service.ListProviderOrders,
// backend/internal/health/lab/service.go) — object-level authZ'd to a
// verified owner of the resolved lab_provider_id, same VerifiedLabOwner
// check UpsertTest already uses. `patientName` has no resolver in this
// backend package (see the Go doc comment) — surfaced as the raw patient id
// pending a proper name-lookup follow-up, not fabricated.
interface ProviderOrderWire {
  id: string;
  patient_id: string;
  patient_name?: string;
  state: string;
  collection_method: 'HOME' | 'WALK_IN';
  created_at: string;
  sample_barcode?: string;
  test_names: string[];
  has_critical: boolean;
}

export async function getProviderOrders(): Promise<ProviderOrderRow[]> {
  const providerId = await resolveMyLabProviderId();
  if (!providerId) return [];
  const { data } = await api.get<{ orders?: ProviderOrderWire[] }>(`${LAB_API}/provider/orders`, {
    params: { lab_provider_id: providerId },
  });
  return (data.orders ?? []).map((o) => ({
    orderId: o.id,
    patientName: o.patient_name || 'Patient',
    status: o.state as ProviderOrderRow['status'],
    testSummary: o.test_names.join(', '),
    collectionMode: o.collection_method === 'HOME' ? 'home' : 'walk_in',
    sampleBarcode: o.sample_barcode,
    createdAt: o.created_at,
    hasCritical: o.has_critical,
  }));
}

// `${LAB_API}/provider/orders/:id/accession` was also never implemented — the
// real endpoint is `POST /samples/:id/accession` (a SAMPLE id, not an order
// {scanned_barcode, note}, not this screen's {orderId, barcode, conditionOk}.
// The sample id is resolved via the order's custody trail: Collect() creates
// the sample row AND its first custody event in the same transaction
// (service.go), so by the time accession is reachable (only after
// SAMPLE_COLLECTED), the trail always has at least one entry naming it.
// `conditionOk` has no equivalent on Accession itself — a barcode mismatch is
// what the real endpoint treats as a breach (verifyBarcodeScan), not a
// separate flag. A scientist judging the physical sample unacceptable despite
// a matching barcode is a distinct concern with its own endpoint
// (POST /samples/:id/breach, {reason}) — called as a follow-up when the
// barcode matched but conditionOk is explicitly false.
export async function accessionSample(input: AccessionInput): Promise<{ ok: true; status: 'ACCESSIONED' | 'breached' }> {
  const { data: custody } = await api.get<{ custody?: Array<{ sample_id: string }> }>(
    `${LAB_API}/orders/${input.orderId}/custody`,
  );
  const sampleId = custody.custody?.[0]?.sample_id;
  if (!sampleId) throw new Error('lab: no sample recorded for this order yet');

  const { data: accessioned } = await api.post<{ sample: { state: string } }>(
    `${LAB_API}/samples/${sampleId}/accession`,
    { scanned_barcode: input.barcode, note: input.note },
  );
  const barcodeStatus: 'ACCESSIONED' | 'breached' = accessioned.sample.state === 'ACCESSIONED' ? 'ACCESSIONED' : 'breached';

  if (input.conditionOk === false && barcodeStatus === 'ACCESSIONED') {
    await api.post(`${LAB_API}/samples/${sampleId}/breach`, {
      reason: input.note || 'Sample condition flagged unacceptable at accession',
    });
    return { ok: true, status: 'breached' };
  }
  return { ok: true, status: barcodeStatus };
}

// `${LAB_API}/provider/orders/:id/result` was never implemented — the real
// endpoint is POST /orders/:id/results (handler.go EnterResults), and it binds
// {scanned_barcode, results: [{test_id, value, unit, ref_range, status}]}, not
// this screen's free-text {analytes: [{name, flag, ...}]}. `test_id` must be
// one of the order's own ordered tests (the service looks it up in
// lab_order_lines and rejects anything else) — sourced from
// analyte.testId, which the screen now populates from the order's real lines
// (getOrder().lines[].refId) instead of letting the scientist type a name.
// `scanned_barcode` is LR-001: the backend verifies it against the
// permitted (verifyBarcodeScan) for flows that don't scan.
// The response is the bare order (no per-result echo, no distinct "result
// so the returned LabResult is synthesized from what was just entered rather
// than parsed from a response shape this endpoint doesn't provide. This is
// actual escalation decision — Release (below) independently recomputes
// criticality from the persisted results, including any server-side
// deriveEffectiveStatus upgrade, so a client-side estimate here can never
// under-escalate a real critical value.
const FLAG_TO_STATUS: Record<AnalyteFlag, 'NORMAL' | 'ABNORMAL' | 'CRITICAL'> = {
  normal: 'NORMAL', low: 'ABNORMAL', abnormal: 'ABNORMAL', high: 'ABNORMAL', critical: 'CRITICAL',
};

export async function enterResult(input: ResultEntryInput): Promise<LabResult> {
  const { data } = await api.post<{ order: { id: string; state: string } }>(
    `${LAB_API}/orders/${input.orderId}/results`,
    {
      scanned_barcode: input.scannedBarcode ?? '',
      results: input.analytes.map((a) => ({
        test_id: a.testId, value: a.value, unit: a.unit, ref_range: a.referenceRange, status: FLAG_TO_STATUS[a.flag],
      })),
    },
  );
  const hasCritical = input.analytes.some((a) => a.flag === 'critical');
  const hasAbnormal = input.analytes.some((a) => a.flag !== 'normal');
  return {
    id: data.order.id,
    orderId: input.orderId,
    testName: input.analytes.map((a) => a.name).join(', '),
    labName: '',
    status: (data.order.state as ResultStatus) ?? 'RESULT_READY',
    collectedAt: new Date().toISOString(),
    analytes: input.analytes.map((a) => ({ ...a })),
    hasAbnormal,
    hasCritical,
    interpretation: input.interpretation,
  };
}

// `${LAB_API}/provider/orders/:id/release` was also never implemented — the
// real endpoint is POST /orders/:id/release, and it takes NO body at all.
// resultId/signedBy/criticalAcknowledged (this screen's confirmation state)
// have no equivalent there: Release (service.go) independently recomputes
// criticality from the persisted results and handles the full HL-7
// escalation-then-release sequence itself in one call — a client-supplied
// "I acknowledge this is critical" flag would be redundant, and dangerous to
// trust over the server's own recomputation, so it's intentionally never
// wire data.
export async function releaseResult(input: ResultReleaseInput): Promise<{ ok: true; releasedAt: string }> {
  // Order (model.go) carries no updated_at field to read a real release
  // timestamp from — this is "now" by construction, not a parsed value.
  await api.post(`${LAB_API}/orders/${input.orderId}/release`, {});
  return { ok: true, releasedAt: new Date().toISOString() };
}

export async function getProviderEarnings(): Promise<ProviderEarnings> {
  const { data } = await api.get<{ earnings: any }>(`${LAB_API}/provider/earnings`);
  const e = data.earnings;
  return {
    availableKobo: Number(e.available_kobo ?? 0),
    earnedKobo: Number(e.earned_kobo ?? 0),
    pendingKobo: Number(e.pending_kobo ?? 0),
    heldKobo: Number(e.held_kobo ?? 0),
    withdrawals: (e.withdrawals ?? []).map((w: any) => ({
      id: w.id,
      amountKobo: Number(w.amount_kobo ?? 0),
      feeKobo: Number(w.fee_kobo ?? 0),
      at: w.at,
      status: w.status === 'paid' || w.status === 'failed' ? w.status : 'processing',
    })),
  };
}

export async function getProviderReviews(): Promise<LabReview[]> {
  const { data } = await api.get<{ reviews?: unknown[] }>(`${LAB_API}/provider/reviews`);
  return (data.reviews ?? []).map(mapReview);
}

function formatDistance(m: unknown): string {
  if (typeof m !== 'number' || !Number.isFinite(m)) return '';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** The phlebotomist route. Pass the device position to get distances. */
export async function getAssignments(pos?: { lat: number; lng: number }): Promise<CollectionAssignment[]> {
  const { data } = await api.get<{ assignments?: any[] }>(`${LAB_API}/phlebotomist/assignments`, {
    params: pos ? { lat: pos.lat, lng: pos.lng } : undefined,
  });
  return (data.assignments ?? []).map((a) => ({
    orderId: a.order_id,
    patientName: a.patient_name ?? 'Patient',
    address: a.address ?? '',
    lat: typeof a.lat === 'number' ? a.lat : 0,
    lng: typeof a.lng === 'number' ? a.lng : 0,
    scheduledFor: a.scheduled_for ?? '',
    testSummary: a.test_summary ?? '',
    sampleType: a.sample_type ?? 'blood',
    status: a.status ?? 'assigned',
    distanceLabel: formatDistance(a.distance_m),
  }));
}

/** Marks the visit en route / arrived (the first call claims an unassigned order). */
export async function setCollectionStatus(
  orderId: string,
  status: 'en_route' | 'arrived',
  pos?: { lat: number; lng: number },
): Promise<void> {
  await api.post(`${LAB_API}/phlebotomist/assignments/${orderId}/status`, {
    status,
    ...(pos ? { lat: pos.lat, lng: pos.lng } : {}),
  });
}

export async function getChecklist(orderId: string): Promise<CollectionChecklistItem[]> {
  const { data } = await api.get<{ items?: any[] }>(`${LAB_API}/phlebotomist/assignments/${orderId}/checklist`);
  return (data.items ?? []).map((i) => ({ id: i.id, label: i.label, done: i.done === true, required: i.required === true }));
}

/** Bedside scan: collects the sample under the scanned barcode and opens the chain of custody. */
export async function logCustody(input: ChainOfCustodyInput): Promise<{ ok: true; breach: boolean }> {
  const { data } = await api.post<{ breach: boolean }>(`${LAB_API}/phlebotomist/assignments/${input.orderId}/custody`, {
    barcode: input.barcode,
    condition_ok: input.conditionOk,
    note: input.note ?? '',
    completed_items: input.completedItems,
  });
  return { ok: true, breach: data.breach === true };
}

export async function dropOff(input: DropOffInput): Promise<{ ok: true }> {
  await api.post(`${LAB_API}/phlebotomist/assignments/${input.orderId}/drop-off`, {
    ...(input.labId ? { lab_id: input.labId } : {}),
    barcode: input.barcode,
    note: input.note ?? '',
  });
  return { ok: true };
}

export function newIdempotencyKey(prefix = 'lab'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
