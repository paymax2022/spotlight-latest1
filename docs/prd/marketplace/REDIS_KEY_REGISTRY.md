# Marketplace Redis Key Registry

Reference doc for **Agent C** (owner of this file). Source of truth for behavior:
`docs/prd/marketplace/Paymax_Marketplace_CLAUDE_BUILD_CONTRACT.md` §5. Any agent
adding a new Marketplace Redis key must append a row here in the same PR —
this table is the single place to check for key collisions across the swarm.

All keys share the existing `backend/internal/platform/redis/` client
(Redis Cluster, 3 primary shards + 1 replica each, multi-AZ). Roles are
logically separated by key-prefix, not physically separated databases, so
that cross-role atomic operations (e.g. idempotency check + rate-limit check
in one Lua script) stay possible.

| Key pattern | Data type | TTL | Written by | Read by | Purpose |
|---|---|---|---|---|---|
| `srch:{market}:{hash}` | STRING (JSON) | 60s | search API | search API | Search results cache |
| `lst:{listing_id}` | STRING (JSON) | write-through, no TTL (invalidated on update) | listing update handler | listing detail API | Listing detail cache |
| `feed:{market}:{segment}` | STRING (JSON) | 120s | home feed job | home API | Home feed cache |
| `views:hll:{listing_id}` | HyperLogLog | 24h rolling | listing detail API (on view) | batch sync job (60s) | View counter, synced to Postgres (`mkt_listings.view_count`) |
| `ratelimit:listing-create:{user_id}` | STRING (counter) | 24h | listing create API | listing create API | Token-bucket rate limit |
| `ratelimit:first-msg:{user_id}` | STRING (counter) | 1h | chat API | chat API | Anti-spam throttle |
| `idem:{idempotency_key}` | STRING (JSON response) | 24h | all money-touching POST handlers (`/orders`, `/orders/:id/fund`, `/orders/:id/dispute`, `/boosts`) | same | Idempotency replay (24h dedupe window per house doctrine) |
| `priceband:{market}:{category_id}:{attrs_hash}` | HASH | 6h | nightly price-band job | price screen API, listing detail API | Fast fair-price lookup (backs `mkt_price_bands`) |
| `fraud:device:{device_fingerprint}` | SET (user_ids) | 30d | auth/session middleware | Trust & Fraud Desk (M3 / `marketplace-fraud-ops` role) | Ban-evasion device clustering |
| `chat:presence:{conversation_id}` | STRING (user_id + timestamp) | 60s | chat websocket handler | chat UI | Online/typing indicator |
| `pubsub:saved-search-match` | Pub/Sub channel (not a key) | n/a | ES indexer worker (on upsert) | notification dispatcher | Instant saved-search alert |

## Notes

- **Key namespace**: all Marketplace keys are unprefixed by module name in the
  pattern itself (`srch:`, `lst:`, `feed:`, `views:hll:`, `ratelimit:`,
  `idem:`, `priceband:`, `fraud:`, `chat:`, `pubsub:`) — these are scoped to
  the shared Redis Cluster used across Paymax modules. Before introducing a
  new prefix, grep the codebase for existing use of that prefix to avoid
  collisions with non-Marketplace modules (e.g. `idem:` is the same
  idempotency-cache convention used by other money-path modules such as
  Featured Placement and Connect Boosts — the 24h TTL and JSON-response-cache
  shape must match exactly so a single idempotency middleware can serve all
  modules).
- **Typed wrapper**: per §5/§10.5 of the build contract, Agent A should expose
  these as a typed client wrapper (`marketplace/cache/keys.go`) rather than
  scattering raw string key construction through business logic. This registry
  is the spec that wrapper must implement key-for-key.
- **`market_id`**: every market-scoped key includes `{market}` (e.g. `NG`) so
  a future multi-market rollout does not require a key-schema migration.
