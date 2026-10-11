package restaurant

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/restaurant/taxonomy"
)

// CreateTaxonomyItem → POST /restaurant/:id/menu/items when admin-managed categories
// are on.
func (h *Handler) CreateTaxonomyItem(c *gin.Context) {
	var req CreateTaxonomyItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	it, err := h.svc.CreateTaxonomyItem(c.Request.Context(), c.Param("id"), ginutil.UserID(c), req)
	if err != nil {
		status := taxonomyItemErrStatus(err)
		c.JSON(status, gin.H{keyError: httperr.Msg(c, status, err)})
		return
	}
	c.JSON(http.StatusCreated, it)
}

func taxonomyItemErrStatus(err error) int {
	switch {
	case errors.Is(err, ErrItemNameTaken):
		return http.StatusConflict
	case errors.Is(err, taxonomy.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, taxonomy.ErrInvalid):
		return http.StatusUnprocessableEntity
	default:
		return ownerErrStatus(err)
	}
}
