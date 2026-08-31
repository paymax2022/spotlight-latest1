// ── Admin — Paymax Insurance control-plane service ───────────────────────────
//
// LIVE ONLY. There is no fixture mode in this file and one must not be added.
//
// WHY: this console previously shipped a full fixture set behind
// NEXT_PUBLIC_INSURANCE_USE_MOCK (defaulting to MOCK), and rendered ₦84.9m of
// gross written premium, 41,882 active policies and two "healthy" provider rails
// against a system that has sold exactly ZERO policies. An operations console
// that invents numbers is worse than one that shows nothing: nothing gets
// escalated, and the fabrication is indistinguishable from real data at a
// glance. The precedent is docs/audit/ADMIN_SIMULATED_WRITES.md.
//
// Every function below hits `/api/insurance/admin/*` through the same-origin
// admin proxy and THROWS an `InsuranceAdminError` on any failure. Pages render
// that error verbatim (endpoint, method, HTTP status, backend message). A 404
// means the backend has not built the endpoint yet and the page must say so.
//
// MONEY: all `*_kobo` values are integers in minor units and are passed through
// untouched. MyCover speaks naira decimal strings; the Go adapter converts
// naira→kobo exactly once. Nothing here re-converts, and nothing here does
// arithmetic that could produce a float kobo value. Formatting happens only in
// `formatNaira` / `formatRateBps`, at the render boundary.

import { apiRoot } from '@/config/env';
import type {
  CatalogResponse,
  CatalogSyncResult,
  CatalogSyncStatus,
  ClaimDetail,
  ClaimSummary,
  CommissionEntry,
  CommissionSummary,
  FailureKind,
  InsuranceDashboard,
  InsuranceProduct,
  Paged,
  PolicyDetail,
  PolicySummary,
  ProviderStatus,
  ReconciliationReport,
  SharingFormula,
} from '@/types/insuranceAdmin';

/**
 * The backend mounts this module at an absolute root of its own
 * (`/api/insurance/admin`, see backend/internal/app/finance_routes.go), so the
 * caller must spell the full path out. apiRoot() strips any trailing /api/v1
 * from the proxy base and nothing else.
 *
 * The previous implementation did
 *   env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/insurance/admin')
 * which stopped matching the moment apiBaseUrl became the same-origin proxy
 * path (<origin>/api/admin-proxy, no /api/v1 suffix). Every request then went
 * to <proxy>/dashboard instead of <proxy>/api/insurance/admin/dashboard — i.e.
 * the live path was 404-ing on its own, and only the fixture default hid it.
 */
export const ADMIN_PATH = '/api/insurance/admin';
function adminBase(): string {
  return `${apiRoot()}${ADMIN_PATH}`;
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function newIdempotencyKey(prefix: string): string {
  return `ins-admin-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

// ── Error surface ────────────────────────────────────────────────────────────

function classify(status: number): FailureKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_implemented';
  if (status >= 500) return 'server';
  if (status > 0) return 'bad_request';
  return 'network';
}

/**
 * A failed admin call, carrying everything an operator needs to act on it: what
 * we asked for, what came back, and what that class of failure means. Pages
 * render these fields rather than `String(e)`.
 */
export class InsuranceAdminError extends Error {
  readonly status: number;
  readonly kind: FailureKind;
  readonly method: string;
  /** Backend path, e.g. `/api/insurance/admin/dashboard`. */
  readonly path: string;
  /** The backend's own message, when it sent one. */
  readonly detail: string | null;

  constructor(args: {
    status: number;
    kind?: FailureKind;
    method: string;
    path: string;
    detail?: string | null;
  }) {
    const kind = args.kind ?? classify(args.status);
    super(`${args.method} ${args.path} failed (${args.status || 'no response'})`);
    this.name = 'InsuranceAdminError';
    this.status = args.status;
    this.kind = kind;
    this.method = args.method;
    this.path = args.path;
    this.detail = args.detail ?? null;
  }

  /** One-line headline for the error card. */
  get headline(): string {
    switch (this.kind) {
      case 'not_implemented':
        return 'This endpoint is not built yet';
      case 'unauthorized':
        return 'The API rejected this request as unauthenticated';
      case 'forbidden':
        return 'Your admin role is missing the required permission';
      case 'server':
        return 'The backend returned an error';
      case 'network':
        return 'The admin API could not be reached';
      case 'malformed':
        return 'The API returned a response this console could not read';
      default:
        return 'The request was rejected';
    }
  }

  /** What the operator should understand from it. No speculation. */
  get explanation(): string {
    switch (this.kind) {
      case 'not_implemented':
        return `The backend has no handler for ${this.path}. Nothing is shown because there is nothing to show — this page is not hiding data behind an error.`;
      case 'unauthorized':
        return 'Your admin session token was sent with the request and the backend still refused it. This is a backend auth-wiring problem, not a login problem — signing in again will not change it.';
      case 'forbidden':
        return 'The session was accepted but the RBAC check failed. This screen needs an insurance.* permission your role does not carry.';
      case 'server':
        return 'The request reached the backend and the handler failed. The backend message is shown below.';
      case 'network':
        return 'The request never got a response. The Go API or the admin proxy is likely down.';
      case 'malformed':
        return 'The endpoint answered but the payload did not match the internal contract, so it is not being rendered rather than guessed at.';
      default:
        return 'The backend rejected the request. Its message is shown below.';
    }
  }
}

// ── Transport ────────────────────────────────────────────────────────────────

function backendMessage(body: string): string | null {
  if (!body) return null;
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const err = j.error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const m = (err as Record<string, unknown>).message;
      if (typeof m === 'string') return m;
    }
    if (typeof j.message === 'string') return j.message;
  } catch {
    /* not JSON — fall through to the raw text */
  }
  return body.slice(0, 400).trim() || null;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  opts?: { body?: unknown; idempotencyPrefix?: string },
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...authHeaders() };
  if (opts?.body !== undefined) headers['Content-Type'] = 'application/json';
  // Every mutating admin call carries an Idempotency-Key; the admin proxy
  // forwards this header verbatim.
  if (method !== 'GET') headers['Idempotency-Key'] = newIdempotencyKey(opts?.idempotencyPrefix ?? 'op');

  let res: Response;
  try {
    res = await fetch(`${adminBase()}${path}`, {
      method,
      headers,
      body: opts?.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new InsuranceAdminError({ status: 0, kind: 'network', method, path: `${ADMIN_PATH}${path}` });
  }

  const text = await res.text();
  if (!res.ok) {
    throw new InsuranceAdminError({
      status: res.status,
      method,
      path: `${ADMIN_PATH}${path}`,
      detail: backendMessage(text),
    });
  }
  if (!text.trim()) return undefined as T;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    return ('data' in j ? j.data : j) as T;
  } catch {
    throw new InsuranceAdminError({
      status: res.status,
      kind: 'malformed',
      method,
      path: `${ADMIN_PATH}${path}`,
      detail: text.slice(0, 200),
    });
  }
}

// ── Render-boundary formatters ───────────────────────────────────────────────

/**
 * kobo (integer minor units) → "₦1,234.56".
 *
 * This divides by 100 for DISPLAY only. Never feed the result back into a
 * calculation, and never call this on a rate — see formatRateBps.
 */
export function formatNaira(kobo: number | null | undefined): string {
  if (kobo === null || kobo === undefined || !Number.isFinite(kobo)) return '—';
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact kobo → "₦1.2m" for KPI tiles. Display only. */
export function formatNairaCompact(kobo: number | null | undefined): string {
  if (kobo === null || kobo === undefined || !Number.isFinite(kobo)) return '—';
  const naira = kobo / 100;
  const abs = Math.abs(naira);
  if (abs >= 1_000_000_000) return `₦${(naira / 1_000_000_000).toFixed(2)}bn`;
  if (abs >= 1_000_000) return `₦${(naira / 1_000_000).toFixed(2)}m`;
  if (abs >= 10_000) return `₦${(naira / 1_000).toFixed(1)}k`;
  return formatNaira(kobo);
}

/**
 * Basis points → "0.50%".
 *
 * A percentage product's `base_price` is a RATE applied to the sum insured, not
 * a premium. Rendering it through formatNaira would print "₦0.50" for a 0.5%
 * goods-in-transit rate — off by orders of magnitude and silently wrong.
 */
export function formatRateBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return '—';
  return `${(bps / 100).toFixed(2)}%`;
}

/** Percent value (10 → "10%", 12.5 → "12.5%"). Not money. */
export function formatPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

/**
 * A product's headline price — either a flat premium in kobo or a rate.
 * Returns a display string plus which kind it is, so callers cannot accidentally
 * treat a rate as an amount.
 */
export function productPrice(p: InsuranceProduct): { text: string; kind: 'amount' | 'rate' | 'unknown' } {
  if (p.is_percentage) {
    if (p.rate_bps === null || p.rate_bps === undefined) return { text: '—', kind: 'unknown' };
    return { text: `${formatRateBps(p.rate_bps)} of sum insured`, kind: 'rate' };
  }
  if (p.base_price_kobo === null || p.base_price_kobo === undefined) return { text: '—', kind: 'unknown' };
  return { text: formatNaira(p.base_price_kobo), kind: 'amount' };
}

/**
 * Distributor commission in kobo for a given premium, integer math only.
 * `pct` is a percentage (10 = 10%). Rounds to the nearest kobo — never returns
 * a fractional minor unit.
 */
export function commissionKoboFor(premiumKobo: number, pct: number | null | undefined): number | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  if (!Number.isFinite(premiumKobo)) return null;
  return Math.round((premiumKobo * pct) / 100);
}

/** The single sharing band to headline, when a product has more than one. */
export function primaryBand(p: InsuranceProduct): SharingFormula | null {
  const bands = p.sharing_formula;
  if (!bands || bands.length === 0) return null;
  return bands[0];
}

// ── Normalisers ──────────────────────────────────────────────────────────────
//
// The backend is being built against the same internal contract, but the
// pre-existing catalog handler still returns the older column names
// (display_name / underwriter_display / indicative_premium_kobo). These
// normalisers ALIAS those spellings onto the contract shape. Aliasing a field
// the backend really sent is not fabrication; inventing a value for a field it
// did not send is, and nothing below does that — absent fields stay null.

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

function normaliseBand(raw: unknown): SharingFormula {
  const o = (raw ?? {}) as Record<string, unknown>;
  const from = (v: unknown): 'original_premium' | 'final_premium' | null =>
    v === 'original_premium' || v === 'final_premium' ? v : null;
  return {
    distributor_commission_pct: num(o.distributor_commission),
    mca_commission_pct: num(o.mca_commission),
    provider_commission_pct: num(o.provider_commission),
    provider_commission_from: from(o.provider_commission_from),
    distributor_commission_from: from(o.distributor_commission_from),
    min: num(o.min),
    max: num(o.max),
    band_key: str(pick(o, 'min_max_key_name', 'band_key') ?? null),
  };
}

function normaliseProduct(raw: unknown): InsuranceProduct {
  const o = (raw ?? {}) as Record<string, unknown>;
  const isPct = pick(o, 'is_percentage') === true;
  const bandsRaw = pick(o, 'sharing_formula');
  return {
    code: String(pick(o, 'code', 'product_code', 'id') ?? ''),
    name: String(pick(o, 'name', 'display_name') ?? ''),
    description: str(pick(o, 'description')),
    product_line: String(pick(o, 'product_line', 'category', 'line') ?? 'unknown'),
    category: str(pick(o, 'category', 'category_name')),
    underwriter: String(pick(o, 'underwriter', 'underwriter_display', 'provider_name') ?? ''),
    underwriter_logo_url: str(pick(o, 'underwriter_logo_url', 'logo_url')),
    aggregator: String(pick(o, 'aggregator', 'provider') ?? 'mycover'),
    provider_product_code: str(pick(o, 'provider_product_code', 'route_name')),
    provider_buy_path: str(pick(o, 'provider_buy_path', 'buy_path')),
    base_price_kobo: isPct ? null : num(pick(o, 'base_price_kobo', 'indicative_premium_kobo', 'premium_kobo')),
    is_percentage: isPct,
    rate_bps: isPct ? num(pick(o, 'rate_bps')) : null,
    sum_insured_kobo: num(pick(o, 'sum_insured_kobo')),
    cover_period_days: num(pick(o, 'cover_period_days', 'cover_period')),
    currency: str(pick(o, 'currency')) ?? 'NGN',
    is_renewable: bool(pick(o, 'is_renewable')),
    is_claimable: bool(pick(o, 'is_claimable')),
    is_certificateable: bool(pick(o, 'is_certificateable')),
    is_inspectable: bool(pick(o, 'is_inspectable')),
    active: pick(o, 'active', 'is_active') === true,
    sharing_formula: Array.isArray(bandsRaw) ? bandsRaw.map(normaliseBand) : null,
    key_benefits_html: str(pick(o, 'key_benefits_html', 'key_benefits')),
    full_benefits_html: str(pick(o, 'full_benefits_html', 'full_benefits')),
    how_it_works_html: str(pick(o, 'how_it_works_html', 'how_it_works')),
    how_to_claim_html: str(pick(o, 'how_to_claim_html', 'how_to_claim')),
    policies_active: num(pick(o, 'policies_active')),
    updated_at: str(pick(o, 'updated_at')),
    created_at: str(pick(o, 'created_at')),
  };
}

/** Unwrap `{items|products|policies|claims: []}` or a bare array. */
function asArray(payload: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    for (const k of [...keys, 'items', 'data', 'results']) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
  }
  return [];
}

function pagedFrom<T>(payload: unknown, items: T[], page: number, pageSize: number): Paged<T> {
  const o = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const total = num(pick(o, 'total', 'total_count', 'count'));
  const hasMore = typeof o.has_more === 'boolean' ? o.has_more : items.length >= pageSize;
  return { items, page, page_size: pageSize, total, has_more: hasMore };
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || v === 'all') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export async function getDashboard(): Promise<InsuranceDashboard> {
  const raw = await request<unknown>('GET', '/dashboard');
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const breakdown = (v: unknown) =>
    Array.isArray(v)
      ? v.map((r) => {
          const b = (r ?? {}) as Record<string, unknown>;
          return {
            key: String(pick(b, 'key', 'name', 'category', 'underwriter') ?? '—'),
            policies: num(pick(b, 'policies', 'policy_count')),
            gross_premium_kobo: num(pick(b, 'gross_premium_kobo', 'premium_kobo')),
            commission_kobo: num(pick(b, 'commission_kobo', 'distributor_commission_kobo')),
            claims: num(pick(b, 'claims', 'claims_count')),
            claims_paid_kobo: num(pick(b, 'claims_paid_kobo')),
          };
        })
      : null;
  const cat = (o.catalog ?? null) as Record<string, unknown> | null;
  return {
    policies_total: num(pick(o, 'policies_total', 'policies', 'policy_count')),
    policies_active: num(pick(o, 'policies_active', 'active_policies')),
    policies_lapsed: num(pick(o, 'policies_lapsed', 'lapsed_policies')),
    policies_expired: num(pick(o, 'policies_expired')),
    policies_cancelled: num(pick(o, 'policies_cancelled')),
    policies_pending: num(pick(o, 'policies_pending')),
    gross_premium_kobo: num(pick(o, 'gross_premium_kobo', 'premium_kobo')),
    commission_kobo: num(pick(o, 'commission_kobo', 'distributor_commission_kobo')),
    claims_count: num(pick(o, 'claims_count', 'claims')),
    claims_open: num(pick(o, 'claims_open')),
    claims_paid_kobo: num(pick(o, 'claims_paid_kobo')),
    loss_ratio: num(pick(o, 'loss_ratio')),
    by_category: breakdown(pick(o, 'by_category')),
    by_underwriter: breakdown(pick(o, 'by_underwriter')),
    catalog: cat
      ? {
          products_total: num(pick(cat, 'products_total', 'total')),
          products_active: num(pick(cat, 'products_active', 'active')),
          last_synced_at: str(pick(cat, 'last_synced_at', 'synced_at')),
        }
      : null,
    generated_at: str(pick(o, 'generated_at', 'as_of')),
  };
}

// ── Catalog ──────────────────────────────────────────────────────────────────

export async function getCatalog(opts?: {
  underwriter?: string;
  line?: string;
  active?: boolean | 'all';
  q?: string;
}): Promise<CatalogResponse> {
  const raw = await request<unknown>(
    'GET',
    `/catalog${qs({
      underwriter: opts?.underwriter,
      line: opts?.line,
      active: opts?.active === 'all' ? undefined : opts?.active,
      q: opts?.q,
    })}`,
  );
  const products = asArray(raw, 'products', 'catalog').map(normaliseProduct);
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const s = (pick(o, 'sync', 'sync_status') ?? null) as Record<string, unknown> | null;
  const sync: CatalogSyncStatus | null = s
    ? {
        last_synced_at: str(pick(s, 'last_synced_at', 'synced_at')),
        local_count: num(pick(s, 'local_count', 'local')),
        provider_count: num(pick(s, 'provider_count', 'remote_count')),
        missing_locally: Array.isArray(s.missing_locally) ? (s.missing_locally as string[]) : null,
        stale_locally: Array.isArray(s.stale_locally) ? (s.stale_locally as string[]) : null,
        last_sync_error: str(pick(s, 'last_sync_error', 'error')),
      }
    : null;
  return { products, sync };
}

/**
 * Pull the live MyCover catalog into our DB.
 *
 * A real write against a real endpoint. If the endpoint is missing this THROWS
 * — it does not report a sync it never performed.
 */
export async function syncCatalog(): Promise<CatalogSyncResult> {
  const raw = await request<unknown>('POST', '/catalog/sync', { body: {}, idempotencyPrefix: 'catalog-sync' });
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    synced: num(pick(o, 'synced', 'count', 'total')),
    created: num(pick(o, 'created')),
    updated: num(pick(o, 'updated')),
    deactivated: num(pick(o, 'deactivated')),
    synced_at: str(pick(o, 'synced_at', 'last_synced_at')),
  };
}

/** Enable/disable a product. Real endpoint (PATCH /catalog/:code/active). */
export async function setProductActive(code: string, active: boolean): Promise<{ code: string; active: boolean }> {
  return request('PATCH', `/catalog/${encodeURIComponent(code)}/active`, {
    body: { active },
    idempotencyPrefix: 'catalog-active',
  });
}

export async function getProduct(code: string): Promise<InsuranceProduct> {
  const raw = await request<unknown>('GET', `/catalog/${encodeURIComponent(code)}`);
  return normaliseProduct(raw);
}

// ── Policies ─────────────────────────────────────────────────────────────────

function normalisePolicy(raw: unknown): PolicySummary {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(pick(o, 'id', 'policy_id') ?? ''),
    policy_ref: str(pick(o, 'policy_ref', 'reference')),
    provider_policy_ref: str(pick(o, 'provider_policy_ref')),
    product_code: String(pick(o, 'product_code') ?? ''),
    product_name: str(pick(o, 'product_name')),
    underwriter: str(pick(o, 'underwriter', 'underwriter_display')),
    aggregator: str(pick(o, 'aggregator', 'provider')),
    status: String(pick(o, 'status', 'state') ?? 'unknown'),
    premium_kobo: num(pick(o, 'premium_kobo')),
    sum_insured_kobo: num(pick(o, 'sum_insured_kobo')),
    commission_kobo: num(pick(o, 'commission_kobo')),
    currency: str(pick(o, 'currency')) ?? 'NGN',
    policyholder_masked: str(pick(o, 'policyholder_masked', 'policyholder')),
    policyholder_user_id: str(pick(o, 'policyholder_user_id', 'user_id')),
    starts_at: str(pick(o, 'starts_at', 'effective_at')),
    ends_at: str(pick(o, 'ends_at', 'expires_at')),
    created_at: str(pick(o, 'created_at')),
  };
}

export async function listPolicies(opts?: {
  status?: string;
  product_code?: string;
  underwriter?: string;
  q?: string;
  page?: number;
  page_size?: number;
}): Promise<Paged<PolicySummary>> {
  const page = opts?.page ?? 1;
  const pageSize = opts?.page_size ?? 25;
  const raw = await request<unknown>(
    'GET',
    `/policies${qs({
      status: opts?.status,
      product_code: opts?.product_code,
      underwriter: opts?.underwriter,
      q: opts?.q,
      page,
      page_size: pageSize,
    })}`,
  );
  return pagedFrom(raw, asArray(raw, 'policies').map(normalisePolicy), page, pageSize);
}

export async function getPolicy(id: string): Promise<PolicyDetail> {
  const raw = await request<unknown>('GET', `/policies/${encodeURIComponent(id)}`);
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    ...normalisePolicy(raw),
    certificate_url: str(pick(o, 'certificate_url')),
    quote_ref: str(pick(o, 'quote_ref')),
    inputs: (pick(o, 'inputs') as Record<string, unknown> | undefined) ?? null,
    timeline: Array.isArray(o.timeline)
      ? (o.timeline as Record<string, unknown>[]).map((t) => ({
          at: String(pick(t, 'at', 'created_at') ?? ''),
          status: String(pick(t, 'status', 'state') ?? ''),
          actor: str(pick(t, 'actor')),
          note: str(pick(t, 'note')),
        }))
      : null,
    claims: Array.isArray(o.claims) ? (o.claims as unknown[]).map(normaliseClaim) : null,
  };
}

// ── Claims ───────────────────────────────────────────────────────────────────

function normaliseClaim(raw: unknown): ClaimSummary {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(pick(o, 'id', 'claim_id') ?? ''),
    claim_ref: str(pick(o, 'claim_ref', 'reference')),
    provider_claim_ref: str(pick(o, 'provider_claim_ref')),
    policy_id: String(pick(o, 'policy_id') ?? ''),
    product_name: str(pick(o, 'product_name')),
    underwriter: str(pick(o, 'underwriter')),
    claimant_masked: str(pick(o, 'claimant_masked', 'claimant')),
    status: String(pick(o, 'status', 'state') ?? 'unknown'),
    claimed_amount_kobo: num(pick(o, 'claimed_amount_kobo', 'amount_kobo')),
    approved_amount_kobo: num(pick(o, 'approved_amount_kobo')),
    loss_event_at: str(pick(o, 'loss_event_at')),
    created_at: str(pick(o, 'created_at')),
  };
}

export async function listClaims(opts?: {
  status?: string;
  policy_id?: string;
  q?: string;
  page?: number;
  page_size?: number;
}): Promise<Paged<ClaimSummary>> {
  const page = opts?.page ?? 1;
  const pageSize = opts?.page_size ?? 25;
  const raw = await request<unknown>(
    'GET',
    `/claims${qs({ status: opts?.status, policy_id: opts?.policy_id, q: opts?.q, page, page_size: pageSize })}`,
  );
  return pagedFrom(raw, asArray(raw, 'claims').map(normaliseClaim), page, pageSize);
}

export async function getClaim(id: string): Promise<ClaimDetail> {
  const raw = await request<unknown>('GET', `/claims/${encodeURIComponent(id)}`);
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    ...normaliseClaim(raw),
    description: str(pick(o, 'description')),
    payout_ledger_ref: str(pick(o, 'payout_ledger_ref')),
    evidence: Array.isArray(o.evidence)
      ? (o.evidence as Record<string, unknown>[]).map((e) => ({
          id: String(pick(e, 'id') ?? ''),
          kind: str(pick(e, 'kind', 'type')),
          label: str(pick(e, 'label', 'name')),
          ref: str(pick(e, 'ref', 'signed_url_ref')),
          uploaded_at: str(pick(e, 'uploaded_at', 'created_at')),
        }))
      : null,
    timeline: Array.isArray(o.timeline)
      ? (o.timeline as Record<string, unknown>[]).map((t) => ({
          at: String(pick(t, 'at', 'created_at') ?? ''),
          status: String(pick(t, 'status', 'state') ?? ''),
          actor: str(pick(t, 'actor')),
          note: str(pick(t, 'note')),
        }))
      : null,
  };
}

// ── Commission ───────────────────────────────────────────────────────────────

export async function getCommission(opts?: {
  product_code?: string;
  underwriter?: string;
  from?: string;
  to?: string;
}): Promise<CommissionSummary> {
  const raw = await request<unknown>(
    'GET',
    `/commission${qs({
      product_code: opts?.product_code,
      underwriter: opts?.underwriter,
      from: opts?.from,
      to: opts?.to,
    })}`,
  );
  const entries: CommissionEntry[] = asArray(raw, 'entries', 'commission').map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      id: String(pick(o, 'id') ?? ''),
      policy_id: str(pick(o, 'policy_id')),
      product_code: str(pick(o, 'product_code')),
      product_name: str(pick(o, 'product_name')),
      underwriter: str(pick(o, 'underwriter')),
      premium_kobo: num(pick(o, 'premium_kobo')),
      commission_kobo: num(pick(o, 'commission_kobo', 'commission_amount_kobo')),
      basis_pct: num(pick(o, 'basis_pct', 'distributor_commission')),
      basis: str(pick(o, 'basis', 'commission_from', 'distributor_commission_from')),
      ledger_ref: str(pick(o, 'ledger_ref', 'revenue_ledger_ref')),
      reconciled: bool(pick(o, 'reconciled')),
      created_at: str(pick(o, 'created_at')),
    };
  });
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    entries,
    total_commission_kobo: num(pick(o, 'total_commission_kobo')),
    total_premium_kobo: num(pick(o, 'total_premium_kobo')),
    period_from: str(pick(o, 'period_from', 'from')),
    period_to: str(pick(o, 'period_to', 'to')),
  };
}

// ── Providers ────────────────────────────────────────────────────────────────

export async function getProviders(): Promise<ProviderStatus[]> {
  const raw = await request<unknown>('GET', '/providers');
  return asArray(raw, 'providers').map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const w = (pick(o, 'webhook', 'webhooks') ?? null) as Record<string, unknown> | null;
    return {
      provider: String(pick(o, 'provider', 'key') ?? ''),
      display_name: str(pick(o, 'display_name', 'name')),
      base_url: str(pick(o, 'base_url')),
      mode: str(pick(o, 'mode', 'environment')) ?? 'unknown',
      api_key_configured: bool(pick(o, 'api_key_configured')),
      api_key_hint: str(pick(o, 'api_key_hint', 'api_key_masked')),
      reachable: bool(pick(o, 'reachable', 'healthy')),
      last_success_at: str(pick(o, 'last_success_at')),
      last_error_at: str(pick(o, 'last_error_at')),
      last_error: str(pick(o, 'last_error')),
      latency_ms: num(pick(o, 'latency_ms')),
      products_synced: num(pick(o, 'products_synced')),
      webhook: w
        ? {
            url: str(pick(w, 'url')),
            secret_configured: bool(pick(w, 'secret_configured')),
            signature_scheme: str(pick(w, 'signature_scheme', 'scheme')),
            last_received_at: str(pick(w, 'last_received_at')),
            last_verified_at: str(pick(w, 'last_verified_at')),
            received_24h: num(pick(w, 'received_24h')),
            rejected_24h: num(pick(w, 'rejected_24h')),
          }
        : null,
      updated_at: str(pick(o, 'updated_at')),
    };
  });
}

// ── Reconciliation ───────────────────────────────────────────────────────────

export async function getReconciliation(): Promise<ReconciliationReport> {
  const raw = await request<unknown>('GET', '/reconciliation');
  const drifts = asArray(raw, 'drifts', 'breaks').map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      id: String(pick(o, 'id') ?? `drift-${i}`),
      kind: String(pick(o, 'kind', 'break_type', 'type') ?? 'unknown'),
      policy_id: str(pick(o, 'policy_id')),
      provider_policy_ref: str(pick(o, 'provider_policy_ref')),
      product_code: str(pick(o, 'product_code')),
      local_status: str(pick(o, 'local_status')),
      provider_status: str(pick(o, 'provider_status')),
      local_premium_kobo: num(pick(o, 'local_premium_kobo', 'paymax_amount_kobo')),
      provider_premium_kobo: num(pick(o, 'provider_premium_kobo', 'provider_amount_kobo')),
      delta_kobo: num(pick(o, 'delta_kobo')),
      detail: str(pick(o, 'detail', 'message')),
      detected_at: str(pick(o, 'detected_at', 'created_at')),
    };
  });
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    drifts,
    local_policy_count: num(pick(o, 'local_policy_count', 'local_count')),
    provider_policy_count: num(pick(o, 'provider_policy_count', 'provider_count')),
    matched_count: num(pick(o, 'matched_count', 'matched')),
    total_delta_kobo: num(pick(o, 'total_delta_kobo')),
    ran_at: str(pick(o, 'ran_at', 'generated_at')),
  };
}

// ── Endpoints that are NOT in the internal contract ───────────────────────────
//
// premiums / refunds / routing / schema / sweeps / reports / consent-audit /
// provider events / webhook deliveries all have console pages but no agreed
// endpoint. They call through here so that the day the backend adds one, the
// page lights up on its own — and until then the page renders the real 404
// instead of a fixture. `probe` deliberately has no fallback.
export async function probe<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}
