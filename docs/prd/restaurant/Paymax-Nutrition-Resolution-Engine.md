# Paymax / Spotlight — Nutrition Resolution Engine (NRE)

**Module:** Nutrition Resolution Engine — estimated nutrition + allergen data for every orderable dish
**Surface:** Spotlight multi-restaurant marketplace (vendor menu builder + buyer dish/cart/order views)
**Powers:** Healthy-zone filters, diabetic-friendly / heart-healthy badges, weekly wellness report, lab→food loop
**Status:** Build-ready — locked architecture; commercial/curation knobs flagged in §14

> **Revision note (v2 — onboarding-first).** The vendor is no longer asked to identify ingredients; that requirement is removed because it's an onboarding hindrance. The engine now **auto-suggests nutrition for the whole menu at upload and publishes it immediately as an estimate**; the vendor only **approves or lightly edits**, asynchronously, at their leisure. The WAFCT/NFCT food tables move *behind* the AI as its grounding knowledge base rather than being a vendor-facing step. Changes concentrate in §1, §4–§7, §11–§12, §15.

---

## 1. What this is

Attach **nutrition and allergen information to any food a buyer can order** — not just packaged goods. Because restaurant food has no label, this is a **nutrition *estimation* engine**, not a fact-lookup.

Two principles govern the design:

1. **Never block onboarding.** A restaurant must be able to publish its full menu *with nutrition already on it* without doing any nutrition work. The AI estimates the entire menu from the dish names and photos the vendor is uploading anyway; the vendor's only job, later and optionally, is to confirm or tweak.
2. **Never publish an anonymous number.** Every value carries its source and confidence, and the display adapts — an unreviewed AI estimate looks different from a restaurant-confirmed value, which looks different from an exact label figure.

The hard part is Nigerian food, so the AI is **grounded on Nigeria-relevant composition tables** (§11) rather than free-guessing — "assumed jollof" comes from the West African food table, not the model's imagination.

---

## 2. Reuse vs net-new (integration-first)

| Concern | Decision |
|---|---|
| Identity / auth | **Reuse** SSO for vendor + buyer roles. |
| Menu / dish entities | **Reuse** existing marketplace dish/menu rows. NRE *attaches* a nutrition profile; never duplicates the menu. |
| AI infrastructure | **Reuse** the AI team (symptom-checker / menu-parsing) for the auto-suggest estimator. |
| Notifications | **Reuse** for the asynchronous "review your menu's nutrition" nudge. |
| Mobile design system | **Reuse** `DESIGN-Mobile.md` for the nutrition card, badges, approve/edit sheet. |
| Audit | **Reuse** immutable audit infra for confirmations + allergen attestations. |
| Health / labs module | **Reference only** (downstream consumer of NRE output for the lab→food loop). |
| **Net-new** | AI estimator + grounding library; `DishNutritionProfile` + 3-state honesty machine; `AllergenDeclaration` (separate, stricter); asynchronous auto-suggest + batch-approve flow; lightweight-edit model; confidence/source display-transform layer; cart/order aggregation. |

---

## 3. Domain model

- **`CompositionReference`** *(seeded grounding data, internal)* — nutrient values per 100 g for a food, by prep method. Fields: `food_code`, `name`, `source` (`WAFCT` | `NFCT` | `OFF` | `FALLBACK`), `prep_method`, per-100g nutrients, `version`. **Not vendor-facing** — it's the AI's knowledge base.
- **`DishNutritionProfile`** *(the resolved output bound to a menu item)* — `dish_id`, `grounding` (`LIBRARY_MATCHED` | `FREE_ESTIMATED` | `LABEL`), `confidence` (`EXACT`|`MEDIUM`|`LOW`), per-serving values **with `low`/`high` range for estimates**, `portion_label` + `portion_size_g`, `status` (§5), `composition_version`, `resolved_at`.
- **`DishRecipe`** *(optional, hidden power-user path)* — `dish_id`, `ingredients[]`, `portion_size_g`, `version`. Only created if a vendor opts into the highest-accuracy path; **never required, never surfaced during onboarding**.
- **`AllergenDeclaration`** *(separate, safety-critical)* — `dish_id`, `allergens[]`, `declaration_type` (`CONTAINS` | `MAY_CONTAIN` | `FREE_FROM`), `attested_by`, `attested_at`, `status`. **AI may never set `CONTAINS` or `FREE_FROM`.**
- **`NutritionAuditLog`** — immutable (actor, dish, action, before/after, timestamp).

---

## 4. How a suggestion is produced (engine internals)

The vendor sees **one thing**: an AI suggestion. Under the hood the estimator grounds that suggestion in the best available source, in this order, and records which one it used:

| Grounding | Trigger | Method | Confidence |
|---|---|---|---|
| **Label** | barcode present (packaged item) | Open Food Facts / NAFDAC label → exact per-serving | **EXACT** |
| **Library-matched** | dish name matches the Nigerian grounding library | Map to the composite-dish profile, scale to standard portion | **MEDIUM** |
| **Free-estimated** | no library match | AI estimates from name + description + photo → best value **+ low/high range** | **LOW** |

Key change from v1: the library is **no longer a vendor-facing tier** — it's *inside* the AI as grounding. Whether the number came from a library match or a free estimate, the vendor experiences a single "AI suggestion" they can approve. The label fast-path stays separate because it yields real exactness for packaged goods.

**Re-suggestion triggers:** dish name/photo/portion edit, or composition-table version bump → profile marked `STALE` → re-estimated.

---

## 5. Profile honesty states

Three states, each visually distinct to the buyer. Guarded transitions, each audited.

```
(menu upload) ──auto-estimate──► AI_ESTIMATE        ← auto-PUBLISHED immediately, labelled "AI estimate"
AI_ESTIMATE
  ├─approve──────────────────► RESTAURANT_CONFIRMED  ← higher trust, STILL an estimate
  ├─edit then approve────────► RESTAURANT_CONFIRMED
  └─(no action)──────────────► AI_ESTIMATE           ← stays live; never blocks anything
[barcode present]            ─► EXACT                 ← packaged/label only
ANY ─name/photo/portion/version change─► STALE ─re-estimate─► AI_ESTIMATE | RESTAURANT_CONFIRMED | EXACT
```

- **`AI_ESTIMATE`** — shown as a range + "AI estimate" badge. Auto-published; needs no vendor action.
- **`RESTAURANT_CONFIRMED`** — vendor approved. Higher trust, point value allowed, but **still labelled an estimate, not "exact."** This distinction is deliberate: approving ≠ measuring, and diabetic/hypertensive users in the healthy zone must not read a confirmed estimate as lab precision.
- **`EXACT`** — reserved for packaged/barcoded items with a real label.

---

## 6. Vendor experience — asynchronous, never a gate

**At onboarding (zero nutrition work):**
1. Vendor uploads/edits menu items (names, photos) as they normally would.
2. The engine **auto-estimates the entire menu** and publishes each dish as `AI_ESTIMATE`. Nutrition is live from Day 1 with no vendor action.

**After onboarding (optional, at leisure):**
3. A gentle notification: "Review your menu's nutrition." Opening it shows every dish with its estimate and a one-tap **Approve all**, plus per-item approve/edit.
4. **Approve** → `RESTAURANT_CONFIRMED`, confidence upgraded, **"Nutrition-Verified" badge** granted (boosts healthy-zone ranking — the incentive to bother).
5. **Edit is intentionally lightweight and never asks for ingredients:**
   - **Portion selector** (small / regular / large) — rescales all values automatically.
   - **Direct macro nudge** — adjust the numbers if the vendor knows better.
   - That's it. Edit never bounces the vendor into an ingredient form.
6. **Hidden power-user path:** a vendor who *wants* maximum accuracy can opt into ingredient entry for a top-tier accuracy badge. Available, discoverable, **never required and never shown during onboarding.**

Net effect: onboarding cost for nutrition = **zero**; quality improves over time as vendors opt to confirm, drawn by the badge.

---

## 7. Allergen safety rules (same one-tap UX, stricter publish rule)

The approve/edit interaction is identical, but the **publish rule stays stricter than for macros** — because a wrong calorie count educates imperfectly, while a wrong allergen claim can hospitalize someone.

- The AI **pre-ticks suggested allergens** so review is effortless — but a suggestion is not a claim.
- **Macros auto-publish as estimates. Allergen "free-from" claims never auto-publish.** Until a vendor explicitly attests, the dish shows **"Allergen info not confirmed — may contain allergens."**
- **AI may never set `CONTAINS` or `FREE_FROM`;** those are vendor-attested only. `FREE_FROM` additionally requires acknowledging cross-contamination risk.
- Controlled vocabulary: peanut, tree nut, milk, egg, fish, crustacean/shellfish, soy, wheat/gluten, sesame + locally relevant.
- Buyer-facing allergen notice is prominent and **visually separate** from the macro card.
- Every attestation is immutably audited.

---

## 8. Display / transform layer

- **Honest precision:** `LOW`/`MEDIUM` → range + "AI estimate" badge ("≈520–580 kcal"). `RESTAURANT_CONFIRMED` → point value + "restaurant-confirmed (estimate)" badge. `EXACT` → point value + "from label." **No anonymous numbers.**
- **Plain-language layer:** "Light / Balanced / Heavy" + a traffic-light on **sodium, sugar, saturated fat** (Nigeria's hypertension + type-2 diabetes burden).
- **Cart & order aggregation:** roll up to "this order ≈ X kcal" with range propagation.
- **Offline-first:** profile cached with the dish; tiny payload.

---

## 9. Core API surface

```
POST  /v1/nutrition/menus/{menu_id}/auto-suggest   # batch-estimate a whole menu at upload (internal)
GET   /v1/nutrition/dishes/{dish_id}               # current profile (buyer/vendor)
POST  /v1/nutrition/dishes/{dish_id}/approve       # vendor approves AI suggestion
POST  /v1/nutrition/dishes/{dish_id}/edit          # portion + macro nudge (NOT ingredients)
POST  /v1/nutrition/dishes/{dish_id}/allergens     # vendor attests allergens (separate)
POST  /v1/nutrition/dishes/{dish_id}/recipe        # OPTIONAL power-user path → highest accuracy
GET   /v1/nutrition/cart/{cart_id}/summary         # aggregate estimate
# Admin
POST  /v1/admin/nutrition/composition              # manage grounding tables (versioned)
POST  /v1/admin/nutrition/library                  # curate Nigerian grounding library
POST  /v1/admin/nutrition/reresolve                # batch re-estimate on version bump
```

---

## 10. Authorization

- **Vendor** — approve / edit / attest allergens for **own dishes only** (object-level check).
- **Buyer** — read-only nutrition + allergen display.
- **Nutrition Ops/Admin** — manage grounding data + library, trigger re-estimation, audit.
- **System** — auto-suggest, mark stale, re-estimate.

---

## 11. Grounding plan (the credibility layer, now behind the AI)

1. **Seed the grounding tables** into `CompositionReference`, tagged by source + prep method:
   - **2019 FAO/INFOODS West African Food Composition Table (WAFCT)** — ~1,028 items, ~44 nutrients per 100 g, *including prepared forms* (boiled/grilled/stewed).
   - **2017 Nigerian Food Composition Table (NFCT)** — 282 Nigerian foods, up to 30 nutrients.
2. **Build the Nigerian grounding library** of common composite dishes (jollof, fried rice, egusi, ofada, amala+ewedu, beans/plantain, suya, pepper soup…) mapped to standard portions. This is what the AI matches against so an "assumed value" is composition-table-backed, not hallucinated.
3. **Cache Open Food Facts** for packaged barcodes (the EXACT fast-path).
4. **Fallback APIs (Edamam/Nutritionix) last-resort only**, for non-Nigerian/Western items the local tables don't cover — never for local dishes.
5. **Version everything.** Profiles pin the `composition_version` they were estimated against.
6. **Learn from edits.** Vendor edits to a common dish (e.g. "jollof") across many restaurants feed back to refine the library's standard profile — the system gets smarter the more it's used.

---

## 12. Safety invariants (non-negotiable)

1. Onboarding **never blocked** by nutrition; menus publish with estimates auto-attached.
2. Every displayed value carries **source + confidence**; no anonymous numbers.
3. **Approval ≠ exact** — `RESTAURANT_CONFIRMED` stays labelled an estimate; "exact" is label-only.
4. **No false precision** — unreviewed estimates shown as ranges.
5. AI suggestions are **grounded** in WAFCT/NFCT first; free-estimation only for unmatched dishes.
6. Allergen `CONTAINS`/`FREE_FROM` **vendor-attested only**; AI pre-ticks suggestions but they never auto-publish; default "may contain."
7. Whole feature labelled **"estimated nutrition for education — not medical or dietary advice."**
8. Grounding data **versioned**; profiles pin the version used.
9. Name/photo/portion edits mark profile `STALE` → re-estimate before display.
10. Immutable **audit** on confirmations + allergen attestations.
11. Edit path **never requests ingredients**; ingredient entry is an optional hidden power-user path only.

---

## 13. Edge cases

- **No library match + poor photo** → wide-range free estimate, prominently "rough estimate."
- **Combo / meal deals** → aggregate component estimates into one.
- **Portion variants** → vendor's portion selector rescales a single estimate.
- **Build-your-own bowls** → estimate per selected component, summed at cart time.
- **Implausible vendor edit** (fails kcal-per-gram sanity bounds) → flagged for ops, not auto-published.
- **Grounding version bump** → batch re-estimate `AI_ESTIMATE` dishes; `RESTAURANT_CONFIRMED` left intact until the vendor re-confirms.
- **Drinks / sides** → same engine, same rules.

---

## 14. Open knobs (architecture-neutral)

- Nutrients surfaced to buyers (lead set: energy, protein, carb, sugar, fat, sat-fat, fiber, sodium).
- Traffic-light thresholds for sodium/sugar/sat-fat.
- Size of the initial grounding library (top-N dishes).
- Whether the "Nutrition-Verified" badge is a hard ranking boost or a soft signal.
- Timing/cadence of the post-onboarding "review your nutrition" nudge.
- Fallback-API choice (Edamam vs Nutritionix) for the Western long tail.

---

## 15. Definition of done

- [ ] Menu upload auto-estimates the whole menu and publishes each dish as `AI_ESTIMATE` with **zero vendor action**
- [ ] WAFCT 2019 + NFCT 2017 seeded as AI grounding; library covers top-N dishes
- [ ] Estimator records grounding (`LIBRARY_MATCHED` / `FREE_ESTIMATED` / `LABEL`) + confidence on every output
- [ ] Three honesty states wired; `RESTAURANT_CONFIRMED` stays labelled an estimate, "exact" is label-only
- [ ] One-tap Approve + Approve-all; edit = portion + macro nudge only, **never ingredients**
- [ ] Optional hidden ingredient path exists, is never required, never shown at onboarding
- [ ] Allergens: AI pre-ticks but never auto-publishes claims; default "may contain"; vendor-attested only
- [ ] No false precision; estimates shown as ranges; "not medical advice" disclaimer surfaced
- [ ] Profiles pin grounding version; name/photo/portion edits invalidate → re-estimate
- [ ] Object-level authZ on all vendor actions; immutable audit on confirmations + attestations
- [ ] Cart/order aggregation with range propagation
- [ ] Edit-feedback loop refines library profiles over time
- [ ] Tests cover the suggestion pipeline, the three-state machine, allergen rules, and authorization
