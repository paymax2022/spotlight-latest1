// ── Nutrition Resolution Engine — Data hooks (v2) ────────────────────────────
// React Query hooks mirroring food/hooks.ts so screens stay declarative and
// share caching / loading / error contracts. v2 surfaces approve / approve-all
// / lightweight edit (portion + macro) / allergen attestation, plus the hidden
// recipe path.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as nutrition from './api';
import type { EditNutritionRequest, DeclareRecipeRequest, AttestAllergenRequest } from './types';

const KEY = 'nutrition';

// ─── Buyer ────────────────────────────────────────────────────────────────────
export function useDishNutrition(dishId?: string) {
  return useQuery({
    queryKey: [KEY, 'dish', dishId],
    queryFn: () => nutrition.getDishNutrition(dishId as string),
    enabled: Boolean(dishId),
    staleTime: 60_000,
  });
}

export function useCartNutrition(ids: string[]) {
  const key = [...ids].sort().join(',');
  return useQuery({
    queryKey: [KEY, 'cart', key],
    queryFn: () => nutrition.getCartSummary(ids),
    enabled: ids.length > 0,
    staleTime: 15_000,
  });
}

// ─── Vendor menu review ─────────────────────────────────────────────────────
export function useMenuNutrition(menuId?: string) {
  return useQuery({
    queryKey: [KEY, 'menu', menuId],
    queryFn: () => nutrition.getMenuDishes(menuId as string),
    enabled: Boolean(menuId),
    staleTime: 30_000,
  });
}

export function useAutoSuggestMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (menuId: string) => nutrition.autoSuggestMenu(menuId),
    onSuccess: (_d, menuId) => {
      qc.invalidateQueries({ queryKey: [KEY, 'menu', menuId] });
    },
  });
}

export function useApproveAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (menuId: string) => nutrition.approveAll(menuId),
    onSuccess: (_d, menuId) => {
      qc.invalidateQueries({ queryKey: [KEY, 'menu', menuId] });
      qc.invalidateQueries({ queryKey: [KEY, 'dish'] });
      qc.invalidateQueries({ queryKey: [KEY, 'cart'] });
    },
  });
}

// ─── Vendor mutations (per dish) ────────────────────────────────────────────
export function useApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dishId: string) => nutrition.approveNutrition(dishId),
    onSuccess: (_d, dishId) => {
      qc.invalidateQueries({ queryKey: [KEY, 'dish', dishId] });
      qc.invalidateQueries({ queryKey: [KEY, 'menu'] });
      qc.invalidateQueries({ queryKey: [KEY, 'cart'] });
    },
  });
}

export function useEditNutrition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dishId, req }: { dishId: string; req: EditNutritionRequest }) =>
      nutrition.editNutrition(dishId, req),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: [KEY, 'dish', vars.dishId] });
      qc.invalidateQueries({ queryKey: [KEY, 'menu'] });
      qc.invalidateQueries({ queryKey: [KEY, 'cart'] });
    },
  });
}

export function useAttestAllergen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dishId, req }: { dishId: string; req: AttestAllergenRequest }) =>
      nutrition.attestAllergen(dishId, req),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: [KEY, 'dish', vars.dishId] });
      qc.invalidateQueries({ queryKey: [KEY, 'menu'] });
      qc.invalidateQueries({ queryKey: [KEY, 'cart'] });
    },
  });
}

// ─── Hidden power-user path ─────────────────────────────────────────────────
export function useDeclareRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dishId, req }: { dishId: string; req: DeclareRecipeRequest }) =>
      nutrition.declareRecipe(dishId, req),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: [KEY, 'dish', vars.dishId] });
      qc.invalidateQueries({ queryKey: [KEY, 'menu'] });
      qc.invalidateQueries({ queryKey: [KEY, 'cart'] });
    },
  });
}
