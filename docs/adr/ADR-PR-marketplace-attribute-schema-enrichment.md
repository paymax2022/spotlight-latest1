# ADR-PR — Marketplace attribute_schema: one JSONB blob, two independent shapes

- **Status:** Accepted
- **Date:** 2026-08-31
- **Related:** the Marketplace Category & Listing System PRD (v1.0, 2026-08-31)

## Context

The PRD asked for a schema-driven listing form covering 12 categories / 72
subcategories (VIN + mileage for Cars, bedrooms + title-document type for
Property, salary range for Jobs, ...), each rendering only its own fields and
being validated server-side against the same rules the client renders from.

The marketplace module already had almost this architecture — it just had no
content. `mkt_categories.attribute_schema` (JSONB, one column, seeded to `{}`
on every one of the 72 leaf subcategory rows) was already read by two
completely independent consumers that had never been reconciled:

- **Backend** (`backend/internal/marketplace/attrs_validation.go`): a
  hand-rolled draft-07 JSON-Schema subset — `required` / `properties` (per-key
  `type`, `enum`, `minimum`/`maximum`) / `additionalProperties`. This is the
  write-time validation chokepoint (§6.2 of the PRD).
- **Mobile client** (`mobile-app/reactnative/.../api/sell.mock.ts`
  `AttributeField`/`AttributeSchema`): a `{ fields: [{key,label,type,...}] }`
  config-driven-form shape consumed by `AttributeFields.tsx` to render the
  Sell wizard's attribute step.

Nothing converted between them, and no migration had ever seeded a non-empty
schema — every category was unconstrained, and the client's `enum`/`bool`
attribute types had never grown past a 3-branch dispatcher (chips / switch /
text input). Building a genuine `attribute_definitions` + `listing_facets`
table pair per the PRD's own aspirational Section 4 would have meant
deprecating a shape both sides of a ~25k-line, feature-flagged, already-live
module depend on today — a structural rewrite, not an enrichment.

## Decision

Keep the single `attribute_schema` JSONB column. Populate it with a JSON
object that carries **both** shapes side by side, as sibling top-level keys:

```json
{
  "fields": [ { "key": "...", "label": "...", "type": "select", "options": [...], "required": true, "filterable": true, "group": "..." } ],
  "required": ["..."],
  "properties": { "...": { "type": "string", "enum": [...] } },
  "additionalProperties": false
}
```

`attrs_validation.go` only ever unmarshals into `required`/`properties`/
`additionalProperties` — Go's `json.Unmarshal` silently ignores the unknown
`fields` key, so the validator needed no changes to read the new content
(only new type coverage: `array` + `items`/`minItems`/`maxItems`, added for
multiselect fields like Cars → Features). The mobile `AttributeSchema` type
only ever reads `.fields` — the backend-only keys are inert extra JSON to it.
Each consumer is blind to the other's half of the same blob by construction,
not by convention that could quietly drift.

The `fields[]` → `required`/`properties` half is **mechanically derived**,
not independently authored: a fixed widget→JSON-Schema-type table (`select`→
`string`+`enum`, `multiselect`→`array` with `items.enum`, `stepper`→
`integer`+`minimum`/`maximum`, `toggle`→`boolean`, ...) generates the backend
half from the client half at content-authoring time
(`supabase/migrations/20270151000000_marketplace_attribute_schemas.sql`).
This removes an entire class of possible drift (a field present in one shape
but not the other, or an enum that disagrees between the two) — there is
exactly one authored source (`fields[]`) per subcategory, not two.

Scoped out of this pass, to keep the change purely additive and reviewable:
`dependsOnKey` cascading options (e.g. vehicle Model filtered by Brand) render
correctly in the client but no subcategory in the seeded content actually
uses cascading option data yet, since that needs reference tables
(`vehicle_makes`/`vehicle_models`) the PRD itself flags as unscoped (§9);
date-range calendars and repeatable-group fields (event packages, shortlet
availability) were dropped per the PRD's own out-of-scope note on booking
flows (§1.2); a handful of fields duplicate top-level `mkt_listings` columns
(title, description, price, images, location, and the platform's existing
5-value global `condition` enum) and were deliberately **not** re-declared in
`attrs` — where a subcategory's PRD condition vocabulary didn't fit that
global enum (Vehicles' "Salvage"), a narrow supplementary attrs field was
added instead of widening the shared enum.

## Consequences

- Zero schema/table migrations beyond one additive `UPDATE ... SET
  attribute_schema = ...` per leaf subcategory (72 statements, one file,
  idempotent, re-runnable). No DDL.
- `attrs_validation.go` gained `array`/`items`/`minItems`/`maxItems` support
  (tested against the actual seeded Cars schema, not just synthetic
  fixtures — see `TestValidateAttrs_RealSeededCarsSchema`) but is otherwise
  unchanged; every previously-seeded (empty) category schema still validates
  identically.
- The mobile `AttributeField` type widened (backward compatible: `enum`/
  `bool` kept as aliases of `select`/`toggle`) and `AttributeFields.tsx`
  grew from 3 to 11 widget branches, modeled on the existing
  `features/insurance/components/live/DynamicField.tsx` pattern rather than
  inventing a new one. Two small reusable components were added
  (`components/Stepper.tsx`, `components/ColorSwatchPicker.tsx`) since
  nothing in `src/components/` already covered a quantity stepper or a
  colour-swatch picker (an identically-named but unrelated `Stepper` already
  existed under `features/arena/` — a wizard progress-dots widget — and was
  deliberately not reused).
- If a future phase genuinely needs cross-category indexed filter columns at
  50k+ listing scale (the PRD's `listing_facets` table), that is still a
  clean additive step from here: `fields[].filterable` already marks which
  keys would populate it, and nothing in this change forecloses adding it
  later.
