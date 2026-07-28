package csr

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the CSR service over gin. Lists are wrapped in {"data": ...};
// single objects are returned directly (mirrors the crowdfunding handlers).
type Handler struct {
	svc *Service
}

// NewHandler constructs a CSR handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// GetProfile — GET /csr/profile.
func (h *Handler) GetProfile(c *gin.Context) {
	userID := c.GetString("user_id")
	p, err := h.svc.GetProfile(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, p)
}

// GetMatchableCampaigns — GET /csr/campaigns.
func (h *Handler) GetMatchableCampaigns(c *gin.Context) {
	items, err := h.svc.GetMatchableCampaigns(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetMatchableCampaign — GET /csr/campaigns/:id.
func (h *Handler) GetMatchableCampaign(c *gin.Context) {
	m, err := h.svc.GetMatchableCampaign(c.Request.Context(), c.Param("id"))
	if errors.Is(err, ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "campaign not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, m)
}

// GetMatches — GET /csr/matches.
func (h *Handler) GetMatches(c *gin.Context) {
	sponsorID := c.GetString("user_id")
	items, err := h.svc.GetMatches(c.Request.Context(), sponsorID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// SetupMatch — POST /csr/matches. Reserves budget → requires Idempotency-Key.
func (h *Handler) SetupMatch(c *gin.Context) {
	sponsorID := c.GetString("user_id")
	idemKey := c.GetHeader("Idempotency-Key")
	if idemKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header is required"})
		return
	}
	var in MatchSetupInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	m, err := h.svc.SetupMatch(c.Request.Context(), sponsorID, in, idemKey)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, m)
}

// ApproveMatch — POST /csr/matches/:id/approve (guarded PENDING_APPROVAL → ACTIVE).
func (h *Handler) ApproveMatch(c *gin.Context) {
	sponsorID := c.GetString("user_id")
	m, err := h.svc.ApproveMatch(c.Request.Context(), sponsorID, c.Param("id"))
	if errors.Is(err, ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "match not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, m)
}

// GetInvoices — GET /csr/invoices.
func (h *Handler) GetInvoices(c *gin.Context) {
	sponsorID := c.GetString("user_id")
	items, err := h.svc.GetInvoices(c.Request.Context(), sponsorID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetImpactSummary — GET /csr/impact.
func (h *Handler) GetImpactSummary(c *gin.Context) {
	sponsorID := c.GetString("user_id")
	summary, err := h.svc.GetImpactSummary(c.Request.Context(), sponsorID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, summary)
}

// GetEmployeeGiving — GET /csr/employee-giving.
func (h *Handler) GetEmployeeGiving(c *gin.Context) {
	sponsorID := c.GetString("user_id")
	items, err := h.svc.GetEmployeeGiving(c.Request.Context(), sponsorID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}
