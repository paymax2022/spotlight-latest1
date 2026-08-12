package app

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/handlers"
	"spotlight/backend/internal/services"
)

// registerConnectWalletRoutes wires up all /api/v1/wallet/* and /api/v1/kyc/* endpoints
// for the Paymax Connect module (wallet, gifting, KYC tier progression, payouts).
// All endpoints are protected by RequireAuthContext + requireUserID.
func registerConnectWalletRoutes(r *gin.Engine, supabase interface{}, rbac services.RBACService, authMiddleware gin.HandlerFunc, db *pgxpool.Pool, auditSvc services.AuditService) {
	// Create stores with pooled connections
	walletStore := handlers.NewWalletStore(db)
	giftingStore := handlers.NewGiftingStore(db)
	kycStore := handlers.NewKYCStore(db)
	payoutsStore := handlers.NewPayoutsStore(db)

	walletHandler := handlers.NewWalletConnectHandler(walletStore, auditSvc)
	giftingHandler := handlers.NewGiftingConnectHandler(giftingStore, auditSvc)
	kycHandler := handlers.NewKYCConnectHandler(kycStore, auditSvc)
	payoutsHandler := handlers.NewPayoutsConnectHandler(payoutsStore, auditSvc)

	// Base v1 group (all routes require auth)
	v1 := r.Group("/api/v1")
	v1.Use(authMiddleware) // RequireAuthContext sets user_id
	v1.Use(requireUserID())

	// --- Wallet routes ---
	wallet := v1.Group("/wallet")
	wallet.GET("/summary", walletHandler.GetSummary)
	wallet.POST("/fund", walletHandler.FundWallet)
	wallet.GET("/history", walletHandler.GetHistory)
	wallet.GET("/history/:id", walletHandler.GetHistoryEntry)

	// --- Gifting routes ---
	gifting := v1.Group("/wallet/gifting")
	gifting.GET("/catalog", giftingHandler.GetCatalog)
	gifting.GET("/catalog/:id", giftingHandler.GetProduct)
	gifting.GET("/recipients", giftingHandler.GetRecipients)
	gifting.GET("/quote", giftingHandler.QuoteGift)
	gifting.POST("/send", giftingHandler.SendGift)
	gifting.GET("/sent", giftingHandler.GetSentGifts)
	gifting.GET("/received", giftingHandler.GetReceivedGifts)
	gifting.GET("/transactions/:id", giftingHandler.GetGiftTransaction)

	// --- KYC routes ---
	kyc := v1.Group("/kyc")
	kyc.GET("/status", kycHandler.GetStatus)
	kyc.GET("/limits", kycHandler.GetLimits)
	kyc.POST("/tier1", kycHandler.SubmitTier1)
	kyc.POST("/tier2", kycHandler.SubmitTier2)
	kyc.POST("/tier3", kycHandler.SubmitTier3)

	// --- User tier status ---
	me := v1.Group("/me")
	me.GET("/tier", kycHandler.GetTierStatus)

	// --- Payouts routes ---
	payouts := v1.Group("/wallet/payouts")
	payouts.GET("/eligibility", payoutsHandler.GetEligibility)
	payouts.POST("/request", payoutsHandler.RequestPayout)
	payouts.GET("/history", payoutsHandler.GetHistory)
}
