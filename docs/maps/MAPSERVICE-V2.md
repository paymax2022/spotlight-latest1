# MapService v2 — Nigeria-tuned, cost-aware resolution layer

Implements MAPSERVICE.md as an **additive upgrade** to the existing
provider-agnostic `internal/maps` MapService. The legacy router is untouched and
keeps running; the v2 orchestration layer activates only behind
`FEATURE_MAPS_V2_ENABLED` (reversible, staged rollout).

## What it does

OSM-first where coverage is good, escalate to Google/HERE where it isn't, deflect
most lookups with our own data, and feed verified pins back so the cheap path
widens over time:

```
gazetteer → cache → prediction → coverage-ordered providers (OSM↔Google/HERE)
            with confidence escalation (τ) and a NEEDS_PIN floor (τ_floor)
```

## Reuse vs net-new

REUSE (already in Paymax): provider-agnostic `MapService` + adapter `Registry`
+ PostGIS; config-driven selection + soft-cap degradation; `geocode_cache`;
`merchant_locations`/`service_areas`; `UsageTracker` + budget alerts; metrics +
per-user rate limit; PlusCode; scheduler; admin shell + RBAC.

NET-NEW (this build):
- **Foundation** (`types_v2.go`, `cell.go`, `config_v2.go`, `orchestrator.go`):
  `Confidence`/`H3Cell`/`Partial` on results, `Capset`, `CoverageTier`,
  `ErrNeedsPin`; a dependency-free geohash spatial cell (the "H3" key, swappable
  for real H3); v2 config (thresholds, per-tier provider order, cache-TTL by
  source, daily budgets); the resolution-chain orchestrator (nil-safe).
- **Providers** (`provider_here.go` + confidence on google/geoapify/osrm/mock):
  HERE adapter; Google geocoding added as accuracy fallback; normalized 0..1
  confidence from each provider's native signal. Google/HERE never cached.
- **Gazetteer + cache v2** (`gazetteer.go`, `encrypt.go`, `cache_v2.go`):
  `map_gazetteer` (PostGIS+H3), AES-256-GCM PII encryption, access-logged reads
  (NDPA), H3-keyed cache with TTL-by-source.
- **Coverage + audit + guardrails** (`coverage.go`, `recorder.go`,
  `provider_guard.go`): `map_coverage_cell` H3 tiers (Lagos seed, self-improving),
  `map_resolution_event` deterministic audit, circuit breaker + daily budget caps.
- **Predictor** (`predictor.go`): history-based deflection off the user's real
  trips/parcels destinations (zero external cost).
- **OSM contribution loop** (`contribution.go`, `osm_pipeline.go`,
  `contribution_scheduler.go`): PII-stripped non-PII candidates → human review →
  moderated, rate-limited OSM upload (noop until creds configured — never fabricated).
- **Admin** (`routes_v2.go` + `frontend-admin/app/admin/maps/*`): cost/coverage +
  provider-health dashboard and OSM contribution review (`map.admin.review`).
- **Migration** `20260815000700_mapservice_v2.sql`; flag `FeatureMapsV2Enabled`.

## Invariants (MS-1…MS-7) — enforced + tested

- **MS-1** Fulfilment geocodes server-side (callers use `MapService.Geocode`).
- **MS-2** Gazetteer + cache + prediction checked before any paid provider —
  tested (`TestMS2_*`: provider call count stays 0 on a deflected hit).
- **MS-3** Coverage-aware order + confidence-driven escalation — tested
  (`TestMS3_*`: LOW tier → Google→HERE, stops once τ met).
- **MS-4** No PII in OSM (stripPII + PIIStripped gate); gazetteer/cache encrypted
  + access-logged.
- **MS-5** Provider-agnostic: selection is config (per-tier order), no caller binds
  a vendor.
- **MS-6** Budgets/circuit-breakers degrade to `NEEDS_PIN`, never hard-fail —
  tested (`TestMS6_*`: all providers blocked → `ErrNeedsPin`; low confidence → pin).
- **MS-7** Every external call cached (OSM only) + emitted as a `ResolutionEvent`;
  selection deterministic/auditable — tested (`TestMS7_*`, incl. Google-not-cached).

## Config (env)

`FEATURE_MAPS_V2_ENABLED`, `MAPS_HERE_KEY`, `MAPS_GAZETTEER_KEY` (32-byte AES key),
`MAPS_V2_CONFIG_PATH` (JSON override for thresholds/order/budgets). Defaults:
escalate τ=0.70, pin_floor=0.45; GOOD/FAIR → OSM-first, LOW → accuracy-first;
cache TTL google/here 30d, osm 90d, gazetteer never.

## Assumptions

- **H3**: implemented as a dependency-free geohash cell (CGO `h3-go` avoided);
  the DB column is `h3` and the keyer is swappable for real H3 with no orchestrator
  change.
- Predictor uses only history tables that genuinely carry user-scope + address +
  coordinates (`trips`, `parcels`); sources without coords were excluded.
- OSM upload is an interface + `NoopOSMUploader` (no creds → staged, never a
  fabricated changeset); the real OSM API client is future work.
- Gazetteer doc `file`/PII encryption uses AES-256-GCM when a key is set, else a
  Noop in dev/CI.
- Go toolchain unavailable in-sandbox: verified structurally (no symbol
  collisions, signatures against the v2 interfaces, balanced braces); admin
  `tsc --noEmit` passed clean. `go build/vet/test ./internal/maps/...` deferred to CI.
