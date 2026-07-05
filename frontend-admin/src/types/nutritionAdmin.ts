// Nutrition admin console types.
// The Go nutrition module exposes a public food catalog (composition reference +
// Nigerian Dish Library) and admin write endpoints for curating it and
// re-resolving AI/library dish profiles. The admin "Implausible Values" queue is
// the set of resolved dish profiles that fail sanity bounds (e.g. kcal/100g out
// of physical range) and need a human to re-resolve or accept.

// Source of a composition reference row.
//  WAFCT  — West African Food Composition Table (preferred regional source)
//  NFCT   — Nigerian Food Composition Table
//  OFF    — Open Food Facts (crowd-sourced; lower trust)
//  FALLBACK — generic macro estimate when no source matched
//  CUSTOM — manually curated by an operator
export type NutritionSource = 'WAFCT' | 'NFCT' | 'OFF' | 'FALLBACK' | 'CUSTOM';

export type PrepMethod =
  | 'raw'
  | 'boiled'
  | 'fried'
  | 'grilled'
  | 'roasted'
  | 'steamed'
  | 'stewed'
  | 'baked';

// Confidence in a resolved dish profile (v2).
//  EXACT  — label-derived (packaged/barcoded)
//  MEDIUM — library-matched estimate
//  LOW    — free-estimated, no library match
export type Confidence = 'EXACT' | 'MEDIUM' | 'LOW';

// Which knowledge source the AI grounded the estimate in (v2). The grounding
// library (WAFCT/NFCT) lives behind the AI rather than being a vendor-facing tier.
//  LABEL          — packaged-goods barcode/label fast-path
//  LIBRARY_MATCHED — matched the Nigerian grounding library
//  FREE_ESTIMATED  — no library match; estimated from name/description/photo
//  RECIPE          — optional power-user ingredient declaration
export type Grounding = 'LABEL' | 'LIBRARY_MATCHED' | 'FREE_ESTIMATED' | 'RECIPE';

// Honesty state of a resolved dish profile (v2 three-state machine + STALE).
//  AI_ESTIMATE         — auto-published estimate; needs no vendor action
//  RESTAURANT_CONFIRMED — vendor approved, but STILL an estimate (approval ≠ exact)
//  EXACT               — label-only (packaged/barcoded items)
//  STALE               — name/photo/portion/version change invalidated; re-estimate
export type ProfileStatus = 'AI_ESTIMATE' | 'RESTAURANT_CONFIRMED' | 'EXACT' | 'STALE';

// Operator review-queue lifecycle (distinct from the honesty machine above).
//  FLAGGED  — failed sanity bounds, awaiting review
//  REVIEWED — operator inspected and accepted the value as-is
//  RESOLVED — re-resolved against a (newer) composition version
export type ReviewState = 'FLAGGED' | 'REVIEWED' | 'RESOLVED';

// A single composition reference row. Versioned: editing posts a new version,
// older versions are retained (additive — never overwritten).
export interface CompositionReference {
  food_code: string;
  name: string;
  source: NutritionSource;
  prep_method: PrepMethod;
  // Per-100g nutrient figures.
  energy_kcal: number;
  protein_g: number;
  carb_g: number;
  sugar_g: number;
  fat_g: number;
  sat_fat_g: number;
  fiber_g: number;
  sodium_mg: number;
  version: number;
  updatedAt?: string;
}

// A component of a dish library entry (links to a composition food_code + grams).
export interface DishComponent {
  food_code: string;
  name: string;
  grams: number;
}

// Per-serving resolved nutrient figures for a library dish.
export interface PerServing {
  energy_kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
}

// A curated Nigerian Dish Library entry. Versioned like composition rows.
export interface DishLibraryEntry {
  slug: string;
  name: string;
  aliases: string[];
  standard_portion_g: number;
  components: DishComponent[];
  per_serving: PerServing;
  version: number;
  updatedAt?: string;
}

// A resolved dish profile flagged by sanity bounds. This is the implausible
// review-queue row + detail shape.
export interface ImplausibleProfile {
  id: string;
  dish_id: string;
  name: string;
  grounding: Grounding;
  confidence: Confidence;
  // Honesty state of the profile (v2).
  status: ProfileStatus;
  // Operator review-queue lifecycle for this flagged profile.
  review_state: ReviewState;
  // The resolved per-serving values that tripped the bound.
  per_serving: PerServing;
  standard_portion_g: number;
  // Human-readable reason the sanity check failed.
  reason: string;
  // Which composition version the profile was last resolved against.
  composition_version: number;
  flaggedAt: string;
  reviewedAt?: string | null;
}

// Re-resolve scopes for the batch action.
export type ReresolveScope = 'all' | 'library' | 'ai';

// Filters for the composition list view.
export interface CompositionFilters {
  source?: string;
  q?: string;
}
