package connectjobs

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid reads the authenticated user id set by the auth middleware.
func uid(c *gin.Context) string { return c.GetString("user_id") }

// idemKey reads the required Idempotency-Key header for money mutations.
func idemKey(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

// fail maps service errors to HTTP status with the shared gin.H{"error"} envelope.
func fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrMissingIdem):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, ErrCompanyNotVerified):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrJobNotActive):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		// Wallet/ledger errors (insufficient funds, duplicate, tier) surface here.
		msg := err.Error()
		switch {
		case strings.Contains(msg, "insufficient funds"):
			c.JSON(http.StatusPaymentRequired, gin.H{"error": "insufficient wallet balance"})
		case strings.Contains(msg, "duplicate"):
			c.JSON(http.StatusConflict, gin.H{"error": "duplicate request"})
		case strings.Contains(msg, "limit"):
			c.JSON(http.StatusForbidden, gin.H{"error": "transaction limit exceeded"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
		}
	}
}

// ── Member (JB-01..08 + company page member surfaces) ───────────────────────

// ListJobs — GET /networking/jobs (JB-01).
func (h *Handler) ListJobs(c *gin.Context) {
	jobs, err := h.svc.ListJobs(c.Request.Context(), 0)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": jobs})
}

// GetJob — GET /networking/jobs/:jobId (JB-02).
func (h *Handler) GetJob(c *gin.Context) {
	j, err := h.svc.GetJob(c.Request.Context(), c.Param("jobId"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": j})
}

// Apply — POST /networking/jobs/:jobId/applications (JB-03).
func (h *Handler) Apply(c *gin.Context) {
	var in ApplyInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	a, err := h.svc.Apply(c.Request.Context(), uid(c), c.Param("jobId"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": a})
}

// MyApplications — GET /networking/applications/mine (JB-04).
func (h *Handler) MyApplications(c *gin.Context) {
	apps, err := h.svc.MyApplications(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": apps})
}

// WithdrawApplication — PATCH /networking/applications/:appId/withdraw (applicant, JB-04).
func (h *Handler) WithdrawApplication(c *gin.Context) {
	a, err := h.svc.TransitionApplication(c.Request.Context(), uid(c), "", c.Param("appId"), AppWithdrawn, "")
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

// OpenToWork — PUT /networking/open-to-work (JB-07).
func (h *Handler) OpenToWork(c *gin.Context) {
	var in OpenToWorkInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetOpenToWork(c.Request.Context(), uid(c), in); err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"open": in.Open}})
}

// CreateReferral — POST /networking/applications/:appId/referrals (JB-08, single-level).
func (h *Handler) CreateReferral(c *gin.Context) {
	var in ReferInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b, err := h.svc.CreateReferral(c.Request.Context(), uid(c), c.Param("appId"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": b})
}

// MyReferrals — GET /networking/referrals/mine (GM-04).
func (h *Handler) MyReferrals(c *gin.Context) {
	bs, err := h.svc.MyReferrals(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": bs})
}

// ClaimCompanyPage — POST /networking/company-claims (CP-02).
func (h *Handler) ClaimCompanyPage(c *gin.Context) {
	var in ClaimCompanyInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cp, err := h.svc.ClaimCompanyPage(c.Request.Context(), uid(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": cp})
}

// GetCompanyPage — GET /networking/company-pages/:id (CP-01).
func (h *Handler) GetCompanyPage(c *gin.Context) {
	cp, err := h.svc.GetCompanyPage(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cp})
}

// FollowCompanyPage — POST /networking/company-pages/:id/follow (CP-04 feeds count).
func (h *Handler) FollowCompanyPage(c *gin.Context) {
	if err := h.svc.Follow(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"followed": true}})
}

// ── Company-scoped (RBAC RequireScopedPermission, param "id" = company_page_id) ──

// CreateJob — POST /networking/company-pages/:id/jobs (JB-05, recruiter).
func (h *Handler) CreateJob(c *gin.Context) {
	var in CreateJobInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	j, err := h.svc.CreateJob(c.Request.Context(), uid(c), c.Param("id"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": j})
}

// ActivateJob — POST /networking/company-pages/:id/jobs/:jobId/activate (JB-05, money path).
func (h *Handler) ActivateJob(c *gin.Context) {
	j, err := h.svc.ActivateJob(c.Request.Context(), uid(c), c.Param("id"), c.Param("jobId"), idemKey(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": j})
}

// Pipeline — GET /networking/company-pages/:id/jobs/:jobId/applications (JB-06, recruiter).
func (h *Handler) Pipeline(c *gin.Context) {
	apps, err := h.svc.Pipeline(c.Request.Context(), uid(c), c.Param("id"), c.Param("jobId"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": apps})
}

// TransitionApplication — PATCH /networking/company-pages/:id/applications/:appId/state (JB-06).
func (h *Handler) TransitionApplication(c *gin.Context) {
	var in TransitionAppInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	a, err := h.svc.TransitionApplication(c.Request.Context(), uid(c), c.Param("id"), c.Param("appId"), AppState(in.State), idemKey(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

// GrantCapability — POST /networking/company-pages/:id/admins (CP-03, page admin).
func (h *Handler) GrantCapability(c *gin.Context) {
	var in GrantAdminInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	a, err := h.svc.GrantCapability(c.Request.Context(), uid(c), c.Param("id"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": a})
}

// RevokeCapability — DELETE /networking/company-pages/:id/admins/:userId (CP-03, PN-9).
func (h *Handler) RevokeCapability(c *gin.Context) {
	if err := h.svc.RevokeCapability(c.Request.Context(), uid(c), c.Param("id"), c.Param("userId")); err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"revoked": true}})
}

// ── Admin (platform reviewer) ───────────────────────────────────────────────

// ReviewClaim — PATCH /connect/admin/company-pages/:id/claim (connect.company.review).
func (h *Handler) ReviewClaim(c *gin.Context) {
	var in struct {
		State string `json:"state" binding:"required"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cp, err := h.svc.ReviewClaim(c.Request.Context(), uid(c), c.Param("id"), ClaimState(in.State))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cp})
}

// Register wires the jobs / company-page / referral-bounty module onto the shared
// Connect member + admin router groups. It is the ONLY exported entry point; the
// orchestrator constructs the narrow money/loyalty ports and calls this.
//
// Signature:
//
//	Register(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService,
//	         wallet WalletDebiter, ledger LedgerCrediter, accounts RevenueResolver,
//	         loyalty LoyaltyAwarder, audit Auditor)
//
// Member routes live under member.Group("/networking"). Company-scoped write routes add
// per-route RBAC via RequireScopedPermission(..., "company_page", "id") so the object
// param ":id" is the company_page_id (PN-9). Admin routes add RequirePermission.
func Register(
	member, admin *gin.RouterGroup,
	pool *pgxpool.Pool,
	rbac services.RBACService,
	wallet WalletDebiter,
	ledger LedgerCrediter,
	accounts RevenueResolver,
	loyalty LoyaltyAwarder,
	audit Auditor,
) {
	svc := NewService(NewRepository(pool), wallet, ledger, accounts, loyalty, audit)
	h := NewHandler(svc)

	g := member.Group("/networking")

	// Jobs feed + apply (JB-01..04, 07, 08).
	g.GET("/jobs", h.ListJobs)
	g.GET("/jobs/:jobId", h.GetJob)
	g.POST("/jobs/:jobId/applications", h.Apply)
	g.GET("/applications/mine", h.MyApplications)
	g.PATCH("/applications/:appId/withdraw", h.WithdrawApplication)
	g.PATCH("/applications/:appId/referrals", h.CreateReferral) // referral tied to an app
	g.POST("/applications/:appId/referrals", h.CreateReferral)
	g.PUT("/open-to-work", h.OpenToWork)
	g.GET("/referrals/mine", h.MyReferrals)

	// Company pages (member surfaces). NOTE: the claim route uses a distinct path
	// (/company-claims) rather than /company-pages/claim to avoid a gin static-vs-param
	// routing conflict with /company-pages/:id in the POST tree.
	g.POST("/company-claims", h.ClaimCompanyPage)
	g.GET("/company-pages/:id", h.GetCompanyPage)
	g.POST("/company-pages/:id/follow", h.FollowCompanyPage)

	// Company-scoped recruiter/admin routes — object-level RBAC (PN-9), param "id".
	recruiter := middleware.RequireScopedPermission(rbac, "connect.recruiter.manage", "company_page", "id")
	pageAdmin := middleware.RequireScopedPermission(rbac, "connect.company.admin", "company_page", "id")

	g.POST("/company-pages/:id/jobs", recruiter, h.CreateJob)
	g.POST("/company-pages/:id/jobs/:jobId/activate", recruiter, h.ActivateJob)
	g.GET("/company-pages/:id/jobs/:jobId/applications", recruiter, h.Pipeline)
	g.PATCH("/company-pages/:id/applications/:appId/state", recruiter, h.TransitionApplication)
	g.POST("/company-pages/:id/admins", pageAdmin, h.GrantCapability)
	g.DELETE("/company-pages/:id/admins/:userId", pageAdmin, h.RevokeCapability)

	// Admin — platform claim review (ADM-CP-01).
	ag := admin.Group("/networking")
	ag.PATCH("/company-pages/:id/claim",
		middleware.RequirePermission(rbac, "connect.company.review"), h.ReviewClaim)
}
