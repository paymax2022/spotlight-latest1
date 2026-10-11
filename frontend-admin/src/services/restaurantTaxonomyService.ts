// Admin-managed restaurant menu taxonomy and cuisines.
// Backend: backend/internal/restaurant/taxonomy, mounted only when
// FEATURE_RESTAURANT_ADMIN_CATEGORIES is on. RBAC: restaurant.manage.

import { apiRoot } from '@/config/env';

export type TaxonomyKind = 'FOOD' | 'DRINK' | 'OTHER';

export interface TaxonomyNode {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  kind: TaxonomyKind;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  is_system_seeded: boolean;
  item_count: number;
  children: TaxonomyNode[];
}

export interface Cuisine {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
  is_system_seeded: boolean;
}

export interface SeedReport {
  inserted: number;
  skipped: number;
  duplicates?: string[];
}

export class TaxonomyError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function base(): string {
  return `${apiRoot()}/api/restaurant/admin/menu-taxonomy`;
}

async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const code = typeof json.error === 'string' ? json.error : `http_${res.status}`;
    const msg = typeof json.message === 'string' ? json.message : code;
    throw new TaxonomyError(res.status, code, msg);
  }
  return (json.data ?? json) as T;
}

export function listCategories(): Promise<TaxonomyNode[]> {
  return request<TaxonomyNode[]>('GET', '/categories');
}

export function createCategory(input: { name: string; kind: TaxonomyKind; parent_id?: string | null; sort_order?: number }): Promise<TaxonomyNode> {
  return request<TaxonomyNode>('POST', '/categories', input);
}

export function setCategoryActive(id: string, isActive: boolean): Promise<TaxonomyNode> {
  return request<TaxonomyNode>('PATCH', `/categories/${encodeURIComponent(id)}`, { is_active: isActive });
}

export function deleteCategory(id: string): Promise<unknown> {
  return request<unknown>('DELETE', `/categories/${encodeURIComponent(id)}`);
}

export function seedDefaults(): Promise<SeedReport> {
  return request<SeedReport>('POST', '/categories/seed-defaults');
}

export function listCuisines(): Promise<Cuisine[]> {
  return request<Cuisine[]>('GET', '/cuisines');
}

export function createCuisine(name: string, sortOrder = 0): Promise<Cuisine> {
  return request<Cuisine>('POST', '/cuisines', { name, sort_order: sortOrder });
}

export function setCuisineActive(id: string, isActive: boolean): Promise<Cuisine> {
  return request<Cuisine>('PATCH', `/cuisines/${encodeURIComponent(id)}`, { is_active: isActive });
}
