package feesvault

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/middleware"
)

const keyMessage = "message"

const keyInvalidInput = "invalid_input"

// Handler exposes FeesVault routes over Gin. Router registration into RegisterAcademy is
// owned by the QA/integration task — see RegisterFeesVault. The member group already
// carries RequireAuthContext (REUSE-MAP §1), so c.GetString("user_id") is populated.
// The Idempotency-Key header is REQUIRED on every money-path route (contribute, apply):
// iron rule "every money mutation MUST require an Idempotency-Key".
type Handler struct {
	svc *Service
}

// NewHandler builds the vault handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// authUserID adapts middleware.GetAuthenticatedUser to ginutil.UserID’s
// fallback signature for contexts missing the "user_id" key.
func authUserID(c *gin.Context) string {
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := ginutil.UserID(c, authUserID)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return u, true
}

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", keyMessage: httperr.Msg(c, http.StatusNotFound, err)})
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", keyMessage: httperr.Msg(c, http.StatusUnauthorized, err)})
	case errors.Is(err, ErrMissingGoal):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_goal", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrIdempotencyKeyReused):
		c.JSON(http.StatusConflict, gin.H{"error": "idempotency_key_reused", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrTargetNotReached):
		c.JSON(http.StatusConflict, gin.H{"error": "target_not_reached", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrVaultEmpty):
		c.JSON(http.StatusConflict, gin.H{"error": "vault_empty", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrTerminal):
		c.JSON(http.StatusConflict, gin.H{"error": "terminal_state", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": "illegal_transition", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", keyMessage: httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

// RegisterFeesVault wires the vault routes onto the member group. It is called from
// fees.RegisterAcademyFees by the integration task (behind FEATURE_ACADEMY_FEES_ENABLED).
// Ledger + invoice collaborators are injected at the root so this package never imports
// finance/ledger or the invoice package concretely.
//
//	member: POST  /vaults                       create vault
//	        GET   /vaults                       list my vaults
//	        GET   /vaults/:id                   get vault (derived balance)
//	        POST  /vaults/:id/contribute        fund (Idempotency-Key required) — SF-5
//	        POST  /vaults/:id/apply-to-invoice  one-tap apply (Idempotency-Key required)
//	        POST  /vaults/:id/withdraw          exit (no penalty)
//	        POST  /vaults/:id/lock              compliance hold
//	        POST  /vaults/:id/unlock            release hold
func RegisterFeesVault(member *gin.RouterGroup, svc *Service) *Handler {
	h := NewHandler(svc)
	if member != nil {
		g := member.Group("/vaults")
		g.POST("", h.Create)
		g.GET("", h.List)
		g.GET("/:id", h.Get)
		g.POST("/:id/contribute", h.Contribute)
		g.POST("/:id/apply-to-invoice", h.ApplyToInvoice)
		g.POST("/:id/withdraw", h.Withdraw)
		g.POST("/:id/lock", h.Lock)
		g.POST("/:id/unlock", h.Unlock)
	}
	return h
}

func (h *Handler) Create(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req CreateVaultRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.CreateVault(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) List(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.ListVaults(c.Request.Context(), u)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Get(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.GetVault(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Contribute(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req ContributeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.Contribute(c.Request.Context(), u, c.Param("id"), req.AmountMinor, ginutil.IdempotencyKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ApplyToInvoice(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req ApplyToInvoiceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.ApplyToInvoice(c.Request.Context(), u, c.Param("id"), req.InvoiceID, ginutil.IdempotencyKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Withdraw(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.Withdraw(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Lock(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.Lock(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Unlock(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.Unlock(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
