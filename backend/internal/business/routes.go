package business

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/cac"
	"spotlight/backend/internal/services"
)

// ReviewPermission is the RBAC slug gating the admin review/override endpoints.
const ReviewPermission = "business.registry.review"

// RouteDeps carries the collaborators to wire the business-registry routes.
type RouteDeps struct {
	Pool     *pgxpool.Pool
	Ledger   *ledger.Service
	Wallet   *wallet.Service
	Provider cac.BusinessRegistryProvider
	Payment  provider.PaymentProvider // Paystack gateway for the fee (optional)
	RBAC     services.RBACService
	FeeKobo  int64
}

// Register mounts the business-registry routes. `member` is an already-authenticated
// route group (e.g. the finance group: RequireAuthContext + requireUserID). `admin`
// is an authenticated group on which per-route RBAC (business.registry.review) is
// applied here. Returns the Service so the caller can wire the merchant-upgrade gate
// (HasVerifiedBusiness) into the onboarding grant path.
func Register(member, admin *gin.RouterGroup, d RouteDeps) *Service {
	svc := NewService(Deps{
		Repo:     NewRepository(d.Pool),
		Ledger:   d.Ledger,
		Wallet:   d.Wallet,
		Provider: d.Provider,
		Payment:  d.Payment,
		FeeKobo:  d.FeeKobo,
	})
	h := NewHandler(svc)

	// ── Member routes (auth inherited from the member group) ──────────────────
	b := member.Group("/business")
	b.POST("/name/check", h.CheckName)
	b.POST("/name/reserve", h.ReserveName)
	b.POST("/verify", h.VerifyExisting)
	b.POST("/register", h.RegisterNew)
	b.POST("/:id/pay-fee", h.PayFee)                               // wallet money path — Idempotency-Key required
	b.POST("/:id/pay-fee/paystack", h.PayFeePaystackInit)          // gateway: start Paystack checkout
	b.POST("/:id/pay-fee/paystack/verify", h.PayFeePaystackVerify) // gateway: confirm + mark paid
	b.POST("/:id/submit", h.Submit)                                // Idempotency-Key required
	b.GET("/:id/status", h.Status)
	b.GET("/:id/certificate", h.Certificate)
	b.GET("/me", h.Me)
	b.GET("/:id", h.GetOne)

	// ── Admin routes (RBAC business.registry.review per-route, fail-closed) ────
	if admin != nil {
		review := admin.Group("")
		review.Use(middleware.RequirePermission(d.RBAC, ReviewPermission))
		review.GET("", h.AdminList)
		review.GET("/:id", h.AdminGet)
		review.POST("/:id/approve", h.AdminApprove)
		review.POST("/:id/reject", h.AdminReject)
	}

	log.Printf("[business] routes registered (provider=%s, feeKobo=%d, platformFeeKobo=%d) · pay-fee=wallet|paystack(init+verify) [build:platform-fee]", d.Provider.Name(), svc.feeKobo, svc.platformFeeKobo)
	return svc
}
