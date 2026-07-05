package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ─── Multi-modal rating + seat-map handlers ──────────────────────────────────

// ParcelRate: the sender rates the courier on a delivered parcel.
func (h *Handler) ParcelRate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req RateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.RateParcel(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, r)
}

// TowingRate: the user rates the operator/driver on a completed tow.
func (h *Handler) TowingRate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req RateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.RateTowing(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, r)
}

// MoverRate: the customer rates the provider on a completed move.
func (h *Handler) MoverRate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req RateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.RateMover(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, r)
}

// BusSeatMap returns the seat map for a schedule (total + taken seat numbers).
func (h *Handler) BusSeatMap(c *gin.Context) {
	m, err := h.svc.BusSeatMap(c.Request.Context(), c.Param("id"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, m)
}
