# ADR-007 — Provider-agnostic MapService abstraction

**Date:** 2026-06-21
**Status:** Accepted
**Deciders:** Platform / Backend, with Frontend + DevOps + QA

## Context

The super app needs map primitives across many modules (Health, Marketplace,
Food & Logistics, Transportation, Professional Services, Paymax, Visitor Access),
Nigeria-first (Lagos). Different features need different primitives, and most
must NOT hit a paid maps API:

- display tiles, address autocomplete, geocode/reverse, external POI search,
  routing, distance matrix (dispatch), map-matching (live tracking),
- plus "near me" and geofencing over OUR OWN records.

Three hard external constraints shape the design:

1. **License coherence.** Google's terms forbid caching/persisting geocoding &
   Places results and forbid displaying Google-sourced coordinates on a
   non-Google basemap.
2. **No multi-key rotation.** Rotating accounts/keys to dodge free-tier limits
   violates provider terms and risks suspension.
3. **Key hygiene.** Provider keys must never ship in the mobile/web client.

We also already had an ad-hoc `transport.MapsAdapter` (geocode/route/matrix) used
only by ride-hailing — not reusable, not config-driven, no caching, no cost guard.

## Decision

Introduce a single `MapService` interface (`backend/internal/maps`) that the
whole app calls. Which concrete provider serves each **primitive** is decided by
a **config map `{primitive -> provider}` per surface** (`SurfaceConfig`), so
swapping a provider is a config change — not a code change.

- **Adapters** are small per-primitive interfaces (`Geocoder`, `Router`,
  `Matrixer`, `MapMatcher`, `Autocompleter`, `PlaceSearcher`, `TileProvider`);
  a provider implements only what it serves and is referenced by `Name()`.
- **Default stack = OpenStack** (low cost): MapTiler basemap, Geoapify
  (OSM-licensed) geocode/reverse/autocomplete, self-hosted OSRM route/matrix/
  map-match. **Google is used ONLY** for autocomplete on consumer
  checkout/delivery surfaces and external POI search. Mapbox is optional.
- **Keys are server-side only.** The client calls `/api/finance/maps/*`; the
  backend proxies to providers.
- **Caching:** only OpenStack (OSM) geocode/reverse results are cached, in a
  PostGIS `geocode_cache` keyed by normalized address with a TTL.
- **Near-me + geofencing** run on PostGIS (`ST_DWithin` / `ST_Contains`) against
  `merchant_locations` / `service_areas` — never a maps API.
- **License coherence is enforced centrally** (`guards.go`): every result is
  tagged with a `Source`; the cache writer refuses non-OSM rows; a runtime guard
  (`AssertRenderable`) throws if a Google-sourced point would render on the
  OpenStack basemap.
- **Cost guard:** `map_usage` tracks per-provider/per-primitive monthly counts;
  alerts fire at 50/75/90% of configured SKU caps; at a soft cap the router
  **degrades gracefully** to OpenStack (or manual pin-drop) — never a hard fail,
  never a key/account switch.
- **Nigeria design rule:** at address capture the pin + Plus Code is the source
  of truth; `POST /maps/locations` stores the confirmed pin + Open Location Code.

The module is feature-flagged (`FEATURE_MAPS_ENABLED`) and mounts under
`/api/finance/maps`, mirroring the existing module-registration pattern. When a
provider key is absent, a deterministic mock is registered under the real
provider's name (and correct `Source`) so dev/CI stay functional and guards
behave identically.

## Consequences

### Positive
- One seam for every map call; provider swaps are config edits per environment/surface.
- Costs are controlled by caching + PostGIS + quotas + graceful degradation.
- License rules are enforced in one auditable place, not sprinkled across features.
- Keys never reach the client.

### Negative / trade-offs
- Self-hosted OSRM (and optionally Nominatim/Photon) is infra we must run and
  keep updated with the Lagos/Nigeria OSM extract.
- The per-surface config adds a small indirection vs. calling a provider directly.

### Risks
- A misconfigured `{primitive -> provider}` map could route a primitive to a
  provider that doesn't implement it — mitigated by resolve-time errors and tests.
- Provider response-shape drift — mitigated by adapter-level parsing + fallback.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Call Google Maps SDK directly in each client | Ships keys to client; expensive; violates no-cache/coherence rules; not swappable |
| Single hardcoded provider behind a thin wrapper | Not config-driven; swapping a provider becomes a code change |
| Multi-key/account rotation to stretch free tiers | Violates provider terms; suspension risk (explicitly forbidden) |
| Extend `transport.MapsAdapter` in place | No caching/cost-guard/license-coherence; not reusable across modules |

## Related

- `contracts/openapi.yaml` § `/api/finance/maps/*`, schemas `Map*`
- `backend/internal/maps/` (interface, adapters, guards, cache, usage)
- `supabase/migrations/20260626000000_enable_postgis.sql`, `20260626000100_maps_core.sql`
- `backend/internal/maps/README.md` (provider config + license rules + how to swap)
- Linked ADRs: ADR-003 (provider provisioning pattern), ADR-002 (immutability discipline)
