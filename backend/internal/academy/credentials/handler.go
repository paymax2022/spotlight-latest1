package credentials

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the credentials + earning-bridge surface over Gin.
//   - member: own credentials, public-ish verify, eligible opportunities, apply.
//   - admin : credential revoke + earning-opportunity CRUD, gated academy.credentials.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid resolves the authenticated user. The finance group mirrors the auth user into
// c.Set("user_id", ...); fall back to the auth context if absent.
func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": "illegal_transition", "message": err.Error()})
	case errors.Is(err, ErrNotEligible):
		c.JSON(http.StatusForbidden, gin.H{"error": "not_eligible", "message": err.Error()})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterAcademyCredentials wires the credentials + earning-bridge routes. Mirrors
// the project Register pattern: builds its own service from the pool, injects the
// (nil-safe) roleUpgrader, and gates admin routes with middleware.RequirePermission.
//
// Member routes are BARE subpaths (the aggregator passes /api/finance/academy base):
//
//	GET  /credentials                       — my credentials
//	GET  /credentials/verify/:verificationId — public sanitized verification
//	GET  /earning/opportunities             — opportunities I'm eligible for
//	POST /earning/apply                     — apply → routes into Paymax role-upgrade
//
// Admin routes (RBAC academy.credentials):
//
//	POST /credentials/:id/revoke
//	GET  /earning/opportunities             — list (all)
//	POST /earning/opportunities             — create
//	PUT  /earning/opportunities/:id         — update
func RegisterAcademyCredentials(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, roleUpgrader RoleUpgrader) {
	if pool == nil {
		return
	}
	svc := NewService(pool, roleUpgrader) // nil roleUpgrader → deterministic no-op (dev)
	h := NewHandler(svc)

	// ── Member ──
	member.GET("/credentials", h.ListMine)
	member.GET("/credentials/verify/:verificationId", h.Verify)
	member.GET("/credentials/:id", h.GetOne)
	member.GET("/earning/opportunities", h.ListEligible)
	member.GET("/earning/opportunities/:id", h.GetOpportunity)
	member.POST("/earning/apply", h.Apply)

	// ── Admin (RBAC academy.credentials) ──
	guard := middleware.RequirePermission(rbac, "academy.credentials")
	admin.POST("/credentials/:id/revoke", guard, h.AdminRevoke)
	admin.GET("/earning/opportunities", guard, h.AdminListOpportunities)
	admin.POST("/earning/opportunities", guard, h.AdminCreateOpportunity)
	admin.PUT("/earning/opportunities/:id", guard, h.AdminUpdateOpportunity)
}

// ── Member handlers ─────────────────────────────────────────────────────────────

func (h *Handler) ListMine(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.ListMine(c.Request.Context(), u)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetOne returns a single credential the caller OWNS (same Credential shape as the
// ListMine list item). Ownership is enforced in the service; a non-owned or missing
// id returns 404. Registered as a param sibling of /credentials/verify/:verificationId
// (Gin v1.10 routes the literal "verify" ahead of :id).
func (h *Handler) GetOne(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.GetMine(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Verify is the public-ish verification lookup. It returns only the sanitized
// registry record (no PII beyond holder display name) and does not require the caller
// to own the credential.
func (h *Handler) Verify(c *gin.Context) {
	out, err := h.svc.Verify(c.Request.Context(), c.Param("verificationId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListEligible(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.EvaluateBridge(c.Request.Context(), u)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetOpportunity returns a single earning opportunity the caller is eligible for
// (same EarningOpportunity shape as the ListEligible list item). Eligibility is
// enforced in the service; a non-eligible or missing id returns 404.
func (h *Handler) GetOpportunity(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.GetEligibleOpportunity(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Apply(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req ApplyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	// Prefer the header idempotency key; fall back to the body field.
	idem := c.GetHeader("Idempotency-Key")
	if idem == "" {
		idem = req.IdempotencyKey
	}
	res, err := h.svc.Apply(c.Request.Context(), u, req.OpportunityID, idem)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

// ── Admin handlers ──────────────────────────────────────────────────────────────

func (h *Handler) AdminRevoke(c *gin.Context) {
	var req RevokeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.Revoke(c.Request.Context(), uid(c), c.Param("id"), req.Reason)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminListOpportunities(c *gin.Context) {
	out, err := h.svc.ListOpportunities(c.Request.Context(), false)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminCreateOpportunity(c *gin.Context) {
	var req CreateOpportunityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateOpportunity(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminUpdateOpportunity(c *gin.Context) {
	var req UpdateOpportunityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpdateOpportunity(c.Request.Context(), uid(c), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
