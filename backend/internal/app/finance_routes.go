package app

import (
	"context"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/finance/fx"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/va"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/crowdfunding"
	"spotlight/backend/internal/estate"
	"spotlight/backend/internal/restaurant"
	"spotlight/backend/internal/telemedicine"
	"spotlight/backend/internal/aicare"
	"spotlight/backend/internal/transport"
	"spotlight/backend/internal/votebridge"
	"spotlight/backend/internal/events"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/groups"
	platformDB "spotlight/backend/internal/platform/db"
	platformRedis "spotlight/backend/internal/platform/redis"
	providerInterfaces "spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/maplerad"
	"spotlight/backend/internal/provider/paystack"
	"spotlight/backend/internal/webhooks"
)

// registerFinanceRoutes wires up all financial module routes under /api/finance/...
// Each route group is gated behind its feature flag.
// If DATABASE_URL is not set, financial routes are skipped entirely.
func registerFinanceRoutes(r *gin.Engine, cfg config.Config) {
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
		webhookHandler = webhooks.NewPaystackHandler(paymentProvider, vaSvc, nil)
	}

	// --- Handlers ---
	walletHandler := wallet.NewHandler(walletSvc)
	kycHandler := kyc.NewHandler(kycSvc)
	referralHandler := referrals.NewHandler(referralSvc)

	// Base finance group — all routes require auth (user_id set by RequireAuthContext middleware).
	finance := r.Group("/api/finance")
	finance.Use(requireUserID())

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

	// --- FX routes ---
	if cfg.FeatureFXEnabled && fxHandler != nil {
		fxGroup := finance.Group("/fx")
		fxGroup.POST("/quote", fxHandler.GetQuote)
		fxGroup.POST("/convert", fxHandler.Convert)
		fxGroup.GET("/history", fxHandler.ListHistory)
		fxGroup.GET("/wallets/:currency", fxHandler.GetWallet)
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
		estateSvc := estate.NewService(pool, redisClient)
		estateHandler := estate.NewHandler(estateSvc)
		estGroup := finance.Group("/estate")
		estGroup.POST("", estateHandler.CreateEstate)
		estGroup.POST("/:id/residents", estateHandler.AddResident)
		estGroup.POST("/:id/passes", estateHandler.IssuePass)
		estGroup.POST("/:id/passes/scan", estateHandler.ScanPass)
		estGroup.POST("/:id/elections", estateHandler.CreateElection)
		estGroup.POST("/:id/elections/:electionId/vote", estateHandler.CastVote)
		estGroup.GET("/:id/elections/:electionId/results", estateHandler.GetResults)
	}

	// --- Crowdfunding routes ---
	if cfg.FeatureCrowdfundingEnabled {
		settlementSvcCF := settlement.NewService(pool, ledgerSvc)
		cfSvc := crowdfunding.NewService(pool, ledgerSvc, settlementSvcCF)
		cfHandler := crowdfunding.NewHandler(cfSvc)
		cfGroup := finance.Group("/crowdfunding")
		cfGroup.POST("/campaigns", cfHandler.Create)
		cfGroup.GET("/campaigns/:id", cfHandler.Get)
		cfGroup.POST("/campaigns/:id/publish", cfHandler.Publish)
		cfGroup.POST("/campaigns/:id/contribute", cfHandler.Contribute)
		cfGroup.POST("/campaigns/:id/release", cfHandler.Release)
		cfGroup.POST("/campaigns/:id/refund", cfHandler.Refund)
	}

	// --- Restaurant & Delivery routes ---
	if cfg.FeatureRestaurantEnabled {
		settlementSvcR := settlement.NewService(pool, ledgerSvc)
		restaurantSvc := restaurant.NewService(pool, settlementSvcR)
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
		teleGroup := finance.Group("/telemedicine")
		teleGroup.GET("/doctors", telemedHandler.ListDoctors)
		teleGroup.POST("/doctors", telemedHandler.RegisterDoctor)
		teleGroup.POST("/appointments", telemedHandler.BookAppointment)
		teleGroup.POST("/appointments/:id/complete", telemedHandler.CompleteAppointment)
		teleGroup.DELETE("/appointments/:id", telemedHandler.CancelAppointment)
		teleGroup.POST("/appointments/:id/prescription", telemedHandler.IssuePrescription)
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

	// --- Transport routes ---
	if cfg.FeatureTransportEnabled {
		settlementSvcTr := settlement.NewService(pool, ledgerSvc)
		transportSvc := transport.NewService(pool, settlementSvcTr)
		transportHandler := transport.NewHandler(transportSvc)
		trGroup := finance.Group("/transport")
		trGroup.POST("/drivers", transportHandler.RegisterDriver)
		trGroup.PATCH("/drivers/status", transportHandler.SetStatus)
		trGroup.POST("/trips", transportHandler.RequestTrip)
		trGroup.POST("/trips/:id/accept", transportHandler.AcceptTrip)
		trGroup.PATCH("/trips/:id/status", transportHandler.UpdateStatus)
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
		adminFinance.POST("/kyc/users/:user_id/approve", kycHandler.Approve)
	}

	log.Printf("[finance] routes registered — wallet=%v kyc=%v va=%v referrals=%v fx=%v transfers=%v groups=%v events=%v estate=%v",
		cfg.FeatureWalletEnabled, cfg.FeatureKYCEnabled, cfg.FeatureVirtualAccountsEnabled,
		cfg.FeatureReferralsEnabled, cfg.FeatureFXEnabled, cfg.FeatureTransfersEnabled,
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
