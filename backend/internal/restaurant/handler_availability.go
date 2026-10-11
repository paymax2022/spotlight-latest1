package restaurant

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// BulkSetAvailability → PATCH /restaurant/:id/menu/items/availability/bulk
// body: {"ids": [...], "is_available": true|false}
func (h *Handler) BulkSetAvailability(c *gin.Context) {
	var body struct {
		IDs         []string `json:"ids" binding:"required"`
		IsAvailable *bool    `json:"is_available" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	n, err := h.svc.SetItemsAvailable(c.Request.Context(), c.Param("id"), ginutil.UserID(c), body.IDs, *body.IsAvailable)
	if err != nil {
		status := ownerErrStatus(err)
		c.JSON(status, gin.H{keyError: httperr.Msg(c, status, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"updated": n}})
}
