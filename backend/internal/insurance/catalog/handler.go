package catalog

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/kyc"
)

// Handler exposes catalog routes. Member routes filter by the caller's KYC tier;
// admin routes manage catalog + routing.
type Handler struct {
	svc *Service
	kyc *kyc.Service
}

// NewHandler constructs the catalog handler. kycSvc may be nil (members then
// resolve to tier 0 and only see tier-0 products).
func NewHandler(svc *Service, kycSvc *kyc.Service) *Handler {
	return &Handler{svc: svc, kyc: kycSvc}
}

// ListProducts (member): GET /products?line=&context=
// Filtered by KYC tier + optional product_line context (PRD §12.1).
func (h *Handler) ListProducts(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	tier := 0
	if h.kyc != nil {
		if p, err := h.kyc.GetProfile(c.Request.Context(), userID); err == nil && p != nil {
			tier = int(p.Tier)
		}
	}
	line := c.Query("line")
	if line == "" {
		line = c.Query("context")
	}
	products, err := h.svc.ListForMember(c.Request.Context(), tier, line)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": products})
}

// AdminList (admin): GET /catalog — all products incl. inactive.
func (h *Handler) AdminList(c *gin.Context) {
	products, err := h.svc.ListAdmin(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": products})
}

// AdminSetActive (admin): PATCH /catalog/:code/active {active:bool}
func (h *Handler) AdminSetActive(c *gin.Context) {
	code := c.Param("code")
	var body struct {
		Active bool `json:"active"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetActive(c.Request.Context(), code, body.Active); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"code": code, "active": body.Active}})
}

// AdminSetRouting (admin): PATCH /routing/:code {provider, provider_product_code}
// Re-routes a product to a different aggregator — a data edit, not a code change.
func (h *Handler) AdminSetRouting(c *gin.Context) {
	code := c.Param("code")
	var body struct {
		Provider            string `json:"provider" binding:"required"`
		ProviderProductCode string `json:"provider_product_code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetProvider(c.Request.Context(), code, body.Provider, body.ProviderProductCode); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"code": code, "provider": body.Provider}})
}
