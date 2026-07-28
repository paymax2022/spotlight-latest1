package connectprofile

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the Phase-1 profile + per-mode visibility endpoints.
type Handler struct{ svc *Service }

// NewHandler builds the profile HTTP handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) uid(c *gin.Context) string { return c.GetString("user_id") }

// Get — GET /api/v1/connect/profile (authenticated member).
func (h *Handler) Get(c *gin.Context) {
	uid := h.uid(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	p, err := h.svc.GetOrCreate(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load profile"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// Update — PATCH /api/v1/connect/profile (authenticated member).
func (h *Handler) Update(c *gin.Context) {
	uid := h.uid(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var in UpsertProfileInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.Update(c.Request.Context(), uid, in)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update profile"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// GetModes — GET /api/v1/connect/profile/modes (authenticated member).
func (h *Handler) GetModes(c *gin.Context) {
	uid := h.uid(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	modes, err := h.svc.GetModes(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load modes"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": modes})
}

// UpsertMode — PATCH /api/v1/connect/profile/modes/:mode (authenticated member).
func (h *Handler) UpsertMode(c *gin.Context) {
	uid := h.uid(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	mode := c.Param("mode")
	if !ValidMode(mode) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid mode"})
		return
	}
	var in UpsertModeInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	m, err := h.svc.UpsertMode(c.Request.Context(), uid, mode, in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": m})
}

type mediaRequest struct {
	URL  string `json:"url" binding:"required"`
	Kind string `json:"kind"`
}

// AddMedia — POST /api/v1/connect/profile/media (authenticated member).
// Returns moderation_status=pending; media is NOT public until moderated.
func (h *Handler) AddMedia(c *gin.Context) {
	uid := h.uid(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req mediaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, status, err := h.svc.AddMedia(c.Request.Context(), uid, req.URL, req.Kind)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{"id": id, "moderation_status": status}})
}
