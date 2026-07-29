package trading

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/trading/kyc"
	"spotlight/backend/internal/trading/wallet"
)

// Register wires the AI-trading module (paper/accounting only). The Module-KYC
// service IS the wallet's access gate — subscriptions are refused unless the user
// is APPROVED or unexpired-BYPASSED. This is the ONLY place the two services are
// joined, and it edits no existing file; finance_routes.go mounts it behind
// FEATURE_TRADING_ENABLED.
//
//   - member: /api/v1/trading/*        (member-auth; the KYC gate + object authz in the service)
//   - admin : /api/v1/admin/trading/*  (member-auth; per-route RBAC trading.kyc.*)
//
// No venue execution and no withdrawal keys exist in this module — cash moves only
// through the finance ledger (wallet), and units/NAV are integer-scaled.
func Register(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, led *ledger.Service, feeBps, hurdleBps int64) (*wallet.Service, *kyc.Service) {
	if pool == nil || led == nil {
		log.Println("[trading] nil pool/ledger — skipping trading routes")
		return nil, nil
	}
	kycSvc := kyc.NewService(pool)
	walSvc := wallet.NewService(pool, led, kycSvc, feeBps, hurdleBps) // kycSvc satisfies wallet.AccessGate
	h := NewHandler(kycSvc, walSvc)
	rp := func(perm string) gin.HandlerFunc { return middleware.RequirePermission(rbac, perm) }

	// ── Member ────────────────────────────────────────────────────────────────
	member.GET("/kyc/status", h.KycStatus)
	member.POST("/kyc/submit", h.KycSubmit)
	member.GET("/wallet", h.WalletPosition)
	member.POST("/wallet/subscribe", h.Subscribe) // Idempotency-Key; access-gated in the service
	member.POST("/wallet/redeem", h.Redeem)        // Idempotency-Key

	// ── Admin (per-route RBAC) ──────────────────────────────────────────────────
	admin.GET("/kyc/queue", rp(kyc.PermReview), h.AdminQueue)
	admin.GET("/kyc/bypass-register", rp(kyc.PermAuditRead), h.AdminBypassRegister)
	admin.GET("/kyc/:id", rp(kyc.PermReview), h.AdminCase)
	admin.POST("/kyc/:id/review", rp(kyc.PermReview), h.AdminReview)
	admin.POST("/kyc/:id/approve", rp(kyc.PermReview), h.AdminApprove)
	admin.POST("/kyc/:id/reject", rp(kyc.PermReview), h.AdminReject)
	admin.POST("/kyc/:id/bypass", rp(kyc.PermBypassApprove), h.AdminBypass) // checker perm; maker≠checker enforced in service

	return walSvc, kycSvc
}
