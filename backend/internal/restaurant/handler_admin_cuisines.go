package restaurant

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// Admin cuisine tagging (RBAC restaurant.admin.onboarding, wired in
// finance_routes.go). restaurant.admin.onboarding rather than restaurant.manage
// because this panel lives in onboarding review and the restaurant-ops role
// holds only the restaurant.admin.* slugs.

// AdminGetRestaurantCuisines → GET /api/restaurant/admin/restaurants/:id/cuisines
// (restaurant.admin.onboarding). Everything assignable plus the current tags.
func (h *Handler) AdminGetRestaurantCuisines(c *gin.Context) {
	if !validUUIDParam(c, "id") {
		return
	}
	out, err := h.svc.AdminGetRestaurantCuisines(c.Request.Context(), c.Param("id"))
	if err != nil {
		cuisineErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// AdminSetRestaurantCuisines → PUT /api/restaurant/admin/restaurants/:id/cuisines
// (restaurant.admin.onboarding) body {cuisine_ids: []}. Replaces the set.
func (h *Handler) AdminSetRestaurantCuisines(c *gin.Context) {
	if !validUUIDParam(c, "id") {
		return
	}
	var body struct {
		CuisineIDs []string `json:"cuisine_ids"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.AdminSetRestaurantCuisines(c.Request.Context(), ginutil.UserID(c), c.Param("id"), body.CuisineIDs)
	if err != nil {
		cuisineErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func cuisineErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrRestaurantNotFound):
		c.JSON(http.StatusNotFound, gin.H{keyError: "restaurant: not found"})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}
