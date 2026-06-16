package app

import (
	"context"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/config"
	platformDB "spotlight/backend/internal/platform/db"
	platformRedis "spotlight/backend/internal/platform/redis"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	providerInterfaces "spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/paystack"
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

	// --- Provider ---
	var paymentProvider providerInterfaces.PaymentProvider
	if cfg.PaystackSecretKey != "" {
		paymentProvider = paystack.New(cfg.PaystackSecretKey)
	}

	// --- Handlers ---
	walletHandler := wallet.NewHandler(walletSvc)
	kycHandler := kyc.NewHandler(kycSvc)
	referralHandler := referrals.NewHandler(referralSvc)

	_ = paymentProvider // used by transfers handler (wired in next block)

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

	// --- Referral routes ---
	if cfg.FeatureReferralsEnabled {
		refGroup := finance.Group("/referrals")
		refGroup.GET("/me", referralHandler.GetMe)
	}

	// --- Admin finance routes ---
	adminFinance := r.Group("/api/finance/admin")
	adminFinance.Use(requireUserID())
	if cfg.FeatureKYCEnabled {
		adminFinance.POST("/kyc/users/:user_id/approve", kycHandler.Approve)
	}

	log.Printf("[finance] routes registered — wallet=%v kyc=%v referrals=%v transfers=%v va=%v",
		cfg.FeatureWalletEnabled, cfg.FeatureKYCEnabled, cfg.FeatureReferralsEnabled,
		cfg.FeatureTransfersEnabled, cfg.FeatureVirtualAccountsEnabled)
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
