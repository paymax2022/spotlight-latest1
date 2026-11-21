// Which FX surfaces are REAL on the Go backend, and which are not — probed
// unauthenticated against both deployed planes (401 = route registered, 404 =
// not mounted), 2026-11-20:
//
//   REAL ON PROD AND DEV  /api/finance/admin/fx/markup (GET/PUT) and
//                         /markup/audit — fx.MarkupHandler over
//                         public.fx_markup_rates. This is the LIVE pricing
//                         rail: the orchestrator resolves a quote's spread
//                         from that table on every request, so an edit here
//                         changes what the next customer is charged with no
//                         restart and no cache. getSpreadRules /
//                         updateSpreadRule are deliberately NOT mock-gated:
//                         a fabricated bps on a pricing screen is
//                         indistinguishable from the real one.
//   IN MAIN, NOT DEPLOYED /api/finance/admin/fx/overview, /verifications and
//                         /verifications/:customerId/decision (RBAC
//                         finance.admin.fx_ops). They 404 on prod AND dev
//                         because they sit inside the orchestration block of a
//                         build neither plane runs yet. getOverview and the KYC
//                         queue stay pointed at them and fail loud.
//   CUSTOMER-SCOPED       /api/v1/fx/* (rates, balances, transactions, cards,
//                         settings…). Mounted on prod, not on dev. Every read is
//                         filtered by the CALLER's user id, so these are the
//                         customer's own rails — they cannot answer "what is the
//                         platform book", which is what this console asks.
//   NO BACKEND AT ALL     routing, providers, treasury, recon, customers,
//                         compliance, webhook endpoints/deliveries/api-keys,
//                         analytics, collections, cards, settings catalogue.
//                         No Go route exists for any of them; the admin surface
//                         has to be built. Live, each one answers 404, and
//                         readLive() rejects with the backend's own "No API route
//                         matches GET …" rather than handing that body to the page
//                         as if it were the data the page asked for.
//
// All money is integer minor units.
import { apiRoot } from '@/config/env';
import { operationKey } from './idempotency';
import { resolveUseMock } from '@/config/useMock';
import type {
  FxOverview, FxTxSummary, FxTxDetail, FxTxFilter,
  RoutingWeights, RouteSimResult, ProviderConfig, FloatBucket, RebalanceEvent,
  SpreadRule, ReconRun, ReconBreak, Provider,
  AdminCustomer, CustomerDetail, CustomerVerification,
  FxKycSubmission, FxKycDecision,
  ScreeningAlert, CaseStatus,
  WebhookEndpoint, WebhookDelivery, ApiKey,
  FxAnalytics,
  VirtualAccountReg, AdminCollectionEvent, BeneficiaryValidationIssue,
  IssuedCard, SuspiciousCardActivity, IssuedCardStatus,
  FxSettingsCatalogue,
} from '@/types/fxAdmin';

// Samples are a DEVELOPMENT affordance and nothing else. Unset resolves live in
// production and mock in development (src/config/useMock.ts), and the shipped
// image builds with the flag false (frontend-admin/Dockerfile), so an operator's
// screen is always the live branch. What a developer sees locally is the
// fixture below each `if (USE_MOCK)`. Pricing is the exception — see
// getSpreadRules, which ignores this flag entirely.
const USE_MOCK = resolveUseMock(process.env.NEXT_PUBLIC_FX_ADMIN_USE_MOCK);

function adminBase(): string {
  return `${apiRoot()}/api/finance/admin/fx`;
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  return { 'Content-Type': 'application/json' };
}
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// There is still no backend for any FX admin WRITE outside the markup rail:
// routing, providers, treasury, recon, customers, compliance, webhooks, cards
// and settings are not registered on the Go service at all.
//
// NO_BACKEND_YET is what the MOCK branch says, and it replaced something worse:
// every mutation used to answer `{ ok: true }` without looking at the response,
// so a 404 was reported to the operator as a successful write. Both branches now
// fail honestly — this string in development, the backend's own refusal in
// production, where writeLive() throws on any non-2xx. See
// docs/audit/ADMIN_SIMULATED_WRITES.md.
const NO_BACKEND_YET =
  'has no backend yet: this surface does not exist on the Go service (only ' +
  '/api/finance/admin/fx/markup is real). This console cannot perform this ' +
  'action until that surface is built.';
async function reqLive<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(serverMessage(body) || `Request failed (${res.status})`);
  return (body?.data ?? body) as T;
}
async function writeLive(url: string, init: RequestInit): Promise<{ ok: boolean }> {
  await reqLive(url, init);
  return { ok: true };
}

/**
 * serverMessage pulls the operator-facing sentence out of either error envelope
 * this backend can answer with: the orchestration rail's
 * {error:{type,code,message}} object, or the {error:"..."} string the finance
 * handlers post through httperr.Msg. Never return the raw body: on a 404 the
 * proxy hands back Go's route-not-matched object, and a caller that renders or
 * maps that is what turns a missing endpoint into "This page couldn't load".
 */
function serverMessage(body: unknown): string | null {
  const err = (body as { error?: unknown } | null)?.error;
  if (typeof err === 'string' && err.trim()) return err;
  const message = (err as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message.trim()) return message;
  return null;
}

/**
 * readLive is the ONLY way this file may read the backend in live mode.
 *
 * The calls it replaces did `const res = await fetch(...); return res.json()` —
 * no status check. Every one of those surfaces answers 404 today, so the promise
 * resolved with an error object (or with the proxy's HTML, which json() rejects
 * outright) and the page dereferenced it as if it were data. A guard that throws
 * is what makes the console print a real sentence instead of crashing.
 */
async function readLive<T>(url: string): Promise<T> {
  return reqLive<T>(url, { headers: authHeaders() });
}

/** Live-mode refusal for a surface the Go service does not serve at all. */
function noBackend(action: string): never {
  throw new Error(`${action} ${NO_BACKEND_YET}`);
}

const TXNS: FxTxDetail[] = [
  {
    id: 'tx_90021', reference: 'PMX-CV-90021', type: 'conversion', status: 'successful',
    customer: 'Acme Ltd', customerEmail: 'ops@acme.example', provider: 'eversend', corridor: 'USD-NGN', rail: 'wallet',
    source: { amountMinor: 1_000_00, currency: 'USD' }, destination: { amountMinor: 158_143_000, currency: 'NGN' },
    quotedRate: 1598.2, executedRate: 1581.43, providerRef: 'evs_8841aa', narration: null,
    createdAt: '2026-06-19T10:21:00Z',
    fees: [{ type: 'provider_fee', amount: { amountMinor: 25, currency: 'USD' } }, { type: 'paymax_spread', amount: { amountMinor: 10_50, currency: 'USD' } }],
    statusHistory: [{ status: 'pending', at: '2026-06-19T10:21:00Z' }, { status: 'settled', at: '2026-06-19T10:21:04Z' }],
    scoring: [
      { provider: 'eversend', chosen: true, score: 0.91, cost: 0.95, coverage: 1, liquidity: 0.88, reliability: 0.92 },
      { provider: 'vertofx', chosen: false, score: 0.86, cost: 0.89, coverage: 1, liquidity: 0.8, reliability: 0.9 },
    ],
  },
  {
    id: 'tx_77810', reference: 'PMX-TR-77810', type: 'transfer', status: 'successful',
    customer: 'Jane Doe', customerEmail: 'jane@example.com', provider: 'vertofx', corridor: 'USD-XAF', rail: 'mobile_money',
    source: { amountMinor: 100_00, currency: 'USD' }, destination: { amountMinor: 60_250_00, currency: 'XAF' },
    quotedRate: 602.5, executedRate: 600.1, providerRef: 'mpl_5521cd', narration: 'Vendor settlement',
    createdAt: '2026-06-19T09:02:00Z',
    fees: [{ type: 'provider_fee', amount: { amountMinor: 25, currency: 'USD' } }, { type: 'paymax_spread', amount: { amountMinor: 1_05, currency: 'USD' } }],
    statusHistory: [{ status: 'queued', at: '2026-06-19T09:02:00Z' }, { status: 'processing', at: '2026-06-19T09:02:12Z' }, { status: 'paid', at: '2026-06-19T09:02:40Z' }],
    scoring: [
      { provider: 'vertofx', chosen: true, score: 0.93, cost: 0.9, coverage: 1, liquidity: 0.95, reliability: 0.94 },
      { provider: 'eversend', chosen: false, score: 0.79, cost: 0.82, coverage: 0.7, liquidity: 0.85, reliability: 0.9 },
    ],
  },
  {
    id: 'tx_77744', reference: 'PMX-TR-77744', type: 'transfer', status: 'failed',
    customer: 'Kwame M.', customerEmail: 'kwame@example.com', provider: 'eversend', corridor: 'USD-GHS', rail: 'mobile_money',
    source: { amountMinor: 50_00, currency: 'USD' }, destination: { amountMinor: 740_00, currency: 'GHS' },
    quotedRate: 14.8, executedRate: null, providerRef: 'evs_fail_8830', narration: 'Refund',
    createdAt: '2026-06-19T07:40:00Z',
    fees: [{ type: 'paymax_spread', amount: { amountMinor: 52, currency: 'USD' } }],
    statusHistory: [{ status: 'queued', at: '2026-06-19T07:40:00Z' }, { status: 'failed', at: '2026-06-19T07:40:30Z' }],
    scoring: [
      { provider: 'eversend', chosen: true, score: 0.74, cost: 0.8, coverage: 0.9, liquidity: 0.6, reliability: 0.7 },
      { provider: 'vertofx', chosen: false, score: 0.72, cost: 0.75, coverage: 0.9, liquidity: 0.7, reliability: 0.78 },
    ],
    failureReason: 'Beneficiary wallet could not be validated by the provider.',
  },
  {
    id: 'tx_44120', reference: 'PMX-COL-44120', type: 'collection', status: 'successful',
    customer: 'Acme Ltd', customerEmail: 'ops@acme.example', provider: 'eversend', corridor: 'USD-USD', rail: 'iban',
    source: { amountMinor: 1_200_00, currency: 'USD' }, destination: { amountMinor: 1_200_00, currency: 'USD' },
    quotedRate: null, executedRate: null, providerRef: 'evs_col_2031', narration: 'INV-2031',
    createdAt: '2026-06-19T06:10:00Z',
    fees: [],
    statusHistory: [{ status: 'received', at: '2026-06-19T06:10:00Z' }],
    scoring: [{ provider: 'eversend', chosen: true, score: 1, cost: 1, coverage: 1, liquidity: 1, reliability: 1 }],
  },
  {
    id: 'tx_90108', reference: 'PMX-CV-90108', type: 'conversion', status: 'processing',
    customer: 'Tunde B.', customerEmail: 'tunde@example.com', provider: 'vertofx', corridor: 'NGN-USD', rail: 'wallet',
    source: { amountMinor: 1_600_000_00, currency: 'NGN' }, destination: { amountMinor: 996_00, currency: 'USD' },
    quotedRate: 0.000626, executedRate: null, providerRef: 'mpl_inflight_2', narration: null,
    createdAt: '2026-06-19T10:58:00Z',
    fees: [{ type: 'paymax_spread', amount: { amountMinor: 16_800_00, currency: 'NGN' } }],
    statusHistory: [{ status: 'pending', at: '2026-06-19T10:58:00Z' }],
    scoring: [
      { provider: 'vertofx', chosen: true, score: 0.88, cost: 0.9, coverage: 1, liquidity: 0.82, reliability: 0.9 },
      { provider: 'eversend', chosen: false, score: 0.87, cost: 0.92, coverage: 1, liquidity: 0.8, reliability: 0.88 },
    ],
  },
];

const WEIGHTS: RoutingWeights[] = [
  { corridor: 'USD-NGN', tier: 'All tiers', wCost: 0.45, wCover: 0.2, wLiq: 0.2, wRel: 0.15, enabled: { eversend: true, vertofx: true }, bias: 'auto' },
  { corridor: 'USD-XAF', tier: 'All tiers', wCost: 0.3, wCover: 0.35, wLiq: 0.2, wRel: 0.15, enabled: { eversend: false, vertofx: true }, bias: 'vertofx' },
  { corridor: 'EUR-NGN', tier: 'All tiers', wCost: 0.5, wCover: 0.2, wLiq: 0.2, wRel: 0.1, enabled: { eversend: true, vertofx: true }, bias: 'eversend' },
];

const PROVIDERS: ProviderConfig[] = [
  {
    provider: 'eversend', displayName: 'Eversend', enabled: true,
    corridors: ['USD-NGN', 'EUR-NGN', 'USD-GHS', 'USD-KES'], rails: ['bank_transfer', 'mobile_money', 'iban', 'stablecoin'],
    exposureLimitUsdCents: 5_000_000_00, exposureUsedUsdCents: 2_482_690_00, latencyMsP95: 540, successRate: 98.7,
    breaker: 'closed', adapterStatus: 'live',
  },
  {
    provider: 'vertofx', displayName: 'VertoFX', enabled: true,
    corridors: ['USD-NGN', 'USD-XAF', 'NGN-USD'], rails: ['bank_transfer', 'mobile_money', 'iban', 'stablecoin'],
    exposureLimitUsdCents: 4_000_000_00, exposureUsedUsdCents: 1_797_810_00, latencyMsP95: 690, successRate: 97.9,
    breaker: 'half_open', adapterStatus: 'live',
  },
];

const FLOATS: FloatBucket[] = [
  { provider: 'eversend', currency: 'USD', balanceMinor: 820_000_00, lowWaterMinor: 200_000_00, highWaterMinor: 1_000_000_00, status: 'healthy' },
  { provider: 'eversend', currency: 'NGN', balanceMinor: 180_000_000_00, lowWaterMinor: 250_000_000_00, highWaterMinor: 900_000_000_00, status: 'low' },
  { provider: 'vertofx', currency: 'USD', balanceMinor: 96_000_00, lowWaterMinor: 150_000_00, highWaterMinor: 800_000_00, status: 'critical' },
  { provider: 'vertofx', currency: 'XAF', balanceMinor: 420_000_000_00, lowWaterMinor: 100_000_000_00, highWaterMinor: 500_000_000_00, status: 'healthy' },
];

const REBALANCES: RebalanceEvent[] = [
  { id: 'rb1', from: 'eversend', to: 'vertofx', currency: 'USD', amountMinor: 200_000_00, path: 'stablecoin', status: 'completed', createdAt: '2026-06-19T05:00:00Z' },
  { id: 'rb2', from: 'vertofx', to: 'eversend', currency: 'NGN', amountMinor: 80_000_000_00, path: 'fiat', status: 'pending', createdAt: '2026-06-19T09:30:00Z' },
];

const RECON_RUNS: ReconRun[] = [
  { id: 'run1', provider: 'eversend', date: '2026-06-18', matched: 642, breaks: 1, status: 'breaks' },
  { id: 'run2', provider: 'vertofx', date: '2026-06-18', matched: 511, breaks: 2, status: 'breaks' },
  { id: 'run3', provider: 'eversend', date: '2026-06-17', matched: 690, breaks: 0, status: 'clean' },
];

const RECON_BREAKS: ReconBreak[] = [
  { id: 'bk1', runId: 'run1', provider: 'eversend', reference: 'PMX-TR-77410', type: 'fee', expectedMinor: 1_05, actualMinor: 1_20, currency: 'USD', status: 'open', createdAt: '2026-06-18T23:10:00Z' },
  { id: 'bk2', runId: 'run2', provider: 'vertofx', reference: 'PMX-TR-77512', type: 'rate', expectedMinor: 60_250_00, actualMinor: 60_010_00, currency: 'XAF', status: 'investigating', createdAt: '2026-06-18T23:14:00Z' },
  { id: 'bk3', runId: 'run2', provider: 'vertofx', reference: 'PMX-CV-90044', type: 'timing', expectedMinor: 0, actualMinor: 0, currency: 'USD', status: 'open', createdAt: '2026-06-18T23:20:00Z' },
];

/**
 * The platform FX book: GMV, margin, success/failure rates, float health,
 * reconciliation breaks, breaker state. GET /api/finance/admin/fx/overview.
 *
 * Live and never mocked — a fabricated 0 on a money screen reads as "all clear".
 * The route exists in main (orch.AdminOverview, RBAC finance.admin.fx_ops) but in
 * neither deployed binary, so today this rejects with Go's own
 * "No API route matches GET …overview", which is the true statement and the
 * operator's clue; it starts working the moment the backend carries main.
 */
export async function getOverview(): Promise<FxOverview> {
  return readLive<FxOverview>(`${adminBase()}/overview`);
}

/**
 * LIVE: the FX KYC review queue. Reads the same orch_fx_customer_verifications
 * rows the customer's submission writes, so a new application appears here
 * immediately. Deliberately not mock-gated — inventing a queue would hide the
 * very gap this page exists to close.
 */
export async function getKycQueue(status?: FxKycSubmission['status']): Promise<FxKycSubmission[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const rows = await readLive<FxKycSubmission[]>(`${adminBase()}/verifications${qs}`);
  return Array.isArray(rows) ? rows : [];
}

/** Approve or reject one submission. A rejection must carry the reason the customer will see. */
export async function decideKyc(customerId: string, decision: FxKycDecision, reason?: string): Promise<void> {
  await writeLive(`${adminBase()}/verifications/${encodeURIComponent(customerId)}/decision`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ status: decision, reason: reason ?? '' }),
  });
}

export async function getTransactions(filter?: FxTxFilter): Promise<FxTxSummary[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...TXNS];
    if (filter?.type) list = list.filter((t) => t.type === filter.type);
    if (filter?.status) list = list.filter((t) => t.status === filter.status);
    if (filter?.provider) list = list.filter((t) => t.provider === filter.provider);
    if (filter?.corridor) list = list.filter((t) => t.corridor === filter.corridor);
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      list = list.filter((t) => t.reference.toLowerCase().includes(q) || t.customer.toLowerCase().includes(q));
    }
    return list.map(({ rail, quotedRate, executedRate, fees, providerRef, customerEmail, narration, statusHistory, scoring, failureReason, ...s }) => s);
  }
  return readLive<FxTxSummary[]>(`${adminBase()}/transactions`);
}

export async function getTransaction(id: string): Promise<FxTxDetail> {
  if (USE_MOCK) {
    await delay();
    const found = TXNS.find((t) => t.id === id || t.reference === id);
    if (!found) throw new Error('Transaction not found');
    return found;
  }
  return readLive<FxTxDetail>(`${adminBase()}/transactions/${id}`);
}

export async function retryTransaction(id: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) noBackend('Retrying a transaction');
  return writeLive(`${adminBase()}/transactions/${id}/retry`, { method: 'POST', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:transaction-retry', id) } });
}

export async function forceReverseTransaction(id: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) noBackend('Reversing a transaction');
  return writeLive(`${adminBase()}/transactions/${id}/reverse`, { method: 'POST', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:transaction-reverse', id) } });
}

export async function getRoutingWeights(): Promise<RoutingWeights[]> {
  if (USE_MOCK) { await delay(); return WEIGHTS; }
  return readLive<RoutingWeights[]>(`${adminBase()}/routing`);
}

export async function saveRoutingWeights(rows: RoutingWeights[]): Promise<{ ok: boolean }> {
  if (USE_MOCK) noBackend('Saving routing weights');
  return writeLive(`${adminBase()}/routing`, { method: 'PUT', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:routing-save') }, body: JSON.stringify(rows) });
}

export async function simulateRoute(corridor: string, amountUsdCents: number): Promise<RouteSimResult> {
  if (USE_MOCK) noBackend('Simulating a route');
  return reqLive<RouteSimResult>(`${adminBase()}/routing/simulate`, { method: 'POST', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:route-simulate', corridor) }, body: JSON.stringify({ corridor, amountUsdCents }) });
}

export async function getProviders(): Promise<ProviderConfig[]> {
  if (USE_MOCK) { await delay(); return PROVIDERS; }
  return readLive<ProviderConfig[]>(`${adminBase()}/providers`);
}

export async function toggleProvider(provider: Provider, enabled: boolean): Promise<{ ok: boolean }> {
  if (USE_MOCK) noBackend('Toggling a provider');
  return writeLive(`${adminBase()}/providers/${provider}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:provider-toggle', provider) }, body: JSON.stringify({ enabled }) });
}

export async function setBreaker(provider: Provider, state: ProviderConfig['breaker']): Promise<{ ok: boolean }> {
  if (USE_MOCK) noBackend('Setting a provider breaker');
  return writeLive(`${adminBase()}/providers/${provider}/breaker`, { method: 'POST', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:provider-breaker', provider) }, body: JSON.stringify({ state }) });
}

export async function getFloats(): Promise<FloatBucket[]> {
  if (USE_MOCK) { await delay(); return FLOATS; }
  return readLive<FloatBucket[]>(`${adminBase()}/treasury/floats`);
}

export async function getRebalances(): Promise<RebalanceEvent[]> {
  if (USE_MOCK) { await delay(); return REBALANCES; }
  return readLive<RebalanceEvent[]>(`${adminBase()}/treasury/rebalances`);
}

export async function rebalanceNow(bucket: FloatBucket, path: 'fiat' | 'stablecoin'): Promise<{ ok: boolean }> {
  if (USE_MOCK) noBackend('Rebalancing treasury');
  return writeLive(`${adminBase()}/treasury/rebalance`, { method: 'POST', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:treasury-rebalance', bucket.provider, bucket.currency) }, body: JSON.stringify({ provider: bucket.provider, currency: bucket.currency, path }) });
}

/**
 * One row of public.fx_markup_rates as GET /api/finance/admin/fx/markup returns
 * it ({data: [...]}). Operators work in PERCENT, the store keeps integer BPS, and
 * ratePercent is the exact string form of that conversion — so the number on the
 * screen is the number that prices the next quote.
 */
interface MarkupRateRow {
  id: string;
  corridor: string;
  tier: string;
  rateBps: number;
  ratePercent: string;
  active: boolean;
  notes?: string;
  updatedAt: string;
  createdAt: string;
}

/**
 * fx.MaxMarkupBPS — the 10% fat-finger ceiling the table itself CHECKs. The list
 * projection has no per-row band, so the console guards against that ceiling
 * rather than inventing min/max numbers it cannot show are real.
 */
const MAX_MARKUP_BPS = 1000;

/**
 * LIVE, ALWAYS: the markup registry the orchestrator prices from.
 *
 * Not mock-gated on purpose. public.fx_markup_rates is the production
 * MarkupResolver — FeeMinor reads the corridor's row on every quote (ADR-032),
 * so this is the realtime provider-pricing surface, and a fixture here would put
 * a made-up spread next to the one customers are actually charged.
 */
export async function getSpreadRules(): Promise<SpreadRule[]> {
  const rows = await readLive<MarkupRateRow[] | null>(`${adminBase()}/markup`);
  return (rows ?? []).map((r) => ({
    id: r.id,
    corridor: r.corridor,
    tier: r.tier || 'any',
    bps: r.rateBps,
    // This rail prices a percentage only — there is no fixed-fee column to show.
    fixedMinor: 0,
    minBps: 0,
    maxBps: MAX_MARKUP_BPS,
    updatedAt: r.updatedAt,
    active: r.active,
  }));
}

/**
 * PUT /api/finance/admin/fx/markup upserts by (corridor, tier), so the write
 * needs those two keys rather than the row id the GET happens to return.
 * bps travels back as the exact percent string the store parses (PercentToBPS
 * keeps "1.15" as 115 bps; a float would land on 114.999…).
 */
export async function updateSpreadRule(
  target: { corridor: string; tier?: string },
  patch: { bps?: number; active?: boolean },
): Promise<{ ok: boolean }> {
  const body: Record<string, unknown> = {
    corridor: target.corridor,
    tier: target.tier && target.tier !== 'any' ? target.tier : '',
  };
  if (patch.bps !== undefined) body.ratePercent = (patch.bps / 100).toFixed(2);
  if (patch.active !== undefined) body.active = patch.active;
  return writeLive(`${adminBase()}/markup`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:spread-update', target.corridor, body.tier as string) },
    body: JSON.stringify(body),
  });
}

/**
 * GET /api/finance/admin/fx/markup/audit?corridor=&limit= — the immutable
 * before/after record of every rate change (fx.MarkupAudit). This is the surface
 * that makes "each change is audit-logged" a checkable claim rather than copy.
 */
export async function getSpreadAudit(corridor?: string): Promise<MarkupAuditRow[]> {
  const qs = corridor ? `?corridor=${encodeURIComponent(corridor)}` : '';
  const rows = await readLive<MarkupAuditRow[] | null>(`${adminBase()}/markup/audit${qs}`);
  return rows ?? [];
}

export interface MarkupAuditRow {
  id: string;
  corridor: string;
  tier: string;
  beforeBps?: number | null;
  beforePercent?: string;
  afterBps: number;
  afterPercent: string;
  beforeActive?: boolean | null;
  afterActive: boolean;
  changedBy?: string;
  note?: string;
  changedAt: string;
}

export async function getReconRuns(): Promise<ReconRun[]> {
  if (USE_MOCK) { await delay(); return RECON_RUNS; }
  return readLive<ReconRun[]>(`${adminBase()}/recon/runs`);
}

export async function getReconBreaks(): Promise<ReconBreak[]> {
  if (USE_MOCK) { await delay(); return RECON_BREAKS; }
  return readLive<ReconBreak[]>(`${adminBase()}/recon/breaks`);
}

export async function resolveReconBreak(id: string, status: ReconBreak['status']): Promise<{ ok: boolean }> {
  if (USE_MOCK) noBackend('Resolving a reconciliation break');
  return writeLive(`${adminBase()}/recon/breaks/${id}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:recon-break-resolve', id) }, body: JSON.stringify({ status }) });
}

const CUSTOMERS: CustomerDetail[] = [
  {
    id: 'cus_91', name: 'Acme Ltd', email: 'ops@acme.example', type: 'business', verification: 'review', tier: 2,
    country: 'NG', balanceUsdCents: 3_420_00, createdAt: '2026-05-30T10:00:00Z',
    rcNumber: 'RC-1234567', directors: [{ name: 'Ada Obi', role: 'CEO', ownershipPct: '60' }, { name: 'Tunde A.', role: 'Director', ownershipPct: '40' }],
    documents: [{ id: 'd1', label: 'Certificate of incorporation', type: 'pdf', verified: true }, { id: 'd2', label: 'CAC status report', type: 'pdf', verified: false }],
    riskScore: 34, notes: null,
  },
  {
    id: 'cus_44', name: 'Jane Doe', email: 'jane@example.com', type: 'individual', verification: 'pending', tier: 1,
    country: 'NG', balanceUsdCents: 980_00, createdAt: '2026-06-12T10:00:00Z',
    documents: [{ id: 'd3', label: 'NIN slip', type: 'image', verified: true }], riskScore: 12, notes: null,
  },
  {
    id: 'cus_77', name: 'Kwame Mensah', email: 'kwame@example.com', type: 'individual', verification: 'approved', tier: 1,
    country: 'GH', balanceUsdCents: 120_00, createdAt: '2026-04-18T10:00:00Z',
    documents: [{ id: 'd4', label: 'Passport', type: 'image', verified: true }], riskScore: 8, notes: 'Repeat payout customer.',
  },
  {
    id: 'cus_12', name: 'QuickCoin Traders', email: 'hi@quickcoin.example', type: 'business', verification: 'rejected', tier: 0,
    country: 'NG', balanceUsdCents: 0, createdAt: '2026-06-01T10:00:00Z',
    rcNumber: 'RC-0000000', documents: [{ id: 'd5', label: 'Uploaded doc', type: 'pdf', verified: false }],
    riskScore: 88, notes: 'Documents failed verification; suspected shell entity.',
  },
];

export async function getCustomers(): Promise<AdminCustomer[]> {
  if (USE_MOCK) {
    await delay();
    return CUSTOMERS.map(({ documents, directors, rcNumber, riskScore, notes, ...c }) => c);
  }
  return readLive<AdminCustomer[]>(`${adminBase()}/customers`);
}

export async function getCustomer(id: string): Promise<CustomerDetail> {
  if (USE_MOCK) {
    await delay();
    const c = CUSTOMERS.find((x) => x.id === id);
    if (!c) throw new Error('Customer not found');
    return c;
  }
  return readLive<CustomerDetail>(`${adminBase()}/customers/${id}`);
}

export async function setCustomerVerification(id: string, verification: CustomerVerification): Promise<{ ok: boolean }> {
  if (USE_MOCK) noBackend('Setting customer verification');
  return writeLive(`${adminBase()}/customers/${id}/verification`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:customer-verification', id) }, body: JSON.stringify({ verification }) });
}

const ALERTS: ScreeningAlert[] = [
  { id: 'al1', customer: 'QuickCoin Traders', kind: 'sanctions', reference: null, detail: 'Name match (82%) against OFAC SDN list.', severity: 'high', status: 'open', createdAt: '2026-06-19T08:00:00Z' },
  { id: 'al2', customer: 'Jane Doe', kind: 'velocity', reference: 'PMX-TR-77810', detail: '5 payouts in 10 minutes exceeds velocity rule.', severity: 'medium', status: 'in_review', createdAt: '2026-06-19T09:10:00Z' },
  { id: 'al3', customer: 'Acme Ltd', kind: 'aml_rule', reference: 'PMX-CV-90021', detail: 'Large conversion just below reporting threshold.', severity: 'low', status: 'open', createdAt: '2026-06-19T10:25:00Z' },
  { id: 'al4', customer: 'Bola I.', kind: 'pep', reference: null, detail: 'Possible politically-exposed person match.', severity: 'medium', status: 'cleared', createdAt: '2026-06-18T14:00:00Z' },
];

export async function getScreeningAlerts(): Promise<ScreeningAlert[]> {
  if (USE_MOCK) { await delay(); return ALERTS; }
  return readLive<ScreeningAlert[]>(`${adminBase()}/compliance/alerts`);
}

export async function setAlertStatus(id: string, status: CaseStatus, reason?: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) noBackend('Setting an alert status');
  return writeLive(`${adminBase()}/compliance/alerts/${id}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:alert-status', id) }, body: JSON.stringify({ status, reason }) });
}

const ENDPOINTS: WebhookEndpoint[] = [
  { id: 'wh1', customer: 'Acme Ltd', url: 'https://acme.example/hooks/paymax', events: ['transfer.paid', 'conversion.settled', 'collection.received'], enabled: true, sandbox: false },
  { id: 'wh2', customer: 'Jane Doe', url: 'https://jane.example/pmx', events: ['transfer.paid', 'transfer.failed'], enabled: true, sandbox: true },
];

const DELIVERIES: WebhookDelivery[] = [
  { id: 'd1', endpointId: 'wh1', event: 'transfer.paid', status: 'delivered', attempts: 1, responseCode: 200, createdAt: '2026-06-19T09:03:00Z' },
  { id: 'd2', endpointId: 'wh1', event: 'conversion.settled', status: 'retrying', attempts: 3, responseCode: 503, createdAt: '2026-06-19T10:22:00Z' },
  { id: 'd3', endpointId: 'wh2', event: 'transfer.failed', status: 'failed', attempts: 6, responseCode: 500, createdAt: '2026-06-19T07:41:00Z' },
  { id: 'd4', endpointId: 'wh1', event: 'collection.received', status: 'delivered', attempts: 1, responseCode: 200, createdAt: '2026-06-19T06:11:00Z' },
];

const API_KEYS: ApiKey[] = [
  { id: 'k1', customer: 'Acme Ltd', label: 'Production', prefix: 'sk_live_8x21', mode: 'live', lastUsed: '2026-06-19T10:20:00Z', createdAt: '2026-05-30T10:00:00Z' },
  { id: 'k2', customer: 'Acme Ltd', label: 'Sandbox', prefix: 'sk_test_4a90', mode: 'sandbox', lastUsed: '2026-06-18T18:00:00Z', createdAt: '2026-05-30T10:00:00Z' },
  { id: 'k3', customer: 'Jane Doe', label: 'Default', prefix: 'sk_test_1f02', mode: 'sandbox', lastUsed: null, createdAt: '2026-06-12T10:00:00Z' },
];

export async function getWebhookEndpoints(): Promise<WebhookEndpoint[]> {
  if (USE_MOCK) { await delay(); return ENDPOINTS; }
  return readLive<WebhookEndpoint[]>(`${adminBase()}/webhooks/endpoints`);
}

export async function getWebhookDeliveries(): Promise<WebhookDelivery[]> {
  if (USE_MOCK) { await delay(); return DELIVERIES; }
  return readLive<WebhookDelivery[]>(`${adminBase()}/webhooks/deliveries`);
}

export async function replayDelivery(id: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) noBackend('Replaying a webhook delivery');
  return writeLive(`${adminBase()}/webhooks/deliveries/${id}/replay`, { method: 'POST', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:webhook-replay', id) } });
}

export async function toggleEndpoint(id: string, enabled: boolean): Promise<{ ok: boolean }> {
  if (USE_MOCK) noBackend('Toggling a webhook endpoint');
  return writeLive(`${adminBase()}/webhooks/endpoints/${id}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:webhook-endpoint-toggle', id) }, body: JSON.stringify({ enabled }) });
}

export async function getApiKeys(): Promise<ApiKey[]> {
  if (USE_MOCK) { await delay(); return API_KEYS; }
  return readLive<ApiKey[]>(`${adminBase()}/webhooks/api-keys`);
}

export async function getAnalytics(): Promise<FxAnalytics> {
  if (USE_MOCK) {
    await delay();
    return {
      marginByCorridor: [
        { corridor: 'USD-NGN', volumeUsdCents: 1_920_000_00, marginUsdCents: 22_400_00, marginBps: 117 },
        { corridor: 'USD-XAF', volumeUsdCents: 640_000_00, marginUsdCents: 9_100_00, marginBps: 142 },
        { corridor: 'EUR-NGN', volumeUsdCents: 580_000_00, marginUsdCents: 7_300_00, marginBps: 126 },
        { corridor: 'USD-GHS', volumeUsdCents: 410_000_00, marginUsdCents: 5_200_00, marginBps: 127 },
      ],
      providerReliability: [
        { provider: 'eversend', successRate: 98.7, avgLatencyMs: 540, failovers: 6, uptime: 99.9 },
        { provider: 'vertofx', successRate: 97.9, avgLatencyMs: 690, failovers: 11, uptime: 99.5 },
      ],
      routingEfficiency: [
        { corridor: 'USD-NGN', chosenVsBestBps: 2.1, optimalPct: 96 },
        { corridor: 'USD-XAF', chosenVsBestBps: 4.8, optimalPct: 88 },
        { corridor: 'EUR-NGN', chosenVsBestBps: 1.4, optimalPct: 98 },
      ],
      retentionCohorts: [
        { cohort: 'Mar 2026', m1: 100, m2: 71, m3: 58 },
        { cohort: 'Apr 2026', m1: 100, m2: 74, m3: 61 },
        { cohort: 'May 2026', m1: 100, m2: 78, m3: 0 },
      ],
    };
  }
  return readLive<FxAnalytics>(`${adminBase()}/analytics`);
}

const VA_REGISTRY: VirtualAccountReg[] = [
  { id: 'va1', customer: 'Acme Ltd', currency: 'USD', type: 'iban', identifier: 'GB29NWBK60161331926819', provider: 'eversend', status: 'active', createdAt: '2026-05-20T10:00:00Z' },
  { id: 'va2', customer: 'Acme Ltd', currency: 'NGN', type: 'virtual_account', identifier: '9901234567', provider: 'vertofx', status: 'active', createdAt: '2026-05-21T10:00:00Z' },
  { id: 'va3', customer: 'Jane Doe', currency: 'NGN', type: 'virtual_account', identifier: '9907654321', provider: 'vertofx', status: 'active', createdAt: '2026-06-12T10:00:00Z' },
  { id: 'va4', customer: 'Kwame Mensah', currency: 'USD', type: 'iban', identifier: 'GB12ABCD09876543210987', provider: 'eversend', status: 'closed', createdAt: '2026-04-18T10:00:00Z' },
];

const COLLECTION_EVENTS: AdminCollectionEvent[] = [
  { id: 'ce1', customer: 'Acme Ltd', amountMinor: 1_200_00, currency: 'USD', sender: 'Stripe Payouts', reference: 'INV-2031', createdAt: '2026-06-19T06:11:00Z' },
  { id: 'ce2', customer: 'Acme Ltd', amountMinor: 350_000_00, currency: 'NGN', sender: 'Adaeze Nwosu', reference: 'Rent', createdAt: '2026-06-18T15:00:00Z' },
  { id: 'ce3', customer: 'Jane Doe', amountMinor: 80_000_00, currency: 'NGN', sender: 'Salary', reference: 'June pay', createdAt: '2026-06-18T09:00:00Z' },
];

const BEN_ISSUES: BeneficiaryValidationIssue[] = [
  { id: 'bi1', corridor: 'USD-GHS', beneficiary: 'Kwame Mensah', rail: 'mobile_money', reason: 'Vodafone Cash number failed name resolution', count: 3 },
  { id: 'bi2', corridor: 'USD-XAF', beneficiary: 'Various', rail: 'mobile_money', reason: 'Operator timeout during validation', count: 5 },
];

export async function getVaRegistry(): Promise<VirtualAccountReg[]> {
  if (USE_MOCK) { await delay(); return VA_REGISTRY; }
  return readLive<VirtualAccountReg[]>(`${adminBase()}/collections/registry`);
}
export async function getCollectionEvents(): Promise<AdminCollectionEvent[]> {
  if (USE_MOCK) { await delay(); return COLLECTION_EVENTS; }
  return readLive<AdminCollectionEvent[]>(`${adminBase()}/collections/events`);
}
export async function getBeneficiaryIssues(): Promise<BeneficiaryValidationIssue[]> {
  if (USE_MOCK) { await delay(); return BEN_ISSUES; }
  return readLive<BeneficiaryValidationIssue[]>(`${adminBase()}/collections/beneficiary-issues`);
}

const ISSUED_CARDS: IssuedCard[] = [
  { id: 'ic1', customer: 'Acme Ltd', brand: 'visa', currency: 'USD', last4: '4242', status: 'active', provider: 'eversend', balanceMinor: 420_00, spentMinor: 86_40, createdAt: '2026-04-20T10:00:00Z' },
  { id: 'ic2', customer: 'Acme Ltd', brand: 'mastercard', currency: 'USD', last4: '5588', status: 'frozen', provider: 'eversend', balanceMinor: 1_250_00, spentMinor: 0, createdAt: '2026-05-30T10:00:00Z' },
  { id: 'ic3', customer: 'Jane Doe', brand: 'visa', currency: 'USD', last4: '9012', status: 'active', provider: 'eversend', balanceMinor: 60_00, spentMinor: 44_10, createdAt: '2026-06-12T10:00:00Z' },
];

const SUSPICIOUS: SuspiciousCardActivity[] = [
  { id: 'sc1', cardId: 'ic3', customer: 'Jane Doe', reason: '4 declines in 2 minutes at foreign merchant', severity: 'high', createdAt: '2026-06-19T08:30:00Z' },
  { id: 'sc2', cardId: 'ic1', customer: 'Acme Ltd', reason: 'Charge from new MCC (gambling)', severity: 'medium', createdAt: '2026-06-18T20:00:00Z' },
];

export async function getIssuedCards(): Promise<IssuedCard[]> {
  if (USE_MOCK) { await delay(); return ISSUED_CARDS; }
  return readLive<IssuedCard[]>(`${adminBase()}/cards`);
}
export async function setIssuedCardStatus(id: string, status: IssuedCardStatus): Promise<{ ok: boolean }> {
  if (USE_MOCK) noBackend('Setting an issued card status');
  return writeLive(`${adminBase()}/cards/${id}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:card-status', id) }, body: JSON.stringify({ status }) });
}
export async function getSuspiciousCardActivity(): Promise<SuspiciousCardActivity[]> {
  if (USE_MOCK) { await delay(); return SUSPICIOUS; }
  return readLive<SuspiciousCardActivity[]>(`${adminBase()}/cards/suspicious`);
}

const CATALOGUE: FxSettingsCatalogue = {
  corridors: [
    { corridor: 'USD-NGN', enabled: true, defaultProvider: 'auto' },
    { corridor: 'EUR-NGN', enabled: true, defaultProvider: 'eversend' },
    { corridor: 'GBP-NGN', enabled: true, defaultProvider: 'auto' },
    { corridor: 'USD-XAF', enabled: true, defaultProvider: 'vertofx' },
    { corridor: 'USD-GHS', enabled: true, defaultProvider: 'eversend' },
    { corridor: 'USD-KES', enabled: false, defaultProvider: 'eversend' },
  ],
  currencies: [
    { code: 'NGN', name: 'Nigerian Naira', kind: 'fiat', enabled: true },
    { code: 'USD', name: 'US Dollar', kind: 'fiat', enabled: true },
    { code: 'EUR', name: 'Euro', kind: 'fiat', enabled: true },
    { code: 'GBP', name: 'British Pound', kind: 'fiat', enabled: true },
    { code: 'GHS', name: 'Ghanaian Cedi', kind: 'fiat', enabled: true },
    { code: 'KES', name: 'Kenyan Shilling', kind: 'fiat', enabled: false },
    { code: 'XAF', name: 'Central African CFA', kind: 'fiat', enabled: true },
    { code: 'USDC', name: 'USD Coin', kind: 'stablecoin', enabled: true },
    { code: 'USDT', name: 'Tether USD', kind: 'stablecoin', enabled: true },
  ],
  rails: [
    { rail: 'bank_transfer', label: 'Bank transfer', enabled: true },
    { rail: 'mobile_money', label: 'Mobile money', enabled: true },
    { rail: 'iban', label: 'IBAN (ACH/SEPA)', enabled: true },
    { rail: 'wallet', label: 'Paymax wallet', enabled: true },
    { rail: 'stablecoin', label: 'Stablecoin', enabled: true },
  ],
  flags: [
    { key: 'fx_orchestration', label: 'FX orchestration', enabled: true },
    { key: 'cards', label: 'Virtual cards', enabled: true },
    { key: 'collections', label: 'Collections (VA/IBAN)', enabled: true },
    { key: 'stablecoin_rebalance', label: 'Stablecoin treasury rebalancing', enabled: true },
    { key: 'maker_checker', label: 'Maker-checker approvals (business)', enabled: true },
    { key: 'auto_failover', label: 'Provider auto-failover', enabled: true },
  ],
};

export async function getCatalogue(): Promise<FxSettingsCatalogue> {
  if (USE_MOCK) { await delay(); return CATALOGUE; }
  return readLive<FxSettingsCatalogue>(`${adminBase()}/settings/catalogue`);
}

export async function toggleFlag(key: string, enabled: boolean): Promise<{ ok: boolean }> {
  if (USE_MOCK) noBackend('Toggling a feature flag');
  return writeLive(`${adminBase()}/settings/flags/${key}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:flag-toggle', key) }, body: JSON.stringify({ enabled }) });
}

export async function toggleCorridor(corridor: string, enabled: boolean): Promise<{ ok: boolean }> {
  if (USE_MOCK) noBackend('Toggling a corridor');
  return writeLive(`${adminBase()}/settings/corridors/${corridor}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:corridor-toggle', corridor) }, body: JSON.stringify({ enabled }) });
}

export async function toggleCurrency(code: string, enabled: boolean): Promise<{ ok: boolean }> {
  if (USE_MOCK) noBackend('Toggling a currency');
  return writeLive(`${adminBase()}/settings/currencies/${code}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:currency-toggle', code) }, body: JSON.stringify({ enabled }) });
}
