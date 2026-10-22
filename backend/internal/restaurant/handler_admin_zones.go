package restaurant

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// FOOD-UAT-C-003 admin zone CRUD (RBAC restaurant.admin.onboarding, wired in routes).

// AdminListZones → GET /api/restaurant/admin/:id/zones.
func (h *Handler) AdminListZones(c *gin.Context) {
	zs, err := h.svc.ListZones(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"zones": zs})
}

// AdminCreateZone → POST /api/restaurant/admin/:id/zones  {kind:"radius_km", radius_km_bps}.
func (h *Handler) AdminCreateZone(c *gin.Context) {
	var body struct {
		Kind        string `json:"kind"`
		RadiusKmBps *int   `json:"radius_km_bps"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if body.Kind != "radius_km" || body.RadiusKmBps == nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "only kind=radius_km with radius_km_bps is supported"})
		return
	}
	z, err := h.svc.CreateRadiusZone(c.Request.Context(), c.Param("id"), ginutil.UserID(c), *body.RadiusKmBps)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		c.JSON(http.StatusNotFound, gin.H{keyError: "restaurant not found"})
	case err != nil:
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
	default:
		c.JSON(http.StatusCreated, z)
	}
}

// AdminDeleteZone → DELETE /api/restaurant/admin/:id/zones/:zoneId.
func (h *Handler) AdminDeleteZone(c *gin.Context) {
	ok, err := h.svc.DeleteZone(c.Request.Context(), c.Param("id"), c.Param("zoneId"), ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{keyError: "zone not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}
