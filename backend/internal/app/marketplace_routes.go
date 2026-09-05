package app

import (
	"context"
	"log"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/ledger"
	// referrals is retained ONLY for the RegisterMarketplace signature: router.go
	// still passes referralRewardsSvc, but the escrow settle/refund emit was removed
	// in the listings-and-connect pivot (ADR-023), so the param is now a no-op.
	"spotlight/backend/internal/finance/referrals"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/marketplace"
	"spotlight/backend/internal/marketplace/search"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/platform/r2"
	"spotlight/backend/internal/platform/realtime"
	"spotlight/backend/internal/services"
)

// searchAdapter bridges Agent A's type-erased marketplace.Searcher seam
// (Search(ctx, any) (any, error)) to Agent B's concrete *search.Client, which
// speaks Search(ctx, search.SearchRequest) (search.SearchResults, error).
//
// The two packages deliberately never share a type at compile time (no import
// cycle: marketplace never imports search). This adapter — the ONE place that
// imports both — decodes the provider-agnostic request map the handler builds
// (handler.go Search) into a search.SearchRequest, then returns the concrete
// results back through the `any` seam. On a nil/unknown request shape it still
// forwards an empty SearchRequest so the client degrades gracefully.
type searchAdapter struct{ c *search.Client }

func (a searchAdapter) Search(ctx context.Context, req any) (any, error) {
	sr := toSearchRequest(req)
	res, err := a.c.Search(ctx, sr)
	if err != nil {
		return nil, err
	}
	return res, nil
}

// toSearchRequest maps the handler's map[string]any (raw query params, values
// are strings) into a typed search.SearchRequest. Unparseable numeric params are
// simply omitted (treated as "no filter") rather than erroring the whole search.
func toSearchRequest(req any) search.SearchRequest {
	m, _ := req.(map[string]any)
	sr := search.SearchRequest{Market: marketplace.DefaultMarketID}
	if m == nil {
		return sr
	}
	getStr := func(k string) string {
		if v, ok := m[k]; ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
		return ""
	}
	getInt := func(k string) (int, bool) {
		if v, ok := m[k]; ok {
			switch n := v.(type) {
			case int:
				return n, true
			case int64:
				return int(n), true
			case float64:
				return int(n), true
			}
		}
		return 0, false
	}
	getKobo := func(k string) *int64 {
		s := getStr(k)
		if s == "" {
			return nil
		}
		if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			return &n
		}
		return nil
	}
	getFloat := func(k string) *float64 {
		s := getStr(k)
		if s == "" {
			return nil
		}
		if f, err := strconv.ParseFloat(s, 64); err == nil {
			return &f
		}
		return nil
	}

	sr.Q = getStr("q")
	sr.CategoryID = getStr("category_id")
	sr.Condition = getStr("condition")
	sr.State = getStr("state")
	sr.LGA = getStr("lga")
	sr.Sort = getStr("sort")
	sr.Cursor = getStr("cursor")
	sr.PriceMin = getKobo("price_min")
	sr.PriceMax = getKobo("price_max")
	sr.Lat = getFloat("lat")
	sr.Lng = getFloat("lng")
	sr.RadiusKm = getFloat("radius_km")
	if mkt := getStr("market_id"); mkt != "" {
		sr.Market = mkt
	}
	if lim, ok := getInt("limit"); ok {
		sr.Limit = lim
	}
	return sr
}

// commissionRecorderAdapter bridges marketplace's type-decoupled CommissionRecorder
// seam (RecordFor(...) error) to the finance commission service's RecordFor, which
// returns (*commission.Earning, error). This is the ONE place that imports both
// packages (no import cycle: commission never imports marketplace). The returned
// earning row is discarded — marketplace only needs the recording to succeed-or-log.
type commissionRecorderAdapter struct{ svc *commission.Service }

func (a commissionRecorderAdapter) RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
	sourceModule, sourceRef string, userID *string, idempotencyKey string) error {
	_, err := a.svc.RecordFor(ctx, category, service, subtype, grossKobo, sourceModule, sourceRef, userID, idempotencyKey)
	return err
}

// RecordExact bridges the exact-fee seam (RecordExact(...) error) used by the
// fixed-fee / spread modules (transfers, fx, jobs, association, savings) to the
// commission service's RecordExact, which returns (*commission.Earning, error). The
// caller passes its ACTUAL realized fee (recordedRevenueKobo) so recorded profit is
// exact, not config% × gross. The earning row is discarded — callers only need
// success-or-log. This is the SAME adapter as RecordFor: one struct satisfies every
// module's local CommissionRecorder interface (both methods).
func (a commissionRecorderAdapter) RecordExact(ctx context.Context, category, service, subtype string, grossKobo, recordedRevenueKobo int64,
	sourceModule, sourceRef string, userID *string, idempotencyKey string) error {
	_, err := a.svc.RecordExact(ctx, category, service, subtype, grossKobo, recordedRevenueKobo, sourceModule, sourceRef, userID, idempotencyKey)
	return err
}

// RegisterMarketplace wires the Paymax Marketplace module (§ integration contract).
// It mirrors RegisterPlacement: a member group (auth), an admin group (per-route
// RBAC guard "marketplace.admin.*"), and a PUBLIC webhook group (HMAC-verified, no
// Bearer). Base path: /v1/marketplace.
//
// The money path REUSES the finance ledger (ledger.AccountEscrow / AccountCommission
// / AccountProviderClearing) — the marketplace never stores a balance. The ledger
// service is constructed here from the shared pool + redis (the same primitives the
// finance orchestrator builds), so this registration is self-contained and callable
// from router.go with one feature-flag-guarded line.
//
// Agent B's *search.Client is injected post-construction via svc.SetSearcher(...) by
// app-wiring; until then GET /search returns 501 SEARCH_NOT_WIRED (never a compile
// error — marketplace defines a local Searcher interface and does NOT import search).
func RegisterMarketplace(
	r *gin.Engine,
	cfg config.Config,
	supabase *integrations.SupabaseRestClient,
	rbac services.RBACService,
	pool *pgxpool.Pool,
	redis *goredis.Client,
	referralRewards *referrals.RewardService,
) *marketplace.Service {
	if pool == nil {
		log.Println("[marketplace] nil pool — skipping marketplace routes")
		return nil
	}

	// Reuse the finance double-entry ledger (no second ledger).
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), redis)

	svc := marketplace.NewService(pool, ledgerSvc, redis)

	// ── Realtime (SSE) live-push seam for chat. The hub fans events across backend
	// instances via Redis pub/sub (in-process when redis is nil). Best-effort + nil-safe:
	// a missed push is caught by the clients' polling fallback. The SSE stream route is
	// registered below behind FEATURE_REALTIME_ENABLED.
	rtHub := realtime.NewHub(redis)
	svc.WithRealtime(rtHub)

	// ── Central Commission & Profit recording (§ profit registry) ──
	// When the commission feature is on, inject a nil-safe recorder so realized
	// marketplace profit (the boost purchase — the live revenue-capture point after
	// ADR-023 retired escrow settlement) lands in commission_earnings for the profit
	// report. The recorder is built WITHOUT a ledger (nil ledgerService) on purpose:
	// the boost charge already posts the money into ledger.AccountCommission, so a
	// second ledger post would double-count the commission revenue account. RecordFor
	// therefore appends the earning ROW only. Recording is best-effort and can never
	// fail or reverse a boost (see marketplace.recordCommissionSafe). Flag off ⇒ no
	// recorder is set ⇒ the seam stays nil ⇒ silent no-op.
	if cfg.FeatureCommissionEnabled {
		commissionSvc := commission.NewService(commission.NewRepository(pool), nil)
		svc.SetCommissionRecorder(commissionRecorderAdapter{svc: commissionSvc})
		log.Println("[marketplace] commission recording wired → Lifestyle/Marketplace (earning-row only; no ledger re-post)")
	}

	// referralRewards is intentionally unused: the escrow settle/refund referral emit
	// was removed in the listings-and-connect pivot (ADR-023) because the marketplace
	// no longer holds money or settles purchases — parties transact off-platform. The
	// param is KEPT so router.go (which passes referralRewardsSvc) still compiles
	// without an edit to a non-owned file. Discard it explicitly.
	_ = referralRewards

	// ── Search wiring (§ integration contract) ──
	// Inject Agent B's Elasticsearch read-model client via the type-erased
	// Searcher seam when an ES URL is configured. When ELASTICSEARCH_URL is empty
	// we leave the searcher nil, so GET /search returns 501 SEARCH_NOT_WIRED
	// (graceful) instead of blowing up — the rest of the marketplace still works.
	if cfg.ElasticsearchURL != "" {
		svc.SetSearcher(searchAdapter{c: search.NewClient(cfg.ElasticsearchURL)})
		log.Printf("[marketplace] search wired → %s", cfg.ElasticsearchURL)
	} else {
		log.Println("[marketplace] ELASTICSEARCH_URL unset — GET /search returns 501 until configured")
	}

	// R2 presigner for listing-photo uploads (Sell agent's Smart Composer). When R2
	// env is absent the presigner reports Configured()==false and POST
	// /listings/media/presign fails closed with 503 (never a fabricated URL) —
	// mirrors the estate/health/transport presign wiring.
	mktPresigner := r2.New(r2.Config{
		AccountEndpoint: cfg.R2AccountEndpoint,
		Bucket:          cfg.R2Bucket,
		AccessKeyID:     cfg.R2AccessKeyID,
		SecretAccessKey: cfg.R2SecretAccessKey,
		Region:          cfg.R2Region,
	})

	// The same presigner mints upload URLs (handler) and thumbnail read URLs
	// (service): listing photos live in a PRIVATE bucket, so a stored object key
	// only becomes fetchable once it is signed.
	svc.WithThumbPresigner(mktPresigner)

	h := marketplace.NewHandler(svc).
		WithWebhookSecret(cfg.PaymaxWebhookSecret).
		WithPresigner(mktPresigner, cfg.R2Bucket)

	auth := func() gin.HandlerFunc { return middleware.RequireAuthContext(supabase, rbac) }
	guard := func(permission string) gin.HandlerFunc { return middleware.RequirePermission(rbac, permission) }

	// ── Shared realtime SSE stream (marketplace chat is the first consumer). Mounted
	// at /api/v1/realtime/stream, authed, gated by FEATURE_REALTIME_ENABLED. The
	// mobile connects here (via the Next.js streaming proxy) and falls back to polling
	// when the flag is off or the stream drops.
	if cfg.FeatureRealtimeEnabled {
		rtGroup := r.Group("/api/v1/realtime")
		rtGroup.Use(auth())
		rtGroup.GET("/stream", rtHub.StreamHandler("user_id"))
		log.Println("[realtime] SSE stream registered at /api/v1/realtime/stream")
	}

	base := r.Group("/v1/marketplace")

	// ── Escrow webhooks REMOVED (ADR-023 listings-and-connect pivot) ──
	// The two inbound webhooks (POST /webhooks/logistics/delivery-confirmed and
	// POST /webhooks/payments/funding-confirmed) drove the escrow order FSM. With no
	// escrow orders they have no state to advance; both the routes and their handlers
	// (webhooks.go / webhook_handler.go) have been deleted.

	// ── Public read (listing detail, search, categories, seller profile) ──
	// Auth-optional reads: listing detail + search + categories + seller pages are
	// browsable without a Bearer (KYC tier0_browse). They still enforce OLA where a
	// write is implied.
	base.GET("/listings/:id", h.GetListing)
	base.GET("/search", h.Search)
	base.GET("/categories", h.Categories)
	base.GET("/categories/:id", h.GetCategory)
	base.GET("/sellers/:id/profile", h.SellerProfile)
	base.GET("/sellers/:id/listings", h.SellerListings)
	base.GET("/sellers/:id/reviews", h.SellerReviews)
	base.GET("/boosts/tiers", h.BoostTiers)
	base.GET("/boosts/quote", h.GetBoostQuote)

	// ── Member group (auth) ──
	m := base.Group("")
	m.Use(auth())

	// Listings
	m.POST("/listings", h.CreateListing)
	m.PUT("/listings/:id", h.UpdateListing)
	m.POST("/listings/:id/submit", h.SubmitListing)
	m.POST("/listings/:id/pause", h.PauseListing)
	m.POST("/listings/:id/resume", h.ResumeListing)
	m.POST("/listings/:id/mark-sold", h.MarkSoldListing)
	m.POST("/listings/:id/contact", h.RevealSellerContact)
	m.DELETE("/listings/:id", h.DeleteListing)

	// Offers
	m.GET("/offers", h.ListOffers) // ?listing_id= — negotiation history (participant-scoped)
	m.POST("/offers", h.CreateOffer)
	m.POST("/offers/:id/accept", h.AcceptOffer)
	m.POST("/offers/:id/counter", h.CounterOffer)
	m.POST("/offers/:id/decline", h.DeclineOffer)

	// ── Orders + Disputes REMOVED (ADR-023 listings-and-connect pivot) ──
	// The escrow order money-path (POST /orders, GET /orders, GET /orders/:id,
	// POST /orders/:id/{fund,accept,confirm-delivery,cancel,dispute}) and the dispute
	// endpoints (GET /disputes/:id, POST /disputes/:id/{evidence,appeal}) are
	// unregistered: the directory no longer holds funds or manages orders/disputes.
	// Parties connect and transact off-platform (Meetup Mode). The order/dispute
	// FSM code (service_order.go, service_dispute.go, fsm_order.go, fsm_dispute.go,
	// their handlers and the logistics/payments webhooks) has been deleted
	// (additive-only; mkt_orders/mkt_disputes tables are retained but unused).
	//
	// Reviews: SubmitReview was gated on OrderReleased (an escrow-completed order).
	// With no orders it has no valid completion signal, so POST /orders/:id/review is
	// left UNREGISTERED until a non-order "deal completed" signal is introduced
	// (ADR-023 §Reviews). Seller review READS (GET /sellers/:id/reviews) stay live so
	// pre-existing reviews remain visible.

	// Boosts
	m.POST("/boosts", h.CreateBoost)
	m.GET("/boosts/:id", h.GetBoost)

	// Messaging (ADR-023 listings-and-connect "connect" model; non-money metadata).
	// Persistent 1:1 buyer↔seller threads about a listing — replaces the mobile's
	// mock-only chat. Every route is participant-scoped in the service layer (a
	// non-participant gets THREAD_NOT_FOUND; no Idempotency-Key — messaging is metadata).
	m.POST("/threads", h.CreateThread)
	m.GET("/threads", h.ListThreads)
	m.GET("/threads/:id", h.GetThread)
	m.GET("/threads/:id/messages", h.ListThreadMessages)
	m.POST("/threads/:id/messages", h.SendThreadMessage)

	// Deal reviews (ADR-023: thread-keyed reviews behind the "mark met" signal;
	// non-money metadata). :id is the THREAD id. A participant marks the deal met,
	// after which EITHER participant may review the other once. Every route is
	// participant-scoped in the service (a non-participant gets THREAD_NOT_FOUND).
	m.POST("/deals/:id/mark-met", h.MarkDealMet)
	m.POST("/deals/:id/review", h.SubmitDealReview)
	m.GET("/deals/:id/review", h.GetDealReview)

	// Saved searches
	m.POST("/saved-searches", h.CreateSavedSearch)
	m.GET("/saved-searches", h.ListSavedSearches)
	m.DELETE("/saved-searches/:id", h.DeleteSavedSearch)
	m.PATCH("/saved-searches/:id", h.ToggleSavedSearch)

	// Verification
	m.POST("/verification/id", h.VerifyID)
	m.POST("/verification/business", h.VerifyBusiness)

	// ── Trust & Account gap endpoints (§28–34; non-money metadata) ──
	// Listing media presign (Sell agent's photo upload). NOTE: mounted at
	// /media/presign, NOT /listings/media/presign — Gin's radix router forbids a
	// static "media" segment alongside the existing /listings/:id param at the same
	// tree position (it would panic at registration). Functionally identical.
	m.POST("/media/presign", h.PresignMedia)
	// Saved items / wishlist (distinct from saved-searches above).
	m.POST("/listings/:id/save", h.SaveListing)
	m.DELETE("/listings/:id/save", h.UnsaveListing)
	m.GET("/saved-items", h.ListSavedItems)
	// Reports (always-accessible safety valve).
	m.POST("/reports", h.CreateReport)
	// Block / unblock users.
	m.POST("/blocks", h.CreateBlock)
	m.DELETE("/blocks/:id", h.DeleteBlock)
	m.GET("/blocks", h.ListBlocks)
	// Notification preferences (per-category toggles).
	m.GET("/notification-prefs", h.GetNotificationPrefs)
	m.PATCH("/notification-prefs", h.UpdateNotificationPrefs)
	// Meetup safe-spots (Transact agent's Meetup Mode).
	m.GET("/meetup/safe-spots", h.MeetupSafeSpots)
	// Followed sellers (§ Mobile-UX-Flows LD-005) — mkt_seller_follows.
	m.POST("/sellers/:id/follow", h.FollowSeller)
	m.DELETE("/sellers/:id/follow", h.UnfollowSeller)
	m.GET("/followed-sellers", h.ListFollowedSellers)

	// ── Admin group (auth + per-route RBAC guard) ──
	a := base.Group("/admin")
	a.Use(auth())
	// Slugs are the AUTHORITATIVE set seeded by
	// supabase/migrations/20260905000001_marketplace_rbac_perms.sql (module=marketplace):
	//   .moderation .approve .reject .dispute.review .dispute.decide .dispute.approve
	//   .flags.action .audit.read .orders.aging
	// Every guard() below MUST match a seeded permission slug verbatim (mirrors the
	// admin console + openapi.yaml); a mismatch fails-closed on all admin auth.
	a.GET("/moderation/queue", guard("marketplace.admin.moderation"), h.AdminModerationQueue)
	a.POST("/listings/:id/approve", guard("marketplace.admin.approve"), h.AdminApproveListing)
	a.POST("/listings/:id/reject", guard("marketplace.admin.reject"), h.AdminRejectListing)
	// Admin dispute queue/decide/approve + orders aging REMOVED (ADR-023): no orders
	// or disputes exist to moderate. Their handlers have been deleted; the seeded
	// dispute.*/orders.aging RBAC perms are now unused (additive-only, left in place).
	a.GET("/flags", guard("marketplace.admin.flags.action"), h.AdminFlags)
	a.POST("/flags/:id/action", guard("marketplace.admin.flags.action"), h.AdminActionFlag)
	a.GET("/audit-log", guard("marketplace.admin.audit.read"), h.AdminAuditLog)

	// Admin dashboard — live KPIs + synthesized activity feed (no dedicated
	// event log table has a writer; see the package note on AdminMetrics).
	// Read-scoped like the other dashboard-ish admin GETs above.
	a.GET("/metrics", guard("marketplace.admin.moderation"), h.AdminMetrics)
	a.GET("/activity-feed", guard("marketplace.admin.moderation"), h.AdminActivityFeed)

	// Boost moderation — the SOLE live marketplace money path (§2.4). GET lists boosts
	// platform-wide (read-scoped marketplace.admin.moderation); POST rejects+auto-refunds.
	a.GET("/boosts", guard("marketplace.admin.moderation"), h.AdminListBoosts)
	a.POST("/boosts/:id/reject", guard("marketplace.admin.reject"), h.AdminRejectBoost)

	// Boost pricing (ADM-002/MO-002) — admin-editable packages + the custom-range
	// ₦/day rate. Gated on marketplace.admin.pricing (seeded by
	// 20261028000400_marketplace_pricing_rbac_perm.sql, granted super-admin/system-admin).
	a.GET("/pricing/boosts", guard("marketplace.admin.pricing"), h.AdminListBoostPackages)
	a.PUT("/pricing/boosts", guard("marketplace.admin.pricing"), h.AdminUpsertBoostPackage)
	a.GET("/pricing/boosts/daily-rate", guard("marketplace.admin.pricing"), h.AdminGetBoostDailyRate)
	a.PUT("/pricing/boosts/daily-rate", guard("marketplace.admin.pricing"), h.AdminSetBoostDailyRate)

	log.Println("[marketplace] routes registered — listings/offers/boosts + trust/account + admin moderation + real-time audit (listings-and-connect; no escrow)")
	return svc
}
