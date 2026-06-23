# MapService — Initiative Hand-off & Go-Live Runbook

Provider-agnostic Maps abstraction for the Spotlight × Paymax super app. One
interface, pluggable adapters, config-driven provider selection per
environment/surface. Default to a low-cost OpenStack stack; use Google only where
its data quality is worth it.

**Status:** Code-complete and statically verified. Not yet compiled/tested in CI
from this work (the authoring environment had no Go toolchain). The `maps-ci.yml`
`backend` + `integration` jobs are the first real gate — run them before relying
on this.

---

## 1. What was built

| Area | Summary |
|------|---------|
| Core | `MapService` interface + config-driven router (`backend/internal/maps`) |
| Adapters | Geoapify (geocode/reverse/autocomplete), MapTiler (basemap), OSRM (route/matrix/match), Google (autocomplete + POI only), Mapbox (optional), deterministic mock |
| License coherence | Google results never cached, never drawn on the OSM basemap; runtime + cache guards |
| Cost guard | `map_usage` counts, 50/75/90% alerts, soft-cap → graceful degradation, per-user rate limit, idempotency |
| PostGIS | `merchant_locations`, `service_areas`, `geocode_cache`, `map_usage`; near-me + geofencing run on PostGIS, never a maps API |
| Module sync | restaurant/estate auto-geocode on write; realtor/restaurant/estate coords sync into `merchant_locations` via trigger |
| Transport | dispatch bridged onto MapService; real-time trip tracking over WebSocket |
| Frontend | Web + React Native `MapView` / `AddressEntry` / `LiveTrackingMap` (+ `LiveTripMap`), near-me demo screen |
| Ops | OSRM self-host deployment, Prometheus metrics, CI workflow |

---

## 2. Architecture

- **One interface.** All features call `MapService` (`backend/internal/maps/types.go`).
  It is a router: each primitive is dispatched to the provider named by
  `SurfaceConfig` (`config.go`), a `{primitive → provider}` map per surface.
  Swapping a provider is a config edit, never a code change.
- **Adapters** are small per-primitive interfaces (`adapter.go`): a provider
  implements only what it serves and is referenced by `Name()`.
- **Keys are server-side only.** Clients call `/api/finance/maps/*`; the backend
  proxies to providers. No provider key ships in web or mobile.
- **License coherence** (`guards.go`): every result carries a `Source`. The cache
  writer refuses non-OSM rows; `AssertRenderable` throws if a Google point would
  render on the OpenStack basemap. The renderers mirror this client-side.
- **Caching:** only OSM geocode/reverse results are cached, in PostGIS
  `geocode_cache` keyed by normalized address with a TTL.
- **Near-me + geofencing:** PostGIS `ST_DWithin` / `ST_Contains` on
  `merchant_locations` / `service_areas` — never a maps API.

Decision record: `docs/adr/ADR-007-maps-abstraction.md`.

---

## 3. File map

```
backend/internal/maps/
  types.go            MapService interface + domain types + Source/Primitive
  adapter.go          per-primitive provider interfaces + Registry
  config.go           SurfaceConfig {primitive→provider}, caps, fallback
  service_impl.go     the config-driven router (Service) + idempotency
  pluscode.go         Open Location Code encode/decode
  cache.go            PostGIS geocode cache (OSM-only) + NormalizeQuery
  geo_repo.go         PostGIS NearbyOwn / InZone / UpsertLocation
  usage.go            map_usage counters + 50/75/90% alerts + caps
  guards.go           license-coherence guards
  ratelimit.go        per-user rate limit (Redis or in-memory)
  alerts.go           budget-alert webhook
  metrics.go          Prometheus text registry + RED middleware
  location_geocoder.go  address→pin adapter for restaurant/estate
  provider_*.go       geoapify / maptiler / osrm / google / mock
  handler.go, routes.go  HTTP proxy + Mount/Register
  httpclient.go       shared provider HTTP client (key redaction)
  maps_test.go        unit tests (no DB)
  integration_test.go PostGIS integration tests (build tag `integration`)
  README.md           operator guide (config, license rules, swap, metrics)

backend/internal/transport/
  maps_bridge.go      MapService → transport MapsAdapter (dispatch)
  ws_tracking.go      real-time TripTracker (GPS → snap → fan-out)

supabase/migrations/
  20260626000000_enable_postgis.sql
  20260626000100_maps_core.sql
  20260626000200_merchant_locations_sync.sql

contracts/openapi.yaml         tag [Maps] + [Mobility] track endpoint
infra/osrm/                    OSRM deploy (compose, graph build/refresh, systemd, health)
.github/workflows/maps-ci.yml  build/vet/test + Supabase integration + typechecks + guards

frontend-web/src/
  services/mapsClient.ts
  components/map/{MapView,AddressEntry,LiveTrackingMap}.tsx

mobile-app/reactnative/src/features/mobility/
  api/{maps.api,tracking.api}.ts
  hooks/{useNearby,useTripTracking}.ts
  components/{MapView,AddressEntry,LiveTrackingMap,LiveTripMap}.tsx
  screens/NearbyMerchantsScreen.tsx
app/maps/                     expo-router route for the demo screen
```

---

## 4. API surface (`/api/finance/maps`, authenticated)

`GET /basemap` · `POST /geocode` · `POST /reverse` · `POST /autocomplete` ·
`POST /places` · `POST /route` · `POST /matrix` · `POST /match` · `POST /nearby` ·
`POST /in-zone` · `POST /locations` (idempotent) · `GET /usage` · `GET /metrics`.

Real-time: `GET /api/finance/mobility/ws` (rider/driver subscribe) ·
`POST /api/finance/mobility/trips/{id}/track` (driver GPS, driver-only).

---

## 5. Configuration (env)

```
FEATURE_MAPS_ENABLED=false            # master switch
MAPS_CONFIG_PATH=                     # optional {primitive→provider} override JSON
MAPS_DEFAULT_SURFACE=default
MAPS_GEOAPIFY_KEY=                    # OSM geocode/reverse/autocomplete (cacheable)
MAPS_MAPTILER_KEY=                    # basemap tiles
MAPS_OSRM_BASE_URL=                   # self-hosted OSRM, e.g. http://osrm:5000
MAPS_TILE_STYLE_URL=                  # optional explicit MapLibre style
MAPS_GOOGLE_KEY=                      # autocomplete + POI ONLY; never cached
MAPS_MAPBOX_TOKEN=                    # optional
MAPS_RATE_LIMIT_PER_MIN=120           # per-user cap on the proxy
MAPS_BUDGET_ALERT_WEBHOOK=            # 50/75/90% alerts; "" = log only
```
Web: `NEXT_PUBLIC_MAPS_BASE_URL` (derived from API base if unset).
Mobile: `EXPO_PUBLIC_MAPS_BASE_URL`.

Blank provider keys register a deterministic mock under that provider's name, so
dev/CI stay functional. **Single legitimate key per provider — never rotate
keys/accounts to dodge free-tier limits.**

---

## 6. Go-live checklist

1. **Green CI.** Push and confirm `maps-ci.yml` passes — especially `backend`
   (build/vet/test) and `integration` (Supabase + PostGIS). This is the first
   real compile/test of the whole initiative. Fix anything red before proceeding.
2. **Migrations.** Apply `20260626000000/000100/000200` to the live Supabase
   (`supabase db push`). Confirm the `postgis` extension is allowed and the
   triggers create cleanly.
3. **OSRM.** Stand up `infra/osrm` (build the Nigeria graph, `docker compose up`),
   bind to a private network, enable the weekly refresh timer. Set
   `MAPS_OSRM_BASE_URL`.
4. **Provider keys + caps.** Put Geoapify, MapTiler, Google keys in the secrets
   manager (server-side only). Set per-SKU caps in `SurfaceConfig.Caps` to your
   budget. Set `MAPS_BUDGET_ALERT_WEBHOOK`.
5. **Cost/abuse.** Confirm `MAPS_RATE_LIMIT_PER_MIN`, ensure `REDIS_URL` is set so
   the limiter + idempotency are cross-instance.
6. **Observability.** Point Prometheus at `/api/finance/maps/metrics` with a
   service token. Alert on error rate, p95 latency, `maps_degradations_total`,
   and `maps_usage_month_count` vs caps.
7. **Security review.** Run `security-reviewer` over the auth + key-handling paths
   and the WS handshake.
8. **Flip the flag.** Set `FEATURE_MAPS_ENABLED=true`. Verify a real geocode is
   cached (PostGIS), a Google autocomplete is not, and `/nearby` returns synced
   restaurant/estate/realtor records.

---

## 7. Known caveats / follow-ups

- **Not yet compiled in CI from this work.** All Go/TS was static-verified
  (brace/paren balance, signature matching, no import cycles, OpenAPI/JSON parse).
  Treat the first CI run as the gate.
- **Driver GPS ingest is HTTP, egress is WS.** The shared `ws.Hub` ignores inbound
  frames; bidirectional WS ingest is a future hub enhancement, not a rewrite.
- **Metrics/tracing are dependency-free.** Swap in the Prometheus client / OTel
  SDK later with no scraper change.
- **Restaurant/estate geocoding is best-effort on write.** A geocode failure never
  blocks creation; the pin can be set via `AddressEntry` → `/locations`.
- **Optional next:** bidirectional WS ingest, a web `LiveTripMap`, and pushing
  other modules' "near me" (drivers, events) through `FindNearbyOwn`.

---

## 8. How to swap or add a provider

Per environment via `MAPS_CONFIG_PATH` (JSON overlay of `SurfaceConfig`), or by
setting/clearing the provider key env vars. To add a new provider: implement the
relevant small interface(s) in `adapter.go`, register it in `buildRegistry`, name
it in the config map. Feature code does not change. See `backend/internal/maps/README.md`.
