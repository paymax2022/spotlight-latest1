/**
 * Utility Payments catalogue admin — providers, billers, category settings,
 * products and provider→product mappings. A Path A console (admin
 * consolidation; see docs/adr/ADR-047-admin-console-consolidation-path-a.md),
 * reached over the same /api/web-proxy other finance consoles here use.
 *
 * Ported from the orphaned frontend-web/src/components/admin/UtilityAdminConsole.tsx
 * (built for the retired frontend-web/app/admin, never mounted after that
 * surface was deleted in ADR-047 — see PR #167). Same API routes
 * (frontend-web/app/api/admin/utility/{providers,billers,categories,
 * provider-products}), same request/response shapes, same behavior.
 *
 * Deliberately does NOT cover utility_transactions (list/requery/reverse) —
 * that's utilityPaymentsAdminService.ts / app/admin/utility-payments/page.tsx.
 * Every route here is gated server-side on utility:manage only (see
 * requireUtilityManager in frontend-web/app/api/admin/utility/_utils.ts) —
 * unlike transactions, utility:support alone cannot reach any of it.
 */
import { webProxyBase } from '@/config/env';

export const UTILITY_CATEGORIES = ['airtime', 'data', 'electricity', 'cable_tv', 'internet', 'education'] as const;
export type UtilityCategory = typeof UTILITY_CATEGORIES[number];

export interface UtilityProvider {
  id: string;
  name: string;
  code: string;
  adapter_code: string;
  status: string;
  health_status: string;
  supported_categories: string[];
  priority: number;
}

export interface UtilityBiller {
  id: string;
  name: string;
  code: string;
  category: string;
  status: string;
  requires_validation: boolean;
}

export interface UtilityCategorySetting {
  category: string;
  enabled: boolean;
  availability_message: string | null;
  daily_limit_kobo: number | null;
  min_amount_kobo: number | null;
  max_amount_kobo: number | null;
}

export interface UtilityProduct {
  id: string;
  biller_id: string;
  name: string;
  code: string;
  category: string;
  amount_type: string;
  amount_kobo: number | null;
  provider_discount_bps: number;
}

export interface UtilityProviderProductMapping {
  id: string;
  provider_id: string;
  product_id: string;
  provider_product_code: string;
  provider_biller_code: string | null;
  provider_cost_kobo: number | null;
  provider_discount_bps: number;
  status: string;
}

function webBase(): string {
  return webProxyBase();
}

function authHeaders(json = false, extra?: Record<string, string>): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  const headers: Record<string, string> = { ...extra };
  if (json) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readJsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new Error(`${label} failed: 401 — sign in again.`);
  if (res.status === 403) throw new Error(`${label} failed: 403 — this account needs the utility:manage permission.`);
  if (!res.ok || json?.success === false) throw new Error(`${label} failed: ${(json.error as string) || res.status}`);
  return json;
}

export function formatNaira(kobo: number | null | undefined): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format((kobo ?? 0) / 100);
}

export function formatBps(bps: number | null | undefined): string {
  return `${((bps ?? 0) / 100).toFixed(2)}%`;
}

export function percentToBps(value: string | number | null | undefined): number {
  const percent = Number(value || 0);
  return Math.round(percent * 100);
}

// ── Providers ────────────────────────────────────────────────────────────────

export async function listProviders(): Promise<UtilityProvider[]> {
  const res = await fetch(`${webBase()}/api/admin/utility/providers`, { cache: 'no-store', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Loading providers');
  return Array.isArray(json.providers) ? json.providers as UtilityProvider[] : [];
}

export async function createProvider(input: { name: string; code: string; adapter_code: string }): Promise<UtilityProvider> {
  const res = await fetch(`${webBase()}/api/admin/utility/providers`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      name: input.name,
      code: input.code,
      adapter_code: input.adapter_code,
      supported_categories: [...UTILITY_CATEGORIES],
      priority: 50,
      health_status: 'unknown',
    }),
  });
  const json = await readJsonOrThrow(res, 'Creating provider');
  return json.provider as UtilityProvider;
}

export async function updateProviderStatus(id: string, status: string): Promise<UtilityProvider> {
  const res = await fetch(`${webBase()}/api/admin/utility/providers/${id}`, {
    method: 'PATCH',
    headers: authHeaders(true),
    body: JSON.stringify({ status }),
  });
  const json = await readJsonOrThrow(res, 'Updating provider');
  return json.provider as UtilityProvider;
}

export async function healthCheckProvider(id: string): Promise<unknown> {
  const res = await fetch(`${webBase()}/api/admin/utility/providers/${id}/health-check`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Checking provider health');
  return json.health;
}

// ── Category settings ───────────────────────────────────────────────────────

export async function listCategorySettings(): Promise<UtilityCategorySetting[]> {
  const res = await fetch(`${webBase()}/api/admin/utility/categories`, { cache: 'no-store', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Loading category settings');
  return Array.isArray(json.categories) ? json.categories as UtilityCategorySetting[] : [];
}

export async function updateCategorySetting(category: string, patch: Partial<UtilityCategorySetting>): Promise<UtilityCategorySetting> {
  const res = await fetch(`${webBase()}/api/admin/utility/categories/${category}`, {
    method: 'PATCH',
    headers: authHeaders(true),
    body: JSON.stringify(patch),
  });
  const json = await readJsonOrThrow(res, 'Updating category settings');
  return json.category as UtilityCategorySetting;
}

// ── Billers ──────────────────────────────────────────────────────────────────

export async function listBillers(): Promise<UtilityBiller[]> {
  const res = await fetch(`${webBase()}/api/admin/utility/billers`, { cache: 'no-store', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Loading billers');
  return Array.isArray(json.billers) ? json.billers as UtilityBiller[] : [];
}

export async function createBiller(input: {
  name: string; code: string; category: string; requires_validation: boolean; customer_reference_label: string;
}): Promise<UtilityBiller> {
  const res = await fetch(`${webBase()}/api/admin/utility/billers`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      name: input.name,
      code: input.code,
      category: input.category,
      requires_validation: input.requires_validation,
      customer_reference_label: input.customer_reference_label,
      status: 'active',
      dynamic_fields: [],
    }),
  });
  const json = await readJsonOrThrow(res, 'Creating biller');
  return json.biller as UtilityBiller;
}

// ── Products ─────────────────────────────────────────────────────────────────

export async function listProducts(): Promise<UtilityProduct[]> {
  const res = await fetch(`${webBase()}/api/admin/utility/products`, { cache: 'no-store', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Loading products');
  return Array.isArray(json.products) ? json.products as UtilityProduct[] : [];
}

export async function createProduct(input: {
  name: string; code: string; category: string; biller_id: string; amount_type: string;
  amount_naira: number; min_amount_naira: number; max_amount_naira: number;
  markup_bps: number; provider_discount_bps: number;
}): Promise<UtilityProduct> {
  const res = await fetch(`${webBase()}/api/admin/utility/products`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      name: input.name,
      code: input.code,
      category: input.category,
      biller_id: input.biller_id,
      amount_type: input.amount_type,
      amount_kobo: input.amount_naira > 0 ? Math.round(input.amount_naira * 100) : null,
      min_amount_kobo: input.min_amount_naira > 0 ? Math.round(input.min_amount_naira * 100) : null,
      max_amount_kobo: input.max_amount_naira > 0 ? Math.round(input.max_amount_naira * 100) : null,
      convenience_fee_kobo: 0,
      markup_bps: input.markup_bps,
      provider_discount_bps: input.provider_discount_bps,
      status: 'active',
      metadata: {},
    }),
  });
  const json = await readJsonOrThrow(res, 'Creating product');
  return json.product as UtilityProduct;
}

// ── Provider ↔ product mappings (service discounts) ─────────────────────────

export async function listProviderProductMappings(): Promise<UtilityProviderProductMapping[]> {
  const res = await fetch(`${webBase()}/api/admin/utility/provider-products`, { cache: 'no-store', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Loading provider service mappings');
  return Array.isArray(json.mappings) ? json.mappings as UtilityProviderProductMapping[] : [];
}

export async function createProviderProductMapping(input: {
  provider_id: string; product_id: string; provider_product_code: string;
  provider_biller_code: string; provider_cost_naira: number; provider_discount_bps: number;
}): Promise<UtilityProviderProductMapping> {
  const res = await fetch(`${webBase()}/api/admin/utility/provider-products`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      provider_id: input.provider_id,
      product_id: input.product_id,
      provider_product_code: input.provider_product_code,
      provider_biller_code: input.provider_biller_code || null,
      provider_cost_kobo: input.provider_cost_naira > 0 ? Math.round(input.provider_cost_naira * 100) : null,
      provider_discount_bps: input.provider_discount_bps,
      status: 'active',
    }),
  });
  const json = await readJsonOrThrow(res, 'Creating provider service mapping');
  return json.mapping as UtilityProviderProductMapping;
}

export async function updateProviderProductMapping(id: string, input: {
  discount_percent: string | number; provider_cost_naira: number; status: string;
}): Promise<UtilityProviderProductMapping> {
  const res = await fetch(`${webBase()}/api/admin/utility/provider-products/${id}`, {
    method: 'PATCH',
    headers: authHeaders(true),
    body: JSON.stringify({
      provider_discount_bps: percentToBps(input.discount_percent),
      provider_cost_kobo: input.provider_cost_naira > 0 ? Math.round(input.provider_cost_naira * 100) : null,
      status: input.status,
    }),
  });
  const json = await readJsonOrThrow(res, 'Updating provider service discount');
  return json.mapping as UtilityProviderProductMapping;
}
