package fractionalre

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Deps carries the collaborators needed to wire the fractionalre module. All are
// reused from the finance route setup (pool, ledger, settlement, kyc, tiers,
// rbac, r2, notifications) — this module never re-implements a finance primitive.
type Deps struct {
	DB         *pgxpool.Pool
	Supabase   *integrations.SupabaseRestClient
	RBAC       services.RBACService
	Ledger     *ledger.Service
	Settlement *settlement.Service
	KYC        *kyc.Service
	Tiers      *tiers.Service
	Provider   AssetProvider  // nil → MockAssetProvider
	Notifier   Notifier       // nil → no-op
	Presigner  Presigner      // nil → object keys recorded without presigned URL
	Referrals  ReferralSource // platform referral engine (nil → GET /referrals returns {enabled:false})
	Enabled    bool           // FEATURE_FRACTIONAL_RE_ENABLED
}

// Register mounts the investor routes under /api/finance/fractionalre and the
// admin control plane under /api/finance/fractionalre/admin (RBAC-gated).
// Returns the constructed *Service (nil when disabled), to allow workers later.
func Register(r *gin.Engine, d Deps) *Service {
	if !d.Enabled {
		log.Println("[fractionalre] FEATURE_FRACTIONAL_RE_ENABLED is false — skipping routes")
		return nil
	}
	if d.DB == nil {
		log.Println("[fractionalre] no database pool — skipping routes")
		return nil
	}

	repo := NewRepository(d.DB)
	svc := NewService(repo, d.Ledger, d.Settlement, d.KYC, d.Tiers, d.Provider)
	if d.Notifier != nil {
		svc.WithNotifier(d.Notifier)
	}
	if d.Presigner != nil {
		svc.WithPresigner(d.Presigner)
	}
	if d.Referrals != nil {
		svc.WithReferrals(d.Referrals)
	}
	h := NewHandler(svc)
	ah := NewAdminHandler(svc)

	// authn maps the authenticated user's id into the gin "user_id" key (matches
	// the finance/invest modules' convention).
	authn := func() gin.HandlerFunc {
		// RequireAuthContext validates the token and sets user_id/user_email before
		// it calls c.Next(); handlers read those directly, so no post-base mirror.
		return middleware.RequireAuthContext(d.Supabase, d.RBAC)
	}

	// ── Investor surface ──────────────────────────────────────────────────────
	inv := r.Group("/api/finance/fractionalre")
	inv.Use(authn())
	{
		inv.POST("/activate", h.Activate)
		inv.GET("/me", h.Me)
		inv.POST("/suitability", h.Suitability)
		inv.POST("/risk-ack", h.RiskAck)

		inv.GET("/offerings", h.ListOfferings)
		inv.GET("/offerings/:id", h.GetOffering)
		inv.POST("/offerings/:id/watch", h.Watch)
		inv.DELETE("/offerings/:id/watch", h.Unwatch)
		inv.GET("/watchlist", h.Watchlist)
		inv.POST("/offerings/:id/limit-check", h.LimitCheck)
		inv.POST("/offerings/:id/subscribe", h.Subscribe)

		inv.GET("/portfolio", h.Portfolio)
		inv.GET("/portfolio/holdings", h.Holdings)
		inv.GET("/portfolio/holdings/:id", h.Holding)
		inv.GET("/portfolio/payouts", h.Payouts)
		inv.GET("/portfolio/statements", h.Statements)

		inv.GET("/auto-invest", h.ListAutoInvest)
		inv.POST("/auto-invest", h.CreateAutoInvest)
		inv.POST("/auto-invest/:id/pause", h.PauseAutoInvest)

		inv.GET("/market", h.Market)
		inv.POST("/market/list", h.MarketList)
		inv.POST("/market/listings/:id/buy", h.MarketBuy)
		inv.GET("/market/orders", h.MarketOrders)

		inv.GET("/documents", h.Documents)
		inv.GET("/certificates/:investmentId", h.Certificate)
		inv.GET("/goals", h.ListGoals)
		inv.POST("/goals", h.CreateGoal)

		// Beneficiaries (next-of-kin designations; own rows only).
		inv.GET("/beneficiaries", h.ListBeneficiaries)
		inv.POST("/beneficiaries", h.AddBeneficiary)
		inv.DELETE("/beneficiaries/:id", h.DeleteBeneficiary)

		// Referrals (thin proxy over the platform referral engine).
		inv.GET("/referrals", h.Referrals)
	}

	// ── Admin control plane (RBAC-gated per role; SoD enforced in service) ─────
	rp := func(perm string) gin.HandlerFunc { return middleware.RequirePermission(d.RBAC, perm) }
	admin := r.Group("/api/finance/fractionalre/admin")
	admin.Use(authn())
	{
		admin.GET("/dashboard", rp(PermSupport), ah.Dashboard)

		// Assets / sponsors / lifecycle.
		admin.GET("/assets", rp(PermSupport), ah.ListAssets)
		admin.POST("/assets", rp(PermAssetManage), ah.CreateAsset)
		admin.GET("/assets/:id", rp(PermSupport), ah.GetAsset)
		admin.PATCH("/assets/:id", rp(PermAssetManage), ah.PatchAsset)
		admin.POST("/assets/:id/title-verify", rp(PermTitleVerify), ah.TitleVerify)
		admin.POST("/assets/:id/transition", rp(PermAssetManage), ah.Transition)
		admin.POST("/assets/:id/rounds", rp(PermAssetManage), ah.CreateRound)
		admin.GET("/assets/:id/cap-table", rp(PermSupport), ah.CapTable)

		// Rounds.
		admin.GET("/rounds", rp(PermSupport), ah.ListRounds)
		admin.GET("/rounds/:id", rp(PermSupport), ah.GetRound)
		admin.POST("/rounds/:id/extend", rp(PermAssetManage), ah.ExtendRound)
		admin.POST("/rounds/:id/close", rp(PermFinance), ah.CloseRound)
		admin.POST("/rounds/:id/refund", rp(PermFinance), ah.RefundRound)
		admin.POST("/rounds/:id/allocate", rp(PermFinance), ah.AllocateRound)

		// Cap table.
		admin.POST("/cap-table/transfer", rp(PermAssetManage), ah.CapTableTransfer)

		// Investors / compliance.
		admin.GET("/investors", rp(PermSupport), ah.ListInvestors)
		admin.GET("/investors/:id", rp(PermSupport), ah.GetInvestor)
		admin.GET("/investors/:id/limit", rp(PermCompliance), ah.InvestorLimit)
		admin.POST("/investors/:id/limit-override", rp(PermCompliance), ah.LimitOverride)
		admin.POST("/investors/:id/classify", rp(PermCompliance), ah.Classify)
		admin.GET("/kyc/queue", rp(PermCompliance), ah.KYCQueue)
		admin.POST("/kyc/:userId/decision", rp(PermCompliance), ah.KYCDecision)
		admin.GET("/compliance/dashboard", rp(PermCompliance), ah.ComplianceDashboard)

		// Distributions (maker-checker).
		admin.POST("/distributions", rp(PermFinance), ah.ScheduleDistribution)
		admin.GET("/distributions", rp(PermSupport), ah.ListDistributions)
		admin.GET("/distributions/:id/preview", rp(PermSupport), ah.PreviewDistribution)
		admin.POST("/distributions/:id/submit", rp(PermFinance), ah.SubmitDistribution)
		admin.POST("/distributions/:id/approve", rp(PermDistributionApprove), ah.ApproveDistribution)

		// Secondary market controls.
		admin.GET("/market/listings", rp(PermSupport), ah.ListMarketListings)
		admin.POST("/market/listings/:id/halt", rp(PermCompliance), ah.HaltListing)
		admin.GET("/market/controls", rp(PermSupport), ah.GetMarketControls)
		admin.PUT("/market/controls", rp(PermFinance), ah.MarketControls)

		// Sponsors.
		admin.GET("/sponsors", rp(PermSponsor), ah.ListSponsors)
		admin.POST("/sponsors", rp(PermSponsor), ah.CreateSponsor)

		// Finance.
		admin.GET("/finance/escrow", rp(PermFinance), ah.Escrow)
		admin.GET("/finance/reconciliation", rp(PermFinance), ah.Reconciliation)
		admin.POST("/finance/refunds/:roundId", rp(PermFinance), ah.FinanceRefund)
		admin.GET("/finance/fees", rp(PermFinance), ah.Fees)

		// Documents.
		admin.GET("/documents", rp(PermSupport), ah.Documents)
		admin.POST("/documents/presign", rp(PermAssetManage), ah.PresignDocument)

		// Audit.
		admin.GET("/audit", rp(PermAudit), ah.Audit)
	}

	log.Println("[fractionalre] routes registered at /api/finance/fractionalre and /api/finance/fractionalre/admin (provider=" + svc.provider.Name() + ")")
	return svc
}
