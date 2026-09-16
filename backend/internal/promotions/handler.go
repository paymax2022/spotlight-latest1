package promotions

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// ListBanners → GET /promotions/banners?module={module}
// Returns active promotional banners for a given module.
func (h *Handler) ListBanners(c *gin.Context) {
	module := c.Query("module")
	if module == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "module parameter required"})
		return
	}

	banners, err := h.svc.ListActiveBanners(c.Request.Context(), module)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load banners"})
		return
	}

	if banners == nil {
		banners = []Banner{} // Return empty array instead of null
	}
	c.JSON(http.StatusOK, gin.H{"banners": banners})
}

// CreateBanner → POST /promotions/banners (admin only)
// Creates a new promotional banner. Requires admin role.
func (h *Handler) CreateBanner(c *gin.Context) {
	var input BannerInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	banner, err := h.svc.CreateBanner(c.Request.Context(), input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create banner"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"banner": banner})
}

// UpdateBanner → PATCH /promotions/banners/:id (admin only)
// Updates a promotional banner.
func (h *Handler) UpdateBanner(c *gin.Context) {
	var input BannerInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	banner, err := h.svc.UpdateBanner(c.Request.Context(), c.Param("id"), input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update banner"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"banner": banner})
}

// DeleteBanner → DELETE /promotions/banners/:id (admin only)
// Soft-deletes a promotional banner.
func (h *Handler) DeleteBanner(c *gin.Context) {
	if err := h.svc.DeleteBanner(c.Request.Context(), c.Param("id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete banner"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"deleted": true})
}
