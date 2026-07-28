# ADR-009 — Nutrition Resolution Engine: estimate honestly, never publish an anonymous number

**Date:** 2026-06-29
**Status:** Accepted (revised — v2 onboarding-first)
**Deciders:** Platform / Backend, with Mobile + AI + Nutrition Ops + QA

> ## v2 revision — onboarding-first (authoritative; supersedes the v1 details below where they conflict)
>
> The PRD (`docs/prd/restaurant/Paymax-Nutrition-Resolution-Engine.md`) moved to an
> **onboarding-first** model. The vendor is never asked to identify ingredients and
> nutrition never blocks publishing. The concrete changes:
>
> 1. **Auto-estimate + auto-publish at menu upload.** When a menu is uploaded the
>    engine estimates the *whole menu* and publishes each dish immediately as
>    `AI_ESTIMATE` — zero vendor action. New endpoint:
>    `POST /api/finance/nutrition/menus/{menuId}/auto-suggest`.
> 2. **Three honesty states** (was 5): `AI_ESTIMATE` (auto-published range) →
>    `RESTAURANT_CONFIRMED` (vendor-approved, **still labelled an estimate** — approval
>    ≠ exact) ; `EXACT` is **label-only**; plus `STALE` on name/photo/portion/version
>    change → re-estimate.
> 3. **Grounding (not tiers).** A profile records `grounding ∈ {LABEL, LIBRARY_MATCHED,
>    FREE_ESTIMATED, RECIPE}` with `confidence ∈ {EXACT, MEDIUM, LOW}`. The Nigerian
>    library is now grounding *inside* the AI, not a vendor-facing tier; the vendor
>    experiences a single "AI suggestion."
> 4. **Edit = portion + macro nudge only — never ingredients.** `POST …/edit` takes a
>    portion selector (small/regular/large, rescales) and/or direct macro nudges.
>    Ingredient entry (`…/recipe`) is an **optional hidden power-user path**, never
>    required and never shown at onboarding. `confirm` is renamed **`approve`**, with
>    a batch **Approve-all** for a whole menu.
> 5. **Display labels:** `AI_ESTIMATE` → range + "AI estimate"; `RESTAURANT_CONFIRMED`
>    → point + "restaurant-confirmed (estimate)"; `EXACT` → point + "from label".
> 6. **Learn-from-edits loop:** vendor edits to a library-matched dish are recorded in
>    `nutrition_library_feedback` so Ops can refine the standard library profile.
>
> Unchanged from v1: allergens are separate + stricter (AI never sets
> CONTAINS/FREE_FROM, FREE_FROM needs the cross-contamination ack, default
> "may contain"), never-an-anonymous-number, versioned grounding with profiles
> pinning the version, object-level authz, immutable audit, cart range propagation,
> feature flag `FEATURE_NUTRITION_ENABLED` (default off).

## Context

Buyers order restaurant food that has no nutrition label. We want healthy-zone
filters, diabetic-friendly / heart-healthy badges, a weekly wellness report, and
a lab→food loop — all of which need nutrition + allergen data per dish. Restaurant
food can't be looked up; it must be **estimated**. The risk is misleading people
with confident-looking but wrong numbers, and — far worse — getting an allergen
wrong.

Generic engines wired to USDA/Western APIs return nonsense for egusi, ofada, or
jollof, so the engine must be **Nigeria-first**, seeded from Nigeria-relevant food
composition tables.

## Decisions

### 1. The single principle: never publish an anonymous number
Every value the buyer sees carries `{source, confidence, tier, composition_version}`
and the display adapts: `EXACT/HIGH` → point value + source badge; `LOW/MEDIUM` →
a range + "estimated" + source badge. This is enforced from the schema up (the
profile row cannot exist without source + confidence) and in the display-transform
layer (no code path renders a bare number).

### 2. A tiered resolution cascade, best-available wins
`resolve()` walks tiers top-down and stops at the first that succeeds; a higher
tier always supersedes a lower one (a later vendor confirmation overrides an
earlier AI guess):

| Tier | Trigger | Method | Source / Confidence |
|---|---|---|---|
| 0 | barcode | Open Food Facts / NAFDAC label | LABEL / EXACT |
| 1 | recipe declared | Σ CompositionReference × qty, cook yield/retention, scale to portion | RECIPE / HIGH |
| 2 | name match | fuzzy-match the curated Nigerian Dish Library, scale to portion | LIBRARY / MEDIUM |
| 3 | fallback | AI estimate from name+description+photo → value + low/high range | AI / LOW |

Re-resolution triggers (menu/price edit, recipe add/change, vendor confirm,
reference-version bump) mark the profile `STALE` and re-resolve before next display.

### 3. Profile = a separate, guarded state machine bound to the menu item
`dish_nutrition_profile` is a separate row keyed by `menu_item_id` — `menu_items`
is never widened. States: `DRAFT → AI_SUGGESTED → {VENDOR_CONFIRMED | (recipe) →
VENDOR_CONFIRMED}`, `LABEL_EXACT` (Tier 0), and `STALE` on any change. Transitions
are guarded (optimistic `version` lock, no raw status writes) and audited.
`VENDOR_CONFIRMED`/`LABEL_EXACT` may show point values; `AI_SUGGESTED` shows ranges.

### 4. The vendor-confirm friction unlock
No vendor hand-keys macros for 80 dishes. The engine pre-fills (Tier 2→3) an
`AI_SUGGESTED` card; the vendor **one-tap Confirms** (→ `VENDOR_CONFIRMED`,
confidence upgraded, "Nutrition-Verified" badge + healthy-zone ranking lift),
**Edits** (may promote to a Tier-1 recipe), or **Skips** (stays honestly
"estimated"). Data quality becomes a marketing perk, not a chore.

### 5. Allergens are separate and stricter — enforced in the schema
Allergens get their own model (`allergen_declaration`) and their own rules, with
the non-negotiables enforced as **DB CHECK constraints** so they're unreachable by
any code path:
- AI may *suggest* (low-trust) but **may never set `CONTAINS` or `FREE_FROM`**
  (`CHECK NOT (source='AI' AND declaration_type IN ('CONTAINS','FREE_FROM'))`).
- `CONTAINS`/`FREE_FROM` are vendor-**attested** only (require `attested_by`).
- `FREE_FROM` requires explicit cross-contamination acknowledgement
  (`CHECK declaration_type<>'FREE_FROM' OR cross_contamination_ack`).
- Default when unattested: "Allergen info not confirmed — may contain allergens."
Allergen confirmation is a **separate required step**; it never rides along with
the macro confirmation. The buyer-facing allergen notice is visually separate from
the macro card.

### 6. Nigeria-first, versioned reference data
`composition_reference` is seeded from WAFCT 2019 (FAO/INFOODS West African table,
~1,028 items, prepared forms) + NFCT 2017 (282 Nigerian foods), tagged by source +
prep method. A curated `nutrition_dish_library` covers the top composite dishes.
Open Food Facts powers barcode Tier 0; Edamam/Nutritionix are **last-resort only**
for the Western long tail, never for local dishes. **Everything is versioned**;
every profile pins the `composition_version` it was resolved against, so updates
are traceable and re-resolvable (vendor-confirmed profiles are left intact on a
version bump until the vendor re-confirms).

> Implementation note: this repo ships a **representative seed sample** plus an
> ingestion scaffold (`scripts/nutrition/`). The full WAFCT/NFCT import is a data
> task to run with the official CSVs; seeds are `version=1` and superseded on import.

### 7. Reuse, don't rebuild
SSO (vendor/buyer roles), the marketplace `menu_items`/`restaurants` (bind, never
duplicate; authz via `restaurants.owner_id`), the shared LLM client
(`internal/integrations/llm`, `ANTHROPIC_API_KEY`, deterministic mock when
disabled), notifications (confirm nudges), immutable audit (`nutrition_audit_log`),
and the mobile design system. The health/labs module is a downstream consumer only.

### 8. Honest display + aggregation
Plain-language "Light / Balanced / Heavy" plus a traffic-light on the metrics that
matter for Nigeria's disease burden — sodium, sugar, saturated fat. Cart/order
aggregation rolls up component profiles with range propagation. The whole feature
is labelled "estimated nutrition for education — not medical or dietary advice."
Offline-first: profile cached with the dish; degrades cleanly.

## Consequences
- Credible for the dishes people actually order; honest about uncertainty.
- Allergen safety is structural, not a code convention that can regress.
- Vendor data quality is incentivised, not mandated.
- Feature-flagged (`FEATURE_NUTRITION_ENABLED`, default off — no flag, no merge).

## Open knobs (§14 — defaults shipped, change without re-architecting)
Surfaced nutrient set (energy, protein, carb, sugar, fat, sat-fat, fiber, sodium);
traffic-light thresholds; curated library size (top-N); badge as hard vs soft
ranking boost; fallback-API choice (Edamam vs Nutritionix).
