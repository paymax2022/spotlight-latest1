# Module: Nutrition (Nutrition Resolution Engine)

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** no (payouts route is an explicit read-only empty shape) &nbsp;·&nbsp; **Feature flag:** `FEATURE_NUTRITION_ENABLED`
**Code:** `backend/internal/nutrition/` (`routes.go`, `handler.go`, `service.go`, `model.go`, `repository.go`, `ai.go`, `admin_oversight.go`, `offfeed.go`, `model_test.go`); wiring in `backend/internal/app/nutrition_routes.go` + `finance_routes.go:1413-1416`
**Slug:** `NUTRITION` (uppercase, used in Case IDs)

## 1. Overview & scope

The Nutrition Resolution Engine (NRE) estimates per-serving nutrition + allergens for orderable
restaurant dishes via a tiered resolver (LABEL / LIBRARY / FREE-AI / RECIPE grounding), a guarded
profile honesty state machine, and a **safety-critical allergen model**. Member routes are mounted
on the authed `finance` group (`/api/finance/nutrition/*`, owner-checked vendor actions); admin
routes are `/api/nutrition/admin/*` with per-route RBAC (`nutrition.admin.manage`,
`nutrition.admin.resolve`). Tier-3 AI (`ai.go`, Anthropic key) falls back to a deterministic mock;
label lookup defaults to `MockLabelLookup` so the engine resolves offline.

**This is NOT a money module.** `model.go`'s package doc is explicit: no ledger, values are real
nutrient quantities (g/mg/kcal), not kobo. The admin `/payouts` route deliberately returns an
empty, documented shape and never fabricates money (`admin_oversight.go:320`). QA therefore focuses
on **allergen safety, the honesty state machine, disclaimer presence, object-level vendor authz,
and admin RBAC** — not on money invariants.

Cross-cutting that applies: `../cross-cutting/authentication.md`,
`../cross-cutting/rbac-and-permissions.md` (admin gates, fail-closed),
`../cross-cutting/feature-flags-and-audit.md` (flag + `NUTRITION_ADMIN_RESOLVE` audit).

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Buyer-readable dish view | `GET /api/finance/nutrition/dishes/:dishId` | authed (public read) | no |
| Vendor approve → CONFIRMED | `POST /api/finance/nutrition/dishes/:dishId/approve` | owner (object-level) | no |
| Vendor portion/macro edit | `POST /api/finance/nutrition/dishes/:dishId/edit` | owner | no |
| Vendor allergen attest | `POST /api/finance/nutrition/dishes/:dishId/allergens` | owner | no |
| Declare recipe (hidden) | `POST /api/finance/nutrition/dishes/:dishId/recipe` | owner | no |
| Batch auto-suggest menu | `POST /api/finance/nutrition/menus/:menuId/auto-suggest` | owner (menuId=restaurantId) | no |
| Batch approve-all | `POST /api/finance/nutrition/menus/:menuId/approve-all` | owner | no |
| Cart summary | `GET`/`POST /api/finance/nutrition/cart/summary` | authed | no |
| Admin upsert composition | `POST /api/nutrition/admin/composition` | `RequirePermission("nutrition.admin.manage")` | no |
| Admin upsert library | `POST /api/nutrition/admin/library` | `nutrition.admin.manage` | no |
| Admin re-resolve batch | `POST /api/nutrition/admin/reresolve` | `nutrition.admin.resolve` | no |
| Admin resolve single dish | `POST /api/nutrition/admin/resolve` | `nutrition.admin.resolve` | no |
| Admin consult queue | `GET /api/nutrition/admin/consults` | `nutrition.admin.manage` | no |
| Admin resolve consult | `POST /api/nutrition/admin/consults/:id/resolve` | `nutrition.admin.resolve` | no |
| Admin payout runs (read-only empty) | `GET /api/nutrition/admin/payouts` | `nutrition.admin.manage` | no (always empty) |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Legal status transitions | fsm | `internal/nutrition/model_test.go` `TestCanTransition_Legal` | AUTOMATED |
| Illegal transitions rejected (fail-closed) | fsm | `model_test.go` `TestCanTransition_Illegal` | AUTOMATED |
| Grounding supersede precedence | unit | `model_test.go` `TestSupersedes`, `TestStatusForGrounding_AutoPublish` | AUTOMATED |
| Portion rescale factors | unit | `model_test.go` `TestPortionFactors`, `TestPortionRescale_*` | AUTOMATED |
| Recipe sum / retention / scale / incompleteness | unit | `model_test.go` `TestSumRecipe_*` | AUTOMATED |
| Library fuzzy match | unit | `model_test.go` `TestBestLibraryMatch`, `TestLibraryMatch_CaseInsensitive` | AUTOMATED |
| AI estimate deterministic + wide band + sanity | unit/inv | `model_test.go` `TestMockEstimate_*`, `TestParseAIEstimate_*` | AUTOMATED |
| **Allergen safety rules (AI≠CONTAINS/FREE_FROM; definitive needs attest; FREE_FROM needs ack; vocab)** | inv | `model_test.go` `TestValidateAllergen_*` | AUTOMATED |
| Display never a bare number; RESTAURANT_CONFIRMED still "estimate" | inv | `model_test.go` `TestBuildDisplay_*`, `TestFormatRange_PrecisionByStatus`, `TestStatusLabel` | AUTOMATED |
| Traffic light / energy band thresholds | unit | `model_test.go` `TestBandFor`, `TestTrafficLightFor` | AUTOMATED |
| Cart aggregation range propagation, worst confidence | unit | `model_test.go` `TestAggregateCart_*`, `TestWorstConfidence` | AUTOMATED |
| Sanity bounds accept/reject | inv | `model_test.go` `TestCheckSanity_*` | AUTOMATED |
| Object-level vendor ownership (IDOR) | authz | — | TODO |
| Admin RBAC fail-closed on money-adjacent routes | authz | — | TODO |
| Allergen rule enforced at HTTP (422 code shape) | contract | — | TODO |
| Disclaimer present on every member payload | contract | — | TODO |
| Payouts route returns empty, never money | contract | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `NUTRITION-INT-001` | Buyer dish view lazily resolves | P1 | flag on, dish D with no profile | `GET /nutrition/dishes/D` | — | 200; display block with grounding+confidence+status + `disclaimer` present |
| `NUTRITION-INT-002` | Vendor approve → RESTAURANT_CONFIRMED | P1 | vendor owns D, profile AI_ESTIMATE | `POST /nutrition/dishes/D/approve` | — | 200; profile status RESTAURANT_CONFIRMED, badge "Nutrition-Verified", still `estimated:true` |
| `NUTRITION-INT-003` | Recipe declare → CONFIRMED + MEDIUM | P2 | vendor owns D | `POST /nutrition/dishes/D/recipe {ingredients:[…],portion_size_g:400}` | valid ingredients | 200; grounding RECIPE, confidence MEDIUM, status RESTAURANT_CONFIRMED |
| `NUTRITION-VAL-001` | Recipe requires ≥1 ingredient + portion | P1 | vendor owns D | `POST .../recipe {ingredients:[],portion_size_g:0}` | empty | 400 binding error |
| `NUTRITION-VAL-002` | Edit requires portion or nudges | P2 | vendor owns D | `POST .../edit {}` | empty body | 400 "provide portion_label and/or portion_macro_nudges" |
| `NUTRITION-VAL-003` | Cart summary needs ids | P2 | authed | `POST /nutrition/cart/summary {dish_ids:[]}` | empty | 400 "no dish ids provided" |
| `NUTRITION-SEC-001` | Allergen: AI cannot assert CONTAINS/FREE_FROM | P0 | vendor owns D | attest with `source` implying AI + `CONTAINS` | AI source | 422 `ALLERGEN_RULE_VIOLATION` (Rule 1) |
| `NUTRITION-SEC-002` | Allergen: FREE_FROM requires cross-contam ack | P0 | vendor owns D | `POST .../allergens [{allergen:"peanut",declaration_type:"FREE_FROM",cross_contamination_ack:false}]` | ack=false | 422 `ALLERGEN_RULE_VIOLATION` (Rule 3) |
| `NUTRITION-SEC-003` | Allergen: definitive claim needs vendor attester | P0 | unauthenticated / no attester | attest CONTAINS with no attester | — | 422 (Rule 2) |
| `NUTRITION-SEC-004` | Allergen: unknown vocab rejected | P1 | vendor owns D | attest `allergen:"kryptonite"` | bad vocab | 422 (unknown allergen) |
| `NUTRITION-AUTHZ-001` | IDOR: vendor cannot approve another restaurant's dish | P0 | D owned by restaurant R1; caller owns R2 | `POST /nutrition/dishes/D/approve` as R2 | — | 403 forbidden (`ErrForbidden`) |
| `NUTRITION-AUTHZ-002` | IDOR: batch auto-suggest scoped to own restaurant | P1 | menuId = other restaurant | `POST /nutrition/menus/OTHER/auto-suggest` | — | 403 forbidden |
| `NUTRITION-AUTHZ-003` | Admin route denies without permission | P0 | caller lacks `nutrition.admin.manage` | `POST /api/nutrition/admin/composition` | — | 403 forbidden; deny-by-default (see `../cross-cutting/rbac-and-permissions.md`) |
| `NUTRITION-AUTHZ-004` | Admin resolve requires `nutrition.admin.resolve` | P0 | caller has manage but not resolve | `POST /api/nutrition/admin/resolve` | — | 403 forbidden (scoped permission) |
| `NUTRITION-CON-001` | Disclaimer on every member payload | P1 | any dish/cart response | inspect approve/edit/recipe/cart responses | — | mandatory `Disclaimer` string present (not medical advice) |
| `NUTRITION-CON-002` | Sanity-bounds implausible → 422 needs_review | P1 | vendor edit produces implausible macros | `POST .../edit` with impossible kcal density | 12 kcal/g | 422 `SANITY_BOUNDS`, `needs_review:true`, NOT auto-published |
| `NUTRITION-CON-003` | Illegal transition → 409 | P1 | profile EXACT | force EXACT→RESTAURANT_CONFIRMED | — | 409 `ILLEGAL_TRANSITION` (fail-closed) |
| `NUTRITION-CON-004` | Payouts route is read-only empty | P0 | admin with manage | `GET /api/nutrition/admin/payouts` | — | 200; `{runs:[],placeholder:true,note:…}` — never fabricates money |
| `NUTRITION-INT-004` | Admin resolve consult writes audit | P1 | admin resolve perm; profile in review queue | `POST /api/nutrition/admin/consults/ID/resolve {resolution:"resolve"}` | — | 200; immutable `NUTRITION_ADMIN_RESOLVE` audit row; no money moved |
| `NUTRITION-SEC-005` | Flag-off: routes not mounted | P0 | `FEATURE_NUTRITION_ENABLED` off | call any `/nutrition/*` route | — | not mounted / 404, never 500 — `../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-001 |

## 5. State-machine transitions

Profile honesty machine (`model.go:126` `statusTransitions`, `CanTransition` fail-closed):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| `AI_ESTIMATE` | approve / edit-then-approve | `RESTAURANT_CONFIRMED` | point value allowed, still "estimate" | `NUTRITION-INT-002` |
| `AI_ESTIMATE` | re-estimate (self) | `AI_ESTIMATE` | no-op self-loop | `NUTRITION-CON-003` |
| `AI_ESTIMATE` | barcode appears | `EXACT` | LABEL grounding | — |
| `AI_ESTIMATE` / `RESTAURANT_CONFIRMED` / `EXACT` | menu/portion/version change | `STALE` | re-estimated before display | — |
| `STALE` | re-resolve | `AI_ESTIMATE` / `RESTAURANT_CONFIRMED` / `EXACT` | grounding-ranked | `NUTRITION-INT-004` |
| `RESTAURANT_CONFIRMED` | routine AI re-estimate | — (rejected) | confirmed value not auto-downgraded (`supersedes`) | `NUTRITION-CON-003` |
| `EXACT` | anything but barcode change | — (terminal) | only STALE on barcode change | `NUTRITION-CON-003` |

Illegal edges (any not listed) are rejected → `ErrBadState` → 409. Re-resolving STALE is
idempotent-safe; a confirmed/exact profile is never silently overwritten by a lower-grounding
re-estimate (`supersedes` guard).

## 6. Security & abuse cases

- **Allergen safety (P0):** the three non-negotiable rules (`validateAllergen`, enforced in code
  AND by DB CHECK) — `NUTRITION-SEC-001/002/003/004`. A breach must surface the clean
  `ALLERGEN_RULE_VIOLATION` sentinel (422), never a raw DB error.
- **Object-level vendor authz / IDOR (P0):** every vendor mutation is owner-checked in the service
  (`ErrForbidden`) — `NUTRITION-AUTHZ-001/002`. A vendor must not touch another restaurant's dish
  or menu.
- **Admin RBAC fail-closed (P0):** `manage` vs `resolve` are distinct permissions
  (`NUTRITION-AUTHZ-003/004`); reference `../cross-cutting/rbac-and-permissions.md`.
- **No money fabrication (P0):** `/payouts` is read-only empty by design (`NUTRITION-CON-004`).
  Any future change adding real amounts here must go through the ledger — flag it.
- **Disclaimer / honesty (P1):** every payload carries the mandatory disclaimer; a bare number is
  never emitted; RESTAURANT_CONFIRMED is still labelled an estimate.
- **Flag gating (P0):** `NUTRITION-SEC-005` → `../cross-cutting/feature-flags-and-audit.md`.

## 7. Automated specs to add

- `internal/nutrition/handler_test.go` — gin `TestMode` boundary: allergen 422 code shape,
  disclaimer presence, edit-empty-body 400, cart-empty 400, payouts empty shape. (Currently only
  pure `model_test.go` exists — no HTTP/authz coverage.)
- `internal/nutrition/service_authz_test.go` — object-level ownership (`ErrForbidden`) for
  approve/edit/allergens/recipe/auto-suggest with a fake repo returning a non-owner dish.
- `internal/nutrition/admin_rbac_test.go` — assert `RequirePermission` blocks a permissionless
  caller on each admin route and that `manage`≠`resolve` (integration with a fake RBAC).
- `internal/nutrition/admin_resolve_audit_test.go` — assert `AdminResolveConsult` writes the
  `NUTRITION_ADMIN_RESOLVE` audit row and moves no money.
  Follow the table-driven Go convention already used in `model_test.go`.

## 8. Coverage target & exit criteria

Tier 1, pure-logic floor ≥ 80% (already high via `model_test.go`). **Exit criteria:** all
`NUTRITION-SEC-001..004` (allergen safety) pass; `NUTRITION-AUTHZ-001..004` (vendor IDOR + admin
RBAC) pass; `NUTRITION-CON-004` (payouts never fabricate money) passes; `NUTRITION-CON-003`
(illegal transitions rejected) passes; `NUTRITION-SEC-005` (flag-off) passes.
