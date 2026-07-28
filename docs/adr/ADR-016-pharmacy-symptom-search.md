# ADR-016 — Pharmacy Symptom-Based Medication Search (taxonomy, triage tiers, cluster-rule DSL)

**Date:** 2026-07-02  
**Status:** Accepted  
**Deciders:** Platform team, superintendent pharmacist (clinical sign-off)

## Context

The pharmacy vertical (ADR for base module: migration `20260815000200_health_pharmacy.sql`)
sells NAFDAC-gated products, but users search by *symptom* ("body dey hot",
"efori"), not by product name. We need symptom-guided product discovery that is
**not diagnosis and not prescribing**, works across English, Pidgin, Hausa,
Yoruba and Igbo, and fails closed on anything clinically risky.

Constraints:

- Regulatory: PCN/NAFDAC — only OTC and PHARMACY_ONLY items may surface from a
  symptom query; POM and BLOCKED_ONLINE never appear on this surface. A licensed
  pharmacist must gate anything beyond plain self-care.
- NDPR: symptom queries + refiners are sensitive health data — must be
  rate-limited per device, excluded from general analytics, service-role-only.
- Brownfield: existing `pharmacy_products` / `pharmacy_orders` tables must not
  be altered; migrations are additive-only.
- Clinical safety copy: always "options for your symptoms", never "treatment
  for your condition" — and the copy must be versioned.

## Decision

**Resolution pipeline (deterministic, data-driven, no LLM at query time):**
`term → concept → condition cluster (base triage tier) → cluster rules
(refinement) → therapeutic class → live SKUs`.

1. **Pharmacist-approved taxonomy in Postgres** (migration
   `supabase/migrations/20260827000000_pharmacy_symptom_search.sql`):
   `symptom_terms` (multilingual, `en|pcm|ha|yo|ig`) → `symptom_concepts` →
   `symptom_clusters` (base tier `T1|T2|T3|T4`) via `symptom_cluster_concepts`,
   refined by `symptom_cluster_rules`, surfaced through
   `symptom_cluster_class_map` → `therapeutic_classes` → `pharmacy_skus`.
   Every taxonomy row carries a status machine
   `AI_SUGGESTED → APPROVED → RETIRED`: AI may *draft*, only a pharmacist
   approval (stamped `approved_by`/`approved_at`, CHECK-enforced) makes a row
   user-visible. Rows are retired, never deleted.

2. **Triage tiers** decide the surface: **T1** self-care → class groups;
   **T2** pharmacist-guided → class groups + `pharmacist_confirmation_required`
   (checkout blocked until a `pharmacy_review_cases` row is APPROVED);
   **T3** consult / **T4** emergency → an escalation card routing into the
   existing intake/telehealth/MapService surfaces and **no products, ever**.
   Highest tier produced by any matched cluster or rule wins.

3. **Cluster-rule DSL** — a tiny, deterministic boolean expression language
   stored as text and parsed in Go (grammar below). One effect per rule,
   CHECK-enforced: `ESCALATE` (to T2/T3/T4), `REQUIRE_CONFIRMATION` (force the
   T2 gate), `SUPPRESS_CLASS` (cohort exclusions — a suppressed class is
   *removed*, never shown-but-disabled). Fail-closed: an APPROVED rule that
   fails to parse at evaluation time forces escalation to T3.

   ```
   rule        := or_expr
   or_expr     := and_expr { "OR" and_expr }
   and_expr    := unary { "AND" unary }
   unary       := [ "NOT" ] primary
   primary     := "(" or_expr ")" | predicate
   predicate   := "concept:" CODE                  CODE := [a-z][a-z0-9_]*
                | "who:" COHORT                    COHORT ∈ {ADULT, CHILD_6_12,
                                                     CHILD_UNDER_6, PREGNANT_OR_BF}
                | "duration_days" OP INT           OP ∈ { < , <= , = , >= , > }
                | "term_count" OP INT
   ```
   Precedence `NOT > AND > OR`; keywords case-sensitive UPPERCASE;
   `who:` matches only an explicitly selected refiner; duration buckets map
   `TODAY→1, D2_3→3, GT_3D→4` days.

4. **SKU surface**: new `pharmacy_skus` table (brownfield-safe — zero changes
   to `pharmacy_products`) carries `classification`
   (`OTC|PHARMACY_ONLY|POM|BLOCKED_ONLINE`, **default BLOCKED_ONLINE** so an
   unclassified SKU can never surface), cohort-suppression attributes
   (`age_min_years`, `pregnancy_safe`), region, stock, and
   `max_qty_per_window` abuse caps. Prices in integer kobo.

5. **NDPR & anti-scraping**: raw taxonomy is never exposed to clients
   (resolution is server-side via service_role; RLS gives admins read-only).
   `symptom_search_events` (service-role-only RLS) logs hashed-device queries
   for per-device rate limiting and the unmatched-term curation loop.

6. **Feature flag**: `FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED`
   (`Config.FeaturePharmacySymptomSearchEnabled`, default **false**), ANDed
   with `FEATURE_PHARMACY_ENABLED`. Gates `/pharmacy/symptom-search`,
   `/pharmacy/classes/{id}/skus`, `/admin/pharmacy/mappings`,
   `/admin/pharmacy/reviews/{id}/decision`.

7. **RBAC**: `health.pharmacy.symptom.mappings` (taxonomy CRUD via the single
   suggest-approve write surface) and `health.pharmacy.symptom.reviews`
   (review-case decisions, object-level authz on the pharmacist's premises
   tenant). All writes audit-logged and idempotency-keyed.

## Consequences

### Positive
- Deterministic and auditable: every result is explained by approved rows +
  rule expressions; no model inference on the query path.
- Illegal states unreachable at the DB layer (approval stamps, effect shapes,
  tier enums, BLOCKED_ONLINE default, note-required rejections).
- Multilingual reach with a curation loop (unmatched terms logged → pharmacist
  console) instead of a brittle NLP dependency.
- Brownfield-safe: purely additive; existing pharmacy tables untouched.

### Negative / trade-offs
- Taxonomy curation is manual pharmacist labour; coverage grows slowly.
- The DSL is intentionally weak (no numeric vitals, no symptom severity) —
  anything it cannot express must escalate rather than resolve.
- `pharmacy_skus` duplicates price/stock at pack level; base product rows
  remain authoritative for the classic catalog surface, so the two read paths
  must not be mixed.

### Risks
- Mis-tiering: a T3-worthy presentation resolving to T1. Mitigated by
  conservative base tiers (fever is T2, never T1), fail-closed rule parsing,
  and red-flag clusters (chest pain, GI bleed, convulsion) hard-coded at T4
  in seed data.
- Scraping of the mapping surface — mitigated by server-mediated resolution,
  per-device 429s, and no client-readable taxonomy RLS path.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| LLM classification at query time | Non-deterministic, unauditable for a regulated surface; latency + cost; NDPR exposure of raw queries to a third party. |
| Reuse the AI-care red-flag triage engine (`health_triage`) | Different contract: intake triage is per-consult and patient-bound; symptom search is anonymous-ish commerce discovery. Shared tiers (T1–T4) kept aligned, engines kept separate. |
| JSONB rule objects instead of a text DSL | Harder for pharmacists to read/diff in the console; expression text + grammar is reviewable and versionable line-by-line. |
| ALTER `pharmacy_products` with classification columns | Touches the existing catalog write path; a separate `pharmacy_skus` table keeps the change additive and lets one product carry multiple packs/regions. |

## Related

- `contracts/openapi.yaml` — `/pharmacy/symptom-search`, `/pharmacy/classes/{id}/skus`,
  `/admin/pharmacy/mappings`, `/admin/pharmacy/reviews/{id}/decision`,
  schemas `SymptomSearchResult`, `SymptomClusterMatch`, `SymptomClassGroup`,
  `SymptomEscalationCard`, `PharmacySkuOption`, `PharmacyReviewCase`
- `supabase/migrations/20260827000000_pharmacy_symptom_search.sql`
- Linked ADRs: ADR-009 (nutrition resolution engine — same resolution-pipeline
  pattern), ADR-010 (pre-consult intake — red-flag escalation targets),
  ADR-006 (telemedicine settlement — consult handoff)
