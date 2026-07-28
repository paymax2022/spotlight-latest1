// ── Nutrition Resolution Engine — Mock data (v2) ─────────────────────────────
// Runs the whole buyer + vendor flow offline (EXPO_PUBLIC_NUTRITION_USE_MOCK
// !== 'false'). A tiny in-memory store lets vendor approve/edit/approve-all/
// allergen writes persist within a session so the buyer surfaces reflect them.
//
// v2 honesty states (onboarding-first):
//   • i1  — AI_ESTIMATE (range "≈610–710 kcal · AI estimate"), auto-published
//   • i5  — RESTAURANT_CONFIRMED (point value + "restaurant-confirmed (estimate)")
//   • i4  — EXACT (packaged label, point value + "from label")
//   • plus attested + AI-suggested allergens across them.
// Every dish belongs to a mock menu so the "review your menu" screen can list it.

import type {
  DishNutritionProfile,
  AllergenDeclaration,
  CartSummary,
  EditNutritionRequest,
  DeclareRecipeRequest,
  AttestAllergenRequest,
  NutrientValue,
  PortionLabel,
} from './types';
import { worstTrafficLights } from './utils';

const DISCLAIMER =
  'Estimated nutrition for education — not medical or dietary advice.';

const v = (value: number, low?: number, high?: number): NutrientValue => ({ value, low, high });

// Every seeded dish maps to a menu so the vendor review screen can group them.
const MENU = 'm1';
const dishMenu: Record<string, string> = { i1: MENU, i4: MENU, i5: MENU };

// ─── In-memory store (vendor writes persist within the session) ──────────────
const store: Record<string, DishNutritionProfile> = {};

function seed(p: DishNutritionProfile) {
  store[p.dish_id] = p;
}

// i1 — Egusi Soup + Pounded Yam: free AI estimate → AI_ESTIMATE, a RANGE.
seed({
  dish_id: 'i1',
  grounding: 'FREE_ESTIMATED',
  confidence: 'LOW',
  status: 'AI_ESTIMATE',
  portion_label: 'regular',
  portion_size_g: 500,
  per_serving: {
    energy_kcal: v(660, 610, 710),
    protein_g: v(34, 30, 38),
    carb_g: v(58, 52, 64),
    sugar_g: v(7, 5, 9),
    fat_g: v(30, 26, 34),
    sat_fat_g: v(11, 9, 13),
    fiber_g: v(6, 5, 7),
    sodium_mg: v(1180, 1050, 1310),
  },
  composition_version: 1,
  display: { band: 'Heavy', traffic_lights: { sodium_mg: 'red', sugar_g: 'green', sat_fat_g: 'amber' } },
  badges: [],
  disclaimer: DISCLAIMER,
  // AI-suggested allergens only — shown as low-trust "possible", never a claim.
  allergens: [
    { dish_id: 'i1', allergen: 'Tree nuts', declaration_type: 'MAY_CONTAIN', source: 'AI', attested_by: null, cross_contamination_ack: false },
    { dish_id: 'i1', allergen: 'Fish', declaration_type: 'MAY_CONTAIN', source: 'AI', attested_by: null, cross_contamination_ack: false },
  ],
});

// i5 — Fried Rice + Beef: vendor approved → RESTAURANT_CONFIRMED (point + estimate).
seed({
  dish_id: 'i5',
  grounding: 'LIBRARY_MATCHED',
  confidence: 'MEDIUM',
  status: 'RESTAURANT_CONFIRMED',
  portion_label: 'regular',
  portion_size_g: 450,
  per_serving: {
    energy_kcal: v(610),
    protein_g: v(26),
    carb_g: v(70),
    sugar_g: v(9),
    fat_g: v(22),
    sat_fat_g: v(8),
    fiber_g: v(5),
    sodium_mg: v(940),
  },
  composition_version: 2,
  display: { band: 'Balanced', traffic_lights: { sodium_mg: 'amber', sugar_g: 'amber', sat_fat_g: 'amber' } },
  badges: ['Nutrition-Verified'],
  disclaimer: DISCLAIMER,
  allergens: [
    { dish_id: 'i5', allergen: 'Eggs', declaration_type: 'CONTAINS', source: 'VENDOR', attested_by: 'Mama Cass', cross_contamination_ack: false },
    { dish_id: 'i5', allergen: 'Soy', declaration_type: 'CONTAINS', source: 'VENDOR', attested_by: 'Mama Cass', cross_contamination_ack: false },
    { dish_id: 'i5', allergen: 'Wheat (gluten)', declaration_type: 'CONTAINS', source: 'VENDOR', attested_by: 'Mama Cass', cross_contamination_ack: false },
    { dish_id: 'i5', allergen: 'Milk', declaration_type: 'FREE_FROM', source: 'VENDOR', attested_by: 'Mama Cass', cross_contamination_ack: true },
  ],
});

// i4 — Bottled Malt Drink: packaged barcode → EXACT (real label, "from label").
seed({
  dish_id: 'i4',
  grounding: 'LABEL',
  confidence: 'EXACT',
  status: 'EXACT',
  portion_label: 'regular',
  portion_size_g: 330,
  per_serving: {
    energy_kcal: v(210),
    protein_g: v(2),
    carb_g: v(48),
    sugar_g: v(46),
    fat_g: v(0),
    sat_fat_g: v(0),
    fiber_g: v(0),
    sodium_mg: v(60),
  },
  composition_version: 3,
  display: { band: 'Light', traffic_lights: { sodium_mg: 'green', sugar_g: 'red', sat_fat_g: 'green' } },
  badges: [],
  disclaimer: DISCLAIMER,
  allergens: [
    { dish_id: 'i4', allergen: 'Wheat (gluten)', declaration_type: 'CONTAINS', source: 'VENDOR', attested_by: 'Mama Cass', cross_contamination_ack: false },
  ],
});

// ─── Portion rescale factors (relative to "regular") ─────────────────────────
const PORTION_FACTOR: Record<PortionLabel, number> = { small: 0.7, regular: 1, large: 1.35 };

function scaleValue(val: NutrientValue, factor: number): NutrientValue {
  return {
    value: Math.round(val.value * factor),
    low: val.low != null ? Math.round(val.low * factor) : undefined,
    high: val.high != null ? Math.round(val.high * factor) : undefined,
  };
}

/** A FREE_ESTIMATED profile for dishes with no resolved data — honest LOW range. */
function fallbackProfile(dishId: string): DishNutritionProfile {
  return {
    dish_id: dishId,
    grounding: 'FREE_ESTIMATED',
    confidence: 'LOW',
    status: 'AI_ESTIMATE',
    portion_label: 'regular',
    portion_size_g: 400,
    per_serving: {
      energy_kcal: v(520, 420, 640),
      protein_g: v(20, 14, 26),
      carb_g: v(55, 45, 66),
      sugar_g: v(8, 5, 12),
      fat_g: v(20, 14, 27),
      sat_fat_g: v(7, 4, 10),
      fiber_g: v(4, 2, 6),
      sodium_mg: v(900, 700, 1150),
    },
    composition_version: 0,
    display: { band: 'Balanced', traffic_lights: { sodium_mg: 'amber', sugar_g: 'green', sat_fat_g: 'amber' } },
    badges: [],
    disclaimer: DISCLAIMER,
    allergens: [],
  };
}

export function mockDishProfile(dishId: string): DishNutritionProfile {
  return store[dishId] ?? fallbackProfile(dishId);
}

/** Every dish belonging to a menu (for the vendor "review your nutrition" list). */
export function mockMenuDishes(menuId: string): DishNutritionProfile[] {
  return Object.keys(dishMenu)
    .filter((id) => dishMenu[id] === menuId)
    .map(mockDishProfile);
}

export function mockCartSummary(ids: string[]): CartSummary {
  const profiles = ids.map(mockDishProfile);
  let low = 0;
  let high = 0;
  let estimated = false;
  for (const p of profiles) {
    const e = p.per_serving.energy_kcal;
    low += e.low ?? e.value;
    high += e.high ?? e.value;
    // Anything that isn't a real label is an estimate (incl. RESTAURANT_CONFIRMED).
    if (p.status !== 'EXACT') estimated = true;
  }
  // De-dupe allergens that any dish CONTAINS / MAY_CONTAIN (FREE_FROM omitted).
  const seen = new Map<string, CartSummary['allergens'][number]>();
  for (const p of profiles) {
    for (const a of p.allergens ?? []) {
      if (a.declaration_type === 'FREE_FROM') continue;
      const prev = seen.get(a.allergen);
      // Prefer a vendor CONTAINS over an AI MAY_CONTAIN for the same allergen.
      if (!prev || (a.source === 'VENDOR' && prev.source === 'AI')) {
        seen.set(a.allergen, { allergen: a.allergen, declaration_type: a.declaration_type, source: a.source });
      }
    }
  }
  return {
    energy_kcal: v(Math.round((low + high) / 2), Math.round(low), Math.round(high)),
    traffic_lights: worstTrafficLights(profiles.map((p) => p.display.traffic_lights)),
    allergens: [...seen.values()],
    estimated,
    disclaimer: DISCLAIMER,
  };
}

// ─── Vendor mutations (persist to the in-memory store) ───────────────────────

/** Promote a profile to RESTAURANT_CONFIRMED + Nutrition-Verified badge. */
function confirm(base: DishNutritionProfile): DishNutritionProfile {
  // EXACT (a real label) is never downgraded to a confirmed estimate.
  if (base.status === 'EXACT') return base;
  const badges = base.badges.includes('Nutrition-Verified')
    ? base.badges
    : [...base.badges, 'Nutrition-Verified'];
  return {
    ...base,
    status: 'RESTAURANT_CONFIRMED',
    // Approving lifts a free guess to a vendor-stood-behind estimate.
    confidence: base.confidence === 'LOW' ? 'MEDIUM' : base.confidence,
    badges,
  };
}

/** Vendor approves the AI estimate → RESTAURANT_CONFIRMED (still an estimate). */
export function mockApprove(dishId: string): DishNutritionProfile {
  const updated = confirm(mockDishProfile(dishId));
  store[dishId] = updated;
  return { ...updated };
}

/** One-tap Approve-all — approves every AI_ESTIMATE dish in the menu. */
export function mockApproveAll(menuId: string): DishNutritionProfile[] {
  for (const id of Object.keys(dishMenu)) {
    if (dishMenu[id] !== menuId) continue;
    const base = mockDishProfile(id);
    if (base.status === 'AI_ESTIMATE') store[id] = confirm(base);
  }
  return mockMenuDishes(menuId);
}

/** Auto-suggest at upload — idempotent; returns the menu's current profiles. */
export function mockAutoSuggestMenu(menuId: string): DishNutritionProfile[] {
  return mockMenuDishes(menuId);
}

/**
 * Lightweight edit — portion selector + direct macro nudge ONLY (no ingredients).
 * Rescales by portion, applies any macro overrides, then confirms (approval).
 */
export function mockEditNutrition(dishId: string, req: EditNutritionRequest): DishNutritionProfile {
  const base = mockDishProfile(dishId);
  let per = base.per_serving;
  let portionLabel = base.portion_label;
  let portionSize = base.portion_size_g;

  if (req.portion_label && req.portion_label !== base.portion_label) {
    const factor = PORTION_FACTOR[req.portion_label] / PORTION_FACTOR[base.portion_label];
    per = {
      energy_kcal: scaleValue(per.energy_kcal, factor),
      protein_g: scaleValue(per.protein_g, factor),
      carb_g: scaleValue(per.carb_g, factor),
      sugar_g: scaleValue(per.sugar_g, factor),
      fat_g: scaleValue(per.fat_g, factor),
      sat_fat_g: scaleValue(per.sat_fat_g, factor),
      fiber_g: scaleValue(per.fiber_g, factor),
      sodium_mg: scaleValue(per.sodium_mg, factor),
    };
    portionLabel = req.portion_label;
    portionSize = Math.round(base.portion_size_g * (PORTION_FACTOR[req.portion_label] / PORTION_FACTOR[base.portion_label]));
  }

  if (req.macros) {
    const m = req.macros;
    const set = (cur: NutrientValue, val?: number): NutrientValue =>
      val != null && Number.isFinite(val) ? { value: Math.round(val) } : cur;
    per = {
      energy_kcal: set(per.energy_kcal, m.energy_kcal),
      protein_g: set(per.protein_g, m.protein_g),
      carb_g: set(per.carb_g, m.carb_g),
      sugar_g: set(per.sugar_g, m.sugar_g),
      fat_g: set(per.fat_g, m.fat_g),
      sat_fat_g: set(per.sat_fat_g, m.sat_fat_g),
      fiber_g: set(per.fiber_g, m.fiber_g),
      sodium_mg: set(per.sodium_mg, m.sodium_mg),
    };
  }

  const edited: DishNutritionProfile = {
    ...base,
    per_serving: per,
    portion_label: portionLabel,
    portion_size_g: portionSize,
    composition_version: base.composition_version + 1,
  };
  // A vendor edit is an explicit stand-behind → confirm it.
  const updated = confirm(edited);
  store[dishId] = updated;
  return { ...updated };
}

/** Vendor attests an allergen (replaces any prior declaration of the same one). */
export function mockAttestAllergen(dishId: string, req: AttestAllergenRequest): DishNutritionProfile {
  const base = mockDishProfile(dishId);
  const decl: AllergenDeclaration = {
    dish_id: dishId,
    allergen: req.allergen,
    declaration_type: req.declaration_type,
    source: 'VENDOR',
    attested_by: 'You',
    cross_contamination_ack: req.cross_contamination_ack,
  };
  const rest = (base.allergens ?? []).filter((a) => a.allergen !== req.allergen);
  const updated: DishNutritionProfile = { ...base, allergens: [...rest, decl] };
  store[dishId] = updated;
  return { ...updated };
}

/** Hidden power-user path: declare a recipe → highest-accuracy confirmed profile. */
export function mockDeclareRecipe(dishId: string, req: DeclareRecipeRequest): DishNutritionProfile {
  const base = mockDishProfile(dishId);
  const recipeProfile: DishNutritionProfile = {
    ...base,
    grounding: 'RECIPE',
    confidence: 'MEDIUM',
    portion_size_g: req.portion_size_g || base.portion_size_g,
    composition_version: base.composition_version + 1,
  };
  // Declaring a recipe is the strongest vendor signal → confirmed estimate.
  const updated = confirm(recipeProfile);
  store[dishId] = updated;
  return { ...updated };
}
