package app

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/integrations/llm"
	"spotlight/backend/internal/integrations/rtc"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/onboarding"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/finance/fx"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/transfers"
	"spotlight/backend/internal/finance/va"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/crowdfunding"
	"spotlight/backend/internal/doctor"
	"spotlight/backend/internal/estate"
	"spotlight/backend/internal/pharmacy"
	"spotlight/backend/internal/restaurant"
	"spotlight/backend/internal/telemedicine"
	"spotlight/backend/internal/aicare"
	"spotlight/backend/internal/transport"
	"spotlight/backend/internal/votebridge"
	"spotlight/backend/internal/events"
	"spotlight/backend/internal/finance/disputes"
	"spotlight/backend/internal/finance/ratings"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/association"
	"spotlight/backend/internal/groups"
	"spotlight/backend/internal/invest"
	"spotlight/backend/internal/maps"
	"spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/orchestration/adapters"
	platformDB "spotlight/backend/internal/platform/db"
	"spotlight/backend/internal/platform/r2"
	platformRedis "spotlight/backend/internal/platform/redis"
	platformWS "spotlight/backend/internal/platform/ws"
	providerInterfaces "spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/eversend"
	"spotlight/backend/internal/provider/maplerad"
	"spotlight/backend/internal/provider/paystack"
	"spotlight/backend/internal/webhooks"
)

// registerFinanceRoutes wires up all financial module routes under /api/finance/...
// Each route group is gated behind its feature flag.
// If DATABASE_URL is not set, financial routes are skipped entirely.
func registerFinanceRoutes(r *gin.Engine, cfg config.Config, supabase *integrations.SupabaseRestClient, rbac services.RBACService) {
	if cfg.DatabaseURL == "" {
		log.Println("[finance] DATABASE_URL not set — skipping financial routes")
		return
	}

	ctx := context.Background()

	// --- Platform primitives ---
	pool, err := platformDB.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Printf("[finance] WARN: could not connect to database: %v — financial routes disabled", err)
		return
	}

	var redisClient *platformRedis.Client
	if cfg.RedisURL != "" {
		rc, err := platformRedis.New(cfg.RedisURL)
		if err != nil {
			log.Printf("[finance] WARN: could not connect to Redis: %v — idempotency cache disabled", err)
		} else {
			redisClient = rc
		}
	}

	// --- MapService (built early so transport dispatch can consume it) ---
	// One interface, config-driven adapters; provider keys are server-side here.
	mapsAuth := func() gin.HandlerFunc {
		base := middleware.RequireAuthContext(supabase, rbac)
		return func(c *gin.Context) {
			base(c)
			if c.IsAborted() {
				return
			}
			if au, ok := middleware.GetAuthenticatedUser(c); ok {
				c.Set("user_id", au.ID)
			}
			c.Next()
		}
	}
	var mapSvc *maps.Service
	if cfg.FeatureMapsEnabled {
		ms, err := maps.NewServiceFromDeps(maps.RouteDeps{
			DB:             pool,
			Enabled:        true,
			ConfigPath:     cfg.MapsConfigPath,
			DefaultSurface: cfg.MapsDefaultSurface,
			GeoapifyKey:    cfg.MapsGeoapifyKey,
			MapTilerKey:    cfg.MapsMapTilerKey,
			OSRMBaseURL:    cfg.MapsOSRMBaseURL,
			TileStyleURL:   cfg.MapsTileStyleURL,
			GoogleKey:      cfg.MapsGoogleKey,
			MapboxToken:    cfg.MapsMapboxToken,
			Redis:          redisClient,
			AlertWebhook:   cfg.MapsBudgetAlertWebhook,
			RateLimitPerMin: cfg.MapsRateLimitPerMin,
		})
		if err != nil {
			log.Printf("[maps] config error: %v — maps disabled", err)
		} else {
			mapSvc = ms
		}
	}

	// --- Finance services ---
	ledgerRepo := ledger.NewRepository(pool)
	ledgerSvc := ledger.NewService(ledgerRepo, redisClient)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)
	kycSvc := kyc.NewService(pool)
	referralSvc := referrals.NewService(pool, ledgerSvc)

	// --- Providers ---
	var paymentProvider providerInterfaces.PaymentProvider
	var vaProvider providerInterfaces.VirtualAccountProvider

	if cfg.PaystackSecretKey != "" {
		ps := paystack.New(cfg.PaystackSecretKey)
		paymentProvider = ps
		vaProvider = ps
	}

	// Maplerad overrides VA provider when its key is set (preferred for NGN DVAs + FX).
	maplerадKey := cfg.MapleradSecretKey
	var maplerадClient *maplerad.Client
	if maplerадKey != "" {
		maplerадClient = maplerad.New(maplerадKey, cfg.MapleradProd)
		vaProvider = maplerадClient
		paymentProvider = maplerадClient // use Maplerad as payment provider too when available
	}

	xferSvc := transfers.NewService(pool, ledgerSvc, tiersSvc, paymentProvider)

	// --- Module services ---
	vaSvc := va.NewService(pool, ledgerSvc, vaProvider)
	vaHandler := va.NewHandler(vaSvc)

	var fxHandler *fx.Handler
	if maplerадClient != nil {
		fxSvc := fx.NewService(pool, ledgerSvc, maplerадClient, redisClient)
		fxHandler = fx.NewHandler(fxSvc)
	}

	// Webhook handler (needs paymentProvider for signature verification).
	var webhookHandler *webhooks.PaystackHandler
	if paymentProvider != nil {
		webhookHandler = webhooks.NewPaystackHandler(paymentProvider, vaSvc, xferSvc, walletSvc)
	}

	// --- Handlers ---
	walletHandler := wallet.NewHandler(walletSvc)
	kycHandler := kyc.NewHandler(kycSvc)
	referralHandler := referrals.NewHandler(referralSvc)
	// Transfers handler is flag-aware: each route family returns 503 when its
	// go-live flag is off (FEATURE_WALLET_TRANSFERS_ENABLED / FEATURE_BANK_TRANSFERS_ENABLED).
	transfersHandler := transfers.NewHandler(xferSvc, cfg.FeatureWalletTransfersEnabled, cfg.FeatureBankTransfersEnabled)

	// Base finance group — all routes require auth (user_id set by RequireAuthContext middleware).
	finance := r.Group("/api/finance")
	finance.Use(requireUserID())

	// --- Transfer routes (wallet-to-wallet + wallet-to-bank) ---
	// Routes are always mounted; the handler returns 503 per family when the
	// corresponding go-live flag is off (gate: flag=false → 503). All money
	// mutations require an Idempotency-Key, post balanced ledger entries, and
	// enforce tier limits fail-closed inside the service.
	transferGroup := finance.Group("/transfers")
	transferGroup.GET("/paymax/resolve", transfersHandler.ResolvePaymax)
	transferGroup.POST("/paymax", transfersHandler.InitiatePaymax)
	transferGroup.POST("/bank", transfersHandler.InitiateBank)

	// --- KYC routes ---
	if cfg.FeatureKYCEnabled {
		kycGroup := finance.Group("/kyc")
		kycGroup.GET("/me", kycHandler.GetMe)
		kycGroup.POST("/initiate", kycHandler.Initiate)
	}

	// --- Wallet routes ---
	if cfg.FeatureWalletEnabled {
		walletGroup := finance.Group("/wallet")
		walletGroup.GET("/balance", walletHandler.GetBalance)
		walletGroup.GET("/transactions", walletHandler.ListTransactions)
	}

	// --- Virtual account routes ---
	if cfg.FeatureVirtualAccountsEnabled {
		vaGroup := finance.Group("/va")
		vaGroup.GET("/me", vaHandler.GetMe)
	}

	// --- Referral routes ---
	if cfg.FeatureReferralsEnabled {
		refGroup := finance.Group("/referrals")
		refGroup.GET("/me", referralHandler.GetMe)
	}

	// --- FX routes (legacy single-provider wallet FX) ---
	if cfg.FeatureFXEnabled && fxHandler != nil {
		fxGroup := finance.Group("/fx")
		fxGroup.POST("/quote", fxHandler.GetQuote)
		fxGroup.POST("/convert", fxHandler.Convert)
		fxGroup.GET("/history", fxHandler.ListHistory)
		fxGroup.GET("/wallets/:currency", fxHandler.GetWallet)
	}

	// --- FX Orchestration (normalized, provider-agnostic /v1 API) ---
	// Smart order routing across Eversend + Maplerad, spread engine, treasury,
	// unified multi-currency ledger, quote->lock->execute with idempotency.
	if cfg.FeatureFXOrchestrationEnabled {
		orchStore := orchestration.NewSQLStore(pool)

		// Maplerad: live HTTP adapter when a secret key is configured, else the
		// deterministic adapter (keeps the corridor routable in dev/CI).
		var mplProvider orchestration.Provider
		if cfg.MapleradSecretKey != "" {
			mplProvider = adapters.NewMapleradLive(
				maplerad.New(cfg.MapleradSecretKey, cfg.MapleradProd),
				cfg.MapleradWebhookSecret, cfg.MapleradProd,
			)
			log.Println("[finance] FX orchestration: Maplerad LIVE adapter enabled")
		} else {
			mplProvider = adapters.NewMapleradFX(cfg.MapleradProd)
		}
		// Eversend: live HTTP adapter when client credentials are configured.
		var evsProvider orchestration.Provider
		if cfg.EversendClientID != "" && cfg.EversendClientSecret != "" {
			evsProvider = adapters.NewEversendLive(
				eversend.New(cfg.EversendClientID, cfg.EversendClientSecret, cfg.EversendProd),
				cfg.EversendWebhookSecret, cfg.EversendProd,
			)
			log.Println("[finance] FX orchestration: Eversend LIVE adapter enabled")
		} else {
			evsProvider = adapters.NewEversend(cfg.EversendProd)
		}
		providers := []orchestration.Provider{
			evsProvider,
			mplProvider,
		}
		spreadEngine := orchestration.NewSpreadEngine(105,
			orchestration.SpreadRule{Corridor: "USD-NGN", Tier: "business", BPS: 75, MinBPS: 50, MaxBPS: 150},
			orchestration.SpreadRule{Corridor: "USD-NGN", BPS: 120, MinBPS: 80, MaxBPS: 200},
			orchestration.SpreadRule{Corridor: "USD-XAF", BPS: 150, MinBPS: 100, MaxBPS: 250},
		)
		treasury := orchestration.NewTreasury([]orchestration.FloatBucket{
			{Provider: "eversend", Currency: "USD", BalanceMinor: 820_000_00, LowWaterMinor: 200_000_00, HighWaterMinor: 1_000_000_00, ExposureLimitMinor: 5_000_000_00},
			{Provider: "eversend", Currency: "NGN", BalanceMinor: 1_800_000_000_00, LowWaterMinor: 250_000_000_00, HighWaterMinor: 9_000_000_000_00, ExposureLimitMinor: 50_000_000_000_00},
			{Provider: "maplerad", Currency: "NGN", BalanceMinor: 2_400_000_000_00, LowWaterMinor: 250_000_000_00, HighWaterMinor: 9_000_000_000_00, ExposureLimitMinor: 50_000_000_000_00},
			{Provider: "maplerad", Currency: "USD", BalanceMinor: 600_000_00, LowWaterMinor: 150_000_00, HighWaterMinor: 800_000_00, ExposureLimitMinor: 4_000_000_00},
			{Provider: "maplerad", Currency: "XAF", BalanceMinor: 420_000_000_00, LowWaterMinor: 100_000_000_00, HighWaterMinor: 500_000_000_00, ExposureLimitMinor: 5_000_000_000_00},
		})
		// Quote lifecycle: Redis-backed when available (multi-instance safe),
		// else in-memory.
		var quoteStore orchestration.QuoteStore
		if redisClient != nil {
			quoteStore = orchestration.NewRedisQuoteBook(redisClient, 90*time.Second)
		}

		orchSvc := orchestration.NewService(providers, orchStore, orchestration.Options{
			Spread: spreadEngine, Treasury: treasury, QuoteStore: quoteStore, LockWindow: 90 * time.Second,
		})
		// Outbound webhooks (signed) to the caller endpoint, when configured.
		orchSvc.SetEmitter(orchestration.NewWebhookEmitter(cfg.PaymaxWebhookOutURL, cfg.PaymaxWebhookSecret))
		// Automated treasury rebalancing + balance.low alerts.
		orchestration.StartTreasuryMonitor(ctx, orchSvc, time.Minute)
		// Daily reconciliation (ledger-derived source until a provider settlement
		// feed is wired). Emits recon.completed per provider.
		orchestration.StartReconScheduler(ctx, orchSvc, orchestration.NewLedgerSettlementSource(orchStore), 24*time.Hour)

		orchHandler := orchestration.NewHandler(orchSvc)

		og := r.Group("/api/v1/fx")
		og.Use(requireUserID())
		og.POST("/quotes", orchHandler.CreateQuote)
		og.POST("/quotes/:id/lock", orchHandler.LockQuote)
		og.POST("/conversions", orchHandler.CreateConversion)
		og.POST("/transfers", orchHandler.CreateTransfer)
		og.POST("/collections/virtual-accounts", orchHandler.CreateCollection)
		og.GET("/rates", orchHandler.GetRates)
		og.GET("/balances", orchHandler.GetBalances)
		og.GET("/transactions", orchHandler.ListTransactions)
		og.GET("/transactions/:id", orchHandler.GetTransaction)
		// Inbound provider webhooks (no auth; provider-signed).
		r.POST("/api/v1/fx/webhooks/:provider", orchHandler.InboundWebhook)
		log.Println("[finance] FX orchestration routes registered at /api/v1/fx")
	}

	// --- Webhook routes (no auth — Paystack calls these directly) ---
	if webhookHandler != nil {
		r.POST("/api/webhooks/paystack/go", webhookHandler.Handle)
	}

	// --- Groups routes ---
	if cfg.FeatureGroupsEnabled {
		groupsSvc := groups.NewService(pool, ledgerSvc)
		groupsHandler := groups.NewHandler(groupsSvc)
		grp := finance.Group("/groups")
		grp.POST("", groupsHandler.Create)
		grp.GET("", groupsHandler.List)
		grp.GET("/:id", groupsHandler.Get)
		grp.POST("/:id/invite", groupsHandler.Invite)
		grp.POST("/:id/dues", groupsHandler.PayDues)
	}

	// --- Association (group membership) money-path + approvals ---
	if cfg.FeatureAssociationsEnabled {
		assocSvc := association.NewService(pool, ledgerSvc)
		assocHandler := association.NewHandler(assocSvc)
		association.RegisterRoutes(finance.Group("/associations"), assocHandler)
	}

	// --- Events routes ---
	if cfg.FeatureEventsEnabled {
		settlementSvc := settlement.NewService(pool, ledgerSvc)
		eventsSvc := events.NewService(pool, ledgerSvc, settlementSvc)
		eventsHandler := events.NewHandler(eventsSvc)
		evGroup := finance.Group("/events")
		evGroup.POST("", eventsHandler.Create)
		evGroup.GET("/:id", eventsHandler.Get)
		evGroup.POST("/:id/publish", eventsHandler.Publish)
		evGroup.POST("/:id/tickets", eventsHandler.PurchaseTicket)
		evGroup.POST("/:id/scan", eventsHandler.ScanTicket)
		evGroup.GET("/my/tickets", eventsHandler.MyTickets)
	}

	// --- Estate routes ---
	if cfg.FeatureEstateEnabled {
		estateSvc := estate.NewService(pool, redisClient).
			WithLedger(ledgerSvc). // Block 29 dues money path: balanced double-entry
			WithTiers(tiersSvc)    // fail-closed tier-limit check on wallet debit
		if mapSvc != nil {
			estateSvc = estateSvc.WithGeocoder(maps.NewLocationGeocoder(mapSvc))
		}
		estateHandler := estate.NewHandler(estateSvc)
		estGroup := finance.Group("/estate")

		// Core (Block 16/23)
		estGroup.GET("", estateHandler.ListEstates)
		estGroup.POST("", estateHandler.CreateEstate)
		estGroup.POST("/:id/residents", estateHandler.AddResident)
		estGroup.POST("/:id/passes", estateHandler.IssuePass)
		estGroup.POST("/:id/passes/scan", estateHandler.ScanPass)
		estGroup.POST("/:id/elections", estateHandler.CreateElection)
		estGroup.POST("/:id/elections/:electionId/vote", estateHandler.CastVote)
		estGroup.GET("/:id/elections/:electionId/results", estateHandler.GetResults)

		// Block 24: Onboarding & property selection
		estGroup.POST("/:id/invite-codes", estateHandler.GenerateInviteCode)
		estGroup.POST("/join/invite", estateHandler.JoinWithInviteCode)
		estGroup.POST("/:id/access-request", estateHandler.RequestAccess)
		estGroup.GET("/:id/access-request/me", estateHandler.GetMyJoinRequest)
		estGroup.GET("/:id/access-requests", estateHandler.ListJoinRequests)
		estGroup.POST("/:id/access-requests/:reqId/review", estateHandler.ReviewJoinRequest)
		estGroup.GET("/:id/properties", estateHandler.ListProperties)
		estGroup.POST("/:id/properties", estateHandler.AddProperty)
		estGroup.POST("/:id/properties/:pid/claim", estateHandler.ClaimOwnership)
		estGroup.POST("/:id/properties/:pid/claims/:claimId/review", estateHandler.ReviewOwnershipClaim)
		estGroup.POST("/:id/properties/:pid/tenancy", estateHandler.CreateTenancyRequest)
		estGroup.POST("/:id/properties/:pid/tenancy/:tid/review", estateHandler.ReviewTenancyRequest)

		// Block 28: Guard app
		estGroup.GET("/:id/gates", estateHandler.ListGates)
		estGroup.GET("/:id/guard/expected-visitors", estateHandler.GetExpectedVisitors)
		estGroup.GET("/:id/guard/lookup", estateHandler.LookupCode)
		estGroup.POST("/:id/guard/checkin", estateHandler.GuardCheckin)
		estGroup.POST("/:id/guard/checkout", estateHandler.GuardCheckout)
		estGroup.POST("/:id/guard/incident", estateHandler.SubmitIncident)
		estGroup.GET("/:id/guard/incidents", estateHandler.ListIncidents)
		estGroup.POST("/:id/guard/shift-handover", estateHandler.HandoverShift)
		estGroup.POST("/:id/guard/sync", estateHandler.SyncOfflineLogs)

		// Block 27: Extended visitor access codes
		estGroup.POST("/:id/access-codes", estateHandler.CreateAccessCode)
		estGroup.GET("/:id/access-codes", estateHandler.ListAccessCodes)
		estGroup.GET("/:id/access-codes/:cid", estateHandler.GetAccessCode)
		estGroup.POST("/:id/access-codes/:cid/revoke", estateHandler.RevokeCode)
		estGroup.POST("/:id/access-codes/:cid/extend", estateHandler.ExtendCode)
		estGroup.POST("/:id/access-codes/:cid/blacklist", estateHandler.BlacklistVisitor)
		estGroup.GET("/:id/access-codes/:cid/history", estateHandler.GetCheckinHistory)

		// Block 26: Dashboard
		estGroup.GET("/:id/dashboard", estateHandler.GetDashboard)

		// Block 25: Resident profiles
		estGroup.GET("/:id/profile", estateHandler.GetProfile)
		estGroup.PUT("/:id/profile", estateHandler.UpsertProfile)
		estGroup.GET("/:id/profile/household", estateHandler.ListHouseholdMembers)
		estGroup.POST("/:id/profile/household", estateHandler.AddHouseholdMember)
		estGroup.DELETE("/:id/profile/household/:mid", estateHandler.DeleteHouseholdMember)
		estGroup.GET("/:id/profile/staff", estateHandler.ListDomesticStaff)
		estGroup.POST("/:id/profile/staff", estateHandler.AddDomesticStaff)
		estGroup.PATCH("/:id/profile/staff/:sid/status", estateHandler.UpdateStaffStatus)
		estGroup.GET("/:id/profile/vehicles", estateHandler.ListVehicles)
		estGroup.POST("/:id/profile/vehicles", estateHandler.AddVehicle)
		estGroup.POST("/:id/profile/vehicles/:vid/verify", estateHandler.VerifyVehicle)

		// Block 29: Dues / Rent (money path — Idempotency-Key required on pay)
		estGroup.GET("/:id/dues/invoices", estateHandler.ListInvoices)
		estGroup.POST("/:id/dues/invoices", estateHandler.CreateInvoice)
		estGroup.POST("/:id/dues/invoices/:invoiceId/pay", estateHandler.PayDues)
		estGroup.POST("/:id/dues/restrictions", estateHandler.ApplyRestriction)
		estGroup.POST("/:id/dues/restrictions/:residentId/lift", estateHandler.LiftRestriction)

		// Block 31: Tasks
		estGroup.GET("/:id/tasks", estateHandler.ListTasks)
		estGroup.POST("/:id/tasks", estateHandler.CreateTask)
		estGroup.PATCH("/:id/tasks/:taskId/status", estateHandler.UpdateTaskStatus)

		// Block 32: Maintenance / Repairs
		estGroup.GET("/:id/repairs", estateHandler.ListRepairs)
		estGroup.POST("/:id/repairs", estateHandler.CreateRepair)
		estGroup.GET("/:id/repairs/:repairId/updates", estateHandler.ListRepairUpdates)
		estGroup.POST("/:id/repairs/:repairId/updates", estateHandler.AddRepairUpdate)

		// Block 33: Facilities / Amenities
		estGroup.GET("/:id/facilities", estateHandler.ListFacilities)
		estGroup.POST("/:id/facilities", estateHandler.CreateFacility)
		estGroup.POST("/:id/facilities/:facilityId/book", estateHandler.BookFacility)
		estGroup.GET("/:id/bookings", estateHandler.ListMyBookings)

		// Block 34: Announcements
		estGroup.GET("/:id/announcements", estateHandler.ListAnnouncements)
		estGroup.POST("/:id/announcements", estateHandler.CreateAnnouncement)
		estGroup.POST("/:id/announcements/:annId/read", estateHandler.MarkAnnouncementRead)

		// Block 35: Emergencies / Incidents
		estGroup.GET("/:id/emergencies", estateHandler.ListEmergencies)
		estGroup.POST("/:id/emergencies", estateHandler.RaiseEmergency)
		estGroup.PATCH("/:id/emergencies/:alertId/status", estateHandler.UpdateEmergencyStatus)

		// Block 36: Documents (upload via presigned R2; type/size validated)
		estGroup.GET("/:id/documents", estateHandler.ListDocuments)
		estGroup.POST("/:id/documents", estateHandler.CreateDocument)

		// Block 37: Vendors / Artisans
		estGroup.GET("/:id/vendors", estateHandler.ListVendors)
		estGroup.POST("/:id/vendors", estateHandler.CreateVendor)
		estGroup.POST("/:id/vendors/:vendorId/verify", estateHandler.VerifyVendor)

		// Block 40/43/44: Finance dashboard, notifications, reports (aggregates)
		estGroup.GET("/:id/finance/dashboard", estateHandler.FinanceDashboard)
		estGroup.GET("/:id/notifications", estateHandler.Notifications)
		estGroup.GET("/:id/reports", estateHandler.Report)
	}

	// --- Crowdfunding routes ---
	if cfg.FeatureCrowdfundingEnabled {
		settlementSvcCF := settlement.NewService(pool, ledgerSvc)
		cfSvc := crowdfunding.NewService(pool, ledgerSvc, settlementSvcCF)
		cfHandler := crowdfunding.NewHandler(cfSvc)
		cfGroup := finance.Group("/crowdfunding")
		// Discovery & detail (read)
		cfGroup.GET("/campaigns", cfHandler.ListCampaigns)
		cfGroup.GET("/categories", cfHandler.ListCategories)
		cfGroup.GET("/campaigns/:id", cfHandler.GetDetail)
		// Lifecycle (write)
		cfGroup.POST("/campaigns", cfHandler.SubmitCampaign)
		cfGroup.POST("/campaigns/:id/publish", cfHandler.Publish)
		cfGroup.POST("/campaigns/:id/contribute", cfHandler.Contribute)
		cfGroup.POST("/campaigns/:id/release", cfHandler.Release)
		cfGroup.POST("/campaigns/:id/refund", cfHandler.Refund)

		// Admin review group (matches the admin web client's /api/crowdfunding/admin base).
		cfAdmin := r.Group("/api/crowdfunding/admin")
		cfAdmin.Use(requireUserID())
		cfAdmin.GET("/stats", cfHandler.AdminStats)
		cfAdmin.GET("/campaigns", cfHandler.AdminListPending)
		cfAdmin.GET("/campaigns/:id", cfHandler.AdminGetCampaign)
		cfAdmin.POST("/campaigns/:id/decision", cfHandler.AdminDecide)
	}

	// --- Restaurant & Delivery routes ---
	if cfg.FeatureRestaurantEnabled {
		settlementSvcR := settlement.NewService(pool, ledgerSvc)
		restaurantSvc := restaurant.NewService(pool, settlementSvcR)
		if mapSvc != nil {
			restaurantSvc = restaurantSvc.WithGeocoder(maps.NewLocationGeocoder(mapSvc))
		}
		restaurantHandler := restaurant.NewHandler(restaurantSvc)
		restGroup := finance.Group("/restaurant")
		restGroup.POST("", restaurantHandler.Create)
		restGroup.POST("/:id/orders", restaurantHandler.PlaceOrder)
		restGroup.PATCH("/:id/orders/:orderId/status", restaurantHandler.UpdateStatus)
		restGroup.DELETE("/:id/orders/:orderId", restaurantHandler.CancelOrder)
	}

	// --- Telemedicine routes ---
	if cfg.FeatureTelemedicineEnabled {
		settlementSvcT := settlement.NewService(pool, ledgerSvc)
		telemedSvc := telemedicine.NewService(pool, settlementSvcT)
		telemedHandler := telemedicine.NewHandler(telemedSvc)

		// Legacy /api/finance/telemedicine/... (kept for backward compat)
		teleGroup := finance.Group("/telemedicine")
		teleGroup.GET("/doctors", telemedHandler.ListDoctors)
		teleGroup.POST("/doctors", telemedHandler.RegisterDoctor)
		teleGroup.POST("/appointments", telemedHandler.BookAppointment)
		teleGroup.POST("/appointments/:id/complete", telemedHandler.CompleteAppointment)
		teleGroup.DELETE("/appointments/:id", telemedHandler.CancelAppointment)
		teleGroup.POST("/appointments/:id/prescription", telemedHandler.IssuePrescription)

		// Mobile-facing /api/v1/telemedicine/... (matches mobile API client)
		v1Tele := r.Group("/api/v1/telemedicine")
		v1Tele.Use(requireUserID())
		v1Tele.GET("/specialties", telemedHandler.ListSpecialties)
		v1Tele.GET("/doctors", telemedHandler.ListDoctors)
		v1Tele.GET("/doctors/:id", telemedHandler.GetDoctor)
		v1Tele.GET("/doctors/:id/availability", telemedHandler.GetAvailability)
		v1Tele.GET("/doctors/:id/reviews", telemedHandler.ListDoctorReviews)
		v1Tele.POST("/doctors", telemedHandler.RegisterDoctor)
		v1Tele.POST("/appointments", telemedHandler.BookAppointment)
		v1Tele.GET("/appointments", telemedHandler.ListMyAppointments)
		v1Tele.GET("/appointments/:id", telemedHandler.GetAppointment)
		v1Tele.GET("/appointments/:id/summary", telemedHandler.GetVisitSummary)
		v1Tele.POST("/appointments/:id/confirm", telemedHandler.ConfirmAppointment)
		v1Tele.POST("/appointments/:id/reschedule", telemedHandler.RescheduleAppointment)
		v1Tele.POST("/appointments/:id/complete", telemedHandler.CompleteAppointment)
		v1Tele.POST("/appointments/:id/cancel", telemedHandler.CancelAppointment)
		v1Tele.POST("/appointments/:id/review", telemedHandler.AddReview)
		v1Tele.DELETE("/appointments/:id", telemedHandler.CancelAppointment)
		v1Tele.POST("/appointments/:id/prescription", telemedHandler.IssuePrescription)
		// Doctor-facing
		v1Tele.POST("/doctor/register", telemedHandler.RegisterDoctorV2)
		v1Tele.GET("/doctor/dashboard", telemedHandler.GetDoctorDashboard)
		v1Tele.PATCH("/doctor/availability", telemedHandler.ToggleAvailability)
		v1Tele.POST("/doctor/notes", telemedHandler.SubmitSOAPNote)
		v1Tele.POST("/doctor/licence", telemedHandler.UploadLicenceDoc)
	}

	// --- Pharmacy routes ---
	if cfg.FeaturePharmacyEnabled {
		pharmacySvc := pharmacy.NewService(pool)
		pharmacyHandler := pharmacy.NewHandler(pharmacySvc)
		v1Pharm := r.Group("/api/v1/pharmacy")
		v1Pharm.Use(requireUserID())
		v1Pharm.GET("/products", pharmacyHandler.ListProducts)
		v1Pharm.GET("/cart", pharmacyHandler.GetCart)
		v1Pharm.POST("/cart", pharmacyHandler.AddToCart)
		v1Pharm.PATCH("/cart/:product_id", pharmacyHandler.UpdateCartItem)
		v1Pharm.DELETE("/cart/:product_id", pharmacyHandler.RemoveFromCart)
		v1Pharm.DELETE("/cart", pharmacyHandler.ClearCart)
	}

	// --- AI Customer Care routes ---
	if cfg.FeatureAICareEnabled {
		// AI provider is nil (stub) — swap in an Anthropic/OpenAI client when ready.
		aicSvc := aicare.NewService(pool, nil)
		aicHandler := aicare.NewHandler(aicSvc)
		aicGroup := finance.Group("/support")
		aicGroup.POST("/sessions", aicHandler.CreateSession)
		aicGroup.GET("/sessions/:id/messages", aicHandler.GetHistory)
		aicGroup.POST("/sessions/:id/messages", aicHandler.SendMessage)
		aicGroup.POST("/sessions/:id/escalate", aicHandler.Escalate)
		aicGroup.POST("/sessions/:id/resolve", aicHandler.Resolve)
	}

	// --- Transport / Mobility (ride-hailing) routes ---
	if cfg.FeatureTransportEnabled {
		settlementSvcTr := settlement.NewService(pool, ledgerSvc)
		transportSvc := transport.NewService(pool, settlementSvcTr)
		// Bridge transport dispatch/estimation onto the provider-agnostic
		// MapService (OpenStack/OSRM by default) instead of the ad-hoc maps stub.
		if mapSvc != nil {
			transportSvc = transportSvc.WithMaps(transport.NewMapServiceBridge(mapSvc))
			log.Println("[transport] dispatch using provider-agnostic MapService")
		}
		transportHandler := transport.NewHandler(transportSvc)
		transportAdmin := transport.NewAdminHandler(transport.NewAdminService(transportSvc))

		// Real-time trip tracking: driver GPS → MatchToRoad snap → rider+driver
		// over WebSocket (Redis pub/sub fans out across instances).
		transportHub := platformWS.New()
		var trackMaps maps.MapService
		if mapSvc != nil {
			trackMaps = mapSvc
		}
		tripTracker := transport.NewTripTracker(pool, transportHub, trackMaps, redisClient)
		tripTracker.Start(ctx)
		transportHandler = transportHandler.WithRealtime(tripTracker, transportHub)

		// Legacy transport endpoints (kept for back-compat).
		trGroup := finance.Group("/transport")
		trGroup.POST("/drivers", transportHandler.RegisterDriver)
		trGroup.PATCH("/drivers/status", transportHandler.SetStatus)
		trGroup.POST("/trips", transportHandler.RequestTrip)
		trGroup.POST("/trips/:id/accept", transportHandler.AcceptTrip)
		trGroup.PATCH("/trips/:id/status", transportHandler.UpdateStatus)

		// Customer (rider) mobility endpoints.
		mob := finance.Group("/mobility")
		// Real-time tracking: rider/driver WS channel + driver GPS ingest.
		mob.GET("/ws", transportHandler.ServeTripWS)
		mob.POST("/trips/:id/track", transportHandler.TrackPosition)
		mob.GET("/home", transportHandler.Home)
		mob.GET("/config/pricing", transportHandler.ConfigPricing)
		mob.POST("/rides/estimate", transportHandler.Estimate)
		mob.POST("/rides/request", transportHandler.RequestRide)
		mob.GET("/rides/active", transportHandler.ActiveRide)
		mob.POST("/rides/:id/offer", transportHandler.Offer)
		mob.POST("/rides/:id/accept-counter", transportHandler.AcceptCounter)
		mob.POST("/rides/:id/cancel", transportHandler.CancelRide)
		mob.GET("/rides/:id", transportHandler.GetRide)
		mob.POST("/rides/:id/share", transportHandler.ShareRide)
		mob.POST("/rides/:id/sos", transportHandler.SOS)
		mob.POST("/rides/:id/rate", transportHandler.Rate)
		mob.GET("/history", transportHandler.History)
		mob.GET("/profile", transportHandler.GetProfile)
		mob.PUT("/profile", transportHandler.UpdateProfile)
		mob.GET("/trusted-contacts", transportHandler.ListContacts)
		mob.POST("/trusted-contacts", transportHandler.AddContact)
		mob.DELETE("/trusted-contacts/:id", transportHandler.DeleteContact)

		// Driver endpoints.
		drv := finance.Group("/driver")
		drv.POST("/onboarding/submit", transportHandler.OnboardingSubmit)
		drv.POST("/documents", transportHandler.AddDocument)
		drv.POST("/vehicle", transportHandler.AddVehicle)
		drv.GET("/me", transportHandler.DriverMe)
		drv.PATCH("/status", transportHandler.DriverStatus)
		drv.GET("/requests", transportHandler.DriverRequests)
		drv.POST("/requests/:id/accept", transportHandler.DriverAccept)
		drv.POST("/requests/:id/counter", transportHandler.DriverCounter)
		drv.POST("/trips/:id/arrive", transportHandler.DriverArrive)
		drv.POST("/trips/:id/verify-pin", transportHandler.VerifyPin)
		drv.POST("/trips/:id/start", transportHandler.StartTrip)
		drv.POST("/trips/:id/complete", transportHandler.CompleteTrip)
		drv.GET("/earnings", transportHandler.DriverEarnings)
		drv.POST("/sos", transportHandler.DriverSOS)

		// Admin transport endpoints (user auth + admin gate; every mutation audited).
		adminTr := r.Group("/api/finance/admin/transport")
		adminTr.Use(requireUserID())
		adminTr.Use(middleware.RequireAdmin(cfg.AdminAPIKey))
		adminTr.GET("/dashboard", transportAdmin.Dashboard)
		adminTr.GET("/drivers", transportAdmin.ListDrivers)
		adminTr.GET("/drivers/:id", transportAdmin.DriverDetail)
		adminTr.PATCH("/drivers/:id/verification", transportAdmin.SetVerification)
		adminTr.GET("/vehicles", transportAdmin.ListVehicles)
		adminTr.PATCH("/vehicles/:id/status", transportAdmin.SetVehicleStatus)
		adminTr.GET("/trips", transportAdmin.ListTrips)
		adminTr.GET("/dispatch/live", transportAdmin.DispatchLive)
		adminTr.POST("/dispatch/:trip_id/assign", transportAdmin.ManualAssign)
		adminTr.GET("/pricing", transportAdmin.GetPricing)
		adminTr.PATCH("/pricing", transportAdmin.PatchPricing)
		adminTr.GET("/commission", transportAdmin.ListCommission)
		adminTr.PATCH("/commission/:tier", transportAdmin.PatchCommission)
		adminTr.GET("/safety/incidents", transportAdmin.ListIncidents)
		adminTr.PATCH("/safety/incidents/:id", transportAdmin.PatchIncident)
		adminTr.GET("/reports/summary", transportAdmin.ReportsSummary)
		adminTr.GET("/audit", transportAdmin.AuditFeed)

		// ── Multi-modal expansion: parcel · bus · towing · movers · car hire ──
		// Reuses the same transport service/handlers, settlement escrow, driver
		// gate, pricing config, and audit sink. Gated on its own flag.
		if cfg.FeatureTransportModesEnabled {
			// Customer (rider) mode endpoints.
			mob.POST("/parcels/estimate", transportHandler.ParcelEstimate)
			mob.POST("/parcels", transportHandler.ParcelBook)
			mob.GET("/parcels", transportHandler.ParcelList)
			mob.GET("/parcels/:id", transportHandler.ParcelGet)
			mob.POST("/parcels/:id/cancel", transportHandler.ParcelCancel)

			mob.GET("/bus/routes", transportHandler.BusRoutes)
			mob.GET("/bus/schedules", transportHandler.BusSchedules)
			mob.POST("/bus/book", transportHandler.BusBook)
			mob.GET("/bus/tickets", transportHandler.BusTickets)
			mob.POST("/bus/tickets/:id/cancel", transportHandler.BusTicketCancel)

			mob.POST("/towing/estimate", transportHandler.TowingEstimate)
			mob.POST("/towing", transportHandler.TowingBook)
			mob.GET("/towing", transportHandler.TowingList)
			mob.GET("/towing/:id", transportHandler.TowingGet)
			mob.POST("/towing/:id/cancel", transportHandler.TowingCancel)

			mob.POST("/movers/quote", transportHandler.MoverQuote)
			mob.GET("/movers/:id", transportHandler.MoverGet)
			mob.POST("/movers/:id/accept-bid", transportHandler.MoverAcceptBid)
			mob.POST("/movers/:id/confirm-completion", transportHandler.MoverConfirmCompletion)
			mob.POST("/movers/:id/cancel", transportHandler.MoverCancel)

			mob.POST("/car-hire/quote", transportHandler.CarHireQuote)
			mob.POST("/car-hire/book", transportHandler.CarHireBook)
			mob.GET("/car-hire", transportHandler.CarHireList)
			mob.GET("/car-hire/:id", transportHandler.CarHireGet)
			mob.POST("/car-hire/:id/activate", transportHandler.CarHireActivate)
			mob.POST("/car-hire/:id/extend", transportHandler.CarHireExtend)
			mob.POST("/car-hire/:id/complete", transportHandler.CarHireComplete)
			mob.POST("/car-hire/:id/cancel", transportHandler.CarHireCancel)

			// Driver (courier/operator/provider) mode endpoints.
			drv.GET("/parcels/requests", transportHandler.ParcelRequests)
			drv.POST("/parcels/:id/accept", transportHandler.ParcelAccept)
			drv.POST("/parcels/:id/verify-pickup-pin", transportHandler.ParcelVerifyPickupPin)
			drv.POST("/parcels/:id/picked-up", transportHandler.ParcelPickedUp)
			drv.POST("/parcels/:id/verify-dropoff", transportHandler.ParcelVerifyDropoff)

			drv.POST("/bus/validate", transportHandler.BusValidate)

			drv.GET("/towing/requests", transportHandler.TowingRequests)
			drv.POST("/towing/:id/accept", transportHandler.TowingAccept)
			drv.POST("/towing/:id/en-route", transportHandler.TowingEnRoute)
			drv.POST("/towing/:id/verify-pin", transportHandler.TowingVerifyPin)
			drv.POST("/towing/:id/start", transportHandler.TowingStart)
			drv.POST("/towing/:id/complete", transportHandler.TowingComplete)

			drv.GET("/movers/open", transportHandler.MoverOpen)
			drv.POST("/movers/:id/bid", transportHandler.MoverBid)
			drv.POST("/movers/:id/start", transportHandler.MoverStart)
			drv.POST("/movers/:id/complete", transportHandler.MoverComplete)

			// Admin mode endpoints (audited).
			adminTr.GET("/parcels", transportAdmin.AdminParcelsList)
			adminTr.PATCH("/parcels/:id/status", transportAdmin.AdminParcelStatus)

			adminTr.GET("/bus/routes", transportAdmin.AdminBusListRoutes)
			adminTr.POST("/bus/routes", transportAdmin.AdminBusCreateRoute)
			adminTr.POST("/bus/schedules", transportAdmin.AdminBusCreateSchedule)
			adminTr.POST("/bus/schedules/:id/approve-fare", transportAdmin.AdminBusApproveFare)
			adminTr.GET("/bus/manifest", transportAdmin.AdminBusManifest)

			adminTr.GET("/towing", transportAdmin.AdminTowingList)
			adminTr.PATCH("/towing/:id/status", transportAdmin.AdminTowingStatus)

			adminTr.GET("/movers", transportAdmin.AdminMoversList)
			adminTr.PATCH("/movers/:id/status", transportAdmin.AdminMoverStatus)

			adminTr.GET("/car-hire", transportAdmin.AdminCarHireList)
			adminTr.PATCH("/car-hire/:id/status", transportAdmin.AdminCarHireStatus)

			// ── Final modes: business logistics + event transport ──
			// Business logistics (owner) endpoints.
			mob.POST("/business/accounts", transportHandler.BusinessAccountCreate)
			mob.GET("/business/accounts/me", transportHandler.BusinessAccountGet)
			mob.POST("/business/deliveries", transportHandler.BusinessDeliveryCreate)
			mob.GET("/business/deliveries", transportHandler.BusinessDeliveryList)
			mob.GET("/business/deliveries/:id", transportHandler.BusinessDeliveryGet)
			mob.POST("/business/deliveries/:id/cancel", transportHandler.BusinessDeliveryCancel)
			mob.POST("/business/batches", transportHandler.BusinessBatchCreate)
			mob.GET("/business/batches", transportHandler.BusinessBatchList)
			mob.GET("/business/batches/:id", transportHandler.BusinessBatchGet)
			mob.GET("/business/invoices", transportHandler.BusinessInvoiceList)
			mob.GET("/business/analytics", transportHandler.BusinessAnalytics)

			// Business logistics (courier) endpoints.
			drv.GET("/business/requests", transportHandler.BusinessRequests)
			drv.POST("/business/:id/accept", transportHandler.BusinessAccept)
			drv.POST("/business/:id/picked-up", transportHandler.BusinessPickedUp)
			drv.POST("/business/:id/deliver", transportHandler.BusinessDeliver)
			drv.POST("/business/:id/fail", transportHandler.BusinessFail)

			// Event transport (rider / organizer) endpoints. event_id is a query
			// param on the list endpoint (GET /mobility/events/transport?event_id=)
			// to keep the static /events/transport tree unambiguous and stable.
			mob.GET("/events/transport", transportHandler.EventOffersList)
			mob.POST("/events/transport", transportHandler.EventOfferCreate)
			mob.GET("/events/transport/:id", transportHandler.EventOfferGet)
			mob.POST("/events/transport/:id/book", transportHandler.EventBook)
			mob.GET("/events/bookings", transportHandler.EventBookings)
			mob.POST("/events/bookings/:id/cancel", transportHandler.EventBookingCancel)

			// Event transport (organizer/driver) validation.
			drv.POST("/events/validate", transportHandler.EventValidate)

			// Admin: business logistics + event transport (audited).
			adminTr.GET("/business/accounts", transportAdmin.AdminBusinessAccountsList)
			adminTr.PATCH("/business/accounts/:id/status", transportAdmin.AdminBusinessAccountStatus)
			adminTr.GET("/business/deliveries", transportAdmin.AdminBusinessDeliveriesList)
			adminTr.PATCH("/business/deliveries/:id/status", transportAdmin.AdminBusinessDeliveryStatus)
			adminTr.GET("/business/invoices", transportAdmin.AdminBusinessInvoicesList)
			adminTr.POST("/business/invoices/:id/issue", transportAdmin.AdminBusinessInvoiceIssue)
			adminTr.POST("/business/invoices/:id/mark-paid", transportAdmin.AdminBusinessInvoiceMarkPaid)
			adminTr.GET("/events/offers", transportAdmin.AdminEventOffersList)
			adminTr.PATCH("/events/offers/:id/status", transportAdmin.AdminEventOfferStatus)
			adminTr.GET("/events/bookings", transportAdmin.AdminEventBookingsList)

			log.Println("[finance] transport modes (parcel/bus/towing/movers/car-hire/logistics/event) routes registered")
		}
	}

	// --- Disputes routes ---
	if cfg.FeatureDisputesEnabled {
		disputesSvc := disputes.NewService(pool)
		disputesHandler := disputes.NewHandler(disputesSvc)
		dpGroup := finance.Group("/disputes")
		dpGroup.POST("", disputesHandler.Open)
		dpGroup.GET("", disputesHandler.List)
		adminFinanceDisputes := r.Group("/api/finance/admin/disputes")
		adminFinanceDisputes.Use(requireUserID())
		adminFinanceDisputes.POST("/:id/resolve", disputesHandler.AdminResolve)
	}

	// --- Ratings routes ---
	if cfg.FeatureRatingsEnabled {
		ratingsSvc := ratings.NewService(pool)
		ratingsHandler := ratings.NewHandler(ratingsSvc)
		rtGroup := finance.Group("/ratings")
		rtGroup.POST("", ratingsHandler.Create)
		rtGroup.GET("/:entity_id", ratingsHandler.GetSummary)
	}

	// --- Vote bridge routes ---
	// Provides a wallet-debit endpoint called by the Next.js bridge before crediting
	// votes via the legacy Spotlight service. Never touches protected contest files.
	if cfg.FeatureVoteBridgeEnabled && cfg.FeatureWalletEnabled {
		vbHandler := votebridge.NewHandler(walletSvc)
		r.POST("/api/finance/vote-bridge/debit", requireUserID(), vbHandler.DebitForVotes)
	}

	// --- Admin finance routes ---
	adminFinance := r.Group("/api/finance/admin")
	adminFinance.Use(requireUserID())
	if cfg.FeatureKYCEnabled {
		adminFinance.GET("/kyc/pending", kycHandler.ListPending)
		adminFinance.POST("/kyc/users/:user_id/approve", kycHandler.Approve)
		adminFinance.POST("/kyc/users/:user_id/reject", kycHandler.Reject)
	}
	if cfg.FeatureWalletEnabled {
		adminFinance.GET("/wallets/:user_id/balance", walletHandler.AdminGetBalance)
		adminFinance.GET("/wallets/:user_id/transactions", walletHandler.AdminListTransactions)
	}

	// --- Merchant Onboarding & Role-Upgrade routes ---
	onboarding.Register(r, onboarding.Deps{
		DB:       pool,
		Supabase: supabase,
		RBAC:     rbac,
		Enabled:  cfg.FeatureOnboardingEnabled,
	})

	// --- Doctor (provider) telemedicine routes ---
	// Mounted on /api/v1/doctor (the mobile client base) with the Supabase-JWT
	// auth middleware. Money path (POST /payouts) posts a balanced double-entry
	// via the shared ledger, enforces tier limits fail-closed, and is idempotent.
	if cfg.FeatureDoctorEnabled {
		// Wave 6: realtime layer. The RTC Issuer signs short-lived Agora/VideoSDK
		// join tokens server-side (creds never leave the process); an unconfigured
		// provider yields an empty token + a "not configured" flag, never a fake one.
		// One shared WS Hub fans push events to a doctor's connected devices.
		rtcIssuer := rtc.NewIssuer(rtc.Config{
			AgoraAppID:          cfg.AgoraAppID,
			AgoraAppCertificate: cfg.AgoraAppCertificate,
			VideoSDKAPIKey:      cfg.VideoSDKAPIKey,
			VideoSDKSecret:      cfg.VideoSDKSecret,
		})
		doctorHub := platformWS.New()

		doctorSvc := doctor.NewService(pool, ledgerSvc, tiersSvc, redisClient).WithRealtime(rtcIssuer, doctorHub)
		// Backend-owned presigned R2 uploads (profile photo / documents / licence /
		// chat attachments / dispute evidence). Unconfigured creds → the presign
		// endpoint fails closed with 503. Bucket default mirrors CLAUDE.md.
		doctorPresigner := r2.New(r2.Config{
			AccountEndpoint: cfg.R2AccountEndpoint,
			Bucket:          cfg.R2Bucket,
			AccessKeyID:     cfg.R2AccessKeyID,
			SecretAccessKey: cfg.R2SecretAccessKey,
			Region:          cfg.R2Region,
		})
		doctorHandler := doctor.NewHandler(doctorSvc).WithHub(doctorHub).
			WithPresigner(doctorPresigner, cfg.R2Bucket)

		// Wave 5: AI-assist. The LLM client is server-side only (key from config);
		// an empty key disables AI (endpoints return a "not configured" envelope).
		llmClient := llm.NewAnthropicClient(cfg.AnthropicAPIKey)
		doctorAIHandler := doctor.NewAIHandler(doctorHandler,
			doctor.NewAIService(doctorSvc, llmClient).
				WithRateLimits(cfg.DoctorAIRatePerMin, cfg.DoctorAIRatePerDay))

		docGroup := r.Group("/api/v1/doctor")
		docGroup.Use(middleware.RequireAuthContext(supabase, rbac))

		// Reads
		docGroup.GET("/profile", doctorHandler.GetProfile)
		docGroup.GET("/verification", doctorHandler.GetVerification)
		docGroup.GET("/availability", doctorHandler.GetAvailability)
		docGroup.GET("/appointments", doctorHandler.ListAppointments)
		docGroup.GET("/appointments/:appointmentId", doctorHandler.GetAppointment)
		docGroup.GET("/appointments/:appointmentId/notes", doctorHandler.ListNotes)
		docGroup.GET("/patients/:patientId", doctorHandler.GetPatient)
		docGroup.GET("/prescriptions", doctorHandler.ListPrescriptions)
		docGroup.GET("/prescriptions/:id", doctorHandler.GetPrescription)
		docGroup.GET("/lab-orders", doctorHandler.ListLabOrders)
		docGroup.GET("/lab-orders/:orderId/result", doctorHandler.GetLabResult)
		docGroup.GET("/earnings", doctorHandler.GetEarnings)
		docGroup.GET("/notifications", doctorHandler.ListNotifications)
		docGroup.GET("/settings", doctorHandler.GetSettings)

		// Mutations (require Idempotency-Key where money/clinical records are written)
		docGroup.POST("/verification", doctorHandler.SubmitVerification)
		docGroup.PUT("/availability", doctorHandler.UpdateAvailability)
		docGroup.POST("/appointments/:appointmentId/status", doctorHandler.UpdateAppointmentStatus)
		docGroup.POST("/appointments/:appointmentId/notes", doctorHandler.SaveNote)
		docGroup.POST("/prescriptions", doctorHandler.CreatePrescription)
		docGroup.POST("/lab-orders", doctorHandler.CreateLabOrder)
		docGroup.POST("/lab-results/:resultId/review", doctorHandler.ReviewLabResult)
		docGroup.PUT("/settings", doctorHandler.UpdateSettings)
		docGroup.POST("/notifications/:id/read", doctorHandler.MarkNotificationRead)

		// Money path
		docGroup.POST("/payouts", doctorHandler.RequestPayout)

		// ── Wave 2 (account / provider / admin) ──────────────────────────────
		// Onboarding
		docGroup.GET("/onboarding/consents", doctorHandler.ListConsents)
		docGroup.POST("/onboarding/consents", doctorHandler.AcceptConsent)
		docGroup.GET("/onboarding/permissions", doctorHandler.ListPermissions)
		docGroup.POST("/onboarding/permissions", doctorHandler.RecordPermission)
		docGroup.GET("/onboarding/merchant-upgrade", doctorHandler.GetMerchantUpgrade)
		docGroup.POST("/onboarding/merchant-upgrade", doctorHandler.RequestMerchantUpgrade)
		docGroup.POST("/onboarding/provider-type", doctorHandler.SetProviderType)

		// Profile builder + licence
		docGroup.GET("/profile/draft", doctorHandler.GetProfileDraft)
		docGroup.PUT("/profile/draft", doctorHandler.SaveProfileDraft)
		docGroup.GET("/profile/documents", doctorHandler.ListProfileDocuments)
		docGroup.POST("/profile/publish", doctorHandler.PublishProfile)
		docGroup.GET("/licence/expiry-warning", doctorHandler.GetLicenceExpiry)
		docGroup.POST("/licence/renew", doctorHandler.RenewLicence)

		// Notifications (groups / preferences / read-all)
		docGroup.GET("/notifications/groups", doctorHandler.ListNotificationGroups)
		docGroup.GET("/notifications/preferences", doctorHandler.ListNotificationPreferences)
		docGroup.PUT("/notifications/preferences", doctorHandler.UpdateNotificationPreference)
		docGroup.POST("/notifications/read-all", doctorHandler.MarkAllNotificationsRead)

		// Support (tickets / disputes / threads)
		docGroup.GET("/support/tickets", doctorHandler.ListSupportTickets)
		docGroup.POST("/support/tickets", doctorHandler.CreateSupportTicket)
		docGroup.GET("/disputes", doctorHandler.ListSupportDisputes)
		docGroup.POST("/disputes", doctorHandler.CreateSupportDispute)
		docGroup.GET("/disputes/:id", doctorHandler.GetSupportDispute)
		docGroup.POST("/disputes/:id/evidence", doctorHandler.AddDisputeEvidence)
		docGroup.GET("/support/:threadId/messages", doctorHandler.ListSupportMessages)
		docGroup.POST("/support/:threadId/messages", doctorHandler.SendSupportMessage)

		// Compliance (audit / training / safety / privacy)
		docGroup.GET("/audit-trail", doctorHandler.ListAuditTrail)
		docGroup.GET("/training", doctorHandler.ListTraining)
		docGroup.POST("/training/:moduleId/complete", doctorHandler.CompleteTraining)
		docGroup.GET("/safety-issues", doctorHandler.ListSafetyIssues)
		docGroup.POST("/safety-issues", doctorHandler.ReportSafetyIssue)
		docGroup.GET("/privacy", doctorHandler.GetPrivacySettings)
		docGroup.PUT("/privacy", doctorHandler.UpdatePrivacySettings)

		// Security / devices / preferences
		docGroup.GET("/security", doctorHandler.GetSecurity)
		docGroup.PUT("/security/biometric", doctorHandler.SetSecurityFlags)
		docGroup.PUT("/security/2fa", doctorHandler.SetSecurityFlags)
		docGroup.GET("/security/devices", doctorHandler.ListDevices)
		docGroup.DELETE("/security/devices/:deviceId", doctorHandler.RevokeDevice)
		docGroup.GET("/preferences", doctorHandler.GetAppPreferences)
		docGroup.PUT("/preferences", doctorHandler.UpdateAppPreferences)

		// Reputation / quality / reviews
		docGroup.GET("/quality/score", doctorHandler.GetQualityScore)
		docGroup.GET("/quality/ranking", doctorHandler.GetRanking)
		docGroup.GET("/quality/recommendations", doctorHandler.GetImprovements)
		docGroup.GET("/feedback", doctorHandler.ListConsultationFeedback)
		docGroup.GET("/reviews/disputes", doctorHandler.ListReviewDisputes)
		docGroup.POST("/reviews/:reviewId/dispute", doctorHandler.DisputeReview)
		docGroup.POST("/reviews/:reviewId/report", doctorHandler.ReportReview)
		docGroup.POST("/reviews/:reviewId/removal-request", doctorHandler.ReportReview)

		// ── Wave 3a: PHARMACY (doctor-phase2 + doctor-batch3) ──
		docGroup.GET("/pharmacy/fulfilments", doctorHandler.ListPharmacyFulfilments)
		docGroup.GET("/pharmacy/fulfilments/:id", doctorHandler.GetPharmacyFulfilment)
		docGroup.GET("/pharmacy/fulfilments/:id/delivery", doctorHandler.GetFulfilmentDelivery)
		docGroup.POST("/pharmacy/fulfilments/:id/substitute", doctorHandler.ReviewSubstitute)
		docGroup.GET("/drug-deliveries", doctorHandler.ListDrugDeliveries)
		docGroup.GET("/refills", doctorHandler.ListRefillRequests)
		docGroup.GET("/refills/:id", doctorHandler.GetRefillRequest)
		docGroup.POST("/refills/:id/review", doctorHandler.ReviewRefill)
		docGroup.GET("/pharmacies", doctorHandler.ListPharmacies)
		docGroup.GET("/pharmacies/preferred", doctorHandler.GetPreferredPharmacy)
		docGroup.GET("/pharmacies/:pharmacyId/stock", doctorHandler.GetPharmacyStock)
		docGroup.POST("/pharmacies/:pharmacyId/report", doctorHandler.ReportPharmacy)
		docGroup.GET("/pharmacy/:fulfilmentId/messages", doctorHandler.ListPharmacyMessages)
		docGroup.POST("/pharmacy/:fulfilmentId/messages", doctorHandler.SendPharmacyMessage)
		docGroup.POST("/pharmacy/:fulfilmentId/received", doctorHandler.ConfirmFulfilmentReceived)
		docGroup.GET("/delivery-alerts", doctorHandler.ListDeliveryAlerts)

		// ── Wave 3a: LABS extended (doctor-batch3) ──
		docGroup.GET("/lab-catalogue", doctorHandler.ListLabCatalogue)
		docGroup.GET("/lab-packages", doctorHandler.ListLabPackages)
		docGroup.GET("/lab-providers", doctorHandler.ListLabProviders)
		docGroup.GET("/lab-orders/:orderId/rich", doctorHandler.GetLabOrderRich)
		docGroup.POST("/lab-orders/:orderId/share", doctorHandler.ShareLabOrder)
		docGroup.POST("/lab-orders/:orderId/cancel", doctorHandler.CancelLabOrder)
		docGroup.GET("/lab-results/inbox", doctorHandler.ListLabResultInbox)
		docGroup.GET("/lab-results/:resultId/rich", doctorHandler.GetLabResultRich)
		docGroup.GET("/lab-results/:resultId/comparisons", doctorHandler.ListLabValueComparisons)
		docGroup.PUT("/lab-results/:resultId/interpretation", doctorHandler.AddLabInterpretation)
		docGroup.POST("/lab-results/:resultId/share-explanation", doctorHandler.ShareLabExplanation)
		docGroup.POST("/lab-results/:resultId/report", doctorHandler.ReportSuspiciousResult)

		// ── Wave 3a: REFERRALS & COLLABORATION (doctor-phase2 + doctor-batch4) ──
		docGroup.GET("/specialists", doctorHandler.ListSpecialists)
		docGroup.GET("/referrals", doctorHandler.ListReferrals)
		docGroup.POST("/referrals", doctorHandler.CreateReferral)
		docGroup.GET("/referrals/incoming", doctorHandler.ListIncomingReferrals)
		docGroup.GET("/referrals/incoming/:id", doctorHandler.GetIncomingReferral)
		docGroup.POST("/referrals/incoming/:id/accept", doctorHandler.AcceptIncomingReferral)
		docGroup.POST("/referrals/incoming/:id/reject", doctorHandler.RejectIncomingReferral)
		docGroup.GET("/referrals/:id", doctorHandler.GetReferral)
		docGroup.GET("/opinions", doctorHandler.ListOpinionRequests)
		docGroup.POST("/opinions", doctorHandler.CreateOpinionRequest)
		docGroup.GET("/opinions/:id", doctorHandler.GetOpinionRequest)
		docGroup.GET("/care-team/:threadId", doctorHandler.ListCareTeamMessages)
		docGroup.POST("/care-team/:threadId/messages", doctorHandler.SendCareTeamMessage)
		docGroup.GET("/case-summaries/:caseRef", doctorHandler.GetSharedCaseSummary)

		// ── Wave 3a: FOLLOW-UP CARE (doctor-phase2 + doctor-batch4) ──
		docGroup.GET("/follow-ups", doctorHandler.ListFollowUps)
		docGroup.POST("/follow-ups", doctorHandler.CreateFollowUp)
		docGroup.GET("/follow-ups/:id", doctorHandler.GetFollowUp)
		docGroup.POST("/follow-ups/:id/review", doctorHandler.ReviewFollowUp)
		docGroup.POST("/follow-ups/:id/reminder", doctorHandler.SetFollowUpReminder)
		docGroup.POST("/follow-ups/:id/complete", doctorHandler.CompleteFollowUp)
		docGroup.GET("/patients/:patientId/follow-up-eligibility", doctorHandler.GetFollowUpEligibility)
		docGroup.GET("/care-plans", doctorHandler.ListCarePlans)
		docGroup.POST("/care-plans", doctorHandler.SaveCarePlan)
		docGroup.GET("/care-plans/:id", doctorHandler.GetCarePlan)
		docGroup.GET("/chronic-monitoring", doctorHandler.ListChronicMonitoring)
		docGroup.POST("/chronic-monitoring", doctorHandler.SaveChronicMonitoring)
		docGroup.GET("/adherence-checks", doctorHandler.ListAdherenceChecks)
		docGroup.POST("/adherence-checks", doctorHandler.RecordAdherenceCheck)

		// ── Wave 3a: HMO (doctor-phase2 + doctor-batch4) ──
		docGroup.GET("/hmo/coverage/:patientId", doctorHandler.GetHMOCoverage)
		docGroup.GET("/hmo/pre-auth", doctorHandler.ListPreAuthRequests)
		docGroup.POST("/hmo/pre-auth", doctorHandler.RequestPreAuth)
		docGroup.GET("/hmo/pre-auth/:id", doctorHandler.GetPreAuthRequest)
		docGroup.GET("/hmo/covered-services", doctorHandler.ListCoveredServices)
		docGroup.GET("/hmo/claims", doctorHandler.ListHMOClaims)
		docGroup.GET("/hmo/claims/:id", doctorHandler.GetHMOClaim)
		docGroup.GET("/hmo/support/:threadId", doctorHandler.ListHMOSupportThread)
		docGroup.POST("/hmo/support/:threadId/messages", doctorHandler.SendHMOSupportMessage)
		docGroup.GET("/hmo/fraud-warnings", doctorHandler.ListFraudWarnings)
		docGroup.POST("/hmo/fraud-warnings/:warningId/ack", doctorHandler.AckFraudWarning)

		// ── Wave 3a: MEDICAL RECORDS (doctor-batch6) ──
		docGroup.GET("/records/dashboard", doctorHandler.GetRecordsDashboard)
		docGroup.GET("/records/shares", doctorHandler.ListRecordShares)
		docGroup.GET("/records/:patientId/index", doctorHandler.GetPatientRecordIndex)
		docGroup.GET("/records/:patientId/restrictions", doctorHandler.ListRecordRestrictions)
		docGroup.GET("/records/:patientId/restricted-warnings", doctorHandler.ListRestrictedWarnings)
		docGroup.POST("/records/:patientId/export", doctorHandler.ExportRecord)
		docGroup.POST("/records/:patientId/share", doctorHandler.ShareRecord)
		docGroup.POST("/records/:patientId/access-request", doctorHandler.RequestRecordAccess)

		// --- Wave 3b: VETERINARY / PET-side ---
		// VET CONSULT
		docGroup.GET("/vet/dashboard", doctorHandler.GetVetDashboard)
		docGroup.POST("/vet/mode", doctorHandler.ToggleVetMode)
		docGroup.GET("/vet/appointments", doctorHandler.ListVetAppointments)
		docGroup.GET("/vet/owner-requests", doctorHandler.ListPetOwnerRequests)
		docGroup.POST("/vet/requests/:requestId/respond", doctorHandler.RespondToOwnerRequest)
		docGroup.GET("/vet/specialists", doctorHandler.ListVetSpecialists)
		docGroup.POST("/vet/soap-notes", doctorHandler.SaveVetSoapNote)
		docGroup.POST("/vet/referrals", doctorHandler.CreateVetReferral)
		docGroup.GET("/vet/consults/history", doctorHandler.ListVetConsultHistory)
		docGroup.GET("/vet/consults/:consultId/summary", doctorHandler.GetVetConsultSummary)
		docGroup.GET("/vet/pharmacies", doctorHandler.ListPetPharmacies)

		// PET PROFILE (per-pet reads use the :petId param consistently)
		docGroup.GET("/vet/pets/:petId", doctorHandler.GetPet)
		docGroup.GET("/vet/pets/:petId/chat", doctorHandler.GetPetChatThread)
		docGroup.GET("/vet/pets/:petId/call", doctorHandler.GetPetCallSession)
		docGroup.GET("/vet/pets/:petId/soap-note", doctorHandler.GetPetSoapNote)
		docGroup.GET("/vet/pets/:petId/emergency-warnings", doctorHandler.ListPetEmergencyWarnings)
		docGroup.GET("/vet/pets/:petId/referrals", doctorHandler.ListPetReferrals)
		docGroup.GET("/vet/pets/:petId/recommendations", doctorHandler.ListPetRecommendationsForPet)
		docGroup.GET("/vet/pets/:petId/prescription", doctorHandler.GetPetPrescriptionForPet)
		docGroup.GET("/vet/pets/:petId/health-record", doctorHandler.GetPetHealthRecord)
		docGroup.GET("/vet/pets/:petId/growth", doctorHandler.GetPetGrowth)
		docGroup.POST("/vet/pets/:petId/growth", doctorHandler.RecordPetGrowth)
		docGroup.GET("/vet/pets/:petId/vaccination-recommendations", doctorHandler.ListPetVaccinationRecommendations)
		docGroup.GET("/vet/pets/:petId/vaccination-reminders", doctorHandler.ListPetVaccinationReminders)
		docGroup.GET("/vet/pets/:petId/chronic-monitoring", doctorHandler.ListPetChronicMonitoring)
		docGroup.POST("/vet/pets/:petId/chronic-monitoring", doctorHandler.SavePetChronicMonitoring)

		// PET E-PRESCRIPTION
		docGroup.POST("/vet/prescriptions", doctorHandler.CreatePetPrescription)
		docGroup.GET("/vet/prescriptions/:prescriptionId/issued", doctorHandler.GetIssuedPetPrescription)
		docGroup.POST("/vet/prescriptions/:prescriptionId/issue", doctorHandler.IssuePetPrescription)
		docGroup.POST("/vet/prescriptions/:prescriptionId/send", doctorHandler.SendPetPrescription)
		docGroup.GET("/vet/refills", doctorHandler.ListPetRefills)
		docGroup.POST("/vet/refills", doctorHandler.RequestPetRefill)
		docGroup.POST("/vet/refills/:refillId/review", doctorHandler.ReviewPetRefill)

		// PET LABS
		docGroup.GET("/vet/lab-orders", doctorHandler.ListPetLabOrders)
		docGroup.POST("/vet/lab-orders", doctorHandler.CreatePetLabOrder)
		docGroup.GET("/vet/lab-orders/:orderId/result", doctorHandler.GetPetLabResultForOrder)
		docGroup.GET("/vet/lab-catalogue", doctorHandler.ListPetLabCatalogue)
		docGroup.GET("/vet/lab-results/inbox", doctorHandler.ListPetLabResultInbox)
		docGroup.POST("/vet/lab-results/:resultId/review", doctorHandler.ReviewPetLabResult)
		docGroup.POST("/vet/lab-results/:resultId/interpretation", doctorHandler.AddPetLabInterpretation)
		docGroup.POST("/vet/vaccination-reminders", doctorHandler.SetPetVaccinationReminder)

		// PET STORE
		docGroup.GET("/vet/products", doctorHandler.ListPetProducts)
		docGroup.GET("/vet/products/:productId", doctorHandler.GetPetProduct)
		docGroup.POST("/vet/recommendations", doctorHandler.RecommendPetProducts)
		docGroup.GET("/vet/recommendations", doctorHandler.ListPetRecommendations)
		docGroup.POST("/vet/recommendations/:recommendationId/share", doctorHandler.SharePetRecommendation)
		docGroup.GET("/vet/product-fulfilments", doctorHandler.ListPetFulfilments)
		docGroup.GET("/vet/product-fulfilments/:id", doctorHandler.GetPetFulfilment)

		// ── Wave 4: CHAT (persistence; realtime WS push is OUT OF SCOPE — TODO) ──
		docGroup.GET("/chat/threads", doctorHandler.ListChatThreads)
		docGroup.GET("/chat/:threadId/messages", doctorHandler.ListChatMessages)
		docGroup.POST("/chat/:threadId/messages", doctorHandler.SendChatMessage)

		// ── Wave 4/6: CALL SESSIONS (Wave 6 issues real Agora/VideoSDK RTC tokens) ──
		docGroup.GET("/calls/:appointmentId", doctorHandler.GetCallSession)
		docGroup.POST("/calls/:appointmentId/join", doctorHandler.StartCallSession)
		docGroup.POST("/calls/:appointmentId/leave", doctorHandler.EndCallSession)
		// Wave 6: fresh short-lived RTC token refresh (time-bound; no idempotency).
		docGroup.POST("/calls/:appointmentId/token", doctorHandler.IssueCallToken)

		// ── Wave 6: REALTIME WebSocket (server→client push for the authed doctor) ──
		docGroup.GET("/ws", doctorHandler.ServeWS)

		// ── Wave 4: SCHEDULE MANAGEMENT (Section E) ──
		docGroup.GET("/schedule/blocked-dates", doctorHandler.ListBlockedDates)
		docGroup.POST("/schedule/blocked-dates", doctorHandler.CreateBlockedDate)
		docGroup.GET("/schedule/vacation", doctorHandler.GetVacation)
		docGroup.PUT("/schedule/vacation", doctorHandler.SetVacation)
		docGroup.GET("/schedule/recurring", doctorHandler.ListRecurringRules)
		docGroup.PUT("/schedule/recurring", doctorHandler.SaveRecurringRule)
		docGroup.GET("/schedule/reminders", doctorHandler.ListReminders)
		docGroup.PUT("/schedule/reminders", doctorHandler.SaveReminderSettings)
		docGroup.PUT("/schedule/timezone", doctorHandler.SetTimezone)

		// ── Wave 4: APPOINTMENT QUEUE (Section F) ──
		docGroup.GET("/queue", doctorHandler.ListConsultQueue)
		docGroup.GET("/appointment-requests", doctorHandler.ListAppointmentRequests)
		docGroup.GET("/appointment-requests/:id", doctorHandler.GetAppointmentRequest)
		docGroup.POST("/appointments/:appointmentId/accept", doctorHandler.AcceptAppointment)
		docGroup.POST("/appointments/:appointmentId/reject", doctorHandler.RejectAppointment)
		docGroup.POST("/appointments/:appointmentId/request-reschedule", doctorHandler.RescheduleAppointment)
		docGroup.POST("/appointments/:appointmentId/reschedule", doctorHandler.RescheduleAppointment)

		// ── Wave 4: HMO CLAIMS (submit + dispute; GET list/get shipped in Wave 3a) ──
		docGroup.POST("/hmo/claims", doctorHandler.SubmitHMOClaim)
		// Route param is :id to match the existing GET /hmo/claims/:id (gin forbids two
		// different param names at the same position); OpenAPI spells this {claimId}.
		docGroup.POST("/hmo/claims/:id/dispute", doctorHandler.DisputeHMOClaim)

		// ── Wave 4: MULTI-CLINIC PORTFOLIO (quality analytics shipped in Wave 2) ──
		docGroup.GET("/clinics", doctorHandler.GetClinicPortfolio)
		docGroup.POST("/clinics/active", doctorHandler.SetActiveClinic)
		docGroup.PATCH("/clinics/:clinicId/schedule", doctorHandler.UpdateClinicSchedule)

		// ── Wave 5: AI ASSIST (server-side LLM; advisory decision-support only) ──
		docGroup.POST("/ai/note-summary", doctorAIHandler.GenerateNoteSummary)
		docGroup.POST("/ai/note-summary/accept", doctorAIHandler.AcceptNoteSummary)
		docGroup.POST("/ai/rx-safety", doctorAIHandler.CheckPrescriptionSafety)
		docGroup.POST("/ai/lab-explanation", doctorAIHandler.ExplainLabResult)

		// ── Finishing/hardening pass: remaining contract endpoints ───────────────
		// These complete coverage of contracts/doctor.openapi.yaml. Param names are
		// kept CONSISTENT with the existing wildcard tree to avoid gin "conflicting
		// param" panics: /prescriptions/:id/* (matches existing /prescriptions/:id),
		// /payouts/:id/* (single :id position), /appointments/:appointmentId/*,
		// /calls/:appointmentId/*, /chat/:threadId/*, /patients/:patientId/*.

		// Appointment lifecycle transitions (doctor_appointments).
		docGroup.POST("/appointments/:appointmentId/start", doctorHandler.StartAppointment)
		docGroup.POST("/appointments/:appointmentId/end", doctorHandler.EndAppointment)
		docGroup.POST("/appointments/:appointmentId/cancel", doctorHandler.CancelAppointment)
		docGroup.POST("/appointments/:appointmentId/no-show", doctorHandler.MarkNoShow)

		// Clinical notes (doctor_clinical_notes).
		docGroup.GET("/appointments/:appointmentId/clinical-note", doctorHandler.GetClinicalNote)
		docGroup.PUT("/appointments/:appointmentId/clinical-note", doctorHandler.SaveClinicalNote)
		docGroup.POST("/clinical-notes/:noteId/finalize", doctorHandler.FinalizeClinicalNote)
		docGroup.POST("/clinical-notes/:noteId/share", doctorHandler.ShareClinicalNote)

		// HMO eligibility for an appointment (doctor_hmo_plan_coverage).
		docGroup.GET("/appointments/:appointmentId/hmo-eligibility", doctorHandler.GetHMOEligibility)

		// Prescription lifecycle + pharmacy routing (doctor_prescriptions / _audit).
		// NOTE: :id keeps the same gin tree position as GET /prescriptions/:id above.
		docGroup.GET("/prescriptions/:id/issued", doctorHandler.GetIssuedPrescription)
		docGroup.POST("/prescriptions/:id/issue", doctorHandler.IssuePrescription)
		docGroup.POST("/prescriptions/:id/cancel", doctorHandler.CancelPrescription)
		docGroup.POST("/prescriptions/:id/share", doctorHandler.SharePrescription)
		docGroup.POST("/prescriptions/:id/pharmacy", doctorHandler.AttachPrescriptionPharmacy)
		docGroup.POST("/prescriptions/:id/send-to-pharmacy", doctorHandler.SendPrescriptionToPharmacy)
		docGroup.POST("/prescriptions/:id/refill-consultation", doctorHandler.RequestRefillConsultation)

		// Call session extras (doctor_call_sessions / _disputes / consultation_feedback).
		docGroup.GET("/calls/:appointmentId/pre-check", doctorHandler.GetCallPreCheck)
		docGroup.GET("/calls/:appointmentId/rich", doctorHandler.GetCallRich)
		docGroup.POST("/calls/:appointmentId/dispute", doctorHandler.DisputeCall)
		docGroup.POST("/calls/:appointmentId/feedback", doctorHandler.SubmitCallFeedback)
		docGroup.POST("/calls/:appointmentId/switch-provider", doctorHandler.SwitchCallProvider)

		// Chat extras (doctor_chat_threads / doctor_chat_messages).
		docGroup.GET("/chat/:threadId/presence", doctorHandler.GetChatPresence)
		docGroup.GET("/chat/:threadId/rich-messages", doctorHandler.ListChatRichMessages)
		docGroup.GET("/chat/:threadId/state", doctorHandler.GetChatState)
		docGroup.GET("/chat/:threadId/transcript", doctorHandler.GetChatTranscript)
		docGroup.POST("/chat/:threadId/attachments", doctorHandler.SendChatAttachment)
		docGroup.POST("/chat/:threadId/end", doctorHandler.EndChatThread)
		docGroup.POST("/chat/:threadId/escalate", doctorHandler.EscalateChatThread)
		docGroup.POST("/chat/:threadId/share", doctorHandler.ShareChatThread)
		docGroup.POST("/chat/:threadId/voice", doctorHandler.SendChatVoice)
		docGroup.POST("/chat/messages/:messageId/report", doctorHandler.ReportChatMessage)
		docGroup.PUT("/chat/messages/:messageId/annotations", doctorHandler.AnnotateChatMessage)

		// Emergency (doctor_emergency_cases / doctor_emergency_escalations).
		// Case CRUD is always available; the REAL-WORLD DISPATCH endpoints
		// (ambulance / hospital / emergency-contact notify) are SEPARATELY
		// feature-flagged and default OFF. They MUST route to a vetted emergency-
		// services provider before any real go-live — do NOT enable without that
		// integration + a separate safety review. See DOCTOR_GO_LIVE.md "Emergency
		// dispatch (DEMO-guarded)".
		docGroup.GET("/emergency/cases/:id", doctorHandler.GetEmergencyCase)
		docGroup.POST("/emergency/cases", doctorHandler.CreateEmergencyCase)
		if cfg.FeatureDoctorEmergencyDispatchEnabled {
			docGroup.POST("/emergency/contacts/:patientId/notify", doctorHandler.NotifyEmergencyContact)
			docGroup.POST("/emergency/escalate/ambulance", doctorHandler.EscalateAmbulance)
			docGroup.POST("/emergency/escalate/hospital", doctorHandler.EscalateHospital)
		} else {
			log.Println("[doctor] emergency dispatch routes DISABLED " +
				"(FEATURE_DOCTOR_EMERGENCY_DISPATCH_ENABLED=false) — must route to a " +
				"vetted provider before go-live")
		}

		// AI advisory read-backs (NOT persisted: return a "regenerate" envelope; no LLM call).
		docGroup.GET("/ai/note-summary/:appointmentId", doctorHandler.GetStoredNoteSummary)
		docGroup.GET("/ai/rx-safety/:id", doctorHandler.GetStoredRxSafety)
		docGroup.GET("/ai/lab-explanation/:resultId", doctorHandler.GetStoredLabExplanation)

		// Backend-owned presigned R2 upload URL (profile photo / document / licence /
		// chat attachment / dispute evidence). Client PUTs the binary direct to R2,
		// then records metadata via the existing endpoints. 503 when R2 unconfigured.
		docGroup.POST("/uploads/presign", doctorHandler.PresignUpload)

		// Profile builder extras (doctor_profiles / doctor_bank_accounts / _verification_documents).
		docGroup.POST("/profile/bank-account", doctorHandler.CreateBankAccount)
		docGroup.POST("/profile/documents", doctorHandler.UploadProfileDocument)
		docGroup.POST("/profile/photo", doctorHandler.SetProfilePhoto)
		docGroup.PUT("/profile/tax-info", doctorHandler.UpdateTaxInfo)

		// Payouts reads + account + dispute (doctor_payouts / _bank_accounts / settlement_disputes).
		// :id keeps a single gin wildcard tree position under /payouts.
		docGroup.GET("/payouts", doctorHandler.ListPayouts)
		docGroup.GET("/payouts/:id", doctorHandler.GetPayout)
		docGroup.GET("/payout-report", doctorHandler.GetPayoutReport)
		docGroup.PUT("/payout-account", doctorHandler.UpdatePayoutAccount)
		docGroup.POST("/payouts/:id/dispute", doctorHandler.DisputePayout)

		// Data privacy (doctor_data_privacy_settings).
		docGroup.POST("/privacy/export", doctorHandler.RequestPrivacyExport)
		docGroup.POST("/privacy/delete", doctorHandler.RequestPrivacyDelete)

		// Security password change request (audit-only; Supabase Auth owns credentials).
		docGroup.POST("/security/password", doctorHandler.ChangePassword)

		// Compliance + policy acknowledgement (doctor_compliance_audit / mandatory_training).
		docGroup.GET("/compliance", doctorHandler.GetCompliance)
		docGroup.POST("/compliance/policies/:policyKey/ack", doctorHandler.AckPolicy)

		// Onboarding legal + reputation + patient hubs.
		docGroup.GET("/onboarding/legal", doctorHandler.GetLegalOnboarding)
		docGroup.GET("/reputation", doctorHandler.GetReputation)
		docGroup.GET("/patients/:patientId/full-profile", doctorHandler.GetPatientFullProfile)
		docGroup.GET("/patients/:patientId/record-hub", doctorHandler.GetPatientRecordHub)

		// Misc account actions.
		docGroup.PUT("/presence", doctorHandler.SetPresence)
		docGroup.POST("/auth/logout", doctorHandler.Logout)
		docGroup.POST("/announcements/:announcementId/dismiss", doctorHandler.DismissAnnouncement)
		docGroup.POST("/support/technical", doctorHandler.CreateTechnicalSupport)
		docGroup.PUT("/schedule/emergency", doctorHandler.SetEmergencySchedule)

		// Vet profile lifecycle (doctor_vet_profiles).
		docGroup.POST("/vet/licence/renew", doctorHandler.RenewVetLicence)
		docGroup.POST("/vet/verification", doctorHandler.SubmitVetVerification)
		docGroup.POST("/vet/profile/publish", doctorHandler.PublishVetProfile)
		docGroup.PUT("/vet/profile/draft", doctorHandler.SaveVetProfileDraft)

		// ── Wave 3 (coverage close-out: 26 contract GETs) ────────────────────
		// Read-only endpoints that were specified in contracts/doctor.openapi.yaml
		// but never wired. All are scoped to the authenticated doctor. The money
		// reads (wallet/balance, earnings/*) are LEDGER-PROJECTED — they read no
		// stored balance and post no ledger entries. Static segments (disputes,
		// faqs, …) coexist with sibling :param routes (gin v1.10 static-wins),
		// exactly like /pharmacies/preferred vs /pharmacies/:pharmacyId/stock.

		// Dashboard / account / app status (derived; no new tables).
		docGroup.GET("/dashboard", doctorHandler.GetDashboard)
		docGroup.GET("/account/status", doctorHandler.GetAccountStatus)
		docGroup.GET("/account/review-notice", doctorHandler.GetReviewNotice)
		docGroup.GET("/app-status", doctorHandler.GetAppStatus)
		docGroup.GET("/announcements/latest", doctorHandler.GetLatestAnnouncement)
		docGroup.GET("/verification/decision", doctorHandler.GetVerificationDecision)

		// Money reads — wallet balance + earnings projections (ledger-projected).
		docGroup.GET("/wallet/balance", doctorHandler.GetWalletBalance)
		docGroup.GET("/earnings/breakdown", doctorHandler.GetEarningsBreakdown)
		docGroup.GET("/earnings/commission", doctorHandler.GetCommissionBreakdown)
		docGroup.GET("/earnings/tax-vat", doctorHandler.GetTaxVatReport)
		docGroup.GET("/invoices", doctorHandler.ListInvoices)
		docGroup.GET("/payouts/disputes", doctorHandler.ListSettlementDisputes)

		// Schedule + quality analytics (composed from existing sub-reads).
		docGroup.GET("/schedule", doctorHandler.GetScheduleSettings)
		docGroup.GET("/analytics/quality", doctorHandler.GetQualityAnalytics)

		// Calls + emergency reads.
		docGroup.GET("/calls/disputes", doctorHandler.ListCallDisputes)
		docGroup.GET("/emergency/cases", doctorHandler.ListEmergencyCases)
		docGroup.GET("/emergency/escalations", doctorHandler.ListEmergencyEscalations)
		docGroup.GET("/emergency/facilities", doctorHandler.ListEmergencyFacilities)
		docGroup.GET("/red-flag-alerts", doctorHandler.ListRedFlagAlerts)

		// Support content + onboarding slides (static catalogues).
		docGroup.GET("/support/faqs", doctorHandler.GetSupportFAQs)
		docGroup.GET("/support/help-articles", doctorHandler.GetHelpArticles)
		docGroup.GET("/onboarding/slides", doctorHandler.GetOnboardingSlides)

		// Vet reads.
		docGroup.GET("/vet/licence", doctorHandler.GetVetLicence)
		docGroup.GET("/vet/verification", doctorHandler.GetVetVerification)
		docGroup.GET("/vet/profile/draft", doctorHandler.GetVetProfileDraft)
		docGroup.GET("/vet/profile/documents", doctorHandler.ListVetProfileDocuments)

		log.Println("[finance] doctor module routes registered at /api/v1/doctor")
	}

	// --- Paymax Invest (stock trading) routes ---
	// Reuses platform auth + the main wallet ledger (which funds the logically
	// separate investment-cash ledger). Mock broker + market-data adapters ship
	// first; real adapters slot in behind the same interfaces later.
	investSvc := invest.Register(r, invest.Deps{
		DB:         pool,
		Supabase:   supabase,
		RBAC:       rbac,
		MainLedger: ledgerSvc,
		Enabled:    cfg.FeatureInvestEnabled,
	})
	// Background workers: T+N settlement processor + price-alert evaluator.
	if investSvc != nil {
		invest.StartSettlementWorker(ctx, investSvc, time.Minute)
		invest.StartAlertWorker(ctx, investSvc, 2*time.Minute)
	}

	// --- MapService proxy routes (service built earlier, shared with transport) ---
	// One interface, pluggable adapters, config-driven {primitive -> provider}.
	// All provider keys are server-side here; the client calls /api/finance/maps,
	// never a provider. PostGIS powers near-me + geofencing (no maps API).
	if mapSvc != nil {
		maps.Mount(r, mapSvc, mapsAuth(), maps.PerUserRateLimit(redisClient, cfg.MapsRateLimitPerMin))
	}

	log.Printf("[finance] routes registered — wallet=%v kyc=%v va=%v referrals=%v fx=%v transfers=%v walletXfer=%v bankXfer=%v groups=%v events=%v estate=%v",
		cfg.FeatureWalletEnabled, cfg.FeatureKYCEnabled, cfg.FeatureVirtualAccountsEnabled,
		cfg.FeatureReferralsEnabled, cfg.FeatureFXEnabled, cfg.FeatureTransfersEnabled,
		cfg.FeatureWalletTransfersEnabled, cfg.FeatureBankTransfersEnabled,
		cfg.FeatureGroupsEnabled, cfg.FeatureEventsEnabled, cfg.FeatureEstateEnabled)
}

// requireUserID is a middleware that rejects requests without a user_id in context.
// In the full auth middleware (RequireAuthContext), user_id is set from the JWT.
// This guard ensures financial routes are never reached unauthenticated.
func requireUserID() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetString("user_id") == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
			return
		}
		c.Next()
	}
}
