// ── Nutrition Resolution Engine — Domain types (v2, onboarding-first) ─────────
// Buyers see HONEST estimated nutrition + allergen info on dishes; the engine
// AUTO-PUBLISHES an AI estimate for every dish at menu upload, and vendors
// later OPTIONALLY approve or lightly edit. The cardinal rules:
//   • a nutrition number is NEVER shown without its grounding + confidence;
//   • approval ≠ measurement — RESTAURANT_CONFIRMED stays labelled an estimate,
//     "exact" is reserved for real labels only;
//   • allergen info is ALWAYS rendered visually separate from macros.
//
// Mirrors the food feature's snake_case DTO shape (the Go backend speaks
// snake_case; the api layer maps to these types verbatim — they already match).

// ─── Resolution grounding (how the AI sourced the estimate) ──────────────────
/** Where the numbers were grounded. The library sits BEHIND the AI in v2. */
export type NutritionGrounding = 'LABEL' | 'LIBRARY_MATCHED' | 'FREE_ESTIMATED' | 'RECIPE';

/** How tightly the value is known. EXACT → point value; MEDIUM/LOW → range. */
export type NutritionConfidence = 'EXACT' | 'MEDIUM' | 'LOW';

/** Lifecycle of the profile through the auto-publish → approve flow. */
export type NutritionStatus =
  | 'AI_ESTIMATE'          // auto-published at upload, labelled "AI estimate"
  | 'RESTAURANT_CONFIRMED' // vendor approved — higher trust, STILL an estimate
  | 'EXACT'                // packaged/barcoded label only
  | 'STALE';               // name/photo/portion/version change → re-estimate

/** Vendor-set serving size, rescales all values. */
export type PortionLabel = 'small' | 'regular' | 'large';

/** Overall calorie-density band shown as a chip. */
export type NutritionBand = 'Light' | 'Balanced' | 'Heavy';

/** Per-nutrient traffic light (UK FOP-style green/amber/red). */
export type TrafficLight = 'green' | 'amber' | 'red';

// ─── Nutrient value (honest precision) ───────────────────────────────────────
// `value` is the best point estimate. `low`/`high` bound the estimate when
// confidence is MEDIUM/LOW; for EXACT they may equal `value`.
export interface NutrientValue {
  value: number;
  low?: number;
  high?: number;
}

export interface PerServing {
  energy_kcal: NutrientValue;
  protein_g: NutrientValue;
  carb_g: NutrientValue;
  sugar_g: NutrientValue;
  fat_g: NutrientValue;
  sat_fat_g: NutrientValue;
  fiber_g: NutrientValue;
  sodium_mg: NutrientValue;
}

export interface TrafficLights {
  sodium_mg: TrafficLight;
  sugar_g: TrafficLight;
  sat_fat_g: TrafficLight;
}

export interface NutritionDisplay {
  band: NutritionBand;
  traffic_lights: TrafficLights;
}

export interface DishNutritionProfile {
  dish_id: string;
  grounding: NutritionGrounding;
  confidence: NutritionConfidence;
  status: NutritionStatus;
  portion_label: PortionLabel;
  portion_size_g: number;
  per_serving: PerServing;
  composition_version: number;
  display: NutritionDisplay;
  badges: string[]; // e.g. ['Nutrition-Verified']
  disclaimer: string;
  /** Allergen declarations attached to this dish (may be empty/unconfirmed). */
  allergens?: AllergenDeclaration[];
}

// ─── Allergens ──────────────────────────────────────────────────────────────
export type AllergenDeclarationType = 'CONTAINS' | 'MAY_CONTAIN' | 'FREE_FROM';
export type AllergenSource = 'VENDOR' | 'AI';

export interface AllergenDeclaration {
  dish_id: string;
  allergen: string;
  declaration_type: AllergenDeclarationType;
  source: AllergenSource;
  attested_by?: string | null;
  cross_contamination_ack: boolean;
}

// ─── Cart aggregate ─────────────────────────────────────────────────────────
export interface CartSummary {
  /** Aggregate energy across the cart — a range when any line is estimated. */
  energy_kcal: NutrientValue;
  /** Worst-case (most severe) traffic light across all dishes. */
  traffic_lights: TrafficLights;
  /** Distinct allergens that any dish in the cart CONTAINS / MAY_CONTAIN. */
  allergens: { allergen: string; declaration_type: AllergenDeclarationType; source: AllergenSource }[];
  /** True if any line is not EXACT (numbers are estimates). */
  estimated: boolean;
  disclaimer: string;
}

// ─── Vendor request payloads ────────────────────────────────────────────────
// Edit is intentionally lightweight: portion + direct macro nudge ONLY. It
// NEVER asks for ingredients. The optional ingredient path is the hidden
// power-user recipe declaration below.
export interface MacroNudge {
  energy_kcal?: number;
  protein_g?: number;
  carb_g?: number;
  sugar_g?: number;
  fat_g?: number;
  sat_fat_g?: number;
  fiber_g?: number;
  sodium_mg?: number;
}

export interface EditNutritionRequest {
  portion_label?: PortionLabel;
  macros?: MacroNudge;
}

// ─── Optional hidden power-user path (ingredients) ───────────────────────────
// NEVER required, NEVER surfaced during onboarding.
export interface RecipeIngredient {
  food_code: string;
  grounding: NutritionGrounding;
  quantity_g: number;
  prep_method: string;
}

export interface DeclareRecipeRequest {
  ingredients: RecipeIngredient[];
  portion_size_g: number;
  cook_method: string;
}

export interface AttestAllergenRequest {
  allergen: string;
  declaration_type: AllergenDeclarationType;
  cross_contamination_ack: boolean;
}

// ─── Controlled allergen vocabulary ─────────────────────────────────────────
// The 14 major declarable allergens (EU FIC). Used by the attestation checklist.
export const ALLERGEN_VOCAB: readonly string[] = [
  'Milk',
  'Eggs',
  'Peanuts',
  'Tree nuts',
  'Soy',
  'Wheat (gluten)',
  'Fish',
  'Crustaceans',
  'Molluscs',
  'Sesame',
  'Mustard',
  'Celery',
  'Lupin',
  'Sulphites',
] as const;
