# MARKETPLACE SWARM — INTEGRATION CONTRACT (read first, obey exactly)

This is the shared contract that lets 7 parallel agents converge. **Every name below is
frozen.** Do not rename types, functions, routes, columns, or files. If you need something
not defined here, add it *inside your own file-ownership boundary* and do not change another
agent's interface.

Source of truth for behavior: `docs/prd/marketplace/Paymax_Marketplace_CLAUDE_BUILD_CONTRACT.md`.
House doctrine that OVERRIDES the contract where they conflict: repo-root `CLAUDE.md`.

## Doctrine overrides (contract says X, we do Y)
- Router is **Gin v1.10**, NOT Chi. Go 1.23, module `spotlight/backend`.
- Module path is **`backend/internal/marketplace/`**, NOT `modules/marketplace/`.
- Migrations are **Supabase, additive-only**, in `supabase/migrations/` (timestamp prefix
  `YYYYMMDDHHMMSS_marketplace_*.sql`). No DROP / rename / type-narrowing.
- Money path uses the existing **double-entry ledger** in `backend/internal/finance/ledger`.
  There is ALREADY an `AccountEscrow` account type and `PostJournal` / `PostReversal` /
  `Debit` / `Credit` methods. The marketplace NEVER stores a balance; escrow moves are ledger
  postings. Reuse the ledger `Service`; do not build a second ledger.
- Base API path: `/v1/marketplace`. Auth: existing Gin `RequireAuthContext` sets
  `c.GetString("user_id")`. Admin routes use `guard("marketplace.admin.<perm>")` RBAC middleware
  (same pattern as `internal/app/placement_routes.go`).
- Feature flag: `FEATURE_MARKETPLACE_ENABLED` (off by default; no flag, no merge).
- All money in **kobo** (int64). `market_id TEXT` on every table (default `'NG'`).

## Reference implementation to copy
`backend/internal/app/placement_routes.go` + `backend/internal/finance/*` show the exact
house pattern: `Handler{svc}`, `NewHandler`, `NewService(pool, ...)`, member/admin/public
route groups, Idempotency-Key handling, RBAC `guard(...)`, audit logging. Mirror it.

---

## FROZEN Go INTERFACE (package `marketplace`, dir `backend/internal/marketplace/`)

Owned by **Agent A** (backend-core). Other agents import these names; A must ship them.

```go
package marketplace

// ---- enums mirror the SQL ENUMs exactly ----
type ListingStatus string  // draft,pending_review,active,paused,expired,sold,removed_policy,removed_user
type OrderStatus   string  // initiated,funded,seller_accepted,in_delivery,delivered,inspection_window,released,cancelled,disputed,refunded,split_settled
type DisputeStatus string  // opened,evidence_window,under_review,decided,executed,closed,appealed
type BoostStatus   string  // purchased,active,completed,rejected_with_reason,auto_refunded
type KYCTier       string  // tier0_browse,tier1_buy,tier2_sell,tier3_business

type Listing struct { ID, MarketID, SellerID, CategoryID string; Title, Description string; PriceKobo int64; Condition string; Attrs map[string]any; Status ListingStatus; QualityScore float64; EscrowEligible bool; State, LGA string; ViewCount, SaveCount int64; CreatedAt, UpdatedAt, ExpiresAt time.Time /* ... */ }
type Order   struct { ID, MarketID, ListingID, BuyerID, SellerID string; OfferID *string; AmountKobo, EscrowFeeKobo, DeliveryFeeKobo int64; Status OrderStatus; LedgerFundRef, LedgerReleaseRef, DeliveryRef *string; IdempotencyKey string; InspectionDeadline *time.Time /* ...timestamps */ }
type Dispute struct { ID, OrderID, OpenedBy, ReasonCode string; Status DisputeStatus; Decision, DecisionNotes *string; DecidedBy, SecondApproverID *string; RequiresDualApproval bool; EvidenceDeadline time.Time /* ... */ }
type Boost   struct { ID, ListingID, SellerID, Tier string; DurationDays int; PriceKobo int64; LedgerChargeRef string; Status BoostStatus; RejectionReasonCode, RefundRef *string; StartsAt, EndsAt *time.Time }
type OutboxRow struct { ID int64; ListingID, Op string; Payload json.RawMessage; ProcessedAt *time.Time; CreatedAt time.Time }

// Service is the single entry point. Constructed in internal/app.
type Service struct { /* pool *pgxpool.Pool; ledger *ledger.Service; redis *redis.Client; ... */ }
func NewService(pool *pgxpool.Pool, ledger *ledger.Service, rdb *redis.Client) *Service

// Escrow FSM (§2.2) — every method guarded, idempotent on money paths:
func (s *Service) CreateOrder(ctx, buyerID string, in CreateOrderInput) (*Order, error)
func (s *Service) FundOrder(ctx, orderID, buyerID, idemKey string, in FundInput) (*Order, error)
func (s *Service) SellerAccept(ctx, orderID, sellerID string) (*Order, error)
func (s *Service) ConfirmDelivery(ctx, orderID, buyerID string) (*Order, error)   // buyer release
func (s *Service) OpenDispute(ctx, orderID, actorID, idemKey string, in DisputeInput) (*Dispute, error)
func (s *Service) AutoReleaseDue(ctx) (int, error)                                  // cron: inspection_window past deadline
// Listing FSM (§2.1), Boost FSM (§2.4), Dispute FSM (§2.3): analogous guarded methods.
// Search read model is served by Agent B's package; A writes to mkt_listings_outbox only.

// OUTBOX CONTRACT (A writes, B reads): on any listing state change that affects search,
// A inserts into mkt_listings_outbox(listing_id, op, payload). op ∈ {"upsert","delete"}.
```

**Agent B** (search) is package `search` in `backend/internal/marketplace/search/`. It IMPORTS
`marketplace` and `ledger` if needed; **`marketplace` must NOT import `search`** (no cycle).
B exposes:
```go
package search
func NewIndexer(pool *pgxpool.Pool, esURL string) *Indexer
func (i *Indexer) RunOnce(ctx) (processed int, err error)   // drains mkt_listings_outbox
func BuildQuery(req SearchRequest) map[string]any            // function_score per §4 (boost_mode:sum)
type Client struct{ /* ES http */ }
func (c *Client) Search(ctx, req SearchRequest) (SearchResults, error)
```
A's `GET /search` handler calls into `search.Client`. To avoid a compile cycle, A defines a
tiny local interface `type Searcher interface{ Search(...) }` and app-wiring injects
`*search.Client`. B must match that method signature (documented here) exactly:
`Search(ctx context.Context, req search.SearchRequest) (search.SearchResults, error)`.
If unsure, A may temporarily return `501 search not wired` and app-wiring connects B later —
never leave a compile error.

---

## FROZEN HTTP ROUTES (Agent A registers; Agents D/E/F/mobile+admin consume)
Base `/v1/marketplace`. Member group (auth), admin group (`guard`), public group.

Member: `POST /listings`, `GET /listings/:id`, `PUT /listings/:id`, `POST /listings/:id/submit`,
`GET /search`, `GET /categories`, `GET /categories/:id`,
`POST /offers`, `POST /offers/:id/accept`, `POST /offers/:id/counter`, `POST /offers/:id/decline`,
`POST /orders` (Idem-Key), `GET /orders/:id`, `GET /orders`, `POST /orders/:id/fund` (Idem-Key),
`POST /orders/:id/accept`, `POST /orders/:id/confirm-delivery`, `POST /orders/:id/cancel`,
`POST /orders/:id/dispute` (Idem-Key), `POST /orders/:id/review`,
`GET /disputes/:id`, `POST /disputes/:id/evidence`, `POST /disputes/:id/appeal`,
`GET /boosts/tiers`, `POST /boosts` (Idem-Key), `GET /boosts/:id`,
`POST /saved-searches`, `GET /saved-searches`, `DELETE /saved-searches/:id`, `PATCH /saved-searches/:id`,
`GET /sellers/:id/profile`, `GET /sellers/:id/listings`, `GET /sellers/:id/reviews`,
`POST /verification/id`, `POST /verification/business`.
Admin (`/v1/marketplace/admin`, each mutating route requires `reason_code` in body + writes
`mkt_admin_audit_log`): `GET /moderation/queue`, `POST /listings/:id/approve`,
`POST /listings/:id/reject`, `GET /disputes/queue`, `GET /disputes/:id`,
`POST /disputes/:id/decide` (dual-approval if amount>₦500k), `POST /disputes/:id/approve`,
`GET /flags`, `POST /flags/:id/action`, `GET /audit-log`, `GET /orders/aging`.
Webhooks (public, HMAC): `POST /webhooks/logistics/delivery-confirmed`,
`POST /webhooks/payments/funding-confirmed`.

Error shape (all endpoints): `{"error":{"code","message","field","request_id"}}`. Codes per §3.

## FROZEN mobile/admin API base
Mobile & admin call the routes above. Mobile persists a client-generated `Idempotency-Key`
for fund/order/boost/dispute so an app-kill retry reuses it. Admin sends `reason_code` on every
mutating action and renders the dual-approval state for disputes > ₦500k.

## FILE OWNERSHIP (do not write outside your boundary)
- A: `backend/internal/marketplace/*.go` (excl. `search/`) + `backend/internal/app/marketplace_routes.go` + ONE call-line in `backend/internal/app/router.go` + `FEATURE_MARKETPLACE_ENABLED` in `backend/internal/config/`.
- B: `backend/internal/marketplace/search/*.go` + `backend/cmd/marketplace-indexer/main.go` + `backend/cmd/marketplace-cron/main.go`.
- C: `supabase/migrations/*marketplace*.sql` + `contracts/openapi.yaml` (marketplace section, append only) + `backend/internal/marketplace/search/es-mapping.json` + `docs/prd/marketplace/REDIS_KEY_REGISTRY.md`.
- D: `mobile-app/reactnative/app/marketplace/**` + `mobile-app/reactnative/lib/marketplaceApi.ts` (or matching existing lib convention).
- E: `frontend-admin/app/admin/marketplace/**` + admin api client under existing admin lib.
- F: `backend/tests/marketplace/**` + `tools/loadtest/marketplace/*.js`.
- G: `docker-compose.yml` (append ES service), `.env.example`/env docs, `Makefile` targets, `docs/prd/marketplace/RUNBOOK.md`.

Only Agent C creates the `search/es-mapping.json` file; Agent B creates all `.go` files in `search/`.
```
