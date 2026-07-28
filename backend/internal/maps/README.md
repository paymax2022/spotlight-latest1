# MapService — provider-agnostic maps layer

One interface, pluggable adapters. The entire app calls map primitives through
`MapService`; **which provider serves each primitive is decided by config**, so
swapping a provider is a config change — not a code change.

- Interface + router: `service.go` / `service_impl.go`
- Adapters: `provider_*.go` (Geoapify, MapTiler, OSRM, Google, mock)
- Config map: `config.go` (`SurfaceConfig` = `{primitive -> provider}` per surface)
- PostGIS cache + geo: `cache.go`, `geo_repo.go` (+ migrations `20260626*`)
- Guards / cost guard: `guards.go`, `usage.go`
- HTTP proxy: `handler.go`, `routes.go` → mounted at `/api/finance/maps`
- API contract: `contracts/openapi.yaml` (tag `Maps`)
- Decision record: `docs/adr/ADR-007-maps-abstraction.md`

## Default provider routing

| Primitive | Default (OpenStack) | Google | Notes |
|-----------|---------------------|--------|-------|
| basemap | MapTiler | — | MapLibre GL style + attribution |
| geocode / reverse | Geoapify (OSM) | — | **cached** in PostGIS |
| autocomplete | Geoapify | ✅ on `checkout`/`delivery` | Google text only |
| places (world POI) | (degraded: Geoapify) | ✅ | Google primary |
| route / matrix / matchToRoad | OSRM | — | self-hosted |
| findNearbyOwn / isInZone | **PostGIS** | — | never a maps API |

## Hard rules (enforced in code)

1. **License coherence.**
   - Google results are tagged `source=google`, `cacheable=false`.
   - `cache.Put` **refuses** any non-OSM row (`guardCacheWrite` → `ErrNotCacheable`).
   - `AssertRenderable` **throws** if a `google`-sourced point would render on the
     OpenStack basemap. `MapView` mirrors this client-side.
2. **Single legitimate key per provider.** No multi-account/multi-key rotation
   anywhere. Cost control = caching + PostGIS + quotas + graceful degradation.
3. **Keys are server-side only.** The client calls `/api/finance/maps/*`; the
   backend proxies to providers.
4. **Caching** = OpenStack geocode/reverse only, in `geocode_cache`, keyed by a
   normalized address with a TTL.

## Cost guard & degradation

`map_usage` tracks per-provider/per-primitive monthly counts. Budget alerts fire
at **50/75/90%** of the SKU caps in `SurfaceConfig.Caps`. At a soft cap the router
**degrades gracefully** to the OpenStack fallback (or manual pin-drop for
autocomplete) — never a hard fail, never a key switch. Metrics: `GET /maps/usage`.

Additional production guards:

- **Per-user rate limit** on `/api/finance/maps/*` (`MAPS_RATE_LIMIT_PER_MIN`,
  default 120). Redis-backed (fixed window, holds across instances) when
  `REDIS_URL` is set, else in-memory; fails open on cache errors. Returns `429`
  with `X-RateLimit-*` headers.
- **Budget-alert delivery**: set `MAPS_BUDGET_ALERT_WEBHOOK` to POST 50/75/90%
  alerts (Slack-compatible JSON) instead of only logging.
- **Idempotency** on `POST /maps/locations`: send an `Idempotency-Key` header; a
  repeat within ~10 min is a no-op (`deduplicated: true`). The upsert is
  naturally idempotent, so the header is optional but recommended.

## Observability

`GET /api/finance/maps/metrics` exposes Prometheus text (dependency-free, no
client library): RED metrics per endpoint (`maps_http_requests_total`,
`maps_http_request_duration_seconds_{sum,count}`) plus `maps_cache_{hits,misses}_total`,
`maps_degradations_total{primitive}`, and the monthly
`maps_usage_month_count{provider,primitive}`. It's authenticated like the rest of
the proxy — scrape it with a service token:

```yaml
scrape_configs:
  - job_name: spotlight-maps
    metrics_path: /api/finance/maps/metrics
    bearer_token: <service-account-jwt>
    static_configs: [{ targets: ['api.internal:8080'] }]
```

For distributed tracing, wrap the provider HTTP client (`httpclient.go`) with
your OpenTelemetry transport.

## How to swap a provider

No code change. Either:

- **Per environment via `MAPS_CONFIG_PATH`** — point it at a JSON file that
  overlays `SurfaceConfig`. Example: move autocomplete back to OpenStack on
  checkout and raise the Places cap:

  ```json
  {
    "surfaces": { "checkout": { "autocomplete": "geoapify" } },
    "caps": { "google.places": 50000 }
  }
  ```

- **Or by env keys** — set/clear `MAPS_GEOAPIFY_KEY`, `MAPS_MAPTILER_KEY`,
  `MAPS_OSRM_BASE_URL`, `MAPS_GOOGLE_KEY`, `MAPS_MAPBOX_TOKEN`. A blank key
  registers a deterministic mock under that provider's name (dev/CI stay green).

To add a brand-new provider: implement the relevant small interface(s) in
`adapter.go` (e.g. `Geocoder`), register it in `buildRegistry`, and name it in
the config map. Nothing in feature code changes.

## Self-hosting OSRM (routing/matrix/map-match)

```bash
# One-time: build the Lagos / Nigeria graph from an OSM extract.
wget https://download.geofabrik.de/africa/nigeria-latest.osm.pbf -O nigeria.osm.pbf
docker run -t -v "$PWD:/data" osrm/osrm-backend osrm-extract -p /opt/car.lua /data/nigeria.osm.pbf
docker run -t -v "$PWD:/data" osrm/osrm-backend osrm-partition /data/nigeria.osrm
docker run -t -v "$PWD:/data" osrm/osrm-backend osrm-customize /data/nigeria.osrm
# Serve (MLD):
docker run -t -i -p 5000:5000 -v "$PWD:/data" osrm/osrm-backend osrm-routed --algorithm mld /data/nigeria.osrm
# then: MAPS_OSRM_BASE_URL=http://localhost:5000
```

Until OSRM is up, leave `MAPS_OSRM_BASE_URL` blank — the mock router keeps route/
matrix/tracking flows working (deterministic haversine).

## Enable

```
FEATURE_MAPS_ENABLED=true
DATABASE_URL=postgres://…        # PostGIS required (near-me + geofencing + cache)
```
Run migrations `20260626000000_enable_postgis.sql` and `20260626000100_maps_core.sql`.

## Tests

`maps_test.go` covers: cache hit/miss, the no-cache-Google guard, the
license-coherence guard, `findNearbyOwn` (PostGIS shape), distance-matrix routing,
cap→degradation fallback, Plus Code round-trip, and query normalization.

```
cd backend && go test ./internal/maps/...
```
