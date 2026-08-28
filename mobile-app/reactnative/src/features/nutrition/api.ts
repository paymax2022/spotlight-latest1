// ── Nutrition Resolution Engine — API wrapper (v2) ───────────────────────────
// Typed data layer the nutrition screens code against. Mirrors food/api.ts:
// mock-flagged, shared axios `api` client, unwrap() envelope, BASE under the
// Next proxy which forwards /api/v1/nutrition/* → Go /api/finance/nutrition/*.
//
// v2 (onboarding-first): estimates auto-publish at menu upload; vendors APPROVE
// or lightly EDIT (portion + macro nudge only). Ingredient entry is an optional
// hidden recipe path. Flip EXPO_PUBLIC_NUTRITION_USE_MOCK=false when the Go
// endpoints are reachable.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import type {
  DishNutritionProfile,
  CartSummary,
  EditNutritionRequest,
  DeclareRecipeRequest,
  AttestAllergenRequest,
} from './types';
import {
  mockDishProfile,
  mockMenuDishes,
  mockCartSummary,
  mockApprove,
  mockApproveAll,
  mockAutoSuggestMenu,
  mockEditNutrition,
  mockDeclareRecipe,
  mockAttestAllergen,
} from './mock';

export const USE_MOCK =
  mockAllowed(process.env.EXPO_PUBLIC_NUTRITION_USE_MOCK, true);

const BASE = '/api/v1/nutrition';
const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

const enc = encodeURIComponent;

// ─── Buyer reads ──────────────────────────────────────────────────────────────
export async function getDishNutrition(dishId: string): Promise<DishNutritionProfile> {
  if (USE_MOCK) {
    await delay();
    return mockDishProfile(dishId);
  }
  return unwrap<DishNutritionProfile>(await api.get(`${BASE}/dishes/${enc(dishId)}`));
}

export async function getCartSummary(ids: string[]): Promise<CartSummary> {
  if (USE_MOCK) {
    await delay(240);
    return mockCartSummary(ids);
  }
  return unwrap<CartSummary>(
    await api.get(`${BASE}/cart/summary`, { params: { ids: ids.join(',') } }),
  );
}

// ─── Vendor menu review (auto-suggest is the engine's job; this lists output) ──
/**
 * Dishes for a menu with their (already auto-published) nutrition profiles.
 * The mock derives this from its in-memory store keyed by a menu id.
 */
export async function getMenuDishes(menuId: string): Promise<DishNutritionProfile[]> {
  if (USE_MOCK) {
    await delay(320);
    return mockMenuDishes(menuId);
  }
  // Re-running auto-suggest is idempotent and returns the current profiles.
  return unwrap<DishNutritionProfile[]>(
    await api.post(`${BASE}/menus/${enc(menuId)}/auto-suggest`, {}),
  );
}

/** Batch re-estimate a whole menu at upload (internal/system trigger). */
export async function autoSuggestMenu(menuId: string): Promise<DishNutritionProfile[]> {
  if (USE_MOCK) {
    await delay(420);
    return mockAutoSuggestMenu(menuId);
  }
  return unwrap<DishNutritionProfile[]>(
    await api.post(`${BASE}/menus/${enc(menuId)}/auto-suggest`, {}),
  );
}

/** One-tap "Approve all" — promotes every AI_ESTIMATE dish to confirmed. */
export async function approveAll(menuId: string): Promise<DishNutritionProfile[]> {
  if (USE_MOCK) {
    await delay(520);
    return mockApproveAll(menuId);
  }
  return unwrap<DishNutritionProfile[]>(
    await api.post(`${BASE}/menus/${enc(menuId)}/approve-all`, {}),
  );
}

// ─── Vendor writes (per dish) ───────────────────────────────────────────────
/** Approve the AI estimate → RESTAURANT_CONFIRMED (still labelled an estimate). */
export async function approveNutrition(dishId: string): Promise<DishNutritionProfile> {
  if (USE_MOCK) {
    await delay(440);
    return mockApprove(dishId);
  }
  return unwrap<DishNutritionProfile>(await api.post(`${BASE}/dishes/${enc(dishId)}/approve`, {}));
}

/**
 * Lightweight edit — portion selector + direct macro nudge ONLY. Never
 * ingredients. Approving the edit promotes the dish to RESTAURANT_CONFIRMED.
 */
export async function editNutrition(
  dishId: string,
  req: EditNutritionRequest,
): Promise<DishNutritionProfile> {
  if (USE_MOCK) {
    await delay(480);
    return mockEditNutrition(dishId, req);
  }
  return unwrap<DishNutritionProfile>(await api.post(`${BASE}/dishes/${enc(dishId)}/edit`, req));
}

/** Vendor attests allergens (separate, stricter step). */
export async function attestAllergen(
  dishId: string,
  req: AttestAllergenRequest,
): Promise<DishNutritionProfile> {
  if (USE_MOCK) {
    await delay(420);
    return mockAttestAllergen(dishId, req);
  }
  return unwrap<DishNutritionProfile>(
    await api.post(`${BASE}/dishes/${enc(dishId)}/allergens`, {
      allergen: req.allergen,
      declaration_type: req.declaration_type,
      cross_contamination_ack: req.cross_contamination_ack,
    }),
  );
}

// ─── Hidden power-user path (ingredients) ────────────────────────────────────
// Optional, never required, never shown during onboarding.
export async function declareRecipe(
  dishId: string,
  req: DeclareRecipeRequest,
): Promise<DishNutritionProfile> {
  if (USE_MOCK) {
    await delay(520);
    return mockDeclareRecipe(dishId, req);
  }
  return unwrap<DishNutritionProfile>(await api.post(`${BASE}/dishes/${enc(dishId)}/recipe`, req));
}
