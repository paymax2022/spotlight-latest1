package feesscholarship

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the Sponsor-a-Student pledge → fund → apply surface over Gin. Router
// registration into RegisterAcademy is owned by the QA/integration task — see
// RegisterFeesScholarship.
//
// NOTE (integration wiring): this package takes an already-assembled Service because it needs
// the injected LedgerPoster (finance/ledger) + InvoicePayer (feesinvoice) ports composed at the
// academy registration root (the same pattern edupay uses for its rails).
type Handler struct {
	svc *Service
}

// NewHandler builds the scholarship handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return u, true
}

// idemKey reads the Idempotency-Key header (required for the money-path fund/apply mutations).
func idemKey(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrMissingStudent):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_student", "message": err.Error()})
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount", "message": err.Error()})
	case errors.Is(err, ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", "message": err.Error()})
	case errors.Is(err, ErrIdempotencyReused):
		c.JSON(http.StatusConflict, gin.H{"error": "idempotency_key_reused", "message": err.Error()})
	case errors.Is(err, ErrPledgeNotFunded):
		c.JSON(http.StatusConflict, gin.H{"error": "pledge_not_funded", "message": err.Error()})
	case errors.Is(err, ErrPledgeExhausted):
		c.JSON(http.StatusConflict, gin.H{"error": "pledge_amount_exhausted", "message": err.Error()})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": "illegal_transition", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterFeesScholarship wires pledge routes using an already-assembled Service. nil svc/group
// is skipped. Routes should be gated by the integration task with
// middleware.RequirePermission(rbac, "academy.fees.scholarship.*").
//
//	member/admin: POST /scholarship/pledges                 create a Sponsor-a-Student pledge
//	              POST /scholarship/pledges/:id/fund         fund the pledge (Idempotency-Key)
//	              POST /scholarship/pledges/:id/apply        apply an award to an invoice (Idempotency-Key)
//	              GET  /scholarship/pledges/:id              get pledge
//	              GET  /scholarship/pledges/:id/awards       list awards for a pledge
func RegisterFeesScholarship(group *gin.RouterGroup, svc *Service, rbac services.RBACService) *Handler {
	if svc == nil {
		return nil
	}
	h := NewHandler(svc)
	if group != nil {
		sg := group.Group("/scholarship/pledges")
		sg.POST("", h.CreatePledge)
		sg.POST("/:id/fund", h.FundPledge)
		sg.POST("/:id/apply", h.ApplyAward)
		sg.GET("/:id", h.GetPledge)
		sg.GET("/:id/awards", h.ListAwards)
	}
	_ = rbac
	return h
}

// ── Handlers ────────────────────────────────────────────────────────────────────

func (h *Handler) CreatePledge(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req CreatePledgeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreatePledge(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) FundPledge(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.FundPledge(c.Request.Context(), u, c.Param("id"), idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ApplyAward(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req ApplyAwardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	req.PledgeID = c.Param("id")
	out, err := h.svc.ApplyAward(c.Request.Context(), u, req, idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GetPledge(c *gin.Context) {
	out, err := h.svc.GetPledge(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListAwards(c *gin.Context) {
	out, err := h.svc.ListAwards(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
